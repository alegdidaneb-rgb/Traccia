/* Tests for the contract renderer — run with: node tests/run.js  */
const assert = require("assert");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* Il renderer si carica come lo caricherebbe il browser: uno script che
   si aggancia a `window`. */
function renderer() {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "assets/js/contract.js"), "utf8");
  const sandbox = {};
  new Function("window", src)(sandbox);
  return sandbox.TracciaContract;
}

function contratto(over) {
  const base = {
    number: "TRC-2026-0001", status: "generated", version: "2.0",
    generated_at: 1793460000, accepted_at: null,
    provider: { name: "ERSEL SPA", vat: "06900230018", pec: "traccia@pec.it",
                address: "Piazza Solferino, 11 - 10121 Torino (TO)" },
    client: { name: "Cliente Prova", email: "cliente@example.it", case_ref: "T-1000-2026",
              iban_formatted: "IT00 A000", kyc_level: 1 },
    fees: { start_fee_eur: 190, success_pct: 12 },
    limits: { daily_deposit: 1000, daily_withdrawal: 500, daily_buy: 1000,
              daily_sell: 1000, crypto_transfer_max: 0, unlimited: false },
    terms: { version: "2.0", recesso_giorni: 14 }
  };
  return Object.assign({}, base, over || {});
}

function testo(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/* zona della tabella dei limiti, per non confondere le altre clausole */
function righeLimiti(html) {
  const i = html.indexOf("ctr__table--limits");
  return testo(html.slice(i, i + 1200));
}

/* --------------------------------------------------------------- test -- */

test("il contratto contiene le dieci clausole e il numero", () => {
  const T = renderer();
  const html = T.render(contratto());
  assert.ok(html.includes("TRC-2026-0001"), "numero assente");
  for (let n = 1; n <= 10; n++) {
    assert.ok(html.includes("> " + n + ". ") || html.includes(n + ". Oggetto") ||
              new RegExp(">" + n + "\\. ").test(html) || html.includes(n + "."),
              "clausola " + n + " assente");
  }
  assert.ok(html.includes("Piazza Solferino, 11"), "sede legale assente");
});

test("la sede legale mancante è segnalata, non inventata", () => {
  const T = renderer();
  const c = contratto();
  c.provider.address = "";
  const html = T.render(c);
  assert.ok(/sede legale non indicata/.test(html), "la sede vuota deve essere segnalata");
  assert.ok(!/Piazza Solferino/.test(html), "non deve comparire una sede inventata");
});

test("zero non significa illimitato: significa non consentito", () => {
  const T = renderer();
  assert.strictEqual(T.limite(0), "non consentito a questo livello");
  assert.strictEqual(T.limite(-1), "non consentito a questo livello");
  assert.strictEqual(T.limite(null), "non previsto");
});

test("livello completo, illimitato: nessuna riga deve dire «non consentito»", () => {
  const T = renderer();
  const c = contratto();
  c.client.kyc_level = 3;
  c.limits = { daily_deposit: 0, daily_withdrawal: 0, daily_buy: 0,
               daily_sell: 0, crypto_transfer_max: 0, unlimited: true };
  const righe = righeLimiti(T.render(c));
  assert.ok(!/non consentito/.test(righe),
    "un cliente verificato non può leggere «non consentito»: " + righe);
  assert.ok(/nessun limite/.test(righe), "deve dire che non c'è limite: " + righe);
});

test("livello base: i limiti numerici sono quelli giusti", () => {
  const T = renderer();
  const righe = righeLimiti(T.render(contratto()));
  assert.ok(/500,00 € al giorno/.test(righe), "prelievo 500 atteso: " + righe);
  assert.ok(/1000,00 € al giorno/.test(righe), "versamento 1000 atteso: " + righe);
});

test("il contratto accettato riporta la data", () => {
  const T = renderer();
  const html = T.render(contratto({ status: "accepted", accepted_at: 1793460600 }));
  assert.ok(/Contratto accettato/.test(html), "manca la dicitura di accettazione");
});

test("i dati del cliente sono escapati", () => {
  const T = renderer();
  const c = contratto();
  c.client.name = '<script>alert(1)</script>';
  const html = T.render(c);
  assert.ok(!html.includes("<script>alert(1)</script>"), "XSS nel nome cliente");
  assert.ok(html.includes("&lt;script&gt;"), "il nome deve essere escapato");
});

test("illimitato: la clausola 10 dice che non ci sono tetti interni", () => {
  const T = renderer();
  const c = contratto();
  c.client.kyc_level = 3;
  c.limits = { daily_deposit: 0, daily_withdrawal: 0, daily_buy: 0,
               daily_sell: 0, crypto_transfer_max: 0, unlimited: true };
  const html = T.render(c);
  assert.ok(/non applica limiti giornalieri interni ad alcuna operazione/.test(html),
    "manca la dichiarazione di assenza di tetti");
  assert.ok(/ivi compresi i trasferimenti in valuta virtuale/.test(html),
    "i trasferimenti crypto devono essere compresi");
});

test("illimitato: resta il rinvio ai controlli di banca e autorità", () => {
  const T = renderer();
  const c = contratto();
  c.client.kyc_level = 3;
  c.limits = { daily_deposit: 0, daily_withdrawal: 0, daily_buy: 0,
               daily_sell: 0, crypto_transfer_max: 0, unlimited: true };
  const html = T.render(c);
  assert.ok(/Restano fermi i controlli disposti dalla banca/.test(html),
    "senza questo rinvio il contratto promette più di quanto possa mantenere");
});

test("non illimitato: nessuna promessa di illimitatezza", () => {
  const T = renderer();
  const html = T.render(contratto());
  assert.ok(!/non applica limiti giornalieri/.test(html),
    "un cliente non verificato non deve leggere promesse di illimitatezza");
});

module.exports = casi;
