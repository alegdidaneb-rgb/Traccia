/* ==========================================================================
   Il marchio
   ==========================================================================
   In pagina il marchio non è un'immagine: è `.brand__mark`, uno `<span>` con
   un bordo arrotondato e una «T» dentro. Nitido a ogni zoom, zero byte.
   Funziona dappertutto tranne dove serve un file — un annuncio, un'anteprima,
   l'icona sul telefono — e lì il marchio va disegnato.

   Il rischio non è disegnarlo male: è disegnarlo **diverso** da quello in
   pagina. Un logo che cambia faccia fra il sito e l'annuncio è la prima cosa
   che nota chi confronta, e l'unico modo di non accorgersene è non guardare.
   Per questo i numeri stanno in un posto solo (il CSS) e questi test li
   confrontano con quelli dello script.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const esiste = (f) => fs.existsSync(path.join(RADICE, f));

const CSS = R("assets/css/style.css");

/* Pillow serve solo a rigenerare i file, non a controllarli: le misure e il
   canale alfa si leggono dall'intestazione PNG. Se manca, i test che
   *eseguono* gli script lo dicono invece di fallire — un rosso che significa
   «manca una libreria nel sandbox» insegna a ignorare i rossi. */
function haPillow() {
  return spawnSync("python3", ["-c", "import PIL"], { cwd: RADICE }).status === 0;
}
const SCRIPT = R("tools/marchio.py");
const LATI = [32, 48, 180, 512, 1024];

test("il marchio è quello del CSS, non uno nuovo", () => {
  /* `.brand__mark` è 30×30, raggio 9, `0.95rem` di «T». Lo script deve partire
     dagli stessi numeri: se il CSS cambia e lo script no, il logo cambia faccia
     fra sito e annuncio senza che nessuno abbia deciso niente. */
  const regola = CSS.match(/\.brand__mark\s*\{([^}]*)\}/);
  assert.ok(regola, "manca .brand__mark in style.css");
  const corpo = regola[1];
  assert.match(corpo, /width:\s*30px/);
  assert.match(corpo, /height:\s*30px/);
  assert.match(corpo, /border-radius:\s*9px/);
  assert.match(corpo, /font-size:\s*0\.95rem/);

  // e lo script legge proprio quei numeri
  assert.match(SCRIPT, /RAGGIO = 9 \/ 30/, "il raggio non è quello del CSS (9 su 30)");
  assert.match(SCRIPT, /0\.95 \* 16/, "la dimensione della «T» non è quella del CSS");
});

test("i colori sono quelli del marchio", () => {
  /* Se il lime diventa un lime qualsiasi, il marchio invecchia in un modo che
     si vede solo accostato al sito. */
  assert.match(CSS, /--ink:\s*#0b0b0f/i);
  assert.match(CSS, /--accent-lime:\s*#c8f169/i);
  assert.match(SCRIPT, /INK = \(11, 11, 15, 255\)/, "#0b0b0f non è (11,11,15) nello script");
  assert.match(SCRIPT, /LIME = \(200, 241, 105, 255\)/, "#c8f169 non è (200,241,105) nello script");
});

test("il marchio è in tutte le misure che servono", () => {
  /* 32 è la linguetta del browser, 180 quella che iOS mette in home, 512 quella
     che chiedono le anteprime. Una sola misura costringe il sistema operativo a
     inventarsi le altre, e le inventa sfocate. */
  LATI.forEach((lato) => {
    assert.ok(esiste(`assets/img/marchio/marchio-${lato}.png`),
      `manca marchio-${lato}.png — esegui python3 tools/marchio.py`);
    const byte = fs.readFileSync(path.join(RADICE, `assets/img/marchio/marchio-${lato}.png`));
    // PNG: larghezza e altezza sono i due interi dopo la firma e il blocco IHDR
    assert.strictEqual(byte.readUInt32BE(16), lato, `marchio-${lato}.png non è largo ${lato}`);
    assert.strictEqual(byte.readUInt32BE(20), lato, `marchio-${lato}.png non è alto ${lato}`);
  });
});

test("il marchio è trasparente fuori dal quadrato arrotondato", () => {
  /* Senza trasparenza, l'icona su iOS è un quadrato nero dentro un quadrato
     bianco: si vede il bordo e sembra un errore.

     Il byte 25 dell'intestazione PNG è il *color type*: 6 vuol dire RGBA,
     cioè che il canale alfa c'è. Si legge dai byte e non con Pillow, così il
     controllo gira anche dove Pillow non è installato — ed è il controllo che
     conta: se il marchio perdesse la trasparenza, si vedrebbe su ogni
     telefono. */
  const byte = fs.readFileSync(path.join(RADICE, "assets/img/marchio/marchio-512.png"));
  assert.strictEqual(byte.readUInt32BE(0), 0x89504e47, "non è un PNG");
  const tipoColore = byte[25];
  assert.strictEqual(tipoColore, 6,
    `il PNG non ha il canale alfa (color type ${tipoColore}, serve 6): l'angolo sarà pieno`);
});

test("il marchio dichiarato nelle pagine è quello che esiste", () => {
  /* Un `<link rel="icon">` che punta a un file vecchio è il modo più silenzioso
     di avere due loghi diversi: quello sulla linguetta e quello sul sito. */
  ["index.html", "login.html"].forEach((pagina) => {
    const html = R(pagina);
    const icone = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)]
      .map((m) => m[0]);
    icone.forEach((tag) => {
      const href = (tag.match(/href="([^"]+)"/) || [])[1];
      if (!href || href.startsWith("data:")) return;
      const pulito = href.split("?")[0].replace(/^\/+/, "");
      assert.ok(esiste(pulito), `${pagina}: l'icona ${href} non esiste`);
    });
  });
});

test("il marchio si rigenera da un comando", () => {
  if (!haPillow()) {
    console.log("      (saltato: Pillow non è installato in questo ambiente)");
    return;
  }
  const esito = spawnSync("python3", ["tools/marchio.py", "--check"],
    { cwd: RADICE, encoding: "utf8" });
  assert.strictEqual(esito.status, 0, esito.stdout + esito.stderr);
});

module.exports = casi;
