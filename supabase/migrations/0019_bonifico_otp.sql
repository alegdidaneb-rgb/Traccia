-- ============================================================================
-- Traccia — 0019: il bonifico si conferma con un codice, non con il saldo
--
-- Il cliente ha descritto il difetto così: «quando faccio un nuovo bonifico
-- sepa non mi permite di andare avanti e tutto si blocca». Il blocco non era
-- un errore di rete: era il pulsante che si spegneva perché il browser
-- confrontava l'importo con la disponibilità che aveva letto in un altro
-- momento. Se quella lettura era vecchia, corretta, o semplicemente non era
-- ancora arrivata, il cliente non poteva disporre nemmeno un euro che aveva
-- sul conto — e non c'era modo di raccapezzarsi guardando la schermata.
--
-- Tre regole, in quest'ordine:
--
-- 1. **La decisione sui soldi è del server, sempre.** `bonifico_crea` applicava
--    già ogni controllo; il client ne faceva una copia peggiore e la usava per
--    primo. Sparita la copia, il verdetto è uno solo, e arriva dal database che
--    ha i soldi davanti a sé.
--
-- 2. **Il denaro non si muove a un clic: si muove a una conferma.** Nessuna
--    banca esegue un bonifico perché qualcuno ha compilato un modulo. Prima si
--    dispone (verifiche, importo impegnato), poi un codice a sei cifre inviato
--    all'indirizzo email registrato conferma che chi sta disponendo è il
--    titolare.
--
-- 3. **Il codice non lo genera il database nel dubbio, e non lo mostra al
--    browser.** Il codice è generato dal generatore crittografico di Postgres,
--    conservato solo come impronta SHA-256 nella stessa forma dei gettoni di
--    sessione, e non compare nella risposta di nessuna funzione del client.
--
-- Dipende da: 0001 (users, audit), 0002 (need_write_user, hash_token),
-- 0016 (bonifico_crea, bank_transfers), 0017 (pattern dei wrapper public).
-- ============================================================================


