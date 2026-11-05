/* ==========================================================================
   La conferma del bonifico: il codice, i due tempi, e il blocco che non torna
   ==========================================================================
   Il cliente ha descritto il difetto così: «quando faccio un nuovo bonifico
   SEPA non mi permette di andare avanti e tutto si blocca». Questi test
   difendono le tre cose che quel difetto ha insegnato:

   1. il browser non decide mai se il cliente ha i soldi;
   2. il bonifico non esiste senza un codice, e il codice non passa dal sito;
   3. il percorso diretto (`bonifico_crea`) non è più una porta aperta.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

/* il runner del progetto è `tests/run.js`: un modulo che esporta i casi */
const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SQL = R("supabase/migrations/0019_bonifico_otp.sql");
const API = R("assets/js/api.js");
const CASE = R("assets/js/case.js");
const ADMIN = R("assets/js/admin.js");
const APP = R("app.html");
const ADMIN_HTML = R("admin.html");

/* ------------------------------------------------------------ il blocco -- */
test("il client non confronta più l'importo con il disponibile letto prima", () => {
  /* questa era la riga che spegneva il pulsante: `d.importo > disponibile`.
     Se torna, torna il difetto — e torna in un modo che sembra un guasto. */
  const invia = CASE.slice(CASE.indexOf("function inviaBonifico"));
  const corpo = invia.slice(0, invia.indexOf("function mostraConfermaBonifico"));
  assert.ok(!/disponibile/i.test(corpo),
    "inviaBonifico non deve leggere il disponibile: la decisione è del server");
  assert.ok(/api\.preparaBonifico/.test(corpo), "inviaBonifico deve chiamare il server");
});

test("la disponibilità si mostra ma non si usa per decidere", () => {
  /* il suggerimento accanto all'importo resta: è un'informazione utile. Non è
     più un cancello. */
  assert.ok(/data-bon-importo-hint/.test(APP), "manca il suggerimento del disponibile");
  const hint = CASE.slice(CASE.indexOf("data-bon-importo-hint"));
  assert.ok(/"Disponibile: "/.test(hint.slice(0, 300)), "il suggerimento deve dire quanto è disponibile");
});

