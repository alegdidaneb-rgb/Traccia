-- 0012_limits_and_testing.sql
-- Limiti per livello di verifica: il livello completo non ha tetti interni.
--
-- Cosa cambia rispetto a 0003:
--
--   1. il livello massimo (3 = verifica completa) non ha più alcun tetto
--      giornaliero interno su NESSUNA delle cinque operazioni;
--   2. `cap = 0` smette di significare due cose diverse. Prima il controllo
--      veniva saltato quando il tetto era zero: un cliente non verificato
--      poteva trasferire criptovaluta senza alcun limite pur leggendo in
--      contratto «non consentito a questo livello». Adesso:
--
--          cap > 0              → tetto giornaliero, si controlla
--          cap = 0, livello 3   → nessun tetto interno
--          cap = 0, livello < 3 → operazione vietata (42501)
--
--   3. anche i trasferimenti in criptovaluta passano dal freno
--      `crypto_transfer_enabled`, come già facevano acquisti e vendite.
--
-- Restano fuori da questo file, perché non dipendono da noi: i controlli
-- della banca, dell'intermediario e delle autorità. Il contratto lo dice
-- esplicitamente (clausola 10).
--
-- Dipende da: 0001 (settings), 0002 (need_user), 0003 (used_today/me_dashboard).

begin;

-- --------------------------------------------------------------- settings ---
-- Livello 3: tutti i tetti a zero. `unlimited_from_level` rende il significato
-- esplicito anche a chi legge il database senza aprire il codice.
update traccia.settings
set value = value
  || jsonb_build_object(
       'daily_deposit_l3', 0,
       'daily_withdrawal_l3', 0,
       'daily_buy_l3', 0,
       'daily_sell_l3', 0,
       'crypto_transfer_max_eur_l3', 0,
       'unlimited_from_level', 3
     )
where key = 'limits';

-- ------------------------------------------------------- create_operation ---
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

  select value into lim from traccia.settings where key = 'limits';

  -- il livello completo non ha tetti interni; gli altri livelli sì
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

  /* Tre casi distinti, e vanno tenuti distinti:
       cap > 0             → tetto giornaliero, si controlla
       cap = 0, completo   → nessun tetto interno
       cap = 0, non completo → operazione vietata a questo livello */
  if cap is null then
    raise exception 'Operazione non disponibile.' using errcode = '22023';
  elsif cap > 0 then
    used := traccia.used_today(u.id, p_type);
    if used + p_amount_eur > cap then
      raise exception 'Superato il limite giornaliero per questa operazione (€ %). Restano € %.',
        to_char(cap, 'FM999G999D00'), to_char(greatest(cap - used, 0), 'FM999G999D00')
        using errcode = '22023';
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

  insert into traccia.operations (user_id, type, symbol, amount_eur, quantity, price_eur, note)
  values (u.id, p_type, asset, p_amount_eur,
          case when price is not null then round(p_amount_eur / price, 8) else null end,
          price, nullif(trim(coalesce(p_note, '')), ''))
  returning * into op;

  perform traccia.log_action(u, 'operation_create', op.id::text, p_type || ' € ' || p_amount_eur::text);
  return jsonb_build_object('operation', jsonb_build_object(
    'id', op.id, 'type', op.type, 'symbol', op.symbol, 'amount_eur', op.amount_eur,
    'status', op.status, 'created_at', extract(epoch from op.created_at)));
end $$;

-- --------------------------------------------------------------- contratto ---
-- La versione cambia insieme al testo: un contratto firmato deve poter dire
-- quale testo è stato firmato.
update traccia.settings
set value = jsonb_set(value, '{version}', '"2.1"'::jsonb)
where key = 'contract';

commit;

notify pgrst, 'reload schema';
