-- ============================================================================
-- 0028 — La pratica racconta solo cose vere
-- ============================================================================
-- Il difetto che questa migrazione chiude è stato visto da un cliente, non da
-- un test: nella sua area riservata comparivano «12 mar» e «24 mar» con
-- «2 punti di aggancio», e la fase 03 di 05 già avviata — su una pratica
-- aperta a novembre. Quelle date non erano nel database: erano **scritte a
-- mano nell'HTML** della pagina.
--
-- Non basta togliere l'HTML finto. Perché la pagina possa raccontare la
-- storia vera, la storia deve esistere: fino a ieri `users.case_phase` era
-- una colonna, cioè solo il presente. Da qui in avanti ogni cambio di fase
-- lascia una riga in `traccia.case_events`, con la data, chi l'ha fatto e la
-- nota. Il passato non si può ricostruire — e non si inventa.
--
-- Contenuto:
--   1. `traccia.case_events` — la storia delle fasi (e la nascita della
--      pratica, che è l'evento zero e non può precedere la registrazione);
--   2. un vincolo che rende **impossibile** una data anteriore alla
--      registrazione, e uno che vieta il futuro;
--   3. `me_dashboard` arricchita con la storia: date in ISO, perché sia il
--      browser a decidere il formato;
--   4. `admin_richiesta_imposta` — cambio di stato da console con la nota
--      scritta nella stessa riga, non in un modale.
-- ============================================================================

-- ------------------------------------------------------------- la storia ---
create table if not exists traccia.case_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references traccia.users(id) on delete cascade,
  /* 0 = pratica aperta; 1..5 = le fasi. Lo zero esiste perché «quando è
     nata» e «quando è passata alla fase 1» possono essere due momenti
     diversi, e il cliente ha diritto di sapere tutte e due. */
  phase       smallint not null check (phase between 0 and 5),
  note        text,
  actor_id    uuid references traccia.users(id) on delete set null,
  actor_email text,
  created_at  timestamptz not null default now()
);

create index if not exists case_events_user_idx
  on traccia.case_events (user_id, created_at desc);

comment on table traccia.case_events is
  'La storia della pratica: quando è nata e ogni passaggio di fase, con chi lo ha fatto. Sostituisce la cronologia scritta a mano in app.html.';

/* Una data vera: non prima che la persona esista, non nel futuro.
   Il vincolo sta qui e non solo nel codice perché un evento datato marzo su
   una pratica di novembre è esattamente il difetto che questa migrazione
   chiude, e deve restare impossibile anche per chi scrive a mano nel
   database fra sei mesi. */
create or replace function traccia.case_event_valido() returns trigger
language plpgsql as $$
declare
  nato timestamptz;
begin
  select created_at into nato from traccia.users where id = new.user_id;
  if nato is null then
    raise exception 'Evento su una pratica inesistente.' using errcode = '23503';
  end if;
  if new.created_at < nato then
    raise exception 'Data anteriore alla registrazione (pratica nata il %).', to_char(nato, 'YYYY-MM-DD HH24:MI')
      using errcode = '22007';
  end if;
  if new.created_at > now() + interval '5 minutes' then
    raise exception 'Evento nel futuro: una pratica non può raccontare cose che non sono ancora successe.'
      using errcode = '22007';
  end if;
  return new;
end $$;

drop trigger if exists case_events_valido on traccia.case_events;
create trigger case_events_valido
  before insert or update on traccia.case_events
  for each row execute function traccia.case_event_valido();

/* RLS: nessun accesso diretto. Si legge e si scrive solo dalle funzioni
   `security definer`, come per ogni altra tabella del progetto. */
alter table traccia.case_events enable row level security;

-- --------------------------------------------- la nascita, per chi esiste ---
/* Le pratiche già aperte non hanno storia. Inventarla sarebbe peggio che
   non averla: l'unica cosa che sappiamo davvero è quando sono nate — cioè
   `users.created_at` — e la fase in cui sono adesso, che però non sappiamo
   *quando* è stata raggiunta. Quindi si registra solo l'evento zero, con la
   data vera di nascita, e la fase attuale resta quella che è senza una data
   finta. */
insert into traccia.case_events (user_id, phase, note, created_at)
select u.id, 0, 'Pratica aperta', u.created_at
from traccia.users u
where u.role = 'user'
  and not exists (select 1 from traccia.case_events e where e.user_id = u.id);

/* Chi nasce da qui in avanti ha l'evento zero automatico, alla stessa ora
   della registrazione: due verità su quando è nata una pratica sono una di
   troppo. */
create or replace function traccia.case_event_nascita() returns trigger
language plpgsql as $$
begin
  if new.role = 'user' then
    insert into traccia.case_events (user_id, phase, note, created_at)
    values (new.id, 0, 'Pratica aperta', new.created_at);
  end if;
  return new;
end $$;

drop trigger if exists case_events_nascita on traccia.users;
create trigger case_events_nascita
  after insert on traccia.users
  for each row execute function traccia.case_event_nascita();

