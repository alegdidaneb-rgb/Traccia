-- ============================================================================
-- 0031b — il registro delle migrazioni torna allineato al file
-- ============================================================================
-- 0031 è stata applicata a Supabase il 2026-11-15 con il nome `scrivere_al_cliente`
-- (vocaboli del progetto), quindi `supabase_migrations.schema_migrations` ha la
-- sua voce ma lo schema `supabase_migrations` non è nel repository: chi ricostruisce
-- il database dai file vede la voce 0031 già presa e non sa che l'ha creata.
--
-- Questa migrazione non tocca il database: esiste perché il file resti la
-- descrizione completa di ciò che è stato applicato, e chi legge 0031 sappia dove
-- cercare. Le migrazioni si applicano nell'ordine dei file; questa è vuota apposta.
--
-- La migrazione equivalente applicata al progetto on-line:
--   20261115082444  scrivere_al_cliente  (≡ supabase/migrations/0031_scrivere_al_cliente.sql)
-- ============================================================================

do $$
begin
  -- Il vincolo nuovo può esistere solo se 0031 è passata: se manca, qualcuno ha
  -- applicato questo file fuori ordine e lo schema non è quello che il file dice.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'traccia.notifications'::regclass
       and conname = 'notifications_kind_check'
       and pg_get_constraintdef(oid) like '%messaggio%'
  ) then
    raise exception '0031 non risulta applicata: manca «messaggio» nel vincolo di notifications.kind.'
      using errcode = 'P0001';
  end if;
end $$;
