-- ============================================================================
-- 0022 — Il codice deve arrivare, e arrivare in tempo
-- ============================================================================
-- Il cliente: «these does not work, does not receive any code».
--
-- Che cosa NON era rotto, verificato prima di scrivere una riga:
--   * `admin_conferma_codice` consegna il codice. Provata con una chiamata
--     diretta sulla richiesta TRC-O-2026-000005: ha risposto con un codice a
--     sei cifre, e la riga è stata marcata consegnata con l'analista che l'ha
--     letta;
--   * i fondi non restano bloccati: `prenotato_eur` (riscritta nel 0019)
--     calcola l'impegnato dalle richieste **non scadute**, quindi un cliente
--     con una richiesta morta vede già il disponibile giusto, anche se la
--     colonna `reserved_eur` è rimasta indietro.
--
-- Che cosa era rotto, e si vede dalla parte del cliente:
--
--   1. **dieci minuti.** Il codice lo comunica una persona. Fra il momento in
--      cui il cliente preme «Continua» e quello in cui un analista apre la
--      console passano quasi sempre più di dieci minuti, e la richiesta è già
--      morta. È il difetto principale, ed è il motivo per cui il codice «non
--      arriva mai»;
--   2. **una richiesta scaduta sparisce dalla console.** La tabella chiede solo
--      le «aperte» (`expires_at >= now()`). Quindi, nell'esatto momento in cui
--      il cliente dice «non ho ricevuto niente», qui non c'è più niente da
--      guardare: il pulsante sembra non funzionare, mentre invece il tempo era
--      finito;
--   3. **nessun modo di chiudere una richiesta prima della scadenza.** Il
--      cliente non riceve il codice, l'analista non può né rileggerlo né
--      liberarlo: deve solo aspettare. Con trenta minuti di finestra questa
--      attesa diventa il triplo.
--
-- Non si finge un servizio di posta che non c'è: quello resta il lavoro vero,
-- e finché non esiste il codice continua a passare da una persona.
-- ============================================================================

begin;

-- ============================================================================
-- 1. La finestra del codice: trenta minuti, non dieci
-- ============================================================================
-- Chi difende questa scelta: la sicurezza non viene dalla fretta. Vengono dai
-- cinque tentativi (`max_attempts`) e dal tetto di dieci richieste al giorno,
-- che restano identici. Dieci minuti non rendevano il codice più difficile da
-- indovinare: rendevano solo più probabile che il cliente restasse senza.
update traccia.settings
   set value = jsonb_set(value, '{minutes}', '30'::jsonb),
       updated_at = now()
 where key = 'transfer_otp';

-- Se la riga non c'era, la si crea con i valori di progetto.
insert into traccia.settings (key, value)
select 'transfer_otp', '{"minutes": 30, "max_attempts": 5, "max_al_giorno": 10}'::jsonb
 where not exists (select 1 from traccia.settings where key = 'transfer_otp');

