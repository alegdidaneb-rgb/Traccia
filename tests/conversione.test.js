/* ==========================================================================
   La conversione: quando un modulo riesce, l'evento parte
   ==========================================================================
   Un contatore di visite non dice se la campagna funziona. Senza un evento
   «lead», Google vede 300 visite e non sa se sotto ci sono dodici richieste
   o nessuna: due campagne identiche nel grafico, una da spegnere e una da
   raddoppiare.

   Questi test difendono le tre cose che si rompono in silenzio:

   1. **l'evento parte solo quando il server ha detto sì** — agganciato al
      clic, conterebbe anche i numeri rifiutati e i doppioni;
   2. **non porta dati personali** — un telefono dentro un evento di
      Analytics è un dato personale in un sistema di Google;
   3. **non parte due volte** per la stessa persona (modulo veloce + modulo
      completo nello stesso minuto = tre conversioni per un lead solo, e il
      costo per lead sembra un terzo del vero).
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* Lo script si carica come lo caricherebbe il browser: si aggancia a `window`. */
function conversione(extra) {
  const sorgente = R("assets/js/conversione.js");
  const finestra = Object.assign({}, extra || {});
  const eventi = [];
  finestra.document = { dispatchEvent: (e) => eventi.push(e) };
  finestra.CustomEvent = function (nome, opzioni) {
    this.type = nome;
    this.detail = (opzioni || {}).detail;
  };
  new Function("window", "document", sorgente)(finestra, finestra.document);
  return { api: finestra.TracciaConversione, finestra, eventi };
}

/* ------------------------------------------------------------ l'evento -- */

test("il modulo riuscito produce un evento `lead`, con il nome del modulo", () => {
  const { api, finestra } = conversione();
  assert.ok(api && typeof api.lead === "function", "TracciaConversione.lead non esiste");
  assert.equal(api.lead("veloce"), true, "l'evento non è partito");

  const coda = finestra.dataLayer || [];
  const evento = coda[coda.length - 1];
  assert.equal(evento.event, "lead", "l'evento non si chiama `lead`");
  assert.equal(evento.modulo, "veloce", "il modulo non è dichiarato");
  assert.ok(evento.origine, "manca l'origine: le conversioni non si possono attribuire");
});

test("l'origine è la stessa che finisce nel database", () => {
  const { api, finestra } = conversione({
    TracciaOrigine: { valore: () => "meta-de" },
  });
  api.lead("veloce");
  const evento = finestra.dataLayer[0];
  assert.equal(evento.origine, "meta-de",
    "l'evento e la riga del lead direbbero due origini diverse");
});

test("nessun dato personale nell'evento", () => {
  const { api, finestra } = conversione();
  api.lead("completo");
  const evento = finestra.dataLayer[0];
  const testo = JSON.stringify(evento).toLowerCase();
  /* i nomi dei campi che non devono comparire, non i valori: il test deve
     restare valido quando il primo lead sarà una persona vera */
  for (const vietato of ["telefono", "phone", "email", "nome", "name", "importo", "amount"]) {
    assert.ok(!testo.includes(`"${vietato}"`),
      `l'evento porta «${vietato}»: è un dato personale dentro Analytics`);
  }
});

/* -------------------------------------------------------- il doppione -- */

test("due moduli nello stesso minuto contano un lead solo", () => {
  const { api, finestra } = conversione();
  assert.equal(api.lead("veloce"), true);
  assert.equal(api.lead("completo"), false, "il secondo invio ha contato una seconda conversione");
  assert.equal(finestra.dataLayer.length, 1,
    "una persona, due conversioni: il costo per lead sembrerebbe la metà");
});

test("passati dieci minuti, un secondo lead conta di nuovo", () => {
  const { api, finestra } = conversione();
  api.lead("veloce");
  api._azzera();
  assert.equal(api.lead("veloce"), true, "il freno non si azzera: nessun lead verrebbe più contato");
  assert.equal(finestra.dataLayer.length, 2);
});

test("anche il canale diretto riceve l'evento, se è acceso", () => {
  const chiamate = [];
  const { api } = conversione({ gtag: function () { chiamate.push([...arguments]); } });
  api.lead("supporto");
  assert.equal(chiamate.length, 1, "gtag non è stato chiamato");
  assert.deepEqual(chiamate[0].slice(0, 2), ["event", "lead"]);
});

test("senza gtag e senza dataLayer il modulo non si rompe", () => {
  /* None of the two channels present: the form must still work — an event
     that cannot be sent is a missing number, not a broken submission. */
  const sorgente = R("assets/js/conversione.js");
  const finestra = {};
  new Function("window", "document", sorgente)(finestra, { dispatchEvent: () => {} });
  assert.doesNotThrow(() => finestra.TracciaConversione.lead("veloce"));
});

/* ---------------------------------------------- i punti di aggancio -- */

test("i tre moduli segnalano la conversione dopo la risposta del server", () => {
  const auth = R("assets/js/auth.js");
  /* veloce e completo: la chiamata sta dentro il `.then`, non nel clic */
  const agganci = [...auth.matchAll(/segnalaConversione\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(agganci.sort(), ["completo", "veloce"],
    `auth.js segnala: ${agganci.join(", ") || "niente"}`);

  const iVeloce = auth.indexOf('segnalaConversione("veloce")');
  const iThenVeloce = auth.lastIndexOf(".then(", iVeloce);
  assert.ok(iThenVeloce > 0 && iVeloce - iThenVeloce < 600,
    "la conversione veloce non è dentro il `.then` della chiamata");

  const main = R("assets/js/main.js");
  assert.match(main, /TracciaConversione\.lead\("supporto"\)/,
    "il modulo della pagina Contatti non conta la conversione");
});

test("lo script della conversione è caricato su ogni pagina servita", () => {
  const pagine = ["index.html", "login.html", "supporto.html", "de/index.html", "en/login.html"];
  for (const p of pagine) {
    assert.match(R(p), /assets\/[0-9a-f]{8}\/js\/conversione\.js/,
      `${p}: manca lo script della conversione`);
  }
  /* e sta dentro il blocco della misurazione, dopo il contenitore: se partisse
     prima, il `dataLayer` non esisterebbe ancora e l'evento andrebbe perso */
  const index = R("index.html");
  assert.ok(index.indexOf("conversione.js") > index.indexOf("gtm.js"),
    "la conversione carica prima di GTM");
});

module.exports = casi;
