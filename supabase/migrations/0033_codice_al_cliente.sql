-- ============================================================================
-- 0033 — Il codice deve poter arrivare: il numero del cliente, all'analista
-- ============================================================================
-- Il cliente ha detto, per il prelievo: «non posso farlo». La traccia che lo
-- spiega è nel database, e non è un'ipotesi:
--
--   * `TRC-O-2026-000004` · 5/11 16:02 — prelievo di 420.000 € chiesto, e
--     **nessun codice consegnato** in trenta minuti;
--   * `TRC-O-2026-000005` · 5/11 19:02 — secondo tentativo, IBAN diverso;
--   * 19:05 — l'analista consegna il codice (il 0022, applicato alle 19:10,
--     aveva già portato la finestra da dieci a trenta minuti);
--   * 19:11 — il cliente **annulla**, con il codice pronto per lui.
--
-- Il tempo non era più il problema. Mancava il canale: un codice che esiste,
-- che vale trenta minuti, e che non arriva a nessuno. La pagina gli diceva «la
-- richiesta risulta per <email>», e quella email non è mai partita — il
-- progetto non ha un servizio di posta.
--
-- Cosa fa questa migrazione, e cosa non fa:
--   * **non** manda niente da sola: nessun invio automatico, nessuna API di
--     terzi. `wa.me` apre una chat *dal telefono di chi legge*: il messaggio
--     parte dal numero dell'assistenza, e resta una persona a premerlo;
--   * porta al client il **numero di telefono del cliente**, che oggi non esce
--     da `admin_conferme_bonifico` — senza, l'analista ha il codice in mano e
--     nessun posto dove mandarlo. Il numero lo vede solo un amministratore, che
--     già vede nome, email e saldo di quella persona;
--   * mette il numero anche nella risposta di `admin_conferma_codice`, perché è
--     lì che il codice compare per la prima e unica volta.
--
-- Perché il numero e non l'email nel messaggio: è il canale che il cliente usa
-- già per parlare con l'assistenza (il pulsante è su ogni pagina, con il numero
-- nuovo `+1 201 621 1241`), e una chat si legge subito mentre una casella di
-- posta può restare chiusa. La scelta non toglie niente a chi preferisce il
-- telefono: il numero glielo dà la stessa schermata.
-- ============================================================================

begin;

