/* Tests della correzione di una pratica — `node tests/run.js`
 *
 * Perché eseguono il codice: «Modifica» è un pulsante che apre una finestra e
 * poi chiama il server. Un test che legge il sorgente direbbe «la funzione
 * esiste» anche se il pulsante non la chiama, o se manda al database il campo
 * sbagliato. Il difetto da cui nascono questi test è un'assenza: in console si
 * poteva cambiare fase, KYC e ruolo, ma non il nome. Per correggere «Marco
 * Rosi» in «Marco Rossi» l'unico modo era il SQL.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const ADMIN = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
const API = fs.readFileSync(path.join(RADICE, "assets/js/api.js"), "utf8");
const UI = fs.readFileSync(path.join(RADICE, "assets/js/ui.js"), "utf8");
const MIGRAZIONE = fs.readFileSync(
  path.join(RADICE, "supabase/migrations/0030_correggere_la_pratica.sql"), "utf8");

/* ---------------------------------------------------- il pannello, eseguito -- */
/* Si ritaglia `modificaPratica` e le funzioni che usa, e si sostituisce
   `ui.form` con una risposta decisa dal test: quello che conta qui è **cosa
   arriva al database**, non come è fatta la finestra. */
function conConsole(rispostaForm) {
  const chiamate = { salva: [], fase: [], toast: [], refresh: 0 };
  const ui = {
    form: () => Promise.resolve(rispostaForm),
    ask: () => Promise.resolve("nota del modale"),
    toast: (testo, tipo) => chiamate.toast.push({ testo, tipo }),
    money: (v) => Number(v).toFixed(2) + " €",
    esc: (v) => String(v === null || v === undefined ? "" : v),
    when: () => "12 nov 2026"
  };
  const api = {
    salvaPratica: (id, dati) => { chiamate.salva.push({ id, dati }); return Promise.resolve({ ok: true }); },
    setPhase: (id, fase, nota, avvisa) => {
      chiamate.fase.push({ id, fase, nota, avvisa });
      return Promise.resolve({ ok: true, changed: true });
    }
  };
  const state = { allAccounts: [] };
  const i = ADMIN.indexOf("function modificaPratica(id) {");
  const j = ADMIN.indexOf("function renderAudit(rows) {");
  assert.ok(i > -1 && j > i, "modificaPratica non trovata");
  const corpo = ADMIN.slice(i, j);

  const fabbrica = new Function(
    "ui", "api", "state", "refresh", "FASI_CLIENTE",
    corpo + "\nreturn { modificaPratica: modificaPratica };"
  );
  const mod = fabbrica(
    ui, api, state,
    () => { chiamate.refresh += 1; return Promise.resolve(); },
    ["Raccolta", "Ricostruzione", "Perizia", "Denunce", "Legale"]
  );
  mod.chiamate = chiamate;
  mod.state = state;
  return mod;
}

const PRATICA = {
  id: "u1", case_ref: "T-2586-2026", name: "Maria Teresa Lonardi",
  first_name: "Maria Teresa", last_name: "Lonardi", phone: "+393331234567",
  case_amount_eur: 1670049, notes: null, case_phase: 1
};

function formVuoto(extra) {
  return Object.assign({
    name: PRATICA.name, first_name: PRATICA.first_name, last_name: PRATICA.last_name,
    phone: PRATICA.phone, case_amount_eur: String(PRATICA.case_amount_eur), notes: "",
    fase: "1"
  }, extra || {});
}

/* ---------------------------------------------------------------- test -- */

test("correggere il nome manda al database solo il nome", async () => {
  const mod = conConsole(formVuoto({ name: "Maria Teresa Lonardi Rossi" }));
  mod.state.allAccounts = [PRATICA];
  await mod.modificaPratica("u1");
  assert.strictEqual(mod.chiamate.salva.length, 1, "una sola chiamata");
  assert.deepStrictEqual(mod.chiamate.salva[0].dati, { name: "Maria Teresa Lonardi Rossi" },
    "solo il campo cambiato: mandare tutto sovrascriverebbe il lavoro di chi ha salvato prima");
  assert.strictEqual(mod.chiamate.fase.length, 0, "la fase non è cambiata: nessun modale in più");
  assert.strictEqual(mod.chiamate.refresh, 1, "dopo il salvataggio la console si rilegge");
});

