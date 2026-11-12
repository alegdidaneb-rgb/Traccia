/* Tests della storia della pratica — `node tests/run.js`
 *
 * Perché un DOM finto e non un confronto di stringhe: `paintStoria` costruisce
 * gli elementi con `innerHTML` e poi riempie i testi con `textContent`. La
 * differenza tra «la fase è fatta» e «la fase è fatta e si sa quando» non si
 * vede nel sorgente: si vede solo nel nodo che esce.
 *
 * Il difetto da cui nascono questi test: la pagina del cliente mostrava «12 mar»
 * e «24 mar» su una pratica aperta a novembre. Non era un errore di formato, era
 * `app.html` che scriveva a mano una cronologia di esempio. Togliere quel testo
 * senza togliere il meccanismo non basta: serve che il disegno rifiuti le date
 * impossibili. Qui si prova che rifiuta.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");

/* ------------------------------------------------------------- mini DOM -- */
/* Un nodo finto con un parser minimo di `innerHTML`: il codice vero assegna
   l'HTML e poi cerca i figli con `querySelector`, quindi senza alberatura il
   test non proverebbe niente. Il parser copre i tag che questa pagina usa. */
const RE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function nodo(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(),
    attrs: {},
    figli: [],
    padre: null,
    _testo: "",
    _html: "",
    style: { setProperty() {} },
    classList: {
      add(c) { const s = new Set(String(n.className || "").split(/\s+/).filter(Boolean)); s.add(c); n.className = [...s].join(" "); },
      remove(c) { n.className = String(n.className || "").split(/\s+/).filter((x) => x && x !== c).join(" "); },
      contains(c) { return String(n.className || "").split(/\s+/).includes(c); }
    },
    get className() { return n._classe || ""; },
    set className(v) { n._classe = v; },
    set innerHTML(v) { n._html = v; n.figli = parse(v, n); },
    get innerHTML() { return n._html; },
    set textContent(v) { n._testo = String(v); n.figli = []; },
    get textContent() { return n._testo || n.figli.map(parla).join(""); },
    appendChild(c) { c.padre = n; n.figli.push(c); return c; },
    removeChild(c) { n.figli = n.figli.filter((x) => x !== c); c.padre = null; return c; },
    remove() { if (n.padre) n.padre.removeChild(n); },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    hasAttribute(k) { return k in n.attrs; },
    querySelector(sel) { const trovati = n.querySelectorAll(sel); return trovati[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      (function scendi(x) { x.figli.forEach((f) => { if (combacia(f, sel)) out.push(f); scendi(f); }); })(n);
      return out;
    },
    cloneNode() {
      const c = nodo(n.tagName);
      c.className = n.className;
      c.attrs = Object.assign({}, n.attrs);
      c._testo = n._testo;
      c.innerHTML = n._html;
      return c;
    },
    addEventListener() {},
    focus() {}
  };
  return n;
}

function parla(x) {
  if (x._testo) return x._testo;
  return x.figli.map(parla).join("");
}

function combacia(node, sel) {
  const parti = String(sel).trim().split(/\s+/);
  if (!semplice(node, parti[parti.length - 1])) return false;
  let i = parti.length - 2;
  let sopra = node.padre;
  while (i >= 0 && sopra) {
    if (semplice(sopra, parti[i])) i -= 1;
    sopra = sopra.padre;
  }
  return i < 0;
}

function semplice(node, sel) {
  if (!node || !sel) return false;
  if (sel[0] === "[") {
    const nome = sel.slice(1, -1);
    return node.hasAttribute(nome);
  }
  if (sel[0] === ".") return node.classList.contains(sel.slice(1));
  return node.tagName === sel.toUpperCase();
}

