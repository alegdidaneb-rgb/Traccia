/* ==========================================================================
   L'area interna si usa senza trascinare
   ==========================================================================
   Il cliente, il 2026-11-13: «al interno sembra molto complicato a sistema
   perché per vedere interamente tutte le funzioni bisogna trascinare, non
   abbiamo tempo e voglia per questo».

   Il difetto vero non era la grafica: era che **esistevano cose che nessuno
   poteva vedere**. Le otto schede dell'area cliente stavano in una striscia
   orizzontale che scorreva di lato; nella console l'ultima voce del menu si
   chiamava «Registro attività» e portava a un pannello che si chiamava
   «Soglie», quindi arrivarci voleva dire cercarlo; e tutti i pannelli erano
   aperti in fila, così per raggiungere l'ultimo si attraversavano gli altri
   otto.

   Questi test guardano le cose che si possono verificare da un file senza un
   browser vero — e sono proprio quelle che erano sbagliate:

     1. ogni voce del menu ha una sezione che esiste davvero;
     2. ogni sezione è raggiungibile da una voce del menu;
     3. nella barra dell'area cliente non c'è più niente che scorra di lato;
     4. le sezioni sono una per volta, e senza JavaScript tornano tutte.

   Quello che un test **non** può dire — se la pagina è bella, se le parole
   sono chiare — resta da guardare con gli occhi. Ma «c'è una sezione che
   nessuna voce apre» è un difetto, non un'opinione.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const RADICE = path.join(__dirname, "..");
const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

function documento(pagina) {
  const html = fs.readFileSync(path.join(RADICE, pagina), "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  return new JSDOM(html).window.document;
}

/* Le voci del menu e le sezioni, per le due pagine interne. */
const PAGINE = [
  {
    file: "app.html",
    menu: ".area-nav__link",
    /* Solo le sezioni di navigazione: i figli diretti della colonna
       principale. Le schede della colonna di destra («Il tuo referente», «I
       miei dati») hanno un id perché servono ai collegamenti, ma non sono
       posti in cui si va: stanno accanto a quello che si sta guardando. */
    sezione: ".appv2__grid > .appv2__col:first-of-type > section.pnl[id], .appv2__head[id]",
    nome: "area del cliente",
    attributo: "",
  },
  {
    file: "admin.html",
    menu: ".app-side a[data-tab]",
    sezione: ".panel[id]",
    nome: "console dell'ufficio",
    attributo: "",
  },
];

PAGINE.forEach((p) => {
  test(`${p.nome}: ogni voce del menu apre una sezione che esiste`, () => {
    const d = documento(p.file);
    const mancanti = [];
    d.querySelectorAll(p.menu).forEach((voce) => {
      const id = (voce.getAttribute("href") || "").replace("#", "");
      if (!id) { mancanti.push(`${voce.textContent.trim()} → nessun href`); return; }
      if (!d.getElementById(id)) {
        mancanti.push(`${voce.textContent.trim()} → #${id} non esiste nella pagina`);
      }
    });
    assert.deepStrictEqual(mancanti, [],
      "voci di menu che portano nel vuoto:\n  " + mancanti.join("\n  "));
  });

  test(`${p.nome}: nessuna sezione resta fuori dal menu`, () => {
    const d = documento(p.file);
    const nelMenu = new Set();
    d.querySelectorAll(p.menu).forEach((voce) => {
      nelMenu.add((voce.getAttribute("href") || "").replace("#", ""));
    });
    const orfane = [];
    d.querySelectorAll(p.sezione).forEach((sezione) => {
      if (!sezione.id) return;
      /* i pannelli dentro una sezione (`#carica` dentro i documenti) non sono
         sezioni: si aprono da un collegamento, non dal menu */
      if (sezione.classList.contains("pnl--inner")) return;
      if (!nelMenu.has(sezione.id)) orfane.push("#" + sezione.id);
    });
    assert.deepStrictEqual(orfane, [],
      "sezioni che nessuna voce del menu apre (raggiungibili solo scorrendo):\n  "
      + orfane.join("\n  "));
  });
});

test("area del cliente: la barra non scorre di lato", () => {
  /* Il difetto da non far tornare: `overflow-x: auto` su una fila di schede.
     Con otto voci dentro 1320px ne restavano fuori metà, e chi non trascinava
     non sapeva nemmeno che ci fossero. */
  const css = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");
  const regola = css.match(/\.area-nav__links\s*\{[^}]*\}/g) || [];
  assert.ok(regola.length, "manca la regola .area-nav__links: la barra non è più una colonna");
  const conScorrimento = regola.filter((r) => /overflow-x:\s*(auto|scroll)/.test(r));
  /* è ammesso solo dentro una media query per schermi stretti, dove lo
     scorrimento orizzontale è il gesto naturale */
  const inSchermoStretto = /@media\s*\(max-width:\s*860px\)[\s\S]*\.area-nav__links\s*\{[^}]*overflow-x:\s*auto/;
  assert.ok(
    conScorrimento.length === 0 || inSchermoStretto.test(css),
    "la barra dell'area è tornata a scorrere di lato anche su schermo largo"
  );
  /* e la colonna deve stare *fuori* da una media query: la regola base */
  const base = css.slice(0, css.indexOf("@media"));
  assert.ok(!/\.area-nav__links\s*\{[^}]*overflow-x/.test(base),
    "su schermo largo la barra dell'area non deve scorrere");
});

