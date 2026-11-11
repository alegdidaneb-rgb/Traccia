/* ==========================================================================
   Gli annunci della campagna
   ==========================================================================
   Il cliente: «need to make 2 day campaign of 12 usd». Con 24 $ non si compra
   un risultato, si compra **una risposta a una domanda**: l'annuncio porta
   clic? Perché la risposta sia leggibile servono tre cose, e se manca una il
   denaro è speso per niente.

   1. **Le immagini esistono davvero**, nelle quattro misure che servono, e
      dentro non c'è testo (Meta abbassa la distribuzione, e un'immagine con
      le parole dentro non si corregge dopo il primo giorno);
   2. **i testi stanno nei limiti di Meta** (titolo 40, primario 125,
      descrizione 30) e non promettono un risultato — il pubblico è chi è
      appena stato truffato, e «garantito» è la parola che sta cercando per
      riconoscere un truffatore;
   3. **si sa da dove arriva il clic**: senza, dopo due giorni si è speso 24 $
      e non si è imparato niente, che è l'unico modo di sbagliare davvero un
      test piccolo.
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

const FORMATI = {
  "feed-quadrato": [1080, 1080],
  "feed-verticale": [1080, 1350],
  "storia": [1080, 1920],
  "orizzontale": [1200, 628],
};
const LINGUE = ["de", "it", "en", "es"];
const LIMITI = { titolo: 40, primario: 125, descrizione: 30 };

/* Le stesse parole che i test del catalogo WhatsApp già vietano: qui valgono
   allo stesso modo, perché un annuncio è più pubblico di un catalogo. */
const VIETATE = [
  /\bgarantit[oi]\b/i, /\bgarantiamo\b/i, /\bguarantee[ds]?\b/i, /\bgarantiert/i,
  /\bgarantizad[oa]s?\b/i,
  /\brecuperiamo\b/i, /\bwe recover\b/i, /\bwir holen\b/i, /\brecuperamos\b/i,
  /\bti restituiamo\b/i, /\bwe will return\b/i, /\bwir erstatten\b/i,
  /\bte devolvemos\b/i,
  /\b100 ?%/,
  /\bsoldi indietro\b/i, /\bmoney back\b/i, /\bgeld zurück\b/i,
  /\bdevolución del dinero\b/i,
];

const TESTI = JSON.parse(R("pubblicita/annunci.json"));

test("i quattro formati ci sono, e sono le misure giuste", () => {
  /* Le misure non sono estetica: Meta rifiuta o ritaglia. 1080×1080 è il
     feed, 1080×1920 la storia, 1200×628 l'unico orizzontale che va anche
     fuori da Meta. Sbagliarle significa caricare un'immagine che il
     posizionamento automatico taglia a metà. */
  Object.keys(FORMATI).forEach((nome) => {
    const file = `pubblicita/${nome}.jpg`;
    assert.ok(esiste(file), `manca ${file} — esegui python3 tools/pubblicita.py`);
    const byte = fs.readFileSync(path.join(RADICE, file));
    // le dimensioni stanno nell'intestazione JPEG (SOF0/SOF2): si leggono da lì
    // senza dipendenze, perché il test deve girare con `node` e basta
    let i = 2, larghezza = 0, altezza = 0;
    while (i < byte.length) {
      if (byte[i] !== 0xff) { i++; continue; }
      const marcatore = byte[i + 1];
      const lunghezza = byte.readUInt16BE(i + 2);
      if (marcatore >= 0xc0 && marcatore <= 0xcf &&
          marcatore !== 0xc4 && marcatore !== 0xc8 && marcatore !== 0xcc) {
        altezza = byte.readUInt16BE(i + 5);
        larghezza = byte.readUInt16BE(i + 7);
        break;
      }
      i += 2 + lunghezza;
    }
    assert.deepStrictEqual([larghezza, altezza], FORMATI[nome],
      `${nome}: è ${larghezza}×${altezza}, deve essere ${FORMATI[nome].join("×")}`);
  });
});

