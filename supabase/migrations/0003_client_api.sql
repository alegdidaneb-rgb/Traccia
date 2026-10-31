-- ============================================================================
-- Traccia — API area cliente — migrazione 0003
--
-- Espone solo funzioni RPC (security definer). Le tabelle restano chiuse:
-- anon/authenticated non hanno alcun grant diretto, quindi anche conoscendo
-- la chiave publishable non si legge nulla senza un token di sessione valido.
-- Ogni funzione prende `p_token text` e lo verifica con need_user(p_token).
-- ============================================================================

-- ---------------------------------------------------------------- listino ----
create table if not exists traccia.market_assets (
  symbol        text primary key,
  name          text not null,
  price_eur     numeric(18, 2) not null,
  change_24h    numeric(8, 2)  not null default 0,
  color         text,
  category      text default 'Cripto',
  tradable_247  boolean default true,
  sort_order    int default 0,
  updated_at    timestamptz not null default now()
);

alter table traccia.market_assets enable row level security;

insert into traccia.market_assets (symbol, name, price_eur, change_24h, color, sort_order) values
  ('BTC',  'Bitcoin',   61240.50,  1.84, '#f7931a', 1),
  ('ETH',  'Ethereum',   2847.30, -0.62, '#627eea', 2),
  ('SOL',  'Solana',      148.72,  3.15, '#00ffa3', 3),
  ('XRP',  'XRP',           0.52, -1.10, '#23292f', 4),
  ('ADA',  'Cardano',       0.41,  0.95, '#0033ad', 5),
  ('DOT',  'Polkadot',      6.15, -0.44, '#e6007a', 6),
  ('LINK', 'Chainlink',    12.80,  2.06, '#2a5ada', 7),
  ('MATIC','Polygon',       0.58, -2.31, '#8247e5', 8),
  ('AVAX', 'Avalanche',    29.40,  1.42, '#e84142', 9),
  ('DOGE', 'Dogecoin',      0.13,  4.71, '#c2a633', 10)
on conflict (symbol) do nothing;

-- lista prezzi usata dal ticker pubblico (nessun dato personale)
create or replace function traccia.market()
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select jsonb_build_object(
    'assets', coalesce(jsonb_agg(jsonb_build_object(
        'symbol', symbol, 'name', name, 'price_eur', price_eur,
        'change_24h', change_24h, 'color', color,
        'category', category, 'tradable_247', tradable_247
      ) order by sort_order), '[]'::jsonb),
    'market', jsonb_build_object('source','reference','stale',false)
  ) from traccia.market_assets;
$$;

-- -------------------------------------------------------- limiti giornalieri --
create or replace function traccia.my_limits(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  lim jsonb;
  lvl int := greatest(1, least(3, u.kyc_level));
begin
  select value into lim from traccia.settings where key = 'limits';
  return jsonb_build_object(
    'kyc_level', u.kyc_level,
    'kyc_label', 'KYC ' || u.kyc_level,
    'limits', jsonb_build_object(
      'deposit', (lim ->> ('daily_deposit_l' || lvl))::numeric,
      'withdrawal', (lim ->> ('daily_withdrawal_l' || lvl))::numeric,
      'buy', (lim ->> ('daily_buy_l' || lvl))::numeric,
      'sell', (lim ->> ('daily_sell_l' || lvl))::numeric,
      'transfer', (lim ->> ('crypto_transfer_max_eur_l' || lvl))::numeric
    ),
    'unlimited', lvl = 3
  );
end $$;

create or replace function traccia.used_today(p_user uuid, p_type text)
returns numeric language sql security definer
set search_path = traccia, public, extensions as $$
  select coalesce(sum(amount_eur), 0) from traccia.operations
  where user_id = p_user and type = p_type
    and status in ('pending','approved')
    and created_at >= date_trunc('day', now());
$$;

-- ------------------------------------------------------------- dashboard ----
create or replace function traccia.me_dashboard(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  ops jsonb;
  docs jsonb;
  phase_names text[] := array['Raccolta','Ricostruzione','Perizia','Denunce','Legale'];
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'type', o.type, 'symbol', o.symbol,
      'amount_eur', o.amount_eur, 'status', o.status,
      'note', o.note, 'decision_note', o.decision_note,
      'doc_label', o.doc_label,
      'created_at', extract(epoch from o.created_at)
    ) order by o.created_at desc), '[]'::jsonb)
  into ops
  from traccia.operations o where o.user_id = u.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind,
      'status', d.status, 'note', d.note,
      'created_at', extract(epoch from d.created_at)
    ) order by d.created_at desc), '[]'::jsonb)
  into docs
  from traccia.documents d where d.user_id = u.id;

  return jsonb_build_object(
    'user', traccia.user_json(u),
    'case', jsonb_build_object(
      'ref', u.case_ref,
      'phase', u.case_phase,
      'phase_name', phase_names[greatest(1, least(5, u.case_phase))],
      'phase_index', u.case_phase,
      'phases_total', 5,
      'percent', round((u.case_phase - 1)::numeric / 4 * 100),
      'amount_eur', u.case_amount_eur
    ),
    'operations', ops,
    'documents', docs,
    'documents_count', jsonb_array_length(docs),
    'fees', (select value from traccia.settings where key = 'fees')
  );
