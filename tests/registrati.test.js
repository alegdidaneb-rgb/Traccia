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
   "reg-amount", "reg-tipo",
   /* la via veloce: un campo e un pulsante, sopra il modulo completo */
   "telefono-form", "rapido-phone"].forEach((id) => { nodi[id] = fatto(id); });
  /* la frase «Non hai ancora un account?» sotto il pulsante di accesso */
  nodi["auth-no-account"] = fatto("auth-no-account", { hidden: true });
  nodi["auth-no-account"].closest = null;
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
      /* `auth.js` cerca `[data-completo]` per il link «scrivi i dettagli»:
         il DOM finto restituisce il modulo completo, come il browser */
      querySelector: (sel) => (sel === "[data-completo]" ? nodi["register-form"] : null),
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
  /* sulla scheda della segnalazione si vede la via veloce — un campo — e non
     il modulo completo, che sta dietro il link «Preferisco scrivere i
     dettagli». Fino al 2026-11-08 questo test cercava `register-form`
     visibile: era vero quando il modulo completo era l'unica porta. */
  assert.strictEqual(nodi["telefono-form"].hidden, false,
    "il modulo veloce non è visibile sulla scheda della segnalazione");
  assert.strictEqual(nodi["register-form"].hidden, true,
    "il modulo completo si apre da solo: la via veloce non serve a niente");
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
  /* e il modulo veloce non deve comparire qui: chi deve entrare nel suo conto
     non deve trovare «Il tuo numero di telefono» (visto il 2026-11-08) */
  assert.strictEqual(nodi["telefono-form"].hidden, true,
    "il modulo veloce compare anche sulla scheda dell'accesso");
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
  assert.strictEqual(nodi["telefono-form"].hidden, false,
    "tornando su #registrati deve riapparire il modulo veloce");
  assert.equal(schede.filter((s) => s.getAttribute("aria-selected") === "true").length, 1);
});

test("premendo la scheda «Segnala un caso» l'indirizzo resta condivisibile", () => {
  const { nodi, schede, sandbox } = pagina("");
  const scheda = schede.find((s) => s.getAttribute("data-auth-tab") === "register");
  scheda._ev.click({ preventDefault() {} });
  assert.strictEqual(nodi["telefono-form"].hidden, false);
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

test("chi non ha un account lo scopre sotto il pulsante di accesso", () => {
  /* Il difetto riferito dal cliente: «non ci sono i campi da compilare».
     I campi c'erano; mancava il modo di arrivarci da chi apre `login.html`
     senza credenziali, perché l'unico link stava in fondo alla scheda. */
  assert.match(LOGIN, /id="auth-no-account"/, "manca la frase per chi non ha un account");
  assert.match(LOGIN, /data-go-register/, "manca il pulsante che apre la segnalazione");

  const { nodi, schede } = pagina("");
  assert.strictEqual(nodi["auth-no-account"].hidden, false,
    "la frase per chi non ha un account resta nascosta");
  const scheda = schede.find((s) => s.getAttribute("data-auth-tab") === "register");
  scheda._ev.click({ preventDefault() {} });
  assert.strictEqual(nodi["telefono-form"].hidden, false,
    "premendo «Segnala un caso» non si apre il modulo veloce");
  assert.strictEqual(nodi["auth-no-account"].hidden, true,
    "sulla scheda della segnalazione la frase resta in vista");
});

test("«Segnala un caso» ha un'ancora vera, non solo una parola letta dallo script", () => {
  assert.match(LOGIN, /id="registrati"/,
    "manca l'ancora #registrati: senza, il pulsante dipende da auth.js");
});

test("il modulo non sparisce quando lo script non arriva", () => {
  /* il guasto vero: un `auth.js` vecchio in cache non apriva la scheda, e la
     pagina restava sul campo password. Senza JavaScript ora c'è un avviso con
     il numero WhatsApp invece di una pagina che sembra rotta. */
  assert.match(LOGIN, /<noscript>[\s\S]*auth-noscript[\s\S]*<\/noscript>/,
    "manca l'avviso per chi non esegue JavaScript");
  ["en", "de", "es"].forEach((l) => {
    assert.match(R(`${l}/login.html`), /auth-noscript/, `${l}: manca l'avviso senza JavaScript`);
  });
});

test("i cinque campi richiesti ci sono, e sono obbligatori, in tutte le lingue", () => {
  /* I campi che il cliente ha chiesto per nome: nome, cognome, email, telefono,
     importo perso e tipo di truffa. Obbligatori anche nell'HTML, perché chi usa
     un browser che non esegue il nostro script deve essere fermato prima di
     premere invio con i campi vuoti. */
  ["", "en/", "de/", "es/"].forEach((cartella) => {
    const html = R(cartella + "login.html");
    ["reg-first-name", "reg-last-name", "reg-email", "reg-phone",
     "reg-amount", "reg-tipo"].forEach((id) => {
      assert.ok(html.includes(`id="${id}"`),
        `${cartella || "it/"}login.html: manca il campo «${id}»`);
    });
    ["reg-first-name", "reg-last-name", "reg-email", "reg-phone", "reg-amount"]
      .forEach((id) => {
        const inizio = html.indexOf(`id="${id}"`);
        const tag = html.slice(inizio, html.indexOf(">", inizio) + 1);
        assert.match(tag, /required/, `${cartella || "it/"}: «${id}» non è obbligatorio`);
      });
  });
  /* e la funzione che il modulo chiama deve esistere davvero: il pezzo che
     nessuno guardava mentre il cliente compilava e non arrivava niente */
  assert.match(R("assets/js/api.js"), /rpc\("auth_register"/, "api.js non chiama auth_register");
});

module.exports = casi;
