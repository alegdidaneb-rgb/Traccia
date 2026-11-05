-- ---------------------------------------------------------------------------
-- Rimozione della PEC dai dati del prestatore.
--
-- La PEC `traccia@pec.it` puntava a un dominio che non è nostro e a una casella
-- che non esiste: una PEC non si inventa, si attiva con un gestore accreditato.
-- Finché restava in `traccia.settings` tornava fuori nei contratti generati
-- (`contract.js`, `case.js`), anche dopo aver ripulito le pagine.
--
-- Da qui in avanti il canale scritto è l'email di assistenza. Il recesso resta
-- esercitabile (art. 52 Codice del Consumo): cambia il recapito, non il diritto.
-- ---------------------------------------------------------------------------

-- 1. La chiave sparisce dai due oggetti che la contengono.
update traccia.settings
   set value = value - 'pec'
 where key = 'provider';

update traccia.settings
   set value = value - 'provider_pec'
 where key = 'contract';

-- 2. Il blocco `provider` smette di esporre `pec` ed espone `email`.
--    `provider_block()` è l'unica fonte letta dai contratti: se qui non c'è
--    `pec`, non può ricomparire a valle.
create or replace function traccia.provider_block()
returns jsonb language sql stable
set search_path = traccia, public as $fn$
  select jsonb_build_object(
    'name',    coalesce(p.value ->> 'name',    c.value ->> 'provider_name',    'ERSEL SPA'),
    'vat',     coalesce(p.value ->> 'vat',     c.value ->> 'provider_vat'),
    'email',   coalesce(p.value ->> 'email',   'assistenza@traccia.it'),
    'address', coalesce(p.value ->> 'address', c.value ->> 'provider_address')
  )
  from (select value from traccia.settings where key = 'provider') p
  full join (select value from traccia.settings where key = 'contract') c on true
  limit 1;
$fn$;
