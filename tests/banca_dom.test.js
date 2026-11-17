/* Tests della schermata banca — `node tests/run.js`
 *
 * Perché un DOM finto invece di confrontare stringhe: `renderBanca` costruisce
 * righe con `innerHTML` e poi riempie i testi con `textContent`. Un errore di
 * questo tipo di codice non si vede leggendo il sorgente: si vede solo
 * guardando il nodo che ne esce. Qui si costruisce il DOM minimo che serve
 * (querySelector, createElement, appendChild) e si ispeziona il risultato.
 *
 * I casi che contano:
 *  - un bonifico «inviato» non deve mostrare «eseguito»: sono due momenti
 *    diversi e il cliente decide se il denaro è partito guardando quella parola;
 *  - con il tasso a zero la schermata deve dire «non previsti», non «0,00 €»
 *    (che sembra un errore di calcolo);
 *  - una carta bloccata deve restare visibile e leggibile, bloccata.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");

/* ------------------------------------------------------------- mini DOM -- */
/* Un nodo finto che ricorda figli e testo. `closest` serve ai listener, qui
   non ne abbiamo: bastano le proprietà che i render usano. */
function nodo(tag, attrs) {
  const n = {
    tagName: (tag || "div").toUpperCase(),
    attrs: attrs || {},
    figli: [],
    _testo: "",
    hidden: false,
    className: "",
    set innerHTML(v) { this._html = v; this.figli = []; },
    get innerHTML() { return this._html || ""; },
    set textContent(v) { this._testo = String(v); },
    get textContent() { return this._testo; },
    appendChild(c) { this.figli.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector(sel) { return this._perSel[sel] || null; },
    _perSel: {},
    addEventListener() {},
    focus() {},
    classList: { add() {}, remove() {}, toggle() {} }
  };
  return n;
}

function documentFinto(mappa) {
  return {
    querySelector(sel) { return mappa[sel] || null; },
    querySelectorAll() { return []; },
    createElement(tag) { return nodo(tag); },
    body: nodo("body"),
    addEventListener() {}
  };
}

/* carica il blocco di codice di case.js che contiene le funzioni di render */
function conDocumento(mappa, fn) {
  const avvio = SRC.indexOf("/* ------------------------------------------------ bonifici e canali -- */");
  const fine = SRC.indexOf("function bindConto()");
  assert.ok(avvio > -1 && fine > avvio, "blocco banca non trovato in case.js");
  const corpo = SRC.slice(avvio, fine);

  const ui = {
    esc: (v) => String(v === null || v === undefined ? "" : v),
    toast: function () {}
  };
  const euro = function (value) {
    var n = Number(value);
    if (isNaN(n)) n = 0;
    var negativo = n < 0;
    var assoluto = Math.abs(n);
    var intero = Math.floor(assoluto).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = Math.round((assoluto - Math.floor(assoluto)) * 100);
    if (cent === 100) { cent = 0; intero = (Math.floor(assoluto) + 1).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
    return (negativo ? "-" : "") + intero + "," + String(cent).padStart(2, "0") + " €";
  };
  const dataBreve = function (iso) {
    if (!iso) return "—";
    var mesi = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return String(iso);
    return Number(p[2]) + " " + mesi[Number(p[1]) - 1] + " " + p[0];
  };
  const contoState = { dati: { disponibile: 2219, saldo: 2219 } };
  const banca = {};
  const fabbrica = new Function(
    "document", "ui", "euro", "dataBreve", "contoState", "bancaState", "window",
    /* solo quello che esiste ancora: interessi e carta sono stati tolti con
       i loro riquadri, e un test che li importa prova codice che non c'è più */
    corpo + "\nreturn { renderBanca, STATO_BONIFICO };"
  );
  return fabbrica(
    documentFinto(mappa), ui, euro, dataBreve, contoState, banca, { ui: ui }
  );
}

/* `carte` e `interessi` il server li manda ancora, e il test li manda nel
   payload apposta: `renderBanca` deve ignorarli senza rompersi. Toglierli da
   qui nasconderebbe il caso vero — un dato che arriva e non ha più una
   schermata dove finire. */
const BASE = {
  bonifici: [], mandati: [], carte: [],
  interessi: { rate_pct: 0, maturato_eur: 0, giornaliero_eur: 0, prossimo_accredito: "2026-12-01" },
  purposes: [{ code: "GDDS", label: "Acquisto di beni" }]
};

/* ---------------------------------------------------------------- test -- */

test("bonifico inviato: la schermata dice «Inviato», non «Eseguito»", () => {
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-bonifici]": lista });
  mod.renderBanca(Object.assign({}, BASE, {
    bonifici: [{
      id: "b1", reference: "TRC-B-2026-000001", amount_eur: 250, direction: "out",
      scheme: "sepa_credit", beneficiary_name: "Mario Rossi",
      beneficiary_iban: "IT60 X054 2811 1010 0000 0123 456",
      status: "sent", requested_date: "2026-11-01"
    }]
  }));
  const riga = lista.figli[0];
  assert.ok(riga, "la riga del bonifico deve esserci");
  assert.match(riga.innerHTML, /Inviato alla banca/);
  assert.ok(!/Eseguito/.test(riga.innerHTML), "«Inviato» non deve contenere «Eseguito»");
});

test("bonifico respinto: mostra il codice della banca, non solo lo stato", () => {
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-bonifici]": lista });
  mod.renderBanca(Object.assign({}, BASE, {
    bonifici: [{
      id: "b2", reference: "TRC-B-2026-000005", amount_eur: 100, scheme: "sepa_instant",
      beneficiary_name: "Mario Rossi", beneficiary_iban: "IT60 ...",
      status: "rejected", bank_code: "AC04", bank_message: "Conto chiuso",
      requested_date: "2026-11-01"
    }]
  }));
  /* il codice è nel main, quindi nell'innerHTML del nodo */
  assert.match(lista.figli[0].innerHTML, /AC04/);
  assert.match(lista.figli[0].innerHTML, /Conto chiuso/);
});

