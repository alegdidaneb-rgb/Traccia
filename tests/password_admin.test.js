/* ==========================================================================
   La password: la reimposta l'amministratore
   ==========================================================================
   Richiesta dell'utente: «mi serve la possibilità di cambiare le password dei
   clienti, quindi l'admin può farlo».

   Prima non poteva. C'era una sola funzione, `auth_change_password`, e
   pretendeva la password attuale: serve al cliente che la propria la ricorda
   ancora. Chi l'ha persa non aveva nessuna strada dentro il sito — e si
   finiva, di nuovo, a scrivere nel database a mano. Cioè: la password di un
   cliente scritta in una chat, e valida per sempre.

   Due strade, e questi test difendono che ci siano entrambe:

     1. **il codice monouso** — l'amministratore lo genera, il cliente sceglie
        la password. Chi genera il codice non conosce la password, e il codice
        vale un'ora sola.
     2. **la password scritta dall'amministratore** — per quando si è al
        telefono. Da quel momento la password la conoscono in due, e la
        finestra lo dice.

   E difendono tre cose che non devono succedere: la password in chiaro in un
   registro, la password di un altro amministratore, e il codice riutilizzabile.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");

const MIGRAZIONE = "0035_password_la_reimposta_l_admin.sql";
const SQL = R(`supabase/migrations/${MIGRAZIONE}`);
const ADMIN = R("assets/js/admin.js");
const API = R("assets/js/api.js");
const AUTH = R("assets/js/auth.js");
const LOGIN = R("login.html");

/* Il corpo di una funzione del file `admin.js`, dal nome fino alla funzione
   successiva: senza delimitarlo, ogni `assert` su un frammento passa anche se
   il frammento sta in un'altra funzione. */
function corpoAdmin(nome) {
  const i = ADMIN.indexOf(`function ${nome}(`);
  assert.ok(i !== -1, `manca la funzione ${nome} in admin.js`);
  const dopo = ADMIN.indexOf("\n  function ", i + 10);
  return ADMIN.slice(i, dopo === -1 ? ADMIN.length : dopo);
}

/* ================================================== il database: le funzioni = */

