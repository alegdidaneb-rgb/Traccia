-- 0016_banca_operativa.sql
-- Bonifici SEPA, addebiti diretti (SDD), interessi e carta.
--
-- Cosa c'era prima: un conto che registrava solo movimenti già decisi a
-- mano. Tre cose mancavano perché il conto somigliasse a un conto e non a un
-- registro:
--
--   1. un bonifico non aveva un identificativo. Nessuno poteva dire «il
--      bonifico TRC-… è stato eseguito», né riconciliare un accredito che
--      arriva dalla banca;
--   2. un addebito diretto non esisteva. Il cliente non poteva autorizzare
--      nessuno a prelevare dal suo conto, e non poteva revocare;
--   3. gli interessi non esistevano, e una carta non si poteva bloccare.
--
-- Modello:
--
--   bank_transfers     un bonifico, con stato (in coda → inviato → eseguito →
--                      respinto/annullato), identificativo leggibile e causale
--                      strutturata come chiede il SEPA (ISO 20022).
--   direct_debits      un'autorizzazione (mandato) e i singoli addebiti. Il
--                      mandato non è un movimento: si revoca e resta scritto.
--   interest_accruals  maturazione giornaliera degli interessi. Non tocca il
--                      saldo giorno per giorno: si accredita in un movimento
--                      unico alla chiusura del periodo, così l'estratto conto
--                      resta leggibile.
--   cards              carta di debito collegata al conto. I dati sensibili
--                      non ci sono e non ci saranno: si conservano solo le
--                      ultime quattro cifre, perché il numero completo non
--                      serve a nessuna funzione del sito.
--
-- Tutto ciò che muove denaro passa da `registra_movimento`, come in 0015. Le
-- regole di rails (bonifico/SDD/carta) stanno qui; il saldo continua a stare
-- in un posto solo.
--
-- Resta fuori da questo file, di proposito: eseguire davvero un bonifico,
-- incassare un SDD, emettere una carta. Serve un istituto di pagamento
-- autorizzato: qui si costruiscono la richiesta, i controlli, i mandati e la
-- riconciliazione, e il contratto dice che l'esecuzione è della banca.
--
-- Dipende da: 0001 (users/operations), 0012 (limiti), 0015 (conto/ledger).

begin;

-- ============================================================================
-- 1. Cause di pagamento e identificativi
-- ============================================================================
-- Il SEPA vuole una causale strutturata (ISO 20022, ExternalPurpose1Code) e
-- una descrizione di 140 caratteri. Se l'utente sceglie una causale libera,
-- un controllo manuale la scarta e il bonifico torna indietro: meglio un
-- elenco chiuso di valori ammessi.
create table if not exists traccia.payment_purposes (
  code  text primary key,
  label text not null
);

insert into traccia.payment_purposes (code, label) values
  ('GDDS', 'Acquisto di beni'),
  ('SCVE', 'Acquisto di servizi'),
  ('SALA', 'Stipendio'),
  ('PENS', 'Pensione'),
  ('RINP', 'Rimborso'),
  ('OTHR', 'Altro')
on conflict (code) do nothing;

alter table traccia.payment_purposes enable row level security;
revoke all on traccia.payment_purposes from anon, authenticated;

-- Contatore per gli identificativi. `TRC-B-2026-000123` si legge ad alta
-- voce al telefono, cosa che un uuid non consente.
create sequence if not exists traccia.bank_ref_seq;

create or replace function traccia.riferimento(p_prefisso text)
returns text language sql volatile
set search_path = traccia, public, extensions as $$
  select 'TRC-' || p_prefisso || '-' || to_char(current_date, 'YYYY') || '-' ||
         lpad(nextval('traccia.bank_ref_seq')::text, 6, '0');
$$;


-- ============================================================================
-- 1-bis. IBAN leggibile
-- ============================================================================
-- `regexp_replace(iban, '(.{4})', '\1 ', 'g')` dipende da quanti livelli di
-- escaping attraversa: nel 0015 una riscrittura manuale ha prodotto
-- `\1 \1 \1` al posto delle cifre. Un ciclo su `substr` non ha backreference
-- e non può sbagliare.
create or replace function traccia.iban_format(p text)
returns text language plpgsql immutable
set search_path = traccia, public, extensions as $fn$
declare
  s text := upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
  out text := '';
  i int := 1;
begin
  if s = '' then return ''; end if;
  while i <= length(s) loop
    out := out || substr(s, i, 4) || ' ';
    i := i + 4;
  end loop;
  return rtrim(out);
end $fn$;

-- ============================================================================
-- 2. Bonifici SEPA
-- ============================================================================
create table if not exists traccia.bank_transfers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references traccia.users(id) on delete cascade,
  reference      text not null unique,          -- TRC-B-2026-000123
  -- in uscita: dal conto del cliente al suo IBAN di destinazione
  -- in entrata: un bonifico ricevuto, riconciliato dall'analista
  direction      text not null default 'out'
                 check (direction in ('out', 'in')),
  -- istantaneo arriva in pochi secondi, standard entro il giorno lavorativo
  -- successivo (Reg. UE 260/2012, art. 5)
  scheme         text not null default 'sepa_credit'
                 check (scheme in ('sepa_credit', 'sepa_instant')),
  amount_eur     numeric(14,2) not null check (amount_eur > 0),
  -- coordinate di destinazione fotografate al momento dell'invio: se domani
  -- il cliente cambia IBAN, un bonifico già disposto non cambia destinatario
  beneficiary_name text not null,
  beneficiary_iban text not null,
  remittance      text,                          -- causale libera, max 140
  purpose_code   text references traccia.payment_purposes(code),
  status         text not null default 'queued'
                 check (status in ('queued', 'sent', 'executed', 'rejected', 'cancelled', 'returned')),
  -- date SEPA: richiesta, esecuzione, valuta
  requested_date date not null default current_date,
  executed_at    timestamptz,
  value_date     date,
  -- risposta della banca: codice e messaggio. Senza questo, un bonifico
  -- respinto resta «inviato» e il cliente non sa perché.
  bank_code      text,
  bank_message   text,
  operation_id   uuid references traccia.operations(id) on delete set null,
  created_by     uuid references traccia.users(id),
  created_at     timestamptz not null default now()
);

create index if not exists bank_transfers_user_idx
  on traccia.bank_transfers (user_id, created_at desc);
create index if not exists bank_transfers_status_idx on traccia.bank_transfers (status);

alter table traccia.bank_transfers enable row level security;
revoke all on traccia.bank_transfers from anon, authenticated;

-- ============================================================================
-- 3. Addebiti diretti SEPA
-- ============================================================================
-- Il mandato è l'autorizzazione: creditore, IBAN del debitore, identificativo
-- del mandato, data di firma. Il cliente lo revoca quando vuole, e la revoca
-- resta scritta: cancellarlo farebbe sparire anche gli addebiti già avvenuti.
create table if not exists traccia.direct_debit_mandates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references traccia.users(id) on delete cascade,
  reference      text not null unique,           -- TRC-M-2026-000042
  creditor_name  text not null,
  creditor_id    text,                           -- identificativo creditore SEPA
  umr            text not null,                  -- unique mandate reference
  -- CORE: il debitore può chiedere il rimborso entro 8 settimane
  -- B2B:  nessun diritto di rimborso automatico, quindi va detto in chiaro
  scheme         text not null default 'core' check (scheme in ('core', 'b2b')),
  account_iban   text not null,                  -- IBAN addebitato, fotografato
  signed_on      date not null default current_date,
  status         text not null default 'active'
                 check (status in ('active', 'revoked')),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists mandates_user_idx on traccia.direct_debit_mandates (user_id, created_at desc);
