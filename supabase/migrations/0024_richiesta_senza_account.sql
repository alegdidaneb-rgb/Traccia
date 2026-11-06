/* ==========================================================================
   0024 — la richiesta di informazioni non crea un account
   ==========================================================================

   Il cliente: «when signaling a case remove create password they do not need
   to create account. Account will be created later».

   È giusto, e il modulo lo stava facendo male. Chiedeva una password a
   qualcuno che non aveva ancora parlato con nessuno: una password scelta in
   fretta, in un momento in cui la persona sta pensando ai soldi persi, per un
   accesso che non esiste ancora. E creava un account con quella password,
   senza dire chiaramente che l'account era in attesa.

   Da qui in avanti il modulo **non crea un account**: registra una richiesta.
   L'account lo crea un analista quando prende in carico la pratica, e la
   password la sceglie il cliente quando l'accesso gli serve — cioè quando ha
   qualcosa da caricare.

   Che cosa cambia:
     * `auth_register` non prende più `p_password` e scrive in
       `traccia.richieste`, non in `traccia.users`;
     * `richieste` è una tabella nuova, con i cinque dati del modulo, lo stato
       di lavorazione e il riferimento all'account quando nascerà;
     * `admin_richieste` e `admin_richiesta_stato` danno agli analisti
       l'elenco e i passaggi di stato, e `admin_crea_account_da_richiesta`
       crea l'account (senza password: la sceglierà il cliente);
     * `auth_login` non risponde più «email o password non corretti» a chi ha
       una richiesta in attesa e non ha ancora un account: quella frase manda
       la persona a cercare una password che non ha mai scelto.

   Perché una tabella nuova e non `users` con `password_hash` vuoto: la colonna
   è `not null`, e un account senza password è un account che qualcuno, prima o
   poi, farà entrare per sbaglio. Una richiesta e un account sono due cose
   diverse; il database deve dire la stessa cosa del sito.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Le richieste
   -------------------------------------------------------------------------- */
