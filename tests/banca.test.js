/* Tests for the payment rails — run with: node tests/run.js
 *
 * Cosa si prova qui, e perché:
 *
 * 1. **La formattazione dell'IBAN.** Il 0015 ha prodotto `\1 \1 \1` al posto
 *    di un IBAN per un backreference perso in un riscrivimento. Un IBAN
 *    sbagliato è un bonifico sbagliato, quindi adesso c'è una funzione SQL
 *    senza regex (`traccia.iban_format`) e questa equivalenza JS che dice cosa
 *    deve uscire.
 *
 * 2. **La verifica del codice IBAN (mod 97).** Prima di mandare denaro, un IBAN
 *    con una cifra sbagliata va fermato: costa un bonifico respinto e due
 *    giorni. Il controllo è nel client ed è lo stesso della norma ISO 13616.
 *
 * 3. **Le etichette di stato.** «Inviato» e «eseguito» non sono sinonimi: solo
 *    il secondo vuol dire che il denaro è uscito. Se l'interfaccia li confonde,
 *    il cliente crede di aver pagato quando la banca non ha ancora eseguito.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");

function funzione(nome) {
  const i = SRC.indexOf("function " + nome + "(");
  assert.ok(i > -1, "funzione " + nome + " non trovata");
  let p = SRC.indexOf("{", i), profondita = 0, j = p;
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") profondita++;
    else if (SRC[j] === "}") { profondita--; if (profondita === 0) break; }
  }
  return new Function("ui", "return (" + SRC.slice(i, j + 1) + ")")(
    { esc: (v) => String(v === null || v === undefined ? "" : v) }
  );
}

const pillStato = funzione("pillStato");

/* ---------------------------------------------------------------- iban -- */
/* La stessa normalizzazione del database: solo lettere e cifre, maiuscolo. */
function normalizza(iban) {
  return String(iban || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* La funzione vera, estratta dal client: se il test riscrive l'algoritmo per
   conto suo, prova il test e non il codice. `valido` qui è un alias. */
const valido = funzione("ibanValido");

test("IBAN: un IBAN italiano vero passa il controllo mod 97", () => {
  assert.strictEqual(valido("IT60 X054 2811 1010 0000 0123 456"), true);
  assert.strictEqual(valido("IT07A0200836812330244210453"), true);
});

test("IBAN: una cifra sbagliata viene fermata prima del bonifico", () => {
  assert.strictEqual(valido("IT60 X054 2811 1010 0000 0123 457"), false);
  assert.strictEqual(valido("IT07A0200836812330244210454"), false);
});

test("IBAN: troppo corto o senza codice paese non è un IBAN", () => {
  assert.strictEqual(valido("IT60"), false);
  assert.strictEqual(valido("XX60X0542811101000000123456"), false);
  assert.strictEqual(valido(""), false);
  assert.strictEqual(valido(null), false);
});

test("IBAN: la normalizzazione toglie spazi e minuscole, come il database", () => {
  assert.strictEqual(normalizza("it60 x054 2811 1010 0000 0123 456"),
    "IT60X0542811101000000123456");
});

/* ------------------------------------------------------------- stati -- */

test("stato bonifico: «inviato» non è «eseguito»", () => {
  const inviato = pillStato({
    sent: { testo: "Inviato alla banca", pill: "pill--pending" }
  }, "sent");
  const eseguito = pillStato({
    executed: { testo: "Eseguito", pill: "pill--active" }
  }, "executed");
  assert.match(inviato, /Inviato alla banca/);
  assert.match(inviato, /pill--pending/);
  assert.match(eseguito, /Eseguito/);
  assert.match(eseguito, /pill--active/);
});

test("stato sconosciuto: si mostra il codice invece di una pillola vuota", () => {
  const s = pillStato({}, "qualcosa");
  assert.match(s, /qualcosa/);
  assert.match(s, /pill--pending/);
});

test("stato nullo non produce «null» a schermo", () => {
  assert.match(pillStato({}, null), /—/);
});

/* ------------------------------------------------------------ schema -- */
/* Il client e il database devono chiamare le stesse funzioni con gli stessi
   nomi di parametro: un `p_` sbagliato è un 404 di PostgREST che sembra un
   guasto generale. */
const API = fs.readFileSync(path.join(__dirname, "..", "assets/js/api.js"), "utf8");
const MIG = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/0016_banca_operativa.sql"), "utf8");

test("api: ogni chiamata della banca usa una funzione che esiste", () => {
  const attese = [
    "banca", "bonifico_crea", "bonifico_annulla", "mandato_crea", "mandato_revoca",
    "addebito_contesta", "carta_richiedi", "carta_blocca", "admin_banca",
    "admin_bonifico_invia", "admin_bonifico_esito", "admin_bonifico_entrata",
    "admin_addebito_crea", "admin_addebito_esito", "admin_carta_azione",
    "matricola_interessi", "accredita_interessi"
  ];
  attese.forEach(function (fn) {
    assert.ok(API.includes('"' + fn + '"'), "api.js non chiama " + fn);
    assert.ok(MIG.includes("function traccia." + fn + "("), "manca traccia." + fn);
  });
});

test("api: i parametri inviati esistono nella firma SQL", () => {
  const coppie = [
    ["bonifico_crea", ["p_iban", "p_beneficiario", "p_importo", "p_causale", "p_purpose", "p_istantaneo", "p_data"]],
    ["mandato_crea", ["p_creditore", "p_creditore_id", "p_scheme"]],
    ["admin_bonifico_esito", ["p_esito", "p_codice", "p_messaggio"]],
    ["admin_addebito_esito", ["p_esito"]],
    ["carta_blocca", ["p_motivo", "p_riattiva"]]
  ];
  coppie.forEach(function (c) {
    c[1].forEach(function (p) {
      assert.ok(API.includes(p + ":"), "api.js non manda " + p + " per " + c[0]);
      assert.ok(MIG.includes(p + " "), "manca " + p + " nella migrazione");
    });
  });
});

test("migrazione: nessun backreference regex, che è come si è rotto l'IBAN", () => {
  /* `'\1 '` in un replace SQL è esattamente ciò che ha prodotto \1 \1 \1 */
  assert.ok(!/regexp_replace\([^)]*\\1/.test(MIG),
    "0016 usa un backreference: usa traccia.iban_format");
});

test("migrazione: il tasso di interesse non è inventato nel codice", () => {
  assert.ok(/annual_rate_pct/.test(MIG));
  assert.ok(/values \('interest'/.test(MIG), "manca il default del tasso");
  /* non deve esistere un tasso scritto a mano dentro il calcolo */
  assert.ok(!/tasso\s*:=\s*[0-9]/.test(MIG), "tasso scritto nel codice");
});

module.exports = casi;
