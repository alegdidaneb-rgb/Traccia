/* ==========================================================================
   Le pratiche: si cercano, non si scorrono
   ==========================================================================
   Il cliente, il 2026-11-14: «nella sezione admin tutte le pratiche, vedi di
   sistemare un po' tutto, perché il modo in cui si vede non è bene né è molto
   friendly nell'utilizzo».

   Non era un problema di colori. Era che l'unico modo di trovare una pratica
   era **scorrere** un elenco che non diceva quanti elementi avesse; che le
   informazioni per decidere (cosa manca a questa pratica) stavano mescolate a
   tre codici che si cercano solo ogni tanto; e che tre pulsanti identici su
   ogni riga obbligavano a rileggere quale servisse.

   Qui si prova il comportamento su un DOM finto: le schede contano le pratiche
   vere, la ricerca trova per nome e per codice, e quando non c'è niente da
   mostrare la tabella dice perché invece di restare su «Caricamento…».
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const ADMIN = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
const HTML = fs.readFileSync(path.join(RADICE, "admin.html"), "utf8");
const CSS = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* ------------------------------------------------------- le funzioni vere --
   Si ritaglia il blocco che serve invece di eseguire `admin.js`: appena parte,
   il file apre una sessione e disegna tutta la console. */
function blocco() {
  const da = (a, b) => {
    const i = ADMIN.indexOf(a);
    const j = ADMIN.indexOf(b, i);
    assert.ok(i > -1 && j > i, "blocco non trovato in admin.js: " + a.slice(0, 40));
    return ADMIN.slice(i, j);
  };
  return [
    da("var FASI_CLIENTE = ", "/* ---------------------------------------------------------- operations -- */"),
  ].join("\n");
}

const FASI_CLIENTE = ["Raccolta", "Ricostruzione", "Perizia", "Denunce", "Legale"];

function contesto(pratiche, scheda, ricerca) {
  const scritti = [];
  const nodi = {};
  const state = {
    allAccounts: pratiche,
    schedaPratiche: scheda || "tutte",
    ricercaPratiche: ricerca || "",
  };
  /* un nodo minimo: solo quello che `renderAllAccounts` tocca */
  function nodo(selettore) {
    if (!nodi[selettore]) {
      nodi[selettore] = {
        textContent: "",
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      };
    }
    return nodi[selettore];
  }
  /* `renderAllAccounts` cerca i nodi dei contatori e il totale: il finto
     `document` deve rispondere come il vero, per selettore */
  const document = {
    querySelector(selettore) {
      if (selWithData(selettore)) return nodo(selettore);
      return null;
    },
  };
  function selWithData(sel) {
    return sel.indexOf("[data-quante=") > -1 || sel.indexOf("[data-pratiche-conteggio]") > -1;
  }
  const ui = {
    esc: (v) => String(v === null || v === undefined ? "" : v),
    money: (v) => (Number(v) || 0).toLocaleString("it-IT") + " €",
  };
  const corpo = { innerHTML: "" };
  const L = { allAccountsBody: corpo };

  const codice = blocco()
    .replace('var FASI_CLIENTE = ["Raccolta", "Ricostruzione", "Perizia", "Denunce", "Legale"];',
             "var FASI_CLIENTE = " + JSON.stringify(FASI_CLIENTE) + ";");

  /* eslint-disable no-new-func */
  const fabbrica = new Function(
    "state", "ui", "L", "conta", "document", "casi",
    codice + "\nreturn { renderAllAccounts: renderAllAccounts, " +
    "cosaManca: cosaManca, inScheda: inScheda, corrisponde: corrisponde };"
  );
  const api = fabbrica(state, ui, L, () => {}, document, scritti);
  return { api, corpo, state, nodi, scritti, nodo };
}

const P = (over) => Object.assign({
  id: "1", name: "Anna Rossi", email: "anna@esempio.it", phone: "+39 333 1112222",
  status: "active", case_phase: 2, balance_eur: 1200, holdings_value: 0,
  iban_formatted: "IT60 X054 2811 1010 0000 0123 456",
  iban_verified: true, contract_number: "T-2026-001", contract_status: "accepted",
  case_ref: "PR-2026-001", is_master: false,
}, over || {});

/* ------------------------------------------------------------------ test -- */