alter table traccia.direct_debit_mandates enable row level security;
revoke all on traccia.direct_debit_mandates from anon, authenticated;

create table if not exists traccia.direct_debits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references traccia.users(id) on delete cascade,
  mandate_id     uuid not null references traccia.direct_debit_mandates(id) on delete restrict,
  reference      text not null unique,           -- TRC-D-2026-000771
  amount_eur     numeric(14,2) not null check (amount_eur > 0),
  -- un addebito può essere autorizzato (8 settimane per il CORE) o no. Se è
  -- senza autorizzazione, il cliente può contestarlo: qui lo stato lo dice.
  reason         text,
  status         text not null default 'pending'
                 check (status in ('pending', 'collected', 'refused', 'refunded', 'cancelled')),
  due_date       date not null default current_date,
  collected_at   timestamptz,
  ledger_id      uuid references traccia.ledger_entries(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists debits_user_idx on traccia.direct_debits (user_id, created_at desc);
alter table traccia.direct_debits enable row level security;
revoke all on traccia.direct_debits from anon, authenticated;

-- ============================================================================
-- 4. Interessi
-- ============================================================================
-- Come si calcola: interessi = saldo × tasso × giorni / 365, maturati ogni
-- giorno sulla giacenza e accreditati in un movimento unico a chiusura del
-- periodo. Non si accredita giorno per giorno perché un estratto conto con
-- una riga da 0,02 € al giorno è illeggibile.
--
-- Il tasso è in `settings.interest` ed è annuo, in percentuale. A zero gli
-- interessi non maturano: è il valore di partenza finché il tasso non è
-- deciso (e non deve essere inventato dal codice).
create table if not exists traccia.interest_accruals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references traccia.users(id) on delete cascade,
  accrued_on     date not null,
  principal_eur  numeric(14,2) not null,
  rate_pct       numeric(6,4) not null,
  amount_eur     numeric(14,4) not null,
  paid           boolean not null default false,
  ledger_id      uuid references traccia.ledger_entries(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (user_id, accrued_on)
);

create index if not exists accruals_user_idx on traccia.interest_accruals (user_id, accrued_on desc);
alter table traccia.interest_accruals enable row level security;
revoke all on traccia.interest_accruals from anon, authenticated;

-- Il tasso: 0 di partenza. Chi lo cambia lo cambia da qui, e il contratto
-- legge questo valore invece di un numero scritto nel codice.
insert into traccia.settings (key, value)
values ('interest', '{"annual_rate_pct": 0, "pay_day": 1, "note": "Tasso annuo lordo. A zero gli interessi non maturano."}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- 5. Carte
-- ============================================================================
create table if not exists traccia.cards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references traccia.users(id) on delete cascade,
  reference      text not null unique,           -- TRC-C-2026-000010
  -- solo le ultime quattro cifre: il numero completo non serve a nessuna
  -- funzione di questo sito, e conservarlo sarebbe un rischio senza scopo
  last4          text not null check (last4 ~ '^[0-9]{4}$'),
  network        text not null default 'circuito'
                 check (network in ('circuito', 'visa', 'mastercard')),
  kind           text not null default 'debit' check (kind in ('debit')),
  -- limite mensile di spesa della carta, separato dai limiti del conto
  monthly_cap_eur numeric(14,2) not null default 500 check (monthly_cap_eur > 0),
  status         text not null default 'pending'
                 check (status in ('pending', 'active', 'blocked', 'cancelled')),
  expires_on     date,
  blocked_at     timestamptz,
  block_reason   text,
  created_at     timestamptz not null default now()
);

create index if not exists cards_user_idx on traccia.cards (user_id, created_at desc);
alter table traccia.cards enable row level security;
revoke all on traccia.cards from anon, authenticated;

-- ============================================================================
-- 6. Bonifici: richiesta, invio, esito
-- ============================================================================
-- L'ordine dei controlli conta. Prima i fondi (prenotazione), poi la scrittura
-- della riga: se la prenotazione fallisce non deve restare un bonifico a metà.
create or replace function traccia.bonifico_crea(
  p_token text, p_iban text, p_beneficiario text, p_importo numeric,
  p_causale text default null, p_purpose text default 'OTHR',
  p_istantaneo boolean default false, p_data date default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  pulito text;
  proprio text;
  t traccia.bank_transfers;
  lim jsonb;
  lvl int;
  cap numeric;
  sportello date := coalesce(p_data, current_date);
begin
  if u.status <> 'active' then
    raise exception 'La pratica non è ancora attiva.' using errcode = '42501';
  end if;
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
  /* Bonifico verso il proprio conto = prelievo: è legittimo, ma solo se
     quell'IBAN è verificato. Prima il controllo lo vietava in blocco, e il
     cliente aveva due percorsi diversi per far uscire denaro; ora ne ha uno,
     e la differenza sta solo nel beneficiario. */
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
  /* una data di esecuzione nel passato la banca la rifiuta: si dice adesso */
  if sportello < current_date then
    raise exception 'La data di esecuzione non può essere nel passato.' using errcode = '22023';
  end if;
  if sportello > current_date + 90 then
    raise exception 'Si possono disporre bonifici fino a 90 giorni avanti.' using errcode = '22023';
  end if;

  /* I limiti restano quelli del conto: un bonifico è un prelievo, e i tetti
     del livello di verifica valgono anche qui. Zero significa due cose
     diverse, come in 0012: nessun tetto al livello 3, operazione vietata
     sotto. Confonderle qui vorrebbe dire far passare i bonifici di chi non è
     ancora verificato. */
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

  -- i fondi si impegnano subito: un bonifico disposto non è denaro libero
  perform traccia.prenota_fondi(u.id, p_importo);

  insert into traccia.bank_transfers
    (user_id, reference, direction, scheme, amount_eur, beneficiary_name,
     beneficiary_iban, remittance, purpose_code, requested_date, created_by)
  values
    (u.id, traccia.riferimento('B'), 'out',
     case when p_istantaneo then 'sepa_instant' else 'sepa_credit' end,
     p_importo, trim(p_beneficiario), pulito,
     nullif(trim(coalesce(p_causale, '')), ''), coalesce(p_purpose, 'OTHR'),
     sportello, u.id)
  returning * into t;

  perform traccia.log_action(u, 'bonifico_creato', t.reference,
    traccia.euro(p_importo) || ' → ' || pulito);

  return jsonb_build_object(
    'id', t.id, 'reference', t.reference, 'status', t.status,
    'amount_eur', t.amount_eur, 'requested_date', t.requested_date,
    'scheme', t.scheme, 'beneficiary_iban', traccia.iban_format(t.beneficiary_iban),
    'beneficiary_iban_formatted', traccia.iban_format(t.beneficiary_iban),
    'is_withdrawal', pulito = proprio,
    'available_after', (select balance_eur - reserved_eur from traccia.users where id = u.id));
end $$;

-- L'analista manda il bonifico alla banca. Non tocca il saldo: il denaro esce
-- quando la banca conferma, non quando premiamo un pulsante.
create or replace function traccia.admin_bonifico_invia(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.bank_transfers;
begin
  select * into t from traccia.bank_transfers where id = p_id for update;
  if t.id is null then raise exception 'Bonifico non trovato.' using errcode = '22023'; end if;
  if t.status <> 'queued' then
    raise exception 'Bonifico già %: non si può inviare due volte.',
      case t.status when 'sent' then 'inviato' when 'executed' then 'eseguito'
                    when 'cancelled' then 'annullato' else 'chiuso' end
      using errcode = '22023';
  end if;
  update traccia.bank_transfers set status = 'sent' where id = p_id;
  perform traccia.log_action(a, 'bonifico_inviato', t.reference, traccia.euro(t.amount_eur));
  return jsonb_build_object('ok', true, 'status', 'sent');
end $$;

-- Esito della banca. `executed` scrive il movimento e chiude la prenotazione
-- nello stesso atto: se il movimento fallisse, la transazione annulla anche lo
-- stato, e il bonifico resta «inviato» invece di risultare eseguito due volte.
create or replace function traccia.admin_bonifico_esito(
  p_token text, p_id uuid, p_esito text, p_codice text default null, p_messaggio text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.bank_transfers;
  nuovo text;
begin
  select * into t from traccia.bank_transfers where id = p_id for update;
  if t.id is null then raise exception 'Bonifico non trovato.' using errcode = '22023'; end if;
  if t.status not in ('sent', 'queued') then
    raise exception 'Un bonifico in stato «%» non ha più esiti da registrare.', t.status
      using errcode = '22023';
  end if;

  nuovo := case p_esito
             when 'executed' then 'executed'
             when 'rejected' then 'rejected'
             when 'returned' then 'returned'
             else null end;
  if nuovo is null then
    raise exception 'Esito non valido: usa executed, rejected o returned.' using errcode = '22023';
  end if;

  /* Un bonifico respinto o tornato indietro non è uscito: i fondi tornano
     disponibili. Se invece è eseguito, il denaro esce davvero. */
  if nuovo = 'executed' then
    perform traccia.libera_fondi(t.user_id, t.amount_eur);
    perform traccia.registra_movimento(
      t.user_id, -t.amount_eur,
      case when t.direction = 'out' then 'withdrawal' else 'deposit' end,
      'Bonifico ' || t.reference || ' · ' || t.beneficiary_name,
      null, coalesce(t.value_date, current_date), a.id);
    update traccia.bank_transfers
    set status = 'executed', executed_at = now(),
        value_date = coalesce(t.value_date, current_date),
        bank_code = p_codice, bank_message = p_messaggio
    where id = p_id;
  else
    perform traccia.libera_fondi(t.user_id, t.amount_eur);
    update traccia.bank_transfers
    set status = nuovo, executed_at = now(),
        bank_code = p_codice, bank_message = p_messaggio
    where id = p_id;
  end if;

  perform traccia.log_action(a, 'bonifico_' || nuovo, t.reference,
    coalesce(p_messaggio, p_codice));

  return jsonb_build_object('ok', true, 'status', nuovo,
    'available_after', (select balance_eur - reserved_eur from traccia.users where id = t.user_id));
end $$;

-- Il cliente annulla un bonifico che la banca non ha ancora preso in carico.
create or replace function traccia.bonifico_annulla(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  t traccia.bank_transfers;
begin
  select * into t from traccia.bank_transfers where id = p_id and user_id = u.id for update;
  if t.id is null then raise exception 'Bonifico non trovato.' using errcode = '22023'; end if;
  if t.status = 'sent' then
    raise exception 'Il bonifico è già stato inviato alla banca: non si annulla dall''area riservata. Scrivi all''assistenza.'
      using errcode = '42501';
  end if;
  if t.status <> 'queued' then
    raise exception 'Bonifico non annullabile.' using errcode = '22023';
  end if;

  perform traccia.libera_fondi(u.id, t.amount_eur);
  update traccia.bank_transfers set status = 'cancelled', executed_at = now() where id = p_id;
  perform traccia.log_action(u, 'bonifico_annullato', t.reference, traccia.euro(t.amount_eur));
  return jsonb_build_object('ok', true, 'status', 'cancelled',
    'available_after', (select balance_eur - reserved_eur from traccia.users where id = u.id));
end $$;

-- ============================================================================
-- 7. Addebiti diretti: mandato, raccolta, contestazione
-- ============================================================================
create or replace function traccia.mandato_crea(
  p_token text, p_creditore text, p_creditore_id text,
  p_importo_mensile numeric default null, p_scheme text default 'core'
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  m traccia.direct_debit_mandates;
  schema text := lower(coalesce(nullif(trim(p_scheme), ''), 'core'));
  umr text;
begin
  if length(trim(coalesce(p_creditore, ''))) < 3 then
    raise exception 'Indica il nome del creditore che potrà addebitare il conto.' using errcode = '22023';
  end if;
  if schema not in ('core', 'b2b') then
    raise exception 'Schema non valido: usa core oppure b2b.' using errcode = '22023';
  end if;
  /* senza IBAN il mandato non identifica niente: il creditore addebita un
     conto specifico, non «il cliente» */
  if u.iban is null or length(trim(u.iban)) < 15 then
    raise exception 'Prima di firmare un mandato devi indicare un IBAN intestato a te.'
      using errcode = '22023';
  end if;
  /* un IBAN non verificato che firma mandati è il modo più semplice per
     far uscire denaro da un conto che non è del cliente */
  if u.iban_verified_at is null then
    raise exception 'La coordinate del conto non sono ancora verificate: il mandato si può firmare dopo la verifica dell''analista.'
      using errcode = '42501';
  end if;
  if exists (select 1 from traccia.direct_debit_mandates d
             where d.user_id = u.id and d.status = 'active'
               and lower(d.creditor_name) = lower(trim(p_creditore))) then
    raise exception 'Esiste già un mandato attivo con questo creditore.' using errcode = '23505';
  end if;

  umr := traccia.riferimento('M');
  insert into traccia.direct_debit_mandates
    (user_id, reference, creditor_name, creditor_id, umr, scheme, account_iban)
  values
    (u.id, umr, trim(p_creditore), nullif(trim(coalesce(p_creditore_id, '')), ''),
     umr, schema, upper(regexp_replace(u.iban, '[^A-Za-z0-9]', '', 'g')))
  returning * into m;

  perform traccia.log_action(u, 'mandato_firmato', m.reference, m.creditor_name);
  return jsonb_build_object('id', m.id, 'reference', m.reference, 'umr', m.umr,
    'scheme', m.scheme, 'status', m.status, 'signed_on', m.signed_on);
end $$;

create or replace function traccia.mandato_revoca(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  m traccia.direct_debit_mandates;
begin
  select * into m from traccia.direct_debit_mandates
  where id = p_id and user_id = u.id for update;
  if m.id is null then raise exception 'Mandato non trovato.' using errcode = '22023'; end if;
  if m.status = 'revoked' then
    raise exception 'Mandato già revocato il %.', to_char(m.revoked_at, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  update traccia.direct_debit_mandates
  set status = 'revoked', revoked_at = now() where id = p_id;

  /* gli addebiti non ancora incassati cadono con la revoca: restare aperti
     significherebbe poter prelevare dopo che il cliente ha detto basta */
  update traccia.direct_debits
  set status = 'cancelled'
  where mandate_id = p_id and status = 'pending';

  perform traccia.log_action(u, 'mandato_revocato', m.reference, m.creditor_name);
  return jsonb_build_object('ok', true, 'status', 'revoked');
end $$;

-- Raccolta: il creditore presenta un addebito. Lo fa l'analista per conto
-- della banca (nel mondo vero è un file XML che arriva dal creditore).
create or replace function traccia.admin_addebito_crea(
  p_token text, p_id uuid, p_importo numeric, p_motivo text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  m traccia.direct_debit_mandates;
  d traccia.direct_debits;
begin
  select * into m from traccia.direct_debit_mandates where id = p_id for update;
  if m.id is null then raise exception 'Mandato non trovato.' using errcode = '22023'; end if;
  if m.status <> 'active' then
    raise exception 'Il mandato è revocato: non si possono presentare addebiti.' using errcode = '42501';
  end if;
  if coalesce(p_importo, 0) <= 0 then
    raise exception 'L''importo deve essere maggiore di zero.' using errcode = '22023';
  end if;

  insert into traccia.direct_debits (user_id, mandate_id, reference, amount_eur, reason, due_date)
  values (m.user_id, m.id, traccia.riferimento('D'), p_importo,
          nullif(trim(coalesce(p_motivo, '')), ''), current_date + 3)
  returning * into d;

  perform traccia.log_action(a, 'addebito_presentato', d.reference,
    m.creditor_name || ' · ' || traccia.euro(p_importo));
  return jsonb_build_object('id', d.id, 'reference', d.reference, 'status', d.status,
    'due_date', d.due_date);
end $$;

create or replace function traccia.admin_addebito_esito(
  p_token text, p_id uuid, p_esito text
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  d traccia.direct_debits;
  m traccia.direct_debit_mandates;
  voce traccia.ledger_entries;
begin
  select * into d from traccia.direct_debits where id = p_id for update;
  if d.id is null then raise exception 'Addebito non trovato.' using errcode = '22023'; end if;
  if d.status <> 'pending' then
    raise exception 'Addebito già chiuso (%).', d.status using errcode = '22023';
  end if;
  select * into m from traccia.direct_debit_mandates where id = d.mandate_id;

  if p_esito = 'collected' then
    /* l'addebito non passa da reserved_eur: non è una richiesta del cliente
       in attesa di approvazione, è un incasso disposto dal creditore. Il
       controllo del saldo lo fa comunque registra_movimento. */
    begin
      voce := traccia.registra_movimento(d.user_id, -d.amount_eur, 'fee',
        'Addebito diretto ' || m.creditor_name || ' · ' || d.reference,
        null, current_date, a.id);
    exception when others then
      /* saldo insufficiente: l'addebito si rifiuta, non si manda in negativo */
      update traccia.direct_debits set status = 'refused', collected_at = now() where id = d.id;
      perform traccia.log_action(a, 'addebito_rifiutato', d.reference, SQLERRM);
      return jsonb_build_object('ok', true, 'status', 'refused',
        'reason', 'Saldo insufficiente: ' || SQLERRM);
    end;
    update traccia.direct_debits
    set status = 'collected', collected_at = now(), ledger_id = voce.id
    where id = d.id;
  elsif p_esito in ('refused', 'cancelled') then
    update traccia.direct_debits set status = p_esito, collected_at = now() where id = d.id;
  else
    raise exception 'Esito non valido: usa collected, refused o cancelled.' using errcode = '22023';
  end if;

  perform traccia.log_action(a, 'addebito_' || p_esito, d.reference, traccia.euro(d.amount_eur));
  return jsonb_build_object('ok', true, 'status', p_esito);
end $$;

-- Il cliente contesta un addebito. Se è stato incassato e il mandato è CORE,
-- il rimborso è un movimento di segno opposto che resta visibile: non si
-- cancella l'addebito, si scrive lo storno. (Reg. UE 260/2012, art. 64.)
create or replace function traccia.addebito_contesta(
  p_token text, p_id uuid, p_motivo text
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  d traccia.direct_debits;
  m traccia.direct_debit_mandates;
begin
  select * into d from traccia.direct_debits where id = p_id and user_id = u.id for update;
  if d.id is null then raise exception 'Addebito non trovato.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Spiega il motivo della contestazione: senza motivo non può essere esaminata.'
      using errcode = '22023';
  end if;

  select * into m from traccia.direct_debit_mandates where id = d.mandate_id;

  if d.status = 'pending' then
    update traccia.direct_debits set status = 'cancelled', collected_at = now() where id = d.id;
  elsif d.status = 'collected' then
    if m.scheme = 'b2b' then
      raise exception 'Questo mandato è di tipo B2B: il rimborso non è automatico e va concordato con il creditore. Abbiamo registrato la contestazione.'
        using errcode = '42501';
    end if;
    if d.collected_at < now() - interval '8 weeks' then
      raise exception 'Sono passate più di otto settimane dall''incasso: il rimborso non è più automatico e va richiesto come contestazione formale.'
        using errcode = '42501';
    end if;
    perform traccia.registra_movimento(d.user_id, d.amount_eur, 'reversal',
      'Storno addebito ' || d.reference || ' · ' || m.creditor_name, null, current_date, u.id);
    update traccia.direct_debits set status = 'refunded' where id = d.id;
  else
    raise exception 'Un addebito in stato «%» non si contesta.', d.status using errcode = '22023';
  end if;

  perform traccia.log_action(u, 'addebito_contestato', d.reference, trim(p_motivo));
  return jsonb_build_object('ok', true, 'status',
    case when d.status = 'collected' then 'refunded' else 'cancelled' end);
end $$;

-- ============================================================================
-- 8. Interessi: maturazione e accredito
-- ============================================================================
-- Funzione di sistema: si chiama da un job. Idempotente per giorno e utente
-- (unique su user_id, accrued_on), quindi può girare due volte senza
-- raddoppiare niente.
create or replace function traccia.matricola_interessi(
  p_token text default null, p_giorno date default null
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  tasso numeric;
  u record;
  scritti int := 0;
  totale numeric := 0;
  giorno date := coalesce(p_giorno, current_date);
begin
  /* Due modi di chiamarla, e nessuno dei due è «anonimo»: o un analista con
     la sessione, o il job di notte che gira come ruolo del database. Un
     endpoint aperto che scrive righe di maturazione sarebbe un modo per far
     crescere gli interessi a comando. */
  if p_token is not null then
    perform traccia.need_admin(p_token);
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Serve una sessione amministratore.' using errcode = '42501';
  end if;

  select (value ->> 'annual_rate_pct')::numeric into tasso
  from traccia.settings where key = 'interest';
  if coalesce(tasso, 0) <= 0 then
    return jsonb_build_object('ok', true, 'accrued', 0, 'rate_pct', 0,
      'message', 'Tasso annuo a zero: nessun interesse maturato.');
  end if;
  if giorno > current_date then
    raise exception 'Non si maturano interessi nel futuro.' using errcode = '22023';
  end if;

  for u in
    select us.id,
           -- la giacenza del giorno è il saldo contabile: la quota impegnata
           -- è ancora sul conto, quindi matura interessi
           us.balance_eur
    from traccia.users us
    where us.role <> 'admin' and us.status = 'active' and us.balance_eur > 0
  loop
    insert into traccia.interest_accruals
      (user_id, accrued_on, principal_eur, rate_pct, amount_eur)
    values
      (u.id, giorno, u.balance_eur, tasso,
       round(u.balance_eur * tasso / 100 / 365, 4))
    on conflict (user_id, accrued_on) do nothing;
    if found then
      scritti := scritti + 1;
      totale := totale + round(u.balance_eur * tasso / 100 / 365, 4);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'accrued', scritti,
    'rate_pct', tasso, 'total_eur', totale, 'day', giorno,
    'message', case when scritti = 0 then 'Maturazione già registrata per oggi.'
                    else 'Maturazioni scritte: ' || scritti end);
end $$;

-- Accredito: somma le maturazioni non pagate e scrive un movimento solo.
-- Sotto un centesimo non si accredita: sarebbe una riga da 0,00 €.
create or replace function traccia.accredita_interessi(p_token text, p_user uuid default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  target uuid := coalesce(p_user, a.id);
  dovuto numeric;
  righe int;
  voce traccia.ledger_entries;
begin
  select coalesce(sum(amount_eur), 0), count(*) into dovuto, righe
  from traccia.interest_accruals
  where user_id = target and not paid;

  if righe = 0 then
    return jsonb_build_object('ok', true, 'paid', 0, 'entries', 0,
      'message', 'Nessun interesse da accreditare.');
  end if;

  if dovuto < 0.01 then
    /* gli importi restano maturati: si sommeranno al prossimo accredito.
       Azzerarli qui vorrebbe dire cancellare denaro del cliente. */
    return jsonb_build_object('ok', true, 'paid', 0, 'entries', righe,
      'pending_eur', dovuto,
      'message', 'Maturazione sotto il centesimo: si accumula fino al prossimo accredito.');
  end if;

  voce := traccia.registra_movimento(target, round(dovuto, 2), 'fee',
    'Interessi creditori al ' || to_char(current_date, 'DD/MM/YYYY'),
    null, current_date, a.id);

  update traccia.interest_accruals
  set paid = true, ledger_id = voce.id
  where user_id = target and not paid;

  perform traccia.log_action(a, 'interessi_accreditati', target::text,
    traccia.euro(round(dovuto, 2)));
  return jsonb_build_object('ok', true, 'paid', round(dovuto, 2), 'entries', righe,
    'reference', voce.reference);
end $$;

-- ============================================================================
-- 9. Carte
-- ============================================================================
create or replace function traccia.carta_richiedi(p_token text, p_cap numeric default 500)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  c traccia.cards;
  tetto numeric := coalesce(p_cap, 500);
begin
  if u.status <> 'active' then
    raise exception 'La pratica non è ancora attiva.' using errcode = '42501';
  end if;
  /* una carta su un conto che non è verificato è un conto a cui si può
     attingere senza sapere di chi sia */
  if u.kyc_level < 2 then
    raise exception 'La carta si richiede da un livello di verifica avanzato (almeno residenza e fonte dei fondi).'
      using errcode = '42501';
  end if;
  if u.iban_verified_at is null then
    raise exception 'Prima del rilascio le coordinate del conto devono essere verificate dall''analista.'
      using errcode = '42501';
  end if;
  if tetto < 50 or tetto > 10000 then
    raise exception 'Il limite mensile della carta va da € 50,00 a € 10.000,00.' using errcode = '22023';
  end if;
  if exists (select 1 from traccia.cards where user_id = u.id
             and status in ('pending', 'active')) then
    raise exception 'Hai già una carta richiesta o attiva.' using errcode = '23505';
  end if;

  insert into traccia.cards (user_id, reference, last4, monthly_cap_eur, expires_on)
  values (u.id, traccia.riferimento('C'),
          lpad((floor(random() * 10000))::int::text, 4, '0'),
          tetto, (current_date + interval '3 years')::date)
  returning * into c;

  perform traccia.log_action(u, 'carta_richiesta', c.reference, traccia.euro(tetto));
  return jsonb_build_object('id', c.id, 'reference', c.reference, 'last4', c.last4,
    'status', c.status, 'monthly_cap_eur', c.monthly_cap_eur);
end $$;

create or replace function traccia.carta_blocca(
  p_token text, p_id uuid, p_motivo text, p_riattiva boolean default false
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  c traccia.cards;
begin
  select * into c from traccia.cards where id = p_id and user_id = u.id for update;
  if c.id is null then raise exception 'Carta non trovata.' using errcode = '22023'; end if;

  if p_riattiva then
    if c.status <> 'blocked' then
      raise exception 'La carta non è bloccata.' using errcode = '22023';
    end if;
    update traccia.cards
    set status = 'active', blocked_at = null, block_reason = null where id = p_id;
  else
    /* blocco immediato: non chiede conferma all'analista, perché una carta
       smarrita è una corsa contro il tempo */
    if c.status not in ('pending', 'active') then
      raise exception 'Una carta in stato «%» non si blocca.', c.status using errcode = '22023';
    end if;
    update traccia.cards
    set status = 'blocked', blocked_at = now(),
        block_reason = nullif(trim(coalesce(p_motivo, '')), '')
    where id = p_id;
  end if;

  perform traccia.log_action(u, case when p_riattiva then 'carta_sbloccata' else 'carta_bloccata' end,
    c.reference, p_motivo);
  return jsonb_build_object('ok', true, 'status', case when p_riattiva then 'active' else 'blocked' end);
end $$;

-- L'analista attiva una carta richiesta. La richiesta da sola non serve a
-- niente: senza attivazione il cliente non può spendere.
create or replace function traccia.admin_carta_azione(
  p_token text, p_id uuid, p_azione text
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  c traccia.cards;
  nuovo text;
begin
  select * into c from traccia.cards where id = p_id for update;
  if c.id is null then raise exception 'Carta non trovata.' using errcode = '22023'; end if;
  nuovo := case p_azione
             when 'approve' then 'active'
             when 'deny' then 'cancelled'
             when 'block' then 'blocked'
             else null end;
  if nuovo is null then raise exception 'Azione non valida.' using errcode = '22023'; end if;
  if c.status = 'cancelled' then
    raise exception 'Carta annullata: non si riattiva.' using errcode = '22023';
  end if;

  update traccia.cards
  set status = nuovo,
      blocked_at = case when nuovo = 'blocked' then now() else blocked_at end
  where id = p_id;
  perform traccia.log_action(a, 'carta_' || p_azione, c.reference, nuovo);
  return jsonb_build_object('ok', true, 'status', nuovo);
end $$;

-- ============================================================================
-- 10. Lettura: banche, mandati, carte in un colpo solo
-- ============================================================================
create or replace function traccia.banca(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  bonifici jsonb;
  mandati jsonb;
  carte jsonb;
  tasso numeric;
  maturato numeric;
  scadenza date;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'reference', t.reference, 'direction', t.direction, 'scheme', t.scheme,
      'amount_eur', t.amount_eur, 'beneficiary_name', t.beneficiary_name,
      'beneficiary_iban', traccia.iban_format(t.beneficiary_iban),
      'remittance', t.remittance, 'purpose_code', t.purpose_code,
      'status', t.status, 'requested_date', t.requested_date,
      'value_date', t.value_date, 'bank_code', t.bank_code, 'bank_message', t.bank_message,
      'created_at', extract(epoch from t.created_at)
    ) order by t.created_at desc), '[]'::jsonb)
  into bonifici
  from (select * from traccia.bank_transfers
        where user_id = u.id order by created_at desc limit 25) t;

  /* i mandati portano con sé gli addebiti: un mandato senza i suoi addebiti
     è una riga che non dice se il creditore ha già prelevato */
  select coalesce(jsonb_agg(m order by m ->> 'created_at' desc), '[]'::jsonb) into mandati
  from (
    select jsonb_build_object(
      'id', d.id, 'reference', d.reference, 'creditor_name', d.creditor_name,
      'creditor_id', d.creditor_id, 'umr', d.umr, 'scheme', d.scheme,
      'account_iban', traccia.iban_format(d.account_iban),
      'status', d.status, 'signed_on', d.signed_on,
      'revoked_at', extract(epoch from d.revoked_at),
      'created_at', extract(epoch from d.created_at),
      'debits', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id, 'reference', b.reference, 'amount_eur', b.amount_eur,
          'status', b.status, 'due_date', b.due_date, 'reason', b.reason,
          'collected_at', extract(epoch from b.collected_at)
        ) order by b.created_at desc)
        from (select * from traccia.direct_debits
              where mandate_id = d.id order by created_at desc limit 10) b), '[]'::jsonb)
    ) as m
    from traccia.direct_debit_mandates d
    where d.user_id = u.id
    order by d.created_at desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'reference', c.reference, 'last4', c.last4, 'network', c.network,
      'kind', c.kind, 'status', c.status, 'monthly_cap_eur', c.monthly_cap_eur,
      'expires_on', c.expires_on, 'blocked_at', extract(epoch from c.blocked_at),
      'block_reason', c.block_reason,
      'created_at', extract(epoch from c.created_at)
    ) order by c.created_at desc), '[]'::jsonb)
  into carte
  from traccia.cards c where c.user_id = u.id;

  select (value ->> 'annual_rate_pct')::numeric into tasso
  from traccia.settings where key = 'interest';

  select coalesce(sum(amount_eur), 0) into maturato
  from traccia.interest_accruals where user_id = u.id and not paid;

  /* saldo × tasso / 365: quello che maturerebbe in un giorno, arrotondato
     ai centesimi. Serve a dire al cliente quanto vale il tasso, non a
     promettere un importo. */
  scadenza := (date_trunc('month', current_date) + interval '1 month')::date;

  return jsonb_build_object(
    'bonifici', bonifici,
    'mandati', mandati,
    'carte', carte,
    'interessi', jsonb_build_object(
      'rate_pct', coalesce(tasso, 0),
      'maturato_eur', round(maturato, 2),
      'giornaliero_eur', round(coalesce(u.balance_eur, 0) * coalesce(tasso, 0) / 100 / 365, 2),
      'prossimo_accredito', scadenza
    ),
    'purposes', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label)
                                          order by code), '[]'::jsonb)
                 from traccia.payment_purposes),
    'disponibile', u.balance_eur - u.reserved_eur,
    'saldo', u.balance_eur);
end $$;

-- La console vede tutti i canali di pagamento in una tabella sola: un bonifico
-- fermo in coda è denaro di un cliente che aspetta.
create or replace function traccia.admin_banca(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'reference', t.reference, 'user_name', u.name, 'user_email', u.email,
      'amount_eur', t.amount_eur, 'beneficiary_name', t.beneficiary_name,
      'beneficiary_iban', traccia.iban_format(t.beneficiary_iban),
      'scheme', t.scheme, 'status', t.status, 'requested_date', t.requested_date,
      'remittance', t.remittance, 'created_at', extract(epoch from t.created_at)
    ) order by t.created_at desc), '[]'::jsonb)
  into res
  from (select * from traccia.bank_transfers order by created_at desc limit 60) t
  join traccia.users u on u.id = t.user_id;

  return jsonb_build_object(
    'bonifici', res,
    'mandati', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'reference', d.reference, 'user_name', u.name, 'user_email', u.email,
        'creditor_name', d.creditor_name, 'scheme', d.scheme, 'status', d.status,
        'signed_on', d.signed_on, 'created_at', extract(epoch from d.created_at)
      ) order by d.created_at desc), '[]'::jsonb)
      from (select * from traccia.direct_debit_mandates order by created_at desc limit 60) d
      join traccia.users u on u.id = d.user_id),
    'addebiti', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'reference', b.reference, 'user_name', u.name,
        'creditor_name', m.creditor_name, 'amount_eur', b.amount_eur,
        'status', b.status, 'due_date', b.due_date
      ) order by b.created_at desc), '[]'::jsonb)
      from (select * from traccia.direct_debits
            where status = 'pending' order by created_at desc limit 60) b
      join traccia.users u on u.id = b.user_id
      join traccia.direct_debit_mandates m on m.id = b.mandate_id),
    'carte', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'reference', c.reference, 'user_name', u.name, 'user_email', u.email,
        'last4', c.last4, 'status', c.status, 'monthly_cap_eur', c.monthly_cap_eur,
        'expires_on', c.expires_on, 'created_at', extract(epoch from c.created_at)
      ) order by c.created_at desc), '[]'::jsonb)
      from (select * from traccia.cards order by created_at desc limit 60) c
      join traccia.users u on u.id = c.user_id),
    'conteggi', jsonb_build_object(
      'bonifici_da_inviare', (select count(*) from traccia.bank_transfers where status = 'queued'),
      'bonifici_inviati', (select count(*) from traccia.bank_transfers where status = 'sent'),
      'addebiti_aperti', (select count(*) from traccia.direct_debits where status = 'pending'),
      'carte_da_attivare', (select count(*) from traccia.cards where status = 'pending')));
