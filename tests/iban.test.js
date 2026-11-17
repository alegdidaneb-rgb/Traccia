/* ==========================================================================
   L'IBAN lo scrive una persona, non il database
   ==========================================================================
   Il difetto, raccontato dal cliente: aprendo la sua area trovava un IBAN
   italiano che non era il suo. Nessuno lo aveva scritto — lo aveva inventato
   `make_iban()`, che costruisce coordinate *plausibili*: ABI veri, CIN
   calcolato, checksum corretto. Talmente plausibili che nessuno se ne
   accorgeva, su una pagina dove il cliente aspetta dei soldi.

   Questi test non provano che il codice funziona: provano che **non torna**
   com'era. Un generatore che rientra da un vecchio file di migrazione è la
   cosa più facile che può succedere in questo repository, dove le funzioni si
   riscrivono per intero a ogni migrazione.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const MIGRAZIONE = fs.readFileSync(
  path.join(RADICE, "supabase/migrations/0032_iban_lo_scrive_la_persona.sql"), "utf8");
const API = fs.readFileSync(path.join(RADICE, "assets/js/api.js"), "utf8");
const ADMIN = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
const CASE = fs.readFileSync(path.join(RADICE, "assets/js/case.js"), "utf8");
const CSS = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* Il corpo di una funzione nel file di migrazione, dalla `create` alla chiusura
   `$$;`. Serve per guardare dentro una funzione precisa: cercare una stringa in
   tutto il file direbbe «c'è» anche quando è in un'altra funzione. */
function corpo(nome) {
  const inizio = MIGRAZIONE.indexOf(`function traccia.${nome}(`);
  assert.notStrictEqual(inizio, -1, `la migrazione non ridefinisce ${nome}`);
  const fine = MIGRAZIONE.indexOf("$$;", inizio);
  return MIGRAZIONE.slice(inizio, fine);
}

/* ------------------------------------------------------------------------
   Le quattro funzioni che generavano l'IBAN
   ------------------------------------------------------------------------ */
/* I nomi veri, non quelli che sembravano giusti: `auth_register` (non
   `register`) e `admin_create_account` (non `admin_crea_account`). La prima
   stesura di questa migrazione riscriveva funzioni che non esistono — il test
   l'ha presa, ed è il motivo per cui ora i nomi si controllano anche
   nell'altra direzione, qui sotto. E sono tre, non quattro: `auth_register`
   generava l'IBAN in due versioni (0002, 0023) e ne gira una sola. */
