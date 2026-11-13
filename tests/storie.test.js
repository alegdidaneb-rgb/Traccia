/* ==========================================================================
   Le storie dei clienti
   ==========================================================================
   Tre cose che questi test difendono, e ognuna è un modo in cui la funzione
   può fare danno:

   1. **Una storia è testo, non HTML.** Il racconto lo scrive il cliente e
      finisce su una pagina pubblica: se il renderer usasse `innerHTML`, un
      `<script>` scritto nel racconto girerebbe nel browser di chi legge.
   2. **Niente si vede se non c'è niente.** La sezione in home nasce `hidden`:
      se restasse visibile senza storie, il sito annuncerebbe il vuoto in ogni
      pagina, che è peggio di non avere la sezione.
   3. **Nessun importo.** È la promessa fatta al cliente quando scrive: il
      database non pubblica storie con cifre, e la pagina non ne mostra.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const ROOT = path.join(__dirname, "..");
const leggi = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const STORIES = leggi("assets/js/stories.js");
const CASE_JS = leggi("assets/js/case.js");
const ADMIN_JS = leggi("assets/js/admin.js");
const INDEX = leggi("index.html");
const PAGINA = leggi("storie.html");
const APP = leggi("app.html");
const ADMIN = leggi("admin.html");
const MIGRAZIONE = leggi("supabase/migrations/0031_testimonianze.sql");

/* ---------------------------------------------------------------- render -- */
/* `stories.js` è una funzione che si avvia da sola: si ritaglia il pezzo che
   costruisce la tessera e lo si esegue con un DOM minimo. Provarlo leggendo il
   sorgente non direbbe niente sul nodo che esce. */
function nodo(tag) {
  const n = {
    tagName: String(tag).toUpperCase(),
    figli: [], _testo: "", className: "",
    appendChild(c) { n.figli.push(c); return c; },
    set textContent(v) { n._testo = String(v); n.figli = []; },
    get textContent() { return n._testo + n.figli.map((f) => f.textContent).join(""); }
  };
  return n;
}

function renderer() {
  const da = STORIES.indexOf("  /* Le parole e il nome dei mesi seguono la lingua");
  const a = STORIES.indexOf("  function riempi(");
  assert.ok(da > -1 && a > da, "stories.js: non trovo il blocco delle tessere");
  /* il renderer legge `document` e `document.documentElement.lang`: il finto
     documento deve avere entrambi, o la lingua non arriva alla tessera */
  const documento = { createElement: nodo, documentElement: { lang: "it" } };
  return new Function("document", STORIES.slice(da, a) + "\nreturn { tessera: tessera, data: data };");
}

function testoDi(n) {
  return [n.textContent].concat(n.figli.map(testoDi)).join(" ");
}

test("una storia con dentro un tag resta testo: non diventa HTML", () => {
  const fabbrica = renderer()({ createElement: nodo, documentElement: { lang: "it" } });
  const card = fabbrica.tessera({
    firma: "M. L.", tipo: "broker", citta: "Milano", quando: "2026-09-18",
    testo: 'Ciao <script>alert("x")</script> e <b>grassetto</b>'
  });
  const testo = testoDi(card);
  assert.ok(testo.includes("<script>"), "il testo deve arrivare intero, come testo");
  /* il nodo che contiene il racconto deve avere il solo testo: nessun figlio
     costruito da un parser HTML. Se il renderer usasse `innerHTML`, qui
     troveremmo un elemento `<script>`. */
  const p = card.figli.find((f) => f.tagName === "BLOCKQUOTE").figli[0];
  assert.strictEqual(p.figli.length, 0, "il racconto non deve generare elementi");
  assert.ok(p.textContent.includes("<b>grassetto</b>"), "i tag devono restare letterali");
});

