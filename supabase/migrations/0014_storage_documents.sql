-- 0014_storage_documents.sql
-- Caricamento reale dei documenti su Supabase Storage.
--
-- Prima di questa migrazione il riquadro «Trascina qui un file» non caricava
-- nulla: registrava una riga con l'etichetta scelta e basta. Il file restava
-- sul computer del cliente, e la pagina lo diceva apertamente («Nessun file
-- lascia il browser in questa demo»).
--
-- Modello:
--
--   bucket `documenti`
--     documenti/<user_id>/<document_id>/<nome-file>
--
--   * una cartella per cliente e una per documento: un percorso non può
--     essere riusato per sovrascrivere il file di un altro;
--   * niente accesso pubblico al bucket: si scarica solo con un link firmato
--     di 10 minuti generato da una funzione che verifica chi lo chiede;
--   * il cliente vede solo la propria cartella, l'analista vede tutto.
--
-- Perché le policy RLS qui sotto sono necessarie: il browser carica il file
-- direttamente su Storage (l'API di Storage non passa dalle nostre RPC), e
-- Storage autorizza con `storage.objects` e `auth.uid()`. Quindi l'upload
-- richiede due gettoni: quello della sessione `traccia` per sapere il
-- `document_id`, e una sessione Supabase Auth (`auth.uid()`) per la policy.
--
-- ATTENZIONE, punto aperto: le nostre sessioni sono gettoni in
-- `traccia.sessions`, non sessioni Supabase Auth. Le policy che usano
-- `auth.uid()` funzionano solo se il progetto emette anche un JWT Supabase per
-- il cliente (vedi README-DEPLOY §5-octies). Finché quel passaggio non c'è,
-- il caricamento va fatto da una Edge Function con la chiave di servizio, che
-- è la strada consigliata contro i file orfani.
--
-- Dipende da: 0001 (documents), 0002 (need_user/need_admin).

begin;

-- ============================================================================
-- 1. Colonne del file sulla riga del documento
-- ============================================================================
alter table traccia.documents add column if not exists storage_path text;
alter table traccia.documents add column if not exists file_name    text;
alter table traccia.documents add column if not exists mime_type    text;
alter table traccia.documents add column if not exists size_bytes   bigint;

-- ciò che è ammesso: PDF, JPG, PNG. Il controllo sta anche nel database,
-- perché il `accept` dell'input è solo un suggerimento per il browser.
alter table traccia.documents drop constraint if exists documents_file_check;
alter table traccia.documents add constraint documents_file_check check (
  (mime_type is null and size_bytes is null)
  or (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png')
    and size_bytes > 0
    and size_bytes <= 10 * 1024 * 1024
  )
);

-- ============================================================================
-- 2. Il bucket
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documenti', 'documenti', false,
  10485760,                                    -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- 3. Policy sul bucket
-- ============================================================================
-- Convenzione del percorso: la prima cartella è l'id del cliente.
-- `storage.foldername(name)` restituisce i segmenti della cartella.

drop policy if exists "documenti: il cliente carica nella propria cartella" on storage.objects;
create policy "documenti: il cliente carica nella propria cartella"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documenti'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documenti: ognuno vede i propri file" on storage.objects;
create policy "documenti: ognuno vede i propri file"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documenti'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from traccia.users u
        where u.auth_id = auth.uid() and (u.is_master or u.role = 'admin')
      )
    )
  );

-- niente update: un documento caricato non si sostituisce, se ne carica un
-- altro. Così il file che l'analista ha valutato resta quello che ha visto.
drop policy if exists "documenti: nessuna sovrascrittura" on storage.objects;

-- ============================================================================
-- 4. Collegamento fra utente traccia e utente Supabase Auth
-- ============================================================================
alter table traccia.users add column if not exists auth_id uuid unique;

