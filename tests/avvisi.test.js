/* ==========================================================================
   Scrivere al cliente, e la campanella che lo avvisa
   ==========================================================================
   La richiesta, alla lettera: «dal master si deve poter mandare ogni tipo di
   messaggio nell'account del cliente, e nell'account del cliente deve esserci
   una campanella in alto a destra che mostra che è arrivato un messaggio».

   Il difetto di partenza era doppio, e nessuna delle due metà si vedeva
   leggendo il codice nuovo:
     - la logica della campanella esisteva già in `case.js` (pallino,
       conteggio, pannello, «segna letti», Esc) ma **il markup non c'era**:
       lo script cercava `[data-notify]`, non lo trovava, e usciva in silenzio
       alla prima riga. Niente errori in console, niente campanella: solo
       un'assenza;
     - lato console **non esisteva** il modo di scrivere un avviso a mano: gli
       avvisi nascevano solo da un cambio di fase o da un documento valutato.

   Qui si prova che le due metà ci siano e si tocchino: il markup che lo
   script cerca, la funzione SQL che il pulsante chiama, e i controlli che
   impediscono a un messaggio vuoto di diventare una campanella accesa.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(RADICE, "app.html"), "utf8");
const ADMIN_HTML = fs.readFileSync(path.join(RADICE, "admin.html"), "utf8");
const CASE = fs.readFileSync(path.join(RADICE, "assets/js/case.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
const API = fs.readFileSync(path.join(RADICE, "assets/js/api.js"), "utf8");
const CSS = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");
const MIGRAZIONE = fs.readFileSync(
  path.join(RADICE, "supabase/migrations/0031_scrivere_al_cliente.sql"), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* --------------------------------------------------------------------------
   La campanella: il markup che lo script cerca.

   È il test che sarebbe stato utile due settimane fa. `case.js` non falliva
   perché mancava qualcosa: usciva alla prima riga (`if (!button || !panel)
   return;`), e una funzione che esce senza fare niente è indistinguibile da
   una funzione che ha fatto il suo lavoro.
   -------------------------------------------------------------------------- */
test("la campanella è nell'HTML, non solo nel JavaScript", () => {
  /* ogni selettore che `case.js` cerca deve esistere in `app.html` */
  [["[data-notify]", "il pulsante della campanella"],
   ["[data-notify-panel]", "il pannello che si apre"],
   ["[data-notify-list]", "la lista degli avvisi"],
   ["[data-notify-count]", "il numero dei non letti"],
   ["[data-notify-read-all]", "«segna tutti come letti»"]].forEach(([sel, cosa]) => {
    const attributo = sel.slice(1, -1);
    assert.ok(APP.indexOf(attributo) > -1,
      `manca ${cosa}: \`${sel}\` non esiste in app.html. Lo script lo cerca, ` +
      "non lo trova e torna indietro senza dire niente.");
  });
});

test("la campanella sta in alto a destra, accanto ai pulsanti", () => {
  /* è la richiesta del cliente, alla lettera: «in alto a destra». Sta dentro
     la riga dell'intestazione, nello stesso gruppo di «Aggiorna» e «Versa». */
  const testa = APP.slice(APP.indexOf('class="appv2__head-row"'),
                          APP.indexOf('class="appv2__pagina"'));
  assert.ok(testa.indexOf("data-notify") > -1,
    "la campanella non è nella riga dell'intestazione");
  assert.ok(/\.notif__panel\s*\{[^}]*right:\s*0/.test(CSS),
    "il pannello deve aprirsi verso sinistra (`right: 0`): altrimenti esce " +
    "dallo schermo proprio perché sta a destra");
});

test("la campanella non si apre per sbaglio e si chiude", () => {
  /* i tre modi di chiudere: secondo clic, clic fuori, Esc */
  assert.ok(/panel\.hidden = aperto/.test(CASE), "il secondo clic deve chiudere");
  assert.ok(/e\.key === "Escape"/.test(CASE), "Esc deve chiudere");
  assert.ok(/closest\("\.notif"\)/.test(CASE), "il clic fuori deve chiudere");
  assert.ok(/aria-expanded/.test(APP) && /aria-expanded/.test(CASE),
    "lo stato aperto/chiuso va detto anche a chi non lo vede");
});

