-- ============================================================================
-- Traccia — API console analisti — migrazione 0004
--
-- Tutte le funzioni sono protette da need_admin(p_token): un cliente che
-- conosce la chiave publishable e chiama questi endpoint riceve 42501.
-- Ogni azione viene scritta in traccia.audit.
-- ============================================================================

-- --------------------------------------------------------------- overview ----
create or replace function traccia.admin_overview(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
begin
  return jsonb_build_object(
    'pending_accounts', (select count(*) from traccia.users where status = 'pending'),
    'pending_operations', (select count(*) from traccia.operations where status = 'pending'),
    'pending_wallets', (select count(*) from traccia.wallets where status = 'pending'),
    'pending_documents', (select count(*) from traccia.documents where status = 'pending'),
    'active_users', (select count(*) from traccia.users where status = 'active'),
    'total_balance_eur', (select coalesce(sum(balance_eur),0) from traccia.users),
    'by_type', (select coalesce(jsonb_object_agg(type, n), '{}'::jsonb) from (
        select type, count(*) n from traccia.operations group by type) t),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a2.id, 'action', a2.action, 'actor_email', a2.actor_email,
        'target', a2.target, 'note', a2.note,
        'created_at', extract(epoch from a2.created_at)) order by a2.created_at desc), '[]'::jsonb)
      from (select * from traccia.audit order by created_at desc limit 50) a2)
  );
end $$;

-- --------------------------------------------------------------- account ----
create or replace function traccia.admin_accounts(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'is_master', u.is_master, 'status', u.status, 'kyc_level', u.kyc_level,
      'balance_eur', u.balance_eur, 'iban', u.iban,
      'iban_formatted', trim(regexp_replace(coalesce(u.iban,''), '(.{4})', '\1 ', 'g')),
      'case_ref', u.case_ref, 'case_phase', u.case_phase,
      'operations_count', (select count(*) from traccia.operations o where o.user_id = u.id),
      'documents_count', (select count(*) from traccia.documents d where d.user_id = u.id),
      'created_at', extract(epoch from u.created_at),
      'last_login_at', extract(epoch from u.last_login_at)
    ) order by u.created_at desc), '[]'::jsonb)
  into res
  from traccia.users u
  where p_status is null or u.status = p_status;
  return jsonb_build_object('accounts', res);
end $$;

