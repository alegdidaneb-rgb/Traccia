-- 0011_notifications_and_phase.sql
-- Cambio di fase della pratica da parte degli analisti, con avviso al cliente.
--
-- Prima di questa migrazione la fase veniva scritta una volta sola, alla
-- creazione dell'account, e non esisteva alcuna funzione per spostarla: ogni
-- pratica restava ferma alla fase 1 e la barra di avanzamento del cliente
-- restava a zero.
--
-- Quello che aggiunge:
--   * `admin_set_phase`  → sposta la pratica e, se richiesto, avvisa il cliente;
--   * `notifications`    → tabella delle comunicazioni verso il cliente;
--   * `my_notifications` / `mark_notifications_read` → lettura dall'area riservata;
--   * `me_dashboard`     → include avvisi e conteggio dei non letti.
--
-- Dipende da: 0001 (users/audit), 0002 (need_admin/need_user), 0003 (me_dashboard).

begin;

-- ------------------------------------------------------------ avvisi -------
create table if not exists traccia.notifications (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references traccia.users(id) on delete cascade,
  kind       text not null default 'phase'
             check (kind in ('phase', 'document', 'operation', 'contract', 'system')),
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table traccia.notifications is
  'Comunicazioni verso il cliente: compaiono nell''area riservata.';

create index if not exists notifications_user_idx
  on traccia.notifications (user_id, created_at desc);

-- serve a contare in fretta i non letti della campanella
create index if not exists notifications_unread_idx
  on traccia.notifications (user_id)
  where read_at is null;

alter table traccia.notifications enable row level security;
revoke all on traccia.notifications from public, anon, authenticated;

-- ------------------------------------------------------- nomi delle fasi ----
create or replace function traccia.phase_name(p_phase int)
returns text language sql immutable
set search_path = traccia, public as $$
  select (array['Raccolta','Ricostruzione','Perizia','Denunce','Legale'])
         [greatest(1, least(5, p_phase))];
$$;

create or replace function traccia.phase_descr(p_phase int)
returns text language sql immutable
set search_path = traccia, public as $$
  select (array[
    'Documenti e colloquio iniziale acquisiti.',
    'Flussi e indirizzi ricostruiti.',
    'Redazione del documento tecnico.',
    'Predisposizione degli atti.',
    'Passaggio all''avvocato.'
  ])[greatest(1, least(5, p_phase))];
$$;

-- ---------------------------------------------------- cambio di fase -------
-- `p_notify` esiste perché a volte si corregge un errore di impostazione e
-- avvisare il cliente sarebbe solo confusione. In console è attivo di default.
create or replace function traccia.admin_set_phase(
  p_token text, p_id uuid, p_phase int,
  p_note text default null, p_notify boolean default true)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a          traccia.users := traccia.need_admin(p_token);
  t          traccia.users;
  from_phase int;
begin
  if p_phase is null or p_phase < 1 or p_phase > 5 then
    raise exception 'Fase non valida: sono previste le fasi da 1 a 5.' using errcode = '22023';
  end if;

  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;
  if t.role = 'admin' then
    raise exception 'L''account non è una pratica cliente.' using errcode = '22023';
  end if;

  from_phase := t.case_phase;
  if from_phase = p_phase then
    return jsonb_build_object('ok', true, 'changed', false, 'phase', p_phase,
      'phase_name', traccia.phase_name(p_phase));
  end if;

  update traccia.users set case_phase = p_phase where id = p_id;

  -- il registro dice sempre da dove a dove, e in che direzione
  perform traccia.log_action(a, 'phase_change', t.email,
    traccia.phase_name(from_phase) || ' → ' || traccia.phase_name(p_phase) ||
    case when p_note is null or trim(p_note) = '' then '' else ' · ' || trim(p_note) end);

  if p_notify then
    insert into traccia.notifications (user_id, kind, title, body)
    values (t.id, 'phase',
      'La pratica è passata alla fase ' || p_phase || ' · ' || traccia.phase_name(p_phase),
      concat_ws(' ',
        traccia.phase_descr(p_phase),
        nullif(trim(coalesce(p_note, '')), '')));
  end if;

  return jsonb_build_object(
    'ok', true, 'changed', true,
    'from_phase', from_phase, 'from_name', traccia.phase_name(from_phase),
    'phase', p_phase, 'phase_name', traccia.phase_name(p_phase),
    'notified', p_notify);
end $$;

revoke all on function traccia.admin_set_phase(text, uuid, int, text, boolean) from public;
grant execute on function traccia.admin_set_phase(text, uuid, int, text, boolean)
  to anon, authenticated;

-- --------------------------------------------------- lettura dal cliente ----
create or replace function traccia.my_notifications(p_token text, p_limit int default 20)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u      traccia.users := traccia.need_user(p_token);
  res    jsonb;
  unread int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
      'read', n.read_at is not null,
      'created_at', extract(epoch from n.created_at)
    ) order by n.created_at desc), '[]'::jsonb)
  into res
  from (
    select * from traccia.notifications
    where user_id = u.id
    order by created_at desc
    limit greatest(1, least(100, coalesce(p_limit, 20)))
  ) n;

  select count(*) into unread
  from traccia.notifications where user_id = u.id and read_at is null;

  return jsonb_build_object('notifications', res, 'unread', unread);
