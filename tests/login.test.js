/* Tests for the login screen — run with: node tests/run.js
 *
 * Perché questi test: il freno ai tentativi vive nel database, ma il client
 * deve saperlo leggere. `auth_login` restituisce `{ok:false, error}` invece di
 * sollevare un'eccezione (un'eccezione annullerebbe la registrazione del
 * tentativo fallito, e il contatore non salirebbe mai), quindi `api.login()`
 * deve trasformare quel rifiuto in un errore per la pagina. Se qualcuno
 * rimette `.then(dati => setToken(dati.token))` senza guardare `ok`, il freno
 * diventa invisibile: l'utente vede un login che non fa nulla.
 *
 * Rete finta: `fetch` è sostituito, quindi i test girano offline.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/api.js"), "utf8");

/* Carica api.js come farebbe il browser e restituisce il modulo. */
function moduloCon(payload, opzioni) {
  opzioni = opzioni || {};
  const chiamate = [];
  const sandbox = {
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] || null; },
      setItem(k, v) { this._v[k] = String(v); },
      removeItem(k) { delete this._v[k]; }
    },
    console,
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    fetch: function (url, opt) {
      chiamate.push({ url, opt });
      if (opzioni.reteRotta) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        ok: opzioni.stato ? opzioni.stato < 400 : true,
        status: opzioni.stato || 200,
        text: function () { return Promise.resolve(JSON.stringify(payload)); }
      });
    }
  };
  sandbox.window = sandbox;
  sandbox.TRACCIA_CONFIG = {
    supabaseUrl: "https://esempio.supabase.co",
    supabaseKey: "chiave-pubblica",
    schema: "public"
  };
  /* `fetch` va passato come parametro: dentro il modulo è una variabile
     globale, non una proprietà di `window`, quindi va iniettata. */
  new Function("window", "fetch", "localStorage", SRC)(
    sandbox, sandbox.fetch, sandbox.localStorage
  );
  return { api: sandbox.api, chiamate };
}

/* --------------------------------------------------------------- test -- */

test("login: un rifiuto del server diventa un errore leggibile", async () => {
  const { api } = moduloCon({ ok: false, error: "Troppi tentativi di accesso. Riprova tra qualche minuto." });
  let errore = null;
  await api.login("tizio@example.it", "sbagliata").catch((e) => { errore = e; });
  assert.ok(errore, "un rifiuto {ok:false} deve produrre un errore, non passare in silenzio");
  assert.match(errore.message, /Troppi tentativi/);
});

test("login: nessun gettone quando il server dice di no", async () => {
  const { api } = moduloCon({ ok: false, error: "Email o password non corretti." });
  await api.login("tizio@example.it", "sbagliata").catch(() => {});
  assert.strictEqual(api.token(), "", "un accesso rifiutato non deve lasciare un gettone");
  assert.strictEqual(api.cachedUser(), null, "né un utente in cache");
});

test("login: se il server non manda il messaggio, ce n'è comunque uno", async () => {
  const { api } = moduloCon({ ok: false });
  let errore = null;
  await api.login("tizio@example.it", "x").catch((e) => { errore = e; });
  assert.ok(errore && errore.message.length > 5, "serve un messaggio in italiano anche senza testo dal server");
});

test("login: un accesso riuscito salva gettone e utente", async () => {
  const { api } = moduloCon({
    ok: true,
    token: "a".repeat(64),
    user: { id: "u1", name: "Luca", email: "luca@example.it", status: "active", kyc_level: 2 }
  });
  const dati = await api.login("luca@example.it", "Demo!2026");
  assert.strictEqual(dati.ok, true);
  assert.strictEqual(api.token(), "a".repeat(64));
  assert.strictEqual(api.cachedUser().name, "Luca");
});

test("logoutAll: dopo la chiusura non resta alcun gettone", async () => {
  const { api } = moduloCon({ ok: true, closed: 3 });
  api.setToken("b".repeat(64));
  await api.logoutAll();
  assert.strictEqual(api.token(), "", "dopo logoutAll il gettone locale va cancellato");
});

