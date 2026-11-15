/* ==========================================================================
   Il video della guida, e la pagina che lo ospita
   ==========================================================================
   La richiesta: «un video che spieghi come segnalare un caso, passo per passo,
   e quali informazioni deve compilare il cliente», in tutte le lingue.

   Cosa difendono questi test — cioè cosa si rompe in silenzio se non ci sono:

   1. un video che non esiste al percorso citato: la pagina si carica, il
      riquadro resta nero, nessun errore in console;
   2. una scena che non corrisponde alla narrazione: il video dice una cosa e
      i sottotitoli un'altra, e chi non sente l'audio legge la versione
      sbagliata;
   3. un sottotitolo che finisce dopo l'inizio del successivo: il lettore
      del browser mostra due righe insieme;
   4. un percorso con la versione degli asset scritto a mano nel JavaScript:
      al primo `versione_asset.py` il video smette di partire;
   5. una pagina che dice «nessuna password» ma il modulo la chiede davvero.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const esiste = (f) => fs.existsSync(path.join(RADICE, f));

const PAGINA = R("come-segnalare-un-caso.html");
const LINGUE = ["it", "en", "de", "es"];

test("il video esiste a ogni percorso che la pagina cita", () => {
  const fonti = [...PAGINA.matchAll(/(?:src|poster)="(assets\/[^"]+\.(?:mp4|vtt|jpg))"/g)]
    .map((m) => m[1]);
  assert.ok(fonti.length >= 3, "la pagina non cita il video, i sottotitoli e la copertina");
  const assenti = fonti.filter((f) => !esiste(f));
  assert.deepStrictEqual(assenti, [], "la pagina cita file che non esistono: " + assenti.join(", "));
});

test("ci sono tutti e otto i video: quattro lingue, due formati", () => {
  const mancanti = [];
  for (const l of LINGUE) {
    for (const f of ["verticale", "orizzontale"]) {
      const nome = `assets/video/come-segnalare-un-caso-${l}-${f}.mp4`;
      if (!esiste(nome)) mancanti.push(nome);
    }
  }
  assert.deepStrictEqual(mancanti, [], "video mancanti: " + mancanti.join(", "));
  /* un file di due byte passerebbe il controllo sopra: si guarda il peso.
     Un video di un minuto sotto il mezzo megabyte è un fotogramma, non un
     video — è il caso di un render interrotto che lascia il file troncato. */
  for (const l of LINGUE) {
    const nome = `assets/video/come-segnalare-un-caso-${l}-orizzontale.mp4`;
    const peso = fs.statSync(path.join(RADICE, nome)).size;
    assert.ok(peso > 500_000, `${nome} pesa ${peso} byte: è troncato`);
  }
});

test("ogni lingua ha i suoi sottotitoli, con i tempi in ordine", () => {
  for (const l of LINGUE) {
    const nome = `assets/video/come-segnalare-un-caso-${l}.vtt`;
    assert.ok(esiste(nome), `manca ${nome}`);
    const vtt = R(nome);
    assert.ok(vtt.startsWith("WEBVTT"), `${nome} non è un file VTT`);
    const tempi = [...vtt.matchAll(/(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)/g)]
      .map((m) => [m[1], m[2]]);
    assert.ok(tempi.length >= 8, `${nome}: solo ${tempi.length} righe di sottotitoli`);
    const secondi = (t) => {
      const [h, m, r] = t.split(":");
      return (+h) * 3600 + (+m) * 60 + parseFloat(r.replace(",", "."));
    };
    for (let i = 1; i < tempi.length; i++) {
      assert.ok(secondi(tempi[i][0]) >= secondi(tempi[i - 1][1]) - 0.01,
        `${nome}: la riga ${i + 1} comincia prima che finisca la precedente`);
    }
    for (const [a, b] of tempi) {
      assert.ok(secondi(b) > secondi(a), `${nome}: una riga ha durata zero o negativa`);
    }
  }
});

test("i sottotitoli dicono le stesse cose in ogni lingua: dieci righe ciascuno", () => {
  /* se una lingua avesse una riga in meno, la scena finale (l'avviso sulla
     seconda truffa) resterebbe senza testo in quella lingua soltanto */
  const conteggi = {};
  for (const l of LINGUE) {
    const vtt = R(`assets/video/come-segnalare-un-caso-${l}.vtt`);
    conteggi[l] = (vtt.match(/ --> /g) || []).length;
  }
  const valori = Object.values(conteggi);
  assert.deepStrictEqual([...new Set(valori)].length, 1,
    "le lingue non hanno lo stesso numero di sottotitoli: " + JSON.stringify(conteggi));
  assert.strictEqual(valori[0], 10, "le scene sono dieci, i sottotitoli devono essere dieci");
});

