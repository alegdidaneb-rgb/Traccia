/* ==========================================================================
   Il saldo: si corregge dalla console, e resta scritto da dove viene
   ==========================================================================
   Richiesta dell'utente: «il saldo deve essere modificabile da parte
   dell'admin».

   Fino a oggi non si poteva, e non per dimenticanza. Il progetto ha una regola
   scritta in `supabase/migrations/0015_conto_corrente.sql`:

       «Nessuna funzione deve più fare `update users set balance_eur = ...`.
        Passando sempre da qui: il movimento c'è sempre, il saldo è sempre la
        sua somma, e il controllo del segno non si dimentica.»

   La strada corta era aggiungere `balance_eur` ai campi di `admin_salva_pratica`
   (la finestra «Modifica»). Sarebbe stata una modifica di tre righe e avrebbe
   rotto tre cose in silenzio:

     1. il saldo non sarebbe più stato la somma del libro movimenti, quindi
        l'estratto conto del cliente non avrebbe più tornato con il saldo;
     2. la correzione non avrebbe lasciato un movimento, quindi non si sarebbe
        potuto dire *quando* un saldo era cambiato né *perché*;
     3. il cliente non l'avrebbe vista. Una correzione invisibile è un saldo
        che cambia di notte — su un sito che si occupa di truffe, è il sospetto
        esatto che non si può dare.

   Questi test difendono la strada giusta in tre punti: c'è il pulsante, è
   collegato, e il saldo **non** passa dalla porta sbagliata.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const esiste = (f) => fs.existsSync(path.join(RADICE, f));

/* Le migrazioni, in ordine: l'ultima che tocca una funzione è quella che vale. */
function migrazioni() {
  const cartella = path.join(RADICE, "supabase", "migrations");
  return fs.readdirSync(cartella).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ nome: f, testo: fs.readFileSync(path.join(cartella, f), "utf8") }));
}

const MIGRAZIONE = "0034_saldo_lo_corregge_l_admin.sql";

/* =================================================== il pulsante, in console == */

