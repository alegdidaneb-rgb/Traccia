/* ==========================================================================
   0027 — la via veloce: solo il numero di telefono
   ==========================================================================

   Il cliente: «I NEED LEAD GENERATION NOTHING ELSE».

   Il modulo chiede sei dati — nome, cognome, email, telefono, importo perso,
   tipo di truffa — e sono i sei che il cliente ha chiesto per nome, due volte.
   Non si tolgono: sono quelli che permettono all'analista di sapere, prima di
   comporre il numero, di che ordine di grandezza è il caso e in che lingua
   parlare.

   Il problema non è quali campi, è **quanti prima di aver parlato**. A freddo,
   su un annuncio, chiedere «quanto hai perso» a uno sconosciuto costa circa
   l'11% di compilazioni per campo (HubSpot, 3 campi ≈ 25%, 6 campi ≈ 15%).
   Con 24 $ di budget quella differenza è tutto: 0–2 segnalazioni invece di
   5–8.

   Quindi due porte, stesso database:

     * **la porta completa** (`auth_register`): i sei campi, come sono sempre
       stati. Resta intatta, ed è quella che il sito mostra a chi arriva dalle
       pagine interne o dal passaparola;
     * **la porta veloce** (`richiesta_telefono`): **un campo**. Il numero, e
       basta. Nome, email, importo e tipo di truffa li prende l'analista
       durante la chiamata — che è dove li avrebbe presi comunque, solo con
       una persona che risponde invece di un modulo che spaventa.

   Perché una funzione nuova e non un parametro: `auth_register` ha sei
   parametri obbligatori e un messaggio d'errore per ognuno. Aggiungerle un
   settimo che dice «salta i controlli» significa che un giorno qualcuno lo
   passerà dal modulo completo. Due funzioni, due promesse.

   --------------------------------------------------------------------------
   COSA DIVENTA FACOLTATIVO, E COSA NO
   --------------------------------------------------------------------------
   Le colonne `first_name`, `last_name`, `email`, `amount_eur` perdono il
   `not null`: una richiesta che arriva da un annuncio con il solo telefono è
   una richiesta valida, e il database deve poterla rappresentare. Il
   `not null` resta sul telefono, che è l'unico dato senza cui non si può fare
   niente.

   L'indice unico su `lower(email)` continua a funzionare: in Postgres i NULL
   non sono mai uguali fra loro, quindi diecimila richieste senza email non
   collidono. Il doppione si controlla sul **telefono**, che nella via veloce
   è l'identità.

   --------------------------------------------------------------------------
   COME SI APPLICA
     supabase db push
   ========================================================================== */

/* --------------------------------------------------------------------------
   Le colonne che diventano facoltative
   --------------------------------------------------------------------------
   `drop not null` è idempotente: rieseguirla non fa niente. I dati esistenti
   non si toccano, e una riga vecchia resta completa.
   -------------------------------------------------------------------------- */
alter table traccia.richieste alter column first_name drop not null;
alter table traccia.richieste alter column last_name  drop not null;
alter table traccia.richieste alter column email      drop not null;
alter table traccia.richieste alter column amount_eur drop not null;

comment on column traccia.richieste.email is
  'Facoltativa: le richieste dalla via veloce hanno solo il telefono. L''analista la chiede al telefono.';

/* Il doppione sulla via veloce si misura sul telefono: due pressioni dello
   stesso pulsante in un''ora non sono due clienti. */
create index if not exists richieste_phone_idx
  on traccia.richieste (phone)
  where status in ('new', 'contacted');

/* --------------------------------------------------------------------------
   La via veloce
   --------------------------------------------------------------------------
   Accetta il numero e, se ci sono, il nome e il tipo di truffa: il modulo
   veloce li manda vuoti, ma la funzione è la stessa se un domani una pagina
   vorrà chiederne uno in più.
   -------------------------------------------------------------------------- */
create or replace function traccia.richiesta_telefono(
  p_phone     text,
  p_nome      text default null,
  p_situation text default null,
  p_origine   text default 'annuncio'
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  tel   text := nullif(trim(coalesce(p_phone, '')), '');
  nome  text := nullif(trim(coalesce(p_nome, '')), '');
  riga  uuid;
begin
  if tel is null then
    raise exception 'Inserisci il tuo numero di telefono.' using errcode = '22023';
  end if;
  if not traccia.telefono_valido(tel) then
    raise exception 'Il numero non sembra valido: controlla le cifre.'
      using errcode = '22023';
  end if;

  /* Doppio clic o doppio invio: non è un errore, è lo stesso cliente. Si
     risponde «ricevuta» e non si crea una seconda riga — altrimenti la
     console mostra due lead e qualcuno chiama due volte la stessa persona. */
  if exists (
    select 1 from traccia.richieste r
    where r.phone = tel
      and r.status in ('new', 'contacted')
      and r.created_at > now() - interval '1 hour'
  ) then
    return jsonb_build_object(
      'ok', true,
      'gia_ricevuta', true,
      'message', 'Abbiamo già la tua richiesta: ti chiamiamo noi.');
  end if;

  /* `first_name` e `last_name` restano NULL: il nome lo scrive l''analista
     durante la chiamata, e inventarne uno ("Cliente") riempirebbe la console
     di nomi falsi che poi nessuno corregge. */
  insert into traccia.richieste (first_name, last_name, email, phone, amount_eur,
                                 situation, origine, message)
  values (nome, null, null, tel, null,
          nullif(trim(coalesce(p_situation, '')), ''),
          coalesce(nullif(trim(coalesce(p_origine, '')), ''), 'annuncio'),
          'Richiesta dalla via veloce: solo il numero.')
  returning id into riga;

  insert into traccia.audit (actor_email, action, target, note)
  values (coalesce(nome, 'via veloce'), 'richiesta', riga::text,
          'Segnalazione dal modulo veloce (solo telefono)');

  return jsonb_build_object(
    'ok', true,
    'richiesta', riga,
    'message', 'Ricevuto. Ti chiamiamo entro 48 ore lavorative.');
end $$;

revoke all on function traccia.richiesta_telefono(text, text, text, text) from public;
grant execute on function traccia.richiesta_telefono(text, text, text, text)
  to anon, authenticated;

create or replace function public.richiesta_telefono(
  p_phone     text,
  p_nome      text default null,
  p_situation text default null,
  p_origine   text default 'annuncio'
)
returns jsonb language sql security definer
set search_path = traccia, extensions
as $f$ select traccia.richiesta_telefono(p_phone, p_nome, p_situation, p_origine); $f$;
revoke all on function public.richiesta_telefono(text, text, text, text) from public;
grant execute on function public.richiesta_telefono(text, text, text, text)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   Il foglio deve avere il nome, non una cella vuota
   --------------------------------------------------------------------------
   `leads_per_foglio` costruiva `nome` come `first_name || ' ' || last_name`:
   con NULL il risultato è NULL, e il foglio mostrava una riga senza nome anche
   quando il nome c'era (misurato il 2026-11-11, con una richiesta vera che
   conteneva il nome). Stessa costruzione tollerante della console.
   -------------------------------------------------------------------------- */
