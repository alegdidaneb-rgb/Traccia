/* ==========================================================================
   La pagina del team
   ==========================================================================
   Tre cose possono rompersi qui, e tutte e tre in silenzio:

   1. **La pagina e i dati si separano.** `team.html` è generata da
      `assets/js/team.js`, ma il file generato è nel repository: se qualcuno
      modifica i dati e non ri-genera, la pagina continua a mostrare la
      versione di ieri senza un errore da nessuna parte. `--check` esiste per
      questo, e questo test lo esegue.

   2. **Un profilo resta senza fotografia e nessuno se ne accorge.** Le
      iniziali sono una riserva onesta, non un errore: ma in una pagina che si
      chiama «persone», nove riquadri con le lettere sono un lavoro a metà. Qui
      si tiene l'elenco di chi ha una foto e di chi no, così quando arrivano si
      sa cosa manca.

   3. **Una voce di menu porta a una pagina che non c'è.** Il menu è generato da
      `partials/` su quattordici pagine: un link sbagliato è sbagliato quattordici
      volte.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const ROOT = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const TEAM = R("team.html");
const DATI = R("assets/js/team.js");

/* i dati, letti come li legge il browser */
function persone() {
  const script =
    "global.window = {};" +
    "global.document = { readyState: 'complete'," +
    " querySelectorAll: function () { return []; }," +
    " addEventListener: function () {} };" +
    "require(" + JSON.stringify(path.join(ROOT, "assets/js/team.js")) + ");" +
    "process.stdout.write(JSON.stringify(global.window.TRACCIA_TEAM));";
  return JSON.parse(execFileSync("node", ["-e", script], { encoding: "utf8" }));
}

