/* ==========================================================================
   Una porta sola: il modulo completo
   ==========================================================================
   Questo file difendeva la «via veloce» — nome e numero, con il modulo vero
   dietro il link «Preferisco scrivere i dettagli». Era una scelta di
   conversione nata da «I NEED LEAD GENERATION NOTHING ELSE», ed è stata
   bocciata dal cliente il 2026-11-12: «these type of registration should not
   even be there, it has to be detailed».

   Il file resta perché la promessa che lo aveva fatto nascere resta: i sei
   dati si chiedono, si chiedono subito, e nessuno li nasconde. Cambia il
   verso — qui sotto si verifica che la scorciatoia **non** ci sia più, e che
   toglierla non abbia portato via il modulo completo, la funzione del
   database o il foglio dei lead.

   `richiesta_telefono` resta nel database (le richieste già arrivate la
   citano) ma il sito non la chiama: le righe su di lei restano come memoria
   di com'era fatta, non come prescrizione.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");

const LOGIN = R("login.html");
const AUTH = R("assets/js/auth.js");
const API = R("assets/js/api.js");
const SQL = R("supabase/migrations/0027_via_veloce.sql");
const LINGUE = ["", "en/", "de/", "es/"];

test("la via veloce non c'è più, in nessuna lingua", () => {
  /* Il cliente: «these type of registration should not even be there, it has
     to be detailed». Quindi: nessun modulo corto, nessun link che nasconde il
     modulo serio, in tutte e quattro le lingue. Se un giorno la scorciatoia
     tornasse, deve tornare con una decisione — non con un copia e incolla. */
  LINGUE.forEach((cartella) => {
    const html = R(cartella + "login.html");
    assert.ok(html.indexOf('id="telefono-form"') === -1,
      `${cartella || "it/"}login.html: c'è ancora il modulo corto`);
    assert.ok(html.indexOf("data-apri-completo") === -1,
      `${cartella || "it/"}login.html: c'è ancora il link che nasconde il modulo completo`);
    /* il modulo completo, invece, si vede all'arrivo: non è un pannello */
    const i = html.indexOf('id="register-form"');
    const tag = html.slice(i, html.indexOf(">", i));
    assert.ok(!/\shidden\b/.test(tag),
      `${cartella || "it/"}: il modulo completo parte nascosto`);
    /* e i due campi che la via veloce chiedeva da sola non sono spariti dal
       modulo: sono i primi due di quello completo */
    assert.match(html, /id="reg-first-name"/);
    assert.match(html, /id="reg-phone"/);
  });
  /* e non resta nemmeno il client che la chiamava */
  assert.ok(API.indexOf("richiestaTelefono") === -1,
    "api.js offre ancora la chiamata: è la strada per reintrodurla per sbaglio");
  assert.ok(AUTH.indexOf("rapidoForm") === -1, "auth.js ha ancora il gestore del modulo corto");
});

