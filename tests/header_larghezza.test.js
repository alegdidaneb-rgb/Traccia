/* ==========================================================================
   La testata ci sta, a ogni larghezza
   ==========================================================================
   Il selettore di lingua è passato da una tendina larga 80px a quattro
   pastiglie larghe 172px, dentro una riga che ha già sette voci di menu e due
   pulsanti. Sembrava una modifica di colore; era una modifica di ingombro, e
   a 1280px l'header sforava di 66px — i pulsanti di accesso uscivano dallo
   schermo. Non si vede leggendo l'HTML: si vede misurando.

   Questi test usano `tools/misura_header.py`, che misura i testi con il font
   vero (`fontTools`) invece di stimare una media per lettera. Il numero che
   conta non è la precisione al decimo di pixel: è che il risultato non cambi
   senza che nessuno se ne accorga.
   ========================================================================== */
const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");

const caso = [];
function test(nome, fn) {
  caso.push({ nome, fn });
}

const RADICE = path.join(__dirname, "..");
const CSS = require("fs").readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");
const CSS_BASE = require("fs").readFileSync(path.join(RADICE, "assets/css/style.css"), "utf8");
const HEADER = require("fs").readFileSync(path.join(RADICE, "partials/header.html"), "utf8");

/* Il testo di un blocco `@media (max-width: Npx) { … }`, contando le graffe:
   una regex «dal { alla }» si ferma alla prima regola interna e racconta solo
   un pezzo della verità. */
function bloccoMedia(css, soglia) {
  const inizio = css.indexOf(`@media (max-width: ${soglia}px) {`);
  if (inizio === -1) return "";
  let i = css.indexOf("{", inizio);
  let profondita = 0;
  for (let j = i; j < css.length; j++) {
    if (css[j] === "{") profondita++;
    else if (css[j] === "}") {
      profondita--;
      if (profondita === 0) return css.slice(i, j + 1);
    }
  }
  return css.slice(i);
}

/* Tutti i blocchi `@media (max-width: Npx) { … }`, non solo il primo: un
   foglio di stile ne ha più d'uno e cercare «quello giusto» sbagliando blocco
   produce test che passano per il motivo sbagliato. */
function tuttiIMedia(css, soglia) {
  const aperti = [];
  const trovati = [];
  const marcatore = `@media (max-width: ${soglia}px)`;
  let i = 0;
  while ((i = css.indexOf(marcatore, i)) !== -1) {
    aperti.push(i);
    i += marcatore.length;
  }
  for (const inizio of aperti) {
    let j = css.indexOf("{", inizio);
    let profondita = 0;
    for (let k = j; k < css.length; k++) {
      if (css[k] === "{") profondita++;
      else if (css[k] === "}") {
        profondita--;
        if (profondita === 0) {
          trovati.push(css.slice(j, k + 1));
          break;
        }
      }
    }
  }
  return trovati;
}

/* Il misuratore stampa anche la soglia che ha ricavato dal contenuto: è il
   numero che il foglio di stile deve usare, e leggerlo da lì è il modo per non
   averne due copie che divergono. */
let uscitaUnaVolta = null;
const uscitaMisura = () => {
  if (uscitaUnaVolta === null) uscitaUnaVolta = misura([]);
  return uscitaUnaVolta;
};

const misura = (larghezze = []) =>
  execFileSync("python3", ["tools/misura_header.py", ...larghezze.map(String)], {
    cwd: RADICE,
    encoding: "utf8",
  });

/* ------------------------------------------------------------ l'ingombro -- */
test("a nessuna larghezza l'header esce dallo schermo", () => {
  /* 1360 è la soglia dell'hamburger, 480 quella del marchio abbreviato: sono
     misurate insieme alle altre perché è lì che si rompe, non al centro */
  let uscita;
  try {
    uscita = misura([1440, 1361, 1360, 1280, 1024, 820, 481, 480, 390, 360]);
  } catch (e) {
    /* lo script esce 1 quando trova uno sforamento, e il messaggio è l'elenco */
    assert.fail(
      "la testata non ci sta:\n" +
        String(e.stdout || "").split("\n").filter((r) => /SBORDA/.test(r)).join("\n")
    );
  }
  assert.ok(/1361px\s+sta/.test(uscita), "a 1361 il menu in riga deve stare");
  assert.ok(/360px\s+sta/.test(uscita), "a 360 la barra deve stare");
});