test("bonifico in coda: si può annullare; inviato no", () => {
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-bonifici]": lista });
  const base = {
    id: "b3", reference: "TRC-B-2026-000002", amount_eur: 50, scheme: "sepa_credit",
    beneficiary_name: "X", beneficiary_iban: "IT00", requested_date: "2026-11-01"
  };
  mod.renderBanca(Object.assign({}, BASE, { bonifici: [Object.assign({}, base, { status: "queued" })] }));
  assert.match(lista.figli[0].innerHTML, /data-bonifico-annulla/);

  const lista2 = nodo("ul");
  const mod2 = conDocumento({ "[data-bonifici]": lista2 });
  mod2.renderBanca(Object.assign({}, BASE, { bonifici: [Object.assign({}, base, { status: "sent" })] }));
  assert.ok(!/data-bonifico-annulla/.test(lista2.figli[0].innerHTML),
    "un bonifico già inviato non si annulla dal sito: il pulsante non deve esserci");
});

test("mandato: gli addebiti incassati si possono contestare", () => {
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-mandati]": lista });
  mod.renderBanca(Object.assign({}, BASE, {
    mandati: [{
      id: "m1", reference: "TRC-M-2026-000002", creditor_name: "Energia Pulita SRL",
      umr: "TRC-M-2026-000002", scheme: "core", account_iban: "IT07 ...",
      status: "active", signed_on: "2026-11-01",
      debits: [{
        id: "d1", reference: "TRC-D-2026-000003", amount_eur: 85.4,
        status: "collected", due_date: "2026-11-04"
      }]
    }]
  }));
  const html = lista.figli[0].innerHTML;
  assert.match(html, /Incassato/);
  assert.match(html, /data-addebito-contesta/, "un addebito incassato deve poter essere contestato");
});

