-- 0010_contracts.sql
-- Contratto di incarico generato automaticamente per ogni cliente.
--
-- Requisiti:
--   * il contratto esiste per OGNI cliente, senza intervento manuale;
--   * è redatto in italiano e copre servizi e pagamenti;
--   * è numerato, archiviato e consultabile dall'area riservata;
--   * una volta emesso non cambia: le condizioni sono fotografate (snapshot),
--     così una modifica futura di tariffe o limiti non riscrive il passato.
--
-- La generazione avviene su entrambi i percorsi di creazione dell'account:
--   * `auth_register`         → registrazione dal sito;
--   * `admin_create_account`  → account creato da un analista.
-- Entrambi chiamano `ensure_contract`, che è idempotente.
--
-- Dipende da: 0001 (schema), 0002 (users/settings/audit).

begin;

-- ----------------------------------------------------------------- tabella --
create table if not exists traccia.contracts (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid not null references traccia.users(id) on delete cascade,
  number       text not null unique,
  status       text not null default 'generated'
               check (status in ('generated', 'accepted', 'superseded')),
  version      text not null default '1.0',
  snapshot     jsonb not null,
  generated_at timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_ip  inet
);

comment on table traccia.contracts is
  'Contratti di incarico: una fotografia immutabile delle condizioni accettate.';

create index if not exists contracts_user_idx
  on traccia.contracts (user_id, generated_at desc);

-- un solo contratto "vivo" per cliente; quelli superati restano in archivio
create unique index if not exists contracts_one_live_idx
  on traccia.contracts (user_id)
  where status <> 'superseded';

-- RLS attiva e nessun grant diretto: si passa solo dalle funzioni sotto.
alter table traccia.contracts enable row level security;
revoke all on traccia.contracts from public, anon, authenticated;

-- ---------------------------------------------------------------- numerazione --
create sequence if not exists traccia.contract_number_seq;

create or replace function traccia.contract_number(p_seq bigint)
returns text language sql immutable
set search_path = traccia, public as $$
  select 'TRC-' || to_char(now(), 'YYYY') || '-' || lpad(p_seq::text, 4, '0');
$$;