["auth_register", "admin_create_account",
 "admin_crea_account_da_richiesta"].forEach((nome) => {
  test(`${nome}: non genera più un IBAN`, () => {
    const f = corpo(nome);
    assert.ok(!/make_iban\s*\(/.test(f),
      `${nome} chiama ancora make_iban(): l'IBAN inventato è il difetto da chiudere`);
    /* i commenti si tolgono prima di guardare: il commento che *spiega* perché
       l'IBAN non c'è è la documentazione più utile di questa migrazione, e
       cacciarlo sarebbe il contrario di quello che serve */
    const codice = f.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    assert.ok(!/\biban\b/.test(codice),
      `${nome} parla ancora di iban nel codice: l'IBAN lo scrive il cliente o il ` +
      "master, non la creazione dell'account");
  });
});

test("le tre funzioni riscritte esistono, con questa firma, nella migrazione vera", () => {
  /* Una migrazione che ridefinisce funzioni inesistenti passa tutti i test che
     guardano i file — non tocca il database, quindi non fallisce niente — e
     arriva in produzione senza correggere nulla. È esattamente quello che è
     successo alla prima stesura di questa: riscriveva `register`, che non
     esiste, al posto di `auth_register`.

     E la seconda: `auth_register` ha **tre firme** (0002, 0023 e quella con
     `p_password` che il wrapper della 0024 dichiara di chiamare). Correggerne
     una sola significa non aver corretto niente. Qui si parte dalla chiamata
     del browser. */
  const FONTANA = fs.readFileSync(
    path.join(RADICE, "supabase/migrations/0023_richiesta_informazioni.sql"), "utf8");
  const ADMIN_API = fs.readFileSync(
    path.join(RADICE, "supabase/migrations/0004_admin_api.sql"), "utf8");
  const RICHIESTE = fs.readFileSync(
    path.join(RADICE, "supabase/migrations/0024_richiesta_senza_account.sql"), "utf8");

  assert.ok(/function traccia\.auth_register\(/.test(FONTANA),
    "auth_register non esiste in 0023: il nome nella migrazione è sbagliato");
  assert.ok(/function traccia\.admin_create_account\(/.test(ADMIN_API),
    "admin_create_account non esiste in 0004");
  assert.ok(/function traccia\.admin_crea_account_da_richiesta\(/.test(RICHIESTE),
    "admin_crea_account_da_richiesta non esiste in 0024");

  /* e la migrazione nuova deve definire esattamente quelle tre, con la firma
     della versione che vince — non una versione inventata a memoria */
  /* la firma vera, verificata sul database: comincia con `p_first_name` e non
     ha `p_password`. Quella della 0023 non esiste in produzione — quindi non va
     ricreata, e questo test lo impedisce */
  assert.ok(/function traccia\.auth_register\(\s*p_first_name text,/m.test(MIGRAZIONE),
    "la firma di auth_register non è quella viva: `p_first_name, p_last_name, ...`");
  assert.ok(!/function traccia\.auth_register\(\s*p_name text,\s*p_email text,/m.test(MIGRAZIONE),
    "la migrazione crea la firma della 0023, che in produzione non esiste: " +
    "correggere una funzione che nessuno chiama non chiude il difetto");
  assert.ok(/function traccia\.admin_create_account\(\s*p_token text, p_name text, p_email text,/m.test(MIGRAZIONE),
    "la firma di admin_create_account non è quella di 0004");
});

test("corregge la firma che il sito chiama davvero, non solo quella comoda", () => {
  /* L'errore più costoso di questa sessione, e vale la pena bloccarlo: le
     migrazioni passano dalla 0023 alla 0024 e `traccia.auth_register` ha tre
     firme diverse. Correggevo la 0023 — «la più recente» a occhio, perché 0024
     veniva dopo — ma il client chiama `public.auth_register` della 0024, che
     chiama la firma **con `p_password` e i parametri in un altro ordine**.
     Una migrazione che avesse corretto solo la 0023 non avrebbe cambiato niente
     nelle registrazioni vere: avrebbe chiuso una porta che nessuno usava.
     Qui si parte dalla chiamata del browser e si risale al corpo SQL. */
  const RICHIESTA = fs.readFileSync(
    path.join(RADICE, "supabase/migrations/0024_richiesta_senza_account.sql"), "utf8");
  const API_JS = fs.readFileSync(path.join(RADICE, "assets/js/api.js"), "utf8");

  /* il client manda questi parametri al wrapper */
  const invio = API_JS.slice(API_JS.indexOf('rpc("auth_register"'),
                             API_JS.indexOf('rpc("auth_register"') + 500);
  ["p_first_name", "p_last_name", "p_email", "p_phone", "p_amount_eur", "p_origine"]
    .forEach((p) => assert.ok(invio.indexOf(p) > -1,
      `il client non manda ${p}: la firma da correggere non è più questa`));

  /* il wrapper della 0024 chiama traccia.auth_register con i parametri fuori
     ordine: è quella la firma che deve esistere */
  const chiamata = RICHIESTA.slice(RICHIESTA.lastIndexOf("select traccia.auth_register("),
                                   RICHIESTA.lastIndexOf("select traccia.auth_register(") + 300);
  ["p_first_name", "p_last_name", "p_email", "p_phone", "p_amount_eur"]
    .forEach((p) => assert.ok(chiamata.indexOf(p) > -1,
      `il wrapper non passa ${p}: l'ordine dei parametri è cambiato`));

  /* e la migrazione deve definire quella firma, con `p_password` fra i
     parametri: se manca, il sito torna a generare IBAN */
  /* La firma giusta è questa, e la si riconosce dall'ordine: comincia con il
     nome e non ha `p_password`. Aggiungere un parametro che il wrapper non
     passa non serve a niente e il test dei wrapper lo rifiuta (giustamente). */
  assert.match(MIGRAZIONE,
    /function traccia\.auth_register\(\s*p_first_name text,\s*p_last_name\s+text,\s*p_email\s+text,\s*p_phone\s+text,\s*p_amount_eur numeric,\s*p_situation/m,
    "manca la firma (p_first_name, p_last_name, p_email, p_phone, p_amount_eur, p_situation, ...): " +
    "è quella che il sito chiama, e senza il corpo corretto continua a inventare IBAN");
  const corpoSito = MIGRAZIONE.slice(
    MIGRAZIONE.indexOf("p_first_name text,\n  p_last_name"),
    MIGRAZIONE.indexOf("$$;", MIGRAZIONE.indexOf("p_first_name text,\n  p_last_name")));
  assert.ok(corpoSito.indexOf("insert into traccia.users") === -1,
    "questa firma non crea utenti: crea una riga in `richieste`");
});

test("la migrazione non crea funzioni che in produzione non esistono", () => {
  /* Verificato sul database vero il 2026-10-31 (progetto mmjycpdfjlbckeefbtuq):
     `traccia.auth_register` ha **una sola** firma, quella a otto argomenti
     della 0024. Le versioni descritte dai file 0002 e 0023 non ci sono.

     Creare una di quelle qui vorrebbe dire, alla prossima ricostruzione del
     database dai file, avere una funzione in più che nessuno chiama — e la
     sensazione di aver corretto qualcosa. Le funzioni che questa migrazione
     deve ridefinire sono tre, e sono quelle che il database ha davvero. */
  const ATTESE = new Set([
    "auth_register",                 // una sola firma
    "admin_create_account",
    "admin_crea_account_da_richiesta",
    "make_iban_di_prova",            // nuova, per gli ambienti di prova
    "admin_imposta_iban",            // nuova, quella che mancava
    "imposta_iban",                  // riscritta per il messaggio del divieto
    "user_json",                     // riscritta per `has_iban`
  ]);
  const fatte = [...MIGRAZIONE.matchAll(/create or replace function traccia\.([a-z_]+)/g)]
    .map((m) => m[1]);
  const inattese = fatte.filter((f) => !ATTESE.has(f));
  assert.deepStrictEqual(inattese, [],
    "la migrazione definisce funzioni non previste: " + inattese.join(", "));
  assert.strictEqual(fatte.filter((f) => f === "auth_register").length, 1,
    "auth_register va definita una volta sola: ha una firma, non tre");
});

test("gli IBAN azzerati sono quelli che nessuno ha scritto", () => {
  /* L'azzeramento non è «svuota tutto»: si tolgono solo gli IBAN senza una
     voce `iban_set` nel registro, cioè quelli generati dal sistema. Un IBAN
     scritto da un cliente è un dato vero e non si tocca — nemmeno se non è
     verificato. */
  const f = MIGRAZIONE.slice(MIGRAZIONE.indexOf("gli IBAN finti, uno per uno"));
  assert.match(f, /where a\.action = 'iban_set'/, "manca il filtro su chi ha scritto l'IBAN");
  assert.match(f, /not exists \(select 1 from scritti/,
    "l'azzeramento deve escludere gli IBAN scritti da qualcuno");
});

test("il generatore resta, ma con un nome che dice che è di prova", () => {
  /* Non si cancella: serve agli ambienti di prova, dove un conto senza IBAN
     non si può collaudare. Si rinomina, perché un nome che dice «di prova»
     si legge in un `insert` di produzione e fa fermare chi lo rivede. */
  assert.match(MIGRAZIONE, /create or replace function traccia\.make_iban_di_prova\(\)/,
    "manca il generatore per gli ambienti di prova");
  assert.match(MIGRAZIONE, /revoke all on function traccia\.make_iban\(\) from public/,
    "senza revoke, make_iban resta richiamabile da chiunque");
});

test("la migrazione si ferma se una funzione rigenera l'IBAN", () => {
  /* Le migrazioni riscrivono le funzioni intere: basta riapplicare un file
     vecchio e il difetto torna, senza che nessuno se ne accorga. Il controllo
     finale della migrazione guarda i corpi veri nel database, non i file. */
  assert.match(MIGRAZIONE, /make_iban\(\)%\s*'/,
    "manca la guardia che cerca make_iban nei corpi delle funzioni");
  /* In SQL l'apostrofo si raddoppia (`l''IBAN`): la regex cerca il testo senza
     fissare quel dettaglio, altrimenti il test cade per l'escape sbagliato
     invece che per il motivo per cui esiste. */
  assert.match(MIGRAZIONE, /una funzione di creazione genera ancora/,
    "la guardia deve dire perché si ferma");
});

/* ------------------------------------------------------------------------
   L'IBAN scritto dalla console
   ------------------------------------------------------------------------ */
test("il master può scrivere l'IBAN di un cliente", () => {
  const f = corpo("admin_imposta_iban");
  assert.ok(/traccia\.need_admin\(p_token\)/.test(f),
    "senza need_admin la funzione risponde a chiunque abbia un gettone");
  assert.ok(/update traccia\.users/.test(f), "non scrive niente");
  assert.ok(/p_id/.test(f), "deve agire sull'utente indicato, non su chi chiama");
});

test("l'IBAN che scrive la console azzera la verifica", () => {
  /* È la protezione contro il dirottamento: chi entra nell'account del cliente
     non deve poter spostare i soldi su un conto suo e restare «verificato».
     Un IBAN nuovo non è un IBAN verificato, mai. */
  const f = corpo("admin_imposta_iban");
  assert.ok(/iban_verified_at\s*=\s*null/.test(f),
    "admin_imposta_iban deve azzerare iban_verified_at: un IBAN nuovo non è verificato");
});

test("l'IBAN scritto dalla console è validato come quello del cliente", () => {
  /* Due validazioni diverse sullo stesso dato sono due bugie che si
     contraddicono: una accetta un IBAN che l'altra rifiuta, e il cliente e
     l'ufficio vedono due comportamenti. Le regole devono essere le stesse. */
  const console_ = corpo("admin_imposta_iban");
  const cliente = corpo("imposta_iban");
  ["\\^\\[A-Z\\]\\{2\\}\\[0-9\\]\\{2\\}", "15", "34"].forEach((regola) => {
    assert.ok(new RegExp(regola).test(console_),
      `la console non applica la regola «${regola}» che il cliente ha`);
    assert.ok(new RegExp(regola).test(cliente),
      `il cliente non ha più la regola «${regola}»`);
  });
  assert.ok(/pulito := upper\(regexp_replace/.test(console_),
    "l'IBAN va normalizzato come nel percorso cliente");
});

test("l'intestatario è obbligatorio anche dalla console", () => {
  /* Un IBAN senza intestatario è un IBAN che la banca rifiuterà: scoprirlo un
     mese dopo, quando il bonifico torna indietro, è peggio che dirlo ora. */
  const f = corpo("admin_imposta_iban");
  assert.ok(/intestatario/.test(f) && /Indica l''intestatario/.test(f),
    "la console deve chiedere l'intestatario, non solo l'IBAN");
});

test("un amministratore non può cambiare l'IBAN dell'account master", () => {
  const f = corpo("admin_imposta_iban");
  assert.ok(/t\.is_master and not a\.is_master/.test(f),
    "manca la regola che vale in tutta la console: il master non si tocca");
});

test("il registro dice da che IBAN a che IBAN", () => {
  /* Un registro che scrive «modificato» non serve a ricostruire niente, e
     questo è il campo su cui passano i soldi. */
  assert.ok(/coalesce\(t\.iban, '—'\) \|\| ' → ' \|\| pulito/.test(corpo("admin_imposta_iban")),
    "il registro attività deve contenere il valore vecchio e quello nuovo");
});

test("il wrapper pubblico esiste, altrimenti il client non la raggiunge", () => {
  assert.match(MIGRAZIONE, /create function public\.admin_imposta_iban/,
    "il client parla solo con public.*: senza wrapper la funzione è irraggiungibile");
});

test("l'IBAN si può azzerare: la pagina deve saper dire «non indicato»", () => {
  /* `has_iban` esiste perché vuoto e assente sono due cose diverse, e ogni
     pezzo di interfaccia non deve inventarsi il proprio modo di dirlo. */
  assert.match(MIGRAZIONE, /'has_iban', u\.iban is not null/,
    "user_json deve dire se l'IBAN c'è: senza, la pagina non distingue vuoto da assente");
  assert.match(CASE, /Nessun IBAN indicato/,
    "la pagina del cliente deve dire che l'IBAN non c'è, invece di lasciare il segnaposto");
});

/* ------------------------------------------------------------------------
   Il giro completo: dal pulsante al database
   ------------------------------------------------------------------------ */
test("il client ha la chiamata, e con i nomi giusti", () => {
  assert.match(API, /adminImpostaIban: function \(id, iban, intestatario\)/,
    "manca la chiamata nell'API");
  assert.match(API, /call\("admin_imposta_iban", \{ p_id: id, p_iban: iban, p_intestatario/,
    "i nomi dei parametri devono essere quelli della funzione SQL");
});

test("la console ha il campo, e non dentro «Modifica»", () => {
  /* Correggere un cognome e cambiare l'IBAN sono due gesti diversi: il primo
     si fa senza pensarci, il secondo decide dove arrivano i soldi. Nello stesso
     dialogo, un giorno qualcuno cambierebbe un IBAN correggendo un refuso. */
  assert.match(ADMIN, /function scriviIban\(id\)/, "manca il dialogo dell'IBAN");
  assert.match(ADMIN, /data-iban-apri/, "manca il pulsante sulla riga della pratica");
  assert.ok(ADMIN.indexOf("function scriviIban") < ADMIN.indexOf("function modificaPratica"),
    "scriviIban deve stare fuori da modificaPratica: sono gesti diversi");

  const bloccoModifica = ADMIN.slice(ADMIN.indexOf("function modificaPratica"),
                                     ADMIN.indexOf("function scriviIban") === -1
                                       ? undefined : ADMIN.indexOf("function modificaPratica") + 4000);
  assert.ok(!/iban/i.test(bloccoModifica.slice(0, 3000)),
    "«Modifica» non deve contenere un campo IBAN");
});

test("la riga della pratica mostra l'IBAN e il suo stato", () => {
  assert.match(ADMIN, /function ibanRiga\(user\)/, "manca la riga dell'IBAN in console");
  assert.match(ADMIN, /IBAN non indicato/,
    "quando manca va detto «non indicato»: «—» sembra un dato mancante per sbaglio");
  assert.ok(/verificato/.test(ADMIN) && /da verificare/.test(ADMIN),
    "lo stato va scritto per esteso: «ok» e «?» non dicono niente");
});

test("l'IBAN sulla riga si può leggere e toccare senza aprirsi l'occhio", () => {
  /* La classe esiste nell'HTML generato: senza una regola, il numero esce
     fuori dal ritmo della riga e il pulsante sembra testo qualunque. */
  ["\\.pratica__iban\\b", "\\.pratica__iban--assente", "\\.pratica__iban-scrivi"].forEach((sel) => {
    assert.ok(new RegExp(sel).test(CSS), `manca la regola ${sel} in premium.css`);
  });
  const regola = CSS.slice(CSS.indexOf(".pratica__iban {"), CSS.indexOf(".pratica__iban {") + 400);
  assert.ok(/display:\s*inline-flex/.test(regola),
    "l'IBAN e il pulsante devono stare sulla stessa riga, non uno sotto l'altro");
});

test("il dialogo avvisa quando il cliente ha dei soldi sul conto", () => {
  /* È il caso in cui il cambio lo facciamo noi — l'unico per cui questa
     funzione esiste. Chi la usa deve sapere che sta toccando un conto con
     denaro dentro, non scoprirlo dopo. */
  assert.match(ADMIN, /Questo cliente ha denaro sul conto/,
    "il dialogo deve dire quando il conto ha un saldo: è il caso delicato");
});

test("il dialogo controlla l'IBAN prima di chiamare il server", () => {
  /* Lo stesso controllo c'è nel database, ed è quello che conta; questo serve a
     non far fare un giro di rete per un errore che si legge subito. */
  assert.match(ADMIN, /IBAN non valido: servono almeno 15 caratteri/,
    "il dialogo deve validare l'IBAN prima di salvare");
});

/* ------------------------------------------------------------------------
   Il cliente: può scriverlo, non può dirottare
   ------------------------------------------------------------------------ */
test("il cliente cambia il proprio IBAN solo finché non ci sono soldi", () => {
  /* La regola che c'era già, e che resta: con un saldo attivo il cliente non
     sposta le coordinate da solo, perché è così che si intercetta un conto
     dirottato. Adesso il messaggio dice a chi rivolgersi **e quella persona
     ha lo strumento**, che è la parte che mancava. */
  const f = corpo("imposta_iban");
  assert.ok(/balance_eur > 0 or u\.reserved_eur > 0/.test(f),
    "il cliente non deve poter cambiare l'IBAN con un saldo attivo");
  assert.ok(/lo cambiamo noi/.test(f),
    "il messaggio deve dire che lo facciamo noi, non mandare a un ufficio senza strumenti");
});

module.exports = casi;
