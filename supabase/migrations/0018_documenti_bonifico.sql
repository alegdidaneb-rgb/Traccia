/* ==========================================================================
   0018 — ricevuta di ogni bonifico, ed estratto dei soli bonifici
   ==========================================================================

   Due documenti che il cliente si aspetta da un conto e che qui non c'erano.

   **1. La ricevuta.** Un bonifico disposto era una riga in `bank_transfers`
   che non produceva nessun documento. Chi ha disposto un pagamento vuole la
   carta che lo dice: riferimento, data, beneficiario, IBAN, importo, causale,
   stato, e — quando la banca risponde — il suo codice di errore. Questa è una
   *ricevuta di disposizione*, non una fattura: i bonifici non hanno un
   corrispettivo, quindi non c'è nulla da fatturare. Se un giorno ci sarà una
   commissione, la ricevuta porta una riga di addebito e diventa altro.

   **2. L'estratto dei soli bonifici.** L'estratto conto legge il ledger, dove
   un bonifico è una riga sola con la descrizione «Bonifico TRC-B-… — Mario
   Rossi». Non ha l'IBAN, non ha lo stato, non ha il codice della banca: per
   questo un filtro sull'estratto conto non basta, serve leggere
   `bank_transfers`. Scaricabile in CSV, perché un estratto che si può solo
   guardare non è un estratto.
   ========================================================================== */


-- ---------------------------------------------------------------------------
-- 1. Anagrafica del prestatore, una volta sola
-- ---------------------------------------------------------------------------
-- Le stesse voci del contratto (0010), riusate invece di riscritte: due copie
-- di un indirizzo divergono, e il giorno che divergono una delle due è falsa.
insert into traccia.settings (key, value)
values ('provider', jsonb_build_object(
  'name',    'ERSEL SPA',
  'vat',     '06900230018',
  'pec',     'traccia@pec.it',
  'address', 'Piazza Solferino, 11 - 10121 Torino (TO)'
))
on conflict (key) do nothing;

create or replace function traccia.provider_block()
returns jsonb language sql stable
set search_path = traccia, public as $fn$
  select jsonb_build_object(
    'name',    coalesce(p.value ->> 'name',    c.value ->> 'provider_name',    'ERSEL SPA'),
    'vat',     coalesce(p.value ->> 'vat',     c.value ->> 'provider_vat'),
    'pec',     coalesce(p.value ->> 'pec',     c.value ->> 'provider_pec'),
    'address', coalesce(p.value ->> 'address', c.value ->> 'provider_address')
  )
  from (select value from traccia.settings where key = 'provider') p
  full join (select value from traccia.settings where key = 'contract') c on true
  limit 1;
$fn$;


-- ---------------------------------------------------------------------------
-- 2. La ricevuta di un bonifico
-- ---------------------------------------------------------------------------
-- Un bonifico si legge come un documento, non come una riga di tabella: chi lo
-- stampa lo mostra a un commercialista o a un creditore, e in quel momento
-- contano il codice della banca e la data valuta, non l'id.
create or replace function traccia.bonifico_ricevuta(p_token text, p_id uuid)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  t traccia.bank_transfers;
  cliente jsonb;
  saldo numeric;
begin
  select * into t from traccia.bank_transfers
  where id = p_id and user_id = u.id;
  if t.id is null then
    raise exception 'Bonifico non trovato.' using errcode = '42501';
  end if;

  cliente := jsonb_build_object(
    'name',  u.name,
    'email', u.email,
    'case',  u.case_ref,
    'iban',  case when u.iban is null then null else traccia.iban_format(u.iban) end
  );

  /* il saldo *dopo* il bonifico: si prende il movimento del ledger che porta
     lo stesso riferimento, così la ricevuta non ricalcola niente a modo suo.
     Se il bonifico non è ancora eseguito non esiste un saldo dopo: resta null
     e la ricevuta dice «non eseguito», che è la verità. */
  select l.balance_after into saldo
  from traccia.ledger_entries l
  where l.user_id = u.id
    and l.reference like '%' || t.reference || '%'
  order by l.created_at desc
  limit 1;

  return jsonb_build_object(
    'document', 'ricevuta_bonifico',
    'provider', traccia.provider_block(),
    'emesso_il', now(),
    'numero', t.reference,
    'stato', t.status,
    'eseguito', t.status = 'executed',
    'importo_eur', t.amount_eur,
    'divisa', 'EUR',
    'data_disposizione', t.created_at,
    'data_richiesta', t.requested_date,
    'data_valuta', t.value_date,
    'schema', case t.scheme
               when 'sepa_instant' then 'Bonifico SEPA istantaneo'
               when 'sepa_credit'  then 'Bonifico SEPA ordinario'
               else t.scheme end,
    'direzione', t.direction,
    'beneficiario', jsonb_build_object(
      'nome', t.beneficiary_name,
      'iban', traccia.iban_format(t.beneficiary_iban)
    ),
    'causale', t.remittance,
    'codice_causale', t.purpose_code,
    'codice_banca', t.bank_code,
    'messaggio_banca', t.bank_message,
    'saldo_dopo_eur', saldo,
    'cliente', cliente,
    /* una ricevuta che non dice cosa NON è lascia credere di avere in mano
       una fattura o una prova di pagamento definitiva */
    'nota', 'Ricevuta di disposizione, non documento fiscale. Il pagamento è '
         || 'eseguito solo quando la banca lo esegue: fino a quel momento la '
         || 'ricevuta riporta lo stato della disposizione.'
  );
