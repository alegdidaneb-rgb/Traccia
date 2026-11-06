/* ==========================================================================
   La richiesta di informazioni: cinque dati, e non uno di meno
   ==========================================================================
   Cosa è cambiato e perché va provato eseguendo il codice, non leggendolo.

   Il modulo chiedeva nome e cognome in un campo solo, email e password. Non
   chiedeva un telefono e non chiedeva quanto era andato perso: due domande che
   altrimenti l'analista fa nella prima telefonata, cioè dopo che il cliente ha
   già scritto tutto quello che sapeva. Qui si prova che i cinque dati
   (nome, cognome, email, telefono, importo) viaggiano davvero, e che quando ne
   manca uno il modulo si ferma **su quel campo** invece di mandare al server
   una richiesta che il server rifiuterà con un messaggio generico.

   I test eseguono `assets/js/auth.js` in un DOM finto, perché gli errori che
   contano qui non si vedono nel sorgente: un campo segnalato che non è quello
   sbagliato, un valore che sparisce dopo l'errore, un `return` mancante che
   lascia partire la chiamata comunque.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const AUTH = fs.readFileSync(path.join(RADICE, "assets/js/auth.js"), "utf8");
const MAIN = fs.readFileSync(path.join(RADICE, "assets/js/main.js"), "utf8");
const LOGIN = fs.readFileSync(path.join(RADICE, "login.html"), "utf8");
const SUPPORTO = fs.readFileSync(path.join(RADICE, "supporto.html"), "utf8");
const MIGRAZIONE = fs.readFileSync(
  path.join(RADICE, "supabase/migrations/0023_richiesta_informazioni.sql"), "utf8");

/* ---------------------------------------------------------------- DOM finto --
   Il minimo che `auth.js` usa davvero: `getElementById`, `querySelector`,
   `querySelectorAll` con due selettori di attributo, `createElement`,
   `appendChild`, `remove`. Niente parser HTML: i nodi si costruiscono a mano,
   così un test che parla del campo telefono non dipende da come è scritto il
   resto della pagina. */
function campo(id, valore) {
  return {
    id,
    value: valore === undefined ? "" : valore,
    attributi: {},
    figli: [],
    parentElement: null,
    dataset: {},
    hidden: false,
    className: "",
    textContent: "",
    getAttribute(k) { return k in this.attributi ? this.attributi[k] : null; },
    setAttribute(k, v) { this.attributi[k] = String(v); },
    removeAttribute(k) { delete this.attributi[k]; },
    appendChild(c) { this.figli.push(c); c.parentElement = this; return c; },
    remove() {
      if (!this.parentElement) return;
      const i = this.parentElement.figli.indexOf(this);
      if (i > -1) this.parentElement.figli.splice(i, 1);
    },
    focus() { this.focalizzato = true; },
    reset() {},
    /* `auth.js` cerca l'avviso già presente dentro il contenitore del campo */
    querySelector(sel) {
      const attr = String(sel).replace(/[[\]]/g, "");
      return trova(this, attr)[0] || null;
    }
  };
}

/* `[attr]` e nient'altro: sono i due soli selettori che il modulo usa. */
function trova(radice, attributo, risultato) {
  risultato = risultato || [];
  (radice.figli || []).forEach((n) => {
    if (n.attributi && attributo in n.attributi) risultato.push(n);
    trova(n, attributo, risultato);
  });
  return risultato;
}

