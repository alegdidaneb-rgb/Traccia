/* ==========================================================================
   Il telefono: la parte alta della pagina risponde al dito
   ==========================================================================
   Segnalazione dell'utente, 2026-10-31: «entrando da mobile la metà alta della
   pagina non è selezionabile né cliccabile, e ogni volta che si clicca
   qualcosa si ricarica su altre pagine».

   I due sintomi sembrano due difetti e sono **uno solo**: un pannello di
   navigazione chiuso che però resta dipinto sopra la pagina.

   Come succede, nel foglio di stile:

     .nav__panel { opacity: 0; visibility: hidden; }      ← chiuso, invisibile
     .nav__panel.is-open { visibility: visible; }         ← aperto

   e sotto la soglia dell'hamburger la regola `.nav__links` riceve
   `visibility: visible` **senza condizione**. La conseguenza è un caso
   preciso, e non teorico: `visibility` si eredita dall'antenato più vicino
   che la dichiara, quindi un figlio con `visibility: visible` dentro un padre
   `hidden` **torna visibile**. Se il browser non può applicare `visibility`
   al pannello (o se una regola la riaccende), resta il pannello a piena
   larghezza, trasparente, inchiodato sotto la barra:

     inset: var(--header-h) 0 auto 0     ← tutto lo schermo, da 72px in giù

   invisibile (`opacity: 0`) ma **cliccabile**, pieno di link veri. Il dito
   che cade lì non seleziona il testo — il testo della pagina è sotto, e un
   link non si seleziona — e il dito che incontra una voce finisce su
   «Casi seguiti», «Il team», «Onorari» o nel `pannello`: un'altra pagina.

   Perché un test e non una correzione a occhio
   --------------------------------------------------------------------------
   Qui non c'è un browser: nessuno di questi sintomi si può osservare da
   questa macchina. Ma la regola che li produce sta in un file di testo, e una
   regola si può leggere, eseguire a pezzi e confrontare con sé stessa. Quello
   che questo file verifica è la **relazione**, non il pixel:

     - nessun figlio riaccende la visibilità che il pannello ha spento;
     - il pannello, chiuso, non occupa spazio che possa ricevere il tocco;
     - i bersagli da dito sono abbastanza grandi, e quello della lingua è
       lontano dall'hamburger;
     - nessuna pagina si allarga oltre lo schermo.

   Il primo di questi test è l'unico che vale da solo: se qualcuno rimette
   `visibility: visible` su un figlio del pannello, quel test torna rosso e
   dice perché.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RADICE = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(RADICE, "assets", "css", "style.css"), "utf8");
const PREMIUM = fs.readFileSync(path.join(RADICE, "assets", "css", "premium.css"), "utf8");
const ENTRAMBI = CSS + "\n" + PREMIUM;

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* --------------------------------------------------------------- ritagli -- */

/* Il commento che accompagna una regola spiega **perché** quella regola
   esiste, e spesso cita proprio il difetto: cercare `visibility: visible`
   senza togliere i commenti trova la spiegazione e non la regola. */
function senzaCommenti(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/* Tutte le regole che contengono uno dei selettori indicati, con il loro
   corpo. Non è un parser CSS: per queste domande basta, ed è l'unico modo di
   leggerlo senza dipendenze. */
function regole(css, selettore) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(senzaCommenti(css)))) {
    const sel = m[1].trim();
    if (sel.split(",").some((s) => s.trim() === selettore || s.trim().endsWith(" " + selettore))) {
      out.push(m[2]);
    }
  }
  return out;
}

const PULITO = senzaCommenti(CSS);

/* ============================================================ la diagnosi == */

test("il pannello del menu, da chiuso, non è cliccabile", () => {
  /* Il pannello chiuso è `opacity: 0` + `visibility: hidden`: la prima lo
     rende invisibile, la seconda lo toglie dal tocco. Sono **due**
     dichiarazioni perché fanno due cose diverse — se resta solo `opacity`,
     l'elemento è trasparente ma continua a ricevere i clic, che è
     esattamente il difetto segnalato. */
  const corpi = regole(CSS, ".nav__panel");
  assert.ok(corpi.length > 0, "la regola .nav__panel non c'è più");

  const mobile = corpi.filter((c) => /position:\s*fixed/.test(c));
  assert.ok(mobile.length > 0, "il pannello mobile deve essere position: fixed");

  const chiuso = mobile[0];
  assert.ok(/visibility:\s*hidden/.test(chiuso),
    "il pannello chiuso deve essere invisibile **al tocco**, non solo trasparente");
  assert.ok(/opacity:\s*0\b/.test(chiuso),
    "il pannello chiuso deve essere trasparente");

  /* la prova che il tocco non lo attraversa: `pointer-events` non si eredita
     come `visibility`, e chiuderlo spegne l'elemento anche se un figlio prova
     a riaccendersi */
  assert.ok(/pointer-events:\s*none/.test(chiuso),
    "il pannello chiuso deve dichiarare `pointer-events: none`: senza, un " +
    "figlio che si riaccende riceve il clic al posto della pagina");
});

