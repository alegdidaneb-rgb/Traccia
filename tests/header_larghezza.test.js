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
  assert.ok(
    /@media \(max-width: 1360px\) \{\s*\.nav__toggle \{ display: inline-flex/.test(CSS_BASE),
    "l'hamburger deve comparire a 1360px, come dice il misuratore"
  );
  assert.ok(bloccoMedia(CSS, 1360).includes(".nav__lang"),
    "il selettore deve restare in barra a 1360px, non finire nel pannello");
});

/* ---------------------------------------------------------- il selettore -- */
test("il selettore non finisce dentro il menu a scomparsa", () => {
  /* Su mobile il vecchio selettore aveva `order: 3; width: 100%` dentro
     `.nav__links`: cioè dentro il pannello che si apre con l'hamburger. Chi
     arriva su una pagina in una lingua che non legge non deve prima capire
     che deve aprire un menu. Ora `.nav__lang` sta in barra. */
  const blocco = bloccoMedia(CSS, 1360);
  assert.ok(/margin-inline-start: auto/.test(blocco), "il selettore deve spingersi a destra da solo");
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

module.exports = caso;