end $$;

-- ============================================================================
-- 11. Bonifici in entrata: riconciliare un accredito
-- ============================================================================
-- L'analista vede arrivare un bonifico sul conto e lo registra. Se il cliente
-- l'aveva preannunciato, il bonifico in entrata chiude quella richiesta.
create or replace function traccia.admin_bonifico_entrata(
  p_token text, p_id uuid, p_importo numeric, p_ordinante text,
  p_valuta date default null, p_causale text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
  voce traccia.ledger_entries;
  b traccia.bank_transfers;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if coalesce(p_importo, 0) <= 0 then
    raise exception 'L''importo deve essere maggiore di zero.' using errcode = '22023';
  end if;

  voce := traccia.registra_movimento(t.id, p_importo, 'deposit',
    'Bonifico ricevuto · ' || coalesce(nullif(trim(p_ordinante), ''), 'ordinante non indicato'),
    null, coalesce(p_valuta, current_date), a.id);

  insert into traccia.bank_transfers
    (user_id, reference, direction, scheme, amount_eur, beneficiary_name,
     beneficiary_iban, remittance, status, executed_at, value_date, created_by)
  values (t.id, traccia.riferimento('B'), 'in', 'sepa_credit', p_importo,
          coalesce(nullif(trim(p_ordinante), ''), 'Ordinante non indicato'),
          nullif(traccia.iban_format(t.iban), ''),
          nullif(trim(coalesce(p_causale, '')), ''), 'executed', now(),
          coalesce(p_valuta, current_date), a.id)
  returning * into b;

  perform traccia.log_action(a, 'bonifico_entrata', b.reference,
    t.email || ' · ' || traccia.euro(p_importo));
  return jsonb_build_object('ok', true, 'reference', b.reference,
    'balance_after', voce.balance_after);
end $$;

-- ============================================================================
-- 11-bis. Il prenotato si legge dalle operazioni, non da un contatore
-- ============================================================================
-- Trovato in produzione: una richiesta di prelievo da 300 € in attesa e
-- `reserved_eur = 0`. Due numeri che dovevano essere lo stesso numero, e non
-- lo erano. La causa è storica (le operazioni create prima del 0015 non
-- prenotavano nulla), ma il difetto è di progetto: `reserved_eur` è una copia
-- di un dato che sta già in `operations`, e una copia può divergere.
--
-- Adesso la verità è la somma delle operazioni aperte; `reserved_eur` resta
-- come cache per non fare un aggregato a ogni pagina, ma viene riscritta da
-- `riallinea_prenotazioni()` e `conto()` legge il valore calcolato. Se la
-- cache sbaglia, lo schermo dice comunque la verità.
create or replace function traccia.prenotato_eur(p_user uuid)
returns numeric language sql stable
set search_path = traccia, public, extensions as $fn$
  select coalesce(sum(o.amount_eur), 0)
  from traccia.operations o
  where o.user_id = p_user
    and o.status = 'pending'
    and o.type in ('withdrawal', 'buy', 'transfer_out');
$fn$;

-- Riallinea la cache (e restituisce cosa ha corretto). Idempotente: chiamarla
-- due volte non cambia niente.
create or replace function traccia.riallinea_prenotazioni()
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  corrette int := 0;
  r record;
begin
  for r in
    select u.id, u.reserved_eur, traccia.prenotato_eur(u.id) as vero
    from traccia.users u
  loop
    if r.reserved_eur is distinct from r.vero then
      update traccia.users set reserved_eur = r.vero where id = r.id;
      corrette := corrette + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'corrette', corrette);
