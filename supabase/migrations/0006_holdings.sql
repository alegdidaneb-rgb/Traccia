-- ============================================================================
-- Traccia — controvalore cripto per cliente — migrazione 0006
--
-- La console analisti mostra una colonna "Cripto": è il valore attuale dei
-- token rimasti, calcolato come somma di (acquisti − vendite − trasferimenti)
-- sulle sole operazioni approvate, valorizzato ai prezzi del listino.
-- ============================================================================

create or replace function traccia.holdings_value(p_user uuid)
returns numeric language sql security definer
set search_path = traccia, public, extensions as $$
  select coalesce(sum(net.qty * a.price_eur), 0)
  from (
    select o.symbol,
           sum(case o.type
                 when 'buy' then o.quantity
                 when 'sell' then -o.quantity
                 when 'transfer_out' then -o.quantity
                 else 0 end) as qty
    from traccia.operations o
    where o.user_id = p_user
      and o.status = 'approved'
      and o.symbol is not null
      and o.quantity is not null
    group by o.symbol
  ) net
  join traccia.market_assets a on a.symbol = net.symbol
  where net.qty > 0;
$$;

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
      'holdings_value', traccia.holdings_value(u.id),
      'iban', u.iban,
      'iban_formatted', trim(regexp_replace(coalesce(u.iban,''), '(.{4})', '\1 ', 'g')),
      'case_ref', u.case_ref, 'case_phase', u.case_phase,
      'operations_count', (select count(*) from traccia.operations o where o.user_id = u.id),
      'documents_count', (select count(*) from traccia.documents d where d.user_id = u.id),
      'created_at', extract(epoch from u.created_at),
      'last_login_at', extract(epoch from u.last_login_at)
    ) order by u.created_at desc), '[]'::jsonb)
  into res
  from traccia.users u
  where p_status is null or u.status = p_status;
  return jsonb_build_object('accounts', res);
end $$;

revoke all on function traccia.holdings_value(uuid) from public;
revoke all on function traccia.admin_accounts(text, text) from public;
grant execute on function traccia.holdings_value(uuid) to anon, authenticated;
grant execute on function traccia.admin_accounts(text, text) to anon, authenticated;