test("il database sa reimpostare una password, e sa generarne un codice", () => {
  assert.ok(/create or replace function traccia\.admin_reimposta_password\(/.test(SQL),
    "manca `admin_reimposta_password`: l'amministratore non può reimpostare niente");
  assert.ok(/create or replace function traccia\.admin_codice_password\(/.test(SQL),
    "manca `admin_codice_password`: la strada migliore, quella senza password in chiaro");
  assert.ok(/create or replace function traccia\.reset_password_con_codice\(/.test(SQL),
    "manca la funzione che il cliente usa col codice");
  /* e devono essere raggiungibili dal client: senza il doppione in `public`
     arriva un 404 che non dice niente di utile */
  ["admin_reimposta_password", "admin_codice_password", "reset_password_con_codice"]
    .forEach((f) => {
      assert.ok(new RegExp(`create or replace function public\\.${f}\\(`).test(SQL),
        `manca il wrapper public di ${f}: la console riceverebbe 404`);
    });
});

test("cambiare la password chiude le sessioni aperte", () => {
  /* È il motivo per cui la funzione esiste in questa forma. Se qualcuno è
     dentro l'account, cambiare la password senza buttarlo fuori non cambia
     niente: la sessione aperta resta aperta. */
  const i = SQL.indexOf("function traccia.admin_reimposta_password");
  const corpo = SQL.slice(i, SQL.indexOf("revoke all", i));
  assert.ok(/update traccia\.sessions/.test(corpo),
    "la reimpostazione non chiude le sessioni del cliente");
  assert.ok(/revoked_at = now\(\)/.test(corpo), "non revoca davvero");
});

test("la password non finisce mai nel registro attività", () => {
  /* Un registro che contiene le password è un registro che le fa uscire tutte
     insieme il giorno in cui qualcuno lo esporta. Si registra il fatto — chi,
     quando, se scelta o generata — e nient'altro. */
  const i = SQL.indexOf("function traccia.admin_reimposta_password");
  const corpo = SQL.slice(i, SQL.indexOf("revoke all", i));
  const chiamata = corpo.match(/log_action\(([\s\S]*?)\);/);
  assert.ok(chiamata, "la reimpostazione non lascia traccia nel registro attività");
  assert.ok(!/pwd/.test(chiamata[1]),
    "la password (o il suo hash) finisce nel registro attività");
  assert.ok(/password_reset_admin/.test(chiamata[1]),
    "il registro non dice che cosa è successo");
});

test("un amministratore non reimposta la password di un altro", () => {
  /* Sarebbe il modo più semplice per prendere il controllo di un collega, e
     nessuno se ne accorgerebbe finché non è tardi. La propria la cambia da
     solo, con la funzione che pretende quella attuale. */
  const i = SQL.indexOf("function traccia.admin_reimposta_password");
  const corpo = SQL.slice(i, SQL.indexOf("revoke all", i));
  assert.ok(/role = 'admin'/.test(corpo), "manca il controllo sul ruolo dell'account");
  assert.ok(/t\.id <> a\.id/.test(corpo), "il controllo non distingue sé stessi dagli altri");
});

test("il codice monouso si consuma davvero", () => {
  /* Se non si consumasse, un codice letto da qualcuno resterebbe una chiave
     per sempre — e la password la sceglierebbe chi lo ha letto, non il
     cliente. */
  const i = SQL.indexOf("function traccia.reset_password_con_codice");
  const corpo = SQL.slice(i, SQL.indexOf("revoke all", i));
  assert.ok(/used_at is null/.test(corpo), "l'uso non controlla che il codice sia ancora vivo");
  assert.ok(/set used_at = now\(\)/.test(corpo), "il codice non viene consumato");
  assert.ok(/expires_at < now\(\)/.test(corpo), "il codice non scade");
});

test("il codice non si conserva in chiaro", () => {
  /* Come per le sessioni: chi legge la tabella non deve ottenere niente di
     utilizzabile. Se il codice fosse in chiaro, l'amministratore potrebbe
     ancora usarlo dopo averlo consegnato — cioè non sarebbe più monouso. */
  const i = SQL.indexOf("create table if not exists traccia.password_resets");
  const tabella = SQL.slice(i, SQL.indexOf("create or replace function", i));
  assert.ok(/code_hash/.test(tabella), "la tabella conserva il codice, non la sua impronta");
  assert.ok(!/^\s*code\s+text/m.test(tabella), "c'è una colonna `code`: il codice è in chiaro");
  assert.ok(/hash_token\(/.test(SQL), "il codice non viene passato da `hash_token`");
});

test("il codice si legge al telefono", () => {
  /* Un codice dettato deve arrivare intero. L'esadecimale contiene 0, 1 e
     lettere che a voce si confondono: l'alfabeto è senza vocali e senza
     0/1/I/O, e il commento che lo prometteva non bastava. La prima stesura
     generava esadecimale e il test sul campo l'ha preso. */
  const i = SQL.indexOf("function traccia.admin_codice_password");
  const corpo = SQL.slice(i, SQL.indexOf("revoke all", i));
  assert.ok(/alfabeto[^;]*'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'/.test(corpo),
    "l'alfabeto del codice contiene 0, 1 o lettere ambigue");
  assert.ok(!/encode\(extensions\.gen_random_bytes/.test(corpo),
    "il codice torna a essere esadecimale: 0 e 1 si dettano male");
});

/* ============================================ la console: il pulsante giusto = */

test("sulla riga del cliente c'è un pulsante per la password", () => {
  /* Il difetto già visto due volte in questa console: la funzione esiste, il
     gemello esiste, e nessun pulsante li attiva. Quindi si controlla la
     variabile **e** la cella in cui finisce. */
  assert.ok(/var pwdBtn\s*=/.test(ADMIN), "la variabile `pwdBtn` non viene costruita");
  const celle = [...ADMIN.matchAll(/data-table__actions">' \+ ([^\n]*) \+ "<\/td>"/g)]
    .map((m) => m[1]);
  assert.ok(celle.some((c) => /\bpwdBtn\b/.test(c)),
    "il pulsante della password è costruito ma non messo nella riga: non si può premere");
});

test("il pulsante della password non c'è sull'account master", () => {
  /* La stessa regola delle altre azioni. Sul master la password la cambia il
     master, e nessun altro: un pulsante che il database rifiuta è un errore
     che si scopre dopo averlo premuto. */
  const i = ADMIN.indexOf("var pwdBtn");
  assert.ok(/user\.is_master \? "" :/.test(ADMIN.slice(i, i + 200)),
    "il pulsante compare anche sull'account master");
});

test("il clic è collegato alla finestra della password", () => {
  assert.ok(/data-password/.test(ADMIN), "manca l'attributo data-password");
  assert.ok(/closest\("\[data-password\]"\)/.test(ADMIN), "nessun gestore legge data-password");
  assert.ok(/cambiaPassword\(/.test(ADMIN), "il gestore non chiama `cambiaPassword`");
});

test("la finestra propone il codice monouso, e non solo la password scritta", () => {
  const corpo = corpoAdmin("cambiaPassword");
  assert.ok(/api\.passwordCode\(/.test(corpo), "la finestra non può generare un codice");
  assert.ok(/api\.resetPassword\(/.test(corpo), "la finestra non può scrivere una password");
  /* e la scelta è esplicita: un campo vuoto che cambia significato è il modo
     per far scoprire *dopo* che cosa è stato fatto */
  assert.ok(/tipo: "select"/.test(corpo), "non c'è una scelta esplicita fra le due strade");
});

test("scrivere la password a mano chiede una conferma in più", () => {
  /* Da quel momento la password la conoscono in due, e chi la riceve non lo sa
     finché non glielo si dice. Il codice, invece, non decide niente per il
     cliente: lì non c'è niente da confermare. */
  const corpo = corpoAdmin("cambiaPassword");
  assert.ok(/ui\.ask\(/.test(corpo), "la password scritta a mano non chiede conferma");
});

test("la password si legge dal server una volta sola, e la finestra lo dice", () => {
  const corpo = corpoAdmin("cambiaPassword");
  assert.ok(/non viene mostrata di nuovo/.test(corpo),
    "la finestra non avverte che la password non si potrà rivedere");
  assert.ok(!/password_hash/.test(ADMIN), "la console chiede l'hash: non si legge");
});

/* ================================================== il cliente: la sua strada = */

test("la pagina di accesso ha il posto dove usare il codice", () => {
  assert.ok(/id="reset-form"/.test(LOGIN), "manca il modulo del codice");
  assert.ok(/id="reset-email"/.test(LOGIN), "manca il campo email");
  assert.ok(/id="reset-code"/.test(LOGIN), "manca il campo del codice");
  assert.ok(/id="reset-password"/.test(LOGIN), "manca il campo della nuova password");
  /* il modulo parte nascosto: chi arriva qui vuole entrare, non reimpostare */
  assert.ok(/id="reset-form"[^>]*hidden/.test(LOGIN), "il modulo del codice è visibile all'arrivo");
});

test("il modulo del codice non è una terza scheda", () => {
  /* Tre schede in una pillola, su un telefono stretto, sono tre righe di
     testo illeggibili. Il codice si raggiunge da un aiuto sotto l'accesso —
     ed è così che ci si arriva davvero: con un link incollato in una chat. */
  const schede = LOGIN.match(/data-auth-tab="([a-z]+)"/g) || [];
  assert.deepStrictEqual(schede.sort(), ['data-auth-tab="login"', 'data-auth-tab="register"'],
    "le schede sono tornate tre: la barra non ci sta su un telefono");
  assert.ok(/href="#password"/.test(LOGIN), "manca il link condivisibile a #password");
});

test("chi usa il codice non entra da solo", () => {
  /* Il codice vale come credenziale per *scegliere* una password, non come
     sessione. Dopo il cambio si torna all'accesso: entrare da soli vorrebbe
     dire che un codice letto da qualcuno è un accesso all'account. */
  const i = AUTH.indexOf("resetForm.addEventListener");
  const corpo = AUTH.slice(i, i + 2000);
  assert.ok(/setMode\("login"\)/.test(corpo), "dopo il cambio non si torna all'accesso");
  assert.ok(!/location\.(href|replace)\s*=\s*[^;]*app\.html/.test(corpo),
    "il modulo del codice porta dentro l'area cliente senza passare dall'accesso");
});

test("il modulo del codice controlla prima di chiamare il server", () => {
  const i = AUTH.indexOf("resetForm.addEventListener");
  const corpo = AUTH.slice(i, i + 2000);
  assert.ok(/nuova\.length < 8/.test(corpo),
    "la pagina manda al server una password che il server rifiuterà");
  assert.ok(/api\.resetConCodice\(/.test(corpo), "il modulo non chiama il server");
});

test("la nuova funzione API esiste, con il nome giusto", () => {
  /* Un nome sbagliato qui è un 404 che arriva solo in produzione: la console
     chiama per nome. */
  assert.ok(/resetPassword:/.test(API), "manca `api.resetPassword`");
  assert.ok(/passwordCode:/.test(API), "manca `api.passwordCode`");
  assert.ok(/resetConCodice:/.test(API), "manca `api.resetConCodice`");
  ["admin_reimposta_password", "admin_codice_password", "reset_password_con_codice"]
    .forEach((f) => {
      assert.ok(API.includes(`"${f}"`), `api.js non chiama ${f}`);
    });
});

/* ==================================== le altre lingue, con lo stesso significato = */

test("le quattro lingue dicono la stessa cosa", () => {
  /* La regola del sito: nessun testo solo in italiano. Se la pagina inglese
     dicesse «Reset» dove l'italiana dice «Imposta la password», il cliente
     tedesco e quello inglese leggerebbero due cose diverse. */
  const lingua = (l) => JSON.parse(R(`tools/i18n/${l}.json`));
  const chiavi = ["Nuova password", "Codice", "Imposta la password", "Torna all'accesso",
    "Almeno 8 caratteri.", "Hai perso la password?", "Usa il codice dell'ufficio"];
  const it = lingua("it");
  ["en", "de", "es"].forEach((l) => {
    const cat = lingua(l);
    chiavi.forEach((k) => {
      assert.ok(k in it, `il catalogo italiano non conosce «${k}»`);
      assert.ok(k in cat, `${l}: manca la traduzione di «${k}»`);
      assert.notStrictEqual(cat[k], it[k], `${l}: «${k}» è rimasto in italiano`);
      assert.ok(String(cat[k]).trim().length > 0, `${l}: «${k}» è vuoto`);
    });
  });
});

module.exports = casi;
