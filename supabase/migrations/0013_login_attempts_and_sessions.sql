-- 0013_login_attempts_and_sessions.sql
-- Freno ai tentativi di accesso e chiusura delle sessioni.
--
-- Prima di questa migrazione si potevano provare password illimitate: nessun
-- contatore, nessun ritardo, nessuna traccia. E una sessione aperta restava
-- valida fino alla scadenza dei 30 giorni, anche dopo un cambio password.
--
-- Quello che aggiunge:
--
--   * `login_attempts`         → un record per tentativo, riuscito o no;
--   * blocco dopo 5 errori in 15 minuti sulla stessa email;
--   * `auth_logout_all`        → il cliente chiude tutte le sue sessioni;
--   * `admin_revoke_sessions`  → l'analista chiude le sessioni di un cliente;
--   * `sessions.revoked_at`    → una sessione chiusa non vale più, ovunque.
--
-- Nota di implementazione importante: `auth_login` NON solleva eccezioni.
-- Un'eccezione annulla la transazione, quindi anche l'INSERT del tentativo
-- fallito verrebbe perso e il contatore non salirebbe mai. Gli errori di
-- accesso tornano come dati: `{ok: false, error: '...'}`.
--
-- Dipende da: 0002 (users/sessions/need_admin), 0001 (audit).

begin;

-- ------------------------------------------------------- tentativi falliti ---
create table if not exists traccia.login_attempts (
  id         bigserial primary key,
  email      text not null,
  ip         inet,
  ok         boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_email_idx
  on traccia.login_attempts (lower(email), created_at desc);

alter table traccia.login_attempts enable row level security;
revoke all on traccia.login_attempts from anon, authenticated;

-- -------------------------------------------------------- stato sessione ---
alter table traccia.sessions add column if not exists role text not null default 'user';
alter table traccia.sessions add column if not exists acting_user_id uuid
  references traccia.users(id) on delete cascade;
alter table traccia.sessions add column if not exists revoked_at timestamptz;

create index if not exists sessions_user_idx on traccia.sessions (user_id);

-- ------------------------------------------------------------ auth_user ----
-- Il punto in cui tutte le funzioni autenticate verificano il gettone:
-- qui la revoca diventa efficace ovunque, non solo nel login.
create or replace function traccia.auth_user(p_token text)
returns traccia.users language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select us.* into u
  from traccia.sessions s
  join traccia.users us on us.id = s.user_id
  where s.token_hash = traccia.hash_token(p_token)
    and s.expires_at > now()
    and s.revoked_at is null          /* sessione chiusa: non vale più */
  limit 1;
  return u;
end $$;

-- ------------------------------------------------------------ auth_me ------
create or replace function traccia.auth_me(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
  sess_role text;
  sess_expires timestamptz;
  sess_actor uuid;
  actor_email text;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Sessione non valida o scaduta.' using errcode = '28000';
  end if;

  select s.role, s.expires_at, s.acting_user_id
    into sess_role, sess_expires, sess_actor
  from traccia.sessions s
  where s.token_hash = traccia.hash_token(p_token)
    and s.expires_at > now()
    and s.revoked_at is null
  limit 1;

  if sess_role is null then
    raise exception 'Sessione non valida o scaduta.' using errcode = '28000';
  end if;

  u := traccia.auth_user(p_token);
  if u.id is null then
    raise exception 'Sessione non valida o scaduta.' using errcode = '28000';
  end if;

  if sess_role = 'staff' then
    select email into actor_email from traccia.users where id = sess_actor;
  end if;

  return jsonb_build_object(
    'user', traccia.user_json(u),
    'viewer_role', sess_role,
    'read_only', sess_role = 'staff',
    'acting_as', actor_email,
    'expires_at', extract(epoch from sess_expires));
end $$;

-- ------------------------------------------------------------ auth_login ---
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
begin
  /* Freno ai tentativi a ripetizione. Il tentativo va scritto PRIMA di
     decidere: sollevando un'eccezione l'INSERT verrebbe annullato insieme
     alla transazione e il contatore non salirebbe mai. */
  select count(*) into falliti
  from traccia.login_attempts
  where lower(email) = mail and not ok and created_at > now() - finestra;

  if falliti >= massimo then
    return jsonb_build_object('ok', false, 'error',
      'Troppi tentativi di accesso. Riprova tra qualche minuto.');
  end if;

  select * into u from traccia.users where lower(email) = mail limit 1;

  if u.id is null or u.password_hash <> extensions.crypt(p_password, u.password_hash) then
    insert into traccia.login_attempts (email, ip, ok) values (mail, p_ip, false);
    return jsonb_build_object('ok', false, 'error', 'Email o password non corretti.');
  end if;

  if u.status in ('pending', 'denied', 'suspended') then
    /* la password è giusta: non è un tentativo di intrusione, non conta */
    return jsonb_build_object('ok', false, 'error', case u.status
      when 'pending' then 'Account in attesa di approvazione. Ti scriviamo appena è attivo.'
      when 'denied' then 'Richiesta non accettata. Scrivi a assistenza@traccia.it.'
      else 'Account sospeso. Contatta assistenza@traccia.it.' end);
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

create or replace function traccia.auth_login(p_email text, p_password text)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.auth_login_impl(p_email, p_password, null);
$$;

-- --------------------------------------------------------------- logout ----
create or replace function traccia.auth_logout(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  n int;
begin
  update traccia.sessions set revoked_at = now()
  where token_hash = traccia.hash_token(coalesce(p_token, '')) and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'closed', n);
end $$;

create or replace function traccia.auth_logout_all_impl(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  n int;
begin
  update traccia.sessions set revoked_at = now()
  where user_id = u.id and revoked_at is null;
  get diagnostics n = row_count;
  perform traccia.log_action(u, 'sessions_revoked', u.email, n || ' sessioni chiuse');
  return jsonb_build_object('ok', true, 'closed', n);
end $$;

create or replace function traccia.auth_logout_all(p_token text)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.auth_logout_all_impl(p_token);
$$;

-- ------------------------------------------------- chiusura da parte staff ---
create or replace function traccia.admin_revoke_sessions(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
  n int;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi agire sull''account master.' using errcode = '42501';
  end if;
  update traccia.sessions set revoked_at = now()
  where user_id = t.id and revoked_at is null;
  get diagnostics n = row_count;
  perform traccia.log_action(a, 'sessions_revoked_admin', t.email, n || ' sessioni chiuse');
  return jsonb_build_object('ok', true, 'closed', n);
end $$;

-- --------------------------------------------------------- permessi RPC ----
revoke all on function traccia.auth_login_impl(text, text, inet) from public;
revoke all on function traccia.auth_logout_all_impl(text) from public;
revoke all on function traccia.auth_logout_all(text) from public;
revoke all on function traccia.auth_logout(text) from public;
revoke all on function traccia.admin_revoke_sessions(text, uuid) from public;

grant execute on function traccia.auth_login_impl(text, text, inet) to anon, authenticated;
grant execute on function traccia.auth_logout_all(text) to anon, authenticated;
grant execute on function traccia.auth_logout(text) to anon, authenticated;
grant execute on function traccia.admin_revoke_sessions(text, uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
