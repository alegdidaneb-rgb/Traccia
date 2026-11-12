/* ==========================================================================
   La pratica racconta solo cose vere
   ==========================================================================
   Il difetto che questi test difendono è stato visto da un cliente: nella sua
   area riservata comparivano «12 mar», «24 mar» e «2 punti di aggancio» su una
   pratica aperta a novembre. Non erano dati sbagliati nel database — erano
   **scritti a mano nell'HTML**, come segnaposto mai collegati a niente.

   Tre regole, e ognuna ha un test perché ognuna si può rompere in silenzio:

   1. nessuna data anteriore alla registrazione, in pagina;
   2. nessun contenuto inventato: se il dato non c'è, la pagina dice che non
      c'è invece di mostrare un esempio;
   3. l'anno si scrive sempre: «12 mar» senza anno non si può verificare.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* ------------------------------------------------------------------ HTML -- */

test("app.html non contiene più la cronologia scritta a mano", () => {
  const h = R("app.html");
  /* le date e le frasi che il cliente ha visto su una pratica di novembre */
  const inventate = ["12 mar", "24 mar", "22 mar", "2 punti di aggancio",
                     "12 punti", "Perizia in redazione", "verificato il 12 mar",
                     "/ 4 file", "2 da integrare"];
  const rimaste = inventate.filter((f) => {
    const i = h.indexOf(f);
    /* il commento che spiega perché sono state tolte può citarle */
    if (i === -1) return false;
    const riga = h.slice(h.lastIndexOf("\n", i) + 1, h.indexOf("\n", i));
    return !riga.trim().startsWith("<!--") && !riga.includes("c'erano") &&
           !riga.includes("prima") && !riga.includes("Prima");
  });
  assert.equal(rimaste.length, 0,
    `contenuto inventato rimasto in pagina: ${rimaste.join(", ")}`);
});

test("i segnaposto dei KPI non dichiarano numeri falsi", () => {
  const h = R("app.html");
  /* la fase 03 di 05 al 60% era l'esempio del disegno: se compare ancora in
     un attributo, il cliente la vede prima che l'aria risponda */
  assert.ok(!/aria-valuenow="60"/.test(h), "la barra dichiara 60% ancora prima dei dati");
  assert.ok(!/style="--p:\.6"/.test(h), "la barra è già riempita al 60% nell'HTML");
  assert.ok(!/data-phase-pct>60%/.test(h), "l'avanzamento parte da 60%");
  assert.match(h, /data-phase-index>—</, "la fase parte da un numero d'esempio invece che da un trattino");
});

test("timeline e cronologia sono contenitori vuoti, non elenchi di esempio", () => {
  const h = R("app.html");
  const track = h.slice(h.indexOf("data-phase-track"), h.indexOf("</ul>", h.indexOf("data-phase-track")));
  assert.ok(!/<li/.test(track.replace(/<!--[\s\S]*?-->/g, "")),
    "la timeline contiene ancora <li> scritti a mano: le fasi le disegna la storia vera");
  const feed = h.slice(h.indexOf('id="ops-table"'), h.indexOf("</ul>", h.indexOf('id="ops-table"')));
  assert.ok(!/<li/.test(feed.replace(/<!--[\s\S]*?-->/g, "")),
    "la cronologia contiene ancora voci scritte a mano");
});

test("i documenti finti sono spariti, resta la riga che spiega il vuoto", () => {
  const h = R("app.html");
  assert.ok(!/Estratto conto<\/b>\s*<span>PDF/.test(h),
    "c'è ancora un documento d'esempio che sembra del cliente");
  assert.ok(h.includes("data-docs-empty"), "manca la riga «nessun documento ancora»");
});

/* --------------------------------------------------------------- case.js -- */

