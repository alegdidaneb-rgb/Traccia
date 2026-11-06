/* ==========================================================================
   Le lingue del sito
   ==========================================================================
   Quattro lingue (italiano, inglese, tedesco, spagnolo) su un sito statico che
   non usa `fetch` per scelta. Le pagine tradotte si generano da
   `tools/build_i18n.py` leggendo i cataloghi in `tools/i18n/`.

   Cosa difendono questi test — cioè cosa si rompe in silenzio se non ci sono:

   1. una chiave italiana senza traduzione: la pagina resta per metà in
      italiano e nessuno se ne accorge finché un cliente tedesco non la apre;
   2. una traduzione che rompe l'HTML: la sostituzione avviene sui nodi di
      testo, e un errore lì produce un sito che sembra a posto ma non lo è;
   3. il selettore che compare solo su alcune pagine: si sceglie la lingua in
      home e non si trova più da nessun'altra parte.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const esiste = (f) => fs.existsSync(path.join(__dirname, "..", f));
const CAT = (l) => JSON.parse(R(`tools/i18n/${l}.json`));

const LINGUE = ["it", "en", "de", "es"];
const TRADOTTE = ["en", "de", "es"];

/* ------------------------------------------------------------ i cataloghi -- */
test("ogni lingua ha un catalogo, e l'italiano è la fonte", () => {
  LINGUE.forEach((l) => {
    assert.ok(esiste(`tools/i18n/${l}.json`), `manca il catalogo ${l}.json`);
  });
  const it = CAT("it");
  assert.ok(Object.keys(it).length > 150, "il catalogo italiano è troppo corto per essere la home");
});

test("nessuna lingua ha chiavi mancanti rispetto all'italiano", () => {
  /* il difetto che questo test intercetta: si aggiunge una frase alla home
     italiana e le altre tre restano indietro. Il visitatore tedesco legge una
     frase in italiano in mezzo alla pagina e conclude che il sito è rotto. */
  const it = CAT("it");
  TRADOTTE.forEach((l) => {
    const cat = CAT(l);
    const mancanti = Object.keys(it).filter((k) => k !== "_meta" && !(k in cat));
    assert.strictEqual(mancanti.length, 0,
      `${l}: ${mancanti.length} chiavi mancanti, la prima è «${(mancanti[0] || "").slice(0, 60)}»`);
  });
});

test("nessuna lingua ha chiavi che l'italiano non ha", () => {
  /* una chiave orfana non viene mai sostituita: è lavoro fatto e buttato, e
     spesso è una frase che era nella pagina e non c'è più */
  const it = CAT("it");
  TRADOTTE.forEach((l) => {
    const cat = CAT(l);
    const orfane = Object.keys(cat).filter((k) => !(k in it));
    assert.strictEqual(orfane.length, 0,
      `${l}: ${orfane.length} chiavi che l'italiano non ha, la prima è «${(orfane[0] || "").slice(0, 60)}»`);
  });
});