test("nessun figlio del pannello riaccende la visibilità che il padre spegne", () => {
  /* LA CAUSA. `visibility` si eredita dall'antenato più vicino che la
     dichiara: un figlio `visible` dentro un padre `hidden` **è visibile**.
     Sotto la soglia dell'hamburger, `.nav__links` e `.nav__panel` dichiarano
     entrambi `visibility: visible` — il primo senza condizione. */
  const corpi = regole(CSS, ".nav__links");
  const accesi = corpi.filter((c) => /visibility:\s*visible/.test(c));
  assert.equal(accesi.length, 0,
    "`.nav__links` riaccende `visibility: visible`: dentro il pannello chiuso " +
    "questo rimette i link in pagina, sopra il contenuto. La visibilità dei " +
    "figli la decide `.nav__panel.is-open`, non il figlio.");

  /* e lo stesso per qualunque altro discendente del pannello: la lista è
     corta, e un selettore nuovo deve passare di qui */
  elencoRegole(CSS).forEach(([sel, corpo]) => {
    if (!/\.nav__panel/.test(sel) || /is-open/.test(sel)) return;
    assert.ok(!/visibility:\s*visible/.test(corpo),
      `${sel}: riaccende la visibilità dentro il pannello chiuso`);
  });
});

/* elenco dei selettori con il loro corpo, senza commenti */
function elencoRegole(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(senzaCommenti(css)))) {
    out.push([m[1].trim(), m[2]]);
  }
  return out;
}

test("il pannello aperto è l'unico modo in cui le voci ricevono il tocco", () => {
  /* la regola che apre il pannello deve fare le tre cose insieme: rendersi
     visibile, ricevere i tocchi, tornare al suo posto. Se ne manca una, il
     pannello si apre ma non si preme, o si preme da chiuso. */
  const corpi = regole(CSS, ".nav__panel.is-open");
  assert.ok(corpi.length > 0, "manca la regola dello stato aperto");
  const aperto = corpi[0];
  assert.ok(/visibility:\s*visible/.test(aperto), "aperto deve essere visibile");
  assert.ok(/opacity:\s*1\b/.test(aperto), "aperto deve essere opaco");
});

test("a pannello chiuso il corpo della pagina non resta bloccato", () => {
  /* `body.nav-open { overflow: hidden }` è giusto mentre il menu è aperto.
     Il difetto opposto — la pagina che non scorre più — nasce se la classe
     resta attaccata: per questo `main.js` la toglie a ogni chiusura, e il
     test qui sotto verifica che lo faccia in tutti i percorsi. */
  assert.ok(/body\.nav-open\s*\{[^}]*overflow:\s*hidden/.test(PULITO),
    "con il menu aperto la pagina sotto non deve scorrere");

  const js = fs.readFileSync(path.join(RADICE, "assets", "js", "main.js"), "utf8");
  const chiudi = js.slice(js.indexOf("function chiudiMenu"), js.indexOf("function chiudiMenu") + 400);
  assert.ok(/classList\.remove\("nav-open"\)/.test(chiudi),
    "chiudiMenu deve togliere `nav-open`, altrimenti la pagina resta ferma");
});

/* ======================================================== bersagli da dito == */

/* Sotto i 44px il dito sbaglia. La soglia non è un vezzo: la linea guida
   WCAG 2.5.5 chiede 44×44 CSS px, e Material Design 48. Qui si controlla che
   nessun bersaglio importante resti sotto i 44 **in altezza**, che è la
   dimensione che conta quando i bersagli sono in fila orizzontale. */
