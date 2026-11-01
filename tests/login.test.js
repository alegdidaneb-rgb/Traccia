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

module.exports = casi;