test("la traduzione non è vuota e non è l'italiano lasciato lì", () => {
  /* Il caso vero: la chiave c'è, il valore è la stringa italiana copiata. Il
     test non può giudicare la qualità, ma può vedere che qualcosa è cambiato —
     tranne per i nomi propri e le sigle, che restano identici in ogni lingua. */
  /* Valori che restano identici in ogni lingua, e devono restare: nomi propri,
     sigle, percentuali, l'indirizzo email, i nomi delle lingue nel selettore e
     i termini che nel mestiere si usano in inglese anche in italiano. Il test
     non può giudicare la qualità di una traduzione; può però vedere se una
     frase italiana è stata copiata nella colonna sbagliata. */
  const IDENTICI = new Set([
    "31%", "12%", "33 %", "27 %", "0 €", "online.", "KYC", "USDT", "exchange", "wallet", "mixer",
    "conto", "Blockchain intelligence", "On-chain", "Chargeback",
    "Marta Bellini", "Andrea Costa", "Sara Ferrero", "Giulia Rinaldi",
    "ERSEL SPA", "Privacy", "Cookie policy", "cookie policy",
    "assistenza@traccia.it.com",
    "Italiano", "English", "Deutsch", "Español", "Traccia",
    "Torino · Piazza Solferino", "Turin · Piazza Solferino",
    /* spagnolo: «exchange» si usa così, «Caso T-2418» è il nome di un caso,
       «Exchange con KYC» è un'etichetta del diagramma. Restano identici
       perché in spagnolo sono già giusti, non perché nessuno li ha tradotti. */
    "Caso T-2418", "Exchange intermediario", "Exchange con KYC"
  ]);
  const it = CAT("it");
  TRADOTTE.forEach((l) => {
    const cat = CAT(l);
    const identiche = Object.keys(it).filter((k) =>
      k !== "_meta" && !IDENTICI.has(k) && cat[k] === it[k]);
    assert.strictEqual(identiche.length, 0,
      `${l}: ${identiche.length} valori identici all'italiano, il primo è «${(identiche[0] || "").slice(0, 60)}»`);
  });
});

/* --------------------------------------------------------------- le pagine -- */
test("esistono le tre pagine tradotte", () => {
  TRADOTTE.forEach((l) => {
    assert.ok(esiste(`${l}/index.html`), `manca ${l}/index.html`);
  });
});

test("una pagina tradotta dichiara la sua lingua, non quella italiana", () => {
  TRADOTTE.forEach((l) => {
    const s = R(`${l}/index.html`);
    assert.ok(new RegExp(`<html lang="${l}"`).test(s),
      `${l}/index.html non dichiara lang="${l}"`);
    assert.ok(!/<html lang="it"/.test(s), `${l}/index.html dichiara ancora l'italiano`);
  });
});

test("ogni pagina tradotta è indicizzabile da sola", () => {
  /* canonical e hreflang: senza, Google tratta le quattro versioni come
     duplicati e ne tiene una — di solito quella italiana. */
  TRADOTTE.forEach((l) => {
    const s = R(`${l}/index.html`);
    assert.ok(new RegExp(`<link rel="canonical" href="https://traccia\\.it\\.com/${l}/"`).test(s),
      `${l}: canonical mancante o sbagliato`);
    LINGUE.forEach((altra) => {
      assert.ok(new RegExp(`hreflang="${altra}"`).test(s),
        `${l}: manca hreflang="${altra}"`);
    });
    assert.ok(/hreflang="x-default"/.test(s), `${l}: manca x-default`);
  });
});

test("l'italiano dichiara a sua volta le altre lingue", () => {
  const s = R("index.html");
  LINGUE.forEach((l) => {
    assert.ok(new RegExp(`hreflang="${l}"`).test(s),
      `index.html: manca hreflang="${l}": le lingue devono dichiararsi a vicenda`);
  });
});

test("il testo della pagina è tradotto, non solo l'attributo lang", () => {
  /* Difetto possibile e insidioso: la pagina si chiama `de/`, dichiara
     `lang="de"` ma il corpo è rimasto italiano. Google la indicizza come
     tedesca e chi la apre non capisce niente. */
  const segni = {
    en: /Where the money|Free first assessment/,
    de: /Wohin das Geld|Kostenlose Ersteinschätzung/,
    es: /Adónde va|Primera valoración gratuita/
  };
  TRADOTTE.forEach((l) => {
    assert.ok(segni[l].test(R(`${l}/index.html`)),
      `${l}/index.html: il corpo sembra ancora italiano`);
  });
});

