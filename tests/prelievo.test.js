/* ==========================================================================
   Il codice di conferma del prelievo deve arrivare a qualcuno
   ==========================================================================
   Il cliente: «il cliente tramite il pannello non può fare la richiesta di
   prelievo».

   La traccia, dal database di produzione e non da un'ipotesi:

     TRC-O-2026-000004 · 5/11 16:02 — prelievo di 420.000 € chiesto, e
       **nessun codice consegnato** in trenta minuti;
     TRC-O-2026-000005 · 5/11 19:02 — secondo tentativo, IBAN diverso;
     19:05 — l'analista consegna il codice;
     19:11 — il cliente **annulla**, con il codice pronto per lui.

   Il tempo non era il problema: il 0022 aveva già portato la finestra da
   dieci a trenta minuti (applicato alle 19:10, un minuto prima di quel
   «annulla»). Il problema era il **canale**: il codice esisteva, valeva
   trenta minuti, e non arrivava a nessuno — perché sotto il campo la pagina
   diceva

       «La richiesta risulta per <email>»

   e quella email non è mai partita: il progetto non ha un servizio di posta.

   Questi test difendono le tre cose che rendono il codice raggiungibile:
     1. il pannello dice da dove arriva il codice, e non promette una email;
     2. se il cliente non ha le coordinate, «Preleva» lo dice **prima**,
        accanto al pulsante e non in un avviso che sparisce;
     3. l'analista, con il codice in mano, ha un pulsante che lo manda al
        cliente — e se il cliente non ha un numero, ha il modo di aggiungerlo.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const APP = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
const ADMIN = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const CASE_JS = fs.readFileSync(path.join(__dirname, "..", "assets/js/case.js"), "utf8");
const ADMIN_JS = fs.readFileSync(path.join(__dirname, "..", "assets/js/admin.js"), "utf8");
const MIGRAZIONE = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/0033_codice_al_cliente.sql"), "utf8");

/* Il corpo del secondo tempo della modale, **senza i commenti**: la promessa
   sbagliata va cercata in ciò che il cliente legge, non nella spiegazione di
   chi ha scritto il codice. Cercarla nel commento produce un test che si
   accende per la nota che documenta il difetto — e un test che strilla per un
   commento viene disattivato al primo fastidio. */
const CONFERMA = APP.slice(APP.indexOf("data-bonifico-conferma"),
                           APP.indexOf("data-conferma-error"))
  .replace(/<!--[\s\S]*?-->/g, "");

test("prelievo: il pannello non promette una email che nessuno manda", () => {
  /* «la richiesta risulta per <email>» è la frase che ha fatto aspettare la
     posta a un cliente per sei minuti, con 420.000 € impegnati. Il progetto
     non ha un servizio di posta: quella frase non può tornare. */
  /* Si guarda **tutta la pagina**, non solo il blocco della conferma: la
     prima versione di questo test cercava la frase dentro il secondo tempo, e
     la prova di mutazione l'ha smascherata — rimettendo «la richiesta risulta
     per …» fuori da quel blocco, restava verde. */
  const SENZA_COMMENTI = APP.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!/risulta per/i.test(SENZA_COMMENTI),
    "il pannello rimanda di nuovo all'email: nessun messaggio parte da lì");
  /* Il nodo `data-conferma-email` **deve** restare: `case.js` lo cerca in un
     ciclo, e un nodo che il codice cerca e la pagina non ha è il difetto che
     `bonifico_otp.test.js` già protegge. Quello che non deve tornare è il
     **testo**: l'indirizzo del cliente in una frase che fa credere a un invio.
     Cercare la stringa dell'attributo (prima versione di questo test) puniva
     la soluzione invece del difetto. */
  const ETICHETTA = APP.slice(APP.indexOf("data-conferma-email") - 200,
                              APP.indexOf("data-conferma-email") + 200);
  assert.ok(!/risulta per/i.test(ETICHETTA),
    "accanto al nodo dell'email è tornata la frase «la richiesta risulta per»");
  assert.ok(!/ti (abbiamo )?(mandato|inviato)/i.test(ETICHETTA),
    "accanto al nodo dell'email la pagina promette di nuovo un invio");
});

test("prelievo: il pannello dice chi manda il codice", () => {
  /* non basta togliere la bugia: senza dire da dove arriva il codice, il
     cliente resta davanti a una casella vuota senza sapere cosa aspettare */
  assert.match(CONFERMA, /analista/i,
    "la conferma non dice che il codice lo comunica una persona");
  assert.match(CONFERMA, /WhatsApp/i,
    "la conferma non dice su quale canale arriva il codice");
  assert.match(CONFERMA, /non arriva per email/i,
    "la conferma non dice esplicitamente che l'email non arriva");
});

