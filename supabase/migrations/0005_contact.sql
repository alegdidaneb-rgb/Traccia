-- ============================================================================
-- Traccia — modulo contatti — migrazione 0005
-- Il form pubblico su supporto.html scrive davvero: nessun "ambiente
-- dimostrativo", nessun dato perso nel browser. La lettura è riservata agli
-- analisti (admin_messages).
-- ============================================================================

create table if not exists traccia.contact_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  amount_eur numeric,
  message text not null,
  source text default 'supporto',
  status text not null default 'new' check (status in ('new','read','closed')),
  created_at timestamptz not null default now()
);

alter table traccia.contact_messages enable row level security;
revoke all on traccia.contact_messages from anon, authenticated;

create index if not exists contact_messages_created_idx
  on traccia.contact_messages (created_at desc);

-- invio dal modulo pubblico: nessun token richiesto (è il primo contatto)
create or replace function traccia.contact_send(
  p_name text, p_email text, p_message text,
  p_phone text default null, p_amount_eur numeric default null, p_source text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail text := lower(trim(coalesce(p_email, '')));
  msg text := trim(coalesce(p_message, ''));
  row_id uuid;
  recent int;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Inserisci nome e cognome.' using errcode = '22023';
  end if;
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if length(msg) < 15 then
    raise exception 'Descrivi brevemente il caso (almeno 15 caratteri).' using errcode = '22023';
  end if;

  -- semplice freno anti-abuso: max 3 invii per email ogni ora
  select count(*) into recent from traccia.contact_messages
  where email = mail and created_at > now() - interval '1 hour';
  if recent >= 3 then
    raise exception 'Hai già inviato più richieste. Ti risponderemo a breve.' using errcode = '22023';
  end if;

  insert into traccia.contact_messages (name, email, phone, amount_eur, message, source)
  values (trim(p_name), mail, nullif(trim(coalesce(p_phone, '')), ''),
          p_amount_eur, msg, coalesce(nullif(trim(p_source), ''), 'supporto'))
  returning id into row_id;

  return jsonb_build_object('ok', true, 'id', row_id,
    'message', 'Richiesta ricevuta. Ti ricontattiamo entro un giorno lavorativo.');
end $$;

create or replace function traccia.admin_messages(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'email', m.email, 'phone', m.phone,
      'amount_eur', m.amount_eur, 'message', m.message, 'source', m.source,
      'status', m.status, 'created_at', extract(epoch from m.created_at)
    ) order by m.created_at desc), '[]'::jsonb)
  into res from traccia.contact_messages m
  where p_status is null or m.status = p_status;
  return jsonb_build_object('messages', res,
    'new_count', (select count(*) from traccia.contact_messages where status = 'new'));
end $$;

create or replace function traccia.admin_message_status(p_token text, p_id uuid, p_status text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
begin
  if p_status not in ('new','read','closed') then
    raise exception 'Stato non valido.' using errcode = '22023';
  end if;
  update traccia.contact_messages set status = p_status where id = p_id;
  if not found then raise exception 'Messaggio non trovato.' using errcode = '22023'; end if;
  perform traccia.log_action(a, 'message_' || p_status, p_id::text, null);
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

revoke all on function traccia.contact_send(text, text, text, text, numeric, text) from public;
revoke all on function traccia.admin_messages(text, text) from public;
revoke all on function traccia.admin_message_status(text, uuid, text) from public;
grant execute on function traccia.contact_send(text, text, text, text, numeric, text) to anon, authenticated;
grant execute on function traccia.admin_messages(text, text) to anon, authenticated;
grant execute on function traccia.admin_message_status(text, uuid, text) to anon, authenticated;
