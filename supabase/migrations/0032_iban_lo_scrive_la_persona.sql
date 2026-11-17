-- ============================================================================
-- 0032 — L'IBAN lo scrive una persona, non il database
-- ============================================================================
-- Il difetto, visto dal cliente: aprendo la sua area trovava un IBAN italiano
-- **che non era il suo**. Nessuno lo aveva scritto — lo aveva inventato il
-- database. I punti erano quattro, ma le funzioni tre: `auth_register` è stata
-- riscritta due volte (0002, poi 0023) e generava l'IBAN in entrambe; gira
-- l'ultima.
--
--   0023:147  traccia.auth_register                  registrazione
--   0004:98   traccia.admin_create_account          creazione da console
--   0024:371  traccia.admin_crea_account_da_richiesta  da una richiesta
--
-- `make_iban()` costruisce un IBAN *plausibile*: ABI veri, CIN calcolato,
-- checksum corretto. È verosimile al punto che nessuno se ne accorge, ed è
-- esattamente per questo che è pericoloso: sta su una pagina dove il cliente
-- aspetta dei soldi, e sembra la sua coordinata bancaria.
--
-- Contenuto (tre funzioni corrette, non sette: il resto sono grant e registro):
--   1. i tre inserimenti non lo generano più: l'IBAN nasce vuoto e lo
--      scrive una persona — il cliente dal suo modulo, o il master dalla
--      console;
--   2. `make_iban` resta **solo per gli ambienti di prova**, sotto un nome che
--      lo dice (`make_iban_di_prova`): un nome che si legge in un `insert` di
--      produzione e fa fermare chi lo rivede;
--   3. `admin_imposta_iban` — la console può finalmente scrivere l'IBAN di un
--      cliente, che è ciò che `imposta_iban` prometteva da mesi («con un saldo
--      attivo si cambia solo con l'assistenza») senza che lo strumento
--      esistesse;
--   4. gli IBAN già generati vengono azzerati: sono tutti finti, nessuno
--      verificato, e lasciarli significa lasciare in pagina la bugia.
--
-- Cosa **non** cambia, di proposito:
--   - il cliente continua a scrivere il proprio IBAN da `app.html`;
--   - con un saldo attivo il cliente **non** lo cambia da solo: lo cambia il
--     master. È la regola che c'era già, e adesso ha una via d'uscita vera
--     invece di un messaggio d'errore che manda a un ufficio senza strumenti;
--   - ogni cambio azzera la verifica: un IBAN nuovo non è un IBAN verificato.
-- ============================================================================

-- ------------------------------------------------------------ i tre punti ---
/* Sono tre, non quattro: `auth_register` generava l'IBAN in due versioni
   diverse (0002 e 0023), e l'ultima — la 0023 — è quella che gira. Riscrivere
   entrambe sarebbe stato inutile, riscrivere quella sbagliata sarebbe stato
   peggio: si riscrive la versione che vince, con la firma che ha davvero.

   Si riscrivono le funzioni intere perché in plpgsql non c'è modo di togliere
   un valore da un `insert` senza riscriverla. Il resto del corpo è identico
   all'originale: questa migrazione cambia una cosa sola. */

/* --- la firma che gira davvero: quella della 0024 ------------------------
   `auth_register` ha tre versioni e ognuna ha parametri diversi (è
   l'overloading di Postgres: tre funzioni con lo stesso nome). Quella che
   serve al sito è **questa**: il wrapper `public.auth_register` della 0024
   chiama `traccia.auth_register(p_first_name, p_last_name, p_email, p_phone,
   p_amount_eur, p_situation, p_message, p_origine)` — **ordine diverso** da
   quello della 0023, che comincia con `p_name, p_email, p_password`. Una migrazione
   che avesse corretto solo la firma della 0023 non avrebbe cambiato niente:
   è un'altra funzione, e non la chiama nessuno.
   Il corpo è quello della 0024, identico: cambia solo l'`insert`. */
create or replace function traccia.auth_register(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_amount_eur numeric,
  p_situation  text default null,
  p_message    text default null,
  p_origine    text default 'login'
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail   text := lower(trim(coalesce(p_email, '')));
  nome   text := trim(coalesce(p_first_name, ''));
  cognome text := trim(coalesce(p_last_name, ''));
  tel    text := nullif(trim(coalesce(p_phone, '')), '');
  row_id uuid;
begin
  /* --- i cinque dati, nell'ordine in cui il modulo li chiede ----------- */
  if length(nome) < 2 then
    raise exception 'Inserisci il nome.' using errcode = '22023';
  end if;
  if length(cognome) < 2 then
    raise exception 'Inserisci il cognome.' using errcode = '22023';
  end if;
  if mail = '' or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if tel is null then
    raise exception 'Inserisci un numero di telefono.' using errcode = '22023';
  end if;
  if not traccia.telefono_valido(tel) then
    raise exception 'Il numero di telefono non sembra valido: controlla le cifre.'
      using errcode = '22023';
  end if;
  if p_amount_eur is null or p_amount_eur <= 0 then
    raise exception 'Indica l''importo approssimativo che hai perso.'
      using errcode = '22023';
  end if;
  if p_amount_eur > 100000000 then
    raise exception 'L''importo indicato è troppo alto: controlla le cifre.'
      using errcode = '22023';
  end if;

  insert into traccia.richieste
    (first_name, last_name, email, phone, amount_eur, situation, message, origine)
  values
    (nome, cognome, mail, tel, round(p_amount_eur, 2),
     nullif(trim(coalesce(p_situation, '')), ''),
     nullif(trim(coalesce(p_message, '')), ''),
     coalesce(nullif(trim(coalesce(p_origine, '')), ''), 'login'))
  returning id into row_id;

  insert into traccia.audit (actor_email, action, target, note)
  values (mail, 'richiesta', row_id::text, 'Richiesta di informazioni dal sito');

  return jsonb_build_object(
    'ok', true,
    'richiesta', row_id,
    'message', 'Richiesta ricevuta. Ti ricontattiamo entro 48 ore lavorative al numero che ci hai indicato.'
  );
end $$;

/* il grant è per la firma, non per il nome: senza questa riga la funzione
   esiste e il sito non può chiamarla — ed è il modo più silenzioso di
   rompere una registrazione */
revoke all on function traccia.auth_register(text, text, text, text, numeric, text, text, text) from public;
grant execute on function traccia.auth_register(text, text, text, text, numeric, text, text, text)
  to anon, authenticated;

-- 2. creazione da console (0004)
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
                             balance_eur, case_ref, case_amount_eur, case_phase)
  values (mail, extensions.crypt(pwd, extensions.gen_salt('bf', 10)), trim(p_name),
          case when p_role = 'admin' then 'admin' else 'user' end,
          case when p_status = 'pending' then 'pending' else 'active' end,
          greatest(1, least(3, coalesce(p_kyc_level, 1))),
          coalesce(p_balance_eur, 0),
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

-- 3. richiesta senza account (0024)
create or replace function traccia.admin_crea_account_da_richiesta(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  r traccia.richieste;
  nuovo uuid;
begin
  select * into r from traccia.richieste where id = p_id;
  if r.id is null then
    raise exception 'Richiesta non trovata.' using errcode = '22023';
  end if;
  if r.user_id is not null then
    raise exception 'Questa richiesta ha già un account.' using errcode = '22023';
  end if;
  if exists (select 1 from traccia.users where lower(email) = lower(r.email)) then
    raise exception 'Esiste già un account con questa email.' using errcode = '23505';
  end if;

  insert into traccia.users (
    email, password_hash, name, first_name, last_name, phone,
    case_amount_eur, role, status, kyc_level
  ) values (
    lower(r.email), '', r.first_name || ' ' || r.last_name, r.first_name, r.last_name,
    r.phone, r.amount_eur, 'user', 'active', 1
  ) returning id into nuovo;

  update traccia.richieste
  set user_id = nuovo, status = 'account', taken_by = coalesce(taken_by, a.id),
      taken_at = coalesce(taken_at, now()), updated_at = now()
  where id = p_id;

  perform traccia.log_action(a, 'account_da_richiesta', lower(r.email), null);
  return jsonb_build_object('ok', true, 'user_id', nuovo);
end $$;

-- ------------------------------------------------- il generatore, solo in prova ---
/* La funzione esiste ancora perché serve agli ambienti di prova, ma il nome
   scoraggia l'uso in produzione e dice cosa è: un IBAN inventato. Chi la
   incontra in un `insert` vero se ne accorge leggendo. */
create or replace function traccia.make_iban_di_prova()
returns text language plpgsql volatile
set search_path = traccia, public, extensions as $$
begin
  return traccia.make_iban();
end $$;

comment on function traccia.make_iban_di_prova() is
  'IBAN italiano inventato: solo per ambienti di prova. Un IBAN in produzione lo scrive il cliente o il master.';

revoke all on function traccia.make_iban_di_prova() from public;
revoke all on function traccia.make_iban() from public;

-- ------------------------------------------- l'IBAN scritto dalla console ---
/* La funzione che mancava. `imposta_iban` (0015) diceva al cliente «con un
   saldo attivo l'IBAN si cambia solo con l'assistenza»: vera come promessa,
   falsa come possibilità, perché l'assistenza non aveva lo strumento.
   Qui usa **gli stessi controlli** del percorso cliente — normalizzazione,
   lunghezza, codice paese, intestatario — invece di ricopiarli: due
   validazioni diverse sullo stesso dato sono due bugie che si contraddicono. */
create or replace function traccia.admin_imposta_iban(
  p_token text, p_id uuid, p_iban text, p_intestatario text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
  pulito text;
  intestatario text;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;
  /* la stessa regola che vale altrove in questa console: un amministratore
     non tocca l'account master */
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;

  pulito := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(pulito) < 15 or length(pulito) > 34 or pulito !~ '^[A-Z]{2}[0-9]{2}' then
    raise exception 'IBAN non valido: servono almeno 15 caratteri e deve iniziare con il codice paese.'
      using errcode = '22023';
  end if;

  /* l'intestatario, se non arriva dalla console, è quello già in archivio; se
     non c'è nemmeno lì, si ferma tutto: un IBAN senza intestatario è un IBAN
     che la banca rifiuterà, e scoprirlo un mese dopo è peggio che dirlo ora */
  intestatario := nullif(btrim(coalesce(p_intestatario, '')), '');
  if intestatario is null then
    intestatario := nullif(btrim(coalesce(t.iban_holder, '')), '');
  end if;
  if intestatario is null or length(intestatario) < 3 then
    raise exception 'Indica l''intestatario del conto.' using errcode = '22023';
  end if;

  /* la verifica cade sempre: un IBAN cambia, e un IBAN nuovo non è verificato.
     È la protezione contro il dirottamento — chi entra nell'account del
     cliente non deve poter spostare i soldi su un conto suo restando «ok». */
  update traccia.users
     set iban = pulito,
         iban_holder = intestatario,
         iban_verified_at = null
   where id = p_id;

  /* il registro dice **da che valore a che valore**: un registro che scrive
     «modificato» non serve a ricostruire niente, e questo è il campo su cui
     passano i soldi */
  perform traccia.log_action(a, 'iban_set_by_staff', t.email,
    coalesce(t.iban, '—') || ' → ' || pulito);

  return jsonb_build_object('ok', true, 'iban', pulito, 'iban_holder', intestatario);
end $$;

revoke all on function traccia.admin_imposta_iban(text, uuid, text, text) from public;
grant execute on function traccia.admin_imposta_iban(text, uuid, text, text)
  to anon, authenticated;

-- ----------------------------------------------------- il wrapper pubblico ---
/* Il client parla solo con `public.*`. Si aggiunge il wrapper con lo stesso
   schema degli altri (vedi 0003/0004). */
drop function if exists public.admin_imposta_iban(text, uuid, text, text);
create function public.admin_imposta_iban(
  p_token text, p_id uuid, p_iban text, p_intestatario text default null
) returns jsonb language sql security definer
set search_path = public, traccia as $$
  select traccia.admin_imposta_iban(p_token, p_id, p_iban, p_intestatario);
$$;

revoke all on function public.admin_imposta_iban(text, uuid, text, text) from public;
grant execute on function public.admin_imposta_iban(text, uuid, text, text)
  to anon, authenticated;

-- ------------------------------------- gli IBAN inventati se ne vanno ---
/* Vanno azzerati, non corretti: sono tutti di `make_iban`, e nessuno è
   verificato (nessuno li ha mai scritti davvero). Un IBAN finto che resta in
   pagina è peggio di nessun IBAN, perché il cliente crede di avere le
   coordinate già a posto.
   Si azzerano solo quelli con `iban_verified_at is null` — cioè quelli che
   nessuno ha confermato: se un cliente ha inserito il suo (e quindi la verifica
   è caduta lo stesso, ma il valore è vero) non lo si tocca senza saperlo.
   La condizione che li distingue davvero è che nessuno li ha scritti: il
   registro delle attività sa chi ha fatto `iban_set`. Quelli che non compaiono
   sono quelli generati alla nascita dell'account. */
do $$
declare
  n int;
begin
  with scritti as (
    select distinct u.id
    from traccia.users u
    join traccia.audit a on lower(a.target) = lower(u.email)
     where a.action = 'iban_set'
  )
  update traccia.users u
     set iban = null, iban_holder = null, iban_verified_at = null
   where u.iban is not null
     and u.iban_verified_at is null
     and not exists (select 1 from scritti s where s.id = u.id);
  get diagnostics n = row_count;
  raise notice '0032: azzerati % IBAN generati dal sistema.', n;
end $$;

-- ------------------------------------------- il cliente: solo senza soldi ---
/* La regola resta quella di 0015 — con un saldo attivo il cliente non cambia
   da solo — ma il messaggio ora dice **a chi** rivolgersi, e soprattutto
   quella persona ha uno strumento. Il testo dice «scrivi all'assistenza e lo
   facciamo noi»: prima mandava a un ufficio che non poteva fare niente.
   Una nota in più: il confronto è sui soldi, non su un flag. Un cliente con
   un saldo a zero può ancora scrivere il suo IBAN, che è il caso normale di
   chi apre una pratica e aspetta la prima istruzione. */
create or replace function traccia.imposta_iban(p_token text, p_iban text, p_intestatario text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  pulito text;
begin
  if u.balance_eur > 0 or u.reserved_eur > 0 then
    raise exception 'Con un saldo attivo l''IBAN lo cambiamo noi: scrivi all''assistenza e lo aggiorniamo dalla console. È una protezione tua.'
      using errcode = '42501';
  end if;

  pulito := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(pulito) < 15 or length(pulito) > 34 or pulito !~ '^[A-Z]{2}[0-9]{2}' then
    raise exception 'IBAN non valido: servono almeno 15 caratteri e deve iniziare con il codice paese.'
      using errcode = '22023';
  end if;
  if length(trim(coalesce(p_intestatario, ''))) < 3 then
    raise exception 'Indica l''intestatario del conto.' using errcode = '22023';
  end if;

  update traccia.users
  set iban = pulito, iban_holder = trim(p_intestatario), iban_verified_at = null
  where id = u.id;

  perform traccia.log_action(u, 'iban_set', u.email, 'IBAN proposto dal cliente');
  return jsonb_build_object('ok', true, 'iban', pulito);
end $$;

revoke all on function traccia.imposta_iban(text, text, text) from public;
grant execute on function traccia.imposta_iban(text, text, text) to anon, authenticated;

-- ====================================================== cosa si vede in pagina ===
/* Vuoto e assente sono due cose diverse, e la pagina deve poterle distinguere:
   con `iban` null il cliente deve leggere «non ancora indicato» e trovare il
   modulo da compilare, non un segnaposto che sembra una coordinata bancaria.
   Aggiungere `has_iban` evita che ogni pezzo di interfaccia inventi il proprio
   modo di dire «non c'è». */
create or replace function traccia.user_json(u traccia.users)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
    'is_master', u.is_master, 'status', u.status, 'kyc_level', u.kyc_level,
    'kyc_label', case u.kyc_level
                    when 3 then 'Completa — identità, residenza e fondi verificati'
                    when 2 then 'Avanzata — residenza e fonte dei fondi'
                    else 'Base — documento d''identità' end,
    'balance_eur', u.balance_eur,
    'reserved_eur', u.reserved_eur,
    'available_eur', u.balance_eur - u.reserved_eur,
    'iban', u.iban, 'iban_holder', u.iban_holder,
    'has_iban', u.iban is not null and btrim(u.iban) <> '',
    'iban_verified', u.iban_verified_at is not null,
    'iban_formatted', regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g'),
    'case_ref', u.case_ref, 'case_amount_eur', u.case_amount_eur,
    'case_phase', u.case_phase,
    'created_at', extract(epoch from u.created_at),
    'last_login_at', extract(epoch from u.last_login_at)
  );
$$;

-- ------------------------------------------------------- le guardie finali ---
/* Perché questo blocco esiste: la 0032 riscrive quattro funzioni intere, e una
   riscrittura silenziosa è il modo più semplice per perdere un controllo che
   c'era. Qui si verifica, a database già modificato, che nessuna delle quattro
   chiami più il generatore: se qualcuno in futuro riapplica una vecchia
   versione del file, questo blocco si ferma e lo dice. */
do $$
declare
  corpi text;
begin
  select string_agg(pg_get_functiondef(p.oid), E'\n')
    into corpi
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'traccia'
     and p.proname in ('auth_register', 'admin_create_account',
                       'admin_crea_account_da_richiesta')
     and p.pronargs > 0;
  if corpi is null then
    raise exception '0032: mancano le funzioni da correggere — migrazione applicata fuori ordine?'
      using errcode = 'P0001';
  end if;
  if corpi like '%make_iban()%' then
    raise exception '0032: una funzione di creazione genera ancora l''IBAN. L''IBAN lo scrive una persona.'
      using errcode = 'P0001';
  end if;
end $$;

-- ------------------------------------ quello che il database dice davvero ---
/* Questa migrazione è stata scritta leggendo i file, e sui file ho sbagliato
   due volte. Poi ho guardato il database vero (progetto mmjycpdfjlbckeefbtuq):

     select p.oid::regprocedure from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'traccia' and p.proname = 'auth_register';

       traccia.auth_register(text,text,text,text,numeric,text,text,text)
         p_first_name, p_last_name, p_email, p_phone, p_amount_eur,
         p_situation, p_message, p_origine

   **Una sola funzione**, quella della 0024. Le altre due firme che i file
   descrivono (0002 e 0023) non esistono in produzione: sono storia, non
   schema. Quindi:

   - la versione della 0023 non va creata, e questo file non la crea. Correggerne
     il corpo non avrebbe cambiato niente, perché nessuno la chiama: sarebbe
     stata la soluzione elegante di un problema inesistente;
   - quella con `p_password` nemmeno: non esiste. Il wrapper della 0023 la
     dichiarava, ma è stato sostituito.

   Il file resta quindi con **tre** funzioni corrette: `auth_register` (la
   firma vera), `admin_create_account`, `admin_crea_account_da_richiesta`. La
   guardia in fondo si ferma se in database ne resta una che genera IBAN, e
   quella è la verifica che conta — non quante ne descrive questo commento. */

-- --------------------------------------- gli IBAN finti, uno per uno ---
/* Prima di azzerare qualcosa si guarda che cosa si azzera. Sul database di
   produzione ci sono cinque utenti, tutti con un IBAN, e **nessuno** con una
   voce `iban_set` nel registro: nessuno li ha scritti, quindi sono tutti usciti
   da `make_iban()`.

   Tre risultano «verificati». È il caso peggiore: qualcuno ha premuto
   «verifica» su coordinate inventate, e adesso la pagina del cliente dice
   «confermate dall'analista» su un conto che non esiste. Non è un dato da
   correggere, è un dato da togliere.

   Si azzerano tutti, verificati compresi: un IBAN generato è falso comunque, e
   la verifica su un falso non è una verifica. Il conteggio finisce nel registro
   attività, perché fra sei mesi qualcuno si chiederà perché il cliente non ha
   più le coordinate in pagina. */
do $$
declare
  n int;
begin
  with scritti as (
    select distinct u.id
      from traccia.users u
      join traccia.audit a on lower(a.target) = lower(u.email)
     where a.action = 'iban_set'
  )
  update traccia.users u
     set iban = null, iban_holder = null, iban_verified_at = null
   where u.iban is not null
     and not exists (select 1 from scritti s where s.id = u.id);
  get diagnostics n = row_count;

  insert into traccia.audit (actor_email, action, target, note)
  values ('migrazione/0032', 'iban_azzerati', 'tutti', n || ' IBAN generati dal sistema azzerati');

  raise notice '0032: azzerati % IBAN generati dal sistema.', n;
end $$;
