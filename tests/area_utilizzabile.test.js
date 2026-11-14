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
   «Soglie», quindi arrivarci voleva dire cercarlo.

   --------------------------------------------------------------------------
   Perché questo file non usa `jsdom`
   --------------------------------------------------------------------------
   Ci ha provato, e ha rotto la suite: `package.json` non esiste, il runner è
   scritto apposta «nessuna dipendenza», e in un ambiente pulito `node
   tests/run.js` moriva con `Cannot find module 'jsdom'` **prima** di eseguire
   un solo test. Un test che impedisce agli altri di girare è peggio di un test
   che manca.

   Qui c'è solo un lettore di tag — gli stessi quattro casi di `console_dom`:
   un elemento ha attributi, figli, e si cerca per tag, classe, id o
   attributo. Basta per le domande che contano, che sono tutte strutturali:
   «questa voce apre una sezione che esiste?», «quante colonne ha questa
   tabella?», «questa sezione è raggiungibile senza scorrere?».
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* ------------------------------------------------------------- mini DOM -- */
const RE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const SENZA_CONTENUTO = new Set(["script", "style"]);
/* Elementi che non hanno figli e non si chiudono. Senza questo elenco un
   `<input>` finisce sullo stack, e la `</div>` che segue chiude l'input invece
   del div: da lì in poi ogni chiusura è sfalsata e due tabelle diventano una.
   È il modo più facile di scrivere un test che mente. */
const VUOTI = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

function nodo(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(),
    attrs: Object.create(null),
    figli: [],
    padre: null,
    className: "",
    _testo: "",
    appendChild(c) { c.padre = n; n.figli.push(c); return c; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    hasAttribute(k) { return k in n.attrs; },
    querySelector(sel) { return n.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return scendi(n, sel); },
    closest(sel) {
      let x = n;
      while (x) { if (combacia(x, sel)) return x; x = x.padre; }
      return null;
    },
    get textContent() { return (n._testo + n.figli.map(parla).join("")).replace(/\s+/g, " ").trim(); },
    get id() { return n.attrs.id || ""; },
  };
  return n;
}

function parla(x) { return x._testo + x.figli.map(parla).join(""); }

function scendi(radice, sel) {
  const out = [];
  (function visita(x) {
    x.figli.forEach((f) => {
      if (combacia(f, sel)) out.push(f);
      visita(f);
    });
  })(radice);
  return out;
}

