-- ============================================================================
-- TRACCIA — autenticazione e helper
-- token di sessione casuale (32 byte), salvato solo come hash sha256.
-- ============================================================================

-- --------------------------------------------------------------- helper -----
create or replace function traccia.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists users_touch on traccia.users;
create trigger users_touch before update on traccia.users
for each row execute function traccia.set_updated_at();

-- hash del token: nel db non entra mai il token in chiaro
create or replace function traccia.hash_token(p_token text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- utente corrente dal token; null se scaduto o inesistente
create or replace function traccia.auth_user(p_token text)
returns traccia.users language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
begin
  if p_token is null or length(p_token) < 20 then
    return null;
  end if;
  select us.* into u
  from traccia.sessions s
  join traccia.users us on us.id = s.user_id
  where s.token_hash = traccia.hash_token(p_token)
    and s.expires_at > now()
  limit 1;
  return u;
end $$;

-- utente autenticato obbligatorio
create or replace function traccia.need_user(p_token text)
returns traccia.users language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
begin
  u := traccia.auth_user(p_token);
  if u.id is null then
    raise exception 'Sessione non valida o scaduta.' using errcode = '28000';
  end if;
  if u.status = 'suspended' then
    raise exception 'Account sospeso. Contatta assistenza@traccia.it.' using errcode = '28000';
  end if;
  return u;
end $$;

-- amministratore obbligatorio
create or replace function traccia.need_admin(p_token text)
returns traccia.users language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
begin
  u := traccia.need_user(p_token);
  if u.role <> 'admin' then
    raise exception 'Area riservata agli amministratori.' using errcode = '42501';
  end if;
  return u;
end $$;

-- rappresentazione pubblica dell'utente (mai password_hash)
create or replace function traccia.user_json(u traccia.users)
returns jsonb language sql security definer set search_path = traccia, public, extensions as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'name', u.name,
    'role', u.role,
    'is_master', u.is_master,
    'status', u.status,
    'kyc_level', u.kyc_level,
    'kyc_label', case u.kyc_level
                    when 3 then 'Completa — identità, residenza e fondi verificati'
                    when 2 then 'Avanzata — residenza e fonte dei fondi'
                    else 'Base — documento d''identità' end,
    'balance_eur', u.balance_eur,
    'iban', u.iban,
    'iban_formatted', regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g'),
    'case_ref', u.case_ref,
    'case_amount_eur', u.case_amount_eur,
    'case_phase', u.case_phase,
    'created_at', extract(epoch from u.created_at),
    'last_login_at', extract(epoch from u.last_login_at)
  );
$$;

-- audit
create or replace function traccia.log_action(
  p_actor traccia.users, p_action text, p_target text default null, p_note text default null
) returns void language sql security definer set search_path = traccia, public, extensions as $$
  insert into traccia.audit (actor_id, actor_email, action, target, note)
  values (p_actor.id, p_actor.email, p_action, p_target, p_note);
$$;