create table if not exists traccia.richieste (
  id             uuid primary key default extensions.gen_random_uuid(),
  first_name     text not null,
  last_name      text not null,
  email          text not null,
  phone          text not null,
  amount_eur     numeric(14, 2) not null,
  situation      text,
  message        text,
  -- da dove arriva: «login» (modulo grande) o «supporto» (modulo di contatto)
  origine        text not null default 'login',
  -- new → contacted → account → closed ; «denied» quando non è il nostro caso
  status         text not null default 'new'
                 check (status in ('new', 'contacted', 'account', 'closed', 'denied')),
  note           text,
  user_id        uuid references traccia.users (id) on delete set null,
  -- quando una persona di questo ufficio l'ha presa in carico: serve a sapere
  -- chi chiamare se la richiesta resta ferma
  taken_by       uuid references traccia.users (id) on delete set null,
  taken_at       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists richieste_status_idx on traccia.richieste (status);
create index if not exists richieste_created_idx on traccia.richieste (created_at desc);
-- una seconda richiesta con la stessa email aperta è quasi sempre un doppione
create unique index if not exists richieste_email_aperta_idx
  on traccia.richieste (lower(email))
  where status in ('new', 'contacted');

alter table traccia.richieste enable row level security;
revoke all on traccia.richieste from anon, authenticated;

comment on table traccia.richieste is
  'Richieste di informazioni dal sito. Non sono account: l''account nasce quando un analista prende in carico la pratica.';

/* --------------------------------------------------------------------------
   auth_register: registra una richiesta, non un account
   --------------------------------------------------------------------------
   La firma cambia ancora (via `p_password`, entra `p_situation`), quindi la
   vecchia va tolta da entrambi gli schemi: due versioni con lo stesso nome
   fanno scegliere a PostgREST quella sbagliata, e il guasto si vede solo in
   produzione.
   -------------------------------------------------------------------------- */
drop function if exists traccia.auth_register(text, text, text, text, text, text, numeric);
drop function if exists public.auth_register(text, text, text, text, text, text, numeric);

create or replace function traccia.auth_register(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_amount_eur numeric,
  p_situation  text default null,
  p_message    text default null,
  p_origine    text default 'login'
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail   text := lower(trim(coalesce(p_email, '')));
  nome   text := trim(coalesce(p_first_name, ''));
  cognome text := trim(coalesce(p_last_name, ''));
  tel    text := nullif(trim(coalesce(p_phone, '')), '');
  row_id uuid;
begin
  /* --- i cinque dati, nell'ordine in cui il modulo li chiede ----------- */
  /* Il messaggio dice quale campo manca, uno alla volta. «Compila i campi»
     davanti a sei caselle non dice dove guardare. */
  if length(nome) < 2 then
    raise exception 'Inserisci il nome.' using errcode = '22023';
  end if;
  if length(cognome) < 2 then
    raise exception 'Inserisci il cognome.' using errcode = '22023';
  end if;
  if mail = '' or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if tel is null then
    raise exception 'Inserisci un numero di telefono.' using errcode = '22023';
  end if;
  if not traccia.telefono_valido(tel) then
    raise exception 'Il numero di telefono non sembra valido: controlla le cifre.'
      using errcode = '22023';
  end if;
  if p_amount_eur is null or p_amount_eur <= 0 then
    raise exception 'Indica l''importo approssimativo che hai perso.'
      using errcode = '22023';
  end if;
  if p_amount_eur > 100000000 then
    raise exception 'L''importo indicato è troppo alto: controlla le cifre.'
      using errcode = '22023';
  end if;

  /* --- niente doppioni, e niente porta girevole ---------------------- */
  /* Tre richieste dalla stessa email in un'ora non sono tre clienti: sono un
     modulo premuto più volte o un errore. Si fermano qui, con una frase che
     dice cosa fare invece di un errore tecnico. */
  if exists (
    select 1 from traccia.richieste
    where lower(email) = mail and created_at > now() - interval '1 hour'
  ) then
    raise exception 'Abbiamo già ricevuto una richiesta con questa email: ti ricontattiamo noi. Se hai urgenza, scrivi a assistenza@traccia.it.com.'
      using errcode = '22023';
  end if;

  insert into traccia.richieste
    (first_name, last_name, email, phone, amount_eur, situation, message, origine)
  values
    (nome, cognome, mail, tel, round(p_amount_eur, 2),
     nullif(trim(coalesce(p_situation, '')), ''),
     nullif(trim(coalesce(p_message, '')), ''),
     coalesce(nullif(trim(coalesce(p_origine, '')), ''), 'login'))
  returning id into row_id;

  insert into traccia.audit (actor_email, action, target, note)
  values (mail, 'richiesta', row_id::text, 'Richiesta di informazioni dal sito');

  return jsonb_build_object(
    'ok', true,
    'richiesta', row_id,
    'message', 'Richiesta ricevuta. Ti ricontattiamo entro 48 ore lavorative al numero che ci hai indicato.'
  );
end $$;

revoke all on function traccia.auth_register(text, text, text, text, numeric, text, text, text) from public;
grant execute on function traccia.auth_register(text, text, text, text, numeric, text, text, text)
  to anon, authenticated;

create or replace function public.auth_register(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_amount_eur numeric,
  p_situation  text default null,
  p_message    text default null,
  p_origine    text default 'login'
)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_register(
         p_first_name, p_last_name, p_email, p_phone, p_amount_eur,
         p_situation, p_message, p_origine
       ); $f$;
revoke all on function public.auth_register(text, text, text, text, numeric, text, text, text) from public;
grant execute on function public.auth_register(text, text, text, text, numeric, text, text, text)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   L'accesso, per chi ha una richiesta e non ancora un account
   --------------------------------------------------------------------------
   Oggi, chi ha scritto dal modulo e poi prova ad accedere, si sente rispondere
   «Email o password non corretti»: una password non l'ha mai scelta, e quella
   frase lo manda a cercare un errore che non ha commesso. La risposta giusta
   dice cosa sta succedendo e cosa aspettarsi.
   -------------------------------------------------------------------------- */
create or replace function traccia.auth_login_impl(
  p_email text, p_password text, p_ip inet default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
  tok text;
  mail text := lower(trim(coalesce(p_email, '')));
  falliti int;
  massimo int := 5;
  finestra interval := interval '15 minutes';
  richiesta_di timestamptz;
begin
  select count(*) into falliti
  from traccia.login_attempts
  where lower(email) = mail and not ok and created_at > now() - finestra;

  if falliti >= massimo then
    return jsonb_build_object('ok', false, 'error',
      'Troppi tentativi di accesso. Riprova tra qualche minuto.');
  end if;

  select * into u from traccia.users where lower(email) = mail limit 1;

  if u.id is null then
    /* niente account: se c'è una richiesta, si dice quello */
    select max(created_at) into richiesta_di
    from traccia.richieste where lower(email) = mail;

    if richiesta_di is not null then
      return jsonb_build_object('ok', false, 'error',
        'La tua richiesta è arrivata e la stiamo esaminando: non serve una password per ora. '
        'Ti ricontattiamo entro 48 ore lavorative al numero che ci hai indicato.');
    end if;
    insert into traccia.login_attempts (email, ip, ok) values (mail, p_ip, false);
    return jsonb_build_object('ok', false, 'error', 'Email o password non corretti.');
  end if;

  if u.password_hash is null or u.password_hash = ''
     or u.password_hash <> extensions.crypt(p_password, u.password_hash) then
    insert into traccia.login_attempts (email, ip, ok) values (mail, p_ip, false);
    return jsonb_build_object('ok', false, 'error', 'Email o password non corretti.');
  end if;

  if u.status in ('pending', 'denied', 'suspended') then
    return jsonb_build_object('ok', false, 'error', case u.status
      when 'pending' then 'Pratica in attesa di essere presa in carico. Ti ricontattiamo noi: non serve una password per ora.'
      when 'denied' then 'Richiesta non accettata. Scrivi a assistenza@traccia.it.com.'
      else 'Account sospeso. Contatta assistenza@traccia.it.com.' end);
  end if;

  insert into traccia.login_attempts (email, ip, ok) values (mail, p_ip, true);

  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into traccia.sessions (token_hash, user_id, expires_at, role)
  values (traccia.hash_token(tok), u.id, now() + interval '30 days', 'user');

  update traccia.users set last_login_at = now() where id = u.id;
  perform traccia.log_action(u, 'login', u.email, null);

  delete from traccia.login_attempts where created_at < now() - interval '7 days';

  return jsonb_build_object('ok', true, 'token', tok, 'user', traccia.user_json(u));
end $$;

/* --------------------------------------------------------------------------
   La console: le richieste da lavorare
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
      'name', r.first_name || ' ' || r.last_name,
      'email', r.email, 'phone', r.phone,
      'amount_eur', r.amount_eur,
      'situation', r.situation, 'message', r.message,
      'origine', r.origine, 'status', r.status, 'note', r.note,
      'user_id', r.user_id,
      'taken_by_name', (select u.name from traccia.users u where u.id = r.taken_by),
      'taken_at', extract(epoch from r.taken_at),
      'created_at', extract(epoch from r.created_at)
    ) order by r.created_at desc), '[]'::jsonb)
  into res
  from traccia.richieste r
  where p_status is null or r.status = p_status;
  return jsonb_build_object(
    'richieste', res,
    'new_count', (select count(*) from traccia.richieste where status = 'new'));
end $$;
revoke all on function traccia.admin_richieste(text, text) from public;
grant execute on function traccia.admin_richieste(text, text) to anon, authenticated;

create or replace function public.admin_richieste(p_token text, p_status text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_richieste(p_token, p_status); $f$;
revoke all on function public.admin_richieste(text, text) from public;
grant execute on function public.admin_richieste(text, text) to anon, authenticated;

create or replace function traccia.admin_richiesta_stato(
  p_token text, p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  r traccia.richieste;
begin
  if p_status not in ('new','contacted','account','closed','denied') then
    raise exception 'Stato non valido.' using errcode = '22023';
  end if;
  select * into r from traccia.richieste where id = p_id;
  if r.id is null then
    raise exception 'Richiesta non trovata.' using errcode = '22023';
  end if;

  update traccia.richieste
  set status = p_status,
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
      taken_by = coalesce(taken_by, a.id),
      taken_at = coalesce(taken_at, now()),
      updated_at = now()
  where id = p_id;

  perform traccia.log_action(a, 'richiesta_' || p_status, r.email, p_note);
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
revoke all on function traccia.admin_richiesta_stato(text, uuid, text, text) from public;
grant execute on function traccia.admin_richiesta_stato(text, uuid, text, text) to anon, authenticated;

create or replace function public.admin_richiesta_stato(
  p_token text, p_id uuid, p_status text, p_note text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_richiesta_stato(p_token, p_id, p_status, p_note); $f$;
revoke all on function public.admin_richiesta_stato(text, uuid, text, text) from public;
grant execute on function public.admin_richiesta_stato(text, uuid, text, text) to anon, authenticated;

/* --------------------------------------------------------------------------
   Dalla richiesta all'account
   --------------------------------------------------------------------------
   Lo fa un analista, quando ha parlato con la persona e la pratica ha senso.
   L'account nasce `active` ma **senza password**: la colonna è `not null`, e
   una password provvisoria scritta da noi è una password che circola in una
   chat o in un'email. Finché non c'è una strada per farla scegliere al
   cliente, l'account resta senza accesso e la pratica si lavora al telefono:
   è la scelta esplicita del committente («account will be created later»).
   -------------------------------------------------------------------------- */
create or replace function traccia.admin_crea_account_da_richiesta(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  r traccia.richieste;
  nuovo uuid;
begin
  select * into r from traccia.richieste where id = p_id;
  if r.id is null then
    raise exception 'Richiesta non trovata.' using errcode = '22023';
  end if;
  if r.user_id is not null then
    raise exception 'Questa richiesta ha già un account.' using errcode = '22023';
  end if;
  if exists (select 1 from traccia.users where lower(email) = lower(r.email)) then
    raise exception 'Esiste già un account con questa email.' using errcode = '23505';
  end if;

  insert into traccia.users (
    email, password_hash, name, first_name, last_name, phone,
    case_amount_eur, role, status, kyc_level, iban
  ) values (
    lower(r.email), '', r.first_name || ' ' || r.last_name, r.first_name, r.last_name,
    r.phone, r.amount_eur, 'user', 'active', 1, traccia.make_iban()
  ) returning id into nuovo;

  update traccia.richieste
  set user_id = nuovo, status = 'account', taken_by = coalesce(taken_by, a.id),
      taken_at = coalesce(taken_at, now()), updated_at = now()
  where id = p_id;

  perform traccia.log_action(a, 'account_da_richiesta', lower(r.email), null);
  return jsonb_build_object('ok', true, 'user_id', nuovo);
end $$;
revoke all on function traccia.admin_crea_account_da_richiesta(text, uuid) from public;
grant execute on function traccia.admin_crea_account_da_richiesta(text, uuid) to anon, authenticated;

create or replace function public.admin_crea_account_da_richiesta(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_crea_account_da_richiesta(p_token, p_id); $f$;
revoke all on function public.admin_crea_account_da_richiesta(text, uuid) from public;
grant execute on function public.admin_crea_account_da_richiesta(text, uuid) to anon, authenticated;

/* --------------------------------------------------------------------------
   Le richieste vecchie: chi si è registrato prima di questa migrazione ha già
   un account, quindi non va ricopiato qui. Ma `users` conserva tutto: le due
   tabelle raccontano due cose diverse e nessuna delle due perde dati.
   -------------------------------------------------------------------------- */