create or replace function traccia.leads_per_foglio(
  p_segreto text,
  p_dopo    timestamptz default null,
  p_limite  int default 100
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  atteso text;
  res    jsonb;
  adesso timestamptz := now();
  n      int := least(greatest(coalesce(p_limite, 100), 1), 500);
begin
  select value #>> '{}' into atteso from traccia.settings where key = 'foglio_segreto';
  if atteso is null or atteso = '' then
    raise exception 'Il foglio non e'' ancora configurato.' using errcode = '42501';
  end if;
  if p_segreto is null or p_segreto <> atteso then
    raise exception 'Segreto non valido.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(riga order by ordine), '[]'::jsonb) into res
  from (
    select r.created_at as ordine,
      jsonb_build_object(
        'id', r.id,
        'creata', r.created_at,
        'nome', coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' ||
                                     coalesce(r.last_name, '')), ''),
                         'Telefono in attesa'),
        'telefono', r.phone,
        'email', r.email,
        'importo', r.amount_eur,
        'tipo', coalesce(r.situation, ''),
        'origine', coalesce(r.origine, ''),
        'stato', r.status,
        'in_carico_a', coalesce((select u.name from traccia.users u where u.id = r.taken_by), ''),
        'note', coalesce(r.note, '')
      ) as riga
    from traccia.richieste r
    where p_dopo is null or r.created_at > p_dopo
    order by r.created_at desc
    limit n
  ) s;

  return jsonb_build_object(
    'righe', res,
    'ultima', coalesce(
      (select max(r.created_at) from traccia.richieste r
       where p_dopo is null or r.created_at > p_dopo),
      adesso),
    'letto_il', adesso);
end $$;
revoke all on function traccia.leads_per_foglio(text, timestamptz, int) from public;
grant execute on function traccia.leads_per_foglio(text, timestamptz, int) to anon, authenticated;

create or replace function public.leads_per_foglio(
  p_segreto text,
  p_dopo    timestamptz default null,
  p_limite  int default 100
)
returns jsonb language sql security definer
set search_path = traccia, extensions
as $f$ select traccia.leads_per_foglio(p_segreto, p_dopo, p_limite); $f$;
revoke all on function public.leads_per_foglio(text, timestamptz, int) from public;
grant execute on function public.leads_per_foglio(text, timestamptz, int) to anon, authenticated;

/* --------------------------------------------------------------------------
   La console deve saper mostrare una riga senza nome
   --------------------------------------------------------------------------
   `admin_richieste` costruiva `name` come `first_name || ' ' || last_name`:
   con NULL il risultato è NULL, e la tabella mostrava una riga vuota dove
   c'è una persona con un numero di telefono. Da oggi quella riga si legge
   «Telefono in attesa» — che è la verità: nessuno l'ha ancora chiamata.
   -------------------------------------------------------------------------- */
create or replace function traccia.admin_richieste(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'first_name', r.first_name, 'last_name', r.last_name,
      'name', coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' ||
                                   coalesce(r.last_name, '')), ''), 'Telefono in attesa'),
      'email', r.email, 'phone', r.phone,
      'amount_eur', r.amount_eur,
      'situation', r.situation, 'message', r.message,
      'origine', r.origine, 'status', r.status, 'note', r.note,
      'user_id', r.user_id,
      'taken_by', r.taken_by,
      'taken_by_name', (select u.name from traccia.users u where u.id = r.taken_by),
      'mio', (r.taken_by = a.id),
      'taken_at', extract(epoch from r.taken_at),
      'created_at', extract(epoch from r.created_at))
      order by r.taken_by nulls first, r.created_at desc), '[]'::jsonb)
  into res
  from traccia.richieste r
  where p_status is null or r.status = p_status;
  return jsonb_build_object(
    'richieste', res,
    'new_count', (select count(*) from traccia.richieste where status = 'new'),
    'libere', (select count(*) from traccia.richieste
               where status = 'new' and taken_by is null),
    'mie', (select count(*) from traccia.richieste
            where taken_by = a.id and status in ('new', 'contacted', 'account')));
end $$;
revoke all on function traccia.admin_richieste(text, text) from public;
grant execute on function traccia.admin_richieste(text, text) to anon, authenticated;
