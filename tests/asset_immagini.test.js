/* ==========================================================================
   Ogni immagine che una pagina chiede esiste davvero
   ==========================================================================
   Il difetto da cui nasce questo file: `img/team/` e `img/marchio/` stanno due
   gradini sotto `assets/img/`, e `versione_asset.py` copiava un livello solo.
   Le nove fotografie del team erano 404 su ogni pagina — cioè su team.html,
   che è la pagina delle fotografie — e nessuno se ne accorgeva: il resto
   della pagina arrivava, un'immagine mancante non fa rumore, lascia un
   riquadro vuoto.

   Un test che guarda i file, non l'HTML: il difetto non era nell'HTML.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");

function pagine() {
  const out = [];
  const scendi = (dir) => {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
      if (voce.name === "node_modules" || voce.name.startsWith(".") ||
          voce.name === "assets" || voce.name === "supabase" || voce.name === "tools") continue;
      const pieno = path.join(dir, voce.name);
      if (voce.isDirectory()) scendi(pieno);
      else if (voce.name.endsWith(".html")) out.push(pieno);
    }
  };
  scendi(RADICE);
  return out;
}

/* tutti i riferimenti `assets/<hash>/<cartella>/…` presenti nelle pagine */
function riferimenti() {
  const re = /assets\/[0-9a-f]{8}\/(?:img|fonts)\/[A-Za-z0-9_.\/-]+\.(?:jpg|jpeg|png|webp|svg|woff2?)/g;
  const perFile = new Map();
  for (const pagina of pagine()) {
    const testo = fs.readFileSync(pagina, "utf8");
    for (const trovato of testo.match(re) || []) {
      if (!perFile.has(trovato)) perFile.set(trovato, []);
      perFile.get(trovato).push(path.relative(RADICE, pagina));
    }
  }
  return perFile;
}

test("ogni immagine citata da una pagina esiste nel percorso in cui è citata", () => {
  const rotte = [];
  for (const [rif, dove] of riferimenti()) {
    if (!fs.existsSync(path.join(RADICE, rif))) rotte.push(rif + "  (in " + dove[0] + ")");
  }
  assert.deepStrictEqual(rotte, [],
    "immagini citate e assenti:\n  " + rotte.slice(0, 12).join("\n  "));
});

