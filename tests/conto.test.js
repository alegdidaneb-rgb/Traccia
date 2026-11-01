/* Tests for the account screen — run with: node tests/run.js
 *
 * Perché questi test: il conto mostra due numeri che sembrano lo stesso e non
 * lo sono. Se il display confonde «saldo» e «disponibile», il cliente preleva
 * due volte lo stesso denaro e scopre il problema solo quando la seconda
 * richiesta viene rifiutata. Il database lo impedisce; l'interfaccia non deve
 * incoraggiarlo.
 *
 * Qui si prova la logica di presentazione, non il database: quella parte è
 * verificata dalle funzioni SQL.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");

/* Estrae una funzione dal file senza eseguire il resto: case.js si aggancia
   al DOM all'avvio, e nei test il DOM non c'è. */
function funzione(nome) {
  const i = SRC.indexOf("function " + nome + "(");
  assert.ok(i > -1, "funzione " + nome + " non trovata");
  let p = SRC.indexOf("{", i), profondita = 0, j = p;
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") profondita++;
    else if (SRC[j] === "}") { profondita--; if (profondita === 0) break; }
  }
  const corpo = SRC.slice(i, j + 1);
  return new Function(corpo + "\nreturn " + nome + ";")();
}

const euro = funzione("euro");
const dataBreve = funzione("dataBreve");
const etichettaMovimento = funzione("etichettaMovimento");

/* --------------------------------------------------------------- test -- */

test("euro: importi in formato italiano, con i centesimi sempre", () => {
  assert.strictEqual(euro(0).replace(/\u00a0/g, " "), "0,00 €");
  assert.match(euro(1234.5), /1\.234,50/);
  assert.match(euro(0.5), /0,50/);
});

test("euro: i centesimi sotto dieci non perdono lo zero", () => {
  /* 0,05 € che diventa «0,5 €» è un errore da sportello */
  assert.match(euro(0.05), /0,05/);
  assert.match(euro(1000.07), /1\.000,07/);
});

test("euro: un importo negativo conserva il segno", () => {
  assert.match(euro(-42), /-42,00/);
});

test("data valuta: leggibile in italiano, non ISO", () => {
  assert.strictEqual(dataBreve("2026-11-01"), "1 nov 2026");
  assert.strictEqual(dataBreve("2026-01-31"), "31 gen 2026");
  assert.strictEqual(dataBreve(null), "—");
});

test("movimenti: ogni causale ha un'etichetta italiana", () => {
  ["deposit", "withdrawal", "buy", "sell", "transfer_out", "fee"].forEach((k) => {
    const etichetta = etichettaMovimento(k);
    assert.ok(etichetta && etichetta !== k, "causale senza etichetta: " + k);
  });
});

test("movimenti: una causale sconosciuta non sparisce dalla lista", () => {
  /* meglio una parola strana che una riga vuota su un estratto conto */
  assert.strictEqual(etichettaMovimento("addebito_diretto"), "addebito_diretto");
});

test("il conto non usa il saldo dove serve il disponibile", () => {
  /* il pulsante di prelievo legge `disponibile`, non `saldo` */
  const i = SRC.indexOf("function inviaMovimento");
  const corpo = SRC.slice(i, i + 1400);
  assert.match(corpo, /disponibile/);
  assert.doesNotMatch(corpo, /contoState\.dati\)\.saldo/,
    "il controllo dei fondi deve usare il disponibile");
});

test("la funzione del server rifiuta un prelievo senza IBAN", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0015_conto_corrente.sql"), "utf8");
  assert.match(sql, /p_type = 'withdrawal'[\s\S]{0,120}iban is null/,
    "senza IBAN il prelievo non deve partire");
});

test("il saldo si muove solo da registra_movimento", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0015_conto_corrente.sql"), "utf8");
  /* conto le istruzioni, non i commenti che le citano */
  const istruzioni = sql.split("\n")
    .filter((riga) => !riga.trim().startsWith("--"))
    .join("\n");
  const occorrenze = (istruzioni.match(/set balance_eur =/g) || []).length;
  assert.strictEqual(occorrenze, 1,
    "il saldo deve essere scritto in un punto solo, altrimenti i movimenti non tornano");
});

test("i movimenti non sono modificabili", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0015_conto_corrente.sql"), "utf8");
  assert.match(sql, /before update or delete on traccia\.ledger_entries/);
  assert.match(sql, /ledger_no_update/);
});

module.exports = casi;
