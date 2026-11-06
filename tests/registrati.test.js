/* ==========================================================================
   «Segnala un caso» apre il modulo, non un accesso
   ==========================================================================
   Tre difetti veri, tutti visti da un cliente e non da un test:

   1. il pulsante «Segnala un caso» portava a una pagina con il campo
      password. Chi ha appena perso dei soldi non deve creare un account, e
      quel campo gli diceva il contrario;
   2. il link `#registrati` cambiava la pagina solo se premuto da lì: chi
      arrivava da un'altra pagina trovava l'accesso, perché nessuno rileggeva
      l'indirizzo al caricamento;
   3. il modulo viveva sotto una frase in fondo alla scheda, e la scheda non
      diceva in nessun punto visibile che esistevano due strade.

   Questi test caricano `assets/js/auth.js` in un DOM finto — non in un
   browser vero: qui interessa la logica dei pannelli e dell'indirizzo, non il
   disegno della pagina.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const LOGIN = R("login.html");
const AUTH = R("assets/js/auth.js");

/* Un DOM finto quanto basta: gli elementi per id, le schede, `hidden`, il
   fuoco. `closest` serve perché `ui.js` non c'è e auth.js non lo usa. */
function pagina(frammento) {
  const nodi = {};
  const schede = [];
  const fatto = (id, extra) => {
    const el = Object.assign(
      {
        id,
        hidden: false,
        value: "",
        textContent: "",
        style: {},
        dataset: {},
        setAttribute(n, v) { this[n] = v; },
        getAttribute(n) { return this[n] === undefined ? null : this[n]; },
        removeAttribute(n) { delete this[n]; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(tipo, fn) { (this._ev || (this._ev = {}))[tipo] = fn; },
        focus() { this._fuoco = true; },
        reset() {}
      },
      extra || {}
    );
    return el;
  };
  ["login-form", "register-form", "auth-title", "auth-subtitle", "email",
   "password", "reg-first-name", "reg-last-name", "reg-email", "reg-phone",
   "reg-amount", "reg-tipo"].forEach((id) => { nodi[id] = fatto(id); });
  nodi["login-form"].querySelector = () => null;
  nodi["register-form"].querySelector = () => null;
  ["login", "register"].forEach((modo) => {
    const scheda = fatto("tab-" + modo, { "data-auth-tab": modo });
    scheda.setAttribute("aria-selected", modo === "login" ? "true" : "false");
    schede.push(scheda);
  });

  const indirizzo = frammento || "";
  const eventi = {};
  /* `window.history` e `history` sono lo stesso oggetto, come nel browser:
     `auth.js` scrive l'indirizzo dal primo e il test lo legge dal secondo. */
  const cronologia = {
    replaceState(_a, _b, url) {
      sandbox.location.hash =
        url.indexOf("#") > -1 ? url.slice(url.indexOf("#")) : "";
    }
  };
  const sandbox = {
    window: {
      location: { replace() {}, href: "", hash: indirizzo, pathname: "/login.html" },
      history: cronologia,
      addEventListener(tipo, fn) { eventi[tipo] = fn; },
      matchMedia: () => ({ matches: false })
    },
    document: {
      getElementById: (id) => nodi[id] || null,
      querySelectorAll: (sel) => (sel === "[data-auth-tab]" ? schede : []),
      addEventListener() {}
    },
    location: { search: "", hash: indirizzo, pathname: "/login.html" },
    URLSearchParams,
    history: cronologia,
    api: {
      token: () => "",
      login: () => Promise.resolve({ user: {} }),
      me: () => Promise.resolve({ user: {} }),
      register: () => Promise.resolve({})
    },
    console,
    Promise
  };
  vm.runInNewContext(AUTH, sandbox);
  return { nodi, schede, eventi, sandbox };
}

/* ------------------------------------------------------------ il markup -- */
test("login: ci sono due schede, e dicono cosa fanno", () => {
  assert.match(LOGIN, /class="auth-tabs"[^>]*role="tablist"/,
    "manca la barra delle schede in cima alla scheda");
  const schede = LOGIN.match(/data-auth-tab="([a-z]+)"/g) || [];
  assert.deepEqual(schede.sort(),
    ['data-auth-tab="login"', 'data-auth-tab="register"'],
    "le schede devono essere due: accesso e segnalazione");
  assert.match(LOGIN, /href="#registrati"/,
    "manca il link che apre la scheda della segnalazione");
});

test("login: nella scheda della segnalazione non si crea una password", () => {
  /* la richiesta di un caso non crea un account: l'account lo apre un
     analista, e la password si sceglie allora (o mai). */
  const modulo = LOGIN.slice(LOGIN.indexOf('id="register-form"'), LOGIN.indexOf("</form>", LOGIN.indexOf('id="register-form"')));
  assert.ok(!/type="password"/.test(modulo),
    "il modulo di segnalazione ha ancora un campo password");
  assert.ok(!/name="password"/.test(modulo),
    "il modulo di segnalazione manda ancora una password al server");
  assert.ok(/non serve una\s+password|non serve<\/strong> una/.test(LOGIN) || /<strong>non serve una\s+password/.test(LOGIN),
    "la pagina deve dire che non serve una password");
});

test("login: il modulo di segnalazione è nascosto all'arrivo", () => {
  assert.match(LOGIN, /id="login-form"(?![^>]*hidden)/,
    "il modulo di accesso deve essere visibile");
  assert.match(LOGIN, /id="register-form"[^>]*hidden/,
    "il modulo di segnalazione deve partire nascosto");
});

/* ------------------------------------------------------- l'indirizzo -- */
test("#registrati apre la scheda della segnalazione, non quella dell'accesso", () => {
  const { nodi, schede } = pagina("#registrati");
  assert.strictEqual(nodi["register-form"].hidden, false,
    "il modulo di segnalazione è rimasto nascosto");
  assert.strictEqual(nodi["login-form"].hidden, true,
    "il campo password è ancora in vista");
  const accesa = schede.filter((s) => s.getAttribute("aria-selected") === "true");
  assert.equal(accesa.length, 1, "deve essere accesa una sola scheda");
  assert.equal(accesa[0].getAttribute("data-auth-tab"), "register",
    "è accesa la scheda sbagliata");
  assert.equal(nodi["auth-title"].textContent, "Segnala il tuo caso",
    "il titolo della scheda non segue il pannello");
});

test("senza #registrati si arriva sull'accesso", () => {
  const { nodi, schede } = pagina("");
  assert.strictEqual(nodi["login-form"].hidden, false);
  assert.strictEqual(nodi["register-form"].hidden, true);
  assert.equal(schede.find((s) => s.getAttribute("aria-selected") === "true")
    .getAttribute("data-auth-tab"), "login");
});

test("il tasto indietro riporta alla scheda giusta", () => {
  /* il difetto: si arriva su #registrati, si preme «Accedi», si preme indietro
     e la pagina resta sull'accesso perché l'indirizzo non viene riletto. */
  const { nodi, eventi, sandbox, schede } = pagina("#registrati");
  assert.ok(eventi.hashchange, "manca l'ascolto di hashchange");
  sandbox.location.hash = "";
  eventi.hashchange();
  assert.strictEqual(nodi["login-form"].hidden, false,
    "tornando indietro il modulo di accesso deve tornare visibile");
  assert.strictEqual(nodi["register-form"].hidden, true);
  sandbox.location.hash = "#registrati";
  eventi.hashchange();
  assert.strictEqual(nodi["register-form"].hidden, false);
  assert.equal(schede.filter((s) => s.getAttribute("aria-selected") === "true").length, 1);
});

test("premendo la scheda «Segnala un caso» l'indirizzo resta condivisibile", () => {
  const { nodi, schede, sandbox } = pagina("");
  const scheda = schede.find((s) => s.getAttribute("data-auth-tab") === "register");
  scheda._ev.click({ preventDefault() {} });
  assert.strictEqual(nodi["register-form"].hidden, false);
  assert.strictEqual(sandbox.location.hash, "#registrati",
    "l'indirizzo non dice più che si è sulla segnalazione");
});

test("una sola funzione decide quale pannello si vede", () => {
  /* se il titolo, i moduli e le schede si muovono ognuno per conto suo,
     basta un ramo dimenticato per mostrare la password sopra la segnalazione */
  const definizioni = AUTH.match(/function setMode/g) || [];
  assert.equal(definizioni.length, 1, "`setMode` deve essere una sola");
  const assegnazioni = AUTH.match(/registerForm\.hidden|loginForm\.hidden/g) || [];
  assert.ok(assegnazioni.length <= 3,
    "lo stato dei pannelli viene cambiato in troppi punti");
});

module.exports = casi;