function moduloLogin(valori) {
  /* i sei campi della richiesta, ciascuno dentro il suo `.field` */
  const nomi = ["reg-first-name", "reg-last-name", "reg-email",
                "reg-phone", "reg-amount", "reg-password"];
  const perId = {};
  const contenitori = nomi.map((id) => {
    const c = campo("field-" + id);
    perId[id] = c.appendChild(campo(id, valori[id]));
    return c;
  });

  const registerForm = campo("register-form");
  registerForm.hidden = true;
  contenitori.forEach((c) => registerForm.appendChild(c));
  registerForm.querySelector = () => null;
  registerForm.querySelectorAll = (sel) => {
    const attr = String(sel).replace(/[[\]]/g, "").replace('=""', "");
    return trova(registerForm, attr);
  };
  registerForm.addEventListener = function (evento, fn) {
    this.eventi = this.eventi || {};
    (this.eventi[evento] = this.eventi[evento] || []).push(fn);
  };
  registerForm.invia = function () {
    (this.eventi.submit || []).forEach((fn) => fn({ preventDefault() {} }));
  };

  const loginError = campo("register-error");
  loginError.hidden = true;

  const loginForm = campo("login-form");
  loginForm.hidden = false;
  loginForm.querySelector = (sel) =>
    sel === "[data-form-error]" ? loginError : null;
  loginForm.addEventListener = () => {};

  const titolo = campo("auth-title");
  const sottotitolo = campo("auth-subtitle");

  const document = {
    getElementById(id) {
      if (id in perId) return perId[id];
      if (id === "login-form") return loginForm;
      if (id === "register-form") return registerForm;
      if (id === "auth-title") return titolo;
      if (id === "auth-subtitle") return sottotitolo;
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => campo("<" + tag + ">")
  };

  const window = { location: { href: "", replace() {} } };
  const location = { search: "" };

  const chiamate = [];
  const api = {
    token: () => "",
    login: () => Promise.resolve({ user: {} }),
    register: (payload) => {
      chiamate.push(payload);
      return Promise.resolve({ ok: true, message: "Richiesta inviata." });
    },
    me: () => Promise.resolve({ user: {} })
  };

  new Function("document", "window", "location", "api", "URLSearchParams", AUTH)(
    document, window, location, api, URLSearchParams
  );

  return { registerForm, perId, chiamate, errore: loginError };
}

function pieni(extra) {
  return Object.assign({
    "reg-first-name": "Mario",
    "reg-last-name": "Rossi",
    "reg-email": "mario.rossi@example.it",
    "reg-phone": "+39 333 123 4567",
    "reg-amount": "12.500",
    "reg-password": "Password!2026"
  }, extra || {});
}

const fermo = (r) => new Promise((ok) => setImmediate(ok));

/* ------------------------------------------------- i cinque dati richiesti -- */

test("richiesta: i cinque dati del committente sono tutti nel modulo", () => {
  const attesi = [
    ['id="reg-first-name"', /name="first_name"/],
    ['id="reg-last-name"', /name="last_name"/],
    ['id="reg-email"', /name="email"/],
    ['id="reg-phone"', /name="phone"/],
    ['id="reg-amount"', /name="amount_eur"/]
  ];
  attesi.forEach(([marchio, attributo]) => {
    const i = LOGIN.indexOf(marchio);
    assert.ok(i > -1, "manca il campo " + marchio);
    const blocco = LOGIN.slice(i, LOGIN.indexOf(">", i) + 1);
    assert.ok(attributo.test(blocco), marchio + " deve chiamarsi " + attributo);
    assert.ok(/required/.test(blocco), marchio + " deve essere obbligatorio");
  });
  assert.ok(/id="reg-phone"[^>]*type="tel"/.test(LOGIN.replace(/\s+/g, " ")),
    "il telefono deve essere type=tel: la tastiera del telefono diventa numerica");
  assert.ok(/autocomplete="given-name"/.test(LOGIN) &&
            /autocomplete="family-name"/.test(LOGIN),
            "nome e cognome separati: il browser li riempie da soli");
});

test("richiesta: senza telefono il modulo si ferma sul telefono", async () => {
  const m = moduloLogin(pieni({ "reg-phone": "" }));
  m.registerForm.invia();
  await fermo();

  assert.deepStrictEqual(m.chiamate, [],
    "una richiesta senza telefono non deve partire: il server la rifiuterebbe dopo");
  const telefono = m.perId["reg-phone"];
  assert.strictEqual(telefono.getAttribute("aria-invalid"), "true",
    "il campo da correggere è il telefono, e va dichiarato tale");
  const avviso = telefono.parentElement.figli.find((n) => "data-field-error" in n.attributi);
  assert.ok(avviso && /telefono/i.test(avviso.textContent),
    "accanto al campo deve esserci una frase che dice cosa manca");
});

test("richiesta: senza importo il modulo si ferma sull'importo", async () => {
  const m = moduloLogin(pieni({ "reg-amount": "" }));
  m.registerForm.invia();
  await fermo();

  assert.deepStrictEqual(m.chiamate, []);
  assert.strictEqual(m.perId["reg-amount"].getAttribute("aria-invalid"), "true");
  const avviso = m.perId["reg-amount"].parentElement.figli
    .find((n) => "data-field-error" in n.attributi);
  assert.ok(avviso && /importo/i.test(avviso.textContent), "l'avviso deve nominare l'importo");
});

test("richiesta: un telefono che non è un telefono non arriva al server", async () => {
  const m = moduloLogin(pieni({ "reg-phone": "12345" }));
  m.registerForm.invia();
  await fermo();
  assert.deepStrictEqual(m.chiamate, [], "cinque cifre non sono un numero raggiungibile");
  assert.strictEqual(m.perId["reg-phone"].getAttribute("aria-invalid"), "true");
});

test("richiesta: un solo campo sbagliato ferma tutto, gli altri non vengono segnalati", async () => {
  /* Un modulo che colora di rosso sei campi perché ne manca uno è un modulo
     che accusa. Si segnala solo quello che va corretto. */
  const m = moduloLogin(pieni({ "reg-email": "mario.rossi" }));
  m.registerForm.invia();
  await fermo();
  assert.deepStrictEqual(m.chiamate, []);
  const segnalati = Object.keys(m.perId)
    .filter((id) => m.perId[id].getAttribute("aria-invalid") === "true");
  assert.deepStrictEqual(segnalati, ["reg-email"], "segnalato: " + segnalati.join(", "));
});

test("richiesta: l'errore non cancella quello che la persona ha già scritto", async () => {
  const m = moduloLogin(pieni({ "reg-phone": "" }));
  m.registerForm.invia();
  await fermo();
  assert.strictEqual(m.perId["reg-first-name"].value, "Mario");
  assert.strictEqual(m.perId["reg-email"].value, "mario.rossi@example.it");
  assert.strictEqual(m.perId["reg-amount"].value, "12.500",
    "l'importo scritto deve restare: riscriverlo è il motivo per cui si abbandona un modulo");
});

test("richiesta: correggere il campo toglie l'errore, non lo lascia lì", async () => {
  const m = moduloLogin(pieni({ "reg-phone": "" }));
  m.registerForm.invia();
  await fermo();
  assert.strictEqual(m.perId["reg-phone"].getAttribute("aria-invalid"), "true");

  m.perId["reg-phone"].value = "+39 333 123 4567";
  m.registerForm.invia();
  await fermo();
  assert.strictEqual(m.perId["reg-phone"].getAttribute("aria-invalid"), null,
    "un errore che resta dopo la correzione dice che il modulo è ancora sbagliato");
  assert.strictEqual(m.chiamate.length, 1, "la seconda volta la richiesta deve partire");
});

test("richiesta: i cinque dati partono nel payload, con il nome anche intero", async () => {
  const m = moduloLogin(pieni());
  m.registerForm.invia();
  await fermo();

  assert.strictEqual(m.chiamate.length, 1, "una richiesta completa deve partire una volta sola");
  const p = m.chiamate[0];
  assert.strictEqual(p.first_name, "Mario");
  assert.strictEqual(p.last_name, "Rossi");
  assert.strictEqual(p.name, "Mario Rossi",
    "`name` resta la forma completa che l'area riservata mostra");
  assert.strictEqual(p.email, "mario.rossi@example.it");
  assert.strictEqual(p.phone, "+39 333 123 4567");
  assert.strictEqual(p.amount_eur, 12500,
    "«12.500» sono dodicimilacinquemila euro, non dodici euro e mezzo");
  assert.strictEqual(p.password, "Password!2026");
});

/* ------------------------------------------------------- lettura dell'importo -- */

test("importo: si legge come lo scrivono le persone, non come lo scrive un programma", async () => {
  const casiImporto = [
    ["12.500", 12500],
    ["12.500,00", 12500],
    ["12500", 12500],
    ["1.234.567", 1234567],
    ["12,5", 12.5],
    ["€ 3.000", 3000],
    ["8 500", 8500]
  ];
  for (const [scritto, atteso] of casiImporto) {
    const x = moduloLogin(pieni({ "reg-amount": scritto }));
    x.registerForm.invia();
    await fermo();
    assert.strictEqual(x.chiamate.length, 1, "«" + scritto + "» deve essere accettato");
    assert.strictEqual(x.chiamate[0].amount_eur, atteso,
      "«" + scritto + "» vale " + atteso + ", non " + x.chiamate[0].amount_eur);
  }
});

test("importo: zero, negativo e testo libero non sono un importo", async () => {
  for (const scritto of ["", "0", "-500", "tanto", "circa diecimila"]) {
    const m = moduloLogin(pieni({ "reg-amount": scritto }));
    m.registerForm.invia();
    await fermo();
    assert.deepStrictEqual(m.chiamate, [],
      "«" + scritto + "» non è un importo e non deve partire");
    assert.strictEqual(m.perId["reg-amount"].getAttribute("aria-invalid"), "true");
  }
});

/* ------------------------------------------------- il database, non solo il browser --
   I controlli nel browser si aggirano: la funzione si chiama direttamente.
   Questi test leggono la migrazione per accertarsi che le stesse regole stiano
   anche lì, perché è lì che un dato falso entra davvero nel database. */

test("database: la registrazione pretende telefono e importo, non li accetta vuoti", () => {
  const i = MIGRAZIONE.indexOf("create or replace function traccia.auth_register");
  assert.ok(i > -1, "manca auth_register nella migrazione");
  const corpo = MIGRAZIONE.slice(i, MIGRAZIONE.indexOf("end $$;", i));

  assert.ok(/p_phone text default null/.test(corpo), "telefono fra i parametri");
  assert.ok(/p_amount_eur numeric default null/.test(corpo), "importo fra i parametri");
  assert.ok(/if tel is null/.test(corpo) && /Inserisci un numero di telefono/.test(corpo),
    "il telefono vuoto deve fermare la registrazione");
  assert.ok(/traccia\.telefono_valido\(tel\)/.test(corpo),
    "la forma del telefono si controlla nel database, non solo nella pagina");
  assert.ok(/p_amount_eur is null or p_amount_eur <= 0/.test(corpo),
    "un importo assente o nullo non è una richiesta di informazioni");
  assert.ok(/first_name, last_name, phone/.test(corpo) && /nome, cognome, tel/.test(corpo),
    "nome, cognome, telefono e importo finiscono nella riga dell'utente");
});

test("database: la migrazione toglie la vecchia funzione a tre parametri", () => {
  /* Due funzioni con lo stesso nome e firme diverse fanno scegliere a
     PostgREST quella sbagliata, e il guasto si vede solo in produzione. */
  assert.ok(/drop function if exists traccia\.auth_register\(text, text, text\)/.test(MIGRAZIONE),
    "va tolta la versione a tre parametri nello schema traccia");
  assert.ok(/drop function if exists public\.auth_register\(text, text, text\)/.test(MIGRAZIONE),
    "e quella nello schema public, altrimenti il browser continua a chiamare la vecchia");
});

test("database: il telefono è valido solo se è raggiungibile", () => {
  const i = MIGRAZIONE.indexOf("function traccia.telefono_valido");
  assert.ok(i > -1, "manca telefono_valido");
  const corpo = MIGRAZIONE.slice(i, MIGRAZIONE.indexOf("$$;", i));
  assert.ok(/between 8 and 15/.test(corpo),
    "otto cifre minime e quindici massime: fuori da lì non è un numero");
  assert.ok(/is null/.test(corpo),
    "il telefono facoltativo di un account creato a mano non deve rompere la funzione");
});

test("database: anche il modulo di contatto pretende i cinque dati", () => {
  const i = MIGRAZIONE.indexOf("create or replace function traccia.contact_send");
  assert.ok(i > -1, "il modulo di contatto deve seguire la stessa regola della registrazione");
  const corpo = MIGRAZIONE.slice(i, MIGRAZIONE.indexOf("end $$;", i));
  assert.ok(/if tel is null/.test(corpo), "telefono obbligatorio anche qui");
  assert.ok(/p_amount_eur is null or p_amount_eur <= 0/.test(corpo), "e importo obbligatorio");
});

test("database: la console analisti riceve telefono, nome, cognome e importo", () => {
  const i = MIGRAZIONE.indexOf("create or replace function traccia.admin_accounts");
  assert.ok(i > -1, "admin_accounts deve essere riscritta per portare i campi nuovi");
  const corpo = MIGRAZIONE.slice(i, MIGRAZIONE.indexOf("end $$;", i));
  ["'phone', u.phone", "'first_name', u.first_name",
   "'last_name', u.last_name", "'case_amount_eur', u.case_amount_eur"].forEach((riga) => {
    assert.ok(corpo.indexOf(riga) > -1, "manca " + riga + " nel payload della console");
  });
  /* il resto del corpo va conservato: è il difetto che questa migrazione ha
     già rischiato di introdurre (date come timestamptz, campi spariti) */
  ["'iban_formatted'", "'case_ref'", "'documents_count'",
   "extract(epoch from u.created_at)"].forEach((riga) => {
    assert.ok(corpo.indexOf(riga) > -1, "admin_accounts ha perso " + riga);
  });
});

/* --------------------------------------------- il modulo di contatto della pagina --
   `supporto.html` ha un secondo modulo, gestito da `main.js`. Chiede le stesse
   cose: se le due copie divergono, il cliente riceve due questionari diversi
   dallo stesso studio. */

test("supporto: il modulo chiede nome, cognome, email, telefono e importo", () => {
  [["nome", "Nome"], ["cognome", "Cognome"], ["email", "Email"],
   ["telefono", "Telefono"], ["importo", "Importo"]].forEach(([id, parola]) => {
    assert.ok(new RegExp('id="' + id + '"').test(SUPPORTO), "manca il campo " + id);
    assert.ok(new RegExp('for="' + id + '">' + parola).test(SUPPORTO),
      "l'etichetta di " + id + " deve dire «" + parola +
      "»: un campo senza etichetta chiara si salta");
  });
  assert.ok(/id="telefono"[^>]*type="tel"/.test(SUPPORTO.replace(/\s+/g, " ")));
});

test("supporto: il modulo non si dichiara più finto mentre invia davvero", () => {
  /* La frase «questo modulo è dimostrativo e non invia dati a un server» era
     rimasta dal prototipo, ma `main.js` chiama `contact_send`: chi scriveva
     poteva credere di aver scritto a nessuno. */
  assert.ok(!/dimostrativo e non invia/i.test(SUPPORTO),
    "la pagina non deve dire che il modulo non invia, perché invia");
  assert.ok(/data-form-status/.test(SUPPORTO),
    "serve il posto dove compare la conferma (role=status) dopo l'invio");
  assert.ok(/api\.contact\(/.test(MAIN), "il modulo di contatto deve chiamare contact_send");
});

test("supporto: le regole del telefono sono le stesse della registrazione", () => {
  /* Due espressioni scritte due volte divergono: è solo questione di tempo.
     Qui si confrontano i due file, così chi cambia una regola si accorge
     dell'altra. */
  const estrai = (sorgente) => {
    const m = sorgente.match(/regolaTelefono = (\/[^\n]+\/);/);
    return m ? m[1] : null;
  };
  const inAuth = estrai(AUTH);
  const inMain = estrai(MAIN);
  assert.ok(inAuth, "auth.js deve dichiarare la regola del telefono");
  assert.strictEqual(inMain, inAuth,
    "le due pagine devono accettare lo stesso formato di numero: " +
    inAuth + " vs " + inMain);
  assert.ok(inAuth.indexOf("+") > -1, "il prefisso internazionale deve essere ammesso");
});

/* ------------------------------------------------------------ il cliente API --
   L'ultimo tratto: fra la pagina e il database c'è `api.register`, che traduce
   i nomi del modulo in quelli della funzione. Un errore qui — un parametro
   rinominato, uno dimenticato — non si vede: il server risponde «function not
   found» o, peggio, accetta un telefono nullo e la colonna resta vuota. */

function apiCon(payload) {
  const SRC = fs.readFileSync(path.join(RADICE, "assets/js/api.js"), "utf8");
  const chiamate = [];
  const sandbox = {
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] || null; },
      setItem(k, v) { this._v[k] = String(v); },
      removeItem(k) { delete this._v[k]; }
    },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch(url, opt) {
      chiamate.push({ url, opt });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(payload))
      });
    }
  };
  sandbox.window = sandbox;
  sandbox.TRACCIA_CONFIG = {
    supabaseUrl: "https://esempio.supabase.co",
    supabaseKey: "chiave-pubblica",
    schema: "public"
  };
  new Function("window", "fetch", "localStorage", SRC)(
    sandbox, sandbox.fetch, sandbox.localStorage
  );
  return { api: sandbox.api, chiamate };
}