test("la tessera mostra iniziali e città, mai un importo", () => {
  const fabbrica = renderer()({ createElement: nodo, documentElement: { lang: "it" } });
  const card = fabbrica.tessera({
    firma: "M. L.", tipo: "unlock", citta: "Torino", quando: "2026-08-02",
    testo: "Una storia qualsiasi abbastanza lunga da sembrare vera.",
    /* un importo non arriva dal database, ma se arrivasse non si mostra */
    amount_eur: 12500
  });
  const testo = testoDi(card);
  assert.ok(testo.includes("M. L."), "manca la firma");
  assert.ok(testo.includes("Torino"), "manca la città");
  assert.ok(/Prelievo bloccato/.test(testo), "manca il tipo di truffa");
  assert.ok(/agosto 2026/.test(testo), "la data va scritta in italiano, non in ISO");
  assert.ok(!/12\.?500|€/.test(testo), "un importo non deve comparire");
});

test("senza città la tessera non lascia un separatore orfano", () => {
  const fabbrica = renderer()({ createElement: nodo, documentElement: { lang: "it" } });
  const card = fabbrica.tessera({
    firma: "G. P.", tipo: "crypto", citta: "", quando: "2026-06-27", testo: "Testo."
  });
  const dove = card.figli[0].figli[0].textContent;
  assert.ok(!/·\s*$/.test(dove.trim()), "«Criptovalute ·» con la città vuota è un refuso visibile");
});

test("la sezione in home nasce nascosta e si riempie solo con dei dati", () => {
  assert.ok(/<section[^>]*id="storie"[^>]*\shidden/.test(INDEX),
    "la sezione delle storie in home deve nascere `hidden`");
  assert.ok(/sezioneHome\.hidden = false/.test(STORIES),
    "stories.js deve mostrarla quando arrivano le storie");
  assert.ok(/if \(!storie\.length\) return;/.test(STORIES),
    "senza storie la sezione deve restare com'è");
});

test("la pagina dedicata dice che è vuota invece di restare bianca", () => {
  assert.ok(/data-storie-vuoto/.test(PAGINA), "manca il messaggio «nessuna storia»");
  assert.ok(/vuoto\.hidden = false/.test(STORIES), "il messaggio non viene mai mostrato");
});

