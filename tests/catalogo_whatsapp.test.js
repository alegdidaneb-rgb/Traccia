/* ==========================================================================
   Il catalogo WhatsApp Business
   ==========================================================================
   Il catalogo è la vetrina che il cliente vede prima di scriverci: prezzi,
   tempi e limiti. Un errore qui non lo corregge nessuno, perché nessuno lo
   rilegge — si importa una volta e resta.

   Cosa difendono questi test:

   1. un prezzo che non è più quello del sito: il catalogo dice 190 €, la
      pagina Onorari dice altro, e il cliente che ha letto il catalogo si sente
      preso in giro alla firma del contratto;
   2. un articolo in italiano dentro il catalogo tedesco: la pagina è tradotta,
      la vetrina no;
   3. una promessa di risultato: «recuperiamo», «garantito», «ti restituiamo».
      È il linguaggio dei truffatori, ed è esattamente quello che un cliente
      già scottato sta cercando di riconoscere;
   4. un CSV che non si importa: colonne mancanti, prezzi senza valuta, foto
      inesistenti.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const CAT = path.join(RADICE, "catalogo-whatsapp");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const esiste = (f) => fs.existsSync(path.join(RADICE, f));
const LINGUE = ["it", "en", "de", "es"];
const COLONNE = ["id", "title", "description", "availability", "condition",
                 "price", "link", "image_link", "brand"];

/* Un lettore CSV minimo ma onesto: le virgolette e le virgole dentro le
   descrizioni sono la norma, non l'eccezione, e uno split(",") le spezzerebbe
   producendo un errore che sembra un errore di contenuto. */
function righeCsv(testo) {
  const righe = [];
  let campo = "", riga = [], virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virgolette) {
      if (c === '"' && testo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') virgolette = false;
      else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === ",") { riga.push(campo); campo = ""; }
    else if (c === "\n") { riga.push(campo); righe.push(riga); riga = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || riga.length) { riga.push(campo); righe.push(riga); }
  return righe.filter((r) => r.length > 1 || (r[0] || "").trim());
}

function articoli(lingua) {
  const righe = righeCsv(R(`catalogo-whatsapp/${lingua}.csv`));
  const intestazione = righe.shift();
  return righe.map((r) => Object.fromEntries(intestazione.map((c, i) => [c, r[i] || ""])));
}

/* --------------------------------------------------------------- i file -- */
test("esiste un catalogo per ogni lingua, con le colonne di Meta", () => {
  LINGUE.forEach((l) => {
    assert.ok(esiste(`catalogo-whatsapp/${l}.csv`), `manca il catalogo ${l}`);
    const intestazione = righeCsv(R(`catalogo-whatsapp/${l}.csv`))[0];
    assert.deepEqual(intestazione, COLONNE,
      `${l}: le colonne non sono quelle che Meta si aspetta`);
  });
});

test("ogni lingua ha gli stessi articoli, con lo stesso identificativo", () => {
  /* un id che cambia da una lingua all'altra crea sette prodotti doppi nel
     catalogo, e su WhatsApp il cliente vede due volte la stessa cosa */
  const base = articoli("it").map((a) => a.id);
  assert.ok(base.length >= 6, "il catalogo è troppo corto per essere tutto il servizio");
  LINGUE.forEach((l) => {
    const ids = articoli(l).map((a) => a.id);
    assert.deepEqual(ids, base, `${l}: articoli diversi da quelli italiani`);
  });
});