test("le soglie del foglio di stile sono quelle che il misuratore conosce", () => {
  /* Se qualcuno sposta l'hamburger a un'altra larghezza e non lo dice al
     misuratore, il misuratore continua a rispondere «sta» su una larghezza
     dove il menu è ancora in riga. Le due verità devono essere una sola. */
  /* Il numero non si scrive a mano: si chiede al misuratore e si controlla che
     il foglio di stile usi quello. Prima erano due 1360 copiati in due posti,
     ed entrambi sbagliati — perché il conto partiva dalla finestra invece che
     dalla barra. */
  const soglia = Number((uscitaMisura().match(/hamburger, ricavata dal contenuto: (\d+)px/) || [])[1]);
  assert.ok(soglia > 1200 && soglia < 1400, "la soglia calcolata deve essere plausibile: " + soglia);
  assert.ok(
    new RegExp(`@media \\(max-width: ${soglia}px\\) \\{\\s*\\.nav__toggle \\{ display: inline-flex`).test(CSS_BASE),
    "l'hamburger deve comparire a " + soglia + "px, come dice il misuratore"
  );
  assert.ok(bloccoMedia(CSS, soglia).includes(".nav__lang"),
    "il selettore deve restare in barra a " + soglia + "px, non finire nel pannello");
});

/* ---------------------------------------------------------- il selettore -- */
test("il selettore non finisce dentro il menu a scomparsa", () => {
  /* Su mobile il vecchio selettore aveva `order: 3; width: 100%` dentro
     `.nav__links`: cioè dentro il pannello che si apre con l'hamburger. Chi
     arriva su una pagina in una lingua che non legge non deve prima capire
     che deve aprire un menu. Ora `.nav__lang` sta in barra.

     Il `margin-inline-start: auto` non serve più a spingerlo a destra (a
     destra ora ci sono i pulsanti, che sotto la soglia sono nascosti): quello
     che conta è che **non** ci siano le due regole che lo rimettono dentro il
     pannello. Il test lo dice così, invece di chiedere una proprietà che ora
     sarebbe un residuo. */
  const soglia = Number((uscitaMisura().match(/hamburger, ricavata dal contenuto: (\d+)px/) || [])[1]);
  const blocco = bloccoMedia(CSS, soglia);
  assert.ok(/\.nav__lang\s*\{/.test(blocco), "il selettore deve avere una regola in barra");
  assert.ok(!/order: 3/.test(blocco), "order:3 lo rimetterebbe dentro il pannello");
  assert.ok(!/width: 100%/.test(blocco), "a tutta larghezza non è più un selettore, è una riga");
});

test("il selettore è quattro pastiglie, non una tendina", () => {
  const senzaCommenti = HEADER.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!/<details/.test(senzaCommenti), "niente menu da aprire");
  assert.ok(!/lang__toggle|lang__menu/.test(senzaCommenti), "resti della tendina");
  const voci = senzaCommenti.match(/class="lang__opt"/g) || [];
  assert.equal(voci.length, 4, "quattro lingue, quattro pastiglie");
});

test("ogni pastiglia è grande abbastanza per essere premuta", () => {
  /* 34×30px è sotto i 44px raccomandati per il tocco, ma è dentro una barra
     alta 68px e le pastiglie sono affiancate: allargarle a 44 ognuna farebbe
     176px di solo selettore, che a 360px non ci sta. Il minimo che si difende
     è 26px, che è quello che il foglio di stile usa sotto i 480. */
  const misure = [...CSS.matchAll(/\.lang__opt \{[^}]*min-width: (\d+)px[^}]*height: (\d+)px/g)];
  assert.ok(misure.length >= 2, "servono le misure normali e quelle per schermo stretto");
  misure.forEach((m) => {
    const larg = Number(m[1]);
    const alt = Number(m[2]);
    assert.ok(larg >= 26, `pastiglia troppo stretta: ${larg}px`);
    assert.ok(alt >= 26, `pastiglia troppo bassa: ${alt}px`);
  });
});