test("mandato revocato: niente pulsante di revoca", () => {
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-mandati]": lista });
  mod.renderBanca(Object.assign({}, BASE, {
    mandati: [{
      id: "m2", reference: "TRC-M-2026-000001", creditor_name: "Vecchio",
      umr: "X", scheme: "b2b", account_iban: "IT07", status: "revoked",
      signed_on: "2026-01-10", debits: []
    }]
  }));
  assert.ok(!/data-mandato-revoca/.test(lista.figli[0].innerHTML));
});

/* ------------------------------------------------------------------------
   Interessi e Carta: tolti, e questo test è perché restino tolti
   ------------------------------------------------------------------------
   I quattro test che stavano qui provavano i due riquadri: tasso a zero detto
   «non previsti», carta bloccata leggibile. Quei riquadri non esistono più —
   promettevano un tasso che nessuno applicava e una carta che non arrivava.
   Provare codice cancellato non serve; quello che serve è impedire che torni
   senza che nessuno se ne accorga, e che i dati che il server manda ancora per
   loro facciano danni.
   ------------------------------------------------------------------------ */

test("il riquadro «Interessi» non è più in pagina, e il codice non lo cerca", () => {
  const PAGINA = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  assert.ok(!/data-rail="interessi"/.test(PAGINA),
    "il riquadro «Interessi» è tornato in app.html");
  assert.ok(!/data-interessi-/.test(PAGINA),
    "app.html ha ancora nodi degli interessi: qualcuno li ha rimessi");
  /* e nel JS non devono restare le funzioni né i riferimenti: un render che
     cerca nodi che non esistono gira a vuoto a ogni caricamento del conto */
  assert.ok(!/function renderInteressi/.test(SRC), "renderInteressi è tornata in case.js");
  assert.ok(!/data-interessi-/.test(SRC), "case.js cerca ancora i nodi degli interessi");
});

test("il riquadro «Carta» non è più in pagina, e il codice non lo cerca", () => {
  const PAGINA = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  assert.ok(!/data-rail="carta"/.test(PAGINA), "il riquadro «Carta» è tornato in app.html");
  assert.ok(!/data-carta-/.test(PAGINA), "app.html ha ancora nodi della carta");
  assert.ok(!/function renderCarta/.test(SRC), "renderCarta è tornata in case.js");
  assert.ok(!/function richiediCarta/.test(SRC),
    "richiediCarta è tornata: un pulsante che promette una carta che non arriva");
  assert.ok(!/data-carta-/.test(SRC), "case.js cerca ancora i nodi della carta");
});

test("i dati di interessi e carta che arrivano lo stesso non rompono il conto", () => {
  /* Il server continua a mandare `interessi` e `carte` in `banca()`: sono dati,
     non schermate, e il giorno in cui servono di nuovo si riparte da qui. Ma
     `renderBanca` non deve inciampare in un dato senza casa. */
  const lista = nodo("ul");
  const mod = conDocumento({ "[data-bonifici]": lista }, null);
  assert.doesNotThrow(() => mod.renderBanca(Object.assign({}, BASE, {
    carte: [{ id: "c1", last4: "4242", status: "active", reference: "CRD-1" }],
    interessi: { rate_pct: 1.5, maturato_eur: 10.78, giornaliero_eur: 0.08 }
  })), "renderBanca si rompe se arrivano carte e interessi senza riquadri");
});

test("la console non ha più la tabella delle carte né il pulsante degli interessi", () => {
  /* Togliere «Carta» e «Interessi» dal lato cliente e lasciarli nella console
     sarebbe stato peggio che non toglierli: un analista avrebbe avuto una
     tabella per attivare carte che nessuno può chiedere, e una coda «carte da
     attivare» ferma a zero che sembra un dato. */
  const CONSOLE = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
  const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "assets/js/admin.js"), "utf8");

  assert.ok(!/id="carte-table"/.test(CONSOLE), "la tabella delle carte è tornata in admin.html");
  assert.ok(!/data-banca-interessi/.test(CONSOLE), "il pulsante «Matura interessi» è tornato");
  assert.ok(!/data-banca-kpi-cards/.test(CONSOLE), "la coda «Carte da attivare» è tornata");

  assert.ok(!/function renderCarte/.test(ADMIN_JS), "renderCarte è tornata in admin.js");
  assert.ok(!/function azioneCarta/.test(ADMIN_JS), "azioneCarta è tornata in admin.js");
  assert.ok(!/function maturaInteressi/.test(ADMIN_JS), "maturaInteressi è tornata in admin.js");
  assert.ok(!/data-banca-kpi-cards/.test(ADMIN_JS),
    "admin.js cerca ancora il riquadro delle carte: gira a vuoto a ogni aggiornamento");
});

