-- ============================================================================
-- TRACCIA — schema area riservata
-- Autenticazione custom (email + password, bcrypt) su Postgres, RLS attiva.
-- Il client parla con Supabase via PostgREST + funzioni RPC: nessuna chiave
-- di servizio finisce nel browser.
-- ============================================================================

create schema if not exists traccia;
grant usage on schema traccia to anon, authenticated;

-- ---------------------------------------------------------------- impostazioni
create table if not exists traccia.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------- sessioni
create table if not exists traccia.sessions (
  token_hash  text primary key,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text,
  user_agent  text
);
create index if not exists sessions_user_idx on traccia.sessions (user_id);
create index if not exists sessions_exp_idx on traccia.sessions (expires_at);

-- -------------------------------------------------------------------- utenti
create table if not exists traccia.users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text not null,
  name           text not null default '',
  role           text not null default 'user' check (role in ('user', 'admin')),
  is_master      boolean not null default false,
  status         text not null default 'pending'
                 check (status in ('pending', 'active', 'suspended', 'denied')),
  kyc_level      int not null default 1 check (kyc_level between 0 and 3),
  balance_eur    numeric(14, 2) not null default 0,
  iban           text,
  phone          text,
  case_ref       text,
  case_amount_eur numeric(14, 2) not null default 0,
  case_phase     int not null default 1 check (case_phase between 1 and 5),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
create index if not exists users_status_idx on traccia.users (status);
create index if not exists users_role_idx on traccia.users (role);

-- ---------------------------------------------------------------- operazioni
create table if not exists traccia.operations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references traccia.users (id) on delete cascade,
  type          text not null check (type in ('deposit', 'withdrawal', 'buy', 'sell', 'transfer_out', 'doc')),
  symbol        text,
  amount_eur    numeric(14, 2) not null default 0,
  quantity      numeric(24, 8),
  price_eur     numeric(14, 2),
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'denied', 'cancelled')),
  note          text,
  decision_note text,
  doc_label     text,
  decided_by    uuid references traccia.users (id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists operations_user_idx on traccia.operations (user_id, created_at desc);
create index if not exists operations_status_idx on traccia.operations (status);

-- -------------------------------------------------------------------- wallet
create table if not exists traccia.wallets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references traccia.users (id) on delete cascade,
  symbol           text not null,
  network          text,
  address          text not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'denied')),
  challenge        text,
  challenge_done_at timestamptz,
  signature        text,
  decision_note    text,
  created_at       timestamptz not null default now()
);
create index if not exists wallets_user_idx on traccia.wallets (user_id);

-- ------------------------------------------------------------------ audit log
create table if not exists traccia.audit (
  id           bigserial primary key,
  actor_id     uuid references traccia.users (id),
  actor_email  text,
  action       text not null,
  target       text,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists audit_created_idx on traccia.audit (created_at desc);

-- ------------------------------------------------------------- documenti
create table if not exists traccia.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references traccia.users (id) on delete cascade,
  label       text not null,
  kind        text default 'altro',
  status      text not null default 'pending'
              check (status in ('pending', 'received', 'rejected')),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists documents_user_idx on traccia.documents (user_id, created_at desc);

-- ============================================================================
-- RLS: nessun accesso diretto alle tabelle. Si passa solo dalle RPC.
-- ============================================================================
alter table traccia.users       enable row level security;
alter table traccia.sessions    enable row level security;
alter table traccia.operations  enable row level security;
alter table traccia.wallets     enable row level security;
alter table traccia.audit       enable row level security;
alter table traccia.settings    enable row level security;
alter table traccia.documents   enable row level security;

revoke all on all tables in schema traccia from anon, authenticated;
revoke all on all sequences in schema traccia from anon, authenticated;