-- ============================================================================
-- 1. La lista delle conferme porta anche il numero del cliente
-- ============================================================================
-- Identica al 0022 nei campi e nei filtri: si aggiungono `telefono` e
-- `cliente_nome`. Nessun filtro cambia, quindi nessun cliente vede di più.
create or replace function traccia.admin_conferme_bonifico(
  p_token text, p_stato text default 'aperte'
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  righe jsonb;
  minuti int := traccia.otp_setting('minutes', 30);
begin
  if coalesce(p_stato, 'aperte') not in ('aperte', 'tutte', 'consegnate', 'scadute') then
    raise exception 'Stato non riconosciuto: usa aperte, consegnate, scadute o tutte.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x order by x ->> 'creata_il' desc), '[]'::jsonb) into righe
  from (
    select jsonb_build_object(
             'id', c.id,
             'reference', c.reference,
             'cliente', u.name,
             'cliente_nome', coalesce(nullif(trim(u.first_name || ' ' || u.last_name), ''), u.name),
             'email', c.email,
             /* il numero che serve a mandare il codice: vuoto se il cliente
                non ne ha uno, e la console non mostra il pulsante */
             'telefono', coalesce(u.phone, ''),
             'importo_eur', (c.payload ->> 'importo')::numeric,
             'beneficiario', c.payload ->> 'beneficiario',
             'iban', traccia.iban_format(c.payload ->> 'iban'),
             'scade_il', extract(epoch from c.expires_at),
             'consegna_entro', extract(epoch from
                (c.expires_at - make_interval(mins => greatest(1, (minuti / 4)::int)))),
             'minuti_rimasti', greatest(0, ceil(extract(epoch from (c.expires_at - now())) / 60)::int),
             'creata_il', c.created_at,
             'tentativi', c.attempts,
             'consegnata_il', c.consegnato_at,
             'consegnata_da', (select name from traccia.users where id = c.inviato_da),
             'stato', case
                        when c.consumed_at is not null then 'usata'
                        when c.cancelled_at is not null then 'annullata'
                        when c.expires_at < now() then 'scaduta'
                        when c.verified_at is not null then 'confermata'
                        else 'aperta' end
           ) as x
      from traccia.transfer_challenges c
      join traccia.users u on u.id = c.user_id
     where case coalesce(p_stato, 'aperte')
             when 'aperte' then c.consumed_at is null and c.cancelled_at is null
                                 and c.expires_at >= now() and c.verified_at is null
             when 'consegnate' then c.consegnato_at is not null
             when 'scadute' then c.expires_at < now() and c.consumed_at is null
             when 'tutte' then true
             else false
           end
     order by c.created_at desc
     limit 100
  ) s;

  return jsonb_build_object('stato', coalesce(p_stato, 'aperte'), 'minuti', minuti, 'conferme', righe);
end $fn$;

-- ============================================================================
-- 2. Il codice esce insieme al numero a cui mandarlo
-- ============================================================================
-- Il resto della funzione è il 0022, riga per riga: stessi controlli, stesso
-- rifiuto di un codice già consegnato, stessa impronta e nessun modo di
-- rileggerlo. Cambia solo la risposta, che porta `telefono`: chi legge il
-- codice deve poterlo mandare senza cercare il numero in un'altra schermata.
create or replace function traccia.admin_conferma_codice(
  p_token text, p_id uuid
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  ch traccia.transfer_challenges;
  u traccia.users;
  codice text;
begin
  select * into ch from traccia.transfer_challenges where id = p_id for update;
  if ch.id is null then
    raise exception 'Conferma non trovata.' using errcode = '22023';
  end if;
  if ch.consumed_at is not null or ch.cancelled_at is not null then
    raise exception 'Questa conferma è chiusa: non c''è nessun codice da consegnare.' using errcode = '22023';
  end if;
  if ch.expires_at < now() then
    raise exception 'Questa conferma è scaduta alle %. Il cliente deve disporre un nuovo bonifico: chiudila con «Rilascia i fondi» e i soldi tornano disponibili subito.',
      to_char(ch.expires_at, 'HH24:MI') using errcode = '22023';
  end if;
  if ch.consegnato_at is not null then
    raise exception 'Il codice di questa conferma è già stato consegnato il % da %. Non è possibile rileggerlo: se il cliente non lo ha ricevuto, chiudi la richiesta con «Rilascia» e fagli disporre di nuovo il bonifico.',
      to_char(ch.consegnato_at, 'DD/MM/YYYY HH24:MI'),
      (select name from traccia.users where id = ch.inviato_da) using errcode = '22023';
  end if;

  select * into u from traccia.users where id = ch.user_id;

  /* Il codice esce solo adesso e solo per questa chiamata: l'impronta resta,
     il codice no. Non c'è modo di rileggerlo dopo. */
  codice := traccia.genera_codice();
  update traccia.transfer_challenges
     set code_hash = traccia.hash_token(codice),
         consegnato_at = now(),
         inviato_da = a.id
   where id = ch.id;

  perform traccia.log_action(a, 'bonifico_conferma_consegnata', ch.reference,
    'codice comunicato a ' || ch.email ||
    case when coalesce(u.phone, '') <> '' then ' · tel ' || u.phone else ' · senza telefono' end);

  return jsonb_build_object(
    'ok', true,
    'id', ch.id,
    'reference', ch.reference,
    'codice', codice,
    'cliente', coalesce(nullif(trim(u.first_name || ' ' || u.last_name), ''), u.name),
    'email', ch.email,
    'telefono', coalesce(u.phone, ''),
    'importo_eur', (ch.payload ->> 'importo')::numeric,
    'beneficiario', ch.payload ->> 'beneficiario',
    'scade_il', extract(epoch from ch.expires_at),
    'minuti_rimasti', greatest(0, ceil(extract(epoch from (ch.expires_at - now())) / 60)::int),
    'avviso', case
                 when coalesce(u.phone, '') <> ''
                   then 'Mandalo adesso con il pulsante qui sotto: il messaggio è già scritto. Il codice non compare nel sito e non è più leggibile dopo questa schermata.'
                 else 'Questo cliente non ha un numero di telefono salvato: comunicalo a voce e chiedi di aggiornare il recapito. Il codice non è più leggibile dopo questa schermata.'
               end);
end $fn$;

-- ============================================================================
-- 3. La superficie pubblica resta quella del 0022
-- ============================================================================
-- Si ricreano i wrapper toccati dalla seconda definizione: `create or replace`
-- su `traccia.*` non tocca `public.*`, e chi dimentica il wrapper crede di aver
-- finito mentre il pulsante risponde «function not found».
create or replace function public.admin_conferme_bonifico(
  p_token text, p_stato text default 'aperte'
) returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_conferme_bonifico(p_token, p_stato);
$f$;

create or replace function public.admin_conferma_codice(p_token text, p_id uuid)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_conferma_codice(p_token, p_id);
$f$;

revoke all on function public.admin_conferme_bonifico(text, text) from public;
revoke all on function public.admin_conferma_codice(text, uuid) from public;

grant execute on function public.admin_conferme_bonifico(text, text) to anon, authenticated;
grant execute on function public.admin_conferma_codice(text, uuid) to anon, authenticated;

-- ============================================================================
-- 4. Controllo finale: il numero c'è davvero nella risposta
-- ============================================================================
-- Una migrazione che «dovrebbe» aggiungere un campo e non lo aggiunge è peggio
-- di una che non lo aggiunge: la console mostra un pulsante che non compare e
-- nessuno sa perché. Qui si legge la definizione appena scritta.
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p
   where p.proname = 'admin_conferme_bonifico'
     and p.pronamespace = 'traccia'::regnamespace;
  if d is null or position('''telefono''' in d) = 0 then
    raise exception 'la lista delle conferme non porta il telefono del cliente';
  end if;

  select pg_get_functiondef(p.oid) into d
    from pg_proc p
   where p.proname = 'admin_conferma_codice'
     and p.pronamespace = 'traccia'::regnamespace;
  if d is null or position('''telefono''' in d) = 0 then
    raise exception 'il codice consegnato non porta il telefono del cliente';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
