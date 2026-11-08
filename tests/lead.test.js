/* ==========================================================================
   Il sistema dei lead
   ==========================================================================
   Il cliente, il giorno prima della campagna: «abbiamo bisogno di un sistema
   dove anche riceve i lead».

   Lo schema c'era già: il modulo scrive in `traccia.richieste` dal 2026-11-06.
   Quello che mancava era tutto il resto — vederle, muoverle, e **sapere che
   sono arrivate**. Un lead che nessuno guarda non è un lead, è una persona che
   ha appena perso dei soldi e aspetta.

   Questi test guardano le quattro cose che, se mancano, rendono inutile il
   resto: la console che le mostra, le azioni che le muovono, il contatore che
   dice quante sono, e la notifica che avvisa senza poter far fallire il modulo.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");

const ADMIN_HTML = R("admin.html");
const ADMIN_JS = R("assets/js/admin.js");
const API_JS = R("assets/js/api.js");
const MIGRAZIONE = R("supabase/migrations/0025_notifica_lead.sql");
const RICHIESTA = R("supabase/migrations/0024_richiesta_senza_account.sql");

/* ------------------------------------------------------------------ console -- */
test("la console ha una sezione per le segnalazioni, separata dagli account", () => {
  /* «Richieste account» e le segnalazioni dal sito sono due cose diverse: la
     prima è un cliente che ha già una pratica, la seconda una persona che ha
     compilato un modulo e aspetta una telefonata. Mescolarle fa perdere le
     seconde, che sono quelle con una scadenza. */
  assert.match(ADMIN_HTML, /id="lead"/, "manca la sezione delle segnalazioni");
  assert.match(ADMIN_HTML, /data-tab="lead"/, "manca la voce nella barra laterale");
  assert.match(ADMIN_HTML, /id="lead-table"/, "manca la tabella");
  ["Attesa", "Persona", "Importo", "Lingua", "Stato"].forEach((colonna) => {
    assert.ok(ADMIN_HTML.includes(colonna), `manca la colonna «${colonna}»`);
  });
});

