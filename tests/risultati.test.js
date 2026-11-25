/* ==========================================================================
   I risultati dichiarati: un numero, in due punti, uguale in quattro lingue
   ==========================================================================
   Il sito dichiara da oggi una cifra: **24,0 milioni di euro arrivati ai
   clienti nel 2026**. È la prima affermazione quantitativa sul passato che
   compare in pagina — le altre sono state sostituite da un trattino proprio
   perché inventate (vedi `README-DEPLOY.md`, «Attenzione prima di andare
   online per davvero»). Per questo i test qui sotto sono più severi del solito:
   non difendono un layout, difendono una dichiarazione.

   Cosa si rompe in silenzio, senza questi test:

   1. **il numero cambia in un posto solo.** La cifra compare in `index.html` e
      in `casi.html`; due copie scollegate si aggiornano una alla volta, e per
      qualche giorno il sito dichiara due risultati diversi. È il tipo di
      errore che un cliente nota e noi no.
   2. **il numero si gonfia.** Un arrotondamento «generoso» — 24,4 scritto 25,
      una cifra senza il «nel 2026» — non lo vede nessuno, e trasforma un dato
      vero in una promessa. Qui la cifra deve restare quella concordata.
   3. **il numero esce in italiano su una pagina inglese.** I contatori
      animati scrivono `toLocaleString("it-IT")` e prendono l'unità da un
      attributo: «24» con `data-suffix=" Mln €"` diventa *«24,0 Mln €»* anche
      su `/en/`. Per questo la cifra è testo, non un contatore — e questo test
      impedisce che qualcuno, colto da buona intenzione, ce lo rimetta.
   4. **la cifra non è spiegata.** Un numero senza la frase che dice come è
      stato calcolato e che non è una previsione è marketing. Deve restare
      scritto, in tutte e quattro le lingue.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const RADICE = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");
const CAT = (l) => JSON.parse(R(`tools/i18n/${l}.json`));

const LINGUE = ["it", "en", "de", "es"];
const TRADOTTE = ["en", "de", "es"];

/* Le pagine che dichiarano il risultato, con il percorso in ogni lingua. */
const PAGINE = { it: ["index.html", "casi.html"], en: [], de: [], es: [] };
for (const l of TRADOTTE) {
  PAGINE[l] = ["index.html", "casi.html"].map((f) => `${l}/${f}`);
}

/* Le cifre dichiarate, nella forma di ogni lingua. Se cambia un dato, si
   cambia **qui e nel catalogo**: il test esiste perché il cambiamento sia una
   decisione, non una svista.

   `rientrato` è il dato vero, quello che il titolare ha fornito con i
   riscontri. Gli altri li ha chiesti lui «numeri qualsiasi»: sono segnaposto
   dichiarati, e il test `README` (vedi `README-DEPLOY.md`) dice dove stanno
   così che nessuno li scambi per verificati. */
const CIFRA = {
  it: "24,0 Mln €",
  en: "€24.0 mn",
  de: "24,0 Mio. €",
  es: "24,0 M €",
};

/* Il secondo importo, quello dei fondi **tracciati** — un'altra domanda, non
   un altro risultato. */
const TRACCIATO = {
  it: "41,5 Mln €",
  en: "€41.5 mn",
  de: "41,5 Mio. €",
  es: "41,5 M €",
};

/* I numeri in conteggio. Non hanno unità e non hanno separatore di migliaia:
   così si scrivono uguali in ogni lingua e il catalogo non li deve tradurre
   (i numeri, per `allinea_catalogo`, sono dati: `e_dato` li salta). Un
   «1.240» sarebbe corretto in italiano e sbagliato in inglese — «uno virgola
   ventiquattro» — e nessun test di traduzione lo vedrebbe, perché il catalogo
   non lo tocca. */
const CONTEGGI = { casi: "840", perizie: "380" };

/* Il testo senza commenti HTML. Non è pignoleria: accanto alla cifra c'è un
   commento che **la nomina** per spiegare perché non è un contatore, e senza
   questa potatura il commento soddisferebbe il test anche con il valore
   cancellato dalla pagina. Provato: cancellando il riquadro, il test restava
   verde. Un test che si accontenta di un commento non difende niente. */