-- IBAN italiano verosimile (CIN + checksum modulo 97)
create or replace function traccia.make_iban()
returns text language plpgsql volatile
set search_path = traccia, public, extensions as $$
declare
  odd int[] := array[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
  abi text;
  seq text := '';
  body text;
  total int := 0;
  ch text;
  i int;
  numeric_part text := '';
  bban text;
  check_digits int;
begin
  abi := (array['01005','02008','03069','03032','05034','03104','03669','07601','08327','03475'])
         [1 + floor(random() * 10)];
  for i in 1..17 loop
    seq := seq || floor(random() * 10)::int::text;
  end loop;
  body := abi || seq;   -- 22 caratteri: ABI(5) + CAB(5) + conto(12)

  -- CIN: si calcola su TUTTO il corpo (lettere e cifre), non solo sulle cifre
  for i in 1..length(body) loop
    ch := substr(body, i, 1);
    if (i % 2) = 1 then total := total + odd[ascii(ch) - ascii('0') + 1];
    else total := total + (ascii(ch) - ascii('0'));
    end if;
  end loop;
  bban := chr(65 + (total % 26)) || body;

  -- lettere -> numeri (A=10 ... Z=35) per il modulo 97
  for i in 1..length(bban) loop
    ch := substr(bban, i, 1);
    if ch ~ '[A-Z]' then numeric_part := numeric_part || (ascii(ch) - 55)::text;
    else numeric_part := numeric_part || ch;
    end if;
  end loop;
  numeric_part := numeric_part || (ascii('I') - 55)::text || (ascii('T') - 55)::text || '00';
  check_digits := 98 - (mod(numeric_part::numeric, 97))::int;
  return 'IT' || lpad(check_digits::text, 2, '0') || bban;
end $$;

-- ------------------------------------------------------------- autenticazione
create or replace function traccia.auth_login(p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users;
  tok text;
begin
  select * into u from traccia.users
  where lower(email) = lower(trim(p_email)) limit 1;

  if u.id is null or u.password_hash <> crypt(p_password, u.password_hash) then
    raise exception 'Email o password non corretti.' using errcode = '28P01';
  end if;
  if u.status = 'pending' then
    raise exception 'Account in attesa di approvazione. Ti scriviamo appena è attivo.' using errcode = '28000';
  end if;
  if u.status = 'denied' then
    raise exception 'Richiesta non accettata. Scrivi a assistenza@traccia.it.' using errcode = '28000';
  end if;
  if u.status = 'suspended' then
    raise exception 'Account sospeso. Contatta assistenza@traccia.it.' using errcode = '28000';
  end if;

  tok := encode(gen_random_bytes(32), 'hex');
  insert into traccia.sessions (token_hash, user_id, expires_at)
  values (traccia.hash_token(tok), u.id, now() + interval '30 days');

  update traccia.users set last_login_at = now() where id = u.id;
  perform traccia.log_action(u, 'login', u.email, null);

  return jsonb_build_object('token', tok, 'user', traccia.user_json(u));
end $$;

create or replace function traccia.auth_register(p_name text, p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  mail text := lower(trim(p_email));
begin
  if mail is null or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'La password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Inserisci nome e cognome.' using errcode = '22023';
  end if;
  if exists (select 1 from traccia.users where lower(email) = mail) then
    raise exception 'Esiste già un account con questa email.' using errcode = '23505';
  end if;

  insert into traccia.users (email, password_hash, name, role, status, kyc_level, iban)
  values (mail, crypt(p_password, gen_salt('bf', 10)), trim(p_name), 'user', 'pending', 1,
          traccia.make_iban());

  insert into traccia.audit (actor_email, action, target, note)
  values (mail, 'register', mail, 'Richiesta di apertura pratica');

  return jsonb_build_object('ok', true,
    'message', 'Richiesta inviata: l''account è in attesa di approvazione.');
end $$;

create or replace function traccia.auth_logout(p_token text)
returns jsonb language plpgsql security definer set search_path = traccia, public, extensions as $$
begin
  delete from traccia.sessions where token_hash = traccia.hash_token(p_token);
  return jsonb_build_object('ok', true);
end $$;

create or replace function traccia.auth_me(p_token text)
returns jsonb language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
begin
  return jsonb_build_object('user', traccia.user_json(u));
end $$;

create or replace function traccia.auth_change_password(p_token text, p_current text, p_new text)
returns jsonb language plpgsql security definer set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
begin
  if u.password_hash <> crypt(p_current, u.password_hash) then
    raise exception 'La password attuale non è corretta.' using errcode = '28P01';
  end if;
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'La nuova password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;
  update traccia.users set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  delete from traccia.sessions where user_id = u.id and token_hash <> traccia.hash_token(p_token);
  perform traccia.log_action(u, 'password_change', u.email, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permessi ---
revoke all on function traccia.auth_login(text, text) from public;
revoke all on function traccia.auth_register(text, text, text) from public;
revoke all on function traccia.auth_logout(text) from public;
revoke all on function traccia.auth_me(text) from public;
revoke all on function traccia.auth_change_password(text, text, text) from public;
revoke all on function traccia.auth_user(text) from public;

grant execute on function traccia.auth_login(text, text) to anon, authenticated;
grant execute on function traccia.auth_register(text, text, text) to anon, authenticated;
grant execute on function traccia.auth_logout(text) to anon, authenticated;
grant execute on function traccia.auth_me(text) to anon, authenticated;
grant execute on function traccia.auth_change_password(text, text, text) to authenticated, anon;