-- -------------------------------------------------------------- impostazioni --
insert into traccia.settings (key, value)
values ('contract', jsonb_build_object(
  'provider_name',    'ERSEL SPA',
  'provider_vat',     '06900230018',
  'provider_pec',     'traccia@pec.it',
  'provider_address', 'Piazza Solferino, 11 - 10121 Torino (TO)',
  'version',          '1.0',
  'recesso_giorni',   14
))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- generazione --
create or replace function traccia.ensure_contract(p_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u        traccia.users;
  cfg      jsonb;
  fee      jsonb;
  lim      jsonb;
  existing traccia.contracts;
  fresh    traccia.contracts;
  snap     jsonb;
  lvl      int;
begin
  select * into u from traccia.users where id = p_user_id;
  if u.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;

  -- idempotente: se esiste un contratto vivo lo restituisce senza crearne un altro
  select * into existing from traccia.contracts
  where user_id = u.id and status <> 'superseded'
  order by generated_at desc limit 1;
  if existing.id is not null then
    return jsonb_build_object('contract', existing.snapshot || jsonb_build_object(
      'id', existing.id, 'number', existing.number, 'status', existing.status,
      'version', existing.version,
      'generated_at', extract(epoch from existing.generated_at),
      'accepted_at', extract(epoch from existing.accepted_at)));
  end if;

  select coalesce(value, '{}'::jsonb) into cfg from traccia.settings where key = 'contract';
  select coalesce(value, '{}'::jsonb) into fee from traccia.settings where key = 'fees';
  select coalesce(value, '{}'::jsonb) into lim from traccia.settings where key = 'limits';
  lvl := greatest(1, least(3, coalesce(u.kyc_level, 1)));

  snap := jsonb_build_object(
    'provider', jsonb_build_object(
      'name',    coalesce(cfg ->> 'provider_name', 'ERSEL SPA'),
      'vat',     cfg ->> 'provider_vat',
      'pec',     cfg ->> 'provider_pec',
      'address', cfg ->> 'provider_address'
    ),
    'client', jsonb_build_object(
      'name',           u.name,
      'email',          u.email,
      'iban',           u.iban,
      'iban_formatted', trim(regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g')),
      'case_ref',       u.case_ref,
      'kyc_level',      u.kyc_level
    ),
    'fees', jsonb_build_object(
      'start_fee_eur', coalesce((fee ->> 'start_fee_eur')::numeric, 190),
      'success_pct',   coalesce((fee ->> 'success_pct')::numeric, 12)
    ),
    'limits', jsonb_build_object(
      'daily_deposit',       (lim ->> ('daily_deposit_l' || lvl))::numeric,
      'daily_withdrawal',    (lim ->> ('daily_withdrawal_l' || lvl))::numeric,
      'daily_buy',           (lim ->> ('daily_buy_l' || lvl))::numeric,
      'daily_sell',          (lim ->> ('daily_sell_l' || lvl))::numeric,
      'crypto_transfer_max', (lim ->> ('crypto_transfer_max_eur_l' || lvl))::numeric,
      'unlimited',           lvl = 3
    ),
    'terms', jsonb_build_object(
      'version',        coalesce(cfg ->> 'version', '1.0'),
      'recesso_giorni', coalesce((cfg ->> 'recesso_giorni')::int, 14)
    )
  );

  insert into traccia.contracts (user_id, number, version, snapshot)
  values (u.id, traccia.contract_number(nextval('traccia.contract_number_seq')),
          coalesce(cfg ->> 'version', '1.0'), snap)
  returning * into fresh;

  insert into traccia.audit (actor_email, action, target, note)
  values (u.email, 'contract_generated', fresh.number, 'Contratto di incarico');

  return jsonb_build_object('contract', fresh.snapshot || jsonb_build_object(
    'id', fresh.id, 'number', fresh.number, 'status', fresh.status,
    'version', fresh.version,
    'generated_at', extract(epoch from fresh.generated_at),
    'accepted_at', null));
end $$;

-- ------------------------------------------------------------------ lettura --
create or replace function traccia.my_contract(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
begin
  return traccia.ensure_contract(u.id);
end $$;

-- ------------------------------------------------------------- accettazione --
-- `need_write_user` rifiuta le sessioni di sola lettura aperte dagli analisti:
-- l'accettazione è un atto del cliente e non può essere compiuta da altri.
create or replace function traccia.accept_contract(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  c traccia.contracts;
begin
  select * into c from traccia.contracts
  where user_id = u.id and status <> 'superseded'
  order by generated_at desc limit 1;
  if c.id is null then
    raise exception 'Nessun contratto da accettare.' using errcode = '22023';
  end if;
  if c.status = 'accepted' then
    return jsonb_build_object('ok', true, 'status', 'accepted', 'already', true,
      'accepted_at', extract(epoch from c.accepted_at));
  end if;

  update traccia.contracts set status = 'accepted', accepted_at = now()
  where id = c.id;

  insert into traccia.audit (actor_email, action, target, note)
  values (u.email, 'contract_accepted', c.number, 'Accettazione del cliente');

  return jsonb_build_object('ok', true, 'status', 'accepted', 'already', false,
    'accepted_at', extract(epoch from now()));
end $$;

revoke all on function traccia.ensure_contract(uuid) from public;
revoke all on function traccia.my_contract(text)     from public;
revoke all on function traccia.accept_contract(text) from public;
grant execute on function traccia.my_contract(text)     to anon, authenticated;
grant execute on function traccia.accept_contract(text) to anon, authenticated;

-- ------------------------------------------------- aggancio ai due percorsi --
-- Registrazione dal sito: il contratto nasce insieme all'account.
create or replace function traccia.auth_register(p_name text, p_email text, p_password text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  res    jsonb;
  new_id uuid;
begin
  res := traccia.auth_register_impl(p_name, p_email, p_password);
  select id into new_id from traccia.users where lower(email) = lower(trim(p_email));
  if new_id is not null then
    perform traccia.ensure_contract(new_id);
  end if;
  return res;
end $$;

-- Account creato da un analista. Gli argomenti identitari sono nove e
-- comprendono `p_status`: sbagliarli produce un `42883` poco parlante.
create or replace function traccia.admin_create_account(
  p_token text, p_name text, p_email text, p_password text default null,
  p_role text default 'user', p_status text default 'active',
  p_kyc_level integer default 1, p_balance_eur numeric default 0,
  p_case_amount_eur numeric default 0)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  res    jsonb;
  new_id uuid;
begin
  res := traccia.admin_create_account_impl(p_token, p_name, p_email, p_password,
           p_role, p_status, p_kyc_level, p_balance_eur, p_case_amount_eur);
  new_id := (res -> 'user' ->> 'id')::uuid;
  if new_id is not null then
    perform traccia.ensure_contract(new_id);
  end if;
  return res;
end $$;

-- ------------------------------------------------------------------ backfill --
-- Copre i clienti creati prima di questa migrazione (gli analisti sono esclusi).
do $$
declare r record;
begin
  for r in
    select u.id from traccia.users u
    where u.role <> 'admin'
      and not exists (
        select 1 from traccia.contracts c
        where c.user_id = u.id and c.status <> 'superseded')
  loop
    perform traccia.ensure_contract(r.id);
  end loop;
end $$;

-- ----------------------------------------------------- visibilità in console --
-- Il personale vede subito quali contratti sono ancora da accettare.
create or replace function traccia.admin_accounts(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a   traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'is_master', u.is_master, 'status', u.status, 'kyc_level', u.kyc_level,
      'balance_eur', u.balance_eur,
      'holdings_value', traccia.holdings_value(u.id),
      'iban', u.iban,
      'iban_formatted', trim(regexp_replace(coalesce(u.iban,''), '(.{4})', '\1 ', 'g')),
      'case_ref', u.case_ref, 'case_phase', u.case_phase,
      'operations_count', (select count(*) from traccia.operations o where o.user_id = u.id),
      'documents_count', (select count(*) from traccia.documents d where d.user_id = u.id),
      'contract_number', (select c.number from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'contract_status', (select c.status from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'created_at', extract(epoch from u.created_at),
      'last_login_at', extract(epoch from u.last_login_at)
    ) order by u.created_at desc), '[]'::jsonb)
  into res
  from traccia.users u
  where p_status is null or u.status = p_status;
  return jsonb_build_object('accounts', res);
end $$;

revoke all on function traccia.admin_accounts(text, text) from public;
grant execute on function traccia.admin_accounts(text, text) to anon, authenticated;

-- -------------------------------------------------------- wrapper in public --
-- PostgREST espone solo `public`: senza wrapper le nuove funzioni non esistono.
create or replace function public.my_contract(p_token text)
returns jsonb language sql security definer
set search_path = traccia, extensions as $$
  select traccia.my_contract(p_token);
$$;

create or replace function public.accept_contract(p_token text)
returns jsonb language sql security definer
set search_path = traccia, extensions as $$
  select traccia.accept_contract(p_token);
$$;

revoke all on function public.my_contract(text)     from public;
revoke all on function public.accept_contract(text) from public;
grant execute on function public.my_contract(text)     to anon, authenticated;
grant execute on function public.accept_contract(text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