test("il numero dei non letti non è mai «0»", () => {
  /* una campanella con «0» insegna a essere ignorata: il numero compare solo
     quando c'è qualcosa da leggere */
  assert.ok(/count\.hidden = !nonLette/.test(CASE),
    "il numero deve sparire quando non c'è niente da leggere");
  assert.ok(/nonLette > 9 \? "9\+"/.test(CASE),
    "oltre nove si scrive «9+», o il pallino sfonda il pulsante");
});

test("aprendo la campanella gli avvisi si segnano letti", () => {
  assert.ok(/api\.readNotifications\(\)/.test(CASE),
    "senza questo il pallino resta acceso per sempre e la campanella mente");
});

/* --------------------------------------------------------------------------
   Il tipo: una persona che scrive, o il sistema che avvisa.
   -------------------------------------------------------------------------- */
test("un messaggio scritto dall'ufficio si distingue da un avviso di sistema", () => {
  assert.ok(/messaggio: "Dall'ufficio"/.test(CASE),
    "il cliente deve capire se gli ha scritto una persona o se è il sistema: " +
    "la prima cosa chiede una risposta, la seconda no");
  assert.ok(/notif__kind/.test(CSS), "manca lo stile dell'etichetta del tipo");
});

/* --------------------------------------------------------------------------
   Il database.
   -------------------------------------------------------------------------- */
test("il tipo «messaggio» è ammesso dalla tabella", () => {
  /* senza questo il primo messaggio scritto a mano viene rifiutato dal
     vincolo `check (kind in (…))` — e l'errore arriva in faccia all'operatore
     come «violates check constraint», che non dice cosa fare */
  assert.ok(/notifications_kind_check/.test(MIGRAZIONE),
    "manca il vincolo con un nome suo: senza nome, la prossima migrazione non " +
    "sa quale togliere");
  assert.ok(/'messaggio'/.test(MIGRAZIONE), "`messaggio` non è fra i tipi ammessi");
  /* e il vincolo vecchio va tolto: aggiungerne uno accanto non basta, il primo
     continuerebbe a rifiutare il valore nuovo */
  assert.ok(/drop constraint/.test(MIGRAZIONE),
    "il vincolo vecchio va tolto, non solo affiancato");
});

test("il file di allineamento rifiuta di passare senza la 0031", () => {
  /* Un file di allineamento che si applica sempre senza controllare niente non
     è un allineamento, è un timbro.
     Contesto: il 2026-11-15 la 0031 è stata applicata on-line con il nome
     `scrivere_al_cliente` — prima del codice, di proposito, perché il client
     che chiama `admin_invia_avviso` non deve mai girare contro un database che
     non ce l'ha. Il registro delle migrazioni applicate vive in Supabase, fuori
     da Git: il file 0031b esiste perché quel registro e il repository restino
     confrontabili a mano, e questo test perché non diventi un file che passa
     sempre, anche applicato per sbaglio su uno schema vecchio. */
  const allineamento = fs.readFileSync(
    path.join(RADICE, "supabase/migrations/0031b_allineamento_20261115.sql"), "utf8");
  assert.ok(/raise exception/.test(allineamento),
    "l'allineamento deve fermarsi se la 0031 non è applicata");
  assert.ok(/messaggio/.test(allineamento),
    "il controllo deve guardare proprio il valore che la 0031 aggiunge");
  assert.ok(!/alter table|create (or replace )?function/i.test(allineamento),
    "l'allineamento non deve cambiare lo schema: se cambia qualcosa, non è un allineamento");
});