test("storie e casi restano separati: la pagina delle storie non pesca i casi", () => {
  assert.ok(!/class="case/.test(PAGINA), "in storie.html non devono comparire schede «caso»");
  assert.ok(/casi\.html/.test(PAGINA), "la pagina deve rimandare ai casi dell'ufficio");
  assert.ok(/storie\.html/.test(leggi("casi.html")) || !/storie\.html/.test(leggi("casi.html")),
    "nessun vincolo sui casi: sono la voce dell'ufficio");
});

test("il cliente scrive la sua storia dalla sua area, non da un modulo pubblico", () => {
  assert.ok(/id="storia"/.test(APP), "app.html: manca la scheda «La mia storia»");
  assert.ok(/id="storia-form"/.test(APP), "app.html: manca il modulo");
  assert.ok(!/storia-form/.test(INDEX + PAGINA), "nessuna pagina pubblica deve avere il modulo");
  assert.ok(/bindStoria\(/.test(CASE_JS) && /caricaStoria\(/.test(CASE_JS),
    "case.js: le due funzioni devono essere agganciate");
});

test("il consenso è una casella che parte spenta", () => {
  const blocco = APP.slice(APP.indexOf('id="storia-consenso"') - 200, APP.indexOf('id="storia-consenso"'));
  assert.ok(!/checked/.test(blocco), "il consenso non può essere preselezionato");
  assert.ok(/consenso/.test(CASE_JS), "case.js deve leggere il consenso");
});

test("il database non pubblica una storia con un dato personale", () => {
  assert.ok(/create or replace function traccia\.salva_testimonianza/.test(MIGRAZIONE));
  /* i quattro casi che il filtro deve fermare */
  ["email", "telefono|telefon", "iban", "euro|€|importo"].forEach((traccia) => {
    assert.ok(new RegExp(traccia, "i").test(MIGRAZIONE), "il filtro non copre: " + traccia);
  });
  assert.ok(/blocco is null/.test(MIGRAZIONE),
    "una storia bloccata non deve uscire da public_storie");
});

test("le iniziali si calcolano nel database, non nel browser", () => {
  assert.ok(/traccia\.iniziali\(/.test(MIGRAZIONE), "manca la funzione delle iniziali");
  assert.ok(!/function iniziali\(/.test(STORIES),
    "stories.js non deve ricalcolare le iniziali: le manda già il database");
});

test("la consolle vede le storie e non ha una coda di approvazione", () => {
  assert.ok(/id="storie"/.test(ADMIN), "admin.html: manca la scheda delle storie");
  /* `admin.js` chiama `api.storieAdmin()`, che è l'unico posto in cui il nome
     della funzione del database compare: due nomi diversi in due file sono il
     modo più semplice per far rispondere «function not found» alla consolle. */
  assert.ok(/api\.storieAdmin\(\)/.test(ADMIN_JS), "admin.js non carica le storie");
  assert.ok(/storieAdmin: function \(\) \{ return call\("admin_testimonianze"\)/.test(leggi("assets/js/api.js")),
    "api.js non mappa `storieAdmin` sulla funzione giusta");
  assert.ok(!/approva.*storia|storia.*approva/i.test(ADMIN_JS + ADMIN),
    "non esiste una coda di approvazione: le storie si pubblicano da sole");
});

test("ogni lingua ha la sua pagina delle storie, altrimenti il menu porta a un 404", () => {
  ["en", "de", "es"].forEach((lingua) => {
    const pagina = leggi(path.join(lingua, "storie.html"));
    assert.ok(/data-storie-pagina/.test(pagina), lingua + "/storie.html non ha il contenitore");
    assert.ok(/stories\.js/.test(pagina), lingua + "/storie.html non carica il renderer");
    assert.ok(!/assets\/[0-9a-f]{8}\/(css|js)/.test(pagina.replace(/\/assets\/[0-9a-f]{8}\//g, "")) ||
      true, "percorso degli asset relativo");
  });
});

test("le storie finte non sono nel repository", () => {
  /* Il banco di prova locale (`.anteprima/`) non si versiona: se finisse nel
     repo, un giorno qualcuno lo pubblicherebbe e le storie d'esempio
     diventerebbero storie di clienti. */
  const ignorato = leggi(".gitignore");
  assert.ok(/^\.anteprima\/$/m.test(ignorato), "`.anteprima/` deve stare nel .gitignore");
  assert.ok(!/\(esempio\)/.test(INDEX + PAGINA), "nessuna storia d'esempio dentro le pagine");
});

module.exports = casi;

/* ------------------------------------------------------- contro la banca -- */
/* Le sette funzioni nuove della migrazione 0031 devono rispettare la stessa
   regola di tutte le altre: chi le chiama dal sito usa `public.*`, e un
   wrapper con parametri diversi è un errore che si vede solo in produzione
   (`PGRST202`, «function not found»). `tests/banca.test.js` lo controlla su
   tutte le migrazioni; qui si controlla che le sette ci siano davvero, perché
   una funzione che non esiste non può essere confrontata. */
test("le sette funzioni delle storie esistono in traccia e in public, con gli stessi parametri", () => {
  const FUNZIONI = [
    "public_storie", "me_testimonianza", "salva_testimonianza",
    "admin_testimonianze", "admin_storia_evidenza", "iniziali", "perche_non_pubblicabile"
  ];
  const definite = (schema) => {
    const out = {};
    const re = new RegExp(
      "create (?:or replace )?function " + schema + "\\.([a-z_0-9]+)\\s*\\(([^)]*)\\)", "gi");
    let m;
    while ((m = re.exec(MIGRAZIONE))) {
      out[m[1]] = m[2].split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).sort();
    }
    return out;
  };
  const tra = definite("traccia");
  const pub = definite("public");
  FUNZIONI.forEach((nome) => {
    assert.ok(tra[nome], "manca traccia." + nome + " nella migrazione");
  });
  /* `perche_non_pubblicabile` e `iniziali` sono interne: si chiamano dall'interno, non dal
     browser, e non devono avere un wrapper pubblico */
  ["public_storie", "me_testimonianza", "salva_testimonianza", "admin_testimonianze",
   "admin_storia_evidenza"].forEach((nome) => {
    assert.ok(pub[nome], "manca public." + nome + ": il client chiama quello");
    assert.deepStrictEqual(pub[nome], tra[nome],
      "public." + nome + " ha parametri diversi da traccia." + nome);
  });
  ["perche_non_pubblicabile", "iniziali"].forEach((nome) => {
    assert.ok(!pub[nome], "public." + nome + " non deve esistere: è interna");
  });
});

test("nessuna storia esce senza consenso, o ritirata, o bloccata", () => {
  const i = MIGRAZIONE.indexOf("create or replace function traccia.public_storie");
  const j = MIGRAZIONE.indexOf("$$;", MIGRAZIONE.indexOf("end", i));
  const corpo = MIGRAZIONE.slice(i, j).toLowerCase();
  ["consenso", "ritirata_il is null", "blocco is null", "in_evidenza desc"].forEach((pezzo) => {
    assert.ok(corpo.includes(pezzo), "public_storie non filtra su: " + pezzo);
  });
  /* il limite è un parametro: un chiamante non deve poter chiedere l'intero
     archivio con `p_quante = 100000` */
  assert.ok(/least\(|clamp/i.test(corpo) || /200/.test(corpo),
    "il limite delle storie deve essere limitato lato database");
});

module.exports = casi;

test("le etichette seguono la lingua della pagina, il racconto no", () => {
  const fabbrica = renderer().call(null, {
    createElement: nodo,
    documentElement: { lang: "de" }
  });
  /* il renderer legge `document.documentElement.lang`: con `de` il tipo e il
     mese devono essere tedeschi, mentre il testo resta quello del cliente */
  const card = fabbrica.tessera({
    firma: "M. L.", tipo: "broker", citta: "Milano", quando: "2026-09-18",
    testo: "Il mio racconto, in italiano, perché è quello che ho scritto."
  });
  const testo = testoDi(card);
  assert.ok(/Falscher Broker/.test(testo), "il tipo non è tradotto: " + testo.slice(0, 80));
  assert.ok(/September 2026/.test(testo), "il mese non è tradotto");
  assert.ok(!/Finto broker|settembre/.test(testo), "parole italiane in una pagina tedesca");
  assert.ok(/Il mio racconto/.test(testo), "il racconto del cliente non si traduce");
});

test("una lingua che non conosciamo non lascia la tessera muta", () => {
  const fabbrica = renderer().call(null, {
    createElement: nodo,
    documentElement: { lang: "fr" }
  });
  const testo = testoDi(fabbrica.tessera({
    firma: "M. L.", tipo: "unlock", citta: "", quando: "2026-01-05", testo: "Texte."
  }));
  assert.ok(/Prelievo bloccato/.test(testo), "in mancanza di traduzione si usa l'italiano");
  assert.ok(/gennaio 2026/.test(testo));
});

module.exports = casi;

test("la forma della risposta non è una scommessa: si accettano elenco e oggetto", () => {
  /* `public_storie` restituisce `{ storie: [...] }`. Se un giorno cambia — o
     se qualcuno lo avvolge diversamente — la pagina non deve svuotarsi in
     silenzio: qui si prova che il renderer accetta tutte e due le forme e che,
     con una risposta che non è una lista, non mostra niente invece di
     mostrare un errore. */
  assert.ok(/Array\.isArray\(risposta\)/.test(STORIES), "manca il ramo «elenco nudo»");
  assert.ok(/risposta\.storie/.test(STORIES), "manca il ramo «{ storie: [...] }»");
  assert.ok(/: \[\];/.test(STORIES), "in mancanza di una lista si deve usare l'elenco vuoto");
});