test("la lingua corrente non è un link", () => {
  /* un `<a>` che porta alla pagina in cui siamo già si preme e non fa niente:
     è il difetto che fa dire «non riesco a cambiare lingua» */
  for (const file of ["index.html", "en/index.html", "de/index.html", "es/index.html"]) {
    const h = require("fs").readFileSync(path.join(RADICE, file), "utf8");
    const blocco = h.slice(h.indexOf("data-lang-switch"), h.indexOf('class="nav__actions"'));
    const accese = blocco.match(/<a class="lang__opt"[^>]*aria-current="true"[^>]*>/g) || [];
    assert.equal(accese.length, 1, `${file}: deve esserci una sola lingua accesa`);
    assert.ok(!/\shref=/.test(accese[0]), `${file}: la lingua accesa è ancora un link`);
  }
});

/* ------------------------------------------------------- il foglio di stile -- */
test("il foglio di stile è coerente: graffe pari, nessun blocco duplicato", () => {
  /* Questo test nasce da un danno vero, pubblicato in produzione: una mia
     sostituzione aveva infilato la regola del marchio dentro il blocco
     `@media (max-width: 480px)` dei KPI, e il blocco non si chiudeva più.
     Il CSS non è un errore che si vede: il browser ignora le regole rotte e
     tira avanti, quindi la pagina sembra a posto. Peggio, una rimozione
     successiva aveva lasciato il file con due copie di sé stesso. */
  const senzaCommenti = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = senzaCommenti(CSS);
  const aperte = (css.match(/\(/g) || []).length;

  /* graffe bilanciate, e mai sotto zero a metà file */
  let profondita = 0;
  [...css].forEach((ch, i) => {
    if (ch === "{") profondita++;
    if (ch === "}") profondita--;
    assert.ok(
      profondita >= 0,
      `chiusura in eccesso alla riga ${css.slice(0, i).split("\n").length}`
    );
  });
  assert.equal(profondita, 0, "il foglio di stile ha graffe non chiuse");

  /* nessuna sezione due volte: è il segno che qualcuno ha incollato il file
     dentro sé stesso invece di modificarlo */
  const sezioni = [...CSS.matchAll(/^   (\d+)\. ([^\n]+)$/gm)].map((m) => m[1]);
  const doppie = sezioni.filter((n, i) => sezioni.indexOf(n) !== i);
  assert.equal(doppie.length, 0, `sezioni ripetute: ${[...new Set(doppie)].join(", ")}`);

  /* e la regola che protegge l'header sta nel blocco giusto: c'è più di un
     `@media (max-width: 480px)` nel foglio, e quello che conta è quello che
     contiene `.lang__opt`, non il primo che s'incontra */
  const blocchi480 = tuttiIMedia(CSS, 480);
  const selettore = blocchi480.find((b) => /\.lang__opt\s*\{/.test(senzaCommenti(b)));
  assert.ok(selettore, "manca il blocco a 480 che stringe le pastiglie");
  assert.ok(!/\.kpi/.test(senzaCommenti(selettore)),
    "nel blocco del selettore non devono esserci regole dei KPI");
  const kpi = blocchi480.find((b) => /\.kpi\s*\{/.test(senzaCommenti(b)));
  assert.ok(kpi && !/span:last-child/.test(senzaCommenti(kpi)),
    "la regola del marchio è finita nel blocco dei KPI");
});

/* ------------------------------------------------- classi senza stile -- */
test("ogni classe dell'header ha una regola che esiste", () => {
  /* Questo test nasce dal guasto peggiore di questa serie: per due
     pubblicazioni il selettore è andato in produzione **senza CSS**. Il markup
     c'era, l'HTML era corretto, i test passavano — e la pagina mostrava quattro
     collegamenti nudi incollati nella riga sbagliata. Nessuno se ne accorge
     leggendo il codice: il difetto vive nel vuoto, non in una riga sbagliata.

     La regola: se nell'header usi una classe, da qualche parte ci deve essere
     un selettore che la nomina. */
  /* Due fogli, non uno: `.nav__links` e `.nav-user` stanno in `style.css` — il
     foglio base — e cercarli solo in `premium.css` darebbe un allarme falso su
     dieci classi sane. Il difetto vero era che `lang__opt` non stava in
     nessuno dei due. */
  const tutti = (CSS + CSS_BASE).replace(/\/\*[\s\S]*?\*\//g, "");
  const classi = new Set();
  for (const m of HEADER.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && classi.add(c));
  }
  /* le classi utilitarie non hanno bisogno di una regola propria */
  const UTILITA = new Set(["sr-only"]);
  const orfane = [...classi].filter(
    (c) => !UTILITA.has(c) && !new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(tutti)
  );
  assert.equal(orfane.length, 0, `classi senza alcuna regola: ${orfane.join(", ")}`);
});

test("il selettore ha il suo blocco, non solo il markup", () => {
  /* le classi che rendono il selettore quello che è: senza una di queste, o
     torna a essere una lista di link, o perde la pastiglia accesa */
  const senzaCommenti = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  [".nav__lang", ".lang {", ".lang__opt {", '[aria-current="true"]'].forEach((regola) => {
    assert.ok(senzaCommenti.includes(regola), `manca la regola «${regola}»`);
  });
  /* e le misure che i test di ingombro si aspettano di trovare */
  assert.ok(/\.lang__opt \{[^}]*min-width: \d+px/.test(senzaCommenti),
    "la pastiglia non ha una larghezza minima: collassa sulla sigla");
  assert.ok(/\.lang__opt \{[^}]*height: \d+px/.test(senzaCommenti),
    "la pastiglia non ha un'altezza: la barra si alza e si abbassa con il font");
});


/* ------------------------------------------------- il difetto che è sfuggito -- */
test("il contenuto della testata non supera mai lo spazio della barra", () => {
  /* Il guasto in produzione: «Come / funziona», «Casi / seguiti» su due righe,
     su ogni schermo. Il misuratore diceva «sta» perché confrontava il
     contenuto con **la finestra** (1440 − 40) invece che con **la barra**
     (min(1440, 1360) − 80 = 1280). Con un 27 pollici il conto tornava per
     caso; a 1280 no, e nessuno guardava lì.

     Questo test non si fida del messaggio dello script: legge i numeri e
     verifica che il contenuto stia nella barra a ogni larghezza, con un
     margine minimo. Un margine di 1px passerebbe il confronto e spaccherebbe
     la riga al primo carattere in grassetto: sotto i 20px è un guasto
     prossimo, non un successo. */
  const uscita = uscitaMisura();
  /* La larghezza della barra si legge dal CSS, non dal messaggio dello
     script: se lo script sbaglia il modello (per esempio confrontando con la
     finestra invece che col contenitore), i suoi numeri sono coerenti fra
     loro e il test passerebbe. Qui lo spazio disponibile viene ricalcolato
     dal foglio di stile, e i due devono coincidere. */
  const barra = Number((CSS_BASE.match(/\.site-header \.container \{ max-width: (\d+)px; \}/) || [])[1]);
  assert.ok(barra > 0, "la larghezza della barra deve stare nel CSS, in px");
  const PAD = 40; /* --pad-x al massimo */

  const righe = [...uscita.matchAll(/(\d+)px\s+(?:sta|SBORDA).*?servono (\d+) su (\d+)/g)];
  assert.ok(righe.length > 0, "il misuratore deve stampare le misure del menu in riga");
  for (const [, larghezza, serve, disponibile] of righe) {
    const atteso = Math.min(Number(larghezza), barra) - PAD * 2;
    assert.equal(Number(disponibile), atteso,
      `a ${larghezza}px il misuratore dichiara ${disponibile}px disponibili ma la barra ` +
      `ne ha ${atteso} (min(${larghezza}, ${barra}) − ${PAD * 2}): sta misurando lo schermo, ` +
      `non la barra — ed è così che ha lasciato passare le voci spezzate`);
    const margine = Number(disponibile) - Number(serve);
    assert.ok(margine >= 20,
      `a ${larghezza}px il menu in riga ha solo ${margine}px di margine ` +
      `(${serve} su ${disponibile}): il prossimo carattere in grassetto lo spezza`);
  }
});

test("il contenitore dell'header è più largo del contenuto delle pagine", () => {
  /* Perché serve un test su questo: la barra deve stare tutta su una riga, e
     il contenuto delle pagine no. Se qualcuno riporta l'header al `--container`
     standard, le voci tornano a spezzarsi e il misuratore — che legge il CSS —
     continua a misurare giusto ma su un contenitore che non esiste più. */
  const css = CSS_BASE;
  assert.match(css, /\.site-header \.container \{ max-width: 1400px; \}/,
    "la barra dell'header deve avere una larghezza sua");
  assert.match(css, /--container: 1200px/, "il contenuto delle pagine resta a 1200");
});

test("i pulsanti di accesso stanno fuori dalla lista del menu", () => {
  /* Dentro la lista, il pannello dell'hamburger (`position: fixed`) li
     trascinava fuori dallo schermo quando era chiuso, e nel pannello aperto
     comparivano due volte. Fuori, la barra è calcolabile: lista + pulsanti,
     ognuno nel suo spazio. */
  const html = HEADER;
  /* il taglio non può cercare `data-auth-slot`: il commento sopra i pulsanti
     nomina la classe, e il test taglierebbe nel posto sbagliato. Si cerca il
     tag vero. */
  const lista = html.slice(
    html.indexOf('<ul class="nav__links"'),
    html.indexOf('<div class="nav__actions" data-auth-slot>')
  );
  assert.ok(lista.length > 0, "la lista e i pulsanti devono esserci entrambi");
  assert.ok(!/<li class="nav__actions"/.test(lista), "i pulsanti non devono stare dentro `.nav__links`");
  assert.ok(/<div class="nav__actions" data-auth-slot>/.test(html),
    "i pulsanti devono essere un fratello della lista, con la stessa classe");
});

test("sotto la soglia i pulsanti stanno nel pannello, non spenti", () => {
  /* Prima erano `display: none` con la scusa che «il pannello ha già le sue
     voci»: non era vero da quando i pulsanti sono stati spostati fuori dalla
     lista. Risultato: da un telefono il menu offriva sette voci e nessun modo
     né di accedere né di segnalare un caso. Ora i pulsanti sono un figlio del
     pannello, e sotto la soglia si vedono in colonna. */
  const soglia = Number((uscitaMisura().match(/hamburger, ricavata dal contenuto: (\d+)px/) || [])[1]);
  const blocco = bloccoMedia(CSS_BASE, soglia);
  assert.ok(/\.nav__panel \.nav__actions \{/.test(blocco),
    "sotto la soglia i pulsanti devono stare nel pannello");
  assert.ok(!/\.nav__actions \{ display: none/.test(blocco),
    "i pulsanti non si spengono più: sarebbero un menu senza accesso");
  /* il pannello è la scatola che contiene voci e pulsanti: se il partial non
     li avvolgge insieme, il CSS qui sopra non li trova */
  assert.match(HEADER, /<div class="nav__panel"[^>]*>\s*<ul class="nav__links"/,
    "i pulsanti devono essere dentro il pannello, fratelli della lista");
  assert.match(HEADER, /aria-controls="nav-panel"/,
    "l'hamburger deve aprire il pannello, non la sola lista");
  assert.ok(/data-auth-guest[^>]*>Accedi</.test(HEADER), "«Accedi» deve esistere");
  assert.ok(/data-auth-guest[^>]*>Segnala un caso</.test(HEADER), "«Segnala un caso» deve esistere");
});

test("a larghezza da telefono la lista non è più una tendina: ci pensa il pannello", () => {
  /* Media query in cascata: dentro `premium.css` la lista torna
     `display: contents`, così le lingue restano nella barra e le voci sono
     figlie del pannello. Se quella regola sparisse, o arrivasse un
     `display: flex` dopo, la lista tornerebbe una tendina *dentro* la tendina:
     due scatole sovrapposte, e i pulsanti sotto quella sbagliata. */
  const blocco = bloccoMedia(CSS, 1395);
  assert.ok(/\.nav__links \{\s*display: contents;/.test(blocco),
    "premium.css non riporta la lista a `display: contents` sotto la soglia");
  assert.ok(/\.nav__panel \.nav__actions \{/.test(CSS_BASE),
    "i pulsanti del pannello devono essere stilizzati");
});

test("su desktop il pannello non esiste come scatola", () => {
  /* `display: contents` è ciò che rende innocua l'introduzione del pannello:
     la barra desktop resta lista + pulsanti nel flusso, e il misuratore — che
     misura quei due pezzi — continua a valere. */
  assert.match(CSS_BASE, /\.nav__panel \{ display: contents; \}/,
    "senza, su desktop il pannello sarebbe una scatola che va a capo");
});

module.exports = caso;