end $$;

-- ---------------------------------------------------------- operazioni ------
create or replace function traccia.my_operations(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'type', o.type, 'symbol', o.symbol, 'amount_eur', o.amount_eur,
      'quantity', o.quantity, 'price_eur', o.price_eur, 'status', o.status,
      'note', o.note, 'decision_note', o.decision_note,
      'created_at', extract(epoch from o.created_at)
    ) order by o.created_at desc), '[]'::jsonb)
  into res
  from traccia.operations o
  where o.user_id = u.id and (p_status is null or o.status = p_status);
  return jsonb_build_object('operations', res);
end $$;

create or replace function traccia.create_operation(
  p_token text, p_type text, p_symbol text default null,
  p_amount_eur numeric default 0, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  lim jsonb;
  lvl int := greatest(1, least(3, u.kyc_level));
  cap numeric;
  used numeric;
  op traccia.operations;
  price numeric;
  asset text := nullif(upper(trim(coalesce(p_symbol, ''))), '');
begin
  if u.status <> 'active' then
    raise exception 'La pratica non è ancora attiva.' using errcode = '42501';
  end if;
  if p_type not in ('deposit','withdrawal','buy','sell','transfer_out') then
    raise exception 'Tipo di operazione non valido.' using errcode = '22023';
  end if;
  if coalesce(p_amount_eur, 0) <= 0 then
    raise exception 'L''importo deve essere maggiore di zero.' using errcode = '22023';
  end if;
  if (p_type in ('buy','sell','transfer_out')) and asset is null then
    raise exception 'Indica la criptovaluta dell''operazione.' using errcode = '22023';
  end if;

  select value into lim from traccia.settings where key = 'limits';
  cap := case p_type
           when 'deposit' then (lim ->> ('daily_deposit_l' || lvl))::numeric
           when 'withdrawal' then (lim ->> ('daily_withdrawal_l' || lvl))::numeric
           when 'buy' then (lim ->> ('daily_buy_l' || lvl))::numeric
           when 'sell' then (lim ->> ('daily_sell_l' || lvl))::numeric
           else (lim ->> ('crypto_transfer_max_eur_l' || lvl))::numeric
         end;
  if cap is not null and cap > 0 then
    used := traccia.used_today(u.id, p_type);
    if used + p_amount_eur > cap then
      raise exception 'Superato il limite giornaliero per questa operazione (€ %). Restano € %.',
        to_char(cap, 'FM999G999D00'), to_char(greatest(cap - used, 0), 'FM999G999D00')
        using errcode = '22023';
    end if;
  end if;

  if asset is not null then
    select price_eur into price from traccia.market_assets where symbol = asset;
    if price is null then
      raise exception 'Criptovaluta non disponibile: %.', asset using errcode = '22023';
    end if;
  end if;

  insert into traccia.operations (user_id, type, symbol, amount_eur, quantity, price_eur, note)
  values (u.id, p_type, asset, p_amount_eur,
          case when price is not null then round(p_amount_eur / price, 8) else null end,
          price, nullif(trim(coalesce(p_note, '')), ''))
  returning * into op;

  perform traccia.log_action(u, 'operation_create', op.id::text, p_type || ' € ' || p_amount_eur::text);
  return jsonb_build_object('operation', jsonb_build_object(
    'id', op.id, 'type', op.type, 'symbol', op.symbol, 'amount_eur', op.amount_eur,
    'status', op.status, 'created_at', extract(epoch from op.created_at)));
end $$;

create or replace function traccia.cancel_operation(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  changed int;
begin
  update traccia.operations set status = 'cancelled'
  where id = p_id and user_id = u.id and status = 'pending';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'Operazione non annullabile.' using errcode = '22023';
  end if;
  perform traccia.log_action(u, 'operation_cancel', p_id::text, null);
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ documenti ----
create or replace function traccia.add_document(
  p_token text, p_label text, p_kind text default 'altro', p_note text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  d traccia.documents;
begin
  if length(trim(coalesce(p_label, ''))) < 2 then
    raise exception 'Indica il tipo di documento.' using errcode = '22023';
  end if;
  insert into traccia.documents (user_id, label, kind, note, status)
  values (u.id, trim(p_label), coalesce(nullif(trim(p_kind), ''), 'altro'),
          nullif(trim(coalesce(p_note, '')), ''), 'pending')
  returning * into d;
  perform traccia.log_action(u, 'document_add', d.id::text, d.label);
  return jsonb_build_object('document', jsonb_build_object(
    'id', d.id, 'label', d.label, 'kind', d.kind, 'status', d.status,
    'created_at', extract(epoch from d.created_at)));
end $$;

create or replace function traccia.my_documents(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind, 'status', d.status, 'note', d.note,
      'created_at', extract(epoch from d.created_at)
    ) order by d.created_at desc), '[]'::jsonb)
  into res from traccia.documents d where d.user_id = u.id;
  return jsonb_build_object('documents', res);
end $$;

-- --------------------------------------------------------------- wallet ----
create or replace function traccia.my_wallets(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'symbol', w.symbol, 'network', w.network, 'address', w.address,
      'status', w.status, 'challenge_done_at', extract(epoch from w.challenge_done_at),
      'created_at', extract(epoch from w.created_at)
    ) order by w.created_at desc), '[]'::jsonb)
  into res from traccia.wallets w where w.user_id = u.id;
  return jsonb_build_object('wallets', res);