test("ogni articolo ha quello che serve per essere pubblicato", () => {
  LINGUE.forEach((l) => {
    articoli(l).forEach((a) => {
      assert.ok(a.title && a.title.length <= 200, `${l}/${a.id}: titolo mancante o troppo lungo`);
      assert.ok(a.description.length > 60, `${l}/${a.id}: descrizione troppo corta`);
      assert.ok(/^\d+\.\d{2} EUR$/.test(a.price),
        `${l}/${a.id}: prezzo «${a.price}» senza valuta o senza decimali`);
      assert.ok(/^https:\/\//.test(a.link), `${l}/${a.id}: link non assoluto`);
      assert.ok(/^https:\/\/.+\/catalogo-whatsapp\/ritagli\/[a-z]{2}-[a-z0-9-]+\.jpg$/.test(a.image_link),
        `${l}/${a.id}: image_link non punta a un ritaglio`);
      assert.strictEqual(a.brand, "Traccia");
      assert.ok(["in stock", "out of stock", "available for order"].includes(a.availability),
        `${l}/${a.id}: disponibilità «${a.availability}» non valida`);
      assert.strictEqual(a.condition, "new");
    });
  });
});

test("le foto del catalogo esistono, e sono quadrate", () => {
  /* WhatsApp rifiuta le immagini sotto i 500×500. Una foto che non c'è, o
     storta, fa fallire l'importazione di tutta la riga — e il catalogo resta
     a metà senza dire quale articolo è il problema. */
  const dimensioni = (file) => {
    const buffer = fs.readFileSync(file);
    for (let i = 2; i < buffer.length - 9; i++) {
      if (buffer[i] !== 0xff) continue;
      const marcatore = buffer[i + 1];
      if (marcatore >= 0xc0 && marcatore <= 0xc2) {
        return { altezza: buffer.readUInt16BE(i + 5), larghezza: buffer.readUInt16BE(i + 7) };
      }
    }
    return null;
  };
  LINGUE.forEach((l) => {
    articoli(l).forEach((a) => {
      const file = path.join(CAT, "..", a.image_link.replace("https://traccia.it.com/", ""));
      assert.ok(fs.existsSync(file), `${l}/${a.id}: manca il file ${a.image_link}`);
      const m = dimensioni(file);
      assert.ok(m, `${l}/${a.id}: il file non è un JPEG leggibile`);
      assert.strictEqual(m.larghezza, m.altezza, `${l}/${a.id}: la foto non è quadrata (${m.larghezza}×${m.altezza})`);
      assert.ok(m.larghezza >= 500, `${l}/${a.id}: la foto è ${m.larghezza}px, sotto il minimo di 500`);
    });
  });
});

/* -------------------------------------------------------------- i testi -- */
test("i testi delle altre lingue non sono l'italiano copiato", () => {
  const italiane = articoli("it");
  ["en", "de", "es"].forEach((l) => {
    const altre = articoli(l);
    altre.forEach((a, i) => {
      assert.notStrictEqual(a.title, italiane[i].title,
        `${l}/${a.id}: il titolo è rimasto italiano`);
      assert.notStrictEqual(a.description, italiane[i].description,
        `${l}/${a.id}: la descrizione è rimasta italiana`);
      assert.ok(!/\b(della|delle|degli|nostro|vostro|siamo|anche|senza|truffa)\b/.test(a.description),
        `${l}/${a.id}: la descrizione contiene parole italiane`);
    });
  });
});

test("nessun articolo promette un risultato", () => {
  /* Il catalogo WhatsApp è pubblico e lo legge chi è appena stato truffato:
     il pubblico più esposto che esista. «Garantito», «recuperiamo», «ti
     restituiamo» sono le parole con cui i truffatori si presentano. */
  const VIETATE = [
    /\bgarantit[oi]\b/i, /\bgarantiamo\b/i, /\bguarantee[ds]?\b/i, /\bgarantiert/i,
    /\bgarantizad[oa]s?\b/i,
    /\brecuperiamo\b/i, /\bwe recover\b/i, /\bwir holen\b/i, /\brecuperamos\b/i,
    /\bti restituiamo\b/i, /\bwe will return\b/i, /\bwir erstatten\b/i,
    /\bte devolvemos\b/i,
    /\b100 ?%/,
    /\bsoldi indietro\b/i, /\bmoney back\b/i, /\bgeld zurück\b/i, /\bdevolución del dinero\b/i
  ];
  LINGUE.forEach((l) => {
    articoli(l).forEach((a) => {
      const testo = `${a.title} ${a.description}`;
      VIETATE.forEach((re) => {
        assert.ok(!re.test(testo),
          `${l}/${a.id}: promette un risultato («${(testo.match(re) || [])[0]}»)`);
      });
    });
  });
});

test("il prezzo della perizia è quello del sito", () => {
  /* La cifra sta in due posti: `onorari.html` (che il cliente legge) e il
     catalogo (che importa). Se cambia in uno solo, il catalogo mente. */
  const onorari = R("onorari.html");
  const prezzoSito = (onorari.match(/metric__value[^>]*>\s*€\s*([\d.]+)/) || [])[1];
  assert.ok(prezzoSito, "non trovo il prezzo sulla pagina Onorari");
  const perizia = articoli("it").find((a) => a.id === "perizia-tecnica");
  assert.ok(perizia, "manca l'articolo della perizia");
  const prezzoCatalogo = perizia.price.replace(" EUR", "");
  assert.strictEqual(Number(prezzoCatalogo), Number(prezzoSito.replace(".", "")),
    `catalogo ${prezzoCatalogo} € contro sito ${prezzoSito} €`);
});

test("dove la cifra dipende dal caso, il prezzo è zero e la regola sta scritta", () => {
  /* Un «0 €» senza spiegazione è una promessa di gratuità che non possiamo
     mantenere: la percentuale si paga, ma sull'importo recuperato. */
  const per = articoli("it").find((a) => a.id === "percentuale-recuperato");
  assert.ok(per, "manca l'articolo della percentuale");
  assert.match(per.price, /^0\.00 EUR$/,
    "la percentuale non ha un prezzo fisso: nel catalogo deve essere 0");
  assert.match(per.description, /12/,
    "la descrizione della percentuale non dice quanto è");
  assert.match(per.description, /effettivamente rientrate/i,
    "la descrizione non dice su cosa si applica");
});

test("il link porta alla pagina nella lingua del catalogo", () => {
  /* Il difetto: il catalogo tedesco linkava `/come-funziona.html`, cioè la
     pagina italiana. Chi legge in tedesco e preme «Perizia» si trovava il sito
     in italiano — l'unico posto in cui la lingua scelta si perdeva. */
  LINGUE.forEach((l) => {
    articoli(l).forEach((a) => {
      assert.ok(/^https:\/\/traccia\.it\.com\/(it\/|en\/|de\/|es\/|come|onorari|supporto|index|casi|crypto|chi|team|privacy|termini|cookie|note|404)/.test(a.link),
        `${l}/${a.id}: link inatteso «${a.link}»`);
      if (l === "it") {
        assert.ok(!/\/(en|de|es)\//.test(a.link), `it/${a.id}: il catalogo italiano linka un'altra lingua`);
      } else {
        assert.ok(a.link.includes(`/${l}/`),
          `${l}/${a.id}: il link «${a.link}» non porta alla pagina in ${l}`);
      }
    });
  });
});

test("le schede dicono come si paga, non «gratuita» su tutto", () => {
  /* «Prezzo nel catalogo: Gratuita» sulla riga della percentuale è falso, e nel
     modo più costoso: la percentuale si paga, e il cliente lo scopre alla
     firma. Ogni scheda dice il costo vero. */
  const attesi = {
    it: { "percentuale-recuperato": "12 % sul recuperato", "perizia-tecnica": "190 € IVA inclusa",
          "valutazione-iniziale": "Gratuita", "ricostruzione-flusso": "Compresa nel contributo" },
    en: { "percentuale-recuperato": "12 % of what is recovered", "perizia-tecnica": "190 € incl. VAT" },
    de: { "percentuale-recuperato": "12 % des Zurückgeflossenen", "perizia-tecnica": "190 € inkl. USt." },
    es: { "percentuale-recuperato": "12 % de lo recuperado", "perizia-tecnica": "190 € IVA incluido" }
  };
  LINGUE.forEach((l) => {
    const schede = R(`catalogo-whatsapp/schede-${l}.md`);
    assert.ok(!/Prezzo nel catalogo: Gratuita/.test(schede),
      `${l}: le schede dicono ancora «Prezzo nel catalogo: Gratuita»`);
    Object.keys(attesi[l]).forEach((id) => {
      assert.ok(schede.includes(`**Come si paga:** ${attesi[l][id]}`),
        `${l}/${id}: manca il costo «${attesi[l][id]}»`);
    });
  });
});

test("le schede hanno il titolo staccato dal testo, e il separatore fra gli articoli", () => {
  /* Il separatore stava fra il titolo del file e il primo articolo: una riga
     orizzontale subito sotto il titolo, e la nota introduttiva staccata. */
  LINGUE.forEach((l) => {
    const schede = R(`catalogo-whatsapp/schede-${l}.md`);
    assert.ok(!/^# .+\n\n---/m.test(schede), `${l}: separatore subito sotto il titolo`);
    assert.match(schede, /\n\n### /, `${l}: il primo articolo non è staccato dalla nota`);
  });
});

test("le schede da copiare a mano dicono le stesse cose dei CSV", () => {
  LINGUE.forEach((l) => {
    const schede = R(`catalogo-whatsapp/schede-${l}.md`);
    articoli(l).forEach((a) => {
      assert.ok(schede.includes(a.title),
        `${l}: la scheda di «${a.title}» manca o ha un titolo diverso`);
    });
  });
});

test("il catalogo è rigenerato, non vecchio", () => {
  /* Se qualcuno cambia il generatore e non lo esegue, i CSV restano alla
     versione precedente e nessuno se ne accorge: il file c'è, è solo sbagliato. */
  const esito = spawnSync("python3", ["tools/catalogo_whatsapp.py", "--check"], {
    cwd: RADICE,
    encoding: "utf8"
  });
  assert.strictEqual(esito.status, 0,
    "catalogo WhatsApp non rigenerato: " + (esito.stdout || "").trim());
});

test("il README dice dove si importa e cosa non promettere", () => {
  const readme = R("catalogo-whatsapp/README.md");
  ["WhatsApp Business Manager", "Importa", "190", "image_link", "nessun operatore"]
    .forEach((parola) => {
      assert.ok(readme.includes(parola), `il README non parla di «${parola}»`);
    });
});

module.exports = casi;