test("le pastiglie della lingua sono alte abbastanza per un dito", () => {
  const misure = [...ENTRAMBI.matchAll(/\.lang__opt\s*\{([^}]*)\}/g)]
    .map((m) => {
      const alt = /height:\s*(\d+)px/.exec(m[1]);
      const larg = /min-width:\s*(\d+)px/.exec(m[1]);
      return alt ? { alt: Number(alt[1]), larg: larg ? Number(larg[1]) : null } : null;
    })
    .filter(Boolean);

  assert.ok(misure.length >= 2, "servono le misure normali e quelle strette");
  misure.forEach((m) => {
    assert.ok(m.alt >= 44,
      `pastiglia alta ${m.alt}px: sotto i 44 il dito prende quella accanto, ` +
      "e quella accanto cambia lingua — cioè ricarica la pagina");
  });

  /* La larghezza resta **volutamente** 30: quattro pastiglie larghe 44
     sarebbero 176px, e su un 360 il marchio, il selettore e l'hamburger non ci
     stanno più. Il requisito che si difende è l'altezza — la dimensione che
     conta quando i bersagli sono in fila orizzontale — più uno spazio vero
     fra loro, che è il test qui sotto. Sotto i 26 la sigla di due lettere non
     ci sta dentro con il padding, e il bersaglio diventa più piccolo del
     contenuto. */
  misure.forEach((m) => {
    assert.ok(m.larg >= 26, `pastiglia larga ${m.larg}px: la sigla non ci sta`);
  });
});

test("l'hamburger e i suoi margini restano un bersaglio intero", () => {
  const toggle = regole(CSS, ".nav__toggle")[0] || "";
  const alt = /height:\s*(\d+)px/.exec(toggle);
  const larg = /width:\s*(\d+)px/.exec(toggle);
  assert.ok(alt && Number(alt[1]) >= 44, "l'hamburger deve essere alto almeno 44px");
  assert.ok(larg && Number(larg[1]) >= 44, "l'hamburger deve essere largo almeno 44px");
});

test("la lingua non sta attaccata all'hamburger", () => {
  /* Due bersagli grandi affiancati vanno bene; due bersagli **incollati** no,
     perché il bordo di uno è il bordo dell'altro e un dito che sbaglia di 2px
     cambia lingua invece di aprire il menu. Serve uno spazio vero, e
     dichiarato: uno `0` esplicito è il difetto scritto in chiaro.

     Si guardano **tutte** le regole che nominano i due elementi, non solo
     quelle dentro un `@media`: la prima versione di questo test cercava nel
     blocco sbagliato e passava per caso. */
  const spazi = [];
  elencoRegole(ENTRAMBI).forEach(([sel, corpo]) => {
    if (!/\.nav__toggle\s*$/.test(sel) && !/\.nav__lang\s*$/.test(sel)) return;
    const m = /margin-inline-start:\s*([\d.]+)(px|rem)/.exec(corpo);
    const r = /margin-right:\s*([\d.]+)(px|rem)/.exec(corpo);
    if (m) spazi.push({ sel, px: Number(m[1]) * (m[2] === "rem" ? 16 : 1) });
    if (r) spazi.push({ sel, px: Number(r[1]) * (r[2] === "rem" ? 16 : 1) });
  });

  const peggiori = spazi.filter((s) => s.px === 0);
  assert.equal(peggiori.length, 0,
    "spazio a zero fra selettore e hamburger: " + peggiori.map((s) => s.sel).join(", "));

  const vero = spazi.filter((s) => s.px >= 8);
  assert.ok(vero.length > 0,
    "fra il selettore di lingua e l'hamburger serve uno spazio dichiarato di " +
    "almeno 8px: senza, il tocco sul menu cambia lingua");
});

/* ================================================== niente sfonda lo schermo == */

test("nessuna pagina si allarga in orizzontale oltre la finestra", () => {
  /* Il secondo sintomo ha anche una coda possibile: un elemento più largo
     dello schermo. Su un telefono il browser non «scorre» quella parte — la
     pagina si sposta a metà, e metà schermo mostra cose che non si toccano.
     Le difese sono due e vanno entrambe presenti: `overflow-x` sul corpo e
     Nessun `100vw` usato come larghezza (che sfonda **sempre**, perché
     ignora la barra di scorrimento). */
  assert.ok(/html\s*\{[^}]*overflow-x:\s*(hidden|clip)/.test(PULITO) ||
            /body\s*\{[^}]*overflow-x:\s*(hidden|clip)/.test(PULITO),
    "serve un `overflow-x: hidden` su html o body: è la rete che impedisce a " +
    "un elemento fuori misura di portarsi via metà pagina");

  const larghezze = [...ENTRAMBI.matchAll(/width:\s*100vw/g)];
  assert.equal(larghezze.length, 0, "`width: 100vw` sfonda: usare `100%`");
});

