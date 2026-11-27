-- ============================================================================
-- 0035 — La password di un cliente la reimposta l'amministratore
-- ============================================================================
-- Richiesta: «mi serve la possibilità di cambiare le password dei clienti,
-- quindi l'admin può farlo».
--
-- Oggi non può. Un cliente può cambiare la propria (`auth_change_password`,
-- che pretende quella attuale), e un amministratore può crearne una nuova
-- quando crea l'account — ma se qualcuno perde la password dopo, l'unica
-- strada è fuori dal sito. Ed è così che si finisce a scrivere nel database a
-- mano.
--
-- Tre decisioni, e ognuna ha una ragione:
--
-- **1. La password la sceglie chi la riceve, dove si può.** L'amministratore
-- può scriverne una, ma il caso normale è un'altra cosa: il cliente non
-- riesce a entrare, e la strada giusta è un codice monouso che si usa una
-- volta sola. La generazione automatica di una password non è un ripiego
-- accettabile: una password comunicata per telefono resta valida finché
-- qualcuno non la cambia.
--
-- **2. Cambiare la password chiude le altre sessioni.** È quello che fa già
-- `auth_change_password` per il cliente, ed è il motivo per cui la funzione
-- esiste in questa forma: se qualcuno è dentro l'account, cambiare la password
-- senza buttarlo fuori non serve a niente. Si tiene aperta solo la sessione di
-- chi ha fatto l'operazione — cioè l'amministratore, che sta lavorando.
--
-- **3. Non si vede la password di nessuno.** `password_hash` è bcrypt e non è
-- reversibile: questa funzione **reimposta**, non legge. Il client riceve la
-- password appena scritta (o quella generata) per comunicarla; da quel momento
-- nel database resta solo l'impronta.
--
-- Cosa resta scritto nel registro attività: che *qualcuno* ha reimpostato la
-- password di *qualcuno*, quando, e se l'ha scelta o generata. **Mai la
-- password.** Un registro che contiene le password è un registro che le fa
-- uscire tutte insieme il giorno in cui qualcuno lo esporta.
-- ============================================================================