end $$;

-- `need_write_user` rifiuta la sessione di sola lettura aperta dall'analista:
-- gli avvisi del cliente non si segnano come letti dall'occhio di chi guarda.
create or replace function traccia.mark_notifications_read(p_token text, p_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  n int;
begin
  if p_id is null then
    update traccia.notifications set read_at = now()
    where user_id = u.id and read_at is null;
  else
    update traccia.notifications set read_at = now()
    where user_id = u.id and id = p_id and read_at is null;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end $$;

revoke all on function traccia.my_notifications(text, int) from public;
revoke all on function traccia.mark_notifications_read(text, uuid) from public;
grant execute on function traccia.my_notifications(text, int) to anon, authenticated;
grant execute on function traccia.mark_notifications_read(text, uuid) to anon, authenticated;

-- ------------------------------------------- cruscotto con gli avvisi ------
create or replace function traccia.me_dashboard(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u      traccia.users := traccia.need_user(p_token);
  ops    jsonb;
  docs   jsonb;
  notif  jsonb;
  unread int;
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
      'read', n.read_at is not null,
      'created_at', extract(epoch from n.created_at)
    ) order by n.created_at desc), '[]'::jsonb)
  into notif
  from (
    select * from traccia.notifications
    where user_id = u.id
    order by created_at desc limit 20
  ) n;

  select count(*) into unread
  from traccia.notifications where user_id = u.id and read_at is null;

  return jsonb_build_object(
    'user', traccia.user_json(u),
    'case', jsonb_build_object(
      'ref', u.case_ref,
      'phase', u.case_phase,
      'phase_name', traccia.phase_name(u.case_phase),
      'phase_index', u.case_phase,
      'phases_total', 5,
      'percent', round((u.case_phase - 1)::numeric / 4 * 100),
      'amount_eur', u.case_amount_eur
    ),
    'operations', ops,
    'documents', docs,
    'documents_count', jsonb_array_length(docs),
    'notifications', notif,
    'unread', unread,
    'fees', (select value from traccia.settings where key = 'fees')
  );
end $$;

-- --------------------------------------------- wrapper in public -----------
-- PostgREST espone solo `public`: senza wrapper le funzioni non esistono.
create or replace function public.admin_set_phase(p_token text, p_id uuid, p_phase int,
  p_note text default null, p_notify boolean default true)
returns jsonb language sql security definer
set search_path = traccia, extensions as $$
  select traccia.admin_set_phase(p_token, p_id, p_phase, p_note, p_notify);
$$;

create or replace function public.my_notifications(p_token text, p_limit int default 20)
returns jsonb language sql security definer
set search_path = traccia, extensions as $$
  select traccia.my_notifications(p_token, p_limit);
$$;

create or replace function public.mark_notifications_read(p_token text, p_id uuid default null)
returns jsonb language sql security definer
set search_path = traccia, extensions as $$
  select traccia.mark_notifications_read(p_token, p_id);
$$;

revoke all on function public.admin_set_phase(text, uuid, int, text, boolean) from public;
revoke all on function public.my_notifications(text, int) from public;
revoke all on function public.mark_notifications_read(text, uuid) from public;
grant execute on function public.admin_set_phase(text, uuid, int, text, boolean) to anon, authenticated;
grant execute on function public.my_notifications(text, int) to anon, authenticated;
grant execute on function public.mark_notifications_read(text, uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