test("non cambiare niente non scrive niente", async () => {
  const mod = conConsole(formVuoto({ phone: PRATICA.phone }));
  mod.state.allAccounts = [PRATICA];
  await mod.modificaPratica("u1");
  assert.strictEqual(mod.chiamate.salva.length, 0, "nessuna scrittura se non cambia nulla");
  assert.strictEqual(mod.chiamate.fase.length, 0, "e nessun modale di fase");
  assert.match(mod.chiamate.toast[0].testo, /Niente da salvare/);
  assert.strictEqual(mod.chiamate.refresh, 0);
});

test("annullare la finestra non tocca niente", async () => {
  const mod = conConsole(null);
  mod.state.allAccounts = [PRATICA];
  await mod.modificaPratica("u1");
  assert.strictEqual(mod.chiamate.salva.length, 0);
  assert.strictEqual(mod.chiamate.toast.length, 0);
});

test("la fase si cambia dallo stesso pannello dei dati", async () => {
  const mod = conConsole(formVuoto({ fase: "3", notes: "cliente richiamato" }));
  mod.state.allAccounts = [PRATICA];
  await mod.modificaPratica("u1");
  assert.strictEqual(mod.chiamate.fase.length, 1, "la fase deve passare dal suo percorso");
  assert.strictEqual(mod.chiamate.fase[0].fase, 3);
  assert.strictEqual(mod.chiamate.fase[0].avvisa, true, "il cliente va avvisato della fase");
  assert.deepStrictEqual(mod.chiamate.salva[0].dati, { notes: "cliente richiamato" },
    "la nota interna va con i dati, non con la fase");
});

test("i campi vuoti si possono svuotare, e arrivano come stringa vuota", async () => {
  /* Svuotare un telefono sbagliato è legittimo; il database lo tratta come
     «cancella», mentre `null` significa «non toccare». Se il pannello mandasse
     `undefined` al posto della stringa vuota, il campo resterebbe com'era e
     l'analista crederebbe di averlo cancellato. */
  const mod = conConsole(formVuoto({ name: PRATICA.name, phone: "", first_name: PRATICA.first_name, last_name: PRATICA.last_name }));
  mod.state.allAccounts = [Object.assign({}, PRATICA, { phone: "+393331234567" })];
  await mod.modificaPratica("u1");
  assert.deepStrictEqual(mod.chiamate.salva[0].dati, { phone: "" });
});

test("l'importo è un numero, non il testo del campo", async () => {
  const mod = conConsole(formVuoto({ case_amount_eur: "250000,50".replace(",", ".") }));
  mod.state.allAccounts = [PRATICA];
  await mod.modificaPratica("u1");
  assert.strictEqual(mod.chiamate.salva[0].dati.case_amount_eur, 250000.5);
  assert.strictEqual(typeof mod.chiamate.salva[0].dati.case_amount_eur, "number");
});

/* ------------------------------------------------------------ il database -- */

test("la migrazione accetta solo i campi che sa scrivere", () => {
  ["name", "first_name", "last_name", "phone", "case_amount_eur", "notes"].forEach((campo) => {
    assert.ok(MIGRAZIONE.includes(`'${campo}'`), `manca il campo ${campo} nella lista ammessa`);
  });
  const ammessi = MIGRAZIONE.match(/k not in \(([^)]*)\)/);
  assert.ok(ammessi, "manca la lista dei campi ammessi");
  const elenco = ammessi[1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepStrictEqual(elenco.sort(),
    ["case_amount_eur", "first_name", "last_name", "name", "notes", "phone"].sort(),
    "la lista ammessa non deve contenere altro: phase e role hanno le loro funzioni");
  assert.ok(/raise exception 'Campo non modificabile/.test(MIGRAZIONE),
    "una chiave sconosciuta va rifiutata, non ignorata");
});