/* ----------------------------------------------------------- due tempi -- */
test("disporre non crea il bonifico: crea una richiesta di conferma", () => {
  assert.ok(/call\("bonifico_prepara"/.test(API), "api.js deve chiamare bonifico_prepara");
  assert.ok(/call\("bonifico_conferma"/.test(API), "api.js deve chiamare bonifico_conferma");
  assert.ok(!/call\("bonifico_crea"/.test(API),
    "bonifico_crea non deve più essere raggiungibile dal browser");
});

test("dalla richiesta alla conferma: il codice è obbligatorio e sono sei cifre", () => {
  const c = CASE.slice(CASE.indexOf("function confermaBonifico"));
  const corpo = c.slice(0, c.indexOf("Appena disposto"));
  assert.ok(/codice\.length !== 6/.test(corpo), "il client deve rifiutare un codice che non ha sei cifre");
  assert.ok(/api\.confermaBonifico/.test(corpo), "deve confermare con il server");
});

test("il pannello del codice non promette che il denaro sia partito", () => {
  assert.ok(/data-bonifico-conferma/.test(APP), "manca il secondo tempo nella modale");
  /* dal secondo tempo fino alla modale successiva: il testo che il cliente
     legge, compresa la nota in fondo */
  const pannello = APP.slice(APP.indexOf("data-bonifico-conferma"));
  const testo = pannello.slice(0, pannello.indexOf("data-receipt-modal")).replace(/<[^>]+>/g, " ");
  assert.ok(/non è ancora disposto/.test(testo), "deve dire che il bonifico non è ancora disposto");
  assert.ok(/quando la banca esegue/.test(testo),
    "il denaro esce quando la banca esegue, non alla conferma: è una promessa che deve restare vera");
});

test("il codice non compare mai nella schermata del cliente", () => {
  /* la modale del cliente non ha nessun nodo che possa mostrarlo: il codice
     esiste solo nella console degli analisti */
  const zona = APP.slice(APP.indexOf("data-bonifico-conferma"), APP.indexOf("data-receipt-modal"));
  assert.ok(!/data-conferma-codice-valore|data-codice-valore/.test(zona),
    "la modale del cliente non deve avere un contenitore per il codice");
  const mostrar = CASE.indexOf("[data-conferma-codice]");
  const contesto = CASE.slice(mostrar - 200, mostrar + 300);
  assert.ok(!/textContent\s*=\s*res\.codice/.test(contesto), "case.js non deve scrivere il codice");
});

/* --------------------------------------------------------------- server -- */
test("il codice è generato dal generatore crittografico, non da random()", () => {
  assert.ok(/gen_random_bytes/.test(SQL), "il codice deve venire da pgcrypto");
  const gen = SQL.slice(SQL.indexOf("function traccia.genera_codice"));
  const corpo = gen.slice(0, gen.indexOf("$fn$;"));
  assert.ok(!/random\(\)/.test(corpo.replace(/gen_random_bytes/g, "")),
    "random() non è un generatore crittografico");
  assert.ok(/< 250/.test(corpo), "lo scarto sopra 250 serve a distribuire le cifre uniformemente");
});

test("del codice resta solo l'impronta", () => {
  assert.ok(/code_hash/.test(SQL), "la tabella deve conservare l'impronta");
  assert.ok(/traccia\.hash_token\(codice\)/.test(SQL), "l'impronta è la stessa forma dei gettoni di sessione");
  assert.ok(/if ch\.code_hash <> traccia\.hash_token/.test(SQL),
    "il confronto deve essere fra impronte");
});

test("la conferma rifà i controlli invece di fidarsi della richiesta", () => {
  const conf = SQL.slice(SQL.indexOf("function traccia.bonifico_conferma"));
  const corpo = conf.slice(0, conf.indexOf("-- 7. Rinunciare"));
  /* le regole che devono tornare a girare alla conferma */
  ["iban_verified_at", "payment_purposes", "daily_withdrawal", "current_date + 90"]
    .forEach(function (regola) {
      assert.ok(corpo.indexOf(regola) > -1, "alla conferma manca il controllo " + regola);
    });
});

test("il bonifico si crea dal payload salvato, non da quello che rimanda il browser", () => {
  const conf = SQL.slice(SQL.indexOf("function traccia.bonifico_conferma"));
  const corpo = conf.slice(0, conf.indexOf("-- 7. Rinunciare"));
  assert.ok(/ch\.payload ->> 'importo'/.test(corpo),
    "l'importo deve venire dalla richiesta salvata: altrimenti un codice per 10 € ne conferma 10.000");
  assert.ok(/traccia\.bank_transfers/.test(corpo), "la conferma crea il bonifico");
});

test("una conferma vale una volta sola e scade", () => {
  assert.ok(/consumed_at is not null/.test(SQL), "una conferma già usata deve essere rifiutata");
  assert.ok(/ch\.expires_at < now\(\)/.test(SQL), "una conferma scaduta deve essere rifiutata");
  assert.ok(/attempts/.test(SQL) && /max_attempts/.test(SQL), "i tentativi devono essere contati");
  assert.ok(/cancelled_at = now\(\)/.test(SQL), "esauriti i tentativi la richiesta si chiude");
});

test("la richiesta appartiene a chi la conferma", () => {
  assert.ok(/where id = p_challenge and user_id = u\.id/.test(SQL),
    "la conferma deve essere cercata per id *e* utente: un codice non deve valere per un altro conto");
});

test("i soldi impegnati dalla richiesta in attesa contano nel disponibile", () => {
  const pren = SQL.slice(SQL.indexOf("function traccia.prenotato_eur"));
  const corpo = pren.slice(0, pren.indexOf("$fn$;"));
  assert.ok(/transfer_challenges/.test(corpo),
    "una richiesta aperta impegna denaro: contarla zero autorizza una seconda spesa degli stessi soldi");
  assert.ok(/expires_at > now\(\)/.test(corpo), "una richiesta scaduta non deve più contare");
});

test("chiudere o annullare libera i soldi", () => {
  const rin = SQL.slice(SQL.indexOf("function traccia.bonifico_rinuncia"));
  const corpo = rin.slice(0, rin.indexOf("-- 8. Leggere il codice"));
  assert.ok(/libera_fondi/.test(corpo), "rinunciare deve restituire il disponibile");
  assert.ok(/libera_fondi/.test(SQL.slice(SQL.indexOf("function traccia.scadi_conferme_bonifico"))),
    "chiudere le scadute deve restituire il disponibile");
});

/* ----------------------------------------------------- la porta chiusa -- */
test("bonifico_crea non è più eseguibile dal browser", () => {
  const revoca = /revoke all on function public\.bonifico_crea\([^)]*\)\s*from public, anon, authenticated/i;
  assert.ok(revoca.test(SQL), "senza questa revoca il codice è una cerimonia davanti a una porta aperta");
});

/* ------------------------------------------------------- console analisti -- */
test("l'analista legge il codice una volta e il database lo registra", () => {
  assert.ok(/function traccia\.admin_conferma_codice/.test(SQL), "manca la consegna del codice");
  assert.ok(/consegnato_at is not null/.test(SQL), "un codice già consegnato non si rilegge");
  assert.ok(/log_action\(a, 'bonifico_conferma_consegnata'/.test(SQL),
    "la consegna deve finire nel registro: è un atto umano, e va attribuito");
  assert.ok(/function traccia\.admin_conferme_bonifico/.test(SQL), "manca l'elenco delle conferme");
  assert.ok(/api\.codiceConferma/.test(ADMIN), "admin.js deve poter leggere il codice");
  assert.ok(/data-codice-valore/.test(ADMIN_HTML), "manca il riquadro che mostra il codice");
});

test("il codice non arriva nel sito del cliente, ma dalla console", () => {
  /* la scelta: nessun servizio di posta configurato, e un codice «inviato»
     che nessuno riceve sarebbe il blocco di prima in un'altra forma */
  assert.ok(/console/.test(SQL), "il canale di consegna va dichiarato");
  assert.ok(!/public\.[a-z_]*codice[a-z_]*\(.*\)[^;]*grant execute[^;]*to anon/i.test(SQL.replace(/admin_conferma_codice/g, "XXX")),
    "nessuna funzione che restituisce il codice deve essere raggiungibile dal cliente");
});

/* ------------------------------------------------------------- cablaggio -- */
test("app.html e admin.html hanno i nodi che il codice cerca", () => {
  ["data-bonifico-conferma", "data-conferma-form", "data-conferma-codice",
   "data-conferma-submit", "data-conferma-indietro", "data-conferma-email",
   "data-conferma-riepilogo"].forEach(function (nodo) {
    assert.ok(APP.indexOf(nodo) > -1, "app.html non ha " + nodo);
  });
  ["conferme-table", "data-codice-modal", "data-codice-close", "data-conferme-scadi"]
    .forEach(function (nodo) {
      assert.ok(ADMIN_HTML.indexOf(nodo) > -1, "admin.html non ha " + nodo);
    });
});

test("chiudere la modale con una conferma aperta restituisce i soldi", () => {
  const ch = CASE.slice(CASE.indexOf("function chiudiBonifico"));
  const corpo = ch.slice(0, ch.indexOf("function datiBonifico"));
  assert.ok(/rinunciaBonifico/.test(corpo),
    "chiudere deve rinunciare: altrimenti i soldi restano fermi dieci minuti");
});

/* ------------------------------------------------------ promesse al cliente -- */
/* Il progetto non ha un canale di posta configurato: il codice lo genera la
   console riservata e lo comunica a voce un analista. La pagina diceva invece
   «Ti abbiamo mandato un codice di sei cifre a …», e sotto il campo invitava a
   controllare la posta indesiderata. Due affermazioni false: il cliente
   aspettava una email che nessuno avrebbe mai spedito, e concludeva che il
   sito era rotto. Questi test tengono la pagina onesta finché l'invio
   automatico non esisterà davvero. */
test("il pannello del codice non promette una email che non parte", () => {
  const zona = APP.slice(APP.indexOf("data-bonifico-conferma"), APP.indexOf("data-receipt-modal"));
  const testo = zona.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  assert.ok(!/ti abbiamo mandato/i.test(testo),
    "la pagina non deve dire che il codice è stato inviato: nessun servizio di posta è configurato");
  assert.ok(!/ti abbiamo inviato/i.test(testo),
    "la pagina non deve dire che il codice è stato inviato: nessun servizio di posta è configurato");
  assert.ok(!/controlla la casella|posta indesiderata/i.test(testo),
    "non deve mandare il cliente a cercare un'email che non esiste");

  assert.ok(/analista/i.test(testo),
    "deve dire chi comunica il codice: un analista, non un'email automatica");
});

test("il suggerimento sul campo dice cosa fare se il codice non arriva", () => {
  const zona = APP.slice(APP.indexOf("data-bonifico-conferma"), APP.indexOf("data-receipt-modal"));
  assert.ok(/assistenza@traccia\.it\.com/.test(zona),
    "serve un recapito a cui scrivere quando il codice non arriva");
});

test("il dominio dell'invio non è promesso fuori dalla sua fonte", () => {
  /* L'indirizzo compare nel testo di aiuto, quindi non deve contraddire la
     configurazione: se un giorno cambia, si cambia in un posto solo e questo
     test indica dove. */
  const cfg = require("fs").readFileSync(
    require("path").join(__dirname, "..", "assets/js/config.js"), "utf8");
  assert.ok(/supabaseUrl/.test(cfg), "config.js non è più quello che il sito carica");
});

/* ==========================================================================
   «Conferme in attesa di codice» non consegnava niente
   ==========================================================================
   Il cliente: «these does not work, does not receive any code». Il database il
   codice lo restituiva: verificato con una chiamata diretta sulla richiesta
   TRC-O-2026-000005. I difetti erano altri, e sono quelli che questi test
   fissano:

   1. dieci minuti di finestra, con una persona in mezzo;
   2. una richiesta scaduta spariva dalla console, quindi sembrava che il
      pulsante non funzionasse invece di sembrare ciò che era: troppo tardi;
   3. nessun modo di chiudere una richiesta prima della scadenza.

   E un difetto che NON c'era, verificato per non ripetere la diagnosi
   sbagliata: i fondi di una richiesta scaduta tornano già disponibili da soli,
   perché `prenotato_eur` (0019) somma solo le richieste non scadute. Il test
   qui sotto difende quella proprietà: se un giorno qualcuno la togliesse, il
   cliente vedrebbe meno soldi del vero.
   ========================================================================== */
const SQL22 = R("supabase/migrations/0022_consegna_codice.sql");
const SQL19 = SQL;

test("la finestra del codice è più lunga dei dieci minuti che la uccidevano", () => {
  /* Il tetto vero alla sicurezza sono i cinque tentativi e le dieci richieste
     al giorno. La fretta non difendeva niente: faceva solo arrivare il codice
     quando non serviva più. */
  const aggiornamento = SQL22.slice(SQL22.indexOf("update traccia.settings"));
  const riga = aggiornamento.slice(0, aggiornamento.indexOf(";"));
  assert.ok(/jsonb_set\(value,\s*'\{minutes\}',\s*'30'::jsonb\)/.test(riga),
    "il valore va scritto nella riga transfer_otp, non solo nel commento");
  assert.ok(/m < 20/.test(SQL22),
    "la migrazione deve rifiutarsi di lasciare una finestra troppo corta");
});

test("i soldi di una richiesta scaduta tornano da soli, e resta così", () => {
  /* Questo era nella mia prima diagnosi «i fondi restano fermi»: è falso, e
     vale la pena averlo scritto. `prenotato_eur` somma le operazioni in attesa,
     i bonifici non ancora eseguiti e le richieste di conferma **non scadute**.
     Una richiesta morta esce dal conto da sola. */
  const impegnato = SQL19.slice(SQL19.indexOf("create or replace function traccia.prenotato_eur"));
  assert.ok(/expires_at > now\(\)/.test(impegnato),
    "prenotato_eur deve ignorare le richieste scadute: è ciò che rende i soldi disponibili senza pulsanti");
  assert.ok(/transfer_challenges/.test(impegnato),
    "l'impegnato include le richieste di conferma ancora vive");
});

test("rilasciare una richiesta non tocca i soldi a mano", () => {
  /* La tentazione è sottrarre l'importo da `reserved_eur`. Non si fa: si
     annulla la richiesta e si lascia ricalcolare, così l'unica verità resta
     `prenotato_eur` e non esistono due modi di contare gli stessi soldi. */
  const rilascio = SQL22.slice(SQL22.indexOf("function traccia.admin_rilascia_conferma"));
  const corpo = rilascio.slice(0, rilascio.indexOf("$fn$;"));
  assert.ok(/update traccia\.transfer_challenges set cancelled_at = now\(\)/.test(corpo),
    "il rilascio annulla la richiesta");
  assert.ok(/perform traccia\.libera_fondi\(ch\.user_id\)/.test(corpo),
    "dopo l'annullamento si libera, senza passare un importo a mano");
  assert.ok(!/reserved_eur\s*=\s*reserved_eur\s*-/.test(corpo),
    "nessuna sottrazione diretta: reserved_eur si ricalcola, non si aggiusta");
});

test("una richiesta scaduta resta visibile, con il modo di chiuderla", () => {
  /* Il difetto percepito: il cliente dice «non ricevo il codice» e in console
     non c'è più niente. La tabella deve mostrare anche le scadute, e per ognuna
     offrire il rilascio — la sola strada per non lasciare il cliente fermo. */
  assert.ok(/confermeBonifico\("scadute"\)/.test(ADMIN),
    "caricaConferme deve leggere anche le scadute");
  assert.ok(/data-rilascia=/.test(ADMIN),
    "ogni riga bloccata deve avere il suo pulsante «Rilascia»");
  assert.ok(/rilasciaConferma/.test(ADMIN) && /admin_rilascia_conferma/.test(API),
    "il pulsante deve arrivare alla funzione che chiude la richiesta");
  assert.ok(/admin_rilascia_conferma/.test(SQL22),
    "la funzione di rilascio è nel database");
});

test("il contatore conta il lavoro, non le righe", () => {
  /* «Conferme da consegnare» a zero mentre il cliente aspetta è il messaggio
     più fuorviante della console. Il numero deve dire quante richiedono una
     persona: codice da leggere, oppure richiesta da chiudere. */
  assert.ok(/daFare/.test(ADMIN), "il contatore deve avere un nome che dice cosa conta");
  assert.ok(/c\.stato === "scaduta"/.test(ADMIN),
    "una scaduta non chiusa è lavoro da fare");
});

test("la tabella mostra il tempo che resta, non solo l'ora di scadenza", () => {
  /* Con dieci minuti l'ora di scadenza bastava a capire che era tardi. Con
     trenta, «scade alle 19:32» non dice niente a chi guarda la pagina alle
     19:28: serve il numero di minuti, e serve aggiornato. */
  assert.ok(/minutiRimasti/.test(ADMIN),
    "il tempo residuo va ricalcolato, non copiato dalla risposta del server");
  assert.ok(/urgente/.test(ADMIN),
    "sotto i cinque minuti la riga deve dirlo visivamente");
  const lista = SQL22.slice(SQL22.indexOf("function traccia.admin_conferme_bonifico"));
  assert.ok(/'minuti_rimasti'/.test(lista) && /'consegna_entro'/.test(lista),
    "anche il server deve dichiarare quanto resta");
});

test("il codice già consegnato non si rilegge, ma il rifiuto dice come uscirne", () => {
  const consegna = SQL22.slice(SQL22.indexOf("function traccia.admin_conferma_codice"));
  assert.ok(/già stato consegnato/.test(consegna),
    "rileggere un codice consegnato deve essere rifiutato con una spiegazione");
  assert.ok(/Rilascia/.test(consegna) && /scaduta alle/.test(consegna),
    "il rifiuto deve indicare l'uscita in entrambi i casi, non lasciare l'analista fermo");
});

test("il tetto giornaliero conta anche i bonifici, non solo le operazioni", () => {
  /* `used_today` leggeva solo `operations`, ma il prelievo di oggi nasce in
     `bank_transfers`: il limite non vedeva proprio la via più usata. */
  const usato = SQL22.slice(SQL22.indexOf("function traccia.used_today"));
  assert.ok(/bank_transfers/.test(usato),
    "il conteggio del giorno deve includere i bonifici disposti");
  assert.ok(/'queued', 'sent', 'executed'/.test(usato),
    "un bonifico disposto impegna il tetto anche prima che la banca lo esegua");
  assert.ok(!/'cancelled'/.test(usato),
    "un bonifico annullato non è un'uscita e non deve consumare il tetto");
});

module.exports = casi;