test("logoutAll: la revoca viene chiesta al server, non solo al browser", async () => {
  const { api, chiamate } = moduloCon({ ok: true, closed: 1 });
  api.setToken("c".repeat(64));
  await api.logoutAll();
  const ultima = chiamate[chiamate.length - 1];
  assert.match(ultima.url, /auth_logout_all/);
  assert.match(ultima.opt.body, /c{64}/);
  assert.doesNotMatch(ultima.opt.body, /c{64}.*c{64}/, "il gettone deve comparire una volta sola");
});

test("sessione scaduta: un 28000 arriva alla pagina come errore di accesso", async () => {
  const { api } = moduloCon(
    { code: "28000", message: "Sessione non valida o scaduta." },
    { stato: 400 }
  );
  let errore = null;
  await api.me().catch((e) => { errore = e; });
  assert.ok(errore, "una sessione revocata deve produrre un errore");
  assert.strictEqual(errore.code, "28000");
});

/* ---------------------------------------------------- gli account di prova -- */
/* La schermata di accesso pubblicava quattro indirizzi con la password in
   chiaro accanto, compreso l'account analista master. Chiunque aprisse il link
   aveva l'area riservata e la console degli analisti: nessun attacco, solo una
   pagina che le offriva. Non è una funzione da nascondere con il CSS: le
   credenziali non devono stare nel file. */
const LOGIN = fs.readFileSync(path.join(__dirname, "..", "login.html"), "utf8");
const AUTH = fs.readFileSync(path.join(__dirname, "..", "assets/js/auth.js"), "utf8");

test("login: nessun account di prova è pubblicato nella pagina", () => {
  assert.ok(!/data-demo=/.test(LOGIN), "login.html non deve contenere pulsanti data-demo");
  assert.ok(!/Account di prova/i.test(LOGIN), "login.html non deve annunciare account di prova");
  assert.ok(!/master@traccia\.it/.test(LOGIN), "l'account analista master non deve comparire nel login");
  assert.ok(!/Demo!2026|Master!2026|Ops!2026/.test(LOGIN), "nessuna password in chiaro nel login");
});

test("login: nessun codice riempie più il modulo da solo", () => {
  assert.ok(!/\[data-demo\]/.test(AUTH), "auth.js non deve cablare pulsanti demo");
  assert.ok(!/Demo!2026|Master!2026|Ops!2026/.test(AUTH), "auth.js non deve contenere password");
});

/* --------------------------------------------------- il repository è pubblico --
   Il difetto che questi test chiudono non è «una pagina espone le credenziali»:
   è che le credenziali avevano un posto dove stare. Il controllo precedente
   guardava solo `.html`, `assets/js` e `assets/css`, e per questo non ha visto
   né il README né l'archivio zip — che contenevano, in chiaro, le stesse
   password più quelle nuove appena create. Un test che elenca le cartelle da
   controllare è un test che dimentica quella aggiunta ieri: qui si guarda tutto
   ciò che git traccia. */
