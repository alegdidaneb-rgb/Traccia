/* Tests for the transfer receipt and the transfers-only statement.
 *
 * Cosa si prova, e perché:
 *
 * 1. **Il CSV.** Un estratto che si scarica deve aprirsi in un foglio di
 *    calcolo italiano: punto e virgola come separatore, virgola nei decimali,
 *    BOM per gli accenti, e le virgolette quando il testo contiene il
 *    separatore. Un CSV sbagliato sembra funzionare e poi spezza le colonne.
 *
 * 2. **La ricevuta non è una fattura.** Un bonifico non ha un corrispettivo:
 *    se il documento si chiama «fattura» o non lo dice, è un documento falso.
 *    Il test guarda il testo che finisce sotto il naso del cliente.
 *
 * 3. **La modale alta.** Il difetto riferito — «senza zoommare non riesco a
 *    confermare il bonifico» — era di CSS: un backdrop centrato che non
 *    scrolla taglia il pulsante in fondo. Il test verifica che la regola ci
 *    sia e che valga per *tutte* le modali, non solo per quella larga.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "..", "assets/css/premium.css"), "utf8");
const APP = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

/* estrae una funzione da case.js, con le dipendenze che le servono */
function funzione(nome, extra) {
  const i = SRC.indexOf("function " + nome + "(");
  assert.ok(i > -1, "funzione " + nome + " non trovata");
  let p = SRC.indexOf("{", i), d = 0, j = p;
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") d++;
    else if (SRC[j] === "}") { d--; if (d === 0) break; }
  }
  const args = Object.keys(extra || {});
  const vals = Object.values(extra || {});
  return new Function(...args, "return (" + SRC.slice(i, j + 1) + ");")(...vals);
}

const STATI = {
  queued: { testo: "In coda", pill: "pill--pending" },
  sent: { testo: "Inviato", pill: "pill--pending" },
  executed: { testo: "Eseguito", pill: "pill--up" },
  rejected: { testo: "Respinto", pill: "pill--down" },
  returned: { testo: "Restituito", pill: "pill--down" },
  cancelled: { testo: "Annullato", pill: "pill--pending" }
};

function csv() {
  return funzione("csvBonifici", { STATO_BONIFICO: STATI });
}

test("csv: intestazione con le colonne che servono a un commercialista", () => {
  const testo = csv()({ bonifici: [] });
  const prima = testo.split("\r\n")[0];
  ["Numero", "Beneficiario", "IBAN beneficiario", "Importo", "Stato",
   "Codice banca", "Data valuta"].forEach(function (c) {
    assert.ok(prima.indexOf(c) > -1, "manca la colonna «" + c + "»");
  });
  assert.ok(prima.indexOf(";") > -1, "il separatore deve essere il punto e virgola");
  assert.ok(prima.indexOf(",") === -1, "la virgola nel separatore spezza i decimali");
});

test("csv: gli importi hanno la virgola, il testo con il separatore va tra virgolette", () => {
  const testo = csv()({
    bonifici: [{
      reference: "TRC-B-2026-000001", disposto_il: "2026-11-01T14:16:38+00:00",
      data_richiesta: "2026-11-01", data_valuta: "2026-11-01",
      beneficiario: 'Rossi; figli "snc"', iban: "IT60 X054 2811 1010 0000 0123 456",
      importo_eur: 250.5, divisa: "EUR", causale: "Saldo fattura; 12/2026",
      codice_causale: "GDDS", schema: "sepa_credit", stato: "executed",
      codice_banca: null, messaggio_banca: null
    }]
  });
  const riga = testo.split("\r\n")[1];
  assert.ok(riga.indexOf("250,50") > -1, "l'importo deve essere 250,50 (virgola)");
  assert.ok(riga.indexOf('"Rossi; figli ""snc"""') > -1, "le virgolette nel testo vanno raddoppiate");
  assert.ok(riga.split(";").length > 10, "le colonne si sono spaccate");
});

test("csv: lo stato è la parola che il cliente legge, non il codice del database", () => {
  const testo = csv()({
    bonifici: [{ reference: "X", importo_eur: 1, stato: "rejected", schema: "sepa_instant" }]
  });
  assert.ok(testo.indexOf("Respinto") > -1);
  assert.ok(testo.indexOf("rejected") === -1, "il codice inglese non va in un documento italiano");
  assert.ok(testo.indexOf("SEPA istantaneo") > -1);
});

