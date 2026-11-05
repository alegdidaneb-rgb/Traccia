-- ---------------------------------------------------------------------------
-- Permessi di servizio sul schema `traccia`.
--
-- La migrazione `chiudi_schema_traccia_alla_data_api` ha revocato i privilegi
-- sulla clausola PUBLIC. In PostgreSQL i privilegi di default delle funzioni
-- passano da lì, quindi la revoca ha tolto l'accesso anche a `service_role`:
-- verificato, `has_schema_privilege('service_role','traccia','usage')` era
-- `false` e `service_role` non poteva eseguire `traccia.log_action`.
--
-- Le funzioni che devono restare raggiungibili dalla Data API sono i wrapper
-- `public.*`, che sono SECURITY DEFINER e girano con i privilegi del
-- proprietario: a quelli non serve nulla e restano com'erano.
--
-- `service_role` è un ruolo diverso: non è raggiungibile con la chiave
-- pubblica, e serve alle funzioni di servizio (invio del codice di conferma,
-- operazioni di manutenzione) che devono poter chiamare le funzioni interne
-- senza impersonare un utente. Il permesso si concede in modo esplicito e
-- ristretto — schema in USO, esecuzione alle funzioni — invece di lasciarlo
-- passare dalla clausola PUBLIC, che aprirebbe anche ad `anon`.
-- ---------------------------------------------------------------------------

-- 1. Lo schema è di nuovo nominabile, ma solo dal ruolo di servizio.
grant usage on schema traccia to service_role;

-- 2. Esecuzione delle funzioni esistenti.
grant execute on all functions in schema traccia to service_role;

-- 3. Le funzioni future nascono già raggiungibili dal servizio: senza questo,
--    la prossima migrazione che aggiunge una funzione la lascerebbe
--    irraggiungibile e l'errore comparirebbe solo a runtime.
alter default privileges in schema traccia
  grant execute on functions to service_role;

-- 4. `anon` e `authenticated` restano fuori. La verifica sta in fondo, così se
--    qualcuno riapre il schema per sbaglio la migrazione non lo nasconde.
do $$
declare
  anon_usage boolean := has_schema_privilege('anon', 'traccia', 'usage');
  aut_usage  boolean := has_schema_privilege('authenticated', 'traccia', 'usage');
  svc_usage  boolean := has_schema_privilege('service_role', 'traccia', 'usage');
begin
  if anon_usage or aut_usage then
    raise exception 'Il schema traccia è ancora raggiungibile da anon/authenticated: la chiusura è stata annullata.';
  end if;
  if not svc_usage then
    raise exception 'service_role non ha ottenuto l''accesso al schema traccia.';
  end if;
end $$;