-- ------------------------------------------------------- dove si registra ---
/* `admin_set_phase` cambia la fase: da ora scrive anche la storia. Il resto
   del comportamento — i controlli, l'avviso al cliente, il registro — resta
   identico, perché è già giusto e non è quello che va corretto. */
create or replace function traccia.admin_set_phase(
  p_token text, p_id uuid, p_phase integer,
  p_note text default null, p_notify boolean default true
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a     traccia.users := traccia.need_admin(p_token);
  t     traccia.users;
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

  /* la storia: una riga per ogni passaggio, con chi lo ha fatto */
  insert into traccia.case_events (user_id, phase, note, actor_id, actor_email)
  values (p_id, p_phase::smallint, nullif(trim(coalesce(p_note, '')), ''), a.id, a.email);

  -- il registro dice sempre da dove a dove, e in che direzione
  perform traccia.log_action(a, 'phase_change', t.email,
    traccia.phase_name(from_phase) || ' → ' || traccia.phase_name(p_phase) ||
    case when p_note is null or trim(p_note) = '' then '' else ' · ' || trim(p_note) end);

  -- il cliente lo vede nell'area riservata: la fase è ciò che guarda
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

-- ----------------------------------------------------------- il cliente ----
/* `me_dashboard` è la funzione che riempie `app.html`. Cambia in due punti e
   in nessun altro: la pratica porta con sé la storia, e i documenti portano
   la data in ISO invece che in un formato già deciso qui.
   Tutto il resto resta com'era. */
create or replace function traccia.me_dashboard(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  ops jsonb;
  docs jsonb;
  storia jsonb;
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

  /* La storia. `data` in ISO: chi la mostra decide il formato, e nessuno si
     ritrova «12 mar» senza l'anno. */
  select coalesce(jsonb_agg(jsonb_build_object(
      'phase', e.phase,
      'phase_name', case when e.phase = 0 then 'Pratica aperta'
                         else phase_names[greatest(1, least(5, e.phase))] end,
      'note', e.note,
      'quando', to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'chi', e.actor_email
    ) order by e.created_at), '[]'::jsonb)
  into storia
  from traccia.case_events e where e.user_id = u.id;

  return jsonb_build_object(
    'user', traccia.user_json(u),
    'case', jsonb_build_object(
      'ref', u.case_ref,
      'phase', u.case_phase,
      'phase_name', phase_names[greatest(1, least(5, u.case_phase))],
      'phase_index', u.case_phase,
      'phases_total', 5,
      'percent', round((u.case_phase - 1)::numeric / 4 * 100),
      'amount_eur', u.case_amount_eur,
      /* quando la pratica è nata: è la data più vecchia che questa pagina
         può mostrare, e serve alla pagina per non mostrarne di più vecchie */
      'aperta_il', to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'storia', storia
    ),
    'operations', ops,
    'documents', docs,
    'documents_count', jsonb_array_length(docs),
    'fees', (select value from traccia.settings where key = 'fees')
  );
end $$;

-- ------------------------------------------------------------ la console ---
/* Un solo cambio di stato, con la nota nello stesso gesto: prima erano due
   passaggi (bottone, poi prompt) e il secondo si poteva annullare lasciando
   il primo fatto. `p_note` vuoto **non cancella** la nota esistente: la
   scrive solo chi la scrive. */
create or replace function traccia.admin_richiesta_imposta(
  p_token text, p_id uuid, p_status text, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  r traccia.richieste;
  nota text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_status not in ('new','contacted','account','closed','denied') then
    raise exception 'Stato non valido.' using errcode = '22023';
  end if;
  select * into r from traccia.richieste where id = p_id;
  if r.id is null then
    raise exception 'Richiesta non trovata.' using errcode = '22023';
  end if;

  update traccia.richieste set
    status = p_status,
    note = coalesce(nota, note),
    taken_by = coalesce(taken_by, a.id),
    taken_at = coalesce(taken_at, now()),
    updated_at = now()
  where id = p_id;

  perform traccia.log_action(a, 'richiesta_' || p_status, r.email, nota);
  return jsonb_build_object('ok', true, 'status', p_status, 'note', coalesce(nota, r.note));
end $$;

revoke all on function traccia.admin_richiesta_imposta(text, uuid, text, text) from public;
grant execute on function traccia.admin_richiesta_imposta(text, uuid, text, text) to anon, authenticated;

-- ------------------------------------------------------- superficie public ---
create or replace function public.admin_richiesta_imposta(
  p_token text, p_id uuid, p_status text, p_note text default null
) returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.admin_richiesta_imposta(p_token, p_id, p_status, p_note);
$$;
revoke all on function public.admin_richiesta_imposta(text, uuid, text, text) from public;
grant execute on function public.admin_richiesta_imposta(text, uuid, text, text) to anon, authenticated;

-- `me_dashboard` è già esposta in `public` da 0017; la funzione cambiata è
-- quella di `traccia`, quindi l'involucro continua a funzionare. Lo si
-- ricrea comunque per non dipendere dall'ordine delle migrazioni.
create or replace function public.me_dashboard(p_token text)
returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.me_dashboard(p_token);
$$;
revoke all on function public.me_dashboard(text) from public;
grant execute on function public.me_dashboard(text) to anon, authenticated;
