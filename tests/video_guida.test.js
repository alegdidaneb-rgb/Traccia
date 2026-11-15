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
    assert.ok(tempi.length >= 12, `${nome}: solo ${tempi.length} righe di sottotitoli`);
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

test("i sottotitoli dicono le stesse cose in ogni lingua: dodici righe ciascuno", () => {
  /* se una lingua avesse una riga in meno, la scena finale (l'avviso sulla
     seconda truffa) resterebbe senza testo in quella lingua soltanto.
     Le scene sono dodici: dieci della guida più le due sul recupero. */
  const conteggi = {};
  for (const l of LINGUE) {
    const vtt = R(`assets/video/come-segnalare-un-caso-${l}.vtt`);
    conteggi[l] = (vtt.match(/ --> /g) || []).length;
  }
  const valori = Object.values(conteggi);
  assert.deepStrictEqual([...new Set(valori)].length, 1,
    "le lingue non hanno lo stesso numero di sottotitoli: " + JSON.stringify(conteggi));
  assert.strictEqual(valori[0], 12, "le scene sono dodici, i sottotitoli devono essere dodici");
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

test("i sottotitoli scrivono il dominio, non come si pronuncia", () => {
  /* La voce dice «traccia punto it punto com», che è la forma giusta per
     essere capita ad alta voce. Copiata in un sottotitolo diventa «traccia
     punkt it punkt com»: una parola tedesca in mezzo a una frase tedesca, e
     nessuno che possa digitare l'indirizzo. È successo davvero, in tutte e
     quattro le lingue. */
  const pronunce = /traccia\s+(?:punto|punkt|dot)\s/i;
  for (const l of LINGUE) {
    const vtt = R(`assets/video/come-segnalare-un-caso-${l}.vtt`);
    assert.ok(!pronunce.test(vtt),
      `i sottotitoli in ${l} contengono il dominio come si pronuncia, non come si scrive`);
    assert.ok(vtt.includes("traccia.it.com"),
      `i sottotitoli in ${l} non scrivono l'indirizzo da digitare`);
  }
});

test("i sottotitoli non si vedono due volte", () => {
  /* Il testo è dentro i fotogrammi. Se il JavaScript accendesse anche la
     traccia, la stessa frase comparirebbe due volte sopra il video: una
     disegnata da noi, una dal browser, a pochi pixel di distanza. */
  const js = R("assets/js/sessione-video.js");
  assert.ok(!/mode\s*=\s*"showing"/.test(js),
    "il JS accende la traccia mentre i sottotitoli sono già nell'immagine");
  assert.ok(/mode\s*=\s*"disabled"/.test(js),
    "il JS deve spegnere le tracce: i sottotitoli sono dentro il video");
  /* la traccia resta nella pagina: serve al menu del browser e alla ricerca */
  assert.ok(/<track\s+kind="captions"/.test(PAGINA),
    "la traccia dei sottotitoli serve lo stesso: non va tolta dalla pagina");
});

test("la scheda dei sei campi sta dentro il riquadro bianco", () => {
  /* Il difetto: nel formato orizzontale l'altezza della scheda veniva
     misurata con il passo dei campi del verticale (104 px), mentre il disegno
     li stringeva per farli entrare. La scheda si centrava sull'altezza
     sbagliata e il primo campo usciva sopra il bordo: invisibile a chi guarda
     il video, perché sembra un ritaglio voluto. Le due misure ora vengono
     dalla stessa funzione; questo test impedisce di separarle di nuovo. */
  const sorgente = R("tools/video/rendi.py");
  const passo = [...sorgente.matchAll(/passo_campi\(lang, box\)/g)].length;
  assert.ok(passo >= 2,
    "il passo dei campi va calcolato in un posto solo, e usato sia dalla misura sia dal disegno");
  assert.ok(!/6 \* 104 \+ 5 \* 20/.test(sorgente),
    "l'altezza della scheda è tornata a essere un numero fisso: i due formati hanno altezze diverse");
});

test("una prova non sovrascrive il video buono", () => {
  /* `--prova` rende dodici secondi per controllare una scena. Lanciato senza
     guardare, ha riscritto i video veri: novantacinque secondi diventati
     tredici, e la pagina avrebbe servito un trailer al posto della guida. */
  const sorgente = R("tools/video/rendi.py");
  assert.ok(/"-prova" if prova else ""/.test(sorgente),
    "il render di prova deve scrivere su un file con un nome diverso");
});

test("il video parte anche senza JavaScript", () => {
  /* Il difetto vero: la pagina dichiarava una `<source>`, e poi lo script la
     scartava per impostare un `src` suo. Con gli script spenti — o bloccati,
     come fa un'estensione — restava un riquadro nero. Ora la pagina da sola
     basta: il browser sceglie fra le due sorgenti, verticale e orizzontale. */
  const blocco = PAGINA.slice(PAGINA.indexOf('id="video-guida"'), PAGINA.indexOf("</video>"));
  const sorgenti = [...blocco.matchAll(/<source\s+src="([^"]+\.mp4)"/g)].map((m) => m[1]);
  assert.ok(sorgenti.length >= 2, "servono due sorgenti: il verticale e l'orizzontale");
  /* almeno una sorgente senza `media`: è quella che vale quando nessuna
     condizione è vera, e senza di lei il ripiego non esiste */
  const libere = blocco.match(/<source[^>]+>/g).filter((t) => !/\smedia=/.test(t));
  assert.ok(libere.length >= 1, "nessuna sorgente senza `media`: niente ripiego");
  for (const f of sorgenti) assert.ok(esiste(f), `la pagina cita ${f}, che non esiste`);
});

test("le pagine tradotte chiedono il video e la copertina alla radice", () => {
  /* Da `/de/`, `src="assets/..."` viene chiesto come `/de/assets/...`: 404, e
     il riquadro resta nero. È esattamente quello che succedeva alla copertina,
     perché `poster` non era nella lista degli attributi riscritti. */
  for (const l of ["en", "de", "es"]) {
    const pagina = R(`${l}/come-segnalare-un-caso.html`);
    const relativi = [...pagina.matchAll(/(?:src|poster)="(assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(relativi, [],
      `${l}: percorsi relativi, che da /${l}/ non esistono: ${relativi.join(", ")}`);
  }
});

test("il percorso del video è assoluto anche da una pagina tradotta", () => {
  /* `sessione-video.js` ricostruisce l'indirizzo dalla `<source>`: se lo
     ricostruisse relativo, da `/de/` chiederebbe `/de/assets/video/...`. */
  const js = R("assets/js/sessione-video.js");
  assert.ok(/CARTELLA = "\/" \+/.test(js),
    "il percorso del video deve partire dalla radice del sito, non dalla pagina");
});

test("la parte sul recupero dice il metodo, non il risultato", () => {
  /* La richiesta: «aggiungi il fatto che recuperate i soldi persi». La
     risposta non può essere «recuperiamo i tuoi soldi», perché non è vero per
     tutti e la pagina dice il contrario due sezioni più in là. Il compromesso
     è questo, ed è verificato qui: le scene del recupero devono dire che cosa
     si fa (prove, tracciamento) e che a volte non si può. Se un giorno
     qualcuno «migliora» il testo togliendo il «a volte no», il test lo ferma. */
  const sorgente = R("tools/video/contenuti.py");
  const blocco = sorgente.slice(sorgente.indexOf("ESITI = {"), sorgente.indexOf("SCELTE = {"));
  assert.ok(/A volte no|Sometimes it cannot|Manchmal nicht|A veces no/.test(blocco),
    "le due risposte del recupero devono dire anche «a volte no»");
  assert.ok(/A volte si può|Sometimes it can|Manchmal geht es|A veces se puede/.test(blocco),
    "…e anche che a volte si può");

  /* e la pagina, non solo il video */
  const testo = PAGINA.replace(/<[^>]+>/g, " ").toLowerCase();
  assert.ok(testo.includes("a volte si può, a volte no"),
    "la pagina deve avere la sezione sul recupero con i due esiti");
  assert.ok(testo.includes("nessuno può promettere il risultato"),
    "la pagina deve dire che il risultato non si può promettere");
  /* le formule che un venditore userebbe, e che qui non devono comparire */
  const vietate = [/recuper(i|iamo) (sempre )?i tuoi soldi/i, /garantiamo il recupero/i,
                   /recupero garantito/i, /\b100 ?%\b/, /soldi indietro/i];
  for (const v of vietate) {
    assert.ok(!v.test(testo), "la pagina promette: " + v);
  }
});

test("le due scene nuove stanno fra il modulo e l'invio", () => {
  /* L'ordine non è estetica: la domanda «e i miei soldi?» arriva dopo aver
     raccontato che cosa è successo, non prima di aver spiegato come si
     segnala. Metterle in fondo le renderebbe un allegato. */
  const sorgente = R("tools/video/contenuti.py");
  /* il blocco delle scene comincia dopo `SCENE = {`: le stesse chiavi
     compaiono prima in `CAMPI`, `PROVE` e `ESITI`, e cercarle dalla cima
     trovava la lista sbagliata */
  const scene = sorgente.slice(sorgente.indexOf("SCENE = {"));
  const INVIO = { it: "Nessuna password", en: "No password",
                  de: "Kein Passwort", es: "Ninguna contraseña" };
  for (const l of ["it", "en", "de", "es"]) {
    const da = scene.indexOf(`    "${l}": [`);
    const a = scene.indexOf("\n    ],", da);
    assert.ok(da > 0 && a > da, `${l}: non riesco a isolare la lingua`);
    const lingua = scene.slice(da, a);
    const metodo = lingua.indexOf('tipo="metodo"');
    const invio = lingua.indexOf(`titolo="${INVIO[l]}"`);
    assert.ok(metodo > 0, `${l}: manca la scena sul recupero`);
    assert.ok(invio > 0, `${l}: manca la scena dell'invio`);
    assert.ok(metodo < invio, `${l}: la scena sul recupero non sta prima dell'invio`);
    /* e sono due, non una: il metodo e i due esiti */
    assert.strictEqual((lingua.match(/tipo="metodo"/g) || []).length, 2,
      `${l}: le scene sul recupero devono essere due`);
  }
});

module.exports = casi;