-- ============================================================================
-- 2. Chiudere una richiesta a mano, prima che scada
-- ============================================================================
-- Il caso vero, quello che il cliente ha davanti: il codice è stato consegnato
-- e perso, oppure non è mai stato consegnato e l'analista se ne accorge tardi.
-- Fino a oggi l'unica uscita era aspettare la scadenza, con i soldi impegnati
-- fino ad allora. Ora si chiude la richiesta e il cliente ne dispone un'altra.
--
-- Non è un'azione contabile: la prenotazione non si sottrae a mano. `libera_
-- fondi` ricalcola da `prenotato_eur`, che è la sola fonte di verità — e la
-- richiesta appena annullata esce dal calcolo da sola.
create or replace function traccia.admin_rilascia_conferma(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  ch traccia.transfer_challenges;
  prima numeric;
  dopo numeric;
begin
  select * into ch from traccia.transfer_challenges where id = p_id for update;
  if ch.id is null then
    raise exception 'Conferma non trovata.' using errcode = '22023';
  end if;
  if ch.consumed_at is not null then
    raise exception 'Questa richiesta è già diventata il bonifico %: non c''è niente da rilasciare.',
      (select reference from traccia.bank_transfers where id = ch.transfer_id)
      using errcode = '22023';
  end if;
  if ch.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'stato', 'già chiusa', 'liberati_eur', 0);
  end if;

  prima := traccia.prenotato_eur(ch.user_id);

  update traccia.transfer_challenges set cancelled_at = now() where id = ch.id;
  perform traccia.libera_fondi(ch.user_id);

  dopo := traccia.prenotato_eur(ch.user_id);

  perform traccia.log_action(a, 'bonifico_conferma_rilasciata', ch.reference,
    'richiesta chiusa dall''analista · ' ||
    traccia.euro(greatest(prima - dopo, 0)) || ' tornati disponibili');

  return jsonb_build_object(
    'ok', true, 'stato', 'annullata',
    'liberati_eur', greatest(prima - dopo, 0),
    'cliente', (select name from traccia.users where id = ch.user_id),
    'disponibile_dopo', (select balance_eur - traccia.prenotato_eur(ch.user_id)
                           from traccia.users where id = ch.user_id));
end $fn$;

-- ============================================================================
-- 3. La lista dice anche quanto tempo resta
-- ============================================================================
-- Due campi in più, nessuno in meno, e nessuna modifica ai filtri: la sicurezza
-- della funzione non cambia.
--   * `minuti_rimasti`, perché una scadenza calcolata nel browser con l'orologio
--     del pc sbaglia di qualche minuto e può far credere che ci sia tempo;
--   * `consegna_entro`, l'istante oltre il quale consegnare non serve più —
--     tre quarti della finestra.
-- Il resto è identico al 0019.
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
             'email', c.email,
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
-- 4. Il rifiuto spiega cosa fare
-- ============================================================================
-- Il comportamento non cambia: un codice consegnato non si rilegge, e uno
-- scaduto non si consegna. Cambia il messaggio, perché chi lo legge deve
-- sapere subito quale dei due casi ha davanti e come uscirne. Il caso
-- «scaduto» deve portare alla funzione qui sopra, non a un vicolo cieco.
create or replace function traccia.admin_conferma_codice(
  p_token text, p_id uuid
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  ch traccia.transfer_challenges;
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
    raise exception 'Questa conferma è scaduta alle %: i dieci minuti di prima non bastavano a un passaggio fra persone, ed è il difetto che il 0022 corregge. Il cliente deve disporre un nuovo bonifico.',
      to_char(ch.expires_at, 'HH24:MI') using errcode = '22023';
  end if;
  if ch.consegnato_at is not null then
    raise exception 'Il codice di questa conferma è già stato consegnato il % da %. Non è possibile rileggerlo: se il cliente non lo ha ricevuto, chiudi la richiesta con «Rilascia» e fagli disporre di nuovo il bonifico.',
      to_char(ch.consegnato_at, 'DD/MM/YYYY HH24:MI'),
      (select name from traccia.users where id = ch.inviato_da) using errcode = '22023';
  end if;

  /* Il codice esce solo adesso e solo per questa chiamata: l'impronta resta,
     il codice no. Non c'è modo di rileggerlo dopo. */
  codice := traccia.genera_codice();
  update traccia.transfer_challenges
     set code_hash = traccia.hash_token(codice),
         consegnato_at = now(),
         inviato_da = a.id
   where id = ch.id;

  perform traccia.log_action(a, 'bonifico_conferma_consegnata', ch.reference,
    'codice comunicato a ' || ch.email);

  return jsonb_build_object(
    'ok', true,
    'id', ch.id,
    'reference', ch.reference,
    'codice', codice,
    'cliente', (select name from traccia.users where id = ch.user_id),
    'email', ch.email,
    'importo_eur', (ch.payload ->> 'importo')::numeric,
    'beneficiario', ch.payload ->> 'beneficiario',
    'scade_il', extract(epoch from ch.expires_at),
    'minuti_rimasti', greatest(0, ceil(extract(epoch from (ch.expires_at - now())) / 60)::int),
    'avviso', 'Comunica il codice al cliente adesso: non compare nel sito e non è più leggibile dopo questa schermata.');
end $fn$;

-- ============================================================================
-- 5. Il tetto giornaliero deve contarli tutti
-- ============================================================================
-- `used_today` legge solo `traccia.operations`. Un prelievo però nasce in due
-- modi: come operazione (la via vecchia, ancora raggiungibile) e come bonifico
-- (la via che il cliente usa). Il tetto vedeva metà delle uscite, e la metà che
-- non vedeva è quella vera: sul database di produzione `operations` ha zero
-- righe mentre i bonifici ci sono.
--
-- Oggi è mascherato — i limiti sono a 1e15 per tutti i livelli, quindi nessun
-- tetto morde — ma è esattamente il difetto che si riaccende il giorno in cui
-- quei numeri tornano realistici.
--
-- Restano fuori i bonifici `cancelled` e `rejected`: non sono uscite. `queued`,
-- `sent` ed `executed` sì: due bonifici disposti oggi valgono come spesi anche
-- se la banca li eseguirà domani, altrimenti basterebbe disporne dieci per
-- spostare il tetto.
create or replace function traccia.used_today(p_user uuid, p_type text)
returns numeric language sql security definer
set search_path = traccia, public, extensions as $$
  select case
    when p_type = 'withdrawal' then
      (select coalesce(sum(amount_eur), 0) from traccia.operations
        where user_id = p_user and type = p_type
          and status in ('pending', 'approved')
          and created_at >= date_trunc('day', now()))
      +
      (select coalesce(sum(amount_eur), 0) from traccia.bank_transfers
        where user_id = p_user and direction = 'out'
          and status in ('queued', 'sent', 'executed')
          and created_at >= date_trunc('day', now()))
    else
      (select coalesce(sum(amount_eur), 0) from traccia.operations
        where user_id = p_user and type = p_type
          and status in ('pending', 'approved')
          and created_at >= date_trunc('day', now()))
  end;
$$;

-- ============================================================================
-- 6. La superficie pubblica
-- ============================================================================
-- `traccia.*` non è un endpoint: il browser vede solo `public.*`. Chi dimentica
-- il wrapper crede di aver finito e invece il pulsante risponde «function not
-- found», che è il modo più efficace di sembrare un guasto.
create or replace function public.admin_rilascia_conferma(p_token text, p_id uuid)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_rilascia_conferma(p_token, p_id);
$f$;

revoke all on function public.admin_rilascia_conferma(text, uuid) from public;
revoke all on function traccia.admin_rilascia_conferma(text, uuid) from public, anon, authenticated;

grant execute on function public.admin_rilascia_conferma(text, uuid) to anon, authenticated;
grant execute on function public.admin_conferme_bonifico(text, text) to anon, authenticated;
grant execute on function public.admin_conferma_codice(text, uuid) to anon, authenticated;
grant execute on function public.scadi_conferme_bonifico(text) to anon, authenticated;

-- ============================================================================
-- 7. Controllo finale: la finestra è davvero più lunga
-- ============================================================================
do $$
declare
  m int;
begin
  select (value ->> 'minutes')::int into m from traccia.settings where key = 'transfer_otp';
  if m is null or m < 20 then
    raise exception 'La finestra del codice è %, ma doveva essere almeno 20: un passaggio fra persone non sta in dieci minuti.', m;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
