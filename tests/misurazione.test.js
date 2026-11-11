/* ==========================================================================
   La misurazione delle campagne (Google Tag Manager)
   ==========================================================================
   Il contenitore `GTM-PCHTN7DM` è il solo modo per sapere se gli annunci
   portano qualcuno. Tre cose possono romperlo senza che nessuno se ne
   accorga guardando il sito:

   1. **sparisce da alcune pagine** alla prima rigenerazione. Le pagine le
      riscrivono `build_shell.py`, `build_i18n.py` e `versione_asset.py`:
      uno snippet incollato a mano sopravvive finché qualcuno non rigenera,
      e poi resta solo dove nessuno ha guardato. Un sito che misura metà
      delle pagine sembra misurare;
   2. **la policy di sicurezza lo blocca**. `vercel.json` dichiara una
      `Content-Security-Policy`; senza `googletagmanager.com` in
      `script-src` il browser non scarica niente, l'errore si vede solo
      nella console di chi apre gli strumenti, e il contenitore risulta
      «installato» mentre non riceve una visita;
   3. **compare due volte** (snippet vecchio + nuovo): ogni visita viene
      contata doppia, il costo per lead dimezza per finta e la decisione
      successiva si prende su un numero falso.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const CONFIG = JSON.parse(R("tools/misurazione.json"));
const GTM = CONFIG.gtm;

/* Tutte le pagine servite: le italiane, l'area riservata e le tre lingue. */
const PAGINE = [
  "index.html", "come-funziona.html", "casi.html", "crypto.html",
  "chi-siamo.html", "team.html", "onorari.html", "supporto.html",
  "login.html", "privacy.html", "termini.html", "cookie.html",
  "note-legali.html", "404.html", "app.html", "admin.html",
];
const TRADOTTE = PAGINE.filter((p) => p !== "app.html" && p !== "admin.html");
const TUTTE = PAGINE.concat(
  ["en", "de", "es"].flatMap((l) => TRADOTTE.map((p) => `${l}/${p}`))
);

/* ------------------------------------------------------------ il contenitore -- */

test("l'identificatore del contenitore è scritto in un posto solo", () => {
  assert.match(GTM, /^GTM-[A-Z0-9]{6,9}$/, `identificatore implausibile: «${GTM}»`);
  /* Chi lo cambia non deve doverlo cercare in 58 file: se un giorno il
     contenitore viene rifatto, `tools/misurazione.json` è l'unico punto. */
  const manine = PAGINE.concat(TRADOTTE)
    .concat(["en/index.html", "de/index.html", "es/index.html"])
    .filter((p) => {
      const h = R(p);
      const altri = [...h.matchAll(/GTM-[A-Z0-9]{6,9}/g)].map((m) => m[0]);
      return altri.some((g) => g !== GTM);
    });
  assert.equal(manine.length, 0,
    `un secondo contenitore in pagina: ${manine[0]} — ogni visita conterebbe doppia`);
});

test("snippet di Google: lo script va **prima** di ogni altro, o il primo clic si perde", () => {
  const h = R("index.html");
  const iBlocco = h.indexOf("<!-- shell:misurazione -->");
  assert.ok(iBlocco > 0, "manca il blocco della misurazione in index.html");
  /* La regola vera: il primo `<script>` della pagina è quello del
     contenitore. Il sito ne ha un altro in testa (l'animazione d'ingresso,
     che deve partire prima del primo paint): se quello scavalca GTM, il
     primo clic dell'annuncio può arrivare quando il `dataLayer` non esiste
     ancora e la visita non viene attribuita. */
  const iPrimoScript = h.search(/<script/i);
  assert.ok(iPrimoScript > iBlocco,
    "uno script parte prima di GTM: il primo clic può non essere attribuito");
});

test("la pagina di ripiego senza JavaScript c'è, e sta nel body", () => {
  const h = R("index.html");
  const iNoscript = h.indexOf("googletagmanager.com/ns.html");
  assert.ok(iNoscript > 0, "manca il <noscript>: chi naviga senza JS non è contato");
  assert.ok(iNoscript > h.indexOf("<body"), "il <noscript> di GTM va dentro il <body>");
  assert.match(h.slice(iNoscript - 200, iNoscript + 200), /height="0"/,
    "l'iframe di ripiego occuperebbe spazio in pagina");
});

/* --------------------------------------------------------------- le pagine -- */

test("la misurazione è su tutte le pagine servite, lingua tedesca compresa", () => {
  const senza = TUTTE.filter((p) => !fs.existsSync(path.join(RADICE, p)) || !R(p).includes(GTM));
  assert.equal(senza.length, 0, `senza GTM: ${senza.slice(0, 5).join(", ")}`);
});

test("ogni pagina ha il contenitore una volta sola", () => {
  const doppie = TUTTE.filter((p) => (R(p).match(/GTM-[A-Z0-9]{6,9}/g) || []).length !== 2);
  /* due è giusto: lo script in testa e l'iframe di ripiego */
  assert.equal(doppie.length, 0, `conteggio sbagliato in: ${doppie.slice(0, 5).join(", ")}`);
});

/* --------------------------------------------------------------- la policy -- */

test("la policy di sicurezza lascia passare Google, o GTM è bloccato in silenzio", () => {
  const v = JSON.parse(R("vercel.json"));
  let csp = null;
  for (const gruppo of v.headers || []) {
    for (const h of gruppo.headers || []) {
      if (h.key.toLowerCase() === "content-security-policy") csp = h.value;
    }
  }
  assert.ok(csp, "vercel.json non dichiara più una CSP: questo test va rivisto, non cancellato");

  const direttiva = (nome) => {
    const m = csp.match(new RegExp(`(?:^|;)\\s*${nome}\\s+([^;]+)`));
    return m ? m[1].trim() : "";
  };
  for (const host of ["https://www.googletagmanager.com"]) {
    assert.ok(direttiva("script-src").includes(host),
      `script-src non ammette ${host}: il browser non scarica il contenitore`);
  }
  assert.match(direttiva("script-src"), /'self'/,
    "la CSP deve continuare ad ammettere gli script del sito");
  assert.ok(direttiva("frame-src").includes("googletagmanager.com"),
    "frame-src non ammette l'iframe di ripiego");
  assert.ok(direttiva("connect-src").includes("google-analytics.com"),
    "connect-src non ammette le chiamate di Analytics: la visita parte e non arriva");
  assert.ok(direttiva("img-src").includes("google-analytics.com"),
    "img-src non ammette il pixel di ripiego di Analytics");
});

test("il generatore è idempotente: rigenerare non aggiunge un secondo contenitore", () => {
  const esito = spawnSync("python3", ["tools/misurazione.py", "--check"], {
    cwd: RADICE, encoding: "utf8",
  });
  assert.equal(esito.status, 0,
    `pagine disallineate da tools/misurazione.py:\n${esito.stdout}${esito.stderr}`);
});

module.exports = casi;
