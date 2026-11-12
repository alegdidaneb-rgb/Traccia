/* Tests della tabella segnalazioni — `node tests/run.js`
 *
 * Il difetto da cui nascono questi test è il contrario di un errore di
 * programmazione: era un flusso di lavoro sbagliato. Per segnare una
 * segnalazione «contattata» bisognava aprire un modale, leggerlo e confermare
 * — tre passaggi per un'informazione che si sa già. Chi lavora quaranta
 * segnalazioni al giorno smette di aggiornarle, e la tabella mente.
 *
 * Qui si prova il giro completo su un DOM finto: un clic cambia lo stato, il
 * modale compare solo per le due azioni che non si annullano, e la nota scritta
 * nella riga viaggia con il cambio di stato.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/admin.js"), "utf8");

/* ------------------------------------------------------------ mini DOM -- */
/* Serve poco: gli elementi della tabella si costruiscono con `innerHTML` e poi
   si cercano con `querySelector`. Un parser di tag basta per ispezionarli. */
const RE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function nodo(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(),
    attrs: {},
    figli: [],
    padre: null,
    value: "",
    defaultValue: "",
    _testo: "",
    _html: "",
    dataset: {},
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    set innerHTML(v) { n._html = v; n.figli = parse(v, n); },
    get innerHTML() { return n._html; },
    set textContent(v) { n._testo = String(v); },
    get textContent() { return n._testo || n.figli.map(parla).join(""); },
    appendChild(c) { c.padre = n; n.figli.push(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "value") n.value = String(v); },
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    hasAttribute(k) { return k in n.attrs; },
    querySelector(sel) { return n.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      (function scendi(x) {
        x.figli.forEach((f) => {
          if (combacia(f, sel)) out.push(f);
          scendi(f);
        });
      })(n);
      return out;
    },
    closest(sel) {
      let x = n;
      while (x) { if (combacia(x, sel)) return x; x = x.padre; }
      return null;
    },
    addEventListener() {},
    focus() {},
    blur() {}
  };
  n.parentElement = null;
  return n;
}

function parla(x) { return x._testo || x.figli.map(parla).join(""); }

