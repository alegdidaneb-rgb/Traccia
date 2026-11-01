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
    corpo + "\nreturn { renderBanca, renderInteressi, renderCarta, STATO_BONIFICO, STATO_CARTA };"
  );
  return fabbrica(
    documentFinto(mappa), ui, euro, dataBreve, contoState, banca, { ui: ui }
  );
}

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

test("interessi a zero: «non previsti», non una cifra che sembra sbagliata", () => {
  const mappa = {
    "[data-interessi-tasso]": nodo("span"),
    "[data-interessi-tasso-testo]": nodo("b"),
    "[data-interessi-giorno]": nodo("b"),
    "[data-interessi-maturato]": nodo("b"),
    "[data-interessi-prossimo]": nodo("b"),
    "[data-interessi-nota]": nodo("p")
  };
  const mod = conDocumento(mappa);
  mod.renderInteressi({ rate_pct: 0, maturato_eur: 0, giornaliero_eur: 0, prossimo_accredito: "2026-12-01" });
  assert.strictEqual(mappa["[data-interessi-tasso]"].textContent, "non previsti");
  assert.match(mappa["[data-interessi-nota]"].textContent, /tasso creditore è a zero/);
});

test("interessi sopra zero: tasso e giornaliero, con la virgola italiana", () => {
  const mappa = {
    "[data-interessi-tasso]": nodo("span"),
    "[data-interessi-tasso-testo]": nodo("b"),
    "[data-interessi-giorno]": nodo("b"),
    "[data-interessi-maturato]": nodo("b"),
    "[data-interessi-prossimo]": nodo("b"),
    "[data-interessi-nota]": nodo("p")
  };
  const mod = conDocumento(mappa);
  mod.renderInteressi({ rate_pct: 1.5, maturato_eur: 0.1, giornaliero_eur: 0.09, prossimo_accredito: "2026-12-01" });
  assert.strictEqual(mappa["[data-interessi-tasso]"].textContent, "1,5 % annuo");
  assert.match(mappa["[data-interessi-giorno]"].textContent, /0,09/);
});

test("carta bloccata: resta visibile, con la pillola giusta e senza il pulsante di blocco", () => {
  const box = nodo("div");
  box.querySelector = function (sel) {
    this._perSel[sel] = this._perSel[sel] || nodo("span");
    return this._perSel[sel];
  };
  const vuota = nodo("p");
  const azioni = nodo("div");
  const richiedi = nodo("button");
  const mappa = {
    "[data-carta]": box,
    "[data-carta-vuota]": vuota,
    "[data-carta-azioni]": azioni,
    "[data-carta-richiedi]": richiedi,
    "[data-carta-blocca]": nodo("button"),
    "[data-carta-sblocca]": nodo("button")
  };
  const mod = conDocumento(mappa);
  mod.renderCarta({ id: "c1", reference: "TRC-C-2026-000004", last4: "1058",
    status: "blocked", expires_on: "2029-11-01", monthly_cap_eur: 400 });
  assert.strictEqual(box.hidden, false, "una carta bloccata si vede, non sparisce");
  assert.strictEqual(box.getAttribute("data-card-status"), "blocked");
  assert.strictEqual(mappa["[data-carta-blocca]"].hidden, true);
  assert.strictEqual(mappa["[data-carta-sblocca]"].hidden, false);
});

test("nessuna carta: il riquadro lo dice e propone di richiederla", () => {
  const box = nodo("div");
  const vuota = nodo("p");
  const mappa = {
    "[data-carta]": box,
    "[data-carta-vuota]": vuota,
    "[data-carta-azioni]": nodo("div"),
    "[data-carta-richiedi]": nodo("button")
  };
  const mod = conDocumento(mappa);
  mod.renderCarta(undefined);
  assert.strictEqual(box.hidden, true);
  assert.strictEqual(vuota.hidden, false);
  assert.strictEqual(mappa["[data-carta-richiedi]"].hidden, false);
});

module.exports = casi;