const senzaCommenti = (html) => html.replace(/<!--[\s\S]*?-->/g, " ");

/* I numeri di telefono hanno cifre attaccate e fanno sembrare «migliaia» ciò
   che è un recapito (`tel:+12016211241`). Si tolgono prima di guardare i
   formati dei numeri. */
const senzaTelefoni = (html) => html.replace(/\+?\d[\d\s().-]{7,}\d/g, " ");

/* ==================================================== il numero, in ogni dove == */

test("l'importo rientrato compare in home e in casi.html, in tutte e quattro le lingue", () => {
  const mancanti = [];
  for (const l of LINGUE) {
    for (const pagina of PAGINE[l]) {
      const testo = senzaCommenti(R(pagina));
      if (!testo.includes(CIFRA[l])) mancanti.push(`${pagina} (atteso «${CIFRA[l]}»)`);
    }
  }
  assert.deepStrictEqual(mancanti, [],
    "pagine che non dichiarano il risultato:\n  " + mancanti.join("\n  "));
});

/* Il testo che un visitatore legge, senza gli attributi e senza gli SVG.
   Serve perché un percorso SVG contiene comandi come `M240 90h44`: cercare
   «240M» o «24» nel sorgente grezzo trova il disegno, non il denaro — ed è
   esattamente il falso positivo che questo test si è preso la prima volta. */