end $fn$;

-- La prenotazione controlla il disponibile calcolato, non la cache: una cache
-- arretrata non deve poter autorizzare una seconda spesa degli stessi soldi.
create or replace function traccia.prenota_fondi(p_user uuid, p_amount numeric)
returns void language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  saldo numeric;
  impegnato numeric;
begin
  select balance_eur into saldo from traccia.users where id = p_user for update;
  if saldo is null then
    raise exception 'Conto non trovato.' using errcode = '22023';
  end if;
  impegnato := traccia.prenotato_eur(p_user);

  if p_amount > saldo - impegnato then
    raise exception 'Disponibile insufficiente: hai % impegnati in altre operazioni. Puoi disporre di %.',
      traccia.euro(impegnato), traccia.euro(greatest(saldo - impegnato, 0))
      using errcode = '22023';
  end if;

  update traccia.users set reserved_eur = impegnato + p_amount where id = p_user;
end $fn$;

-- `conto()`: prenotato e disponibile sono quelli calcolati. Il resto è
-- identico a 0015.
create or replace function traccia.conto(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
declare
  u traccia.users := traccia.need_user(p_token);
  in_attesa numeric;
  entrate numeric;
  uscite numeric;
  impegnato numeric;
  ultimi jsonb;
begin
  select coalesce(sum(amount_eur), 0) into in_attesa
  from traccia.operations
  where user_id = u.id and status = 'pending'
    and type in ('withdrawal', 'buy', 'transfer_out');

  select coalesce(sum(case when amount_eur > 0 then amount_eur else 0 end), 0),
         coalesce(sum(case when amount_eur < 0 then -amount_eur else 0 end), 0)
  into entrate, uscite
  from traccia.ledger_entries where user_id = u.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount_eur', e.amount_eur, 'kind', e.kind,
      'reference', e.reference, 'value_date', e.value_date,
      'balance_after', e.balance_after,
      'created_at', extract(epoch from e.created_at)
    ) order by e.created_at desc), '[]'::jsonb)
  into ultimi
  from (select * from traccia.ledger_entries
        where user_id = u.id order by created_at desc limit 20) e;

  impegnato := traccia.prenotato_eur(u.id);

  return jsonb_build_object(
    'saldo', u.balance_eur,
    'prenotato', impegnato,
    'disponibile', u.balance_eur - impegnato,
    'in_attesa', in_attesa,
    'totale_entrate', entrate,
    'totale_uscite', uscite,
    'iban', u.iban,
    'iban_formatted', traccia.iban_format(u.iban),
    'iban_holder', u.iban_holder,
    'iban_verified', u.iban_verified_at is not null,
    'movimenti', ultimi);