test("la sostituzione non ha toccato l'HTML: i tag sono bilanciati", () => {
  /* La sostituzione avviene sui nodi di testo. Se qualcuno la allargasse al
     file intero per fare prima, una parola tradotta finirebbe dentro una
     classe o un attributo e i tag si sbilancerebbero. */
  ["index.html"].concat(TRADOTTE.map((l) => `${l}/index.html`)).forEach((f) => {
    const s = R(f);
    ["div", "section", "p", "a"].forEach((tag) => {
      const aperti = (s.match(new RegExp(`<${tag}\\b`, "g")) || []).length;
      const chiusi = (s.match(new RegExp(`</${tag}>`, "g")) || []).length;
      if (tag === "a") {
        /* `<a>` può stare anche nei commenti e nelle stringhe JS: si confronta
           solo la parte prima degli script */
        const senzaScript = s.slice(0, s.indexOf("<script"));
        assert.ok((senzaScript.match(/<a\b/g) || []).length <= chiusi + 5,
          `${f}: troppi <a> aperti`);
        return;
      }
      assert.strictEqual(aperti, chiusi, `${f}: <${tag}> aperti ${aperti}, chiusi ${chiusi}`);
    });
  });
});

test("le parole italiane più comuni non compaiono nel corpo tradotto", () => {
  /* un controllo a campione su parole che non hanno motivo di restare: se
     compaiono nel corpo, una frase è rimasta indietro */
  const spia = /\b(della|dello|degli|perché|quindi|nostro|vostro|siamo|potrebbe)\b/i;
  TRADOTTE.forEach((l) => {
    const s = R(`${l}/index.html`);
    const corpo = s.slice(s.indexOf('<main id="main">'), s.indexOf("</main>"));
    const senzaScript = corpo.replace(/<script[\s\S]*?<\/script>/g, "");
    /* Solo il testo fra `>` e `<`: «chi-siamo» dentro un `href` non è una frase
       italiana rimasta indietro, ed è il falso positivo che questo test aveva */
    const visibile = (senzaScript.match(/>[^<>]+</g) || [])
      .map((n) => n.slice(1, -1)).join(" ");
    const trovata = visibile.match(spia);
    assert.ok(!trovata,
      `${l}/index.html: resta una frase italiana («${trovata && trovata[0]}») nel corpo`);
  });
});