test("il foglio mostra il nome, non una cella vuota", () => {
  /* `first_name || ' ' || last_name` con NULL dà NULL: misurato il 2026-11-11,
     una richiesta con il nome dentro arrivava nel foglio come riga senza nome.
     La costruzione deve essere la stessa della console. */
  const sql = R("supabase/migrations/0027_via_veloce.sql");
  const inizio = sql.indexOf("create or replace function traccia.leads_per_foglio");
  const blocco = sql.slice(inizio, sql.indexOf("$f$", sql.indexOf("create or replace function public.leads_per_foglio")));
  assert.match(blocco, /'nome', coalesce\(nullif\(trim\(coalesce\(r\.first_name/,
    "leads_per_foglio costruisce il nome senza tollerare i NULL");
  assert.match(blocco, /'Telefono in attesa'/,
    "nel foglio una riga senza nome resta vuota");
});

test("il modulo completo c'è ancora tutto, e si vede subito", () => {
  /* La promessa fatta due volte: i sei campi, tutti, tutti obbligatori. Toglierli
     per accorciare il modulo era l'altra strada, ed era quella sbagliata. */
  ["reg-first-name", "reg-last-name", "reg-email", "reg-phone",
   "reg-amount", "reg-tipo"].forEach((id) => {
    assert.ok(LOGIN.includes(`id="${id}"`), `manca il campo «${id}»`);
  });
  const i = LOGIN.indexOf('id="register-form"');
  const blocco = LOGIN.slice(i, LOGIN.indexOf("</form>", i));
  assert.strictEqual((blocco.match(/<input\b/g) || []).length, 5,
    "i campi di testo sono cinque (nome, cognome, email, telefono, importo)");
  assert.match(blocco, /<select\b[^>]*name="situation"/,
    "manca il tipo di truffa");
  assert.ok(!/data-apri-completo/.test(LOGIN),
    "il modulo completo è ancora dietro un link: deve essere la scheda stessa");
});

test("il modulo completo passa da auth_register, l'unica porta rimasta", () => {
  /* Una seconda porta con una funzione più permissiva è la stessa porta con i
     controlli aggirati. Ora ce n'è una: sei dati, e `auth_register` li
     pretende tutti. */
  assert.match(API, /rpc\("auth_register"/, "api.js non chiama auth_register");
  assert.match(AUTH, /api\.register\(/);
  assert.ok(API.indexOf('rpc("richiesta_telefono"') === -1,
    "il client chiama ancora la funzione del modulo corto");
  /* la funzione resta nel database: le richieste arrivate con lei la citano, e
     cancellarla renderebbe illeggibile lo storico. Ma non è più raggiungibile
     da qui: il controllo è sul client, dove si decide cosa il sito offre. */
  assert.match(SQL, /create or replace function traccia\.richiesta_telefono/,
    "la funzione è stata cancellata dal database: lo storico non si spiega più");
});

test("due clic non sono due clienti", () => {
  /* Chi preme «Fatti chiamare» due volte non è due persone. Se il database
     creasse due righe, la console mostrerebbe due lead e due analisti
     chiamerebbero lo stesso numero — che è il guasto che il sistema della
     squadra esiste per evitare, ricreato dalla porta d'ingresso. */
  assert.match(SQL, /interval '1 hour'/, "manca la finestra anti-doppione");
  assert.match(SQL, /gia_ricevuta/,
    "il secondo clic riceve un errore invece di «ti chiamiamo noi»");
  assert.match(SQL, /where r\.phone = tel/, "il doppione si controlla sulla email, non sul telefono");
});

test("una richiesta senza nome si legge lo stesso in console", () => {
  /* `first_name || ' ' || last_name` con NULL dà NULL: la riga arriverebbe in
     console con la cella del nome vuota, e un analista che guarda una tabella
     di righe vuote smette di guardarla. */
  assert.match(SQL, /'Telefono in attesa'/);
  assert.match(SQL, /coalesce\(nullif\(trim\(coalesce\(r\.first_name/,
    "il nome della riga non è calcolato in modo tollerante ai NULL");
});

test("il modulo di segnalazione non promette niente", () => {
  /* Le stesse parole vietate ovunque nel progetto: il pubblico è chi è appena
     stato truffato, e sta cercando le parole dei truffatori per riconoscerle. */
  const VIETATE = [/\bgarantit[oi]\b/i, /\bguarantee[ds]?\b/i, /\bgarantiert/i,
                   /\brecuperiamo\b/i, /\bwir holen\b/i, /\b100 ?%/];
  LINGUE.forEach((cartella) => {
    const html = R(cartella + "login.html");
    const inizio = html.indexOf('id="register-form"');
    const blocco = html.slice(inizio, html.indexOf("</form>", inizio));
    VIETATE.forEach((re) => {
      assert.ok(!re.test(blocco),
        `${cartella || "it/"} : il modulo di segnalazione promette un risultato`);
    });
  });
});

module.exports = casi;