test("ricevuta: non si presenta come fattura, e dice cosa non è", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0018_documenti_bonifico.sql"), "utf8");
  /* conta il testo che il cliente legge, non i commenti del file: la nota che
     finisce nel JSON e il titolo che finisce nella modale */
  const nota = (sql.match(/'nota',\s*'([^']*)'/) || [])[1] || "";
  assert.ok(/non documento fiscale/i.test(nota),
    "la nota deve dire che non è un documento fiscale");
  assert.ok(!/^\s*fattura/i.test(nota), "la nota non deve presentarsi come fattura");

  const titolo = (APP.match(/id="receipt-title"[^>]*>([^<]*)</) || [])[1] || "";
  assert.ok(/ricevuta/i.test(titolo), "il titolo della modale deve dire «ricevuta»");
  assert.ok(!/fattura/i.test(titolo), "il titolo non deve dire «fattura»");

  assert.ok(/'provider'/.test(sql), "manca l'intestazione del prestatore");
});

test("ricevuta: contiene codice banca e data valuta, che è il motivo per cui esiste", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0018_documenti_bonifico.sql"), "utf8");
  ["codice_banca", "messaggio_banca", "data_valuta", "beneficiario", "saldo_dopo_eur",
   "numero", "emesso_il"].forEach(function (c) {
    assert.ok(sql.indexOf("'" + c + "'") > -1, "manca «" + c + "» nella ricevuta");
  });
});

test("estratto bonifici: legge i bonifici, non il ledger", () => {
  /* il motivo per cui non bastava filtrare l'estratto conto: il ledger non ha
     l'IBAN del beneficiario né l'esito della banca */
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0018_documenti_bonifico.sql"), "utf8");
  const i = sql.indexOf("create or replace function traccia.bonifici_estratto");
  const corpo = sql.slice(i, sql.indexOf("end $$;", i));
  assert.ok(/from traccia\.bank_transfers/.test(corpo), "deve leggere bank_transfers");
  assert.ok(/direction = 'out'/.test(corpo), "solo i bonifici in uscita");
  assert.ok(/p_stato/.test(corpo), "manca il filtro per stato");
});

test("estratto bonifici: il totale conta solo gli eseguiti", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0018_documenti_bonifico.sql"), "utf8");
  assert.ok(/status = 'executed' then t\.amount_eur else 0/.test(sql),
    "sommare anche i respinti farebbe credere di aver pagato soldi che sono ancora sul conto");
});

test("wrapper public: i due documenti sono raggiungibili dal sito", () => {
  /* la lezione del #12: una funzione senza wrapper, dal browser, non esiste */
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/0018_documenti_bonifico.sql"), "utf8");
  ["bonifico_ricevuta", "bonifici_estratto"].forEach(function (n) {
    assert.ok(new RegExp("create or replace function public\\." + n + "\\s*\\(").test(sql),
      "manca il wrapper public." + n);
    assert.ok(new RegExp("grant execute on function public\\." + n).test(sql),
      "manca il grant per public." + n);
  });
});

test("modali: ogni modale ha un tetto all'altezza e scorre da sola", () => {
  /* Era questo il difetto: `max-height: 92vh` stava solo su `.modal--wide`,
     quindi la modale del bonifico — che è alta — usciva dallo schermo e il
     pulsante «Disponi il bonifico» restava irraggiungibile. */
  assert.ok(/\.modal\s*\{[^}]*max-height:\s*min\(92vh/.test(CSS),
    "manca max-height su .modal: le modali alte escono dallo schermo");
  assert.ok(/\.modal\s*\{[^}]*overflow-y:\s*auto/.test(CSS),
    "senza overflow la modale alta si taglia invece di scorrere");
  assert.ok(/\.modal-backdrop\s*\{[^}]*overflow-y:\s*auto/.test(CSS),
    "anche il contenitore deve poter scorrere");
});

test("modali: i pulsanti in fondo restano raggiungibili", () => {
  assert.ok(/\.modal \.btn-row\s*\{[^}]*position:\s*sticky/.test(CSS),
    "la riga dei pulsanti deve fermarsi in fondo invece di sparire");
  assert.ok(!/max-height:\s*92vh/.test(CSS.split("@media print")[0].replace(/\.modal--wide[^{]*\{[^}]*\}/g, "")),
    "un tetto solo su alcune modali lascia le altre scoperte");
});

test("pagina: il pulsante nuovo bonifico e il download esistono in app.html", () => {
  assert.ok(/data-bonifico-apri/.test(APP), "manca il pulsante per disporre un bonifico");
  assert.ok(/data-bonifici-csv/.test(APP), "manca il pulsante per scaricare l'estratto dei bonifici");
  assert.ok(/data-receipt-modal/.test(APP), "manca la modale della ricevuta");
  /* e la ricevuta si può stampare: è la via al PDF, senza librerie */
  assert.ok(/data-receipt-print/.test(APP), "manca la stampa della ricevuta");
});

test("bonifico: la ricevuta si offre subito dopo la disposizione", () => {
  assert.ok(/function raggiungiRicevuta/.test(SRC), "manca il collegamento alla ricevuta appena disposta");
  assert.ok(/raggiungiRicevuta\(res\.id/.test(SRC), "dopo il bonifico non si arriva alla ricevuta");
});

module.exports = casi;