function parse(html, padre) {
  const figli = [];
  let ultimo = 0;
  const pila = [{ nodo: padre, figli }];
  let m;
  RE_TAG.lastIndex = 0;
  const corrente = () => pila[pila.length - 1];
  const aggiungi = (x) => { x.padre = corrente().nodo; if (corrente().nodo) corrente().nodo.figli.push(x); corrente().figli.push(x); };
  while ((m = RE_TAG.exec(html))) {
    const testo = html.slice(ultimo, m.index);
    if (testo.trim()) {
      const t = nodo("span");
      t._testo = testo;
      t.className = "testo";
      aggiungi(t);
    }
    ultimo = RE_TAG.lastIndex;
    const [, chiusura, tag, attributi, autoChiuso] = m;
    if (chiusura) {
      if (pila.length > 1) pila.pop();
      continue;
    }
    const el = nodo(tag);
    const RE_ATTR = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = RE_ATTR.exec(attributi || ""))) {
      if (a[1] === "class") el.className = a[2];
      else el.setAttribute(a[1], a[2]);
    }
    aggiungi(el);
    if (!autoChiuso && !["svg", "path", "circle"].includes(tag.toLowerCase())) {
      pila.push({ nodo: el, figli: el.figli });
    }
  }
  return figli;
}

/* ---------------------------------------------------- caricare le funzioni -- */
/* Si ritagliano i blocchi che servono, invece di eseguire tutto `case.js`:
   il file, appena parte, chiama il server (`api.token`) e tocca la pagina
   intera. Qui serve il disegno, non l'avvio. */
function blocchi() {
  const da = (a, b) => {
    const i = SRC.indexOf(a);
    const j = SRC.indexOf(b, i);
    assert.ok(i > -1 && j > i, "blocco non trovato in case.js: " + a.slice(0, 40));
    return SRC.slice(i, j);
  };
  return [
    da("function shortDate(epoch) {", "/* ------------------------------------------------- sola lettura analista -- */"),
    da("/* ------------------------------------------------- la pratica, dal vero -- */", "function animateProgress(value) {"),
    da("function statoDocumento(doc) {", "/* Il documento non ha un indirizzo pubblico"),
    da("function renderDashboard(data) {", "function renderFees(fees) {"),
    /* il conto: serve a provare cosa dice la pagina quando il saldo non ha
       movimenti dietro */
    da("var contoState = { dati: null, movimenti: [] };", "function rigaMovimento(m) {")
  ].join("\n");
}

function conPagina(mappa, idMappa) {
  const documento = {
    querySelector(sel) { return mappa[sel] || null; },
    querySelectorAll() { return []; },
    getElementById(id) { return (idMappa || {})[id] || null; },
    createElement(tag) { return nodo(tag); },
    body: nodo("body"),
    addEventListener() {}
  };
  const testi = {};
  const fabbrica = new Function(
    "document", "window", "set", "euro", "initials", "animateProgress", "renderFees",
    blocchi() + "\nreturn { renderDashboard: renderDashboard, renderDocuments: renderDocuments," +
      " paintStoria: paintStoria, FASI: FASI, renderConto: renderConto };"
  );
  return fabbrica(
    documento,
    { requestAnimationFrame: (fn) => fn(), setTimeout: () => 0, location: { search: "" } },
    function (id, valore) { testi[id] = String(valore); },
    function (n) {
      var intero = Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return intero + " €";
    },
    function (n) { return String(n).slice(0, 2).toUpperCase(); },
    function () {},
    function () {}
  );
}

const NASCITA = "2026-11-05T15:47:00+00:00";

function pagina() {
  const mappa = {
    "[data-phase-track]": nodo("ul"),
    "[data-progress]": nodo("div")
  };
  const ids = { "ops-table": nodo("ul"), "docs-table": nodo("ul") };
  return { mappa, ids, mod: conPagina(mappa, ids) };
}

function kase(extra) {
  return Object.assign({
    ref: "T-2586-2026",
    phase_index: 1,
    phase_name: "Raccolta",
    percent: 0,
    amount_eur: 0,
    aperta_il: NASCITA,
    storia: [{ phase: 0, phase_name: "Pratica aperta", quando: NASCITA, chi: "Sara Conti" }]
  }, extra || {});
}

