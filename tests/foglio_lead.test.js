/* ==========================================================================
   Il foglio Google delle segnalazioni
   ==========================================================================
   Il cliente: «i have connected spreadsheets, so in there every customer that
   registers or requests to report a case will be loaded here in the sheets».
   E poi: «non ho un ID e agli connectors google sheets quindi vai tu».

   Quindi lo strumento deve fare tutto da sé: il foglio esiste, si popola da
   solo, e nessuno deve incollare uno script. Quello che questi test
   difendono è la parte che si rompe **in silenzio**:

   1. il foglio è uno specchio, non una seconda coda: la funzione di lettura
      non deve poter cambiare niente;
   2. il segreto deve stare nel database, non nel repository — e senza
      segreto non deve uscire una riga;
   3. il CSV deve essere leggibile da un foglio italiano: accenti, virgole
      dentro i nomi, importi come numeri;
   4. la documentazione deve dire la verità su cosa è già in linea e cosa no.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const esiste = (f) => fs.existsSync(path.join(RADICE, f));

const SQL = R("supabase/migrations/0026_foglio_lead.sql");
const FUNZIONE = R("supabase/functions/leads-csv/index.ts");

test("il foglio legge, e non può scrivere", () => {
  /* Una segnalazione in due posti dove si può scrivere diventa due verità:
     Marco la prende in console, Sara la cambia nel foglio, il cliente riceve
     due telefonate. La funzione di lettura restituisce dati e basta, e il
     test lo controlla cercando le istruzioni che modificherebbero qualcosa. */
  /* l'unica scrittura ammessa è il segreto in `traccia.settings`: un dato di
     configurazione, non un lead */
  const scritture = (SQL.match(/\b(insert\s+into|update|delete\s+from)\s+([a-z_.]+)/gi) || []).map((m) => m.toLowerCase());
  scritture.forEach((s) => {
    assert.ok(/traccia\.settings/.test(s),
      `la migrazione del foglio scrive in ${s}: non è più uno specchio`);
  });
  assert.match(SQL, /returns jsonb language plpgsql security definer/);
  assert.match(SQL, /'righe', res/);
});

test("senza il segreto giusto non esce una riga", () => {
  /* L'indirizzo del foglio contiene il segreto, e un indirizzo si inoltra.
     La funzione deve rifiutare tutto il resto — e rifiutare **prima** di
     leggere, non dopo aver preparato la risposta. */
  assert.match(SQL, /p_segreto is null or p_segreto <> atteso/);
  assert.match(SQL, /errcode = '42501'/, "il rifiuto non ha un codice riconoscibile");
  const primaDelRifiuto = SQL.indexOf("p_segreto <> atteso");
  const primaDellaLettura = SQL.indexOf("from traccia.richieste r");
  assert.ok(primaDelRifiuto > 0 && primaDelRifiuto < primaDellaLettura,
    "la funzione legge i lead prima di controllare il segreto");
});

test("il segreto sta nel database, non nel repository", () => {
  /* Nel repository finisce tutto quello che viene committato, e questo
     repository è pubblico. Il segreto si genera in SQL la prima volta. */
  assert.match(SQL, /encode\(extensions\.gen_random_bytes\(24\), 'hex'\)/,
    "il segreto non è generato dal database");
  assert.match(SQL, /on conflict \(key\) do nothing/,
    "una seconda applicazione cambierebbe il segreto e staccherebbe il foglio");
  /* e non deve essere finito in nessun file servito al browser */
  const js = R("assets/js/config.js");
  assert.ok(!js.includes("foglio_segreto"), "il segreto è finito nella configurazione del sito");
});

test("il CSV si apre in un foglio italiano", () => {
  /* Tre dettagli che sembrano pedanteria e non lo sono: senza BOM gli accenti
     si rompono; senza virgolette un cognome con la virgola sposta le colonne;
     con la virgola decimale l'importo diventa testo e la colonna non si somma
     più. */
  assert.match(FUNZIONE, /\\uFEFF/, "manca il BOM: gli accenti arrivano rotti");
  /* le virgolette interne si raddoppiano: `"` → `""` */
  assert.ok(/replace\(\/"\/g,\s*'"\s*\+\s*"'?\)/.test(FUNZIONE) ||
            FUNZIONE.includes('replace(/"/g'),
    "le virgolette dentro un campo non vengono raddoppiate");
  assert.match(FUNZIONE, /toFixed\(2\)/, "l'importo non è scritto come numero");
  /* e un importo che non conosciamo non è zero: `Number(null)` fa 0, e la
     colonna sommerebbe righe che non hanno un importo */
  assert.match(FUNZIONE, /if \(valore === null \|\| valore === undefined \|\| valore === ""\) return ""/,
    "un importo mancante diventa 0.00: la colonna delle somme mentirebbe");
  assert.match(FUNZIONE, /"text\/plain; charset=utf-8"/,
    "il tipo dichiarato non è quello che il gateway accetta");
});

test("la funzione sa dire perché non risponde", () => {
  /* «Il foglio è vuoto» ha tre cause diverse — segreto, database, formato — e
     senza una via di diagnosi si finisce a indovinare. `?debug=1` restituisce
     gli stessi dati in JSON. */
  assert.match(FUNZIONE, /debug.*=== "1"/);
  assert.match(FUNZIONE, /Configurazione mancante/,
    "se manca la chiave pubblicabile la funzione fallisce senza dirlo");
  assert.match(FUNZIONE, /SUPABASE_PUBLISHABLE_KEYS/,
    "i progetti nuovi espongono la chiave come oggetto JSON: va letta");
});

test("la documentazione dice cosa è in linea e cosa no", () => {
  /* Questo è il difetto che si ripete in ogni consegna: un documento che
     descrive il sistema come sarà, e qualcuno che lo legge come se fosse
     già così. */
  const lead = R("LEAD.md");
  assert.match(lead, /foglio|Foglio/, "LEAD.md non parla del foglio");
  assert.match(lead, /leads_per_foglio/);
  assert.match(lead, /foglio_segreto/);

  const deploy = R("README-DEPLOY.md");
  assert.match(deploy, /leads-csv/, "README-DEPLOY non dice come si applica la funzione");
});

test("il foglio non è nel repository: è in Google", () => {
  /* Un CSV esportato dal foglio conterrebbe nomi e telefoni di persone
     truffate, e questo repository è pubblico. Nel repository sta il codice,
     non i dati. */
  const pubblicita = fs.readdirSync(path.join(RADICE, "pubblicita"));
  assert.ok(!pubblicita.some((f) => /segnalazion|lead.*\.csv/i.test(f)),
    "nel repository c'è un estratto del foglio con i dati dei clienti");
});

module.exports = casi;
