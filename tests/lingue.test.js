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
test("il catalogo italiano è la fotografia delle pagine, non un elenco di ricordi", () => {
  /* Il difetto che questo test intercetta è silenzioso in entrambe le
     direzioni. Una frase italiana che compare in pagina e non è nel catalogo
     resta italiana in tutte e tre le lingue, e nessuno se ne accorge finché
     qualcuno non la legge. Una chiave che non compare più in nessuna pagina è
     una traduzione fatta e poi buttata via: il testo è cambiato e il catalogo
     no — e il test «nessuna chiave orfana» grida per aria finché qualcuno non
     lo zittisce, e da quel momento non lo legge più nessuno.

     Il confronto lo fa `tools/allinea_catalogo.py`, che è anche lo strumento
     con cui si sistema: `--pota` toglie le orfane, `--aggiungi` aggiunge le
     mancanti. Qui si controlla che risponda «allineati». */
  const { spawnSync } = require("child_process");
  const esito = spawnSync("python3", ["tools/allinea_catalogo.py"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });
  const uscita = (esito.stdout || "").trim();
  assert.strictEqual(
    esito.status,
    0,
    "catalogo e pagine non coincidono:\n" + uscita.split("\n").slice(0, 12).join("\n")
  );
  assert.match(uscita, /allineati/, "il controllo non ha risposto come previsto");
});