test("api: la registrazione manda i sette parametri della funzione, non tre", async () => {
  const { api, chiamate } = apiCon({ ok: true, message: "Richiesta inviata." });
  await api.register({
    name: "Mario Rossi",
    first_name: "Mario",
    last_name: "Rossi",
    email: "mario.rossi@example.it",
    phone: "+39 333 123 4567",
    amount_eur: 12500,
    password: "Password!2026"
  });

  assert.strictEqual(chiamate.length, 1);
  const corpo = JSON.parse(chiamate[0].opt.body);
  ["p_name", "p_email", "p_password", "p_first_name",
   "p_last_name", "p_phone", "p_amount_eur"].forEach((k) => {
    assert.ok(k in corpo, "manca " + k + ": la funzione a sette parametri rifiuta la chiamata");
  });
  assert.strictEqual(corpo.p_first_name, "Mario");
  assert.strictEqual(corpo.p_last_name, "Rossi");
  assert.strictEqual(corpo.p_phone, "+39 333 123 4567");
  assert.strictEqual(corpo.p_amount_eur, 12500);
  assert.match(chiamate[0].url, /auth_register/);
});

test("api: un telefono vuoto arriva come null, non come stringa vuota", async () => {
  /* `telefono_valido('')` è falso, e il messaggio che ne esce parla di cifre
     sbagliate invece che di un campo mancante: la persona cerca l'errore nel
     posto sbagliato. Vuoto deve dire «vuoto». */
  const { api, chiamate } = apiCon({ ok: true });
  await api.register({
    name: "Mario Rossi", email: "m@example.it", password: "Password!2026",
    first_name: "Mario", last_name: "Rossi", phone: "", amount_eur: null
  });
  const corpo = JSON.parse(chiamate[0].opt.body);
  assert.strictEqual(corpo.p_phone, null);
  assert.strictEqual(corpo.p_amount_eur, null);
});

module.exports = casi;