test("sulla riga del cliente c'è un pulsante per il saldo", () => {
  /* Il difetto da impedire è quello già visto due volte in questa console: il
     gestore del clic esiste, la funzione esiste, e **nessun pulsante li
     attiva**. La verifica IBAN e il cambio di ruolo sono stati trovati così:
     codice scritto e irraggiungibile. */
  const admin = R("assets/js/admin.js");
  assert.ok(/data-saldo=/.test(admin), "manca l'attributo data-saldo sul pulsante");

  /* E deve stare **nella riga**, non solo essere costruito: qui il difetto da
     impedire è precisamente quello — una variabile `saldoBtn` valorizzata e
     mai concatenata nella cella delle azioni. La prima versione di questo test
     cercava `data-saldo` nel file intero e passava anche togliendo il pulsante
     dalla riga: provato. */
  assert.ok(/var saldoBtn\s*=/.test(admin), "la variabile `saldoBtn` non viene costruita");
  /* La cella delle azioni **della riga della pratica**: è quella che contiene
     «Modifica» e «Apri». In questo file ce ne sono dodici, per tabelle
     diverse, quindi non si può prendere la prima: si cerca quella che
     concatena i pulsanti della pratica. */
  const celle = [...admin.matchAll(/data-table__actions">' \+ ([^\n]*) \+ "<\/td>"/g)]
    .map((m) => m[1]);
  const cella = celle.filter((c) => /editBtn/.test(c) && /openBtn/.test(c))[0];
  assert.ok(cella,
    "non trovo la cella delle azioni della pratica (quella con «Modifica» e «Apri»)");
  assert.ok(/saldoBtn/.test(cella),
    "il pulsante «Saldo» è costruito ma non è concatenato nella riga: " +
    "resterebbe invisibile, come la verifica IBAN e il cambio di ruolo prima " +
    "di questa correzione. Nella cella ci sono: " + cella.trim());
});

test("il pulsante è collegato al gestore dei clic", () => {
  const admin = R("assets/js/admin.js");
  assert.ok(/closest\("\[data-saldo\]"\)/.test(admin),
    "il clic su «Saldo» non è intercettato: premere il pulsante non farebbe niente");
  const gestore = admin.slice(admin.indexOf('closest("[data-saldo]")'));
  assert.ok(/rettificaSaldo\(/.test(gestore.slice(0, 300)),
    "il clic non chiama `rettificaSaldo`");
});

test("il saldo non si modifica dalla finestra «Modifica»", () => {
  /* È la difesa della regola. `admin_salva_pratica` accetta solo nome,
     cognome, telefono, importo segnalato, note: il saldo non è fra i campi, e
     questa finestra non deve mandarlo. Se un domani qualcuno lo aggiungesse
     qui per comodità, il saldo cambierebbe senza movimento. */
  const admin = R("assets/js/admin.js");

  /* il corpo di `modificaPratica`: dalla definizione alla funzione successiva */
  const inizio = admin.indexOf("function modificaPratica(");
  assert.ok(inizio > 0, "`modificaPratica` non esiste più");
  const dopo = admin.indexOf("\n  function ", inizio + 10);
  const corpo = admin.slice(inizio, dopo > 0 ? dopo : inizio + 6000);

  assert.ok(!/balance_eur/.test(corpo),
    "la finestra «Modifica» tocca `balance_eur`: il saldo deve passare solo " +
    "da `rettificaSaldo`, che registra un movimento");
});

test("l'API espone la rettifica con il saldo finale, non con la differenza", () => {
  /* Il parametro si chiama `p_nuovo_saldo`, e chi corregge ha in mano un
     estratto conto: ragiona sul totale. Passare la differenza al posto del
     totale darebbe un saldo sbagliato di un fattore due — un errore che si
     scopre solo dal cliente. */
  const api = R("assets/js/api.js");
  const i = api.indexOf("rettificaSaldo");
  assert.ok(i > 0, "`api.rettificaSaldo` non esiste");
  const corpo = api.slice(i, i + 400);
  assert.ok(/admin_rettifica_saldo/.test(corpo), "la funzione RPC chiamata non è quella giusta");
  assert.ok(/p_nuovo_saldo/.test(corpo), "il parametro deve essere il saldo finale");
  assert.ok(!/p_delta|p_importo/.test(corpo), "la rettifica non passa una differenza");
});

/* ==================================================== il database, la regola == */

test("la migrazione esiste e passa da `registra_movimento`", () => {
  assert.ok(esiste(`supabase/migrations/${MIGRAZIONE}`),
    `manca la migrazione ${MIGRAZIONE}: la funzione esisterebbe solo nel database`);

  const sql = R(`supabase/migrations/${MIGRAZIONE}`);
  assert.ok(/traccia\.registra_movimento\s*\(/.test(sql),
    "la migrazione non passa da `registra_movimento`: il saldo non sarebbe più " +
    "la somma del libro movimenti");
  assert.ok(/'adjustment'/.test(sql),
    "il movimento deve essere di tipo `adjustment`, quello previsto per le correzioni");
});

test("la migrazione non scrive `balance_eur` con un update", () => {
  /* La regola del 0015, verificata sul testo: `registra_movimento` è l'unica
     funzione che scrive quella colonna, e la rettifica la chiama invece di
     imitarla. Un `update traccia.users set balance_eur` qui dentro
     funzionerebbe, e lascerebbe il libro movimenti disallineato per sempre. */
  const sql = R(`supabase/migrations/${MIGRAZIONE}`)
    /* i commenti non contano: la regola è citata in testa, apposta */
    .replace(/^\s*--.*$/gm, " ");
  assert.ok(!/update\s+traccia\.users\s+set[^;]*balance_eur/i.test(sql),
    "la migrazione scrive `balance_eur` direttamente: il saldo deve essere la " +
    "somma dei movimenti, non una colonna aggiornata a mano");
});

test("il denaro impegnato non si può scavalcare", () => {
  /* Se il cliente ha chiesto di prelevare 5.000 € e il saldo scende sotto
     quelli, la richiesta già accettata diventa impossibile da onorare. Il
     controllo deve stare nel database, non solo nella finestra: una finestra
     si aggira con una chiamata diretta. */
  const sql = R(`supabase/migrations/${MIGRAZIONE}`).replace(/^\s*--.*$/gm, " ");
  /* Non basta che la parola compaia — compare anche nel messaggio d'errore e
     nei commenti. Serve la **condizione**: `if nuovo < coalesce(t.reserved_eur
     …)`. Sostituendola con `if false then` la prima versione di questo test
     restava verde: provato. */
  assert.ok(/if\s+nuovo\s*<\s*coalesce\(\s*t\.reserved_eur/i.test(sql),
    "manca la condizione che impedisce di portare il saldo sotto le somme già " +
    "impegnate: la parola `reserved_eur` da sola non difende niente");
});

test("la motivazione è obbligatoria e lunga almeno otto caratteri", () => {
  /* La rettifica è l'unica scrittura del sistema senza un documento dietro —
     un bonifico, un contratto, un'operazione approvata. Il testo è l'unica
     traccia: «ok» non è una traccia. */
  const sql = R(`supabase/migrations/${MIGRAZIONE}`);
  assert.ok(/length\s*\(\s*motivo\s*\)\s*<\s*8/i.test(sql),
    "manca il controllo sulla lunghezza della motivazione");

  /* e lo stesso controllo deve esistere nella finestra, così l'errore si legge
     mentre si scrive invece che dopo un giro sul server */
  const admin = R("assets/js/admin.js");
  const i = admin.indexOf("function rettificaSaldo(");
  const corpo = admin.slice(i, i + 6000);
  assert.ok(/motivo\.length\s*<\s*8/.test(corpo),
    "la finestra non controlla la motivazione prima di inviare");
});

test("togliere denaro chiede una conferma in più", () => {
  /* Aggiungere soldi e toglierli non hanno lo stesso peso. Una diminuzione è
     l'unico gesto della console che porta via denaro a un cliente senza un
     documento che lo giustifichi: si conferma due volte. */
  const admin = R("assets/js/admin.js");
  const i = admin.indexOf("function rettificaSaldo(");
  const corpo = admin.slice(i, i + 6000);
  assert.ok(/differenza < 0/.test(corpo), "la diminuzione non è distinta dall'aumento");
  assert.ok(/ui\.ask\(/.test(corpo), "la diminuzione non chiede conferma");
});

/* ============================================ il cliente la rettifica la vede == */

test("il cliente sa leggere una rettifica nel suo estratto conto", () => {
  /* Se l'interfaccia del cliente non conoscesse `adjustment`, il movimento
     comparirebbe come «adjustment» in mezzo agli altri: una parola inglese
     senza significato, proprio nel punto in cui il cliente deve capire perché
     il suo saldo è cambiato. */
  const caso = R("assets/js/case.js");
  assert.ok(/adjustment:\s*"[^"]+"|adjustment:\s*'[^']+'/.test(caso),
    "`case.js` non ha un'etichetta per `adjustment`: il cliente vedrebbe la " +
    "parola «adjustment» nell'estratto conto");
});

module.exports = casi;