test("prelievo: chi non ha le coordinate lo scopre dal pulsante, non dopo", () => {
  /* spento senza spiegazione è uguale a rotto: il motivo sta accanto */
  assert.match(APP, /data-prelievo-motivo/,
    "manca il posto dove spiegare perché «Preleva» è spento");
  assert.match(CASE_JS, /function coordinateMancanti/,
    "non c'è più la funzione che dice cosa manca per prelevare");
  assert.match(CASE_JS, /preleva\.disabled = !!perche/,
    "«Preleva» non viene più spento quando non può funzionare");
  assert.match(CASE_JS, /motivo\.textContent = perche/,
    "il motivo non viene più scritto accanto al pulsante");
});

test("prelievo: manca l'IBAN → il campo si apre, non un avviso che sparisce", () => {
  assert.match(CASE_JS, /portaAlCampoIban/,
    "non si porta più il cliente al campo IBAN");
  assert.match(CASE_JS, /#iban-value/,
    "il campo IBAN non ha più un id stabile da raggiungere");
});

test("prelievo: l'analista può mandare il codice al cliente", () => {
  /* il pezzo che mancava del tutto: il codice consegnato non arrivava a
     nessuno. `wa.me` dal nostro telefono al suo è il canale che c'è. */
  assert.match(ADMIN, /data-codice-wa/,
    "nel modale del codice non c'è il pulsante per mandarlo");
  assert.match(ADMIN_JS, /aNumero\(cifre, codiceWhatsapp\(res\)\)/,
    "il codice non viene più composto nel link verso il cliente");
  assert.match(ADMIN_JS, /function codiceWhatsapp/,
    "non viene più costruito il messaggio con il codice");
});

test("prelievo: senza telefono, la console dà il modo di aggiungerlo", () => {
  /* nessuno dei clienti in produzione ha un telefono salvato: senza un
     rimedio qui, il pulsante semplicemente non compare e l'analista resta
     col codice in mano. */
  assert.match(ADMIN, /data-codice-senza-tel/,
    "manca l'avviso «questo cliente non ha un numero»");
  assert.match(ADMIN_JS, /senzaTel\.hidden = cifre\.length >= 8/,
    "l'avviso non segue più la presenza del numero");
  assert.match(ADMIN, /data-codice-modifica/,
    "manca la strada per andare a scrivere il telefono");
});

test("prelievo: il numero del cliente arriva davvero all'analista", () => {
  /* il client non può inventarlo: deve uscire dal database. Un pulsante che
     legge un campo che nessuna funzione restituisce non compare mai, e
     sembra che il pulsante sia rotto. */
  assert.match(MIGRAZIONE, /'telefono', coalesce\(u\.phone, ''\)/,
    "la lista delle conferme non porta il telefono del cliente");
  assert.match(MIGRAZIONE, /'telefono', coalesce\(u\.phone, ''\)[\s\S]*'codice', codice/,
    "il codice consegnato non porta con sé il telefono");
  assert.match(MIGRAZIONE, /create or replace function public\.admin_conferma_codice/,
    "manca il wrapper in `public`: il browser non raggiunge la funzione");
  assert.match(MIGRAZIONE, /grant execute on function public\.admin_conferma_codice/,
    "il wrapper esiste ma non è eseguibile: risponderebbe «permission denied»");
});

test("prelievo: il messaggio al cliente non assomiglia a una truffa", () => {
  /* il cliente è già stato truffato una volta. Un messaggio che chiede dati
     o mette fretta è un danno doppio. */
  const corpo = ADMIN_JS.slice(ADMIN_JS.indexOf("function codiceWhatsapp"),
                               ADMIN_JS.indexOf("function scadiConferme"));
  /* Si cercano le **richieste**, non le parole: «non ti chiederemo mai
     password» contiene «password» ed è la frase migliore del messaggio.
     Un test che non distingue una richiesta dalla sua smentita punisce
     proprio la formulazione che protegge il cliente. */
  const richieste = [
    /ti chiediamo (la |le )?(password|pin|codice)/i,
    /invia(mi)? (la |le )?(password|pin)/i,
    /clicca (qui|sul link)/i,
    /(entro|nelle prossime) \d+ (ore|minuti)/i,
    /subito|urgente|ultima chance/i
  ].filter((re) => re.test(corpo)).map(String);
  assert.deepStrictEqual(richieste, [],
    "il messaggio chiede dati o mette fretta: " + richieste.join(", "));
  assert.match(corpo, /Non ti chiederemo mai altre cifre/,
    "il messaggio non dice che non chiederemo altri dati");
  assert.match(corpo, /una volta sola/,
    "il messaggio non dice che il codice vale una volta sola");
});

module.exports = casi;