test("le sezioni sono una per volta, e senza JavaScript tornano tutte", () => {
  const css = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");
  assert.ok(/\.pnl\[hidden\]\s*\{\s*display:\s*none/.test(css),
    "manca `.pnl[hidden] { display: none }`: le sezioni resterebbero tutte aperte");
  assert.ok(/\.panel\[hidden\]\s*\{\s*display:\s*none/.test(css),
    "manca `.panel[hidden] { display: none }`: la console resterebbe tutta aperta");

  /* e la pagina non deve dichiararle nascoste nell'HTML: l'attributo lo mette
     `case.js`/`admin.js` all'apertura. Se fosse scritto nel file, chi ha lo
     script bloccato vedrebbe una pagina vuota. */
  ["app.html", "admin.html"].forEach((pagina) => {
    const html = fs.readFileSync(path.join(RADICE, pagina), "utf8");
    const nascoste = (html.match(/<section[^>]*\bhidden\b/g) || []);
    assert.deepStrictEqual(nascoste, [],
      pagina + ": sezioni dichiarate `hidden` nell'HTML: senza JavaScript non si vedrebbero");
  });
});

test("la sezione scelta sta nell'indirizzo, non solo nello stato del clic", () => {
  /* Se l'unico modo di sapere dove si è fosse una classe CSS, il tasto
     indietro non funzionerebbe e non si potrebbe mandare a un collega il punto
     esatto. La pagina deve leggere `location.hash`. */
  const area = fs.readFileSync(path.join(RADICE, "assets/js/case.js"), "utf8");
  assert.ok(/window\.location\.hash/.test(area),
    "case.js non legge l'indirizzo: la sezione non si può linkare");
  assert.ok(/hashchange/.test(area), "case.js non ascolta il tasto indietro");
  const console_ = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
  assert.ok(/window\.location\.hash/.test(console_),
    "admin.js non legge l'indirizzo: la sezione non si può linkare");
  assert.ok(/hashchange/.test(console_), "admin.js non ascolta il tasto indietro");
});

test("sezioni: una sola visibile per ogni indirizzo, davvero", () => {
  /* Il test che conta. Non legge il codice: lo esegue. Carica `app.html` in un
     DOM, ci fa girare la parte di `case.js` che sceglie la sezione, e controlla
     cosa resta visibile per ogni indirizzo.

     Il difetto che questo test ha già preso: il pannello «Carica un documento»
     sta **dentro** i documenti, e con la sola regola sulle sezioni restava
     visibile sempre — in cima a ogni altra sezione. */
  const html = fs.readFileSync(path.join(RADICE, "app.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost/app.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window, d = w.document;
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = function () {};

  const sorgente = fs.readFileSync(path.join(RADICE, "assets/js/case.js"), "utf8");
  const inizio = sorgente.indexOf("var SEZIONI = [");
  const fine = sorgente.indexOf("function bindRefresh");
  assert.ok(inizio > 0 && fine > inizio, "non trovo più il blocco delle sezioni in case.js");
  w.eval(sorgente.slice(inizio, fine) + "\nbindTabs();");

  const visibili = () => Array.from(d.querySelectorAll("section.pnl[id]"))
    .filter((s) => !s.hidden).map((s) => s.id).sort();

  const attesi = {
    panoramica: [],                                   /* solo intestazione e cifre */
    pratica: ["pratica"],
    documenti: ["carica", "documenti"],               /* il caricamento appartiene ai documenti */
    cronologia: ["cronologia"],
    conto: ["conto"],
    onorari: ["onorari"],
    contratto: ["contratto"],
    sicurezza: ["sicurezza"],
  };

  Object.keys(attesi).forEach((sezione) => {
    w.location.hash = "#" + sezione;
    w.dispatchEvent(new w.Event("hashchange"));
    assert.deepStrictEqual(visibili(), attesi[sezione],
      `con #${sezione} si vedono le sezioni sbagliate: ` + visibili().join(", "));
    const attive = Array.from(d.querySelectorAll(".area-nav__link.is-active"))
      .map((a) => a.getAttribute("data-tab"));
    assert.deepStrictEqual(attive, [sezione],
      `con #${sezione} la voce accesa è: ` + attive.join(", "));
  });

  /* un indirizzo che non esiste non deve dare una pagina vuota */
  w.location.hash = "#una-sezione-che-non-esiste";
  w.dispatchEvent(new w.Event("hashchange"));
  assert.deepStrictEqual(visibili(), [], "indirizzo sconosciuto: la pagina è vuota");
  assert.deepStrictEqual(
    Array.from(d.querySelectorAll(".area-nav__link.is-active")).map((a) => a.getAttribute("data-tab")),
    ["panoramica"],
    "indirizzo sconosciuto: nessuna voce accesa"
  );

  /* e il collegamento che porta dentro una sezione deve aprirla */
  const link = d.querySelector('a[href="#carica"]');
  assert.ok(link, "manca il collegamento «Aggiungi un file»");
  w.location.hash = "#panoramica";
  w.dispatchEvent(new w.Event("hashchange"));
  link.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepStrictEqual(visibili(), ["carica", "documenti"],
    "il collegamento al caricamento non apre i documenti");
});

module.exports = casi;
