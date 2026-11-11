/* ==========================================================================
   La via veloce: un numero di telefono
   ==========================================================================
   Il cliente: «I NEED LEAD GENERATION NOTHING ELSE».

   Il modulo con i sei dati — nome, cognome, email, telefono, importo perso,
   tipo di truffa — non si tocca: sono i sei che il cliente ha chiesto per nome,
   due volte, e servono a sapere prima di comporre il numero di che caso si
   tratta. Ma a freddo, su un annuncio, ogni campo in più costa circa l'11% di
   compilazioni (HubSpot: 3 campi ≈ 25%, 6 campi ≈ 15%), e con 24 $ di budget
   quella differenza è tutto.

   Quindi due porte sullo stesso database. Questi test difendono la seconda:
   che esista, che convinca, che non duplichi un lead quando qualcuno preme due
   volte, e che non abbia mangiato la prima.
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

test("la via veloce chiede nome e numero, e nient'altro", () => {
  /* Un campo solo era la scelta giusta sulla carta, sbagliata nei fatti: il
     2026-11-11 una richiesta vera è arrivata con il solo numero, e in console
     e nel foglio si leggeva «Telefono in attesa». Chi guarda la tabella non
     sapeva chi stava per chiamare — e al telefono «buongiorno» a uno
     sconosciuto costa più di due secondi di compilazione.
     Quindi due campi: il nome e il numero. Non tre: il resto (importo, tipo di
     truffa) si chiede parlando, che è dove si sarebbe chiesto comunque. */
  LINGUE.forEach((cartella) => {
    const html = R(cartella + "login.html");
    const inizio = html.indexOf('id="telefono-form"');
    assert.ok(inizio > -1, `${cartella || "it/"}login.html: manca il modulo veloce`);
    const fine = html.indexOf("</form>", inizio);
    const blocco = html.slice(inizio, fine);
    const campi = (blocco.match(/<input\b/g) || []).length;
    assert.strictEqual(campi, 2, `${cartella || "it/"}: il modulo veloce ha ${campi} campi, deve averne 2`);
    assert.match(blocco, /id="rapido-nome"/, "manca il nome: la riga arriverebbe senza");
    assert.match(blocco, /type="tel"/, "il campo del numero non è type=tel: la tastiera non è numerica");
    /* il nome deve arrivare al database, altrimenti è decorazione */
    assert.match(AUTH, /nome:\s*nome/, "il nome non viene mandato a richiesta_telefono");
    assert.match(AUTH, /nome\.length < 2/, "il nome non viene controllato prima dell'invio");
  });
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

test("il modulo completo non è stato mangiato", () => {
  /* La promessa fatta due volte resta: i sei campi ci sono ancora, tutti, e
     tutti obbligatori. La via veloce si aggiunge, non sostituisce. */
  ["reg-first-name", "reg-last-name", "reg-email", "reg-phone",
   "reg-amount", "reg-tipo"].forEach((id) => {
    assert.ok(LOGIN.includes(`id="${id}"`), `manca il campo «${id}»: la via veloce ha sostituito il modulo`);
  });
  /* e il modulo completo si apre da un link, non è nascosto per sempre */
  assert.match(LOGIN, /data-apri-completo/, "manca il modo di aprire il modulo completo");
  assert.match(AUTH, /apriCompleto\.addEventListener/,
    "il link non apre niente: chi vuole scrivere i dettagli resta bloccato sul numero");
});

test("la via veloce arriva al database, con la sua funzione", () => {
  /* Una seconda porta con la stessa funzione non è una seconda porta: è la
     stessa, con i controlli aggirati da un parametro. `auth_register` chiede
     sei dati e ne pretende sei; questa ne pretende uno. */
  assert.match(API, /rpc\("richiesta_telefono"/, "api.js non chiama richiesta_telefono");
  assert.match(AUTH, /api\.richiestaTelefono\(/);
  assert.match(SQL, /create or replace function traccia\.richiesta_telefono/);
  /* e non deve chiamare la funzione del modulo completo */
  const inizio = AUTH.indexOf("rapidoForm.addEventListener");
  const blocco = AUTH.slice(inizio, inizio + 2000);
  assert.ok(!/api\.register\(/.test(blocco),
    "la via veloce chiama `register`: passerebbe dai sei campi e fallirebbe");
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

test("il modulo veloce non promette niente", () => {
  /* Le stesse parole vietate ovunque nel progetto: il pubblico è chi è appena
    stato truffato, e sta cercando le parole dei truffatori per riconoscerle. */
  const VIETATE = [/\bgarantit[oi]\b/i, /\bguarantee[ds]?\b/i, /\bgarantiert/i,
                   /\brecuperiamo\b/i, /\bwir holen\b/i, /\b100 ?%/];
  ["", "en/", "de/", "es/"].forEach((cartella) => {
    const html = R(cartella + "login.html");
    const inizio = html.indexOf('id="telefono-form"');
    const blocco = html.slice(inizio, html.indexOf("</form>", inizio));
    VIETATE.forEach((re) => {
      assert.ok(!re.test(blocco),
        `${cartella || "it/"}: il modulo veloce promette un risultato`);
    });
  });
});

module.exports = casi;