end $$;

create or replace function traccia.add_wallet(
  p_token text, p_symbol text, p_address text, p_network text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  w traccia.wallets;
begin
  if length(trim(coalesce(p_address, ''))) < 8 then
    raise exception 'Indirizzo non valido.' using errcode = '22023';
  end if;
  insert into traccia.wallets (user_id, symbol, address, network, status)
  values (u.id, upper(trim(p_symbol)), trim(p_address),
          nullif(trim(coalesce(p_network,'')), ''), 'pending')
  returning * into w;
  perform traccia.log_action(u, 'wallet_add', w.id::text, w.symbol);
  return jsonb_build_object('wallet', jsonb_build_object('id', w.id, 'status', w.status));
end $$;

create or replace function traccia.wallet_challenge(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  w traccia.wallets;
  nonce text;
begin
  select * into w from traccia.wallets where id = p_id and user_id = u.id;
  if w.id is null then raise exception 'Indirizzo non trovato.' using errcode = '22023'; end if;
  nonce := 'traccia-' || encode(extensions.gen_random_bytes(8), 'hex');
  update traccia.wallets set challenge = nonce where id = w.id;
  return jsonb_build_object('challenge',
    'Traccia wallet verification' || chr(10) || 'Address: ' || w.address || chr(10) || 'Nonce: ' || nonce);
end $$;

create or replace function traccia.wallet_signature(p_token text, p_id uuid, p_signature text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  changed int;
begin
  update traccia.wallets
  set signature = p_signature, challenge_done_at = now()
  where id = p_id and user_id = u.id and challenge is not null;
  get diagnostics changed = row_count;
  if changed = 0 then
    raise exception 'Richiedi prima il nonce di verifica.' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'wallet_id', p_id, 'status', 'pending',
    'message', 'Firma acquisita. In attesa della verifica finale.');
end $$;

-- ---------------------------------------------------------------- grants ----
revoke all on function traccia.market() from public;
revoke all on function traccia.my_limits(text) from public;
revoke all on function traccia.used_today(uuid, text) from public;
revoke all on function traccia.me_dashboard(text) from public;
revoke all on function traccia.my_operations(text, text) from public;
revoke all on function traccia.create_operation(text, text, text, numeric, text) from public;
revoke all on function traccia.cancel_operation(text, uuid) from public;
revoke all on function traccia.add_document(text, text, text, text) from public;
revoke all on function traccia.my_documents(text) from public;
revoke all on function traccia.my_wallets(text) from public;
revoke all on function traccia.add_wallet(text, text, text, text) from public;
revoke all on function traccia.wallet_challenge(text, uuid) from public;
revoke all on function traccia.wallet_signature(text, uuid, text) from public;

grant execute on function traccia.market() to anon, authenticated;
grant execute on function traccia.my_limits(text) to anon, authenticated;
grant execute on function traccia.used_today(uuid, text) to anon, authenticated;
grant execute on function traccia.me_dashboard(text) to anon, authenticated;
grant execute on function traccia.my_operations(text, text) to anon, authenticated;
grant execute on function traccia.create_operation(text, text, text, numeric, text) to anon, authenticated;
grant execute on function traccia.cancel_operation(text, uuid) to anon, authenticated;
grant execute on function traccia.add_document(text, text, text, text) to anon, authenticated;
grant execute on function traccia.my_documents(text) to anon, authenticated;
grant execute on function traccia.my_wallets(text) to anon, authenticated;
grant execute on function traccia.add_wallet(text, text, text, text) to anon, authenticated;
grant execute on function traccia.wallet_challenge(text, uuid) to anon, authenticated;
grant execute on function traccia.wallet_signature(text, uuid, text) to anon, authenticated;