test("si può scrivere a una pratica e a tutte, con due funzioni", () => {
  assert.ok(/function traccia\.admin_invia_avviso\(/.test(MIGRAZIONE));
  assert.ok(/function traccia\.admin_invia_avviso_a_tutti\(/.test(MIGRAZIONE));
  /* due funzioni e non una con l'id opzionale: chiamarla senza id per sbaglio
     manderebbe a tutti un messaggio scritto per uno */
  assert.ok(/function public\.admin_invia_avviso\(/.test(MIGRAZIONE),
    "manca il wrapper pubblico: il client parla solo con `public.*`");
  assert.ok(/function public\.admin_invia_avviso_a_tutti\(/.test(MIGRAZIONE));
  assert.ok(/grant execute on function public\.admin_invia_avviso\(/.test(MIGRAZIONE),
    "senza grant il client riceve «permission denied»");
  assert.ok(/grant execute on function public\.admin_invia_avviso_a_tutti\(/.test(MIGRAZIONE));
});

test("«a tutti» non scrive a chi non ha una pratica attiva", () => {
  /* a un cliente sospeso una comunicazione dell'ufficio non serve, e a uno in
     attesa ricorda che non è ancora stato preso in carico */
  const funzione = MIGRAZIONE.slice(MIGRAZIONE.indexOf("admin_invia_avviso_a_tutti"));
  assert.ok(/status = 'active'/.test(funzione),
    "«a tutti» deve filtrare sulle pratiche attive");
  assert.ok(/not is_master/.test(funzione),
    "il master non ha una campanella: va escluso");
  assert.ok(/escluse/.test(funzione),
    "va detto quante ne sono state escluse, non troncato in silenzio");
});

test("un messaggio vuoto non diventa una campanella accesa", () => {
  const funzione = MIGRAZIONE.slice(MIGRAZIONE.indexOf("admin_invia_avviso("));
  assert.ok(/titolo is null/.test(funzione), "l'oggetto è obbligatorio");
  assert.ok(/testo is null/.test(funzione), "il testo è obbligatorio");
  assert.ok(/length\(titolo\) > 120/.test(funzione),
    "l'oggetto va limitato qui: oltre, viene tagliato dal CSS e nessuno se ne accorge");
});

test("l'invio resta nel registro attività, con chi e a chi", () => {
  const funzione = MIGRAZIONE.slice(MIGRAZIONE.indexOf("admin_invia_avviso("));
  assert.ok(/log_action\(a, 'avviso_inviato', t\.email/.test(funzione),
    "il registro deve dire a chi è stato mandato, e da chi");
  assert.ok(/'avviso_a_tutti'/.test(MIGRAZIONE),
    "anche l'invio a tutti va registrato: è il gesto che non si annulla");
});

/* --------------------------------------------------------------------------
   La console: si scrive da dove si guarda la pratica.
   -------------------------------------------------------------------------- */
test("il pulsante «Scrivi» sta sulla riga della pratica", () => {
  assert.ok(/data-scrivi="' \+/.test(ADMIN), "manca il pulsante nella riga");
  assert.ok(/scriviAlCliente\(scrivi\.getAttribute\("data-scrivi"\)\)/.test(ADMIN),
    "il pulsante deve essere collegato alla funzione");
  /* e non c'è per il master: non ha una campanella */
  const riga = ADMIN.slice(ADMIN.indexOf("var scriviBtn"), ADMIN.indexOf("var killBtn"));
  assert.ok(/user\.is_master \? ""/.test(riga),
    "all'account master non si manda un avviso: non ha una campanella");
});

test("«a tutti» dice a quante persone sta per arrivare", () => {
  /* un pulsante «a tutti» che non dice quante sono è un pulsante che si preme
     senza pensarci. Il numero è nella conferma, non in una schermata prima. */
  assert.ok(/Lo riceveranno " \+ attive\.length/.test(ADMIN),
    "la conferma deve dire quante pratiche riceveranno il messaggio");
  assert.ok(/Non si può annullare/.test(ADMIN),
    "va detto che non si annulla: è l'unica cosa che rende la conferma utile");
});

test("il modulo mostra a chi si sta scrivendo", () => {
  /* l'unico errore di questa funzione che non si annulla è mandarlo alla
     persona sbagliata: il nome deve stare nel titolo del modulo */
  assert.ok(/title: "Scrivi a " \+ \(pratica\.name/.test(ADMIN),
    "il nome del cliente deve essere nel titolo del modulo, non in una riga " +
    "della tabella che si può aver letto male");
});

test("il client chiama le funzioni giuste", () => {
  assert.ok(/inviaAvviso: function \(id, titolo, testo, kind\)/.test(API));
  assert.ok(/call\("admin_invia_avviso"/.test(API));
  assert.ok(/inviaAvvisoATutti: function/.test(API));
  assert.ok(/call\("admin_invia_avviso_a_tutti"/.test(API));
});

module.exports = casi;