test("dentro l'immagine non c'è testo, solo il marchio", () => {
  /* Meta abbassa la distribuzione delle immagini con molto testo. La regola
     qui è più stretta di quella di Meta: solo la «T» e il nome. Il resto lo
     mettono i campi dell'annuncio, che si possono correggere domani e
     tradurre in quattro lingue gratis. */
  const sorgente = R("tools/pubblicita.py");
  assert.match(sorgente, /VELO_INIZIO = 0\.62/,
    "il velo non parte al 62%: sopra ci deve essere la foto, non una scritta");
  assert.match(sorgente, /VELO_NERO = 0\.65/);
  /* un solo `d.text`: il nome accanto al marchio. Se ne compare un secondo,
     qualcuno ha aggiunto una scritta all'immagine. */
  const testi = sorgente.match(/d\.text\(/g) || [];
  assert.strictEqual(testi.length, 1,
    `nell'immagine finiscono ${testi.length} testi invece di uno (il nome accanto al marchio)`);
});

test("i testi stanno nei limiti di Meta, in tutte e quattro le lingue", () => {
  LINGUE.forEach((lingua) => {
    const t = TESTI[lingua];
    assert.ok(t, `manca la lingua ${lingua} in pubblicita/annunci.json`);
    Object.keys(LIMITI).forEach((campo) => {
      const testo = t[campo];
      assert.ok(testo, `${lingua}: manca «${campo}»`);
      assert.ok(testo.length <= LIMITI[campo],
        `${lingua}/${campo}: ${testo.length} caratteri, il limite è ${LIMITI[campo]}`);
    });
  });
});

test("nessun annuncio promette un risultato", () => {
  /* Il pubblico dell'annuncio è chi ha appena perso dei soldi: sta cercando
     proprio le parole dei truffatori per riconoscerle. «Garantito» in un
     annuncio non è pubblicità aggressiva, è la prova che siamo uguali. */
  LINGUE.forEach((lingua) => {
    const t = TESTI[lingua];
    const testo = `${t.titolo} ${t.primario} ${t.descrizione}`;
    VIETATE.forEach((re) => {
      assert.ok(!re.test(testo),
        `${lingua}: promette un risultato («${(testo.match(re) || [])[0]}»)`);
    });
  });
});

test("ogni lingua porta al suo sito, con il parametro della campagna", () => {
  /* Un annuncio tedesco che porta alla home italiana è denaro speso per far
     sentire qualcuno nel posto sbagliato. E senza `utm_source` la console non
     sa dire da dove è arrivata la segnalazione. */
  LINGUE.forEach((lingua) => {
    const t = TESTI[lingua];
    /* l'italiano sta in radice (`traccia.it.com/`), le altre sotto la loro
       lingua: è la struttura del sito, non una scelta dell'annuncio */
    const attesa = lingua === "it"
      ? "https://traccia.it.com/"
      : `https://traccia.it.com/${lingua}/`;
    assert.strictEqual(t.destinazione, attesa,
      `${lingua}: porta a ${t.destinazione}, deve portare a ${attesa}`);
    assert.ok(t.utm.includes("utm_source=meta"),
      `${lingua}: manca utm_source, la segnalazione non sarà attribuibile`);
    assert.ok(t.utm.includes(`utm_campaign=${lingua}`),
      `${lingua}: la campagna deve dire la lingua, altrimenti i due giorni non distinguono nulla`);
  });
});

test("la segnalazione sa da dove arriva", () => {
  /* Il modulo scriveva `origine: "login"`, cioè il nome della pagina. Con una
     campagna accesa quella colonna è l'unica che può dire quale annuncio ha
     portato quella persona. */
  const auth = R("assets/js/auth.js");
  assert.ok(!/origine:\s*"login"/.test(auth),
    "il modulo scrive ancora `origine: \"login\"`: la colonna non dirà mai niente");
  assert.match(auth, /TracciaOrigine\.valore\(\)/,
    "il modulo non legge l'origine dall'indirizzo");
  assert.ok(esiste("assets/js/origine.js"), "manca assets/js/origine.js");

  const origine = R("assets/js/origine.js");
  // la prima visita vince: sovrascrivere trasforma «chi mi ha portato» in
  // «dov'era l'ultima volta»
  assert.match(origine, /CHIAVE = "traccia_origine"/);
  assert.match(origine, /GIORNI = 30/);
  assert.match(origine, /if \(salvato\) return salvato\.valore;/,
    "l'origine salvata non prevale: una seconda visita cancellerebbe l'annuncio");
  // e deve essere sulle pagine dove si atterra, non solo su quella del modulo
  ["index.html", "login.html", "de/index.html", "de/login.html"].forEach((pagina) => {
    assert.match(R(pagina), /js\/origine\.js/,
      `${pagina} non carica origine.js: chi atterra qui non viene attribuito`);
  });
});

test("la console mostra l'origine in una forma leggibile", () => {
  /* `META-DE` non si legge. Con una campagna da 24 $ la colonna origine è la
     sola cosa che si può imparare, e deve costare zero decodifica. */
  const admin = R("assets/js/admin.js");
  assert.match(admin, /function etichettaOrigine/);
  assert.match(admin, /etichettaOrigine\(r\.origine\)/);
  assert.match(admin, /v === "login"/,
    "le righe vecchie dicono ancora «login» invece di «diretta»");
});

test("gli annunci si rigenerano da un comando, senza un grafico", () => {
  const pillow = spawnSync("python3", ["-c", "import PIL"], { cwd: RADICE });
  if (pillow.status !== 0) {
    console.log("      (saltato: Pillow non è installato in questo ambiente)");
    return;
  }
  /* Con 24 $ di budget non c'è un grafico. Se le immagini si fanno a mano,
     il giorno che cambia un colore non si rifanno più. */
  const esito = spawnSync("python3", ["tools/pubblicita.py", "--check"],
    { cwd: RADICE, encoding: "utf8" });
  assert.strictEqual(esito.status, 0, esito.stdout + esito.stderr);
});

test("il foglio dei due giorni c'è, e dice la regola prima di spendere", () => {
  /* Con 24 $ la cosa che si compra è una decisione, non un risultato. Una
     decisione presa dopo aver guardato i numeri non è una decisione: è una
     giustificazione. La regola va scritta prima, e deve esserci. */
  const foglio = R("pubblicita/campagna-24-dollari.md");
  assert.match(foglio, /≥ 25 clic/, "manca la soglia dei clic che distingue pagina e annuncio");
  assert.match(foglio, /tedesco/, "il foglio non dice di usare una lingua sola");
  /* e la stima non deve diventare una promessa: si scrive un intervallo */
  assert.match(foglio, /0,4 – 2,2|0,4 - 2,2/, "manca l'intervallo delle segnalazioni attese");
});

module.exports = casi;
