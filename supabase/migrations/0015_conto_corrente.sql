-- 0015_conto_corrente.sql
-- Conto, movimenti, prenotazioni, estratto conto.
--
-- Cosa c'era prima: `users.balance_eur` e nient'altro. Il saldo era un numero
-- che l'analista poteva scrivere a mano, i prelievi non controllavano la
-- disponibilità, e di ogni operazione approvata non restava traccia se non la
-- riga in `operations`. Con un conto vero questo non basta:
--
--   * il saldo deve essere la somma dei movimenti, non un campo da editare;
--   * due prelievi in attesa non devono poter spendere gli stessi soldi;
--   * il cliente deve vedere un estratto conto con data valuta e saldo
--     progressivo, riquadro «disponibile», «in attesa», «prenotato».
--
-- Modello (volutamente quello di un conto, non di un portafoglio):
--
--   ledger_entries          un movimento per riga, con segno, data valuta e
--                           saldo dopo il movimento. Append-only: non si
--                           aggiorna un movimento, se ne scrive uno inverso.
--   reserved_eur            quota del saldo prenotata da operazioni in attesa
--                           (prelievi, acquisti). Non è denaro sparito: è
--                           denaro impegnato, e finché l'operazione è aperta
--                           non può essere speso una seconda volta.
--   iban / conto            coordinate del conto: dove arrivano i versamenti.
--   verifica del prelievo   ricalcolata sempre: disponibile = saldo - prenotato.
--
-- Resta fuori da questo file, di proposito: tutto ciò che richiede una banca
-- vera (bonifici SEPA, addebiti diretti, interessi, carta). Qui c'è la
-- contabilità e il controllo dei fondi; i pagamenti veri passano dal
-- contratto e dall'intermediario.
--
-- Dipende da: 0001 (users/operations), 0003 (create_operation_impl),
--             0004 (admin_operation_action), 0012 (limiti per livello).

begin;