test("il registro dice cosa è cambiato, non solo «modificata»", () => {
  assert.ok(/log_action\(a, 'case_edit'/.test(MIGRAZIONE), "manca la voce di registro");
  assert.ok(/nome: ' \|\| coalesce\(t\.name/.test(MIGRAZIONE),
    "il registro deve contenere il valore di prima");
  assert.ok(/→ ' \|\| nuovo_nome/.test(MIGRAZIONE),
    "e quello di dopo: un registro senza i due valori non ricostruisce niente");
});

test("il nome non può essere svuotato", () => {
  assert.ok(/Il nome non può restare vuoto/.test(MIGRAZIONE),
    "il nome è ciò che la console e il cliente vedono: svuotarlo non si recupera");
  assert.ok(/nuovo_nome := nullif\(btrim\(p_dati->>'name'\), ''\)/.test(MIGRAZIONE),
    "gli spazi da soli non sono un nome");
});

test("se cambia il nome completo, nome e cognome si ricavano", () => {
  /* Era il difetto vero nei dati: `name` c'era, `first_name` no. Correggere
     il nome lasciando vuoto il nome proprio fa comparire «—» nel saluto
     della pagina del cliente. */
  assert.ok(/if not \(p_dati \? 'first_name'\) and not \(p_dati \? 'last_name'\)/.test(MIGRAZIONE),
    "il nome proprio si deve ricavare dal nome completo quando non è passato");
  assert.ok(/position\(' ' in reverse\(nuovo_nome\)\)/.test(MIGRAZIONE),
    "la divisione deve usare l'ultimo spazio: «Maria Teresa Lonardi» → «Maria Teresa» + «Lonardi»");
});

test("l'importo negativo è rifiutato, lo zero no", () => {
  assert.ok(/nuovo_importo < 0/.test(MIGRAZIONE), "un importo negativo non esiste");
  assert.ok(!/nuovo_importo <= 0/.test(MIGRAZIONE),
    "zero è legittimo: una pratica appena aperta non ha ancora un importo");
});

test("solo il master tocca l'account master", () => {
  assert.ok(/if t\.is_master and not a\.is_master then/.test(MIGRAZIONE));
  assert.ok(/42501/.test(MIGRAZIONE), "il rifiuto deve essere un errore di permesso, non generico");
});

test("la funzione è raggiungibile dal client", () => {
  assert.ok(/salvaPratica: function \(id, dati\)/.test(API), "manca il metodo nel client");
  assert.ok(/call\("admin_salva_pratica"/.test(API), "il client deve chiamare la funzione giusta");
  assert.ok(/grant execute on function public\.admin_salva_pratica/.test(MIGRAZIONE),
    "senza grant il client riceve «permission denied»");
});

/* --------------------------------------------------------------- la console -- */

test("«Modifica» sta sulla riga della pratica, accanto ad «Apri pratica»", () => {
  assert.ok(/data-modifica="' \+ user.id/.test(ADMIN), "manca il pulsante nella riga");
  assert.ok(/editBtn \+ openBtn/.test(ADMIN),
    "«Modifica» deve venire prima di «Apri pratica»: prima si corregge, poi si guarda");
  assert.ok(/modificaPratica\(modifica\.getAttribute\("data-modifica"\)\)/.test(ADMIN),
    "il pulsante deve essere collegato alla funzione");
});

test("la tabella delle pratiche mostra la fase", () => {
  assert.ok(/pill pill--phase/.test(ADMIN), "la fase deve essere visibile dove si guarda la pratica");
  assert.match(ADMIN, /var FASI_CLIENTE = \["Raccolta", "Ricostruzione", "Perizia", "Denunce", "Legale"\]/,
    "le fasi devono essere scritte una volta sola");
  assert.ok(!/var FASI\b/.test(ADMIN),
    "c'era una lista di fasi per ogni punto della console: divergono, e vince quella sbagliata");
});

test("la finestra con più campi esiste e li manda tutti insieme", () => {
  assert.ok(/function form\(opzioni\)/.test(UI), "manca `ui.form`");
  assert.ok(/form: form/.test(UI), "e non è esportata");
  assert.ok(/querySelector\('\[name="' \+ c\.nome \+ '"\]'\)/.test(UI),
    "i valori si devono leggere per nome, non per posizione");
  assert.ok(/if \(e\.key === "Escape"\) close\(null\)/.test(UI),
    "Escape deve annullare: altrimenti l'unica uscita è il mouse");
});

test("il registro si costruisce a pezzi, non incollando stringhe a un elenco", () => {
  /* Trovato in collaudo sul database: `cambi := cambi || 'nota aggiornata'`
     non aggiunge una voce, prova a **concatenare** testo a un array e Postgres
     risponde `malformed array literal`. Va bene solo finché nessuno tocca la
     nota — cioè mai, visto che c'è un campo per scriverla. `array_append`
     vuole un elemento solo per chiamata, e questa è la forma che si può
     verificare leggendo. */
  const concatenazioni = MIGRAZIONE.match(/cambi\s*:=\s*cambi\s*\|\|/g) || [];
  assert.deepStrictEqual(concatenazioni, [],
    "usa array_append: `cambi || 'testo'` interpreta il testo come un array");
  const aggiunte = MIGRAZIONE.match(/cambi\s*:=\s*array_append\(cambi,/g) || [];
  assert.ok(aggiunte.length >= 5,
    "ogni campo modificabile deve aggiungere la sua voce al registro");
});

module.exports = casi;