end $$;


-- ---------------------------------------------------------------------------
-- 3. L'estratto dei soli bonifici
-- ---------------------------------------------------------------------------
-- Stessa forma dell'estratto conto (`estratto_conto`), così chi legge l'uno
-- capisce l'altro: stessi nomi di campo, stesse date, stesso saldo di apertura.
create or replace function traccia.bonifici_estratto(
  p_token text,
  p_da date default null,
  p_a date default null,
  p_stato text default null
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  dal date := coalesce(p_da, (current_date - interval '12 months')::date);
  al  date := coalesce(p_a, current_date);
  righe jsonb;
  numero int;
  totale numeric;
begin
  if dal > al then
    raise exception 'La data di inizio è successiva a quella di fine.' using errcode = '22023';
  end if;
  if p_stato is not null and p_stato not in
     ('queued', 'sent', 'executed', 'rejected', 'returned', 'cancelled') then
    raise exception 'Stato non riconosciuto: %', p_stato using errcode = '22023';
  end if;

  /* si guarda la data di disposizione, non quella valuta: una disposizione di
     oggi con valuta fra tre giorni appartiene al periodo in cui è stata
     disposta, altrimenti sparirebbe dall'estratto per tre giorni */
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference', t.reference,
      'disposto_il', t.created_at,
      'data_valuta', t.value_date,
      'data_richiesta', t.requested_date,
      'beneficiario', t.beneficiary_name,
      'iban', traccia.iban_format(t.beneficiary_iban),
      'importo_eur', t.amount_eur,
      'divisa', 'EUR',
      'causale', t.remittance,
      'codice_causale', t.purpose_code,
      'schema', t.scheme,
      'stato', t.status,
      'codice_banca', t.bank_code,
      'messaggio_banca', t.bank_message
    ) order by t.created_at desc), '[]'::jsonb),
    count(*),
    coalesce(sum(case when t.status = 'executed' then t.amount_eur else 0 end), 0)
  into righe, numero, totale
  from traccia.bank_transfers t
  where t.user_id = u.id
    and t.direction = 'out'
    and t.created_at::date between dal and al
    and (p_stato is null or t.status = p_stato);

  return jsonb_build_object(
    'da', dal,
    'a', al,
    'stato', p_stato,
    'conto', case when u.iban is null then null else traccia.iban_format(u.iban) end,
    'cliente', u.name,
    'numero_bonifici', numero,
    'totale_eseguito_eur', totale,
    'bonifici', righe
  );
end $$;


-- ---------------------------------------------------------------------------
-- 4. Wrapper `public` — la regola del 0017, applicata subito
-- ---------------------------------------------------------------------------
-- PostgREST vede solo `public`: una funzione senza wrapper, dal sito, non
-- esiste. Questi due sono chiamati dal client, quindi nascono con il wrapper.
create or replace function public.bonifico_ricevuta(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.bonifico_ricevuta(p_token, p_id); $f$;

create or replace function public.bonifici_estratto(
  p_token text, p_da date default null, p_a date default null, p_stato text default null)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.bonifici_estratto(p_token, p_da, p_a, p_stato); $f$;

revoke all on function traccia.bonifico_ricevuta(text, uuid) from public;
revoke all on function traccia.bonifici_estratto(text, date, date, text) from public;
revoke all on function public.bonifico_ricevuta(text, uuid) from public;
revoke all on function public.bonifici_estratto(text, date, date, text) from public;
grant execute on function public.bonifico_ricevuta(text, uuid) to anon, authenticated;
grant execute on function public.bonifici_estratto(text, date, date, text) to anon, authenticated;