function dashboard(mod, k, docs) {
  mod.renderDashboard({
    user: { name: "Maria Teresa Lonardi", email: "m@example.it" },
    case: k,
    documents: docs || [],
    documents_count: (docs || []).length,
    fees: {}
  });
}

/* ---------------------------------------------------------------- test -- */

test("una fase fatta ma senza data dice «completata», non prende una data in prestito", () => {
  const p = pagina();
  /* Fase 3 raggiunta, ma nella storia c'è solo l'evento di nascita: le fasi 1
     e 2 sono passate e non si sa quando. È il caso delle pratiche aperte prima
     che la storia esistesse — l'unica risposta onesta è non datarle. */
  dashboard(p.mod, kase({ phase_index: 3, phase_name: "Perizia" }));
  const voci = p.mappa["[data-phase-track]"].figli;
  assert.strictEqual(voci.length, 5, "servono cinque fasi");
  const quando = voci.map((li) => li.querySelector(".tl__when").textContent);
  /* le prime due sono passate (la pratica è alla terza), la terza è quella
     in corso, le ultime due non sono ancora cominciate */
  assert.deepStrictEqual(quando, ["completata", "completata", "in corso", "—", "—"]);
  voci.slice(0, 3).forEach((li) => {
    assert.ok(!/2026|nov|mar/.test(li.querySelector(".tl__when").textContent),
      "nessuna fase senza data deve mostrare una data");
  });
});

test("la data della fase è quella dell'evento, non quella di oggi", () => {
  const p = pagina();
  dashboard(p.mod, kase({
    phase_index: 2,
    storia: [
      { phase: 0, quando: NASCITA },
      { phase: 1, quando: "2026-11-07T09:30:00+00:00", chi: "Sara Conti" }
    ]
  }));
  const testo = p.mappa["[data-phase-track]"].figli[0].querySelector(".tl__when").textContent;
  assert.match(testo, /07 nov 2026/);
});

test("un evento anteriore alla nascita della pratica non compare", () => {
  const p = pagina();
  dashboard(p.mod, kase({
    storia: [
      { phase: 0, quando: NASCITA },
      /* dato sbagliato, di quelli che il trigger del database ora rifiuta:
         se per qualche via arrivasse, la pagina non deve mostrarlo */
      { phase: 1, phase_name: "Ricostruzione", quando: "2026-03-12T10:00:00+00:00", note: "Fase di marzo" }
    ]
  }), [
    { id: "d1", label: "Estratto conto", status: "received", has_file: true, created_at: 1773316800 }
  ]);
  const feed = p.ids["ops-table"].textContent;
  assert.ok(!/Fase di marzo/.test(feed), "l'evento di marzo non deve comparire");
  assert.ok(!/Estratto conto/.test(feed), "il documento di marzo non deve comparire");
  assert.match(feed, /Pratica aperta/);
});

test("la cronologia unisce storia e documenti, dal più recente", () => {
  const p = pagina();
  dashboard(p.mod, kase({
    historia: undefined,
    storia: [
      { phase: 0, quando: NASCITA, chi: "Sara Conti" },
      { phase: 1, phase_name: "Raccolta", quando: "2026-11-08T08:00:00+00:00", chi: "Sara Conti" }
    ]
  }), [
    { id: "d1", label: "Ricevuta bonifico", status: "pending", has_file: true, created_at: 1794140000 }
  ]);
  const voci = p.ids["ops-table"].figli;
  assert.strictEqual(voci.length, 3, "due eventi e un documento");
  assert.match(voci[0].textContent, /Ricevuta bonifico/, "il più recente sta in cima");
  assert.ok(voci[0].classList.contains("feed__item--new"), "la prima voce è quella nuova");
  assert.ok(!voci[1].classList.contains("feed__item--new"));
  assert.match(voci[0].querySelector(".feed__when").textContent, /2026/,
    "la data della cronologia porta l'anno");
});

test("senza storia la cronologia dice che non c'è ancora niente, con una frase vera", () => {
  const p = pagina();
  dashboard(p.mod, kase({ storia: [] }), []);
  const feed = p.ids["ops-table"].textContent;
  assert.match(feed, /Ancora nessun aggiornamento/);
  assert.ok(!/12 mar|24 mar/.test(feed), "nessuna data d'esempio");
});