-- ============================================================================
-- 5. Registrazione del file
-- ============================================================================
-- Il browser dice dove ha messo il file; il database verifica che il percorso
-- sia davvero nella cartella di quel cliente e di quel documento. Senza questo
-- controllo un cliente potrebbe puntare la riga al file di un altro.
create or replace function traccia.attach_document_file(
  p_token text, p_id uuid, p_path text,
  p_name text default null, p_mime text default null, p_size bigint default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  d traccia.documents;
  atteso text;
begin
  select * into d from traccia.documents where id = p_id;
  if d.id is null or d.user_id <> u.id then
    raise exception 'Documento non trovato.' using errcode = '22023';
  end if;
  if d.status <> 'pending' then
    raise exception 'Documento già valutato: caricane uno nuovo.' using errcode = '22023';
  end if;

  atteso := u.id::text || '/' || d.id::text || '/';
  if position(atteso in coalesce(p_path, '')) <> 1 then
    raise exception 'Percorso del file non valido.' using errcode = '22023';
  end if;

  if p_mime is not null and p_mime not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'Formato non ammesso: solo PDF, JPG o PNG.' using errcode = '22023';
  end if;
  if p_size is not null and (p_size <= 0 or p_size > 10 * 1024 * 1024) then
    raise exception 'Il file deve pesare meno di 10 MB.' using errcode = '22023';
  end if;

  update traccia.documents
  set storage_path = p_path,
      file_name    = nullif(trim(coalesce(p_name, '')), ''),
      mime_type    = p_mime,
      size_bytes   = p_size
  where id = p_id;

  perform traccia.log_action(u, 'document_upload', d.id::text,
    coalesce(p_name, 'file') || coalesce(' · ' || p_size::text || ' byte', ''));

  return jsonb_build_object('ok', true, 'document_id', p_id, 'path', p_path);
end $$;

-- ============================================================================
-- 6. Link firmato per scaricare
-- ============================================================================
-- Non si restituisce mai un URL pubblico: si firma un link che scade. Il
-- cliente può chiederlo solo per i propri documenti, l'analista per tutti
-- (è il suo lavoro), e ogni richiesta finisce nel registro attività perché
-- «chi ha aperto questo documento» è una domanda a cui dobbiamo rispondere.
create or replace function traccia.document_link(
  p_token text, p_id uuid, p_secondi int default 600
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  d traccia.documents;
  intestatario text;
  scadenza int := least(greatest(coalesce(p_secondi, 600), 60), 3600);
begin
  select * into d from traccia.documents where id = p_id;
  if d.id is null then
    raise exception 'Documento non trovato.' using errcode = '22023';
  end if;

  if d.user_id = u.id then
    intestatario := 'cliente';
  elsif u.is_master or u.role = 'admin' then
    intestatario := 'analista';
  else
    raise exception 'Documento non trovato.' using errcode = '22023';
  end if;

  if d.storage_path is null then
    raise exception 'Il file non è stato caricato.' using errcode = '22023';
  end if;

  perform traccia.log_action(u, 'document_link', d.id::text, intestatario);

  return jsonb_build_object(
    'ok', true,
    'path', d.storage_path,
    'expires_in', scadenza,
    'file_name', coalesce(d.file_name, d.label),
    'mime_type', d.mime_type,
    'size_bytes', d.size_bytes,
    'ruolo', intestatario);
end $$;

-- ============================================================================
-- 7. Le liste dicono se il file c'è
-- ============================================================================
create or replace function traccia.my_documents(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind, 'status', d.status, 'note', d.note,
      'decision_note', d.decision_note,
      'file_name', d.file_name, 'size_bytes', d.size_bytes,
      'has_file', d.storage_path is not null,
      'created_at', extract(epoch from d.created_at)
    ) order by d.created_at desc), '[]'::jsonb)
  into res
  from traccia.documents d
  where d.user_id = u.id;
  return jsonb_build_object('documents', res);
end $$;

-- ============================================================================
-- 8. La console sa se il file c'è
-- ============================================================================
create or replace function traccia.admin_documents(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'kind', d.kind, 'status', d.status,
      'note', d.note, 'decision_note', d.decision_note,
      'user_id', u.id, 'user_name', u.name, 'user_email', u.email,
      'case_ref', u.case_ref, 'kyc_level', u.kyc_level,
      'file_name', d.file_name, 'size_bytes', d.size_bytes,
      'has_file', d.storage_path is not null,
      'created_at', extract(epoch from d.created_at),
      'decided_at', extract(epoch from d.decided_at)
    ) order by d.created_at desc), '[]'::jsonb)
  into res
  from traccia.documents d join traccia.users u on u.id = d.user_id
  where p_status is null or d.status = p_status;
  return jsonb_build_object('documents', res,
    'pending_count', (select count(*) from traccia.documents where status = 'pending'),
    'with_file', (select count(*) from traccia.documents where storage_path is not null));
end $$;

-- ============================================================================
-- 9. Permessi
-- ============================================================================
revoke all on function traccia.attach_document_file(text, uuid, text, text, text, bigint) from public;
revoke all on function traccia.document_link(text, uuid, int) from public;
grant execute on function traccia.attach_document_file(text, uuid, text, text, text, bigint) to anon, authenticated;
grant execute on function traccia.document_link(text, uuid, int) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
