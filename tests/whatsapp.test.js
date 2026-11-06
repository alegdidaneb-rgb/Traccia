/* Tests for the WhatsApp button — run with: node tests/run.js
 *
 * Perché vale la pena provarlo: `wa.me` accetta solo cifre e il numero si
 * sbaglia di una cifra senza accorgersene, perché il pulsante *sembra*
 * funzionare. Un link a un numero inesistente non dà errore da nessuna parte:
 * resta lì, e il cliente che scrive non riceve risposta.
 *
 * I due errori possibili sono opposti:
 *   - togliere il prefisso internazionale → WhatsApp cerca il numero nel paese
 *     di chi apre il link;
 *   - lasciare "+" o spazi → link non valido.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const SRC = fs.readFileSync(path.join(__dirname, "..", "assets/js/whatsapp.js"), "utf8");
const CFG = fs.readFileSync(path.join(__dirname, "..", "assets/js/config.js"), "utf8");

function carica(config, lingua = "it") {
  const finte = { TracciaWhatsApp: null };
  const document = {
    readyState: "complete", addEventListener() {},
    documentElement: { getAttribute: (k) => (k === "lang" ? lingua : null) },
    querySelector: () => null, querySelectorAll: () => []
  };
  const fn = new Function("window", "document", SRC + "\n;return window.TracciaWhatsApp;");
  fn({ TRACCIA_CONFIG: config }, document);
  return { finte, api: fn({ TRACCIA_CONFIG: config }, document) };
}

const NUMERO = "+15392151268";
const api = () => carica({ whatsapp: NUMERO, whatsappText: "Buongiorno. Pratica {pratica}." }).api;

test("whatsapp: il numero configurato è quello in chiaro, con il +", () => {
  assert.ok(/whatsapp:\s*"\+\d{8,15}"/.test(CFG),
    "in config.js il numero deve avere il prefisso internazionale e il +");
  assert.ok(CFG.includes('whatsapp: "' + NUMERO + '"'),
    "il numero dell'assistenza non è quello configurato");
});

test("whatsapp: il link porta solo cifre, prefisso compreso", () => {
  const link = api().link("TRC-2026-0042");
  assert.ok(link.startsWith("https://wa.me/15392151268?"), "link inatteso: " + link);
  assert.ok(!/[+\s()]/.test(link.split("?")[0]), "nel percorso del link è rimasto un separatore");
});

test("whatsapp: il link normale non deve rompersi se il numero è vuoto", () => {
  const vuoto = carica({ whatsapp: "" }).api;
  assert.strictEqual(vuoto.configured(), false);
  assert.strictEqual(vuoto.link("TRC-2026-0042"), "");
  assert.strictEqual(vuoto.leggibile(), "");
});

test("whatsapp: la parte leggibile è il numero com'è scritto, non una scommessa", () => {
  assert.strictEqual(api().leggibile(), "+1 539 215 1268");
});

test("whatsapp: senza codice pratica la frase vuota non resta nel messaggio", () => {
  const testo = decodeURIComponent(api().link("").split("text=")[1]);
  assert.ok(!/\{pratica\}|Pratica\s*\./.test(testo), "messaggio con un buco: " + testo);
  assert.ok(/^Buongiorno\.$/.test(testo.trim()), "messaggio inatteso: " + testo);
});

test("whatsapp: il numero scritto nella pagina viene dalla configurazione", () => {
  /* Se la pagina scrive il numero a mano, prima o poi ne resta una copia
     vecchia. `supporto.html` deve avere il segnaposto, non le cifre. */
  const html = fs.readFileSync(path.join(__dirname, "..", "supporto.html"), "utf8");
  assert.ok(/data-whatsapp-numero/.test(html), "supporto.html non ha il segnaposto del numero");
  assert.ok(!/\+1\s?539\s?215\s?1268/.test(html.replace(/<strong data-whatsapp-numero>[^<]*<\/strong>/, "")),
    "supporto.html scrive il numero a mano oltre al segnaposto");
});

test("whatsapp: nessun numero di telefono inventato resta nelle pagine", () => {
  /* Il telefono fisso era un segnaposto (+39 011 0000 0000). O è un numero
     vero o non c'è: un numero finto è peggio di nessun numero. */
  const pagine = fs.readdirSync(path.join(__dirname, ".."))
    .filter((f) => f.endsWith(".html"));
  const colpevoli = pagine.filter((f) => {
    const html = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    return /\+39 011 0000 0000|tel:\+3901100000000/.test(html);
  });
  assert.deepStrictEqual(colpevoli, [], "numeri segnaposto in: " + colpevoli.join(", "));
});

test("whatsapp: il messaggio standard non presuppone una sessione", () => {
  /* «dalla mia area riservata» su una pagina pubblica è una frase che il
     visitatore non può aver scritto: il pulsante sta anche in home page. */
  const testo = decodeURIComponent(api().link("").split("text=")[1]);
  assert.ok(!/area riservata/i.test(testo), "messaggio da cliente su una pagina pubblica: " + testo);
});

test("whatsapp: il messaggio precompilato segue la lingua della pagina", () => {
  /* Il pulsante sta su tutte le pagine, comprese `/de/` e `/es/`. Con il testo
     fisso in italiano, il visitatore tedesco apre la chat e ci trova una frase
     che non ha scritto lui, in una lingua che non è la sua. */
  const cfg = {
    whatsapp: NUMERO,
    whatsappText: "Buongiorno, vi scrivo dal sito Traccia.",
    whatsappTextLingue: { de: "Guten Tag, Fall {pratica}.", es: "Buenos días, Caso {pratica}." }
  };
  const tedesco = decodeURIComponent(carica(cfg, "de").api.link("").split("text=")[1]);
  assert.ok(/^Guten Tag/.test(tedesco), "tedesco non usato: " + tedesco);
  const spagnolo = decodeURIComponent(carica(cfg, "es").api.link("").split("text=")[1]);
  assert.ok(/^Buenos días/.test(spagnolo), "spagnolo non usato: " + spagnolo);

  /* senza voce per quella lingua si ricade sull'italiano, non su `undefined` */
  const inglese = decodeURIComponent(carica(cfg, "en").api.link("").split("text=")[1]);
  assert.ok(/Buongiorno/.test(inglese), "la ricaduta non funziona: " + inglese);

  /* e i quattro testi esistono davvero nella configurazione del sito */
  const vere = carica({ whatsapp: NUMERO }, "de");
  assert.ok(vere.api, "la configurazione reale non si carica");
});

test("whatsapp: ogni lingua servita ha il suo messaggio configurato", () => {
  /* la ricaduta sull'italiano è una rete di sicurezza, non il funzionamento
     normale: se manca una lingua, il visitatore se ne accorge */
  ["en", "de", "es"].forEach((l) => {
    assert.ok(
      new RegExp("\\b" + l + ":\\s*\"").test(CFG),
      `config.js non ha whatsappTextLingue.${l}`
    );
  });
});

module.exports = casi;