test("nessuna password in chiaro in nessun file versionato", () => {
  const { execSync } = require("child_process");
  const radice = path.join(__dirname, "..");
  const elenco = execSync("git ls-files -z", { cwd: radice, encoding: "buffer" })
    .toString("utf8").split("\0").filter(Boolean);

  /* le sequenze usate nelle prove e nei test, e la forma delle password
     provvisorie generate per gli account amministrativi */
  const sospette = [/Demo!2026/, /Master!2026/, /Ops!2026/,
                    /password_hash\s*=\s*extensions\.crypt\('(?!LA-PASSWORD)[^']{6,}'/];
  const saltate = /^tests\//;   /* i test citano le password per vietarle */

  const trovate = [];
  elenco.forEach(function (f) {
    if (saltate.test(f)) return;
    /* binari e immagini non si leggono come testo */
    if (/\.(png|jpe?g|webp|ico|woff2?|ttf|pdf|zip)$/i.test(f)) return;
    /* un file che git traccia ma che non è sul disco è una cancellazione non
       ancora registrata: non contiene password, e leggere un file assente
       faceva fallire questo test con un ENOENT che non c'entra niente */
    const percorso = path.join(radice, f);
    if (!fs.existsSync(percorso)) return;
    const testo = fs.readFileSync(percorso, "utf8");
    sospette.forEach(function (re) {
      if (re.test(testo)) trovate.push(f + " → " + re);
    });
  });
  assert.deepStrictEqual(trovate, [],
    "password in chiaro in file versionati: " + trovate.join(", "));
});

test("nessun archivio del sito è versionato", () => {
  const { execSync } = require("child_process");
  const zip = execSync("git ls-files", { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    .split("\n").filter((f) => /\.zip$/i.test(f));
  assert.deepStrictEqual(zip, [],
    "un archivio del sito nel repository è una copia del sito con le credenziali di allora: " + zip.join(", "));
});

test("la build non pubblica ciò che non è una pagina", () => {
  /* `.gitignore` non serve a Vercel, che pubblica la cartella: serve un
     `.vercelignore`. Senza, `NOTE.md` o un archivio finiscono online insieme al
     sito, e nessuno se ne accorge perché nessuna pagina li linka. */
  const v = fs.readFileSync(path.join(__dirname, "..", ".vercelignore"), "utf8");
  ["*.zip", "README-DEPLOY.md", "tests/", "supabase/"].forEach(function (regola) {
    assert.ok(v.indexOf(regola) > -1, ".vercelignore non esclude " + regola);
  });
});

/* la stessa regola per tutto ciò che il browser scarica: una password scritta
   in un file statico è pubblica, anche se nessuno la linka */
test("nessun file servito al browser contiene le password degli account", () => {
  const sospetti = ["Demo!2026", "Master!2026", "Ops!2026"];
  const cartelle = ["assets/js", "assets/css"];
  const file = [".html"];
  let controllati = 0;
  fs.readdirSync(path.join(__dirname, "..")).filter(function (f) {
    return /\.html$/.test(f);
  }).forEach(function (f) {
    const testo = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    sospetti.forEach(function (p) {
      assert.ok(testo.indexOf(p) === -1, f + " contiene la password " + p);
    });
    controllati++;
  });
  cartelle.forEach(function (dir) {
    fs.readdirSync(path.join(__dirname, "..", dir)).forEach(function (f) {
      if (!/\.(js|css)$/.test(f)) return;
      if (/^config\.js$/.test(f)) return;
      const testo = fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");
      sospetti.forEach(function (p) {
        assert.ok(testo.indexOf(p) === -1, dir + "/" + f + " contiene la password " + p);
      });
      controllati++;
    });
  });
  assert.ok(file.length > 0 && controllati > 10, "controllati solo " + controllati + " file");
});

/* ------------------------------------------------- giro di accesso rotto -- */
/* Tre difetti veri, trovati il 2026-11-17 da una segnalazione sola: «quando
   accede dice che questa pagina non esiste». Non erano tre casi diversi, era
   un giro: accesso riuscito, dati rifiutati, ritorno al login, ritorno
   all'area, e alla fine il cliente davanti a un 404.
   Questi test non provano che il giro funzioni — quello si vede solo in un
   browser. Provano che le tre cose che lo rendevano senza uscita non possano
   tornare in silenzio. */
/* `AUTH` è già letto più sopra in questo file: si riusa, non si ridichiara. */
const CASE = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");
const PAGINA404 = fs.readFileSync(path.join(__dirname, "..", "404.html"), "utf8");

test("l'accesso riuscito non porta a una pagina che non è nell'elenco", () => {
  /* `next` arriva dall'indirizzo: senza un elenco, un vecchio link o un
     errore di battitura portavano il cliente appena entrato dritto sul 404.
     Sono due pagine, e sono le uniche due. */
  assert.match(AUTH, /var DESTINAZIONI = \["app\.html", "admin\.html"\]/,
    "l'elenco delle destinazioni permesse è sparito da auth.js");
  assert.match(AUTH, /function destinazioneValida/,
    "manca il controllo su `next`: qualunque indirizzo passa");
  assert.ok(!/function destination\(user\) \{\s*if \(next\) return next;/.test(AUTH),
    "`destination` è tornata a restituire `next` senza controllarlo");
});

test("il modulo di accesso non ricarica la pagina: il freno c'è sempre", () => {
  /* Senza `action`, un `<form>` invia a sé stesso: se `auth.js` non è ancora
     arrivato, premere «Accedi» ricarica e svuota i campi. Il freno deve stare
     anche nell'HTML, non solo nello script. */
  const LOGIN = fs.readFileSync(path.join(__dirname, "..", "login.html"), "utf8");
  const form = LOGIN.match(/<form[^>]*id="login-form"[^>]*>/);
  assert.ok(form, "il modulo di accesso non c'è più in login.html");
  assert.match(form[0], /action="#"/,
    "il modulo di accesso non ha `action`: senza lo script si invia a sé stesso");
  assert.match(form[0], /onsubmit="return false"/,
    "il modulo di accesso non ha il freno nell'HTML: senza `auth.js` ricarica la pagina");
  const reg = LOGIN.match(/<form[^>]*id="register-form"[^>]*>/);
  assert.ok(reg && /action="#"/.test(reg[0]) && /onsubmit="return false"/.test(reg[0]),
    "il modulo della segnalazione non ha il freno nell'HTML: senza `auth.js` perde la richiesta");
});

test("i campi vuoti dell'accesso dicono cosa manca, non restano muti", () => {
  assert.match(AUTH, /Inserisci l'email della tua pratica\./,
    "l'accesso non controlla più l'email vuota: il pulsante non risponde e non spiega");
  assert.match(AUTH, /Inserisci la password\./,
    "l'accesso non controlla più la password vuota");
  assert.match(AUTH, /segnalaCampo\(campoEmail/,
    "l'errore non viene segnalato accanto al campo, ma solo in fondo al modulo");
});

test("l'area cliente non rimbalza all'infinito fra login e pratica", () => {
  /* Il giro senza uscita: area → login → area → login. Il contatore in
     `sessionStorage` è l'unica cosa che lo distingue da un accesso normale,
     perché l'indirizzo è lo stesso. */
  assert.match(CASE, /RIMBALZI_KEY/, "case.js non conta più i rimbalzi: il giro può tornare");
  assert.match(CASE, /function rimbalzoSenzaFine/, "manca il controllo del rimbalzo");
  assert.match(CASE, /function guardSession\(\) \{\s*if \(rimbalzoSenzaFine\(\)\)/,
    "`guardSession` non guarda il rimbalzo prima di rimandare al login");
  assert.match(CASE, /mandaAlLogin\("sessione"\)/,
    "l'area cliente non dice al login *perché* è tornata lì");
  assert.match(CASE, /azzeraRimbalzi\(\)/,
    "il contatore non viene mai azzerato: dopo un accesso riuscito resterebbe sporco");
});

test("la pagina 404 dice che la pratica non è persa e offre l'accesso", () => {
  assert.ok(!/Questa pagina non c'è\./.test(PAGINA404),
    "la 404 è tornata a dire «questa pagina non c'è», che si legge come «hai perso la pratica»");
  assert.match(PAGINA404, /Non hai perso niente/,
    "la 404 non rassicura chi è appena stato buttato fuori dalla sua area");
  assert.match(PAGINA404, /href="login\.html"/,
    "la 404 non offre il modo di rientrare: la prima cosa che serve a chi è stato sbattuto fuori");
  /* e non paga il conto di due script che su una pagina d'errore non servono */
  assert.ok(!/assets\/[0-9a-f]{8}\/js\/api\.js/.test(PAGINA404),
    "la 404 carica `api.js`: una pagina d'errore non deve avviare sessioni");
});

test("la barra dei cookie non copre il pulsante del modulo", () => {
  const CSS = fs.readFileSync(path.join(__dirname, "..", "assets/css/premium.css"), "utf8");
  const MAIN = fs.readFileSync(path.join(__dirname, "..", "assets/js/main.js"), "utf8");
  assert.match(MAIN, /has-cookie-bar/,
    "nessuno segnala che la barra dei cookie è visibile: il CSS non può fare spazio");
  assert.match(CSS, /html\.has-cookie-bar \.auth-shell/,
    "manca lo spazio in fondo alla pagina d'accesso quando la barra è visibile");
});

module.exports = casi;