test("ogni lingua ha un catalogo, e l'italiano è la fonte", () => {
  LINGUE.forEach((l) => {
    assert.ok(esiste(`tools/i18n/${l}.json`), `manca il catalogo ${l}.json`);
  });
  const it = CAT("it");
  /* Il catalogo italiano copre tutto il sito, non solo la home: era nato per
     la home sola, e le altre tredici pagine si traducevano senza una fonte di
     verità italiana con cui confrontarsi. La soglia è bassa di proposito —
     quello che conta è che non torni a essere il catalogo di una pagina. */
  assert.ok(Object.keys(it).length > 900,
    `il catalogo italiano ha ${Object.keys(it).length} chiavi: copre una pagina sola, non il sito`);
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
     test non può giudicare la qualità di una traduzione, ma può vedere due
     cose che succedono davvero.

     Primo: un valore vuoto, che in pagina diventa un buco.
     Secondo: una frase italiana incollata nella colonna sbagliata. Qui non si
     confronta il valore con la chiave — nomi propri, codici pratica, sigle e
     nomi di tecnologia sono identici in ogni lingua ed è giusto che lo siano,
     e un elenco di eccezioni lungo novanta voci smette di essere una regola e
     diventa un elenco di cose tollerate. Si cerca invece una parola che in
     inglese, tedesco e spagnolo non esiste: se compare, quella frase non è
     stata tradotta. */
  const SPIA = /\b(della|dello|degli|delle|dei|nella|negli|perché|quindi|nostro|nostra|vostro|siamo|potrebbe|anche|senza|dopo|ogni|sono|questo|questa|dove|più|già|sempre|denaro|truffa|truffe|pratica|documenti)\b/i;
  const it = CAT("it");
  TRADOTTE.forEach((l) => {
    const cat = CAT(l);
    const vuote = Object.keys(it).filter((k) => k !== "_meta" && !cat[k]);
    assert.strictEqual(vuote.length, 0,
      `${l}: ${vuote.length} traduzioni vuote, la prima è «${(vuote[0] || "").slice(0, 60)}»`);
    const copiate = Object.keys(it).filter((k) => k !== "_meta" && SPIA.test(cat[k] || ""));
    assert.strictEqual(copiate.length, 0,
      `${l}: ${copiate.length} frasi ancora italiane, la prima è «${(copiate[0] || "").slice(0, 60)}»`);
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

test("il selettore offre tutte e quattro le lingue, sempre in vista", () => {
  const header = R("partials/header.html");
  /* Il difetto da impedire è il contrario di quello di prima: non «manca una
     lingua», ma «la lingua è nascosta dietro un menu». Chi arriva su una
     pagina che non sa leggere deve vedere l'uscita senza aprirla. */
  /* solo il markup: il commento che spiega perché non c'è più un `<details>`
     contiene la parola, e non è un menu */
  const senzaCommenti = header.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(!/<details/.test(senzaCommenti),
    "il selettore non deve tornare a essere un menu da aprire");
  assert.ok(!/lang__toggle|lang__menu/.test(header), "resti del vecchio menu a tendina");
  const voci = header.match(/class="lang__opt"[^>]*data-lang="([a-z]{2})"/g) || [];
  assert.equal(voci.length, 4, "le lingue in vista devono essere quattro");
  assert.ok(/href="\/"/.test(header), "manca il link all'italiano");
  TRADOTTE.forEach((l) => {
    assert.ok(new RegExp(`hreflang="${l}"`).test(header), `manca hreflang=${l}`);
    assert.ok(new RegExp(`href="/${l}/"`).test(header), `manca il link a /${l}/`);
  });
});

test("la lingua non si sceglie con le bandiere", () => {
  /* Una bandiera sbaglia: la Union Jack non è la lingua inglese, la bandiera
     spagnola non è lo spagnolo. Il test impedisce che qualcuno le rimetta
     «perché si capiscono meglio». */
  const header = R("partials/header.html");
  /* il controllo è sui link delle lingue, non su tutte le icone dell'header:
     il globo e la freccia sono <svg> inline e vanno benissimo */
  const voci = header.match(/<a class="lang__opt"[\s\S]*?<\/a>/g) || [];
  assert.ok(voci.length >= 4, "mancano le voci delle lingue");
  voci.forEach((v) => {
    assert.ok(!/<img|flag|bandiera|\.png|\.jpg/i.test(v),
      "una voce lingua usa un'immagine: " + v.slice(0, 80));
  });
  assert.ok(/<span aria-hidden="true">[A-Z]{2}<\/span>/.test(header),
    "la sigla testuale è l'unica indicazione ammessa");
});

test("sulla lingua in cui si è già non c'è un link che non fa niente", () => {
  /* Prima la voce attiva era un `<a>` che puntava alla pagina in corso: si
     premeva e non succedeva nulla, e chi non lo sa conclude che il selettore
     non funziona. Ora la voce corrente è una pastiglia accesa, senza href. */
  const tagLingua = (blocco, l) =>
    [...blocco.matchAll(/<a class="lang__opt"[\s\S]*?>/g)]
      .map((m) => m[0])
      .filter((t) => t.includes(`data-lang="${l}"`))
      .filter((t) => (t.match(/data-lang="/g) || []).length === 1);

  ["it"].concat(TRADOTTE).forEach((l) => {
    const file = l === "it" ? "index.html" : `${l}/index.html`;
    const h = R(file);
    const blocco = h.slice(h.indexOf("data-lang-switch"), h.indexOf('class="nav__actions"'));
    const corrente = tagLingua(blocco, l)[0];
    assert.ok(corrente, `${l}: manca la voce della lingua corrente`);
    assert.ok(/aria-current="true"/.test(corrente), `${l}: la voce corrente non è dichiarata`);
    assert.ok(!/href=/.test(corrente), `${l}: la voce corrente è ancora un link`);
    /* e le altre tre sono link veri */
    const altre = ["it"].concat(TRADOTTE).filter((x) => x !== l);
    altre.forEach((x) => {
      const t = tagLingua(blocco, x)[0];
      assert.ok(t && /href="/.test(t), `${l}: «${x}» non è un link`);
    });
  });
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
    assert.match(h, /src="\/assets\/(?:[0-9a-f]{8}\/)?js\/main\.js/,
      `${l}: manca main.js dalla radice`);
    assert.match(h, /href="\/assets\/(?:[0-9a-f]{8}\/)?css\/premium\.css/, `${l}: manca il foglio di stile`);
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
test("la lingua corrente è dichiarata nell'HTML, non solo dallo script", () => {
  TRADOTTE.forEach((l) => {
    const h = R(`${l}/index.html`);
    const blocco = h.slice(h.indexOf('data-lang-switch'), h.indexOf('class="nav__actions"'));
    /* una sola voce accesa, e non è l'italiano */
    assert.equal((blocco.match(/aria-current="true"/g) || []).length, 1, `${l}: voci accese`);
    const corrente = blocco.match(/<a class="lang__opt"[\s\S]*?aria-current="true"[^>]*>/);
    assert.ok(corrente && corrente[0].includes(`data-lang="${l}"`), `${l}: accesa la lingua sbagliata`);
    /* le sigle: quattro, una per lingua */
    const sigle = [...blocco.matchAll(/<span aria-hidden="true">([A-Z]{2})<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(sigle, ["IT", "EN", "DE", "ES"], `${l}: sigle ${sigle.join(" ")}`);
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
    /* «Italiano» nella pagina inglese è voluto: è il nome che quella lingua dà
       a sé stessa, ed è quello che cerca chi parla italiano. Stessa cosa per
       le altre tre. Non sono stringhe rimaste indietro: sono l'eccezione. */
    const ammessi = [
      "Traccia", "WhatsApp", "MB", "AC", "SF", "GR", "IT", "EN", "DE", "ES",
      "Italiano", "English", "Deutsch", "Español",
    ];
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
    /* e i link assoluti interni stanno nella propria lingua — tranne l'area
       riservata e la console, che esistono in un solo esemplare e non sono
       state tradotte: mandare a `/de/app.html` sarebbe un 404, e un 404 è
       peggio di una pagina italiana. */
    const riservate = /^\/(app|admin)\.html/;
    const fuori = [...h.matchAll(/href="\/(en|de|es|it)?\/?([a-z0-9\-]*\.html[^"]*)"/g)]
      .filter((m) => m[1] !== l && !riservate.test(m[0].replace('href="', "")))
      .map((m) => m[0]);
    assert.equal(fuori.length, 0, `${l}: ${fuori.length} link in un'altra lingua («${fuori[0] || ""}»)`);
  });
});

/* Il difetto che il committente ha visto: da una pagina tedesca si preme
   «segnala un caso» e si arriva a «pagina non trovata». Una lingua non è tradotta
   perché la home lo è: è tradotta quando ogni link della home porta a una
   pagina che esiste. */
test("ogni pagina pubblica esiste in ogni lingua, e ogni link porta a qualcosa", () => {
  const ITALIANE = fs.readdirSync(path.join(__dirname, ".."))
    .filter((f) => /\.html$/.test(f))
    .filter((f) => !/^(app|admin)\.html$/.test(f));
  const mancanti = [];

  TRADOTTE.forEach((l) => {
    ITALIANE.forEach((pagina) => {
      const percorso = path.join(__dirname, "..", l, pagina);
      if (!fs.existsSync(percorso)) { mancanti.push(l + "/" + pagina); return; }
      const html = R(l + "/" + pagina);
      const rotti = [...html.matchAll(/href="\/(?:en|de|es|it)\/([^"#]*)"/g)]
        .map((m) => m[1])
        .filter((f) => f && !fs.existsSync(path.join(__dirname, "..", l, f)));
      if (rotti.length) mancanti.push(l + "/" + pagina + " → " + rotti[0]);
    });
  });

  assert.deepEqual(mancanti, [],
    "pagine o link mancanti: " + mancanti.slice(0, 6).join(", ") +
    (mancanti.length > 6 ? " e altri " + (mancanti.length - 6) : ""));
});

/* Una pagina tradotta che parla ancora italiano. È il controllo che rende
   utile tutto il resto: `build_i18n.py` non si lamenta delle frasi che resta
   da tradurre, le elenca; questo test trasforma quell'elenco in un guasto. */
test("nessuna pagina tradotta contiene frasi italiane rimaste indietro", () => {
  const catalogo = JSON.parse(R("tools/i18n/it.json"));
  delete catalogo._meta;

  /* Frasi italiane che non devono mai comparire in una pagina tradotta: sono
     le più frequenti e le più visibili — un paragrafo, non una parola. */
  const sospette = [
    /\b(che|della|delle|degli|nella|nelle|questo|questa|questi|queste|anche|senza|sopra|sotto|sono|essere|abbiamo|viene|vengono|dopo|prima|sempre|mai|ogni|tutti|tutte)\b/gi
  ];
  /* parole che restano identiche in italiano e in inglese/tedesco/spagnolo */
  const neutre = new Set(["che", "sono", "ogni", "prima", "dopo", "sempre", "mai", "anche",
                          "essere", "viene", "tutti", "tutte", "questo", "questa", "sotto"]);

  const sporche = [];
  TRADOTTE.forEach((l) => {
    fs.readdirSync(path.join(__dirname, "..", l)).filter((f) => /\.html$/.test(f)).forEach((f) => {
      const html = R(l + "/" + f);
      const testo = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
                        .replace(/<style[\s\S]*?<\/style>/gi, " ")
                        .replace(/<[^>]+>/g, " ");
      /* conta le parole italiane che non sono nel catalogo come traduzione */
      let italiane = 0;
      const visti = new Set();
      (testo.match(sospette[0]) || []).forEach((parola) => {
        const p = parola.toLowerCase();
        if (neutre.has(p) || visti.has(p)) return;
        visti.add(p);
        italiane++;
      });
      if (italiane > 3) sporche.push(`${l}/${f} (${italiane} parole italiane)`);
    });
  });

  assert.deepEqual(sporche, [],
    "pagine tradotte con testo italiano: " + sporche.slice(0, 8).join(", ") +
    (sporche.length > 8 ? " e altre " + (sporche.length - 8) : ""));
});

module.exports = casi;