create or replace function traccia.admin_create_account(
  p_token text, p_name text, p_email text, p_password text default null,
  p_role text default 'user', p_status text default 'active',
  p_kyc_level int default 1, p_balance_eur numeric default 0,
  p_case_amount_eur numeric default 0
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  mail text := lower(trim(p_email));
  pwd text;
  generated boolean := false;
  created traccia.users;
begin
  if mail is null or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Inserisci nome e cognome del cliente.' using errcode = '22023';
  end if;
  if exists (select 1 from traccia.users where lower(email) = mail) then
    raise exception 'Esiste già un account con questa email.' using errcode = '23505';
  end if;
  if p_role = 'admin' and not a.is_master then
    raise exception 'Solo l''account master può creare amministratori.' using errcode = '42501';
  end if;
  pwd := nullif(trim(coalesce(p_password, '')), '');
  if pwd is null then
    pwd := 'traccia-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
    generated := true;
  elsif length(pwd) < 8 then
    raise exception 'La password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;

  insert into traccia.users (email, password_hash, name, role, status, kyc_level,
                             balance_eur, iban, case_ref, case_amount_eur, case_phase)
  values (mail, extensions.crypt(pwd, extensions.gen_salt('bf', 10)), trim(p_name),
          case when p_role = 'admin' then 'admin' else 'user' end,
          case when p_status = 'pending' then 'pending' else 'active' end,
          greatest(1, least(3, coalesce(p_kyc_level, 1))),
          coalesce(p_balance_eur, 0), traccia.make_iban(),
          'T-' || lpad((1000 + floor(random()*8999))::int::text, 4, '0') || '-2026',
          coalesce(p_case_amount_eur, 0), 1)
  returning * into created;

  perform traccia.log_action(a, 'account_create', created.email, created.role);
  -- `user` per la console, `account` come alias di compatibilità
  return jsonb_build_object(
    'user', traccia.user_json(created),
    'account', traccia.user_json(created),
    'credentials', jsonb_build_object('email', created.email, 'password', pwd, 'generated', generated));
end $$;

create or replace function traccia.admin_account_action(p_token text, p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
  new_status text;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;
  new_status := case p_action
                  when 'approve' then 'active'
                  when 'deny' then 'denied'
                  when 'suspend' then 'suspended'
                  when 'reactivate' then 'active'
                  else null end;
  if new_status is null then
    raise exception 'Azione non valida.' using errcode = '22023';
  end if;
  update traccia.users set status = new_status where id = p_id;
  if new_status <> 'active' then
    delete from traccia.sessions where user_id = p_id;
  end if;
  perform traccia.log_action(a, 'account_' || p_action, t.email, p_note);
  return jsonb_build_object('ok', true, 'status', new_status);
end $$;

create or replace function traccia.admin_set_role(p_token text, p_id uuid, p_role text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
begin
  if not a.is_master then
    raise exception 'Solo l''account master può cambiare i ruoli.' using errcode = '42501';
  end if;
  if p_role not in ('user','admin') then
    raise exception 'Ruolo non valido.' using errcode = '22023';
  end if;
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if t.is_master then raise exception 'L''account master non può essere declassato.' using errcode = '42501'; end if;
  update traccia.users set role = p_role where id = p_id;
  perform traccia.log_action(a, 'role_change', t.email, p_role);
  return jsonb_build_object('ok', true, 'role', p_role);
end $$;

create or replace function traccia.admin_set_kyc(p_token text, p_id uuid, p_level int, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
begin
  if p_level < 0 or p_level > 3 then
    raise exception 'Livello KYC non valido.' using errcode = '22023';
  end if;
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;
  update traccia.users set kyc_level = p_level where id = p_id;
  perform traccia.log_action(a, 'kyc_change', t.email, 'KYC ' || p_level || coalesce(' · ' || p_note, ''));
  return jsonb_build_object('ok', true, 'kyc_level', p_level);
end $$;

-- ------------------------------------------------------------ operazioni ----
create or replace function traccia.admin_operations(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'type', o.type, 'symbol', o.symbol, 'amount_eur', o.amount_eur,
      'quantity', o.quantity, 'price_eur', o.price_eur, 'status', o.status,
      'note', o.note, 'decision_note', o.decision_note,
      'user_name', u.name, 'user_email', u.email,
      'created_at', extract(epoch from o.created_at)
    ) order by o.created_at desc), '[]'::jsonb)
  into res
  from traccia.operations o join traccia.users u on u.id = o.user_id
  where p_status is null or o.status = p_status;
  return jsonb_build_object('operations', res);
end $$;

create or replace function traccia.admin_operation_action(p_token text, p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  o traccia.operations;
  new_status text;
begin
  select * into o from traccia.operations where id = p_id;
  if o.id is null then raise exception 'Operazione non trovata.' using errcode = '22023'; end if;
  if o.status <> 'pending' then
    raise exception 'Operazione già decisa.' using errcode = '22023';
  end if;
  new_status := case p_action when 'approve' then 'approved' when 'deny' then 'denied' else null end;
  if new_status is null then raise exception 'Azione non valida.' using errcode = '22023'; end if;

  update traccia.operations
  set status = new_status, decision_note = nullif(trim(coalesce(p_note,'')), ''),
      decided_by = a.id, decided_at = now()
  where id = p_id;

  -- il saldo si muove solo su approvazione di un versamento o prelievo
  if new_status = 'approved' then
    if o.type = 'deposit' then
      update traccia.users set balance_eur = balance_eur + o.amount_eur where id = o.user_id;
    elsif o.type = 'withdrawal' then
      update traccia.users set balance_eur = greatest(balance_eur - o.amount_eur, 0) where id = o.user_id;
    end if;
  end if;

  perform traccia.log_action(a, 'operation_' || p_action, o.id::text,
    o.type || ' € ' || o.amount_eur::text || coalesce(' · ' || p_note, ''));
  return jsonb_build_object('ok', true, 'status', new_status);
end $$;

-- ---------------------------------------------------------------- wallet ----
create or replace function traccia.admin_wallets(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'symbol', w.symbol, 'network', w.network, 'address', w.address,
      'status', w.status, 'signature', w.signature,
      'challenge_done_at', extract(epoch from w.challenge_done_at),
      'decision_note', w.decision_note,
      'user_name', u.name, 'user_email', u.email, 'kyc_level', u.kyc_level,
      'created_at', extract(epoch from w.created_at)
    ) order by w.created_at desc), '[]'::jsonb)
  into res
  from traccia.wallets w join traccia.users u on u.id = w.user_id
  where p_status is null or w.status = p_status;
  return jsonb_build_object('wallets', res);
end $$;

create or replace function traccia.admin_wallet_action(p_token text, p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  new_status text := case p_action when 'approve' then 'approved' when 'deny' then 'denied' else null end;
begin
  if new_status is null then raise exception 'Azione non valida.' using errcode = '22023'; end if;
  update traccia.wallets set status = new_status, decision_note = nullif(trim(coalesce(p_note,'')), '')
  where id = p_id;
  if not found then raise exception 'Indirizzo non trovato.' using errcode = '22023'; end if;
  perform traccia.log_action(a, 'wallet_' || p_action, p_id::text, p_note);
  return jsonb_build_object('ok', true, 'status', new_status);
end $$;

-- -------------------------------------------------------------- parametri ----
create or replace function traccia.admin_settings(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  lim jsonb;
  fee jsonb;
begin
  select value into lim from traccia.settings where key = 'limits';
  select value into fee from traccia.settings where key = 'fees';
  return jsonb_build_object('settings', coalesce(lim, '{}'::jsonb) || coalesce(fee, '{}'::jsonb),
                            'defaults', coalesce(lim, '{}'::jsonb) || coalesce(fee, '{}'::jsonb),
                            'kyc_labels', jsonb_build_object('1','Base','2','Avanzata','3','Completa'),
                            'networks', jsonb_build_object('BTC','Bitcoin','ETH','ERC20','SOL','Solana'));
end $$;

create or replace function traccia.admin_save_settings(p_token text, p_settings jsonb)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  lim jsonb;
  fee jsonb;
begin
  select coalesce(value, '{}'::jsonb) into lim from traccia.settings where key = 'limits';
  select coalesce(value, '{}'::jsonb) into fee from traccia.settings where key = 'fees';
  lim := coalesce(lim, '{}'::jsonb) || coalesce(p_settings, '{}'::jsonb);
  insert into traccia.settings (key, value) values ('limits', lim)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform traccia.log_action(a, 'settings_update', 'limits', null);
  return jsonb_build_object('settings', lim || coalesce(fee, '{}'::jsonb));
end $$;

create or replace function traccia.admin_audit(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'action', x.action, 'actor_email', x.actor_email,
      'target', x.target, 'note', x.note,
      'created_at', extract(epoch from x.created_at)) order by x.created_at desc), '[]'::jsonb)
  into res from (select * from traccia.audit order by created_at desc limit 200) x;
  return jsonb_build_object('audit', res);
end $$;

-- ---------------------------------------------------------------- grants ----
revoke all on function traccia.admin_overview(text) from public;
revoke all on function traccia.admin_accounts(text, text) from public;
revoke all on function traccia.admin_create_account(text, text, text, text, text, text, int, numeric, numeric) from public;
revoke all on function traccia.admin_account_action(text, uuid, text, text) from public;
revoke all on function traccia.admin_set_role(text, uuid, text) from public;
revoke all on function traccia.admin_set_kyc(text, uuid, int, text) from public;
revoke all on function traccia.admin_operations(text, text) from public;
revoke all on function traccia.admin_operation_action(text, uuid, text, text) from public;
revoke all on function traccia.admin_wallets(text, text) from public;
revoke all on function traccia.admin_wallet_action(text, uuid, text, text) from public;
revoke all on function traccia.admin_settings(text) from public;
revoke all on function traccia.admin_save_settings(text, jsonb) from public;
revoke all on function traccia.admin_audit(text) from public;

grant execute on function traccia.admin_overview(text) to anon, authenticated;
grant execute on function traccia.admin_accounts(text, text) to anon, authenticated;
grant execute on function traccia.admin_create_account(text, text, text, text, text, text, int, numeric, numeric) to anon, authenticated;
grant execute on function traccia.admin_account_action(text, uuid, text, text) to anon, authenticated;
grant execute on function traccia.admin_set_role(text, uuid, text) to anon, authenticated;
grant execute on function traccia.admin_set_kyc(text, uuid, int, text) to anon, authenticated;
grant execute on function traccia.admin_operations(text, text) to anon, authenticated;
grant execute on function traccia.admin_operation_action(text, uuid, text, text) to anon, authenticated;
grant execute on function traccia.admin_wallets(text, text) to anon, authenticated;
grant execute on function traccia.admin_wallet_action(text, uuid, text, text) to anon, authenticated;
grant execute on function traccia.admin_settings(text) to anon, authenticated;
grant execute on function traccia.admin_save_settings(text, jsonb) to anon, authenticated;
grant execute on function traccia.admin_audit(text) to anon, authenticated;