test("le segnalazioni si caricano all'apertura, non a richiesta", () => {
  /* il difetto da evitare è quello classico: la schermata esiste e resta
     vuota perché nessuno la chiama */
  assert.match(ADMIN_JS, /function loadRichieste\(/);
  const dentro = ADMIN_JS.slice(ADMIN_JS.indexOf("function refresh()"));
  assert.match(dentro.slice(0, 400), /loadRichieste\(\)/,
    "refresh() non carica le segnalazioni");
  assert.match(API_JS, /rpc|call\("admin_richieste"/,
    "api.js non chiama admin_richieste");
});

test("ogni segnalazione si può muovere, e i bottoni sono quelli giusti", () => {
  /* new → contacted → account → closed ; «denied» quando non è il nostro caso */
  ["contacted", "account", "closed", "denied"].forEach((stato) => {
    assert.ok(ADMIN_JS.includes(`data-stato="${stato}"`) ||
              ADMIN_JS.includes(`'${stato}'`),
      `manca il passaggio di stato «${stato}»`);
  });
  assert.match(ADMIN_JS, /tel:' \+ ui\.esc\(r\.phone\)/, "manca il pulsante per chiamare");
  assert.match(API_JS, /richiestaStato: function/, "api.js non ha richiestaStato");
});

test("l'attesa è la prima colonna, e oltre 48 ore si vede", () => {
  /* In una tabella di venti righe nessuno legge le cifre: il colore dice
     quello che il numero dice già. E il dato che cambia la giornata non è chi
     ha scritto, è da quanto tempo aspetta. */
  assert.match(ADMIN_JS, /function attesaOre/);
  assert.match(ADMIN_JS, /ore >= 48/, "manca la soglia delle 48 ore");
  assert.match(ADMIN_JS, /is-alert/);
  assert.ok(ADMIN_HTML.indexOf("Attesa") < ADMIN_HTML.indexOf("Persona"),
    "l'attesa deve venire prima del nome");
});

/* -------------------------------------------------------------- notifiche -- */
test("la notifica non può far fallire il modulo", () => {
  /* chi ha perso 12.000 € non deve vedere «errore» perché il bot Telegram era
     irraggiungibile */
  assert.match(MIGRAZIONE, /exception when others then/,
    "l'annuncio non è protetto da un gestore di eccezioni");
  const registrazione = MIGRAZIONE.slice(MIGRAZIONE.indexOf("create or replace function traccia.auth_register"));
  assert.match(registrazione, /begin\s+perform traccia\.annuncia_lead/,
    "la chiamata all'annuncio non è dentro un blocco protetto");
  assert.match(registrazione, /exception when others then\s+insert into traccia\.notifiche/,
    "un guasto della notifica non viene registrato");
});

test("il segreto del webhook non sta nel codice né nel database in chiaro", () => {
  /* il token di un bot Telegram in un repository pubblico è un bot preso in
     mano da chiunque */
  assert.match(MIGRAZIONE, /from vault\.decrypted_secrets/,
    "il webhook non viene letto dal vault");
  assert.ok(!/https:\/\/api\.telegram\.org\/bot[0-9]/.test(MIGRAZIONE),
    "c'è un token vero dentro la migrazione");
  assert.match(MIGRAZIONE, /create extension if not exists pg_net/,
    "manca pg_net: senza, la chiamata HTTP non parte");
});

test("senza canale configurato la segnalazione si salva lo stesso", () => {
  assert.match(MIGRAZIONE, /senza-canale/,
    "manca il caso «nessun webhook configurato»");
  assert.match(MIGRAZIONE, /if url is null then[\s\S]{0,300}return;/,
    "senza webhook la funzione non esce prima di provare la chiamata");
});

test("la migrazione non tocca i dati esistenti", () => {
  /* deve poter essere applicata su un database che ha già delle segnalazioni:
     niente drop, niente truncate, niente alter che perda righe */
  ["drop table", "truncate", "delete from traccia.richieste"].forEach((pericolo) => {
    assert.ok(!MIGRAZIONE.toLowerCase().includes(pericolo),
      `la migrazione contiene «${pericolo}»`);
  });
  assert.match(MIGRAZIONE, /create table if not exists traccia\.notifiche/,
    "la tabella delle notifiche deve essere creata solo se non c'è");
});

/* ---------------------------------------------------- il modulo che li crea -- */
test("il modulo del sito manda tutti e cinque i dati che la console mostra", () => {
  /* se un campo non parte, la console mostra una riga vuota e l'analista
     chiama senza sapere di che cosa si parla */
  const api = R("assets/js/api.js");
  ["p_first_name", "p_last_name", "p_email", "p_phone", "p_amount_eur", "p_situation"]
    .forEach((campo) => {
      assert.ok(api.includes(campo), `api.js non manda «${campo}»`);
    });
  /* e la funzione nel database deve accettarli tutti */
  ["p_first_name", "p_last_name", "p_email", "p_phone", "p_amount_eur", "p_situation"]
    .forEach((campo) => {
      assert.ok(RICHIESTA.includes(campo), `la funzione 0024 non ha «${campo}»`);
    });
});

test("la console controlla da sola, e avvisa quando il numero sale", () => {
  /* Senza questo, la console mostra i lead solo se qualcuno la ricarica: il
     sistema esiste e non serve a niente. E l'avviso non deve suonare al primo
     giro, altrimenti ogni apertura «scopre» segnalazioni già viste e si impara
     a ignorarlo. */
  assert.match(ADMIN_JS, /setInterval\(function \(\) \{[\s\S]{0,400}api\.richieste\("new"\)/,
    "manca il controllo periodico delle segnalazioni nuove");
  assert.match(ADMIN_JS, /60000/, "il controllo non ha un intervallo");
  assert.match(ADMIN_JS, /var ultimoConteggio = null;/,
    "manca la memoria del conteggio precedente: l'avviso suonerebbe a ogni apertura");
  assert.match(ADMIN_JS, /if \(precedente === null \|\| conteggio <= precedente\) return;/,
    "l'avviso non distingue «primo giro» da «numero salito»");
  assert.match(ADMIN_JS, /new Notification\(/,
    "manca la notifica del browser");
  assert.match(ADMIN_JS, /Notification\.permission === "default"/,
    "il permesso delle notifiche non viene chiesto una volta sola");
  /* e la notifica non deve poter fermare il resto della console */
  assert.match(ADMIN_JS, /catch \(e\) \{ \/\* un browser che non le supporta/,
    "la notifica non è protetta: un browser senza supporto romperebbe admin.js");
});

module.exports = casi;