test("il CSS della carta non è rimasto orfano nel foglio di stile", () => {
  /* Togliere il markup e lasciare `.card-visual` nel CSS non rompe niente e
     per questo non si vede — ma è la stessa cosa che lasciare il riquadro:
     un giorno qualcuno trova uno stile pronto e lo usa, e la carta torna
     senza che nessuno abbia deciso di riportarla. Selettori e regole se ne
     vanno insieme al markup. */
  const CSS = fs.readFileSync(path.join(__dirname, "..", "assets/css/premium.css"), "utf8");
  assert.ok(!/\.card-visual/.test(CSS), "le regole di `.card-visual` sono tornate in premium.css");
});

test("i client delle carte e degli interessi non sono più nel JS", () => {
  /* `api.richiediCarta`, `api.cartaAzione`, `api.maturaInteressi` & co. non
     avevano più chiamanti, ma restavano una strada per scrivere su `cards` e
     sugli interessi senza che nessuna schermata la mostrasse. Le funzioni del
     database restano: quello che si toglie è la porta dal browser. */
  const API = fs.readFileSync(path.join(__dirname, "..", "assets/js/api.js"), "utf8");
  ["richiediCarta", "bloccaCarta", "cartaAzione", "maturaInteressi", "accreditaInteressi"]
    .forEach((client) => {
      assert.ok(!new RegExp(client + ":\\s*function").test(API),
        "il client `" + client + "` è tornato in api.js: nessuna schermata lo chiama");
    });
});

test("il contatore «Banca» non conta più le carte", () => {
  /* Il numero era la somma di bonifici, addebiti e carte da attivare. Le carte
     non hanno più una tabella e nemmeno un pulsante: sommarle è un numero che
     sale per un lavoro che non esiste. */
  const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "assets/js/admin.js"), "utf8");
  const somma = ADMIN_JS.match(/conta\(document\.querySelector\("\[data-count-banca\]"\)[\s\S]{0,160}?\);/);
  assert.ok(somma, "il contatore «Banca» non si trova più: il test va riletto, non cancellato");
  assert.ok(!/carte_da_attivare/.test(somma[0]),
    "il contatore «Banca» somma ancora `carte_da_attivare`, che non ha più una coda");
});

test("admin.js non ha funzioni duplicate", () => {
  /* Trovato mentre toglievo il codice delle carte: la rimozione aveva
     **duplicato** `azioneAddebito`, definita due volte di seguito. `node
     --check` non lo vede — è sintassi legale, vince la seconda — e un test
     comportamentale nemmeno, perché le due copie fanno la stessa cosa. Un
     controllo sui nomi è l'unico che se ne accorge. */
  const nomi = [...SRC.matchAll(/^\s{2}function ([a-zA-Z_]+)\(/gm)].map((m) => m[1]);
  const visti = new Set();
  const doppi = nomi.filter((n) => (visti.has(n) ? true : (visti.add(n), false)));
  assert.deepStrictEqual(doppi, [], "funzioni definite due volte: " + doppi.join(", "));

  const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "assets/js/admin.js"), "utf8");
  const nomiAdmin = [...ADMIN_JS.matchAll(/^\s{2}function ([a-zA-Z_]+)\(/gm)].map((m) => m[1]);
  const vistiAdmin = new Set();
  const doppiAdmin = nomiAdmin.filter((n) => (vistiAdmin.has(n) ? true : (vistiAdmin.add(n), false)));
  assert.deepStrictEqual(doppiAdmin, [], "funzioni duplicate in admin.js: " + doppiAdmin.join(", "));
});

module.exports = casi;