end $fn$;

-- Ricalcolo invece di sottrazione: `p_amount` resta nella firma perché la
-- chiamano cinque funzioni, ma non serve più. Sottrarre da una cache che può
-- essere arretrata lascia il residuo sbagliato; ricalcolare no.
create or replace function traccia.libera_fondi(p_user uuid, p_amount numeric default 0)
returns void language plpgsql security definer
set search_path = traccia, public, extensions as $fn$
begin
  update traccia.users
  set reserved_eur = traccia.prenotato_eur(p_user)
  where id = p_user;
end $fn$;

-- ============================================================================
-- 11-ter. Wrapper in `public`
-- ============================================================================
-- PostgREST espone solo `public`: una funzione bella in `traccia` senza wrapper
-- risponde `Could not find the function ... in the schema cache`, che sembra
-- un guasto e invece è una riga mancante. Il 0016 è nato senza questi wrapper:
-- «conto» risultava viva e non lo era.
-- Le funzioni del 0015 erano «vive» solo dentro lo schema `traccia`:
-- il conto, l'estratto, l'IBAN e i link ai documenti rispondevano «function
-- not found» all'area riservata. Erano raggiungibili dal SQL editor, non dal
-- sito — che è il modo più efficace di credere di aver finito.
create or replace function public.conto(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.conto(p_token); $f$;

create or replace function public.estratto_conto(p_token text, p_da date default null, p_a date default null, p_limite integer default 100)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.estratto_conto(p_token, p_da, p_a, p_limite); $f$;

create or replace function public.imposta_iban(p_token text, p_iban text, p_intestatario text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.imposta_iban(p_token, p_iban, p_intestatario); $f$;

create or replace function public.admin_verifica_iban(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_verifica_iban(p_token, p_id); $f$;

create or replace function public.attach_document_file(p_token text, p_id uuid, p_path text, p_name text default null, p_mime text default null, p_size bigint default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.attach_document_file(p_token, p_id, p_path, p_name, p_mime, p_size); $f$;

create or replace function public.document_link(p_token text, p_id uuid, p_secondi integer default 600)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.document_link(p_token, p_id, p_secondi); $f$;

create or replace function public.auth_logout_all(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_logout_all(p_token); $f$;

create or replace function public.banca(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.banca(p_token); $f$;

create or replace function public.bonifico_crea(p_token text, p_iban text, p_beneficiario text, p_importo numeric, p_causale text default null, p_purpose text default 'OTHR', p_istantaneo boolean default false, p_data date default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.bonifico_crea(p_token, p_iban, p_beneficiario, p_importo, p_causale, p_purpose, p_istantaneo, p_data); $f$;

create or replace function public.bonifico_annulla(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.bonifico_annulla(p_token, p_id); $f$;

create or replace function public.mandato_crea(p_token text, p_creditore text, p_creditore_id text default null, p_importo_mensile numeric default null, p_scheme text default 'core')
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.mandato_crea(p_token, p_creditore, p_creditore_id, p_importo_mensile, p_scheme); $f$;

create or replace function public.mandato_revoca(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.mandato_revoca(p_token, p_id); $f$;

create or replace function public.addebito_contesta(p_token text, p_id uuid, p_motivo text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.addebito_contesta(p_token, p_id, p_motivo); $f$;

create or replace function public.carta_richiedi(p_token text, p_cap numeric default 500)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.carta_richiedi(p_token, p_cap); $f$;

create or replace function public.carta_blocca(p_token text, p_id uuid, p_motivo text default null, p_riattiva boolean default false)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.carta_blocca(p_token, p_id, p_motivo, p_riattiva); $f$;

create or replace function public.admin_banca(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_banca(p_token); $f$;

create or replace function public.admin_bonifico_invia(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_bonifico_invia(p_token, p_id); $f$;

create or replace function public.admin_bonifico_esito(p_token text, p_id uuid, p_esito text, p_codice text default null, p_messaggio text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_bonifico_esito(p_token, p_id, p_esito, p_codice, p_messaggio); $f$;

create or replace function public.admin_bonifico_entrata(p_token text, p_id uuid, p_importo numeric, p_ordinante text default null, p_valuta date default null, p_causale text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_bonifico_entrata(p_token, p_id, p_importo, p_ordinante, p_valuta, p_causale); $f$;

create or replace function public.admin_addebito_crea(p_token text, p_id uuid, p_importo numeric, p_motivo text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_addebito_crea(p_token, p_id, p_importo, p_motivo); $f$;

create or replace function public.admin_addebito_esito(p_token text, p_id uuid, p_esito text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_addebito_esito(p_token, p_id, p_esito); $f$;

create or replace function public.admin_carta_azione(p_token text, p_id uuid, p_azione text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_carta_azione(p_token, p_id, p_azione); $f$;

create or replace function public.matricola_interessi(p_token text default null, p_giorno date default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.matricola_interessi(p_token, p_giorno); $f$;

create or replace function public.accredita_interessi(p_token text, p_user uuid default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.accredita_interessi(p_token, p_user); $f$;

-- ============================================================================
-- 12. Permessi
-- ============================================================================
revoke all on function traccia.riferimento(text) from public;
revoke all on function traccia.bonifico_crea(text, text, text, numeric, text, text, boolean, date) from public;
revoke all on function traccia.bonifico_annulla(text, uuid) from public;
revoke all on function traccia.admin_bonifico_invia(text, uuid) from public;
revoke all on function traccia.admin_bonifico_esito(text, uuid, text, text, text) from public;
revoke all on function traccia.admin_bonifico_entrata(text, uuid, numeric, text, date, text) from public;
revoke all on function traccia.mandato_crea(text, text, text, numeric, text) from public;
revoke all on function traccia.mandato_revoca(text, uuid) from public;
revoke all on function traccia.admin_addebito_crea(text, uuid, numeric, text) from public;
revoke all on function traccia.admin_addebito_esito(text, uuid, text) from public;
revoke all on function traccia.addebito_contesta(text, uuid, text) from public;
revoke all on function traccia.matricola_interessi(text, date) from public;
revoke all on function traccia.accredita_interessi(text, uuid) from public;
revoke all on function traccia.carta_richiedi(text, numeric) from public;
revoke all on function traccia.carta_blocca(text, uuid, text, boolean) from public;
revoke all on function traccia.admin_carta_azione(text, uuid, text) from public;
revoke all on function traccia.banca(text) from public;
revoke all on function traccia.admin_banca(text) from public;
revoke all on function traccia.prenotato_eur(uuid) from public;
revoke all on function traccia.riallinea_prenotazioni() from public;

grant execute on function traccia.bonifico_crea(text, text, text, numeric, text, text, boolean, date) to anon, authenticated;
grant execute on function traccia.iban_format(text) to anon, authenticated;
grant execute on function traccia.bonifico_annulla(text, uuid) to anon, authenticated;
grant execute on function traccia.admin_bonifico_invia(text, uuid) to anon, authenticated;
grant execute on function traccia.admin_bonifico_esito(text, uuid, text, text, text) to anon, authenticated;
grant execute on function traccia.admin_bonifico_entrata(text, uuid, numeric, text, date, text) to anon, authenticated;
grant execute on function traccia.mandato_crea(text, text, text, numeric, text) to anon, authenticated;
grant execute on function traccia.mandato_revoca(text, uuid) to anon, authenticated;
grant execute on function traccia.admin_addebito_crea(text, uuid, numeric, text) to anon, authenticated;
grant execute on function traccia.admin_addebito_esito(text, uuid, text) to anon, authenticated;
grant execute on function traccia.addebito_contesta(text, uuid, text) to anon, authenticated;
grant execute on function traccia.matricola_interessi(text, date) to anon, authenticated;
grant execute on function traccia.accredita_interessi(text, uuid) to anon, authenticated;
grant execute on function traccia.carta_richiedi(text, numeric) to anon, authenticated;
grant execute on function traccia.carta_blocca(text, uuid, text, boolean) to anon, authenticated;
grant execute on function traccia.admin_carta_azione(text, uuid, text) to anon, authenticated;
grant execute on function traccia.banca(text) to anon, authenticated;
grant execute on function traccia.admin_banca(text) to anon, authenticated;
grant execute on function traccia.prenotato_eur(uuid) to anon, authenticated;
grant execute on function traccia.riallinea_prenotazioni() to anon, authenticated;

grant execute on function public.conto(text) to anon, authenticated;
grant execute on function public.estratto_conto(text,date,date,integer) to anon, authenticated;
grant execute on function public.imposta_iban(text,text,text) to anon, authenticated;
grant execute on function public.admin_verifica_iban(text,uuid) to anon, authenticated;
grant execute on function public.attach_document_file(text,uuid,text,text,text,bigint) to anon, authenticated;
grant execute on function public.document_link(text,uuid,integer) to anon, authenticated;
grant execute on function public.auth_logout_all(text) to anon, authenticated;
grant execute on function public.banca(text) to anon, authenticated;
grant execute on function public.bonifico_crea(text,text,text,numeric,text,text,boolean,date) to anon, authenticated;
grant execute on function public.bonifico_annulla(text,uuid) to anon, authenticated;
grant execute on function public.mandato_crea(text,text,text,numeric,text) to anon, authenticated;
grant execute on function public.mandato_revoca(text,uuid) to anon, authenticated;
grant execute on function public.addebito_contesta(text,uuid,text) to anon, authenticated;
grant execute on function public.carta_richiedi(text,numeric) to anon, authenticated;
grant execute on function public.carta_blocca(text,uuid,text,boolean) to anon, authenticated;
grant execute on function public.admin_banca(text) to anon, authenticated;
grant execute on function public.admin_bonifico_invia(text,uuid) to anon, authenticated;
grant execute on function public.admin_bonifico_esito(text,uuid,text,text,text) to anon, authenticated;
grant execute on function public.admin_bonifico_entrata(text,uuid,numeric,text,date,text) to anon, authenticated;
grant execute on function public.admin_addebito_crea(text,uuid,numeric,text) to anon, authenticated;
grant execute on function public.admin_addebito_esito(text,uuid,text) to anon, authenticated;
grant execute on function public.admin_carta_azione(text,uuid,text) to anon, authenticated;
grant execute on function public.matricola_interessi(text,date) to anon, authenticated;
grant execute on function public.accredita_interessi(text,uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