test("i link del menu portano nella lingua scelta, non all'italiano", () => {
  /* Il difetto: dalla home tedesca si clicca «Il team» e si arriva alla pagina
     italiana. La lingua scelta dura una pagina sola. */
  TRADOTTE.forEach((l) => {
    const s = R(`${l}/index.html`);
    const header = s.slice(s.indexOf("<!-- shell:header -->"), s.indexOf("<!-- /shell:header -->"));
    const interni = header.match(/href="(?!https?:|\/|#|mailto:|tel:)([a-z0-9-]+)\.html/g) || [];
    assert.strictEqual(interni.length, 0,
      `${l}: il menu contiene ${interni.length} link che riportano all'italiano (${interni[0] || ""})`);
  });
});

/* ------------------------------------------------------------ il selettore -- */
test("il selettore lingua c'è su tutte le pagine pubbliche", () => {
  /* Sta nell'header condiviso: questo test serve a impedire che una pagina
     generata a mano resti senza, e che il lettore di quella pagina non possa
     più cambiare lingua. */
  /* `app.html` ha una barra propria (area riservata) e non monta questo
     header: è l'unica esclusione ammessa, e resta scritta qui perché chi
     aggiunge una pagina sappia che deve comparire nell'elenco. */
  const SENZA_HEADER_PUBBLICO = ["app.html"];
  const pagine = fs.readdirSync(path.join(__dirname, ".."))
    .filter((f) => f.endsWith(".html"))
    .filter((f) => SENZA_HEADER_PUBBLICO.indexOf(f) === -1);
  const senza = pagine.filter((f) => !/data-lang-switch/.test(R(f)));
  assert.strictEqual(senza.length, 0,
    `pagine senza selettore lingua: ${senza.join(", ")}`);
});

test("il selettore offre tutte e quattro le lingue, con link veri", () => {
  const header = R("partials/header.html");
  assert.ok(/href="\/"/.test(header), "manca il link all'italiano");
  TRADOTTE.forEach((l) => {
    assert.ok(new RegExp(`hreflang="${l}"`).test(header), `manca l'inglese in hreflang=${l}`);
    assert.ok(new RegExp(`href="/${l}/"`).test(header), `manca il link a /${l}/`);
  });
  assert.ok(/data-lang-current/.test(header), "manca il posto dove mostrare la sigla attiva");
});

test("la lingua non si sceglie con le bandiere", () => {
  /* Una bandiera sbaglia: la Union Jack non è la lingua inglese, la bandiera
     spagnola non è lo spagnolo. Il test impedisce che qualcuno le rimetta
     «perché si capiscono meglio». */
  const header = R("partials/header.html");
  /* il controllo è sui link delle lingue, non su tutte le icone dell'header:
     il globo e la freccia sono <svg> inline e vanno benissimo */
  const voci = header.match(/<a[^>]*data-lang="[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
  assert.ok(voci.length >= 4, "mancano le voci delle lingue");
  voci.forEach((v) => {
    assert.ok(!/<img|flag|bandiera|\.png|\.jpg/i.test(v),
      "una voce lingua usa un'immagine: " + v.slice(0, 80));
  });
  assert.ok(/data-lang-current/.test(header), "la sigla testuale è l'unica indicazione ammessa");
  assert.ok(/data-lang-current/.test(header), "la sigla testuale è l'unica indicazione ammessa");
});

test("cambiare lingua non ricarica la stessa pagina", () => {
  /* Un link che punta alla pagina in cui siamo già sembra rotto: si clicca
     «Deutsch» dentro `/de/` e non succede niente. main.js lo corregge. */
  const js = R("assets/js/main.js");
  assert.ok(/aria-current/.test(js), "la voce attiva va dichiarata");
  assert.ok(/setAttribute\("href", location\.pathname/.test(js),
    "la voce della lingua corrente deve puntare a sé stessa, non altrove");
});

test("la lingua scelta si ricorda, e si propone quella del browser", () => {
  const js = R("assets/js/main.js");
  assert.ok(/localStorage/.test(js), "la scelta va ricordata");
  assert.ok(/navigator\.languages/.test(js),
    "a un visitatore nuovo si propone la lingua del browser");
  assert.ok(/location\.replace\("\/" \+ scelta/.test(js),
    "la proposta deve portare sulla pagina giusta una volta sola");
});

/* -------------------------------------------------------------------------
   Le pagine tradotte devono poter caricare i propri asset.
   Test nato da un guasto vero: da `/de/`, un `src="assets/js/main.js"`
   relativo punta a `/de/assets/js/main.js`, che non esiste. CSS e script
   sparivano e la pagina sembrava solo «un po' diversa» invece che rotta.
   Il difetto non si vede leggendo l'HTML: si vede servendo il sito.
   ------------------------------------------------------------------------- */
test("le pagine tradotte caricano gli asset dalla radice", () => {
  TRADOTTE.forEach((l) => {
    const h = R(`${l}/index.html`);
    const relativi = [...h.matchAll(/(?:src|href)="(assets\/[^"]*)"/g)].map((m) => m[1]);
    assert.equal(
      relativi.length,
      0,
      `${l}: ${relativi.length} asset relativi, il primo è «${relativi[0] || ""}»`
    );
    assert.match(h, /src="\/assets\/js\/main\.js/, `${l}: manca main.js dalla radice`);
    assert.match(h, /href="\/assets\/css\/premium\.css/, `${l}: manca il foglio di stile`);
  });
});

/* Il menu deve restare dentro la lingua: nessun `href` relativo che
   riporterebbe all'italiano sbagliando di una cartella. */
test("dalla pagina tradotta non si torna all'italiano per sbaglio", () => {
  TRADOTTE.forEach((l) => {
    const h = R(`${l}/index.html`);
    const intestazione = h.slice(
      h.indexOf("<!-- shell:header -->"),
      h.indexOf("<!-- /shell:header -->")
    );
    const relativi = [...intestazione.matchAll(/href="([a-z0-9\-]+\.html[^"]*)"/g)].map(
      (m) => m[1]
    );
    assert.equal(relativi.length, 0, `${l}: il menu punta all'italiano («${relativi[0] || ""}»)`);
    /* il marchio porta alla radice della lingua: `/en/`, non `/en/index` */
    assert.ok(
      intestazione.includes(`href="/${l}/"`),
      `${l}: il menu non punta alla propria lingua`
    );
  });
});

/* Senza JavaScript la sigla deve già dire la lingua giusta: altrimenti una
   pagina tedesca mostra «IT» accanto al globo, e sbaglia proprio nel comando
   che dovrebbe dire in che lingua si sta leggendo. */
test("la sigla del selettore è scritta già giusta nell'HTML", () => {
  const attese = { en: "EN", de: "DE", es: "ES" };
  Object.entries(attese).forEach(([l, sigla]) => {
    const h = R(`${l}/index.html`);
    assert.ok(!h.includes("data-lang-current>IT<"), `${l}: la sigla dice ancora IT`);
    assert.ok(h.includes(`data-lang-current>${sigla}<`), `${l}: manca la sigla ${sigla}`);
    assert.ok(
      h.includes(`data-lang="${l}" aria-current="true"`),
      `${l}: la voce corrente non è marcata`
    );
    /* una sola voce corrente, non due */
    assert.equal(
      (h.match(/aria-current="true"/g) || []).length,
      1,
      `${l}: più di una voce marcata come corrente`
    );
  });
});

/* Testo alternativo, `aria-label`, `title`, `placeholder` non stanno fra `>` e
   `<`: la traduzione dei nodi di testo non li tocca. Sono i testi che nessuno
   rilegge — invisibili a chi guarda la pagina, presenti a chi la ascolta.
   Trovati in italiano in produzione su `/de/`. */
test("anche i testi invisibili sono tradotti", () => {
  TRADOTTE.forEach((l) => {
    const h = R(`${l}/index.html`);
    const attrs = [...h.matchAll(/\b(alt|aria-label|title|placeholder)="([^"]+)"/g)]
      .map((m) => m[2])
      .filter((v) => /[^\W\d_]/.test(v));
    const it = CAT("it");
    const rimasti = attrs.filter((v) => it[v] === v || Object.keys(it).includes(v));
    /* le eccezioni vere: nomi propri, sigle, parole identiche nelle due lingue */
    const ammessi = ["Traccia", "WhatsApp", "MB", "AC", "SF", "GR", "IT", "EN", "DE", "ES"];
    const colpevoli = rimasti.filter((v) => !ammessi.includes(v) && it[v] === v);
    assert.equal(
      colpevoli.length,
      0,
      `${l}: ${colpevoli.length} testi invisibili in italiano, il primo è «${colpevoli[0] || ""}»`
    );
  });
});

/* Da una pagina tedesca ogni link interno deve restare in tedesco: il banner
   cookie e il piè di pagina stavano fuori da `<main>` e puntavano a
   `/cookie.html`, cioè all'italiano, da tutte e tre le lingue. */
test("nessun link interno riporta all'italiano", () => {
  TRADOTTE.forEach((l) => {
    const h = R(`${l}/index.html`);
    /* `data:` è l'icona incisa in linea, non un collegamento da seguire */
    const interni = [...h.matchAll(/href="(?!https?:|\/assets|\/|#|mailto:|tel:|data:)([^"]+)"/g)].map(
      (m) => m[1]
    );
    assert.equal(
      interni.length,
      0,
      `${l}: ${interni.length} link relativi (riportano all'italiano), il primo è «${interni[0] || ""}»`
    );
    /* e i link assoluti interni stanno nella propria lingua */
    const fuori = [...h.matchAll(/href="\/(en|de|es|it)?\/?([a-z0-9\-]*\.html[^"]*)"/g)]
      .filter((m) => m[1] !== l)
      .map((m) => m[0]);
    assert.equal(fuori.length, 0, `${l}: ${fuori.length} link in un'altra lingua («${fuori[0] || ""}»)`);
  });
});

module.exports = casi;