/* ------------------------------------------------------------ coerenza -- */
test("team: la pagina è allineata ai dati", () => {
  /* se questo fallisce, la pagina mostra una versione vecchia del team */
  let esito = null;
  try {
    esito = execFileSync("python3", ["tools/build_team.py", "--check"],
      { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    assert.fail("team.html non è allineata a assets/js/team.js: " +
      String(e.stdout || e.message).trim());
  }
  assert.ok(/allineata/.test(esito), "esito inatteso: " + esito);
});

test("team: ogni persona dei dati ha il suo profilo nella pagina", () => {
  const elenco = persone();
  assert.ok(elenco.length >= 9, "il team ha " + elenco.length + " persone, ne attendevo 9");
  elenco.forEach(function (p) {
    assert.ok(TEAM.indexOf('id="' + p.id + '"') > -1,
      "manca il profilo di " + p.nome + " (#" + p.id + ")");
    assert.ok(TEAM.indexOf(p.nome) > -1, "manca il nome " + p.nome);
    assert.ok(TEAM.indexOf(p.ruolo) > -1, "manca il ruolo di " + p.nome);
  });
});

test("team: ogni profilo ha ruolo, anni, aree e bio", () => {
  const elenco = persone();
  elenco.forEach(function (p) {
    assert.ok(p.nome && p.nome.length > 3, "nome mancante o troppo corto: " + p.id);
    assert.ok(p.ruolo && p.ruolo.length > 3, p.nome + " non ha un ruolo");
    assert.ok(p.bio && p.bio.length > 80,
      "la bio di " + p.nome + " è troppo corta per dire qualcosa (" +
        (p.bio || "").length + " caratteri)");
    assert.ok(Array.isArray(p.aree) && p.aree.length >= 2,
      p.nome + " non ha almeno due aree di lavoro");
    assert.ok(Number(p.dal) >= 2000 && Number(p.dal) <= 2026,
      p.nome + " ha un anno di ingresso implausibile: " + p.dal);
    assert.ok(Array.isArray(p.lingue) && p.lingue.length >= 1,
      p.nome + " non dichiara lingue di lavoro");
    assert.ok(Array.isArray(p.strumenti) && p.strumenti.length >= 1,
      p.nome + " non dichiara strumenti");
    assert.ok(Array.isArray(p.metodo) && p.metodo.length >= 2,
      p.nome + " non dichiara come lavora (campo `metodo`)");
    assert.ok(/^[A-Z]{2}$/.test(p.iniziali),
      p.nome + " ha iniziali non valide: " + p.iniziali);
  });
});

test("team: c'è un revisore indipendente, ed è uno solo", () => {
  const revisori = persone().filter((p) => p.revisione);
  assert.strictEqual(revisori.length, 1,
    "il revisore indipendente deve essere una persona, non un comitato: " +
      revisori.map((p) => p.nome).join(", "));
  assert.ok(/revisore/i.test(revisori[0].revisione),
    "il ruolo di controllo non dice «revisore»: " + revisori[0].revisione);
});

/* ------------------------------------------------------------- foto -- */
test("team: chi ha una foto ha tutti e quattro i file", () => {
  const cartella = path.join(ROOT, "assets/img/team");
  persone().forEach(function (p) {
    if (!p.foto) return;
    ["480.jpg", "480.webp", "960.jpg", "960.webp"].forEach(function (suffisso) {
      const f = path.join(cartella, p.foto + "-" + suffisso);
      assert.ok(fs.existsSync(f), "manca " + path.relative(ROOT, f) + " (" + p.nome + ")");
      assert.ok(fs.statSync(f).size > 4000,
        path.relative(ROOT, f) + " pesa meno di 4 KB: sarà un errore di conversione");
    });
  });
});

test("team: la pagina mostra il ritratto con le dimensioni dichiarate", () => {
  /* `width` e `height` sull'img non sono decorazione: senza, il browser non
     riserva lo spazio e la pagina salta quando le foto arrivano */
  const conFoto = persone().filter((p) => p.foto);
  if (!conFoto.length) return; /* nessuna foto caricata: la riserva è le iniziali */
  conFoto.forEach(function (p) {
    assert.ok(TEAM.indexOf("team/" + p.foto + "-480.jpg") > -1,
      "la pagina non usa la foto di " + p.nome);
  });
  assert.ok(/profilo__ritratto[^>]*>/.test(TEAM), "manca il contenitore del ritratto");
  assert.ok(/width="480" height="480"/.test(TEAM),
    "le immagini dei ritratti devono dichiarare larghezza e altezza");
});

test("team: senza foto la scheda mostra le iniziali, non un riquadro rotto", () => {
  const senza = persone().filter((p) => !p.foto);
  const quante = (TEAM.match(/profilo__ritratto--iniziali/g) || []).length;
  assert.strictEqual(quante, senza.length,
    "profili senza foto: " + senza.length + ", riquadri con le iniziali: " + quante);
});

/* ------------------------------------------------------- raggiungibilità -- */
test("team: la pagina è nel menu, nel footer e nella sitemap", () => {
  const header = R("partials/header.html");
  const footer = R("partials/footer.html");
  assert.ok(R("tools/build_shell.py").indexOf('"team.html"') > -1,
    "team.html non è fra le pagine del menu");
  assert.ok(footer.indexOf("team.html") > -1, "il footer non linka il team");
  assert.ok(R("sitemap.xml").indexOf("/team") > -1, "manca /team nella sitemap");
  assert.ok(/nav-link is-active[^>]*data-nav="team"/.test(TEAM),
    "la voce «Il team» non risulta attiva sulla sua pagina");
  assert.ok(header.length > 100);
});

test("team: la pagina ha testata, piè di pagina e metadati sociali", () => {
  assert.ok(TEAM.indexOf("site-header") > -1, "manca la testata");
  assert.ok(TEAM.indexOf("site-footer") > -1, "manca il piè di pagina");
  assert.ok(/<title>[^<]*team/i.test(TEAM), "il titolo non nomina il team");
  assert.ok(/rel="canonical" href="https:\/\/traccia.it.com\/team.html"/.test(TEAM),
    "manca il canonical");
  assert.ok(/og:title/.test(TEAM), "mancano i metadati Open Graph");
  assert.ok(/assets\/(?:[0-9a-f]{8}\/)?js\/team\.js/.test(TEAM), "la pagina non carica i dati del team");
});

test("team: i dati sono nel file, non scritti a mano nell'HTML", () => {
  /* se qualcuno rimette a mano un profilo dentro i marcatori, la prossima
     generazione lo cancella: meglio accorgersene qui che in produzione */
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:profili -->"),
                            TEAM.indexOf("<!-- /team:profili -->"));
  const nomi = persone().map((p) => p.nome);
  const fuori = nomi.filter((n) => dentro.indexOf(n) === -1);
  assert.deepStrictEqual(fuori, [], "profili generati mancanti: " + fuori.join(", "));
});

test("team: il profilo dice come lavora, non cosa ha «ottenuto»", () => {
  /* Fino alla revisione precedente ogni profilo aveva un campo `risultati`
     con tre aneddoti numerati del tipo «ha bloccato sette consegne». Su
     persone inventate quei numeri fingevano una referenza. Questo test tiene
     fuori il registro da traguardo: niente campi `risultati`, e `metodo` che
     parla al presente e non racconta un episodio. */
  persone().forEach(function (p) {
    assert.ok(!p.risultati,
      p.nome + " ha ancora il campo `risultati`: gli aneddoti numerati vanno " +
      "nel campo `metodo`, come criterio, non come traguardo");
    p.metodo.forEach(function (m) {
      assert.ok(!/^ha (firmato|bloccato|ridotto|ottenuto|costruito|ricostruito|trovato|scritto|dimostrato|portato|ricomposto|riscritto|gestito|impostato|reso)/i.test(m),
        p.nome + ": il criterio è un racconto al passato («" + m.slice(0, 40) +
        "…»). Il metodo si enuncia al presente.");
      assert.ok(!/\b\d{2,}\b/.test(m),
        p.nome + ": c'è un numero in un criterio di metodo («" + m.slice(0, 60) +
        "…»). I numeri inventati sono la cosa che questa pagina non deve fare.");
    });
  });
});

test("team: le credenziali stanno in evidenza, non in fondo", () => {
  /* Sono la prima cosa verificabile che un cliente cerca. La posizione nel
     DOM è la prova che sono state spostate davvero e non solo colorate. */
  const primo = TEAM.slice(TEAM.indexOf('<article class="profilo"'),
                           TEAM.indexOf("</article>", TEAM.indexOf('<article class="profilo"')));
  const iCred = primo.indexOf("profilo__credenziali");
  const iMetodo = primo.indexOf("profilo__metodo");
  const iPercorso = primo.indexOf("profilo__percorso");
  assert.ok(iCred > -1, "il primo profilo non mostra credenziali");
  assert.ok(iCred < iMetodo, "le credenziali vengono dopo il metodo");
  assert.ok(iCred < iPercorso, "le credenziali vengono dopo il percorso");
});

test("tessere: ogni tessera porta al profilo che apre", () => {
  /* Le tessere non sono una seconda presentazione delle stesse persone: sono
     l'indice della pagina. Se un link non punta a un id esistente, l'indice
     è rotto in silenzio. */
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  const ancore = (dentro.match(/href="#([a-z-]+)"/g) || []).map(function (h) {
    return h.slice(7, -1);
  });
  assert.strictEqual(ancore.length, persone().length,
    "link nell'indice: " + ancore.length + ", persone: " + persone().length);
  ancore.forEach(function (a) {
    assert.ok(TEAM.indexOf('id="' + a + '"') > -1,
      "la tessera punta a #" + a + " ma nessun profilo ha quell'id");
  });
});

test("team: la pagina non ripete lo stesso blocco due volte", () => {
  /* Il difetto da cui viene questa revisione: una sezione di tessere con le
     stesse nove persone e poi nove schede che le ripetevano. Due elenchi
     lunghi uguali, e il lettore scorre due volte la stessa cosa. */
  const quanteSezioniTessere =
    (TEAM.match(/<section[^>]*section--tessere/g) || []).length;
  assert.strictEqual(quanteSezioniTessere, 1,
    "sezioni di tessere nella pagina: " + quanteSezioniTessere + ", ne va una");
});

/* ------------------------------------------------------------ tessere -- */
test("tessere: la sezione è allineata ai dati", () => {
  /* `build_team.py --check` controlla profili *e* tessere: un comando solo
     perché chi aggiunge una persona non deve ricordarsi di due script. Se
     questo test diventa rosso, la tessera mostra il ruolo di ieri. */
  let esito = null;
  try {
    esito = execFileSync("python3", ["tools/build_team.py", "--check"],
      { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    assert.fail("la pagina non è allineata a assets/js/team.js: " +
      String(e.stdout || e.message).trim());
  }
  assert.ok(/tessere allineate/.test(esito), "le tessere non sono controllate: " + esito);
});

test("tessere: una per persona, con il nome e il ruolo giusti", () => {
  const elenco = persone();
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  assert.ok(dentro.length > 1000, "la sezione delle tessere è vuota");
  const quante = (dentro.match(/class="tessera"/g) || []).length;
  assert.strictEqual(quante, elenco.length,
    "persone nei dati: " + elenco.length + ", tessere in pagina: " + quante);
  elenco.forEach(function (p) {
    assert.ok(dentro.indexOf('data-persona="' + p.id + '"') > -1,
      "manca la tessera di " + p.nome);
    assert.ok(dentro.indexOf(p.nome) > -1, "manca il nome " + p.nome + " su una tessera");
    assert.ok(dentro.indexOf(p.ruolo) > -1, "manca il ruolo di " + p.nome);
  });
});

test("tessere: il numero interno è progressivo per anno di ingresso", () => {
  /* `TRC-2019-01`, `TRC-2019-02`, … Il progressivo si azzera ogni anno: il
     numero racconta da quanto uno è in ufficio, non quante persone ci sono
     state in tutto. Un contatore globale direbbe la seconda cosa. */
  const elenco = persone();
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  const numeri = (dentro.match(/TRC-\d{4}-\d{2}/g) || []);
  assert.strictEqual(numeri.length, elenco.length,
    "numeri interni: " + numeri.length + ", persone: " + elenco.length);
  assert.strictEqual(new Set(numeri).size, numeri.length,
    "due tessere hanno lo stesso numero interno");

  /* il conteggio per anno deve combaciare con i dati */
  const attesi = {};
  elenco.forEach(function (p) {
    attesi["TRC-" + p.dal] = (attesi["TRC-" + p.dal] || 0) + 1;
  });
  Object.keys(attesi).forEach(function (prefisso) {
    for (let i = 1; i <= attesi[prefisso]; i++) {
      const n = prefisso + "-" + String(i).padStart(2, "0");
      assert.ok(numeri.indexOf(n) > -1, "manca il numero interno " + n);
    }
  });
});

test("tessere: sono in ordine di arrivo in ufficio", () => {
  /* I numeri crescono da sinistra a destra: la sezione si legge come una scala
     di anzianità. Il primo giro le metteva nell'ordine dell'array dei dati, e
     la tessera del 2023 finiva prima di quella del 2022. */
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  const anni = (dentro.match(/TRC-(\d{4})-\d{2}/g) || []).map(function (n) {
    return Number(n.slice(4, 8));
  });
  const ordinati = anni.slice().sort(function (a, b) { return a - b; });
  assert.deepStrictEqual(anni, ordinati,
    "le tessere non sono in ordine di anno: " + anni.join(", "));
});

test("tessere: ognuna dichiara di non essere un documento di identità", () => {
  /* Questo è il test che conta più degli altri. Se un giorno qualcuno toglie
     l'avvertenza per «pulire» il disegno, queste immagini diventano, alla
     vista, dei documenti: e sono persone inventate. Meglio un test rosso. */
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  const tessere = (dentro.match(/class="tessera"/g) || []).length;
  const avvisi = (dentro.match(/non è un documento di identità/g) || []).length;
  assert.strictEqual(avvisi, tessere,
    "tessere: " + tessere + ", avvertenze «non è un documento di identità»: " +
      avvisi + " — ne mancano " + (tessere - avvisi));
});

test("tessere: nessun elemento da documento d'identità", () => {
  /* La differenza fra un badge e una carta d'identità non è il tono: sono i
     campi. Qui si verifica che non ne sia entrato nessuno per distrazione. */
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  const vietati = [
    [/codice fiscale/i, "codice fiscale"],
    [/data di nascita/i, "data di nascita"],
    [/luogo di nascita/i, "luogo di nascita"],
    [/carta d'identità/i, "carta d'identità"],
    [/carta di identità/i, "carta di identità"],
    [/repubblica italiana/i, "emblema della Repubblica"],
    [/MRZ|<<<</, "codice a lettura ottica"],
    [/\bCIE\b/, "sigla CIE"],
    [/\bchip\b/i, "chip"],
  ];
  vietati.forEach(function (v) {
    assert.ok(!v[0].test(dentro),
      "la sezione delle tessere contiene «" + v[1] + "»: non è una tessera, " +
      "è un documento");
  });
});

test("tessere: ognuna ha il ritratto della persona, non un segnaposto", () => {
  const dentro = TEAM.slice(TEAM.indexOf("<!-- team:tessere -->"),
                            TEAM.indexOf("<!-- /team:tessere -->"));
  persone().forEach(function (p) {
    if (!p.foto) return;
    assert.ok(dentro.indexOf("team/" + p.foto + "-480.jpg") > -1,
      "la tessera di " + p.nome + " non usa il ritratto");
  });
  const immagini = (dentro.match(/<img [^>]*width="480" height="480"/g) || []).length;
  const conFoto = persone().filter((p) => p.foto).length;
  assert.strictEqual(immagini, conFoto,
    "ritratti con dimensioni dichiarate: " + immagini + " su " + conFoto);
});

module.exports = casi;