-- ============================================================================
-- 1. Coordinate del conto
-- ============================================================================
-- IBAN e intestatario: sono dati del conto, non della pratica. Restano nulli
-- finché non vengono assegnati, e finché sono nulli il cliente non può
-- prelevare (non c'è dove mandare i soldi).
alter table traccia.users add column if not exists iban_holder  text;
alter table traccia.users add column if not exists iban_verified_at timestamptz;
alter table traccia.users add column if not exists reserved_eur numeric(14,2) not null default 0;

-- `balance_eur` resta come cache del saldo contabile: la verità sono i
-- movimenti, questo è il numero già sommato per non fare cinquanta query in
-- una pagina. Lo si aggiorna solo da `registra_movimento`, mai a mano.
comment on column traccia.users.balance_eur is
  'Saldo contabile, somma di ledger_entries. Aggiornato solo da registra_movimento().';
comment on column traccia.users.reserved_eur is
  'Quota del saldo impegnata da operazioni in attesa. Disponibile = balance_eur - reserved_eur.';

-- ============================================================================
-- 2. Movimenti
-- ============================================================================
create table if not exists traccia.ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references traccia.users(id) on delete cascade,
  -- segno: positivo entra sul conto, negativo esce
  amount_eur   numeric(14,2) not null check (amount_eur <> 0),
  kind         text not null check (kind in (
                 'deposit',            -- versamento ricevuto
                 'withdrawal',         -- prelievo eseguito
                 'buy',                -- acquisto cripto
                 'sell',               -- vendita cripto
                 'transfer_out',       -- trasferimento verso wallet esterno
                 'fee',                -- oneri e spese
                 'adjustment',         -- correzione con nota obbligatoria
                 'reversal'            -- storno di un movimento precedente
               )),
  reference    text,                -- causale leggibile: "Bonifico SEPA 12/11"
  operation_id uuid references traccia.operations(id) on delete set null,
  -- data valuta: quando il denaro è davvero entrato o uscito, che non è
  -- sempre quando la riga è stata scritta (un bonifico ricevuto stamattina
  -- può avere valuta di ieri)
  value_date   date not null default current_date,
  -- saldo dopo il movimento: lo storico resta leggibile anche se domani
  -- cambiamo qualcosa
  balance_after numeric(14,2) not null,
  created_by   uuid references traccia.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists ledger_user_idx
  on traccia.ledger_entries (user_id, created_at desc);
create index if not exists ledger_operation_idx on traccia.ledger_entries (operation_id);

alter table traccia.ledger_entries enable row level security;
revoke all on traccia.ledger_entries from anon, authenticated;

-- I movimenti non si modificano e non si cancellano: un errore si corregge
-- con una riga inversa, che resta visibile. È la differenza fra un estratto
-- conto e un foglio di calcolo.
create or replace function traccia.ledger_immutabile()
returns trigger language plpgsql as $$
begin
  raise exception 'I movimenti non si modificano: registra una riga di storno.'
    using errcode = '42501';
end $$;

drop trigger if exists ledger_no_update on traccia.ledger_entries;
create trigger ledger_no_update
  before update or delete on traccia.ledger_entries
  for each row execute function traccia.ledger_immutabile();

-- ============================================================================
-- 3. Importi leggibili
-- ============================================================================
-- `to_char(n, 'FM999G999D00')` stampa «.00» quando il numero è zero: nelle
-- stringhe d'errore l'importo sparisce e resta «hai € .00 impegnati». Un
-- formattatore solo, in stile italiano, usato da tutte le funzioni.
create or replace function traccia.euro(p numeric)
returns text language plpgsql immutable as $$
declare
  v numeric;
  intero text;
  cent int;
begin
  if p is null then return '—'; end if;
  v := round(abs(p), 2);
  -- sia ',' sia '.' divengono '.', così il risultato non dipende dalla locale
  intero := translate(to_char(trunc(v), 'FM999G999G999G990'), ',.', '..');
  cent := round((v - trunc(v)) * 100)::int;
  return (case when p < 0 then '−' else '' end)
    || '€ ' || intero || ',' || lpad(cent::text, 2, '0');
end $$;

-- ============================================================================
-- 4. L'unico punto in cui il saldo cambia
-- ============================================================================
-- Nessuna funzione deve più fare `update users set balance_eur = ...`.
-- Passando sempre da qui: il movimento c'è sempre, il saldo è sempre la sua
-- somma, e il controllo del segno non si dimentica.
create or replace function traccia.registra_movimento(
  p_user uuid, p_amount numeric, p_kind text,
  p_reference text default null, p_operation uuid default null,
  p_value_date date default null, p_actor uuid default null
) returns traccia.ledger_entries language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  nuovo_saldo numeric;
  voce traccia.ledger_entries;
begin
  if coalesce(p_amount, 0) = 0 then
    raise exception 'Un movimento di importo zero non ha senso.' using errcode = '22023';
  end if;

  -- blocca la riga: due movimenti simultanei sullo stesso conto devono
  -- mettersi in fila, altrimenti il saldo finale dipende dall'ordine di arrivo
  select balance_eur into nuovo_saldo
  from traccia.users where id = p_user for update;
  if nuovo_saldo is null then
    raise exception 'Conto non trovato.' using errcode = '22023';
  end if;

  nuovo_saldo := nuovo_saldo + p_amount;
  if nuovo_saldo < 0 then
    raise exception 'Saldo insufficiente: servono %, disponibili %.',
      traccia.euro(abs(p_amount)), traccia.euro(nuovo_saldo - p_amount)
      using errcode = '22023';
  end if;

  insert into traccia.ledger_entries
    (user_id, amount_eur, kind, reference, operation_id, value_date, balance_after, created_by)
  values
    (p_user, p_amount, p_kind, nullif(trim(coalesce(p_reference, '')), ''), p_operation,
     coalesce(p_value_date, current_date), nuovo_saldo, p_actor)
  returning * into voce;

  update traccia.users set balance_eur = nuovo_saldo, updated_at = now() where id = p_user;
  return voce;
end $$;

-- ============================================================================
-- 5. Prenotazione dei fondi
-- ============================================================================
-- Quando il cliente chiede un prelievo o un acquisto, l'importo non esce
-- subito (aspetta l'approvazione) ma non può nemmeno essere speso altrove.
-- `reserved_eur` cresce alla richiesta e cala quando l'operazione si chiude,
-- in un senso o nell'altro.
create or replace function traccia.prenota_fondi(p_user uuid, p_amount numeric)
returns void language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  saldo numeric;
  prenotato numeric;
begin
  select balance_eur, reserved_eur into saldo, prenotato
  from traccia.users where id = p_user for update;

  if p_amount > saldo - prenotato then
    raise exception 'Disponibile insufficiente: hai % impegnati in altre operazioni. Puoi prelevare %.',
      traccia.euro(prenotato), traccia.euro(greatest(saldo - prenotato, 0)) using errcode = '22023';
  end if;

  update traccia.users set reserved_eur = reserved_eur + p_amount where id = p_user;
end $$;

create or replace function traccia.libera_fondi(p_user uuid, p_amount numeric)
returns void language plpgsql security definer
set search_path = traccia, public, extensions as $$
begin
  update traccia.users
  set reserved_eur = greatest(reserved_eur - p_amount, 0)
  where id = p_user;
end $$;

-- ============================================================================
-- 6. Richiesta di operazione: prenota se serve
-- ============================================================================
create or replace function traccia.create_operation_impl(
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
  unlimited_level boolean;
  prenota boolean;
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

  /* Il prelievo richiede un conto sul quale mandare il denaro. Senza IBAN
     l'operazione resterebbe in attesa per sempre: meglio dirlo subito. */
  if p_type = 'withdrawal'
     and (u.iban is null or length(trim(u.iban)) < 15) then
    raise exception 'Prima di prelevare devi indicare un IBAN intestato a te. Puoi farlo dalla sezione Dati del conto.'
      using errcode = '22023';
  end if;

  select value into lim from traccia.settings where key = 'limits';
  unlimited_level := (lvl = 3);

  if p_type in ('buy','sell','transfer_out')
     and coalesce((lim ->> 'crypto_transfer_enabled')::int, 1) = 0 then
    raise exception 'Le operazioni in valuta virtuale sono sospese.' using errcode = '42501';
  end if;

  cap := case p_type
           when 'deposit' then (lim ->> ('daily_deposit_l' || lvl))::numeric
           when 'withdrawal' then (lim ->> ('daily_withdrawal_l' || lvl))::numeric
           when 'buy' then (lim ->> ('daily_buy_l' || lvl))::numeric
           when 'sell' then (lim ->> ('daily_sell_l' || lvl))::numeric
           else (lim ->> ('crypto_transfer_max_eur_l' || lvl))::numeric
         end;

  if cap is null then
    raise exception 'Operazione non disponibile.' using errcode = '22023';
  elsif cap > 0 then
    used := traccia.used_today(u.id, p_type);
    if used + p_amount_eur > cap then
      raise exception 'Superato il limite giornaliero per questa operazione (%). Restano %.',
        traccia.euro(cap), traccia.euro(greatest(cap - used, 0)) using errcode = '22023';
    end if;
  elsif not unlimited_level then
    raise exception 'Operazione non consentita al livello di verifica attuale. Completa la verifica per poterla eseguire.'
      using errcode = '42501';
  end if;

  if asset is not null then
    select price_eur into price from traccia.market_assets where symbol = asset;
    if price is null then
      raise exception 'Criptovaluta non disponibile: %.', asset using errcode = '22023';
    end if;
  end if;

  /* Le operazioni che impegnano denaro già sul conto prenotano i fondi.
     Il versamento no: quello porta denaro dentro, non ne toglie. */
  prenota := p_type in ('withdrawal', 'buy', 'transfer_out');
  if prenota then
    perform traccia.prenota_fondi(u.id, p_amount_eur);
  end if;

  insert into traccia.operations (user_id, type, symbol, amount_eur, quantity, price_eur, note)
  values (u.id, p_type, asset, p_amount_eur,
          case when price is not null then round(p_amount_eur / price, 8) else null end,
          price, nullif(trim(coalesce(p_note, '')), ''))
  returning * into op;

  perform traccia.log_action(u, 'operation_create', op.id::text,
    p_type || ' € ' || p_amount_eur::text || case when prenota then ' · fondi prenotati' else '' end);

  return jsonb_build_object('operation', jsonb_build_object(
    'id', op.id, 'type', op.type, 'symbol', op.symbol, 'amount_eur', op.amount_eur,
    'status', op.status, 'created_at', extract(epoch from op.created_at)));
end $$;

-- ============================================================================
-- 7. Decisione: qui il denaro si muove davvero
-- ============================================================================
create or replace function traccia.admin_operation_action(
  p_token text, p_id uuid, p_action text, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  o traccia.operations;
  nuovo text;
  prenotava boolean;
begin
  select * into o from traccia.operations where id = p_id;
  if o.id is null then raise exception 'Operazione non trovata.' using errcode = '22023'; end if;
  if o.status <> 'pending' then
    raise exception 'Operazione già decisa.' using errcode = '22023';
  end if;

  nuovo := case p_action when 'approve' then 'approved' when 'deny' then 'denied' else null end;
  if nuovo is null then raise exception 'Azione non valida.' using errcode = '22023'; end if;

  prenotava := o.type in ('withdrawal', 'buy', 'transfer_out');

  update traccia.operations
  set status = nuovo, decision_note = nullif(trim(coalesce(p_note,'')), ''),
      decided_by = a.id, decided_at = now()
  where id = p_id;

  if nuovo = 'approved' then
    /* Approvato: il movimento esiste. I fondi prenotati si liberano perché
       da qui in poi il saldo è già calato. */
    if o.type = 'deposit' then
      perform traccia.registra_movimento(o.user_id, o.amount_eur, 'deposit',
        'Versamento approvato', o.id, null, a.id);
    elsif o.type = 'withdrawal' then
      perform traccia.libera_fondi(o.user_id, o.amount_eur);
      perform traccia.registra_movimento(o.user_id, -o.amount_eur, 'withdrawal',
        'Prelievo eseguito', o.id, null, a.id);
    elsif o.type = 'buy' then
      perform traccia.libera_fondi(o.user_id, o.amount_eur);
      perform traccia.registra_movimento(o.user_id, -o.amount_eur, 'buy',
        'Acquisto ' || coalesce(o.symbol, ''), o.id, null, a.id);
    elsif o.type = 'sell' then
      perform traccia.registra_movimento(o.user_id, o.amount_eur, 'sell',
        'Vendita ' || coalesce(o.symbol, ''), o.id, null, a.id);
    elsif o.type = 'transfer_out' then
      perform traccia.libera_fondi(o.user_id, o.amount_eur);
      perform traccia.registra_movimento(o.user_id, -o.amount_eur, 'transfer_out',
        'Trasferimento ' || coalesce(o.symbol, ''), o.id, null, a.id);
    end if;
  elsif prenotava then
    /* Rifiutata o annullata: i fondi tornano disponibili. Non è un movimento,
       perché non erano mai usciti. */
    perform traccia.libera_fondi(o.user_id, o.amount_eur);
  end if;

  perform traccia.log_action(a, 'operation_' || p_action, o.id::text,
    o.type || ' € ' || o.amount_eur::text || coalesce(' · ' || p_note, ''));
  return jsonb_build_object('ok', true, 'status', nuovo);
end $$;

-- annullamento da parte del cliente: libera la prenotazione
create or replace function traccia.cancel_operation(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  o traccia.operations;
begin
  select * into o from traccia.operations where id = p_id and user_id = u.id;
  if o.id is null then raise exception 'Operazione non trovata.' using errcode = '22023'; end if;
  if o.status <> 'pending' then
    raise exception 'Operazione non annullabile.' using errcode = '22023';
  end if;

  update traccia.operations set status = 'cancelled', decided_at = now() where id = p_id;
  if o.type in ('withdrawal', 'buy', 'transfer_out') then
    perform traccia.libera_fondi(u.id, o.amount_eur);
  end if;
  perform traccia.log_action(u, 'operation_cancel', p_id::text, o.type || ' € ' || o.amount_eur::text);
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- 8. Riepilogo del conto
-- ============================================================================
create or replace function traccia.conto(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  in_attesa numeric;
  entrate numeric;
  uscite numeric;
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

  return jsonb_build_object(
    'saldo', u.balance_eur,
    'prenotato', u.reserved_eur,
    'disponibile', u.balance_eur - u.reserved_eur,
    'in_attesa', in_attesa,
    'totale_entrate', entrate,
    'totale_uscite', uscite,
    'iban', u.iban,
    'iban_formatted', regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g'),
    'iban_holder', u.iban_holder,
    'iban_verified', u.iban_verified_at is not null,
    'movimenti', ultimi);
end $$;

-- ============================================================================
-- 9. Estratto conto
-- ============================================================================
create or replace function traccia.estratto_conto(
  p_token text, p_da date default null, p_a date default null, p_limite int default 100
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  dal date := coalesce(p_da, date_trunc('month', current_date)::date);
  al  date := coalesce(p_a, current_date);
  res jsonb;
  tot numeric;
begin
  if al < dal then
    raise exception 'La data di fine precede quella di inizio.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'amount_eur', e.amount_eur, 'kind', e.kind,
      'reference', e.reference, 'value_date', e.value_date,
      'balance_after', e.balance_after,
      'created_at', extract(epoch from e.created_at)
    ) order by e.created_at desc), '[]'::jsonb),
    coalesce(sum(e.amount_eur), 0)
  into res, tot
  from (
    select * from traccia.ledger_entries
    where user_id = u.id and value_date between dal and al
    order by created_at desc
    limit greatest(1, least(coalesce(p_limite, 100), 500))
  ) e;

  return jsonb_build_object(
    'da', dal, 'a', al,
    'movimenti', res,
    'saldo_periodo', tot,
    'saldo_finale', u.balance_eur,
    'conto', regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g'));
end $$;

-- ============================================================================
-- 10. Coordinate del conto: il cliente le propone, l'analista le verifica
-- ============================================================================
create or replace function traccia.imposta_iban(p_token text, p_iban text, p_intestatario text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_write_user(p_token);
  pulito text;
begin
  if u.balance_eur > 0 or u.reserved_eur > 0 then
    raise exception 'Con un saldo attivo l''IBAN si cambia solo con l''assistenza: è una protezione tua.'
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

create or replace function traccia.admin_verifica_iban(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.users;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then raise exception 'Account non trovato.' using errcode = '22023'; end if;
  if t.iban is null then raise exception 'Nessun IBAN da verificare.' using errcode = '22023'; end if;
  update traccia.users set iban_verified_at = now() where id = t.id;
  perform traccia.log_action(a, 'iban_verified', t.email, t.iban);
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- 11. Funzioni che leggevano il saldo così com'era
-- ============================================================================
-- `user_json` resta la stessa, ma il numero che porta ora è la somma dei
-- movimenti. Aggiungiamo il disponibile, che è il numero che serve al cliente
-- quando chiede «quanto posso prelevare».
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
    'iban_verified', u.iban_verified_at is not null,
    'iban_formatted', regexp_replace(coalesce(u.iban, ''), '(.{4})', '\1 ', 'g'),
    'case_ref', u.case_ref, 'case_amount_eur', u.case_amount_eur,
    'case_phase', u.case_phase,
    'created_at', extract(epoch from u.created_at),
    'last_login_at', extract(epoch from u.last_login_at)
  );
$$;

-- ============================================================================
-- 12. Saldo di apertura
-- ============================================================================
-- I saldi che esistono già non hanno movimenti dietro: sono stati scritti a
-- mano. Senza questa riga il primo estratto conto mostrerebbe un saldo
-- iniziale senza spiegazione, e la somma dei movimenti non tornerebbe con il
-- saldo. Un movimento di apertura lo rende verificabile.
do $$
declare
  u record;
begin
  for u in
    select us.id, us.balance_eur, us.created_at
    from traccia.users us
    where us.balance_eur <> 0
      and not exists (select 1 from traccia.ledger_entries e where e.user_id = us.id)
  loop
    insert into traccia.ledger_entries
      (user_id, amount_eur, kind, reference, value_date, balance_after)
    values
      (u.id, u.balance_eur, 'adjustment', 'Saldo di apertura',
       u.created_at::date, u.balance_eur);
  end loop;
end $$;

-- ============================================================================
-- 13. La console vede disponibile e stato delle coordinate
-- ============================================================================
-- Senza `available_eur` l'analista guarda un saldo e approva un prelievo che
-- non può essere pagato: il numero che conta è il disponibile.
create or replace function traccia.admin_accounts(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'is_master', u.is_master, 'status', u.status, 'kyc_level', u.kyc_level,
      'balance_eur', u.balance_eur,
      'reserved_eur', u.reserved_eur,
      'available_eur', u.balance_eur - u.reserved_eur,
      'holdings_value', traccia.holdings_value(u.id),
      'iban', u.iban, 'iban_holder', u.iban_holder,
      'iban_verified', u.iban_verified_at is not null,
      'iban_formatted', regexp_replace(coalesce(u.iban,''), '(.{4})', '\1 ', 'g'),
      'case_ref', u.case_ref, 'case_phase', u.case_phase,
      'operations_count', (select count(*) from traccia.operations o where o.user_id = u.id),
      'documents_count', (select count(*) from traccia.documents d where d.user_id = u.id),
      'contract_number', (select c.number from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'contract_status', (select c.status from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'created_at', extract(epoch from u.created_at),
      'last_login_at', extract(epoch from u.last_login_at)
    ) order by u.created_at desc), '[]'::jsonb)
  into res
  from traccia.users u
  where p_status is null or u.status = p_status;
  return jsonb_build_object('accounts', res);
end $$;

-- ============================================================================
-- 14. Permessi
-- ============================================================================
revoke all on function traccia.registra_movimento(uuid, numeric, text, text, uuid, date, uuid) from public;
revoke all on function traccia.prenota_fondi(uuid, numeric) from public;
revoke all on function traccia.libera_fondi(uuid, numeric) from public;
revoke all on function traccia.conto(text) from public;
revoke all on function traccia.estratto_conto(text, date, date, int) from public;
revoke all on function traccia.imposta_iban(text, text, text) from public;
revoke all on function traccia.admin_verifica_iban(text, uuid) from public;
revoke all on function traccia.euro(numeric) from public;

grant execute on function traccia.conto(text) to anon, authenticated;
grant execute on function traccia.estratto_conto(text, date, date, int) to anon, authenticated;
grant execute on function traccia.imposta_iban(text, text, text) to anon, authenticated;
grant execute on function traccia.admin_verifica_iban(text, uuid) to anon, authenticated;
grant execute on function traccia.euro(numeric) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