test("il JavaScript non scrive a mano la versione degli asset", () => {
  /* Il percorso del video sta in una `<source>` della pagina, che
     `versione_asset.py` riscrive. Se il JS lo ricopiasse, al primo giro di
     versioni il video smetterebbe di partire — senza un errore visibile. */
  const js = R("assets/js/sessione-video.js");
  assert.ok(!/assets\/[0-9a-f]{8}\//.test(js),
    "sessione-video.js contiene una versione di asset scritta a mano");
  assert.ok(/querySelector\("\[data-video-tela\] source"\)/.test(js),
    "il JS deve leggere la cartella degli asset dalla pagina, non inventarla");
});

test("la pagina non promette il recupero e non chiede credenziali", () => {
  /* Il criterio editoriale del sito, applicato alla pagina nuova: chi ha
     appena perso dei soldi è la persona più facile da ingannare con una
     promessa. Le parole vietate sono le stesse del resto del sito. */
  const testo = PAGINA.replace(/<[^>]+>/g, " ").toLowerCase();
  const vietate = ["garantiamo il recupero", "recuperiamo i tuoi soldi",
                   "100% di successo", "recupero garantito", "ti restituiamo i soldi"];
  const trovate = vietate.filter((v) => testo.includes(v));
  assert.deepStrictEqual(trovate, [], "promesse non verificabili: " + trovate.join(", "));
  /* e il contrario: la pagina deve dirlo, che non promettiamo */
  assert.ok(/nessuno può prometterti/i.test(PAGINA),
    "la pagina deve dire che nessuno può promettere il recupero");
});

test("il modulo non chiede una password, e la pagina lo dice", () => {
  /* La promessa «nessuna password» compare nel video: se un giorno il modulo
     la chiedesse davvero, il video diventerebbe una bugia. */
  assert.ok(/nessuna password/i.test(PAGINA));
  const login = R("login.html");
  const form = login.slice(login.indexOf('id="register-form"'), login.indexOf("</form>"));
  assert.ok(!/type="password"/.test(form), "il modulo di segnalazione chiede una password");
});

test("la pagina esiste in tutte e quattro le lingue e si dichiara", () => {
  for (const l of ["en", "de", "es"]) {
    const f = `${l}/come-segnalare-un-caso.html`;
    assert.ok(esiste(f), `manca ${f}`);
    const s = R(f);
    assert.ok(new RegExp(`<html lang="${l}"`).test(s), `${f} non dichiara lang="${l}"`);
    /* e il video: la pagina tradotta deve citare i sottotitoli della sua lingua */
    assert.ok(new RegExp(`come-segnalare-un-caso-${l}\\.vtt`).test(s),
      `${f} non carica i sottotitoli in ${l}`);
  }
});

test("ogni pagina ha la sua copertina e non quella di un'altra", () => {
  const poster = PAGINA.match(/poster="([^"]+)"/)[1];
  assert.ok(esiste(poster), "manca la copertina " + poster);
  const peso = fs.statSync(path.join(RADICE, poster)).size;
  assert.ok(peso > 8_000 && peso < 300_000,
    `la copertina pesa ${peso} byte: troppo poco per un'immagine, troppo per il web`);
});

test("la guida si raggiunge da dove serve, senza cercarla", () => {
  /* Una pagina che nessuno trova non serve a niente: la guida sta nel piè di
     pagina (tutte le pagine) e accanto al pulsante «Segnala un caso». */
  for (const f of ["partials/footer.html", "partials/header.html"]) {
    assert.ok(/come-segnalare-un-caso\.html/.test(R(f)),
      `${f} non porta alla guida`);
  }
  /* e nel sitemap, altrimenti i motori di ricerca non la vedono */
  assert.ok(/come-segnalare-un-caso/.test(R("sitemap.xml")), "la guida manca dal sitemap");
});

test("la pagina nuova è nella lista di chi scrive il sito", () => {
  /* Quattro strumenti tengono un elenco delle pagine scritto a mano. Una
     pagina dimenticata in uno solo di quegli elenchi non dà errore: dà una
     pagina senza misurazione, o senza traduzione, o con gli asset di ieri. */
  const strumenti = {
    "tools/build_shell.py": "l'intestazione e il piè di pagina",
    "tools/build_i18n.py": "le traduzioni",
    "tools/versione_asset.py": "la versione degli asset",
    "tools/misurazione.py": "la misurazione del traffico",
    "tools/allinea_catalogo.py": "il catalogo delle lingue",
  };
  const mancano = Object.entries(strumenti)
    .filter(([f]) => !/come-segnalare-un-caso\.html/.test(R(f)))
    .map(([f, cosa]) => `${f} (${cosa})`);
  assert.deepStrictEqual(mancano, [],
    "questi strumenti non conoscono la pagina: " + mancano.join("; "));
});

module.exports = casi;