test("la riga del vuoto resta anche quando i documenti finiscono", () => {
  const p = pagina();
  const vault = p.ids["docs-table"];
  /* la riga che l'HTML prepara per una pratica senza documenti */
  vault.innerHTML =
    '<li class="vault__item vault__item--missing" data-docs-empty>' +
    "<div class=\"vault__main\"><b>Nessun documento ancora</b></div></li>";

  p.mod.renderDocuments([]);
  assert.strictEqual(vault.figli.length, 1);
  assert.ok(vault.figli[0].hasAttribute("data-docs-empty"));
  assert.match(vault.figli[0].textContent, /Nessun documento ancora/);

  p.mod.renderDocuments([{ id: "d1", label: "Estratto conto", status: "received", has_file: true, created_at: 1794140000 }]);
  assert.strictEqual(vault.figli.length, 1);
  assert.ok(!vault.figli[0].hasAttribute("data-docs-empty"), "col documento la riga vuota sparisce");

  /* e se il cliente toglie l'unico documento, il vuoto deve tornare: prima
     restava un riquadro bianco perché la riga d'origine era già stata staccata */
  p.mod.renderDocuments([]);
  assert.strictEqual(vault.figli.length, 1);
  assert.ok(vault.figli[0].hasAttribute("data-docs-empty"), "il vuoto torna anche la seconda volta");
});

test("un documento da ricaricare ha il colore delle cose da fare, e «Togli» c'è", () => {
  const p = pagina();
  p.mod.renderDocuments([
    { id: "d9", label: "Screenshot illeggibile", status: "rejected", has_file: true, created_at: 1794140000, decision_note: "È sfocato: rifallo." }
  ]);
  const riga = p.ids["docs-table"].figli[0];
  assert.match(riga.innerHTML, /pill--denied/);
  assert.ok(!/pill--rejected/.test(riga.innerHTML), "pill--rejected non esiste nel foglio di stile");
  assert.match(riga.textContent, /È sfocato/);
  assert.match(riga.innerHTML, /data-remove-doc="d9"/);
});

test("un documento acquisito non si toglie: l'ha già preso l'analista", () => {
  const p = pagina();
  p.mod.renderDocuments([
    { id: "d4", label: "Estratto conto", status: "received", has_file: true, created_at: 1794140000 }
  ]);
  assert.ok(!/data-remove-doc/.test(p.ids["docs-table"].figli[0].innerHTML));
});

test("un saldo senza movimenti lo dice: non è un conto vuoto, è un numero da spiegare", () => {
  const lista = nodo("ul");
  const mod = conPagina({ "[data-movimenti]": lista });
  mod.renderConto({ disponibile: 1670049, saldo: 1670049, prenotato: 0, movimenti: [] });
  const testo = lista.textContent;
  assert.match(testo, /1\.670\.049|1670049/, "il saldo deve restare leggibile");
  assert.match(testo, /non risulta da movimenti|analista/,
    "senza movimenti il saldo va spiegato, non lasciato lì da solo");
});

test("un conto davvero vuoto resta semplice", () => {
  const lista = nodo("ul");
  const mod = conPagina({ "[data-movimenti]": lista });
  mod.renderConto({ disponibile: 0, saldo: 0, prenotato: 0, movimenti: [] });
  assert.match(lista.textContent, /Nessun movimento sul conto\./);
  assert.ok(!/analista/.test(lista.textContent), "a saldo zero non c'è niente da spiegare");
});

module.exports = casi;
if (require.main === module) {
  let passati = 0;
  casi.forEach((c) => {
    try { c.fn(); passati += 1; console.log("  ✓ " + c.nome); }
    catch (e) { console.log("  ✗ " + c.nome + "\n      " + e.message); }
  });
  console.log("\n" + passati + " passati, " + (casi.length - passati) + " falliti\n");
  process.exit(passati === casi.length ? 0 : 1);
}