test("le quattro schede sono le quattro domande che si fanno davvero", () => {
  ["tutte", "da-rispondere", "da-completare", "da-verificare"].forEach((scheda) => {
    assert.ok(HTML.indexOf('data-filtro="' + scheda + '"') > -1,
      "manca la scheda «" + scheda + "»");
  });
  /* e non ce ne sono altre: ogni scheda in più è una scheda che nessuno apre */
  const schede = (HTML.match(/data-filtro="[a-z-]+"/g) || []);
  assert.equal(schede.length, 4, "attese quattro schede, trovate: " + schede.join(", "));
});

test("«da rispondere» sono le pratiche in attesa, non tutte", () => {
  const { api } = contesto([]);
  assert.ok(api.inScheda(P({ status: "pending" }), "da-rispondere"));
  assert.ok(!api.inScheda(P({ status: "active" }), "da-rispondere"),
    "una pratica attiva non aspetta una risposta");
});

test("«da completare» sono le pratiche a cui manca qualcosa di scritto", () => {
  const { api } = contesto([]);
  const completa = P({});
  assert.ok(!api.inScheda(completa, "da-completare"),
    "una pratica con IBAN verificato, contratto accettato e telefono non ha niente da completare");

  assert.ok(api.inScheda(P({ iban_formatted: "" }), "da-completare"), "manca l'IBAN");
  assert.ok(api.inScheda(P({ contract_number: "" }), "da-completare"), "manca il contratto");
  assert.ok(api.inScheda(P({ contract_status: "pending" }), "da-completare"),
    "il contratto non è accettato");
  assert.ok(api.inScheda(P({ phone: "" }), "da-completare"),
    "senza telefono non si può chiamare: è un dato che manca");
});

test("«da verificare» isola le coordinate bancarie da controllare", () => {
  const { api } = contesto([]);
  const daVerificare = P({ iban_verified: false });
  assert.ok(api.inScheda(daVerificare, "da-verificare"));
  assert.ok(!api.inScheda(P({ iban_verified: true }), "da-verificare"));
  /* una pratica senza IBAN non è «da verificare»: non c'è niente da guardare */
  assert.ok(!api.inScheda(P({ iban_formatted: "", iban_verified: false }), "da-verificare"),
    "senza coordinate non c'è niente da verificare: quella pratica è da completare");
});

test("la ricerca trova per nome, email, telefono e codice pratica", () => {
  const { api } = contesto([]);
  const anna = P({});
  [["anna", "nome"], ["ESEMPIO.IT", "email"], ["333111", "telefono"],
   ["PR-2026-001", "codice pratica"], ["T-2026-001", "numero di contratto"]].forEach(([q]) => {
    assert.ok(api.corrisponde(anna, q), "la ricerca non trova «" + q + "»");
  });
  assert.ok(!api.corrisponde(anna, "bianchi"), "trova anche chi non c'è");
  /* più parole: tutte devono comparire, in qualunque ordine */
  assert.ok(api.corrisponde(anna, "rossi anna"));
  assert.ok(!api.corrisponde(anna, "rossi bianchi"));
});

test("i numeri delle schede sono contati sulle pratiche vere", () => {
  const pratiche = [
    P({ id: "1", status: "pending" }),
    P({ id: "2", iban_verified: false }),
    P({ id: "3", contract_number: "" }),
    P({ id: "4" }),
  ];
  const { api, nodo } = contesto(pratiche, "tutte", "");
  api.renderAllAccounts();
  assert.equal(nodo('[data-quante="tutte"]').textContent, "4");
  assert.equal(nodo('[data-quante="da-rispondere"]').textContent, "1");
  assert.equal(nodo('[data-quante="da-verificare"]').textContent, "1");
  /* da completare: la 3 (contratto) — la 1 è in attesa ma completa, e una
     pratica in attesa non è «da completare» finché non le manca un dato */
  assert.equal(nodo('[data-quante="da-completare"]').textContent, "1");
});

test("quando non c'è niente, la tabella dice perché — non «Caricamento…»", () => {
  const nessuna = contesto([], "tutte", "");
  nessuna.api.renderAllAccounts();
  assert.ok(nessuna.corpo.innerHTML.indexOf("Caricamento") === -1,
    "«Caricamento…» che resta è il difetto peggiore: dice che sta arrivando " +
    "qualcosa che non arriverà mai");
  assert.ok(/Nessuna pratica/.test(nessuna.corpo.innerHTML),
    "una tabella vuota deve dire che non ci sono pratiche e da dove nascono");
});