function semplice(n, sel) {
  if (!n || !sel) return false;
  /* «selettore composto»: `section.pnl` vuol dire tag **e** classe, non un tag
     che si chiama «section.pnl». Senza questo, ogni selezione scritta così
     trovava zero elementi e il test passava senza guardare niente — che è
     esattamente il guasto che questa suite deve impedire. */
  const composto = /^([a-zA-Z][a-zA-Z0-9]*)?([.#][\w-]+(?:[.#][\w-]+)*)?$/.exec(sel.trim());
  if (composto && sel.trim() !== "" && (composto[1] || composto[2])) {
    const [, tag, resto] = composto;
    if (resto && !/^[.#][\w-]+$/.test(resto.split(/[.#]/).filter(Boolean).map((x) => "." + x)[0])) {
      /* forma inattesa: si ricade sul confronto semplice */
    }
    if (tag && n.tagName !== tag.toUpperCase()) return false;
    if (resto) {
      const parti = resto.match(/[.#][\w-]+/g) || [];
      for (const parte of parti) {
        if (parte[0] === ".") {
          if (!String(n.className).split(/\s+/).includes(parte.slice(1))) return false;
        } else if (n.attrs.id !== parte.slice(1)) {
          return false;
        }
      }
      return true;
    }
  }
  if (sel[0] === "#") return n.attrs.id === sel.slice(1);
  if (sel[0] === ".") return String(n.className).split(/\s+/).includes(sel.slice(1));
  if (sel[0] === "[") {
    const dentro = sel.slice(1, -1);
    const [k, v] = dentro.split("=");
    if (v === undefined) return k in n.attrs;
    return n.attrs[k] === v.replace(/^["']|["']$/g, "");
  }
  return n.tagName === sel.trim().toUpperCase();
}

/* Un selettore può essere un elenco: `h1, h2, h3`. Il mini DOM lo sapeva fare
   solo con un selettore alla volta, quindi `querySelector("h1, h2, h3")`
   cercava un tag chiamato «h1, h2, h3» e non trovava mai niente: il test dei
   nomi disallineati passava saltando **ogni** sezione. */
function combacia(n, sel) {
  const alternative = String(sel).split(",");
  if (alternative.length > 1) return alternative.some((a) => combacia(n, a));
  const parti = String(sel).trim().split(/\s+/);
  if (!semplice(n, parti[parti.length - 1])) return false;
  let i = parti.length - 2;
  let sopra = n.padre;
  while (i >= 0 && sopra) {
    if (semplice(sopra, parti[i])) i -= 1;
    sopra = sopra.padre;
  }
  return i < 0;
}

function parse(html) {
  const radice = nodo("html");
  const pila = [radice];
  let ultimo = 0;
  let m;
  RE_TAG.lastIndex = 0;
  while ((m = RE_TAG.exec(html))) {
    const testo = html.slice(ultimo, m.index);
    if (testo.trim()) pila[pila.length - 1]._testo += testo;
    ultimo = RE_TAG.lastIndex;
    const [, chiusura, tag, attributi, autoChiuso] = m;
    if (chiusura) { if (pila.length > 1) pila.pop(); continue; }
    if (SENZA_CONTENUTO.has(tag.toLowerCase())) {
      /* il contenuto di uno <script> non è struttura: si salta fino alla
         chiusura, altrimenti un `<` dentro una stringa crea nodi fantasma */
      const fine = html.toLowerCase().indexOf("</" + tag.toLowerCase(), ultimo);
      ultimo = fine > -1 ? html.indexOf(">", fine) + 1 : html.length;
      RE_TAG.lastIndex = ultimo;
      continue;
    }
    const el = nodo(tag);
    const RE_ATTR = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = RE_ATTR.exec(attributi || ""))) {
      if (a[1] === "class") el.className = a[2] || "";
      el.setAttribute(a[1], a[2] === undefined ? "" : a[2]);
    }
    pila[pila.length - 1].appendChild(el);
    if (!autoChiuso && !VUOTI.has(tag.toLowerCase())) pila.push(el);
  }
  return radice;
}

function pagina(nome) {
  return parse(fs.readFileSync(path.join(RADICE, nome), "utf8"));
}

/* ---------------------------------------------------------------- test -- */

const PAGINE = [
  { file: "app.html", menu: ".area-nav__link", sezione: "section.pnl",
    voci: 7, nome: "area del cliente" },
  { file: "admin.html", menu: ".app-nav__link", sezione: ".panel",
    voci: 11, nome: "console dell'ufficio" },
];

/* --------------------------------------------------------------------------
   La guardia che mancava.

   Questi test sono nati con il selettore della vecchia barra laterale
   (`.app-side`), che dopo la ristrutturazione non esiste più: le ricerche
   tornavano zero elementi e **tre test passavano senza aver guardato niente**.
   Un test che non trova ciò che deve controllare non è un test superato, è un
   test assente — e in una suite dà il permesso di rompere tutto senza
   accorgersene. Perciò ora ogni selezione si conta prima di usarla.
   -------------------------------------------------------------------------- */
function trova(d, selettore, minimo, dove) {
  const nodi = d.querySelectorAll(selettore);
  assert.ok(nodi.length >= minimo,
    `${dove}: il selettore «${selettore}» trova ${nodi.length} elementi su almeno ` +
    `${minimo}. Il markup è cambiato e il test non sta guardando niente.`);
  return nodi;
}

PAGINE.forEach((p) => {
  test(`${p.nome}: ogni voce del menu apre una sezione che esiste`, () => {
    const d = pagina(p.file);
    const rotte = [];
    trova(d, p.menu, p.voci, p.nome).forEach((voce) => {
      const id = (voce.getAttribute("href") || "").replace("#", "");
      if (!id) { rotte.push(voce.textContent + " → nessun href"); return; }
      if (!d.querySelector("#" + id)) rotte.push(voce.textContent + " → #" + id + " non esiste");
    });
    assert.deepStrictEqual(rotte, [],
      (rotte.length ? rotte.join(", ") + " — " : "") + "nessuna voce deve portare nel vuoto");
  });

  test(`${p.nome}: ogni sezione è raggiungibile da una voce del menu`, () => {
    const d = pagina(p.file);
    const nelMenu = new Set();
    trova(d, p.menu, p.voci, p.nome).forEach((v) =>
      nelMenu.add((v.getAttribute("href") || "").replace("#", "")));
    const orfane = [];
    trova(d, p.sezione, 11, p.nome).forEach((s) => {
      if (!s.id) return;
      if (s.className.split(/\s+/).includes("pnl--inner")) return;
      if (!nelMenu.has(s.id)) orfane.push("#" + s.id);
    });
    assert.deepStrictEqual(orfane, [],
      (orfane.length ? "sezioni che nessuna voce apre: " + orfane.join(", ") + " — " : "") +
      "ogni sezione deve avere una voce nel menu");
  });
});

/* --------------------------------------------------------------------------
   «Un nome per cosa»: il difetto che il cliente ha visto per primo.
   La voce «Registro attività» apriva un pannello intitolato «Soglie». Un menu
   che dice una cosa e un contenuto che ne dice un'altra è il modo più rapido
   per non fidarsi dello strumento.
   -------------------------------------------------------------------------- */
PAGINE.forEach((p) => {
  test(`${p.nome}: la voce del menu e il titolo della sezione dicono la stessa cosa`, () => {
    const d = pagina(p.file);
    const disallineate = [];
    trova(d, p.menu, p.voci, p.nome).forEach((voce) => {
      const id = (voce.getAttribute("href") || "").replace("#", "");
      if (!id) return;
      const sezione = d.querySelector("#" + id);
      if (!sezione) return;
      const titolo = sezione.querySelector("h1, h2, h3");
      /* la sezione può non avere un titolo (il riepilogo è fatto di cifre):
         in quel caso la voce non può mentire, e la si salta */
      if (!titolo) return;
      /* il numero accanto alla voce non è il suo nome: «Documenti 0» aperto
         su «Documenti della pratica» è lo stesso nome */
      const etichetta = voce.textContent.replace(/\d+/g, " ");
      const parole = normalizza(etichetta).split(" ").filter((w) => w.length > 3);
      const testo = normalizza(titolo.textContent);
      const inComune = parole.some((w) => testo.indexOf(w) > -1);
      if (!inComune) {
        disallineate.push(`«${voce.textContent.trim()}» apre «${titolo.textContent.trim()}»`);
      }
    });
    assert.deepStrictEqual(disallineate, [],
      (disallineate.length ? disallineate.join(" · ") + " — " : "") +
      "la voce del menu e il titolo della sezione devono dire la stessa cosa");
  });
});

function normalizza(t) {
  return String(t).toLowerCase()
    .replace(/[àáâ]/g, "a").replace(/[èé]/g, "e").replace(/[ìí]/g, "i")
    .replace(/[òó]/g, "o").replace(/[ùú]/g, "u").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
   Le tabelle. Un agente guarda una tabella per decidere cosa fare adesso: se
   ha dieci colonne, con tre che non servono a quella decisione e due senza
   nome, non decide — scorre. Undici colonne senza intestazione c'erano davvero.
   -------------------------------------------------------------------------- */
test("console: nessuna colonna senza nome", () => {
  const d = pagina("admin.html");
  const senzaNome = [];
  trova(d, "table", 12, "console").forEach((t) => {
    const th = t.querySelectorAll("thead th");
    if (!th.length) return;
    th.forEach((c, i) => {
      if (!c.textContent.trim()) senzaNome.push(`${t.id || "(tabella)"} · colonna ${i + 1}`);
    });
  });
  assert.deepStrictEqual(senzaNome, [],
    (senzaNome.length ? senzaNome.join(", ") + " — " : "") +
    "ogni colonna deve avere un nome: l'agente deve sapere cosa sta guardando");
});

test("console: nessuna tabella chiede di scorrere di lato", () => {
  /* Il numero di colonne non è un'estetica. Una tabella larga più dello spazio
     utile obbliga a trascinare, e chi non trascina non vede le ultime colonne —
     che sono quasi sempre quelle che dicono cosa fare.

     La larghezza si ricava dal contenuto, non da una soglia inventata: la cella
     più larga di ogni colonna dice quanto quella colonna chiede come minimo, e
     la somma è il minimo della tabella. Si aggiunge il padding, che è un numero
     vero del foglio di stile. */
  const d = pagina("admin.html");
  /* 1280 di `.app-main` meno i margini: lo spazio in cui le tabelle vivono. */
  const UTILE = 1022;
  /* padding orizzontale di una cella, andata e ritorno (`style.css`) */
  const PAD = 12;
  const larghe = [];

  trova(d, "table", 12, "console").forEach((t) => {
    const th = t.querySelectorAll("thead th");
    if (!th.length) return;
    const minimi = th.map(() => 0);
    t.querySelectorAll("tr").forEach((riga) => {
      const celle = riga.querySelectorAll("td");
      if (celle.length !== th.length) return;
      celle.forEach((cella, i) => {
        const testo = cella.textContent.trim();
        minimi[i] = Math.max(minimi[i], Math.min(240, testo.length * 6.6));
      });
    });
    const larghezza = minimi.reduce((s, w) => s + Math.max(56, w) + PAD, 0);
    if (larghezza > UTILE) {
      larghe.push(`${t.id || "(tabella)"}: ${th.length} colonne, almeno ` +
        `${Math.round(larghezza)}px su ${UTILE} disponibili`);
    }
  });
  assert.deepStrictEqual(larghe, [],
    (larghe.length ? larghe.join(" · ") + " — " : "") +
    "nessuna tabella deve costringere a trascinare di lato");
});

test("console: nessuna tabella chiede di confrontare troppe colonne", () => {
  /* La regola del cliente, alla lettera: «una tabella, una domanda; solo le
     colonne che servono a decidere». Oltre le nove colonne non si confronta più
     niente con gli occhi: si leggono due righe e si smette.

     È un limite stretto di proposito — oggi il massimo è nove — perché una
     tabella cresce una colonna alla volta, e nessuna di quelle aggiunte sembra
     mai quella di troppo. */
  const MASSIMO = 9;
  const d = pagina("admin.html");
  const larghe = [];
  trova(d, "table", 12, "console").forEach((t) => {
    const th = t.querySelectorAll("thead th");
    if (th.length > MASSIMO) {
      larghe.push(`${t.id || "(tabella)"}: ${th.length} colonne — ` +
        th.map((c) => c.textContent.trim() || "∅").join(", "));
    }
  });
  assert.deepStrictEqual(larghe, [],
    (larghe.length ? larghe.join(" · ") + " — " : "") +
    `nessuna tabella oltre ${MASSIMO} colonne: si legge, non si confronta`);
});

/* --------------------------------------------------------------------------
   Il menu deve stare in una riga, e le voci devono essere tutte visibili.
   La barra dell'area ha 8 voci; la console 11 con etichette corte.
   -------------------------------------------------------------------------- */
test("area del cliente: il menu ci sta in una riga", () => {
  const d = pagina("app.html");
  const voci = trova(d, ".area-nav__link", 7, "area del cliente").map((v) => v.textContent.trim());
  const larghezza = voci.reduce((s, v) => s + v.length * 7.0 + 20 + 23, 0) + (voci.length - 1) * 6;
  assert.ok(larghezza <= 1320,
    `il menu chiede ${Math.round(larghezza)}px su 1320: va a capo o scorre`);
});

test("console: il menu in una riga non sfonda", () => {
  const d = pagina("admin.html");
  const voci = trova(d, ".app-nav__link", 11, "console").map((v) => v.textContent.trim());
  const conCifra = d.querySelectorAll(".app-nav__link .chip__count").length;
  const larghezza = voci.reduce((s, v) => s + v.length * 6.7 + 18, 0) + conCifra * 26 + (voci.length - 1) * 6;
  assert.ok(larghezza <= 1320,
    `il menu della console chiede ${Math.round(larghezza)}px su 1320 con ${voci.length} voci`);
});

/* --------------------------------------------------------------------------
   Una cosa per volta: `hidden` lo mette il JavaScript, non l'HTML. Se fosse
   scritto nel file, chi ha lo script bloccato vedrebbe una pagina vuota.
   -------------------------------------------------------------------------- */
test("console: le sezioni sono una per volta, e senza JavaScript tornano tutte", () => {
  const css = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");
  assert.ok(/\.panel\[hidden\]\s*\{\s*display:\s*none/.test(css),
    "manca `.panel[hidden] { display: none }`: la console resterebbe tutta aperta");
  ["admin.html"].forEach((f) => {
    const html = fs.readFileSync(path.join(RADICE, f), "utf8");
    /* Niente regex: questo controllo è rimasto cieco due volte per una barra
       rovesciata di troppo, e un test cieco è peggio di nessun test. Qui si
       guarda l'attributo per quello che è: ` hidden` dentro il tag. */
    const nascoste = html.split("<section").slice(1).filter((blocco) =>
      /^[^>]*\shidden(?:[\s>=])/.test(blocco));
    assert.deepStrictEqual(nascoste, [],
      f + ": sezioni dichiarate `hidden` nell'HTML: senza JavaScript non si vedrebbero");
  });
});

/* --------------------------------------------------------------------------
   L'area cliente, che è il contrario: la pratica **si vede tutta**.

   Il cliente: «per vedere interamente tutte le funzioni bisogna trascinare,
   non abbiamo tempo e voglia». La risposta scelta è «riepilogo in cima, poi
   tutto sotto»: nessuna scheda che nasconde, nessun contenuto che esiste solo
   per chi indovina dove cliccare.

   Il test qui sotto è quello che impedisce di tornare indietro: se qualcuno
   rimette `hidden` su una sezione dell'area, il cliente si ritrova con la
   pagina che gli nasconde le cose, e non se ne accorge nessuno finché non
   protesta di nuovo.
   -------------------------------------------------------------------------- */
test("area cliente: la pratica si vede tutta, nessuna sezione nascosta", () => {
  const html = fs.readFileSync(path.join(RADICE, "app.html"), "utf8");
  /* Il tag **intero**: fermandosi all'`id` si perdeva `hidden`, che sta dopo,
     e il controllo non poteva accorgersi di niente. */
  const sezioni = html.match(/<section\b[^>]*>/g) || [];
  assert.ok(sezioni.length >= 7,
    `attese almeno 7 sezioni nella pagina della pratica, trovate ${sezioni.length}`);

  /* `hidden` scritto nell'HTML è il difetto: senza JavaScript la sezione
     resterebbe invisibile per sempre */
  const nascoste = sezioni.filter((tag) => /\shidden(?:[\s>=]|$)/.test(tag));
  assert.deepStrictEqual(nascoste, [],
    "sezioni nascoste nell'HTML: senza JavaScript non si vedrebbero");

  /* e il JavaScript non deve nasconderle: le voci del menu sono un indice,
     non delle schede */
  const js = fs.readFileSync(path.join(RADICE, "assets/js/case.js"), "utf8");
  assert.ok(!/\.hidden\s*=\s*nome\s*!==/.test(js) && !/sezione\.hidden\s*=/.test(js),
    "case.js nasconde ancora le sezioni: la pratica deve restare intera sotto il menu");
});

test("area cliente: il riepilogo sta in cima, prima delle sezioni", () => {
  const html = fs.readFileSync(path.join(RADICE, "app.html"), "utf8");
  const riepilogo = html.indexOf('id="riepilogo"');
  const pratica = html.indexOf('id="pratica"');
  assert.ok(riepilogo > -1, "manca la sezione del riepilogo: la prima domanda di chi " +
    "apre la pagina è «a che punto sono», e deve avere risposta senza cliccare");
  assert.ok(riepilogo < pratica, "il riepilogo deve venire prima della pratica");

  /* le quattro cifre che contano, dentro il riepilogo e non sparse */
  const blocco = html.slice(riepilogo, pratica);
  ["data-stat-phase", "data-stat-amount", "data-stat-docs"].forEach((segnaposto) => {
    assert.ok(blocco.indexOf(segnaposto) > -1,
      `il riepilogo non mostra ${segnaposto}: le quattro cose da sapere subito ` +
      "devono stare tutte insieme, in cima");
  });
});

module.exports = casi;