function semplice(node, sel) {
  if (!node || !sel) return false;
  if (sel[0] === "[") {
    const dentro = sel.slice(1, -1);
    if (dentro.indexOf("=") > -1) {
      const [k, v] = dentro.split("=");
      return node.getAttribute(k) === v.replace(/^["']|["']$/g, "");
    }
    return node.hasAttribute(dentro);
  }
  if (sel[0] === ".") return String(node.className || "").split(/\s+/).includes(sel.slice(1));
  return node.tagName === sel.toUpperCase();
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

function parse(html, padre) {
  const figli = [];
  const pila = [{ nodo: padre, figli }];
  let ultimo = 0;
  let m;
  RE_TAG.lastIndex = 0;
  const corrente = () => pila[pila.length - 1];
  const aggiungi = (x) => {
    x.padre = corrente().nodo;
    if (corrente().nodo) corrente().nodo.figli.push(x);
    corrente().figli.push(x);
  };
  while ((m = RE_TAG.exec(html))) {
    const testo = html.slice(ultimo, m.index);
    if (testo.trim()) {
      const t = nodo("span");
      t._testo = testo;
      aggiungi(t);
    }
    ultimo = RE_TAG.lastIndex;
    const [, chiusura, tag, attributi, autoChiuso] = m;
    if (chiusura) { if (pila.length > 1) pila.pop(); continue; }
    const el = nodo(tag);
    const RE_ATTR = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = RE_ATTR.exec(attributi || ""))) {
      if (a[1] === "class") el.className = a[2];
      else el.setAttribute(a[1], a[2]);
    }
    aggiungi(el);
    if (!autoChiuso) pila.push({ nodo: el, figli: el.figli });
  }
  return figli;
}

/* ------------------------------------------------- prendere le funzioni -- */
/* Si ritaglia il blocco che serve invece di eseguire `admin.js`: il file,
   appena parte, apre una sessione e disegna tutta la console. */
function blocco() {
  const da = (a, b) => {
    const i = SRC.indexOf(a);
    const j = SRC.indexOf(b, i);
    assert.ok(i > -1 && j > i, "blocco non trovato in admin.js: " + a.slice(0, 40));
    return SRC.slice(i, j);
  };
  return [
    da("function richiestaStato(id, stato, nota) {", "function refresh() {"),
    da("function attesaOre(r) {", "function loadRichieste() {")
  ].join("\n");
}

function conTabella() {
  const chiamate = [];
  const modali = [];
  const toast = [];
  const ricariche = [];
  const state = { richieste: [] };
  const api = {
    richiestaImposta(id, stato, nota) {
      chiamate.push({ id, stato, nota });
      /* il database risponde, e la riga si ridisegna con il nuovo stato */
      const r = state.richieste.filter((x) => x.id === id)[0];
      if (r && stato) r.status = stato;
      if (r && nota !== null && nota !== undefined) r.note = nota;
      return Promise.resolve({});
    },
    richieste() { return Promise.resolve({ richieste: state.richieste, new_count: 0 }); }
  };
  const ui = {
    esc: (v) => String(v === null || v === undefined ? "" : v),
    money: (v) => String(v) + " €",
    pill: (testo) => '<span class="pill">' + testo + "</span>",
    when: (epoch) => "il " + new Date(Number(epoch) * 1000).toISOString().slice(0, 10),
    toast: (t, tipo) => toast.push({ t, tipo }),
    /* il modale: risponde quello che decide il test, e registra che è stato
       chiesto — è la prova che per le azioni reversibili non compare */
    ask(opzioni) {
      modali.push(opzioni);
      return Promise.resolve(mod.laRisposta === undefined ? null : mod.laRisposta);
    }
  };
  const fabbrica = new Function(
    "api", "ui", "state", "L", "refresh", "loadRichieste", "etichettaSituazione", "etichettaOrigine",
    blocco() +
      "\nreturn { renderRichieste: renderRichieste, richiestaStato: richiestaStato," +
      " salvaNota: salvaNota, azioniRichiesta: azioniRichiesta, etichettaStato: etichettaStato };"
  );
  const L = { richiesteBody: nodo("tbody") };
  const mod = fabbrica(
    api, ui, state, L,
    function () { ricariche.push(1); return Promise.resolve(); },
    function () { return Promise.resolve(); },
    function (s) { return s || "—"; },
    function (o) { return o || "—"; }
  );
  mod.chiamate = chiamate;
  mod.modali = modali;
  mod.toast = toast;
  mod.ricariche = ricariche;
  mod.state = state;
  mod.L = L;
  return mod;
}

function segnalazione(extra) {
  return Object.assign({
    id: "r1", name: "Anna Gruber", phone: "+43 660 1234567", email: "",
    amount_eur: 37250, status: "new", created_at: 1794395066, note: ""
  }, extra || {});
}

/* ---------------------------------------------------------------- test -- */

test("«contattata» si applica al clic: nessun modale, una chiamata, un avviso", async () => {
  const mod = conTabella();
  mod.state.richieste = [segnalazione()];
  await mod.richiestaStato("r1", "contacted", "");
  assert.strictEqual(mod.modali.length, 0, "una segnalazione contattata non deve chiedere conferma");
  assert.deepStrictEqual(mod.chiamate, [{ id: "r1", stato: "contacted", nota: "" }]);
  assert.match(mod.toast[0].t, /contattata/);
  assert.strictEqual(mod.ricariche.length, 1, "dopo il cambio la tabella si rilegge");
});

test("«chiusa» si applica al clic", async () => {
  const mod = conTabella();
  await mod.richiestaStato("r1", "closed", null);
  assert.strictEqual(mod.modali.length, 0);
  assert.strictEqual(mod.chiamate.length, 1);
});

test("«apri la pratica» e «archivia» chiedono conferma, e annullare non tocca niente", async () => {
  for (const stato of ["account", "denied"]) {
    const mod = conTabella();
    mod.laRisposta = null; /* il modale si chiude con «Annulla» */
    await mod.richiestaStato("r1", stato, "nota di partenza");
    assert.strictEqual(mod.modali.length, 1, stato + ": deve chiedere conferma");
    assert.strictEqual(mod.chiamate.length, 0, stato + ": annullare non deve scrivere");
    assert.strictEqual(mod.modali[0].danger, stato === "denied",
      "solo l'archiviazione è una cosa da fare col rosso");
    assert.match(mod.modali[0].confirm, /Apri la pratica|Archivia/);
  }
});

test("confermando, la nota scritta nel modale arriva al database", async () => {
  const mod = conTabella();
  mod.laRisposta = "Ha già firmato il mandato";
  await mod.richiestaStato("r1", "account", "");
  assert.strictEqual(mod.chiamate.length, 1);
  assert.strictEqual(mod.chiamate[0].nota, "Ha già firmato il mandato");
});

test("le azioni sono al massimo tre, nell'ordine in cui si lavorano", () => {
  const mod = conTabella();
  const html = mod.azioniRichiesta(segnalazione());
  const bottoni = (html.match(/data-richiesta=/g) || []).length;
  assert.ok(bottoni <= 3, "una riga con sei bottoni non si legge: ne sono " + bottoni);
  /* una segnalazione appena arrivata offre due passi: contattarla o dire che
     non è nostra. «Apri pratica» arriva dopo, quando si è parlato con lei —
     non prima di sapere se ha davvero qualcosa da recuperare. */
  const stati = [...html.matchAll(/data-stato="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(stati, ["contacted", "denied"],
    "per una segnalazione nuova: prima contattarla, poi archiviarla");
  /* il telefono è la cosa che si fa per prima: deve essere un link, non un
     bottone che poi mostra il numero */
  assert.match(html, /href="tel:/);
});

test("una segnalazione archiviata non offre più «archivia»", () => {
  const mod = conTabella();
  const html = mod.azioniRichiesta(segnalazione({ status: "denied" }));
  assert.ok(!/data-stato="denied"/.test(html), "non si archivia due volte");
});

test("la nota si salva con lo stato attuale della riga, non con uno inventato", async () => {
  const mod = conTabella();
  mod.state.richieste = [segnalazione({ status: "contacted" })];
  await mod.salvaNota("r1", "richiamare lunedì", null, "");
  assert.strictEqual(mod.chiamate[0].stato, "contacted", "salvare la nota non deve cambiare lo stato");
  assert.strictEqual(mod.chiamate[0].nota, "richiamare lunedì");
  assert.match(mod.toast[0].t, /Nota salvata/);
});

test("la tabella mostra la nota nella riga, con un campo modificabile", () => {
  const mod = conTabella();
  mod.state.richieste = [segnalazione({ note: "chiamata persa" })];
  mod.renderRichieste();
  const campo = mod.L.richiesteBody.querySelector("[data-note-for]");
  assert.ok(campo, "la nota deve stare nella riga");
  assert.strictEqual(campo.getAttribute("data-note-for"), "r1");
  assert.strictEqual(campo.value, "chiamata persa");
  assert.ok(/placeholder="Scrivi una nota/.test(mod.L.richiesteBody.innerHTML));
});

test("ogni stato che il database conosce ha una parola italiana", () => {
  const mod = conTabella();
  const attesi = {
    new: /chiamare/i, contacted: /contattata/i, account: /pratica/i,
    closed: /chiusa/i, denied: /archiviata/i
  };
  Object.keys(attesi).forEach((stato) => {
    assert.match(mod.etichettaStato(stato), attesi[stato], "manca la parola per «" + stato + "»");
  });
});

module.exports = casi;