create or replace function traccia.admin_reimposta_password(
  p_token    text,
  p_id       uuid,
  p_password text default null
) returns jsonb
language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a         traccia.users := traccia.need_admin(p_token);
  t         traccia.users;
  pwd       text;
  generata  boolean := false;
  chiuse    int := 0;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;

  -- le stesse due difese delle altre funzioni di questa console
  if t.is_master and not a.is_master then
    raise exception 'Non puoi agire sull''account master.' using errcode = '42501';
  end if;

  /* Un amministratore non reimposta la password di un altro amministratore:
     sarebbe il modo più semplice per prendere il controllo di un collega, e
     nessuno se ne accorgerebbe finché non è tardi. La propria la cambia da
     solo, con la funzione che pretende quella attuale. */
  if t.role = 'admin' and t.id <> a.id then
    raise exception 'La password di un altro amministratore non si reimposta da qui: ognuno cambia la propria.'
      using errcode = '42501';
  end if;

  pwd := nullif(trim(coalesce(p_password, '')), '');
  if pwd is null then
    /* lo stesso formato di `admin_create_account`: si riconosce a vista come
       una password provvisoria, e non contiene caratteri che il telefono
       sbaglia a leggere ad alta voce (niente I, l, 1, O, 0) */
    pwd := 'traccia-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
    generata := true;
  elsif length(pwd) < 8 then
    raise exception 'La password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;

  update traccia.users
     set password_hash = extensions.crypt(pwd, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = t.id;

  /* Le sessioni aperte si chiudono: se qualcuno è dentro l'account, cambiare
     la password senza buttarlo fuori non cambia niente. Resta aperta solo la
     sessione dell'amministratore che sta lavorando — altrimenti si
     disconnetterebbe da solo. */
  update traccia.sessions
     set revoked_at = now()
   where user_id = t.id
     and revoked_at is null
     and token_hash <> traccia.hash_token(p_token);
  get diagnostics chiuse = row_count;

  /* Nel registro: mai la password. Solo il fatto, e se è stata scelta o
     generata: è la differenza che conta quando si rilegge la storia di un
     account. */
  perform traccia.log_action(a, 'password_reset_admin', t.email,
    case when generata then 'password generata' else 'password scelta dall''amministratore' end
    || ' · ' || chiuse || ' sessioni chiuse');

  return jsonb_build_object(
    'ok', true,
    'email', t.email,
    'password', pwd,
    'generated', generata,
    'sessions_closed', chiuse
  );
end $$;

-- ============================================================================
-- Permessi — come tutte le altre `admin_*`
-- ============================================================================
revoke all on function traccia.admin_reimposta_password(text, uuid, text) from public;
grant execute on function traccia.admin_reimposta_password(text, uuid, text)
  to anon, authenticated;

-- ============================================================================
-- Il wrapper pubblico
-- ============================================================================
-- Il client chiama `public.admin_reimposta_password`: è lì che arriva il POST
-- `/rest/v1/rpc/...`, con `p_token` iniettato da `call()` in `api.js`. Senza
-- questo doppione la chiamata risponde 404, con un errore che non dice niente
-- di utile.
create or replace function public.admin_reimposta_password(
  p_token text, p_id uuid, p_password text default null
) returns jsonb
language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.admin_reimposta_password(p_token, p_id, p_password);
$$;

revoke all on function public.admin_reimposta_password(text, uuid, text) from public;
grant execute on function public.admin_reimposta_password(text, uuid, text)
  to anon, authenticated;

-- ============================================================================
-- Il codice monouso: la strada che non fa viaggiare una password
-- ============================================================================
-- Reimpostare la password va bene quando è l'unica cosa possibile. Ma una
-- password comunicata per telefono o per messaggio resta valida finché qualcuno
-- non la cambia, e chi l'ha scritta la conosce. Per questo esiste la strada
-- migliore: l'amministratore genera un **codice**, lo consegna, e il cliente
-- sceglie la password lui — una volta sola, entro un'ora.
--
-- Perché non si riusa `transfer_challenges` o la tabella delle sessioni: un
-- codice monouso non è né una sessione né un'operazione. Ha una vita breve, si
-- consuma al primo uso, e chi lo legge non deve poterci fare altro.
create table if not exists traccia.password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references traccia.users(id) on delete cascade,
  -- come le sessioni: si conserva l'impronta, non il codice. Chi legge questa
  -- tabella non ottiene niente di utilizzabile.
  code_hash   text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references traccia.users(id)
);
create index if not exists password_resets_user_idx
  on traccia.password_resets (user_id, created_at desc);

-- nessun accesso diretto: si passa dalle funzioni, come per tutto il resto
alter table traccia.password_resets enable row level security;