test("con una ricerca senza risultati, la tabella dice cosa cercare", () => {
  const { api, corpo } = contesto([P({})], "tutte", "bianchi");
  api.renderAllAccounts();
  assert.ok(/Nessuna pratica corrisponde a «bianchi»/.test(corpo.innerHTML),
    "va detto che è la ricerca a non trovare niente, non che le pratiche non ci sono");
  assert.ok(/codice pratica/.test(corpo.innerHTML),
    "va suggerito l'altro modo di cercare — il codice è quello che il cliente ha in mano");
});

test("la riga mostra cosa manca, e non tre codici", () => {
  /* la pratica ha un contratto **e** un IBAN da verificare: se il numero di
     contratto comparisse in riga lo si vedrebbe — con una pratica senza
     contratto il controllo non provava niente */
  const { api, corpo } = contesto([
    P({ iban_verified: false, contract_number: "T-2026-777", phone: "" }),
  ]);
  api.renderAllAccounts();
  assert.ok(/Verifica IBAN/.test(corpo.innerHTML), "manca la cosa più importante: l'IBAN da verificare");
  /* il contratto c'è: non deve comparire fra le cose che mancano. Una riga
     che elenca tutto, anche ciò che è a posto, è una riga che si impara a
     ignorare. */
  assert.ok(!/Contratto da generare/.test(corpo.innerHTML),
    "il contratto è stato generato: non è una cosa che manca");
  assert.ok(/Telefono/.test(corpo.innerHTML),
    "senza telefono non si può chiamare: va detto nella riga, non solo nella scheda «da completare»");
  /* il numero di contratto per esteso non serve in elenco: occupa spazio e si
     legge solo quando la pratica è aperta */
  assert.ok(corpo.innerHTML.indexOf("T-2026-777") === -1,
    "il numero di contratto non è una colonna dell'elenco");
});

test("le pratiche complete dicono «Completa», non una riga vuota", () => {
  const { api, corpo } = contesto([P({})]);
  api.renderAllAccounts();
  assert.ok(/Completa/.test(corpo.innerHTML),
    "una riga senza segnalazioni si legge come «non ho controllato»: va detto " +
    "che non manca niente");
});

test("la ricerca si stringe mentre si scrive, senza ricaricare", () => {
  const pezzo = ADMIN.slice(ADMIN.indexOf("[data-pratiche-ricerca]"));
  const ascoltatore = pezzo.slice(0, pezzo.indexOf("busy"));
  assert.ok(/addEventListener\("input"/.test(ascoltatore),
    "la ricerca deve reagire a `input`: aspettare «Invio» mentre il cliente è al " +
    "telefono è un clic di troppo");
  assert.ok(/renderAllAccounts\(\)/.test(ascoltatore),
    "la ricerca deve ridisegnare l'elenco, non chiamare il server a ogni tasto");
  assert.ok(!/api\.accounts\(/.test(ascoltatore),
    "filtrare righe già in pagina non richiede una chiamata al server");
});

test("la ricerca ha un nome per chi non la vede", () => {
  assert.ok(/<label class="sr-only" for="pratiche-q">/.test(HTML),
    "un campo di ricerca senza etichetta è un campo che un lettore di schermo " +
    "annuncia come «campo di testo»");
  assert.ok(/type="search"/.test(HTML), "il tipo giusto dà la «x» per cancellare");
});

test("la sezione si chiama come la voce del menu", () => {
  assert.ok(/<h2>Pratiche<\/h2>/.test(HTML),
    "la voce del menu dice «Pratiche»: il titolo deve dire la stessa cosa");
  assert.ok(HTML.indexOf("<h2>Tutte le pratiche</h2>") === -1);
});

test("la barra delle schede non sfonda a schermo stretto", () => {
  assert.ok(/\.pratiche__barra\s*\{[^}]*flex-wrap:\s*wrap/.test(CSS),
    "schede e ricerca devono andare a capo invece di uscire dallo schermo");
  assert.ok(/\.pratiche__cerca\s*\{[^}]*min-width:/.test(CSS),
    "senza una larghezza minima il campo si schiaccia a zero su schermi stretti");
  assert.ok(!/\.pratiche__barra\s*\{[^}]*overflow-x/.test(CSS),
    "niente scorrimento orizzontale: è il difetto che il cliente ha già segnalato");
});

module.exports = casi;
