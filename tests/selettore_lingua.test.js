/* ==========================================================================
   Il selettore di lingua, eseguito davvero
   ==========================================================================
   Il resto della suite legge file di testo. Qui invece il codice di
   `assets/js/main.js` viene *eseguito* dentro un DOM finto, perché le cose che
   possono andare storte nel selettore non si vedono leggendolo:

   1. chi arriva dalla Germania e finisce dritto in tedesco, e chi invece ha
      già scelto l'italiano e viene riportato al tedesco a ogni ritorno;
   2. chi legge `/de/` e preme la voce tedesca, ricaricando la stessa pagina:
      un link che non porta da nessuna parte sembra rotto;
   3. la sigla e `aria-current` che restano indietro rispetto alla pagina.

   Perché un DOM finto e non un browser: qui non c'è nessun browser da
   scaricare, e questi comportamenti dipendono solo da tre cose — `location`,
   `localStorage` e gli attributi — che si possono simulare in venti righe.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const caso = [];
function test(nome, fn) {
  caso.push({ nome, fn });
}

const SORGENTE = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "main.js"),
  "utf8"
);

/* Il blocco «Lingua» è l'ultimo IIFE del file: si prende da lì in fondo. */
const INIZIO = SORGENTE.indexOf("   Lingua\n");
assert.ok(INIZIO > 0, "il blocco «Lingua» non è più in main.js");
const BLOCCO = SORGENTE.slice(SORGENTE.lastIndexOf("(function () {", INIZIO));

function nodo(attributi) {
  return {
    attributi: Object.assign({}, attributi),
    textContent: "",
    open: false,
    eventi: {},
    getAttribute(k) {
      return this.attributi[k] === undefined ? null : this.attributi[k];
    },
    setAttribute(k, v) {
      this.attributi[k] = String(v);
    },
    removeAttribute(k) {
      delete this.attributi[k];
    },
    addEventListener(nome, fn) {
      (this.eventi[nome] = this.eventi[nome] || []).push(fn);
    },
    contains(altro) {
      return altro === this || (altro && altro.dentro === this);
    },
    clicca() {
      (this.eventi.click || []).forEach((fn) => fn({}));
    },
  };
}

/* Un ambiente con: pagina corrente, lingua del browser, memoria locale. */
function ambiente({ percorso = "/", lingua = "it", browser = ["it-IT"], memoria = null }) {
  const voci = ["it", "en", "de", "es"].map((l) =>
    nodo({ "data-lang": l, href: l === "it" ? "/" : `/${l}/` })
  );
  const menu = nodo({});
  const memorizzati = memoria ? Object.assign({}, memoria) : {};

  const ascoltatori = {};
  const document = {
    documentElement: { getAttribute: (k) => (k === "lang" ? lingua : null) },
    querySelectorAll(selettore) {
      if (selettore === "[data-lang]") return voci;
      return [];
    },
    addEventListener(nome, fn) {
      (ascoltatori[nome] = ascoltatori[nome] || []).push(fn);
    },
    invia(nome, evento) {
      (ascoltatori[nome] || []).forEach((fn) => fn(evento));
    },
  };

  const sostituzioni = [];
  const location = {
    pathname: percorso,
    hash: "",
    replace(u) {
      sostituzioni.push(u);
    },
  };

  const window = {
    localStorage: {
      getItem: (k) => (k in memorizzati ? memorizzati[k] : null),
      setItem: (k, v) => {
        memorizzati[k] = String(v);
      },
    },
  };

  const navigator = { languages: browser, language: browser[0] };

  const esegui = new Function("document", "window", "location", "navigator", BLOCCO);
  esegui(document, window, location, navigator);

  return { voci, document, memorizzati, sostituzioni };
}

/* ------------------------------------------------------------------ sigla -- */
test("la lingua in cui si è è accesa, e non è un link", () => {
  const a = ambiente({ percorso: "/de/", lingua: "de", browser: ["de-DE"] });
  const tedesco = a.voci.find((v) => v.getAttribute("data-lang") === "de");
  const italiano = a.voci.find((v) => v.getAttribute("data-lang") === "it");

  assert.equal(tedesco.getAttribute("aria-current"), "true");
  /* niente href: un link che porta alla pagina in cui siamo già si preme e
     non fa niente, e sembra un guasto */
  assert.equal(tedesco.getAttribute("href"), null, "la voce corrente non deve essere un link");

  /* le altre restano link veri, con il loro indirizzo intatto */
  assert.equal(italiano.getAttribute("href"), "/");
  assert.equal(italiano.getAttribute("aria-current"), null);

  assert.equal(a.voci.filter((v) => v.attributi["aria-current"]).length, 1);
});

/* ------------------------------------------------------ lingua del browser -- */
test("chi arriva dalla Germania finisce in tedesco", () => {
  const a = ambiente({ percorso: "/", lingua: "it", browser: ["de-DE", "de"] });
  assert.deepEqual(a.sostituzioni, ["/de/"]);
  assert.equal(a.memorizzati["traccia.lingua"], "de");
});

test("chi ha già scelto l'italiano non viene riportato al tedesco", () => {
  const a = ambiente({
    percorso: "/",
    lingua: "it",
    browser: ["de-DE"],
    memoria: { "traccia.lingua": "it" },
  });
  assert.deepEqual(a.sostituzioni, [], "la scelta dell'utente deve contare più del browser");
});

test("un italiano che legge la pagina tedesca ci resta", () => {
  /* il rilevamento automatico vale solo sulla home italiana: altrove
     riporterebbe indietro chi ha appena scelto un'altra lingua */
  const a = ambiente({ percorso: "/de/", lingua: "de", browser: ["it-IT"] });
  assert.deepEqual(a.sostituzioni, []);
});

test("chi apre un link inglese resta in inglese, anche se il browser è tedesco", () => {
  /* è il caso che rompeva: un link `/en/` incollato in una chat deve aprire
     l'inglese. Il rilevamento del browser vale solo sulla home italiana. */
  const a = ambiente({ percorso: "/en/", lingua: "en", browser: ["de-DE"] });
  assert.deepEqual(a.sostituzioni, [], "un link in inglese non deve rimbalzare in tedesco");
});

test("una lingua che il sito non ha non porta da nessuna parte", () => {
  const a = ambiente({ percorso: "/", lingua: "it", browser: ["ja-JP", "fr-FR"] });
  assert.deepEqual(a.sostituzioni, []);
  assert.equal(a.memorizzati["traccia.lingua"], "it");
});

test("la prima lingua disponibile vince, non l'ultima", () => {
  const a = ambiente({ percorso: "/", lingua: "it", browser: ["fr-FR", "es-ES", "de-DE"] });
  assert.deepEqual(a.sostituzioni, ["/es/"]);
});

/* --------------------------------------------------------------- memoria -- */
test("scegliere una lingua la ricorda", () => {
  const a = ambiente({ percorso: "/", lingua: "it" });
  a.voci[2].clicca(); /* Deutsch */
  assert.equal(a.memorizzati["traccia.lingua"], "de");
});

module.exports = caso;