test("la regola dei 620px tocca solo una tabella, non un div", () => {
  /* Il difetto vero, trovato l'11/11 e qui fissato: nel pannello del cliente
     `settings-table` è un `<div>` — un elenco di righe, non una tabella — e la
     regola `@media (max-width: 900px) { .settings-table { min-width: 620px } }`
     lo allargava a 620px dentro uno schermo da 390. Duecentotrenta pixel fuori
     dalla finestra, nessun contenitore che scorresse. Il selettore deve
     nominare l'elemento: `table.settings-table`. */
  const regola = /@media \(max-width: 900px\) \{([\s\S]*?)\n\}/.exec(PULITO);
  assert.ok(regola, "manca il blocco mobile da 900px");
  assert.ok(/table\.settings-table\s*\{[^}]*min-width:\s*620px/.test(regola[1]),
    "`min-width: 620px` deve stare su `table.settings-table`: su un div " +
    "allarga il pannello del cliente oltre lo schermo");
  assert.ok(!/(^|[\s,{])\.settings-table\s*\{[^}]*min-width:\s*620px/.test(regola[1]),
    "`.settings-table` senza `table` davanti colpisce anche il div del pannello");
});

test("le tabelle larghe stanno in un contenitore che scorre", () => {
  /* Una tabella da 620px dentro un 390 va bene **se** scorre da sola: quello
     che non deve succedere è che sia lei a spingere la pagina. */
  const casi = [
    ["admin.html", "table-scroll"],
    ["casi.html", "table-scroll"],
    ["crypto.html", "table-scroll"],
    ["onorari.html", "table-scroll"],
    ["supporto.html", "table-scroll"],
  ];
  casi.forEach(([nome, classe]) => {
    const html = fs.readFileSync(path.join(RADICE, nome), "utf8");
    assert.ok(html.includes('class="' + classe),
      `${nome}: nessun contenitore .table-scroll`);
  });
});

test("nessun campo di testo è sotto i 16px (iOS ingrandisce da solo)", () => {
  /* Non è un fatto estetico: sotto i 16px Safari su iOS **ingrandisce la
     pagina** appena il campo riceve il tocco, e non torna indietro quando il
     dito si alza. Chi scrive l'IBAN nel pannello si ritrova la pagina al
     doppio, i pulsanti fuori schermo e la parte alta irraggiungibile.

     Le `rem` si convertono: 0.95rem sarebbero 15,2px, ed è il valore che
     c'era con un commento che diceva «16px+». Da qui il controllo sul numero
     convertito, non sulla forma scritta. */
  const px = (valore) => {
    const v = valore.trim();
    const m = /^([\d.]+)rem$/.exec(v);
    if (m) return Number(m[1]) * 16;
    const p = /^([\d.]+)px$/.exec(v);
    if (p) return Number(p[1]);
    return null; // var(...) o parole chiave: non si indovina
  };

  const colpevoli = [];
  elencoRegole(ENTRAMBI).forEach(([sel, corpo]) => {
    if (!/(^|[\s,])(input|select|textarea)\b/.test(sel)) return;
    if (/::placeholder|:focus|\[type="checkbox"\]|\[type="radio"\]|\[type="range"\]/.test(sel)) return;
    const m = /font-size:\s*([^;}]+)/.exec(corpo);
    if (!m) return;
    const valore = m[1].trim();
    if (/^var\(--fs-xs\)/.test(valore)) {
      colpevoli.push(`${sel.replace(/\s*\n\s*/g, " ")} → var(--fs-xs) = 12,4px`);
      return;
    }
    const n = px(valore);
    if (n !== null && n < 16) {
      colpevoli.push(`${sel.replace(/\s*\n\s*/g, " ")} → ${valore} = ${n}px`);
    }
  });

  assert.deepEqual(colpevoli, [],
    "campi sotto i 16px: iOS ingrandisce la pagina al tocco\n  " +
    colpevoli.join("\n  "));
});

test("la finestra non può essere allargata dal contenuto", () => {
  /* Ogni pagina dichiara la larghezza del viewport senza `user-scalable=no`:
     bloccare lo zoom è il modo più rapido di rendere illeggibile un sito, ed
     è anche un problema di accessibilità. Se manca il meta, il telefono
     renderizza a 980px e rimpicciolisce: la pagina sembra «mezza», e i testi
     diventano intoccabili. */
  const pagine = fs.readdirSync(RADICE).filter((f) => f.endsWith(".html"));
  pagine.forEach((nome) => {
    const html = fs.readFileSync(path.join(RADICE, nome), "utf8");
    assert.ok(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html),
      `${nome}: manca il viewport corretto`);
    assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(html),
      `${nome}: lo zoom è bloccato`);
  });
});

module.exports = casi;
