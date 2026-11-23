/* ==========================================================================
   «+ Nuova pratica»: ogni pulsante deve aprirla, non solo il primo
   ==========================================================================
   Segnalazione dell'utente, 2026-11-23: «dal sito admin quando clicco su
   nuova pratica non fa niente».

   La causa non è un errore: è un collegamento mancante.

     document.querySelector("[data-new-account]").addEventListener(...)

   `querySelector` restituisce il **primo** elemento nel documento. In
   `admin.html` i pulsanti «+ Nuova pratica» sono due:

     riga ~395  intestazione della sezione Richieste
     riga ~477  intestazione della sezione Pratiche   ← quello che si usa

   Il secondo è stato aggiunto dopo, con la motivazione giusta scritta nel
   commento sopra il primo — «A tutti: dentro la sezione Pratiche, perché è
   qui che si vede quante pratiche ci sono» — ma il collegamento è rimasto
   quello singolo. Il pulsante sotto «Pratiche» non aveva nessun gestore:
   si premeva, non succedeva niente, e non c'era nemmeno un errore in
   console, perché non c'era codice da eseguire.

   --------------------------------------------------------------------------
   Perché un test guarda il **codice** e non l'HTML
   --------------------------------------------------------------------------
   Questo errore non si vede leggendo la pagina: i due pulsanti sono identici,
   e quello rotto è indistinguibile da quello che funziona. Si vede solo
   confrontando il numero di elementi con il numero di collegamenti. Quindi
   il test legge `admin.js` e verifica la **forma** del collegamento:

     - nessun `querySelector("[data-…]")` singolare su un attributo che
       nell'HTML compare più volte, quando serve un gestore per ognuno;
     - in particolare, `data-new-account` è collegato con `querySelectorAll`
       e un ciclo, non con un `querySelector`.

   Il secondo test è quello che conta davvero per il futuro: vale per
   qualunque attributo aggiunto domani, non solo per questo.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const JS = fs.readFileSync(path.join(RADICE, "assets", "js", "admin.js"), "utf8");
const HTML = fs.readFileSync(path.join(RADICE, "admin.html"), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* --------------------------------------------------------------- ritagli -- */

/* I commenti citano il difetto e contengono le stringhe del difetto: cercare
   dentro i commenti trova la spiegazione al posto del codice. */
