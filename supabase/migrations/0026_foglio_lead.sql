/* ==========================================================================
   0026 — i lead in uno specchio: Google Sheets, in sola lettura
   ==========================================================================

   Il cliente: «i have connected spreadsheets, so in there every customer that
   registers or requests to report a case will be loaded here in the sheets».

   Nessuna riga di codice scriveva su un foglio. Il sito scrive in
   `traccia.richieste`; un foglio collegato a mano resta vuoto per sempre. E
   siccome lui non ha un ID né sa dove prenderlo, lo strumento deve fare tutto
   da sé: lettura dal database, e una funzione che si chiama da un Apps Script
   senza dipendere da un pannello.

   ---------------------------------------------------------------------------
   PERCHÉ IL FOGLIO NON È LA CODA
   ---------------------------------------------------------------------------
   Una segnalazione in due posti diventa due verità: Marco la prende in
   console, Sara guarda il foglio (che non sa niente della presa in carico) e
   chiama. Il cliente riceve due telefonate e capisce che nessuno sa chi lo
   segue. Con due lead al giorno non succede; con cento è esattamente così che
   si perde la fiducia di chi ha già perso dei soldi.

   Quindi il foglio è uno **specchio**: contiene i lead e il loro stato, e
   basta. Non contiene un pulsante, non si può scrivere dentro, e l'unica cosa
   che cambia da sé è il contenuto della colonna `stato` quando qualcuno agisce
   in console. Chi lavora i lead lavora in `admin.html`, dove c'è il «Prendi»
   che con il database è atomico.

   ---------------------------------------------------------------------------
   DUE COSE CHE NON HO FATTO, E PERCHÉ
   ---------------------------------------------------------------------------
   1. **Nessun trigger che scriva su Sheets.** Servirebbe `pg_net` (non è
      installato), una chiave di service account da custodire, un token che
      scade ogni ora da rinnovare con un cron, e un secondo percorso di
      notifica accanto a quello della 0025. Tanta macchina che si rompe **in
      silenzio**: il lead salvato, il foglio vuoto, nessuno che se ne accorge.
      Il foglio che *legge* è più semplice e se Sheets è giù il lead resta in
      console lo stesso.

   2. **I clienti registrati non sono in questa funzione.** «Chi si registra»
      e «chi chiede una perizia» sono due cose diverse: il modulo non crea più
      account dal 2026-11-06 (migrazione 0024), quindi una tabella sola con
      entrambi mescolerebbe richieste e account veri, e una riga non si
      capirebbe. Se servirà anche l'elenco clienti, sarà una seconda funzione
      con un secondo foglio — non un'unione.

   ---------------------------------------------------------------------------
   SICUREZZA
   ---------------------------------------------------------------------------
   La funzione la chiama un Apps Script, che non ha e non può avere una
   password di un analista. Quindi è `security definer` con un **segreto
   condiviso**, che sta in `traccia.settings` (la tabella che c'è già, non nel
   repository e non nel codice del foglio). Con il segreto sbagliato risponde
   42501 e non restituisce niente.

   Restituisce **solo i campi che il foglio deve mostrare**, e il numero di
   telefono lo dà solo a chi ha il segreto: non è un elenco pubblico, è la
   stessa informazione che sta in console, letta da un altro posto.

   Perché non `admin_richieste` con un token di sessione: quella richiede un
   login, e un token dentro un foglio è una password in chiaro in un file
   condiviso.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Il segreto
   --------------------------------------------------------------------------
   Si genera qui la prima volta e non si rigenera: se cambia, l'Apps Script
   smette di leggere e va aggiornato. Per leggerlo:

       select value #>> '{}' from traccia.settings where key = 'foglio_segreto';

   Non va incollato nel repository, né in una pagina del sito.
   -------------------------------------------------------------------------- */
insert into traccia.settings (key, value)
values (
  'foglio_segreto',
  to_jsonb(encode(extensions.gen_random_bytes(24), 'hex'))
)
on conflict (key) do nothing;

/* --------------------------------------------------------------------------
   La funzione di lettura
   --------------------------------------------------------------------------
   `p_dopo` è l'ora dell'ultima riga letta dal foglio: il foglio chiede solo
   quello che non ha, quindi ogni giro costa pochi byte anche con diecimila
   righe. `p_dopo is null` vuol dire «dammi le ultime cento», che è la prima
   esecuzione e anche il caso in cui il foglio è stato svuotato a mano.

   L'ordine è **dal più vecchio al più nuovo**: il foglio appende in fondo, e
   un ordine diverso mescolerebbe la cronologia.
   -------------------------------------------------------------------------- */
create or replace function traccia.leads_per_foglio(
  p_segreto text,
  p_dopo    timestamptz default null,
  p_limite  int default 100
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  atteso text;
  res    jsonb;
  adesso timestamptz := now();
  n      int := least(greatest(coalesce(p_limite, 100), 1), 500);
begin
  /* --- la porta ------------------------------------------------------- */
  /* il valore è un jsonb: `#>> '{}'` lo estrae come testo semplice, che è
     quello che serve confrontare (non `"abc"` con le virgolette) */
  select value #>> '{}' into atteso from traccia.settings where key = 'foglio_segreto';
  if atteso is null or atteso = '' then
    raise exception 'Il foglio non è ancora configurato.' using errcode = '42501';
  end if;
  /* il confronto non deve raccontare, con i tempi, quante cifre sono giuste */
  if p_segreto is null or p_segreto <> atteso then
    raise exception 'Segreto non valido.' using errcode = '42501';
  end if;

  /* --- le righe ------------------------------------------------------- */
  select coalesce(jsonb_agg(riga order by ordine), '[]'::jsonb) into res
  from (
    select r.created_at as ordine,
      jsonb_build_object(
        'id', r.id,
        'creata', r.created_at,
        'nome', r.first_name || ' ' || r.last_name,
        'telefono', r.phone,
        'email', r.email,
        'importo', r.amount_eur,
        'tipo', coalesce(r.situation, ''),
        'origine', coalesce(r.origine, ''),
        'stato', r.status,
        'in_carico_a', coalesce((select u.name from traccia.users u where u.id = r.taken_by), ''),
        'note', coalesce(r.note, '')
      ) as riga
    from traccia.richieste r
    where p_dopo is null or r.created_at > p_dopo
    order by r.created_at desc
    limit n
  ) s;

  /* `ultima` è l'ora da rimandare come `p_dopo` al giro dopo. Se non ci sono
     righe si restituisce comunque l'ora della chiamata: il foglio non deve
     rileggere da capo ogni volta che una giornata è vuota. */
  return jsonb_build_object(
    'righe', res,
    'ultima', coalesce(
      (select max(r.created_at) from traccia.richieste r
       where p_dopo is null or r.created_at > p_dopo),
      adesso),
    'letto_il', adesso);
end $$;

revoke all on function traccia.leads_per_foglio(text, timestamptz, int) from public;
-- `anon` è il ruolo della chiave publishable: la funzione si protegge da sola
-- con il segreto, come le altre RPC pubbliche del progetto.
grant execute on function traccia.leads_per_foglio(text, timestamptz, int)
  to anon, authenticated;

create or replace function public.leads_per_foglio(
  p_segreto text,
  p_dopo    timestamptz default null,
  p_limite  int default 100
)
returns jsonb language sql security definer
set search_path = traccia, extensions
as $f$ select traccia.leads_per_foglio(p_segreto, p_dopo, p_limite); $f$;
revoke all on function public.leads_per_foglio(text, timestamptz, int) from public;
grant execute on function public.leads_per_foglio(text, timestamptz, int)
  to anon, authenticated;