function testoVisibile(html) {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

test("nessuna banda numerica è rimasta a un trattino", () => {
  /* Un «—» dentro un riquadro che doveva contenere un numero è un buco, e su
     una pagina che dichiara 24 milioni si legge come «non lo sappiamo» o,
     peggio, come una casella rotta. Le tre bande del sito devono essere
     complete: era l'ultima cosa che l'utente ha chiesto. */
  const PAGINE_CON_BANDA = ["index.html", "casi.html", "chi-siamo.html"];
  const buchi = [];
  for (const pagina of PAGINE_CON_BANDA) {
    const testo = R(pagina);
    for (const m of testo.matchAll(
      /<span class="metric-band__value">([^<]*)<\/span>/g)) {
      if (!m[1].trim() || /^[—–-]$/.test(m[1].trim())) {
        buchi.push(`${pagina}: riquadro vuoto`);
      }
    }
  }
  assert.deepStrictEqual(buchi, [],
    "riquadri della banda numerica senza cifra:\n  " + buchi.join("\n  "));
});

test("i conteggi dichiarati ci sono, e sono uguali in ogni lingua", () => {
  /* «casi analizzati» e «perizie» sono numeri senza unità e senza separatore
     di migliaia: il catalogo non li tocca, quindi devono uscire identici
     dalle quattro versioni della pagina. Se un giorno qualcuno scrivesse
     «1.240», in inglese si leggerebbe «uno virgola ventiquattro» e nessun test
     di traduzione se ne accorgerebbe. */
  const mancanti = [];
  for (const l of LINGUE) {
    for (const pagina of PAGINE[l]) {
      const testo = senzaCommenti(R(pagina));
      /* I conteggi si leggono **dentro la banda numerica**, non in tutta la
         pagina: fuori ci sono gli importi dei casi (4.900 €, 6.900 €) che in
         italiano usano il punto delle migliaia e sono corretti così. Cercarli
         ovunque produceva un falso allarme su sei pagine su sei. */
      const valori = [...testo.matchAll(
        /<span class="metric-band__value">([\s\S]*?)<\/span>\s*<span class="metric-band__label">/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      if (!valori.length) { mancanti.push(`${pagina}: nessuna banda numerica`); continue; }

      /* in home ci sono entrambi i conteggi; in casi.html solo le perizie */
      const attesi = pagina.endsWith("index.html") ? Object.values(CONTEGGI) : [CONTEGGI.perizie];
      for (const n of attesi) {
        if (!valori.includes(n)) mancanti.push(`${pagina}: manca ${n}`);
      }
      for (const v of valori) {
        if (/^\d{1,3}(?:\.\d{3})+$/.test(v)) {
          mancanti.push(`${pagina}: «${v}» usa il punto delle migliaia ` +
            "(in inglese si legge come un decimale)");
        }
      }
    }
  }
  assert.deepStrictEqual(mancanti, [],
    "conteggi mancanti o scritti in un formato che non regge le altre lingue:\n  " +
    mancanti.join("\n  "));
});

test("il numero è sempre lo stesso: 24,0 milioni, mai arrotondato per eccesso", () => {
  /* Il difetto da impedire è un arrotondamento fatto per far colpo: 24,6 →
     «25», oppure la cifra gonfiata di un ordine di grandezza. Si guarda ogni
     importo in milioni che il visitatore legge davvero. */
  const sospette = [];
  const IMPORTI = [
    /(\d+[.,]\d+)\s*(?:Mln|Mio\.|mn)\s*€?/g,   /* «24,0 Mln €» */
    /€\s*(\d+[.,]\d+)\s*(?:mn|bn|M|Mio\.)/g,    /* «€24.0 mn» */
  ];
  for (const l of LINGUE) {
    for (const pagina of PAGINE[l]) {
      const testo = testoVisibile(senzaCommenti(R(pagina)));
      for (const r of IMPORTI) {
        for (const m of testo.matchAll(r)) {
          const valore = parseFloat(m[1].replace(",", "."));
          /* 24,0 è il rientrato e 41,5 il tracciato: sono le due cifre
             dichiarate, e sono diverse perché rispondono a domande diverse.
             Qualunque altro importo in milioni è un numero nuovo che nessuno
             ha deciso. */
          const ammessi = [24, 41.5];
          if (!ammessi.includes(valore)) sospette.push(`${pagina}: «${m[0].trim()}»`);
        }
      }
    }
  }
  assert.deepStrictEqual(sospette, [],
    "la cifra dichiarata supera i 24,0 milioni concordati:\n  " + sospette.join("\n  "));
});

test("la cifra non è un contatore animato: su /en/ stamperebbe italiano", () => {
  /* `animateCounter` scrive `formatNumber(...)` = `toLocaleString("it-IT")` e
     aggiunge l'unità dell'attributo `data-suffix`. Un contatore con
     `data-suffix=" Mln €"` mostra «24,0 Mln €» su ogni pagina, inglese
     compresa: la traduzione verrebbe sovrascritta **dopo** il caricamento, e
     chi guarda il sorgente non se ne accorge. */
  const colpevoli = [];
  for (const l of LINGUE) {
    for (const pagina of PAGINE[l]) {
      const testo = senzaCommenti(R(pagina));
      /* il contatore della cifra è quello il cui valore supera i 24 milioni */
      for (const m of testo.matchAll(/<span[^>]*data-count="(\d+(?:\.\d+)?)"[^>]*>/g)) {
        const attorno = testo.slice(m.index, m.index + 300);
        if (/Mln|Mio\.|\bmn\b/.test(attorno)) {
          colpevoli.push(`${pagina}: data-count="${m[1]}"`);
        }
      }
    }
  }
  assert.deepStrictEqual(colpevoli, [],
    "la cifra in milioni è finita dentro un contatore: in inglese e in tedesco " +
    "verrebbe riscritta in formato italiano al primo scorrimento:\n  " +
    colpevoli.join("\n  "));
});

/* ================================================= la cifra è spiegata, non nuda == */

/* Le note che spiegano la cifra, nel catalogo. Sono due: una in home (che
   presenta il numero) e una in casi.html (che lo distingue dai fondi
   tracciati). Il test le lega alla pagina, invece di cercare parole sparse:
   «parziale» compare già in `index.html` per un'altra ragione — è uno dei tre
   esiti possibili di un caso — e un'asserzione larga sarebbe soddisfatta da
   quella parola anche con la nota cancellata. Provato: passava. */
function noteDellaCifra(l) {
  /* La chiave è la frase **italiana** in tutti e quattro i cataloghi (è così
     che funziona il catalogo: la chiave è il testo d'origine, il valore è la
     traduzione). Cercare un inizio tradotto nella chiave non trova niente
     fuori dall'italiano — ed è quello che è successo la prima volta. */
  const cat = CAT(l);
  return Object.entries(cat)
    .filter(([k]) => /^(?:Il primo è il solo|Le due cifre in denaro)/.test(k))
    .map(([, v]) => String(v));
}

test("ogni pagina con la cifra ne dice il periodo e che è parziale", () => {
  /* «24 milioni recuperati» da solo fa credere a un totale storico e a una
     promessa. La nota che accompagna la cifra deve dire tre cose: l'anno
     (2026), che è un dato **parziale** dell'anno in corso, e che non è una
     previsione. Ognuna di queste frasi è una frase che qualcuno, un giorno,
     vorrà accorciare per far stare il numero più grande. */
  const PARZIALE = {
    it: /parzial/i, en: /partial/i, de: /Teilzahl|teilweise/i, es: /parcial/i,
  };
  const carenti = [];
  for (const l of LINGUE) {
    const note = noteDellaCifra(l);
    if (note.length !== 2) {
      carenti.push(`${l}: attese 2 note che spiegano la cifra, trovate ${note.length}`);
      continue;
    }
    for (const nota of note) {
      if (!/2026/.test(nota)) carenti.push(`${l}: una nota non dice l'anno`);
      if (!PARZIALE[l].test(nota)) carenti.push(`${l}: una nota non dice che il dato è parziale`);
      if (!/previsione|forecast|Prognose|previsión/i.test(nota)) {
        carenti.push(`${l}: una nota non dice che il numero non è una previsione`);
      }
    }
    /* E le tre cose devono stare **in pagina**, non solo nel catalogo: la
       pagina è la fonte da cui il catalogo si allinea, quindi chi la modifica
       a mano non tocca il catalogo. Controllare solo il catalogo voleva dire
       non controllare il testo che il visitatore legge — provato: togliendo
       «2026» e cambiando «parziale» in «generico» dentro `index.html`, il test
       restava verde. */
    for (const pagina of PAGINE[l]) {
      const testo = senzaCommenti(R(pagina)).replace(/\s+/g, " ");
      const nota = note.find((n) =>
        testo.includes(n.replace(/\s+/g, " ").trim().slice(0, 45)));
      if (!nota) {
        carenti.push(`${pagina}: nessuna nota che spieghi la cifra`);
        continue;
      }
      const i = testo.indexOf(nota.replace(/\s+/g, " ").trim().slice(0, 45));
      const finestra = testo.slice(i, i + 800);
      if (!/2026/.test(finestra)) carenti.push(`${pagina}: la nota non dice l'anno`);
      if (!PARZIALE[l].test(finestra)) {
        carenti.push(`${pagina}: la nota non dice che il dato è parziale`);
      }
      if (!/previsione|forecast|Prognose|previsión/i.test(finestra)) {
        carenti.push(`${pagina}: la nota non dice che non è una previsione`);
      }
    }
  }
  assert.deepStrictEqual(carenti, [],
    "la cifra è dichiarata senza periodo o senza dire che è parziale:\n  " +
    carenti.join("\n  "));
});

test("la cifra non è presentata come previsione né come garanzia", () => {
  /* Il pubblico di questo sito è chi è appena stato truffato: «garantito» è la
     parola che sta cercando per riconoscere un truffatore.

     Qui però la parola **non può** essere vietata in tutta la pagina: il sito
     la usa per negarla — «nessun rendimento garantito», «kein Anbieter kann
     eine garantierte Rückzahlung versprechen» — e quelle frasi sono la difesa,
     non il difetto. Vietarla ovunque segherebbe le avvertenze.

     Si guarda perciò il testo che accompagna la cifra, cioè quello che abbiamo
     scritto noi per spiegarla: l'etichetta del riquadro e le due note. Là una
     promessa non ha scuse. */
  const VIETATE = [
    /\bgarantit[oi]\b/i, /\bgarantiamo\b/i, /\bgarantiert/i, /\bgarantizad[oa]s?/i,
    /\bguarantee[ds]?\b/i, /\brecuperiamo\b/i, /\bwe recover\b/i,
    /\bwir holen\b/i, /\brecuperamos\b/i, /\b100 ?%/,
    /\bprevisione certa\b/i, /\besito assicurato\b/i, /\bcerto\b/i,
  ];
  const testi = [];
  for (const l of LINGUE) {
    const cat = CAT(l);
    for (const chiave of ["somme rientrate ai nostri clienti nel 2026",
                          "somme rientrate ai segnalanti nel 2026",
                          "Come leggere questi numeri.",
                          "Nota sui numeri."]) {
      if (cat[chiave]) testi.push([l, cat[chiave]]);
    }
    /* e la nota intera, che è la chiave lunga */
    for (const [k, v] of Object.entries(cat)) {
      if (/^(?:Sono le somme arrivate|These are the sums|Das sind die Beträge|Son las sumas)/.test(k)) {
        testi.push([l, v]);
      }
      if (/^(?:La cifra in cima|The figure at the top|Die Zahl oben|La cifra de arriba)/.test(k)) {
        testi.push([l, v]);
      }
    }
  }
  const trovate = [];
  for (const [l, testo] of testi) {
    for (const r of VIETATE) {
      const m = String(testo).match(r);
      if (m) trovate.push(`${l}: «${m[0]}» in «${String(testo).slice(0, 60)}…»`);
    }
  }
  assert.deepStrictEqual(trovate, [],
    "il testo che spiega la cifra promette un risultato:\n  " + trovate.join("\n  "));
});

test("le due pagine spiegano la differenza fra «tracciato» e «rientrato»", () => {
  /* È la distinzione che il sito difende da sempre: «tracciato» significa che
     esistono soggetti identificabili su cui agire, non che il denaro sia
     tornato. Accostare una cifra di denaro **rientrato** alle vecchie
     etichette sui fondi **tracciati**, senza dirlo, confonderebbe le due
     cose proprio nel punto in cui il numero fa più impressione. */
  /* Non si cerca una frase virgolettata — il testo delle note è cambiato due
     volte in un giorno — ma la coppia di concetti: la pagina deve nominare
     **il denaro tornato** e **il percorso ricostruito**, e dire che non sono
     la stessa cosa. Cercare le parole è più fragile della cosa che si vuole
     garantire. */
  const daSpiegare = {
    it: (t) => /rientrat/i.test(t) && /ricostruito il percorso|punto di aggancio/i.test(t),
    en: (t) => /returned|came back/i.test(t) && /reconstructed|point of contact/i.test(t),
    de: (t) => /zurückgekommen|zurückgeflossen/i.test(t) && /rekonstruiert|Anknüpfungspunkt/i.test(t),
    es: (t) => /devuelto|ha vuelto/i.test(t) && /reconstruido|punto de anclaje/i.test(t),
  };
  const carenti = [];
  for (const l of LINGUE) {
    for (const pagina of PAGINE[l]) {
      if (!daSpiegare[l](senzaCommenti(R(pagina)))) carenti.push(`${pagina} (${l})`);
    }
  }
  assert.deepStrictEqual(carenti, [],
    "pagine che accostano la cifra ai fondi tracciati senza spiegare che è " +
    "un'altra cosa:\n  " + carenti.join("\n  "));
});

/* ============================================ il catalogo dice la stessa cosa ==== */

test("il numero e le note sono nel catalogo, tradotti in tutte e quattro le lingue", () => {
  /* Una pagina tradotta si costruisce dal catalogo: la frase che manca lì
     resta italiana. Le chiavi del numero e delle due note devono esistere e
     non essere vuote in ogni lingua. */
  const CHIAVI = {
    numero: "24,0 Mln €",
    etichettaHome: "somme rientrate ai nostri clienti nel 2026",
    etichettaCasi: "somme rientrate ai segnalanti nel 2026",
    notaHome: "Come leggere questi numeri.",
    notaCasi: "Nota sui numeri.",
  };
  const buchi = [];
  for (const l of LINGUE) {
    const cat = CAT(l);
    for (const [nome, chiave] of Object.entries(CHIAVI)) {
      if (!(chiave in cat)) buchi.push(`${l}: manca la chiave «${nome}»`);
      else if (!String(cat[chiave]).trim()) buchi.push(`${l}: «${nome}» è vuota`);
    }
  }
  assert.deepStrictEqual(buchi, [],
    "chiavi del risultato mancanti o vuote:\n  " + buchi.join("\n  "));
});

test("il numero tradotto non è una traduzione a metà", () => {
  /* La trappola è lasciare l'unità italiana nelle altre lingue: «24,0 Mln €»
     dentro `en/index.html` non è un refuso, è un numero che il lettore
     inglese non riconosce come milioni. */
  const sbagliate = [];
  for (const l of TRADOTTE) {
    const cat = CAT(l);
    const valore = cat["24,0 Mln €"];
    if (valore !== CIFRA[l]) {
      sbagliate.push(`${l}: «${valore}» invece di «${CIFRA[l]}»`);
    }
    /* e l'unità italiana non deve comparire nella traduzione */
    if (l !== "it" && /Mln/.test(valore)) {
      sbagliate.push(`${l}: conserva l'unità italiana «Mln»`);
    }
  }
  assert.deepStrictEqual(sbagliate, [],
    "numero mal tradotto:\n  " + sbagliate.join("\n  "));
});

/* ================================================== il numero su un telefono == */

test("la cifra sta in una riga sul telefono più stretto", () => {
  /* Il pubblico arriva dal telefono, e un numero che va a capo a metà —
     «24,0 Mln» / «€» — si legge come due cose diverse. Il rischio cresce con
     l'unità di ogni lingua: «€24.0 mn», «24,0 Mio. €», «24,0 M €».
     Si misura col carattere vero, quello servito dal sito (`inter-var.woff2`),
     come già fanno `test_header_larghezza` e `test_menu_riga`: senza il font,
     la stima è un'opinione. */
  const { spawnSync } = require("child_process");
  const script = [
    "import sys, pathlib",
    "sys.path.insert(0, '/tmp/pylibs')",
    "try:",
    "    from fontTools.ttLib import TTFont",
    "except Exception:",
    "    print('NOFONT'); sys.exit(0)",
    "f = TTFont('assets/fonts/inter-var.woff2')",
    "upm = f['head'].unitsPerEm; cmap = f.getBestCmap(); hmtx = f['hmtx']",
    "def lar(t, px):",
    "    return sum(hmtx[cmap[ord(c)]][0] if ord(c) in cmap else upm * 0.5 for c in t) / upm * px",
    "# il corpo più grande che la cifra può avere: clamp(1.9rem, 3.6vw, 2.7rem)",
    "px = 1.9 * 16",
    "larghezze = [320 - 40 - 32]",
    "for s in ['24,0 Mln €', '€24.0 mn', '24,0 Mio. €', '24,0 M €',",
    "          '41,5 Mln €', '€41.5 mn', '41,5 Mio. €', '41,5 M €', '840', '380']:",
    "    print(f'{s}\t{lar(s, px):.0f}\t{larghezze[0]}')",
  ].join("\n");

  const esito = spawnSync("python3", ["-c", script], { cwd: RADICE, encoding: "utf8" });
  if (esito.status !== 0) return;                    /* python assente: niente da dire */
  if (/NOFONT/.test(esito.stdout)) return;           /* fontTools assente: idem */

  const troppo = [];
  for (const riga of esito.stdout.trim().split("\n")) {
    const [testo, larg, disponibile] = riga.split("\t");
    if (parseFloat(larg) > parseFloat(disponibile)) {
      troppo.push(`«${testo}»: ${larg}px su ${disponibile}px disponibili`);
    }
  }
  assert.deepStrictEqual(troppo, [],
    "la cifra non sta in una riga sul telefono: andrebbe a capo a metà numero:\n  " +
    troppo.join("\n  "));
});

/* ============================================ i numeri hanno una provenienza == */

test("ogni cifra in pagina è registrata in NUMERI.md, con il suo stato", () => {
  /* Il difetto che questo test impedisce non è estetico: è il numero
     «provvisorio» che resta per anni. Nessuno ricorda se 840 erano casi veri;
     non si cancella perché «qualcuno l'aveva messo»; e intanto il sito lo
     dichiara. Registrarlo con una data e uno stato lo rende una scadenza
     invece che un'abitudine.

     Non si può verificare che una cifra sia vera — questo lo sa solo chi ha i
     riscontri. Si può verificare che nessuna cifra sia **dimenticata**. */
  assert.ok(fs.existsSync(path.join(RADICE, "NUMERI.md")),
    "manca NUMERI.md: le cifre del sito non hanno un registro");

  const registro = R("NUMERI.md");
  const senzaFonte = [];
  for (const [chiave, valore] of Object.entries({ ...CONTEGGI, ...CIFRA, ...TRACCIATO })) {
    if (!registro.includes(valore)) {
      senzaFonte.push(`${chiave} (${valore}): non compare in NUMERI.md`);
    }
  }
  assert.deepStrictEqual(senzaFonte, [],
    "cifre in pagina senza una riga nel registro:\n  " + senzaFonte.join("\n  "));
});

test("il numero vero è dichiarato VERO, i segnaposto no", () => {
  /* Se un domani qualcuno promuovesse un segnaposto a dato verificato senza
     avere i riscontri, questo file direbbe il falso — e lo direbbe nel posto
     che serve a non dire il falso. La riga del 24,0 deve dire VERO, le altre
     no. È volutamente rigido: è una dichiarazione, non un'approssimazione. */
  /* Ogni riga della tabella ha una colonna «Stato», e in quella colonna c'è
     **una** parola. Prima questo test contava le righe che contenevano «VERO»
     e non «SEGNAPOSTO», quindi promuovere un segnaposto aggiungendo la parola
     — `| VERO, era SEGNAPOSTO |` oppure una cella con entrambe — passava
     indisturbato. Provato. Ora si guarda la terza colonna, e deve essere
     esattamente una delle due parole. */
  const righe = R("NUMERI.md").split("\n")
    .filter((r) => /^\|/.test(r) && !/^\|\s*Cifra/.test(r) && !/^\|[-\s|]+\|$/.test(r));

  const stati = righe.map((r) => {
    const celle = r.split("|").map((c) => c.trim());
    /* | cifra | dove | stato | fonte |  → indice 3. La colonna si legge
       **così com'è**: un «**VERO**» in grassetto non è la parola VERO, e la
       prima versione di questo test lo accettava perché cercava la parola
       dentro la riga. Il grassetto si usa per la cifra, non per lo stato —
       lo stato è un dato, e un dato si confronta esattamente. */
    return { cifra: celle[1], stato: celle[3] || "", riga: r };
  }).filter((x) => /€|%|casi|perizie|ricostruito/.test(x.cifra));

  const veri = stati.filter((x) => x.stato === "VERO");
  const segnaposti = stati.filter((x) => x.stato === "SEGNAPOSTO");
  const ambigui = stati.filter((x) => x.stato !== "VERO" && x.stato !== "SEGNAPOSTO");

  assert.deepStrictEqual(ambigui.map((x) => `«${x.cifra}» → «${x.stato}»`), [],
    "ogni cifra deve dichiarare uno stato esatto, VERO o SEGNAPOSTO, non una " +
    "via di mezzo:\n  ");

  assert.strictEqual(veri.length, 1,
    "in NUMERI.md deve esserci **una sola** cifra dichiarata VERO (i 24,0 Mln € " +
    "rientrati); trovate " + veri.length + ": " + veri.map((x) => x.cifra).join(", "));
  assert.ok(/24,0 Mln €/.test(veri[0].cifra),
    "la cifra dichiarata VERO deve essere quella rientrata, non un'altra: " + veri[0].cifra);
  assert.ok(segnaposti.length >= 4,
    "i segnaposto devono restare dichiarati: se ne trovano " + segnaposti.length);
});

module.exports = casi;
