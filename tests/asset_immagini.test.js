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

module.exports = casi;