test("i ritratti del team esistono tutti, in jpg e in webp", () => {
  /* Il caso concreto: nove persone, due misure, due formati. Se ne manca uno
     il browser ripiega su `src`, ma se manca `src` il riquadro resta vuoto. */
  const dati = fs.readFileSync(path.join(RADICE, "assets", "js", "team.js"), "utf8");
  /* ogni persona ha `foto: "nome-cognome"`; `foto: null` è chi usa le
     iniziali al posto del ritratto, ed è una scelta, non una mancanza */
  const foto = [...dati.matchAll(/foto:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(foto.length >= 9, "attese almeno nove persone con fotografia, trovate " + foto.length);

  const cartella = [...riferimenti().keys()]
    .map((r) => r.split("/").slice(0, 4).join("/"))
    .find((d) => d.endsWith("/img/team"));
  assert.ok(cartella, "nessuna pagina cita un ritratto: il percorso degli asset è cambiato");

  const mancanti = [];
  for (const nome of foto) {
    for (const misura of ["480", "960"]) {
      for (const ext of ["jpg", "webp"]) {
        const file = path.join(RADICE, cartella, `${nome}-${misura}.${ext}`);
        if (!fs.existsSync(file)) mancanti.push(`${nome}-${misura}.${ext}`);
      }
    }
  }
  assert.deepStrictEqual(mancanti, [], "ritratti assenti: " + mancanti.join(", "));
});

test("il generatore degli asset copia anche le sottocartelle", () => {
  const script = fs.readFileSync(path.join(RADICE, "tools", "versione_asset.py"), "utf8");
  assert.ok(/rglob\("\*"\)/.test(script),
    "versione_asset.py deve copiare ricorsivamente: `glob(\"*\")` salta img/team/");
  assert.ok(!/for f in sorted\(sorgente\.glob\("\*"\)\):/.test(script),
    "è tornata la copia a un livello solo");
});

test("ogni cartella di asset citata esiste **nel repository**, non solo su questo disco", () => {
  /* Il difetto vero, quello che ha lasciato i ritratti rotti in produzione:
     la cartella c'era sul mio disco perché `versione_asset.py` l'aveva appena
     creata, ma i file non erano stati aggiunti a git. In locale le foto si
     vedevano; online no, e niente lo diceva.

     Qui si chiede a git, non al disco: se un file esiste ma non è tracciato,
     non arriverà mai su Vercel. */
  const { spawnSync } = require("child_process");
  const git = spawnSync("git", ["ls-files", "--", "assets"], { cwd: RADICE, encoding: "utf8" });
  if (git.status !== 0) return;            /* niente git: non si può dire */
  const tracciati = new Set(git.stdout.split("\n").filter(Boolean));

  const cartelle = new Set();
  for (const rif of riferimenti().keys()) {
    /* cartella = tutto fino all'ultimo `/`, es. assets/abc12345/img/team */
    cartelle.add(rif.slice(0, rif.lastIndexOf("/")));
  }
  const vuote = [...cartelle].filter((c) =>
    ![...tracciati].some((f) => f.startsWith(c + "/")));
  assert.deepStrictEqual(vuote, [],
    "cartelle citate dalle pagine ma senza file in git:\n  " + vuote.join("\n  "));
});

test("nessuna pagina cita una cartella di un'altra versione", () => {
  /* Due versioni vive insieme sono lecite (chi ha la pagina vecchia in cache
     deve poterla ancora caricare), ma una pagina deve citarne una sola.
     `versione_asset.py` lo controlla; questo test lo rende visibile a chi
     guarda la suite senza eseguire la build. */
  const versioni = new Map();
  for (const pagina of pagine()) {
    const testo = fs.readFileSync(pagina, "utf8");
    const viste = new Set((testo.match(/assets\/[0-9a-f]{8}\//g) || []));
    if (viste.size > 1) versioni.set(path.relative(RADICE, pagina), [...viste]);
  }
  assert.deepStrictEqual([...versioni.keys()], [],
    "pagine con due versioni di asset: " + [...versioni.entries()].slice(0, 3).join(" | "));
});

test("le pagine tradotte chiedono le immagini alla radice, non dentro la lingua", () => {
  /* Il difetto: in `/en/team.html` gli attributi `srcset="assets/…"` erano
     rimasti relativi. Da `/en/`, `assets/img/…` è `/en/assets/img/…`, che non
     esiste: le fotografie del team erano 404 in inglese, tedesco e spagnolo —
     mentre in italiano si vedevano. Un difetto che si nota solo cambiando
     lingua, cioè quasi mai: chi lo scrive lo guarda in italiano. */
  const re = /srcset="([^"]*)"/g;
  const relativi = [];
  for (const pagina of pagine()) {
    const rel = path.relative(RADICE, pagina);
    if (!/^(en|de|es)[\/\\]/.test(rel)) continue;
    const testo = fs.readFileSync(pagina, "utf8");
    for (const m of testo.matchAll(re)) {
      for (const pezzo of m[1].split(",")) {
        const url = pezzo.trim().split(/\s+/)[0];
        if (url && !/^(\/|https?:|data:)/.test(url)) relativi.push(rel + " → " + url);
      }
    }
    /* e lo stesso per `src` */
    for (const m of testo.matchAll(/src="([^"]+)"/g)) {
      const url = m[1];
      if (!/^(\/|https?:|data:)/.test(url)) relativi.push(rel + " → src=" + url);
    }
  }
  assert.deepStrictEqual(relativi.slice(0, 6), [],
    "indirizzi relativi in una pagina tradotta:\n  " + relativi.slice(0, 6).join("\n  "));
});

test("vercel.json è fatto di regole che Vercel accetta", () => {
  /* Il difetto: `"/assets/(fonts|img)/(.*)"` non è una sintassi valida per
     `headers[].source`, e Vercel **rifiuta l'intero deploy** con
     «Header at index 3 has invalid `source` pattern». Non un avviso: il sito
     resta fermo alla versione precedente, senza che nessuno se ne accorga —
     il merge era passato, il deploy no. È così che i ritratti del team sono
     rimasti rotti in produzione per due correzioni di fila.

     Le parentesi di raggruppamento `(a|b)` non sono ammesse; i parametri
     nominati `:nome` e le espressioni `(.*)` sì. */
  const regole = JSON.parse(fs.readFileSync(path.join(RADICE, "vercel.json"), "utf8")).headers || [];
  const rotte = regole.map((r) => r.source).filter((s) => /\([^)]*\|[^)]*\)/.test(s));
  assert.deepStrictEqual(rotte, [],
    "regole con raggruppamento `(a|b)`, che Vercel rifiuta: " + rotte.join(", "));
  regole.forEach((r) => {
    assert.ok(Array.isArray(r.headers) && r.headers.length,
      "regola senza intestazioni: " + r.source);
  });
});

module.exports = casi;