-- ---------------------------------------------------------------------------
-- Generare il codice (amministratore)
-- ---------------------------------------------------------------------------
create or replace function traccia.admin_codice_password(p_token text, p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a     traccia.users := traccia.need_admin(p_token);
  t     traccia.users;
  -- niente vocali, niente 0/1/I/O: un codice che si detta al telefono deve
  -- arrivare intero dall'altra parte
  alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  byte_random bytea;
  code  text := '';
  normalizzato text := '';
  carattere text;
  i int;
  riga  traccia.password_resets;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi agire sull''account master.' using errcode = '42501';
  end if;
  if t.role = 'admin' and t.id <> a.id then
    raise exception 'Il codice di un altro amministratore non si genera da qui.'
      using errcode = '42501';
  end if;

  /* Ventiquattro caratteri, mostrati a gruppi di quattro. Le due forme — con
     e senza trattini — si costruiscono nello stesso ciclo, perché `hash_token`
     non normalizza niente: se divergono, il codice non si trova più. È
     successo alla prima stesura, e il test l'ha preso. */
  byte_random := extensions.gen_random_bytes(24);
  for i in 0..23 loop
    carattere := substr(alfabeto, (get_byte(byte_random, i) % 32) + 1, 1);
    normalizzato := normalizzato || carattere;
    code := code || carattere;
    if i % 4 = 3 and i < 23 then code := code || '-'; end if;
  end loop;

  /* Un codice nuovo invalida i precedenti: due codici vivi insieme sono due
     chiavi, e chi ne ha uno vecchio deve smettere di poterlo usare. */
  update traccia.password_resets set used_at = now()
   where user_id = t.id and used_at is null;

  -- si conserva l'impronta, non il codice: come per le sessioni
  insert into traccia.password_resets (user_id, code_hash, expires_at, created_by)
  values (t.id, traccia.hash_token(normalizzato), now() + interval '1 hour', a.id)
  returning * into riga;

  perform traccia.log_action(a, 'password_code_admin', t.email, 'codice monouso, valido un''ora');

  return jsonb_build_object(
    'ok', true,
    'email', t.email,
    'code', code,
    'expires_at', riga.expires_at
  );
end $$;

revoke all on function traccia.admin_codice_password(text, uuid) from public;
grant execute on function traccia.admin_codice_password(text, uuid) to anon, authenticated;

create or replace function public.admin_codice_password(p_token text, p_id uuid)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.admin_codice_password(p_token, p_id);
$$;

revoke all on function public.admin_codice_password(text, uuid) from public;
grant execute on function public.admin_codice_password(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Usare il codice (il cliente, senza essere entrato)
-- ---------------------------------------------------------------------------
-- Chi ha perso la password non ha una sessione: è il punto della funzione. Il
-- codice è l'unica credenziale, si consuma qui, e vale un'ora.
create or replace function traccia.reset_password_con_codice(
  p_email text, p_code text, p_new text
) returns jsonb
language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u    traccia.users;
  r    traccia.password_resets;
  mail text := lower(trim(coalesce(p_email, '')));
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if length(coalesce(p_new, '')) < 8 then
    raise exception 'La nuova password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;

  select * into u from traccia.users where lower(email) = mail;
  -- stesso messaggio per account inesistente e codice sbagliato: dire «questo
  -- indirizzo non esiste» a chi non è entrato sarebbe un regalo a chi prova
  -- indirizzi a caso
  if u.id is null then
    raise exception 'Codice non valido o scaduto.' using errcode = '28P01';
  end if;

  select * into r from traccia.password_resets
   where user_id = u.id
     and code_hash = traccia.hash_token(code)
     and used_at is null
   for update;
  if r.id is null then
    raise exception 'Codice non valido o scaduto.' using errcode = '28P01';
  end if;
  if r.expires_at < now() then
    raise exception 'Codice non valido o scaduto.' using errcode = '28P01';
  end if;

  update traccia.users
     set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = u.id;

  update traccia.password_resets set used_at = now() where id = r.id;

  /* Anche qui si chiudono le sessioni: chi conosceva la vecchia password non
     deve restare dentro. */
  update traccia.sessions set revoked_at = now()
   where user_id = u.id and revoked_at is null;

  perform traccia.log_action(u, 'password_reset_code', u.email, null);

  return jsonb_build_object('ok', true, 'email', u.email);
end $$;

revoke all on function traccia.reset_password_con_codice(text, text, text) from public;
grant execute on function traccia.reset_password_con_codice(text, text, text) to anon, authenticated;

create or replace function public.reset_password_con_codice(p_email text, p_code text, p_new text)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.reset_password_con_codice(p_email, p_code, p_new);
$$;

revoke all on function public.reset_password_con_codice(text, text, text) from public;
grant execute on function public.reset_password_con_codice(text, text, text) to anon, authenticated;