function senzaCommentiJs(sorgente) {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function senzaCommentiHtml(sorgente) {
  return sorgente.replace(/<!--[\s\S]*?-->/g, "");
}

const JS_PULITO = senzaCommentiJs(JS);
const HTML_PULITO = senzaCommentiHtml(HTML);

/* Quante volte un attributo `data-…` compare nell'HTML, come attributo intero
   e non come prefisso di un altro (`data-new-account` non deve contare
   `data-new-account-modal`). */
function occorrenzeAttributo(attr) {
  const re = new RegExp("\\b" + attr.replace(/[-]/g, "\\-") + "(?=[\\s=>/]|$)", "g");
  return (HTML_PULITO.match(re) || []).length;
}

/* =========================================== il difetto, scritto come test == */

test("«+ Nuova pratica» è collegato su **ogni** pulsante, non solo sul primo", () => {
  const quanti = occorrenzeAttributo("data-new-account");
  assert.ok(quanti >= 2,
    "servono almeno due punti d'ingresso (Richieste e Pratiche), trovati " + quanti);

  /* la forma sbagliata: querySelector singolare che collega un solo elemento */
  const singolare = /document\.querySelector\(\s*["']\[data-new-account\]["']\s*\)/;
  assert.ok(!singolare.test(JS_PULITO),
    "`querySelector(\"[data-new-account]\")` collega un solo pulsante: con " +
    quanti + " pulsanti in pagina, quello sotto «Pratiche» non fa niente. " +
    "Serve `querySelectorAll` + ciclo.");

  /* la forma giusta */
  const plurale = /querySelectorAll\(\s*["']\[data-new-account\]["']\s*\)/;
  assert.ok(plurale.test(JS_PULITO),
    "manca il ciclo su tutti i pulsanti `[data-new-account]`");
});

test("il ciclo collega ogni pulsante ad `openNewAccount`", () => {
  /* Non basta che `querySelectorAll` ci sia: deve anche finire in una
     `addEventListener` dentro il ciclo. Un `querySelectorAll` che fa
     `forEach(function () {})` vuoto passerebbe il test qui sopra. */
  const blocco = JS_PULITO.slice(JS_PULITO.indexOf("[data-new-account]"));
  assert.ok(/forEach/.test(blocco.slice(0, 400)),
    "il risultato di querySelectorAll va ciclato");
  assert.ok(/addEventListener\(\s*["']click["']\s*,\s*openNewAccount\s*\)/.test(blocco.slice(0, 400)),
    "ogni pulsante deve aprire la finestra (`openNewAccount`)");
});

/* ================================ la classe dell'errore, per il futuro == */

test("nessun attributo `data-…` duplicato è collegato con un selettore singolare", () => {
  /* Questa è la difesa generale. L'elenco delle eccezioni è corto e ognuna è
     motivata: sono attributi che compaiono più volte ma si leggono **tutti**
     con `querySelectorAll`, oppure che hanno un solo elemento «vero» e
     vengono cercati per prefisso.

     Se domani qualcuno aggiunge un secondo pulsante e lo collega col
     `querySelector` di sempre, questo test lo scopre **qui**, non in
     produzione dopo la segnalazione di un cliente. */
  const eccezioni = new Set([
    "data-set",            // prefisso di data-setting / data-setting-bool
    "data-setting",        // letti tutti con querySelectorAll
    "data-setting-bool",   // letti tutti con querySelectorAll
    "data-da-fare",        // contenitore unico; le voci si cercano per prefisso
    "data-messages",       // un solo contenitore, la seconda occorrenza è il contatore
    "data-lang",           // selettore di lingua, gestito in main.js
    "data-na",             // prefisso degli elementi della finestra
  ]);

  const colpevoli = [];
  const re = /document\.querySelector\(\s*["']\[(data-[a-z0-9]+(?:-[a-z0-9]+)*)\]["']\s*\)/g;
  let m;
  while ((m = re.exec(JS_PULITO))) {
    const attr = m[1];
    if (eccezioni.has(attr)) continue;
    if (occorrenzeAttributo(attr) > 1) {
      colpevoli.push(`${attr} (${occorrenzeAttributo(attr)} elementi in pagina)`);
    }
  }

  assert.deepStrictEqual(colpevoli, [],
    "attributi presenti più volte ma collegati con `querySelector` singolare:\n  " +
    colpevoli.join("\n  "));
});

/* ============================================== la finestra si apre davvero == */

test("la finestra esiste ed è quella che il codice cerca", () => {
  /* Se l'id cambia, `openNewAccount` esplode su `getElementById(...).value` e
     il pulsante sembra rotto per un'altra ragione. Qui si verifica il patto
     fra HTML e codice, che è la cosa che si rompe in silenzio. */
  assert.ok(/data-new-account-modal/.test(HTML_PULITO), "manca la finestra");
  ["na-name", "na-email", "na-password", "na-balance", "na-kyc", "na-status", "na-role"]
    .forEach(function (id) {
      assert.ok(new RegExp('id="' + id + '"').test(HTML_PULITO),
        `manca il campo #${id}: openNewAccount lo cerca e andrebbe in errore`);
    });
});

test("la finestra parte chiusa e il codice la chiude in tutti i modi", () => {
  /* Una finestra che si apre e non si chiude è un altro modo di dire «non
     funziona». I tre modi di uscire: Annulla, la ×, e il clic fuori. */
  assert.ok(/data-new-account-modal\s+hidden/.test(HTML_PULITO),
    "la finestra deve partire `hidden`");
  ["data-na-cancel", "data-na-close"].forEach(function (attr) {
    assert.ok(new RegExp("addEventListener\\(\"click\",\\s*").test(JS_PULITO),
      "i pulsanti di chiusura devono essere collegati");
    assert.equal(occorrenzeAttributo(attr), 1, `${attr}: deve essere unico`);
  });
});

module.exports = casi;