function caseJs() {
  /* il file si carica come nel browser: si aggancia a `window` */
  const sorgente = R("assets/js/case.js");
  const finestra = {
    addEventListener: () => {},
    location: { href: "", replace: () => {} },
    requestAnimationFrame: (fn) => fn(),
    setTimeout: () => 0
  };
  const documento = {
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    body: { classList: { add: () => {}, remove: () => {} } }
  };
  /* `api` e `ui` sono il ponte verso il server e verso i testi: qui bastano
     come finti, perché il test guarda il codice, non fa chiamate. `token` è
     l'unica funzione che il file chiama appena parte. */
  const apiFinto = new Proxy({ token: () => "" }, {
    get: (o, k) => (k in o ? o[k] : () => Promise.resolve({}))
  });
  new Function("window", "document", "api", "ui", sorgente)(
    finestra, documento, apiFinto, {});
  return { finestra, sorgente };
}

test("la data si scrive sempre con l'anno", () => {
  const { sorgente } = caseJs();
  const i = sorgente.indexOf("function shortDate");
  const corpo = sorgente.slice(i, i + 400);
  assert.match(corpo, /year:\s*"numeric"/,
    "shortDate stampa ancora «12 mar» senza anno: non si può verificare");
});

test("un evento anteriore alla nascita della pratica non si mostra", () => {
  const { sorgente } = caseJs();
  assert.match(sorgente, /function primaDellaNascita/,
    "manca il filtro delle date anteriori alla registrazione");
  /* e il filtro deve essere usato per TUTTE le voci della cronologia */
  const usi = (sorgente.match(/primaDellaNascita\(/g) || []).length;
  assert.ok(usi >= 3, `il filtro è usato ${usi} volte: deve valere per la storia e per i documenti`);
});

test("le fasi si disegnano dalla storia, non da un numero fisso", () => {
  const { sorgente } = caseJs();
  assert.match(sorgente, /function paintStoria/, "manca paintStoria");
  assert.ok(!/paintPhases\(kase\.phase_index/.test(sorgente),
    "le fasi si dipingono ancora da un indice, senza guardare la storia");
  /* quando la storia non ha la data di una fase, non si inventa */
  assert.match(sorgente, /fatta \? "completata"/,
    "una fase fatta ma senza data deve dirlo, non prendere in prestito una data");
});

/* -------------------------------------------------------------- admin.js -- */

test("un clic cambia lo stato: solo le azioni irreversibili chiedono conferma", () => {
  const src = R("assets/js/admin.js");
  const i = src.indexOf("function richiestaStato");
  const corpo = src.slice(i, i + 1400);
  assert.match(corpo, /irreversibili/, "manca la distinzione fra azioni reversibili e no");
  /* «contattata» e «chiusa» non devono passare dal modale */
  const elenco = corpo.slice(corpo.indexOf("irreversibili = {"), corpo.indexOf("};", corpo.indexOf("irreversibili = {")));
  assert.ok(!/contacted/.test(elenco), "«contattata» chiede ancora conferma: dovrebbe essere un clic");
  assert.ok(!/closed:/.test(elenco), "«chiusa» chiede ancora conferma: dovrebbe essere un clic");
  assert.ok(/account:/.test(elenco) && /denied:/.test(elenco),
    "aprire una pratica e archiviare devono chiedere conferma: non si annullano");
});

test("la nota si scrive nella riga e viaggia con il cambio di stato", () => {
  const src = R("assets/js/admin.js");
  assert.match(src, /data-note-for=/, "manca il campo nota nella riga");
  assert.match(src, /salvaNota/, "manca il salvataggio della nota");
  /* la nota scritta viaggia con il bottone di stato */
  const i = src.indexOf("richiestaStato(bottone.getAttribute");
  assert.ok(src.slice(i - 400, i).includes("campoNota"),
    "il cambio di stato ignora la nota appena scritta nella riga");
});

test("la console non promette stati che non esistono", () => {
  const src = R("assets/js/admin.js");
  const i = src.indexOf("function etichettaStato");
  const corpo = src.slice(i, i + 300);
  for (const stato of ["new", "contacted", "account", "closed", "denied"]) {
    assert.ok(corpo.includes(stato + ":"), `manca l'etichetta di «${stato}»`);
  }
});

test("la colonna della nota ha un'intestazione o è muta", () => {
  const h = R("admin.html");
  const i = h.indexOf('id="lead-table"');
  const testa = h.slice(i, h.indexOf("</thead>", i));
  assert.match(testa, /Nota/, "la colonna della nota non è dichiarata: nessuno sa cosa sia");
});

module.exports = casi;