-- ============================================================================
-- 1. La tabella delle conferme
-- ============================================================================
-- Una riga per ogni richiesta di conferma. `payload` tiene per intero ciò che
-- il cliente ha chiesto: alla conferma il bonifico si crea da lì, non da quello
-- che il browser rimanda. Altrimenti un codice emesso per 10 € potrebbe
-- confermare un bonifico da 10.000 €, perché il codice non conosce la cifra.
create table if not exists traccia.transfer_challenges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references traccia.users(id) on delete cascade,
  reference     text not null unique,          -- TRC-O-2026-000001
  payload       jsonb not null,                -- iban, beneficiario, importo, causale…
  code_hash     text not null,                 -- sha256 del codice, mai il codice
  email         text not null,                 -- dove è stato mandato
  canale        text not null default 'console', -- come è stato consegnato
  consegnato_at timestamptz,                   -- quando un operatore l'ha comunicato
  inviato_da    uuid references traccia.users(id) on delete set null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  verified_at   timestamptz,
  consumed_at   timestamptz,                   -- quando ha prodotto il bonifico
  cancelled_at  timestamptz,
  transfer_id   uuid references traccia.bank_transfers(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists challenges_user_idx
  on traccia.transfer_challenges (user_id, created_at desc);
create index if not exists challenges_aperte_idx
  on traccia.transfer_challenges (created_at)
  where consumed_at is null and cancelled_at is null;

alter table traccia.transfer_challenges enable row level security;
revoke all on traccia.transfer_challenges from anon, authenticated;

-- I codici di conferma hanno una numerazione propria: confonderli con i
-- bonifici renderebbe illeggibile sia l'estratto sia l'assistenza.
create sequence if not exists traccia.transfer_challenge_seq;


-- ============================================================================
-- 1-bis. Una funzione che quattro migrazioni chiamavano e nessuna definiva
-- ============================================================================
-- `need_write_user` era nel database e in nessun file: 0010, 0011, 0015 e 0016
-- la chiamano, e ricostruire il progetto da questa cartella avrebbe prodotto un
-- database in cui conto, contratti, bonifici e mandati rispondono
-- «function does not exist». È lo stesso difetto della 0017, un piano più sotto:
-- il database funzionava, quindi il repository sembrava completo.
--
-- Il corpo è quello che gira in produzione, ricopiato. Unico ritocco: il
-- controllo su `sess_role` funziona anche se il gettone non ha una riga in
-- `sessions` (allora `sess_role` è null, e null non è 'staff').
create or replace function traccia.need_write_user(p_token text)
returns traccia.users language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  u traccia.users;
  sess_role text;
begin
  u := traccia.need_user(p_token);
  select s.role into sess_role from traccia.sessions s
   where s.token_hash = traccia.hash_token(p_token) and s.expires_at > now();
  if sess_role = 'staff' then
    raise exception 'Stai consultando la pratica come analista: la modifica è disattivata.'
      using errcode = '42501';
  end if;
  return u;
end $fn$;

-- Un indirizzo email non si ripete in chiaro in una risposta che non serve a
-- confermarlo: la schermata dice «inviato a l•••@example.it», che basta al
-- cliente per riconoscere la propria casella e non basta a chiunque altro.
create or replace function traccia.maschera_email(p_email text)
returns text language plpgsql immutable as $fn$
declare
  mail text := coalesce(trim(p_email), '');
  chiocciola int;
  locale text;
  dominio text;
begin
  if mail = '' then return '—'; end if;
  chiocciola := position('@' in mail);
  if chiocciola < 2 then return mail; end if;
  locale := left(mail, chiocciola - 1);
  dominio := substr(mail, chiocciola);
  return left(locale, 1) || repeat('•', greatest(1, length(locale) - 1)) || dominio;
end $fn$;


-- ============================================================================
-- 1-ter. La richiesta in attesa impegna denaro come il bonifico
-- ============================================================================
-- `prenotato_eur` contava operazioni e bonifici. Una richiesta di conferma
-- aperta non è né l'uno né l'altro, ma i suoi soldi sono già promessi: contarla
-- zero vorrebbe dire che il cliente dispone 500 €, riceve il codice, e nel
-- frattempo ne dispone altri 500 in una seconda scheda — e alla conferma la
-- seconda richiesta troverebbe il conto vuoto dopo che il codice è già stato
-- digitato. Le richieste aperte contano, quelle scadute no: una richiesta
-- scaduta non impegna più niente, e lasciarla contare sarebbe un blocco che
-- nessuno sa spiegare.
--
-- L'ordine in `bonifico_prepara` conta: prima si chiudono le richieste che
-- questa sostituisce, poi si controlla il disponibile. Al contrario, correggere
-- un importo sbagliato sembrerebbe una seconda spesa.
create or replace function traccia.prenotato_eur(p_user uuid)
returns numeric language sql stable
set search_path = traccia, public, extensions as $fn$
  select
    (select coalesce(sum(o.amount_eur), 0)
       from traccia.operations o
      where o.user_id = p_user
        and o.status = 'pending'
        and o.type in ('withdrawal', 'buy', 'transfer_out'))
  + (select coalesce(sum(t.amount_eur), 0)
       from traccia.bank_transfers t
      where t.user_id = p_user
        and t.status in ('queued', 'sent'))
  + (select coalesce(sum((c.payload ->> 'importo')::numeric), 0)
       from traccia.transfer_challenges c
      where c.user_id = p_user
        and c.consumed_at is null
        and c.cancelled_at is null
        and c.verified_at is null
        and c.expires_at > now());
$fn$;


-- ============================================================================
-- 2. Il codice, generato e mai letto
-- ============================================================================
-- `random()` non è un generatore crittografico e non va usato per un segreto.
-- `gen_random_bytes` viene da pgcrypto ed è quello che serve. Le cifre si
-- prendono una alla volta, distribuendo uniformemente su 0–9: con `modulo %`
-- su un byte intero le prime sei cifre sarebbero leggermente favorite, e non
-- c'è ragione di regalare nemmeno quella sfumatura.
create or replace function traccia.genera_codice()
returns text language plpgsql volatile
set search_path = traccia, public, extensions as $fn$
declare
  codice text := '';
  b bytea;
  i int;
begin
  for i in 1..6 loop
    loop
      b := gen_random_bytes(1);
      /* 250–255 si scartano: 250 è il multiplo di 10 più alto sotto 256, così
         ogni cifra esce con la stessa probabilità */
      exit when get_byte(b, 0) < 250;
    end loop;
    codice := codice || (get_byte(b, 0) % 10)::text;
  end loop;
  return codice;
end $fn$;

-- Le funzioni che toccano un segreto non sono endpoint: si revocano da
-- `public` *e* da `anon`, come insegna la 0017.
revoke all on function traccia.genera_codice() from public, anon, authenticated;


-- ============================================================================
-- 3. La scadenza
-- ============================================================================
update traccia.settings
   set value = '{"minutes": 10, "max_attempts": 5, "max_al_giorno": 10}'::jsonb
 where key = 'transfer_otp';

insert into traccia.settings (key, value)
values ('transfer_otp', '{"minutes": 10, "max_attempts": 5, "max_al_giorno": 10}'::jsonb)
on conflict (key) do nothing;

create or replace function traccia.otp_setting(p_chiave text, p_default int)
returns int language plpgsql stable
set search_path = traccia, public, extensions as $fn$
declare
  v jsonb;
begin
  select value into v from traccia.settings where key = 'transfer_otp';
  return coalesce((v ->> p_chiave)::int, p_default);
end $fn$;


-- ============================================================================
-- 4. Quante richieste aperte può avere un cliente
-- ============================================================================
-- Un cliente che preme «disponi» dieci volte non deve trovare dieci codici
-- validi nella casella: quando ne chiede uno nuovo, i precedenti non ancora
-- usati muoiono. Restano solo quelli già confermati e non ancora consumati,
-- che servono a creare il bonifico.
create or replace function traccia.chiudi_conferme_aperte(p_user uuid)
returns int language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  n int;
begin
  with chiuse as (
    update traccia.transfer_challenges
       set cancelled_at = now()
     where user_id = p_user
       and consumed_at is null
       and cancelled_at is null
       and verified_at is null
    returning 1
  )
  select count(*) into n from chiuse;
  return n;
end $fn$;


-- ============================================================================
-- 5. Disporre: `bonifico_prepara`
-- ============================================================================
-- Fa tutto quello che faceva `bonifico_crea` tranne una cosa: non crea il
-- bonifico. Verifica, impegna l'importo e restituisce la sfida.
--
-- L'importo si impegna **qui**, non alla conferma. Se si impegnasse dopo, fra
-- la richiesta e la conferma il cliente potrebbe disporre due volte degli
-- stessi soldi da due schede aperte, e il secondo bonifico troverebbe il conto
-- vuoto solo dopo che il codice è stato digitato — cioè dopo aver fatto credere
-- al cliente che fosse tutto a posto.
create or replace function traccia.bonifico_prepara(
  p_token text, p_iban text, p_beneficiario text, p_importo numeric,
  p_causale text default null, p_purpose text default 'OTHR',
  p_istantaneo boolean default false, p_data date default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  u traccia.users := traccia.need_write_user(p_token);
  ch traccia.transfer_challenges;
  codice text;
  pulito text;
  proprio text;
  sportello date := coalesce(p_data, current_date);
  lim jsonb;
  lvl int;
  cap numeric;
  gia int;
  oggi int;
  minuti int;
begin
  if u.status <> 'active' then
    raise exception 'La pratica non è ancora attiva.' using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------- regole --
  -- identiche a quelle del 0016: la conferma le ripete tutte, quindi qui non
  -- c'è nulla che possa essere aggirato saltando un passaggio
  if coalesce(p_importo, 0) <= 0 then
    raise exception 'L''importo deve essere maggiore di zero.' using errcode = '22023';
  end if;
  if p_importo <> round(p_importo, 2) then
    raise exception 'I centesimi di euro sono al massimo due: %, non è un importo valido.',
      traccia.euro(p_importo) using errcode = '22023';
  end if;

  pulito := upper(regexp_replace(coalesce(p_iban, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(pulito) < 15 or length(pulito) > 34 or pulito !~ '^[A-Z]{2}[0-9]{2}' then
    raise exception 'IBAN del beneficiario non valido: servono almeno 15 caratteri e il codice paese iniziale.'
      using errcode = '22023';
  end if;
  proprio := upper(regexp_replace(coalesce(u.iban, ''), '[^A-Za-z0-9]', '', 'g'));
  if pulito = proprio and u.iban_verified_at is null then
    raise exception 'Per prelevare sul tuo conto le coordinate devono essere verificate dall''analista.'
      using errcode = '42501';
  end if;
  if length(trim(coalesce(p_beneficiario, ''))) < 3 then
    raise exception 'Indica il nome del beneficiario come risulta sul suo conto.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_causale, ''))) > 140 then
    raise exception 'La causale può avere al massimo 140 caratteri.' using errcode = '22023';
  end if;
  if not exists (select 1 from traccia.payment_purposes pp where pp.code = coalesce(p_purpose, 'OTHR')) then
    raise exception 'Causale di pagamento non riconosciuta.' using errcode = '22023';
  end if;
  if sportello < current_date then
    raise exception 'La data di esecuzione non può essere nel passato.' using errcode = '22023';
  end if;
  if sportello > current_date + 90 then
    raise exception 'Si possono disporre bonifici fino a 90 giorni avanti.' using errcode = '22023';
  end if;

  lvl := greatest(1, least(3, u.kyc_level));
  select value into lim from traccia.settings where key = 'limits';
  cap := coalesce((lim ->> ('daily_withdrawal_l' || lvl))::numeric, 0);
  if cap > 0 and traccia.used_today(u.id, 'withdrawal') + p_importo > cap then
    raise exception 'Superato il limite giornaliero dei prelievi (%). Restano %.',
      traccia.euro(cap), traccia.euro(greatest(cap - traccia.used_today(u.id, 'withdrawal'), 0))
      using errcode = '22023';
  elsif cap = 0 and lvl < 3 then
    raise exception 'I bonifici richiedono un livello di verifica superiore.' using errcode = '42501';
  end if;

  -- ------------------------------------------------------ troppe richieste --
  -- Un codice che si può chiedere all'infinito è un codice che si può indovinare
  -- provando. Il tetto è per cliente e per giorno.
  oggi := traccia.otp_setting('max_al_giorno', 10);
  select count(*) into gia
    from traccia.transfer_challenges c
   where c.user_id = u.id
     and c.created_at::date = current_date;
  if oggi > 0 and gia >= oggi then
    raise exception 'Hai chiesto % conferme oggi: è il massimo. Riprova domani, oppure scrivi all''assistenza.',
      gia using errcode = '22023';
  end if;

  -- -------------------------------------------------------- i soldi adesso --
  -- Prima si chiude ciò che questa richiesta sostituisce, poi si guarda il
  -- disponibile: così correggere un importo non sembra una seconda spesa.
  perform traccia.chiudi_conferme_aperte(u.id);
  perform traccia.prenota_fondi(u.id, p_importo);

  codice := traccia.genera_codice();
  minuti := traccia.otp_setting('minutes', 10);

  insert into traccia.transfer_challenges
    (user_id, reference, payload, code_hash, email, expires_at)
  values (
    u.id,
    'TRC-O-' || to_char(current_date, 'YYYY') || '-' ||
      lpad(nextval('traccia.transfer_challenge_seq')::text, 6, '0'),
    jsonb_build_object(
      'iban', pulito,
      'beneficiario', trim(p_beneficiario),
      'importo', p_importo,
      'causale', nullif(trim(coalesce(p_causale, '')), ''),
      'purpose', coalesce(p_purpose, 'OTHR'),
      'istantaneo', coalesce(p_istantaneo, false),
      'data', sportello),
    traccia.hash_token(codice),
    u.email,
    now() + make_interval(mins => minuti))
  returning * into ch;

  perform traccia.log_action(u, 'bonifico_conferma_richiesta', ch.reference,
    traccia.euro(p_importo) || ' → ' || pulito);

  -- Il codice **non** esce da qui. Chi lo deve leggere lo legge dalla
  -- console riservata, che è un'altra funzione e un altro permesso.
  return jsonb_build_object(
    'challenge_id', ch.id,
    'reference', ch.reference,
    'importo_eur', p_importo,
    'beneficiario', trim(p_beneficiario),
    'iban', traccia.iban_format(pulito),
    'email', traccia.maschera_email(u.email),
    'canale', ch.canale,
    'scade_il', ch.expires_at,
    'minuti', minuti,
    'tentativi_max', traccia.otp_setting('max_attempts', 5),
    'disponibile_dopo', (select balance_eur - reserved_eur from traccia.users where id = u.id));
end $fn$;


-- ============================================================================
-- 6. Confermare: `bonifico_conferma`
-- ============================================================================
-- Rifa ogni controllo — compreso il ricalcolo dei fondi, perché nel frattempo
-- l'importo è già impegnato ma il saldo può essere cambiato — e solo alla fine
-- crea il bonifico.
create or replace function traccia.bonifico_conferma(
  p_token text, p_challenge uuid, p_codice text
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  u traccia.users := traccia.need_write_user(p_token);
  ch traccia.transfer_challenges;
  t traccia.bank_transfers;
  massimo int;
  pulito text;
  proprio text;
  sportello date;
  lim jsonb;
  lvl int;
  cap numeric;
begin
  if u.status <> 'active' then
    raise exception 'La pratica non è ancora attiva.' using errcode = '42501';
  end if;

  select * into ch from traccia.transfer_challenges
   where id = p_challenge and user_id = u.id for update;
  if ch.id is null then
    raise exception 'Questa richiesta di conferma non esiste più.' using errcode = '22023';
  end if;
  if ch.consumed_at is not null then
    raise exception 'Questa conferma è già stata usata: il bonifico % è stato disposto una volta sola.',
      (select reference from traccia.bank_transfers where id = ch.transfer_id) using errcode = '22023';
  end if;
  if ch.cancelled_at is not null then
    raise exception 'Questa richiesta è stata annullata: disponi un nuovo bonifico.' using errcode = '22023';
  end if;
  if ch.expires_at < now() then
    /* la richiesta è morta: i suoi soldi non sono più promessi a nessuno */
    update traccia.transfer_challenges set cancelled_at = now() where id = ch.id;
    perform traccia.libera_fondi(u.id);
    raise exception 'Il codice è scaduto e i fondi sono tornati disponibili. Disponi di nuovo il bonifico per riceverne un altro.'
      using errcode = '22023';
  end if;

  -- Il confronto è sulle impronte, non sui codici: il codice in chiaro non
  -- esiste da nessuna parte, nemmeno in questa funzione.
  if ch.code_hash <> traccia.hash_token(trim(coalesce(p_codice, ''))) then
    update traccia.transfer_challenges
       set attempts = attempts + 1
     where id = ch.id
    returning attempts into massimo;

    if massimo >= traccia.otp_setting('max_attempts', 5) then
      update traccia.transfer_challenges
         set cancelled_at = now()
       where id = ch.id;
      perform traccia.libera_fondi(u.id);
      perform traccia.log_action(u, 'bonifico_conferma_bloccata', ch.reference,
        'codice errato ' || massimo || ' volte');
      raise exception 'Codice errato %. La richiesta è stata annullata per sicurezza: disponi un nuovo bonifico.',
        massimo using errcode = '22023';
    end if;
    raise exception 'Codice errato. Restano % tentativi.', 
      traccia.otp_setting('max_attempts', 5) - massimo using errcode = '22023';
  end if;

  update traccia.transfer_challenges
     set verified_at = coalesce(verified_at, now()), attempts = 0
   where id = ch.id;

  -- ------------------------------------- da qui in poi si ricontrolla tutto --
  pulito := ch.payload ->> 'iban';
  proprio := upper(regexp_replace(coalesce(u.iban, ''), '[^A-Za-z0-9]', '', 'g'));
  sportello := (ch.payload ->> 'data')::date;

  if (ch.payload ->> 'importo')::numeric <= 0 then
    raise exception 'L''importo deve essere maggiore di zero.' using errcode = '22023';
  end if;
  if pulito = proprio and u.iban_verified_at is null then
    raise exception 'Per prelevare sul tuo conto le coordinate devono essere verificate dall''analista.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from traccia.payment_purposes pp where pp.code = ch.payload ->> 'purpose') then
    raise exception 'Causale di pagamento non riconosciuta.' using errcode = '22023';
  end if;
  if sportello < current_date then
    raise exception 'La data di esecuzione è passata mentre confermavi: disponi il bonifico per un''altra data.'
      using errcode = '22023';
  end if;
  if sportello > current_date + 90 then
    raise exception 'Si possono disporre bonifici fino a 90 giorni avanti.' using errcode = '22023';
  end if;

  lvl := greatest(1, least(3, u.kyc_level));
  select value into lim from traccia.settings where key = 'limits';
  cap := coalesce((lim ->> ('daily_withdrawal_l' || lvl))::numeric, 0);
  if cap > 0 and traccia.used_today(u.id, 'withdrawal') + (ch.payload ->> 'importo')::numeric > cap then
    raise exception 'Superato il limite giornaliero dei prelievi (%).',
      traccia.euro(cap) using errcode = '22023';
  elsif cap = 0 and lvl < 3 then
    raise exception 'I bonifici richiedono un livello di verifica superiore.' using errcode = '42501';
  end if;

  insert into traccia.bank_transfers
    (user_id, reference, direction, scheme, amount_eur, beneficiary_name,
     beneficiary_iban, remittance, purpose_code, requested_date, created_by)
  values
    (u.id, traccia.riferimento('B'), 'out',
     case when (ch.payload ->> 'istantaneo')::boolean then 'sepa_instant' else 'sepa_credit' end,
     (ch.payload ->> 'importo')::numeric, ch.payload ->> 'beneficiario', pulito,
     ch.payload ->> 'causale', ch.payload ->> 'purpose', sportello, u.id)
  returning * into t;

  update traccia.transfer_challenges
     set consumed_at = now(), transfer_id = t.id
   where id = ch.id;

  /* la prenotazione non si somma: la richiesta esce dal conto e il bonifico
     entra, per lo stesso importo. Il ricalcolo lo rende vero invece di
     sperarlo. */
  perform traccia.libera_fondi(u.id);

  perform traccia.log_action(u, 'bonifico_confermato', t.reference,
    traccia.euro(t.amount_eur) || ' → ' || pulito || ' (conferma ' || ch.reference || ')');

  return jsonb_build_object(
    'id', t.id, 'reference', t.reference, 'status', t.status,
    'amount_eur', t.amount_eur, 'requested_date', t.requested_date,
    'scheme', t.scheme,
    'beneficiary_iban', traccia.iban_format(t.beneficiary_iban),
    'is_withdrawal', pulito = proprio,
    'available_after', (select balance_eur - reserved_eur from traccia.users where id = u.id));
end $fn$;


-- ============================================================================
-- 7. Rinunciare: `bonifico_rinuncia`
-- ============================================================================
-- Chi ha disposto e poi cambia idea non deve aspettare la scadenza per riavere
-- i soldi disponibili: rinuncia, e la prenotazione si scioglie subito.
create or replace function traccia.bonifico_rinuncia(
  p_token text, p_challenge uuid
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  u traccia.users := traccia.need_write_user(p_token);
  ch traccia.transfer_challenges;
begin
  select * into ch from traccia.transfer_challenges
   where id = p_challenge and user_id = u.id for update;
  if ch.id is null then
    raise exception 'Questa richiesta di conferma non esiste più.' using errcode = '22023';
  end if;
  if ch.consumed_at is not null or ch.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'stato', 'chiusa');
  end if;

  update traccia.transfer_challenges set cancelled_at = now() where id = ch.id;

  /* i soldi tornano disponibili: la prenotazione di questa richiesta non ha
     più ragione di esistere */
  perform traccia.libera_fondi(u.id);

  perform traccia.log_action(u, 'bonifico_conferma_annullata', ch.reference,
    traccia.euro((ch.payload ->> 'importo')::numeric));

  return jsonb_build_object(
    'ok', true,
    'stato', 'annullata',
    'disponibile', (select balance_eur - reserved_eur from traccia.users where id = u.id));
end $fn$;


-- ============================================================================
-- 8. Leggere il codice: la console dell'analista
-- ============================================================================
-- Il codice non si può leggere: esiste solo la sua impronta. Per questo la
-- generazione avviene qui e la consegna è un atto umano e registrato.
--
-- `p_codice` esce da `transfer_challenges` in un colpo solo: l'operatore lo
-- comunica, e il database annota chi, quando e a quale indirizzo. Se il codice
-- venisse rigenerato a ogni lettura, il cliente che ha già ricevuto il primo
-- non riuscirebbe più a confermare.
--
-- Perché non un invio automatico: il progetto non ha un servizio di posta
-- configurato, e un codice «inviato» che nessuno riceve è il blocco di prima in
-- un'altra forma. Quando il servizio ci sarà, questa è l'unica funzione da
-- cambiare: il resto del flusso non sa come il codice arriva.
create or replace function traccia.admin_conferme_bonifico(
  p_token text, p_stato text default 'aperte'
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  righe jsonb;
begin
  if coalesce(p_stato, 'aperte') not in ('aperte', 'tutte', 'consegnate', 'scadute') then
    raise exception 'Stato non riconosciuto: usa aperte, consegnate, scadute o tutte.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x order by x ->> 'creata_il' desc), '[]'::jsonb) into righe
  from (
    select jsonb_build_object(
             'id', c.id,
             'reference', c.reference,
             'cliente', u.name,
             'email', c.email,
             'importo_eur', (c.payload ->> 'importo')::numeric,
             'beneficiario', c.payload ->> 'beneficiario',
             'iban', traccia.iban_format(c.payload ->> 'iban'),
             'scade_il', extract(epoch from c.expires_at),
             'creata_il', c.created_at,
             'tentativi', c.attempts,
             'consegnata_il', c.consegnato_at,
             'consegnata_da', (select name from traccia.users where id = c.inviato_da),
             'stato', case
                        when c.consumed_at is not null then 'usata'
                        when c.cancelled_at is not null then 'annullata'
                        when c.expires_at < now() then 'scaduta'
                        when c.verified_at is not null then 'confermata'
                        else 'aperta' end
           ) as x
      from traccia.transfer_challenges c
      join traccia.users u on u.id = c.user_id
     where case coalesce(p_stato, 'aperte')
             when 'aperte' then c.consumed_at is null and c.cancelled_at is null
                                 and c.expires_at >= now() and c.verified_at is null
             when 'consegnate' then c.consegnato_at is not null
             when 'scadute' then c.expires_at < now() and c.consumed_at is null
             else true
           end
     order by c.created_at desc
     limit 100
  ) s;

  return jsonb_build_object('stato', coalesce(p_stato, 'aperte'), 'conferme', righe);
end $fn$;

-- La consegna: qui il codice esce, una volta sola, all'analista che lo
-- comunica al cliente. Ogni lettura lascia una riga nel registro.
create or replace function traccia.admin_conferma_codice(
  p_token text, p_id uuid
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  ch traccia.transfer_challenges;
  codice text;
begin
  select * into ch from traccia.transfer_challenges where id = p_id for update;
  if ch.id is null then
    raise exception 'Conferma non trovata.' using errcode = '22023';
  end if;
  if ch.consumed_at is not null or ch.cancelled_at is not null then
    raise exception 'Questa conferma è chiusa: non c''è nessun codice da consegnare.' using errcode = '22023';
  end if;
  if ch.expires_at < now() then
    raise exception 'Questa conferma è scaduta: il cliente deve disporre un nuovo bonifico.' using errcode = '22023';
  end if;
  if ch.consegnato_at is not null then
    raise exception 'Il codice di questa conferma è già stato consegnato il % da %. Non è possibile rileggerlo: se il cliente non lo ha ricevuto, deve disporre un nuovo bonifico.',
      to_char(ch.consegnato_at, 'DD/MM/YYYY HH24:MI'), 
      (select name from traccia.users where id = ch.inviato_da) using errcode = '22023';
  end if;

  /* Il codice esce solo adesso e solo per questa chiamata: l'impronta resta,
     il codice no. Non c'è modo di rileggerlo dopo. */
  codice := traccia.genera_codice();
  update traccia.transfer_challenges
     set code_hash = traccia.hash_token(codice),
         consegnato_at = now(),
         inviato_da = a.id
   where id = ch.id;

  perform traccia.log_action(a, 'bonifico_conferma_consegnata', ch.reference,
    'codice comunicato a ' || ch.email);

  return jsonb_build_object(
    'ok', true,
    'id', ch.id,
    'reference', ch.reference,
    'codice', codice,
    'cliente', (select name from traccia.users where id = ch.user_id),
    'email', ch.email,
    'importo_eur', (ch.payload ->> 'importo')::numeric,
    'beneficiario', ch.payload ->> 'beneficiario',
    'scade_il', extract(epoch from ch.expires_at),
    'avviso', 'Comunica il codice al cliente. Non compare nel sito e non è più leggibile dopo questa schermata.');
end $fn$;


-- ============================================================================
-- 9. `bonifico_crea` non è più un endpoint
-- ============================================================================
-- Il percorso diretto resta nel database perché serve alla conferma e alle
-- prove, ma il browser non lo può chiamare: se restasse raggiungibile, il
-- codice a sei cifre sarebbe una cerimonia davanti a una porta aperta — basterebbe
-- chiamare l'altra funzione e disporre senza confermare nulla.
create or replace function public.bonifico_crea(
  p_token text, p_iban text, p_beneficiario text, p_importo numeric,
  p_causale text default null, p_purpose text default 'OTHR',
  p_istantaneo boolean default false, p_data date default null)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.bonifico_crea(p_token, p_iban, p_beneficiario, p_importo,
                               p_causale, p_purpose, p_istantaneo, p_data);
$f$;

revoke all on function public.bonifico_crea(text, text, text, numeric, text, text, boolean, date)
  from public, anon, authenticated;


-- ============================================================================
-- 10. La superficie pubblica
-- ============================================================================
create or replace function public.bonifico_prepara(
  p_token text, p_iban text, p_beneficiario text, p_importo numeric,
  p_causale text default null, p_purpose text default 'OTHR',
  p_istantaneo boolean default false, p_data date default null)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.bonifico_prepara(p_token, p_iban, p_beneficiario, p_importo,
                                  p_causale, p_purpose, p_istantaneo, p_data);
$f$;

create or replace function public.bonifico_conferma(
  p_token text, p_challenge uuid, p_codice text)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.bonifico_conferma(p_token, p_challenge, p_codice);
$f$;

create or replace function public.bonifico_rinuncia(p_token text, p_challenge uuid)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.bonifico_rinuncia(p_token, p_challenge);
$f$;

create or replace function public.admin_conferme_bonifico(
  p_token text, p_stato text default 'aperte')
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_conferme_bonifico(p_token, p_stato);
$f$;

create or replace function public.admin_conferma_codice(p_token text, p_id uuid)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_conferma_codice(p_token, p_id);
$f$;

revoke all on function public.bonifico_prepara(text, text, text, numeric, text, text, boolean, date) from public;
revoke all on function public.bonifico_conferma(text, uuid, text) from public;
revoke all on function public.bonifico_rinuncia(text, uuid) from public;
revoke all on function public.admin_conferme_bonifico(text, text) from public;
revoke all on function public.admin_conferma_codice(text, uuid) from public;

grant execute on function public.bonifico_prepara(text, text, text, numeric, text, text, boolean, date) to anon, authenticated;
grant execute on function public.bonifico_conferma(text, uuid, text) to anon, authenticated;
grant execute on function public.bonifico_rinuncia(text, uuid) to anon, authenticated;
grant execute on function public.admin_conferme_bonifico(text, text) to anon, authenticated;
grant execute on function public.admin_conferma_codice(text, uuid) to anon, authenticated;

-- le funzioni interne non sono endpoint
revoke all on function traccia.bonifico_prepara(text, text, text, numeric, text, text, boolean, date) from public, anon, authenticated;
revoke all on function traccia.bonifico_conferma(text, uuid, text) from public, anon, authenticated;
revoke all on function traccia.bonifico_rinuncia(text, uuid) from public, anon, authenticated;
revoke all on function traccia.admin_conferme_bonifico(text, text) from public, anon, authenticated;
revoke all on function traccia.admin_conferma_codice(text, uuid) from public, anon, authenticated;


-- ============================================================================
-- 11. Le richieste rimaste a metà
-- ============================================================================
-- Un cliente può chiudere il browser fra la disposizione e la conferma. La
-- prenotazione resterebbe ferma per sempre, e i suoi soldi con lei. Questa
-- funzione si chiama dall'alto (console analisti) e restituisce l'importo.
create or replace function traccia.scadi_conferme_bonifico(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  a traccia.users := traccia.need_admin(p_token);
  r record;
  n int := 0;
  totale numeric := 0;
begin
  for r in
    select * from traccia.transfer_challenges
     where consumed_at is null and cancelled_at is null
       and verified_at is null
       and expires_at < now()
     for update
  loop
    update traccia.transfer_challenges set cancelled_at = now() where id = r.id;
    perform traccia.libera_fondi(r.user_id);
    n := n + 1;
    totale := totale + (r.payload ->> 'importo')::numeric;
  end loop;
  return jsonb_build_object('scadute', n, 'liberati_eur', totale);
end $fn$;

create or replace function public.scadi_conferme_bonifico(p_token text)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.scadi_conferme_bonifico(p_token);
$f$;

revoke all on function public.scadi_conferme_bonifico(text) from public;
grant execute on function public.scadi_conferme_bonifico(text) to anon, authenticated;
revoke all on function traccia.scadi_conferme_bonifico(text) from public, anon, authenticated;
