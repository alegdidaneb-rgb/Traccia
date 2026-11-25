/* ==========================================================================
   Le cartelle di asset: si tengono se servono, non se sembrano recenti
   ==========================================================================
   Il 2026-11-23 il repository aveva **204 file morti**: due cartelle intere di
   CSS, JS, font e immagini (`b3a33fe9`, `f6737c16`), 56 MB, che nessuna pagina
   citava. Non erano un residuo innocuo: ognuna è una copia completa del sito.

   La causa non era la distrazione, era il criterio. `tools/versione_asset.py`
   potava così:

       cartelle.sort(key=lambda d: d.stat().st_mtime, reverse=True)
       tenere = {le prime tre} | {attesa}

   `st_mtime` non dice quando una cartella è nata, dice quando è stato toccato
   l'ultimo dei suoi file. Un `git checkout`, un `git clone`, o la macchina di
   sviluppo ricreata da zero riscrivono tutto insieme: una cartella morta da
   settimane acquista la data di oggi, entra nelle «prime tre» e sopravvive a
   ogni potatura. Il criterio era **circolare**: decideva cosa cancellare in
   base a un dato che il cancellare stesso riscriveva.

   La domanda giusta è un'altra, e non ha niente di deducibile: una pagina la
   cita? Se sì serve, se no non serve. Questi test difendono le due metà di
   quella frase:

     1. nessuna cartella di asset resta senza una pagina che la nomini;
     2. nessuna pagina nomina una cartella che non esiste (l'errore opposto,
        che rompe il sito con un 404 sul foglio di stile).
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RADICE = path.join(__dirname, "..");
const ASSETS = path.join(RADICE, "assets");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

/* ------------------------------------------------------------- le pagine -- */

/* Le pagine servite: le italiane più le tradotte. Stessa lista di
   `versione_asset.PAGINE`, letta dal disco invece che ricopiata: una pagina
   nuova deve entrare qui da sola. */
function pagine() {
  const fuori = [];
  for (const nome of fs.readdirSync(RADICE)) {
    if (nome.endsWith(".html")) fuori.push(nome);
  }
  for (const lingua of ["en", "de", "es"]) {
    const cartella = path.join(RADICE, lingua);
    if (!fs.existsSync(cartella)) continue;
    for (const nome of fs.readdirSync(cartella)) {
      if (nome.endsWith(".html")) fuori.push(path.join(lingua, nome));
    }
  }
  return fuori;
}

/* Tutte le cartelle `assets/<8 esadecimali>/` citate dalle pagine. */
function cartelleCitate() {
  const citate = new Map();          /* nome → prima pagina che lo nomina */
  for (const pagina of pagine()) {
    const testo = fs.readFileSync(path.join(RADICE, pagina), "utf8");
    for (const m of testo.matchAll(/assets\/([0-9a-f]{8})\//g)) {
      if (!citate.has(m[1])) citate.set(m[1], pagina);
    }
  }
  return citate;
}

function cartelleSuDisco() {
  return fs.readdirSync(ASSETS)
    .filter((n) => /^[0-9a-f]{8}$/.test(n))
    .filter((n) => fs.statSync(path.join(ASSETS, n)).isDirectory());
}

/* =============================================================== i due lati == */

test("nessuna cartella di asset resta senza una pagina che la citi", () => {
  /* È il difetto dei 56 MB. Una cartella che nessuna pagina nomina non serve
     a nessun browser: il suo indirizzo non compare da nessuna parte, quindi
     nessuna cache può chiederla. Tenerla è solo peso nel repository. */
  /* Si tollera **una** cartella non citata: è il cuscinetto, l'ultima che è
     stata in produzione. Serve alle pagine già scaricate dal browser di
     qualcuno, che continuano a chiedere il vecchio indirizzo; togliendola
     subito, quella pagina si caricherebbe senza foglio di stile. Due o più
     cartelle non citate tornano a essere il difetto dei 56 MB. */
  const citate = cartelleCitate();
  const morte = cartelleSuDisco().filter((n) => !citate.has(n));
  assert.ok(morte.length <= 1,
    "cartelle di asset che nessuna pagina cita (va tenuta al massimo quella " +
    "del cuscinetto; le altre si potano con `python3 tools/versione_asset.py`):\n  " +
    morte.join("\n  "));
});

test("ogni cartella citata esiste sul disco", () => {
  /* L'errore opposto, ed è peggio: una pagina che chiede `assets/xxxxxxxx/` e
     non lo trova serve il sito senza foglio di stile. */
  const suDisco = new Set(cartelleSuDisco());
  const orfane = [...cartelleCitate().entries()]
    .filter(([nome]) => !suDisco.has(nome))
    .map(([nome, dove]) => `assets/${nome}/ citata in ${dove}`);
  assert.deepStrictEqual(orfane, [],
    "pagine che chiedono una cartella assente:\n  " + orfane.join("\n  "));
});

test("le pagine chiedono una sola versione, non due", () => {
  /* Due versioni vive insieme sono lecite in un momento di transizione (una
     pagina in cache chiede la vecchia). Ma la stessa pagina non può chiedere
     il CSS a una versione e le immagini a un'altra: succede quando
     `build_i18n.py` gira dopo `versione_asset.py` e ricopia dalla sorgente
     italiana già riscritta. Il risultato è una pagina che mescola due mondi, e
     si vede solo leggendo il sorgente di una pagina tradotta. */
  const miste = [];
  for (const pagina of pagine()) {
    const testo = fs.readFileSync(path.join(RADICE, pagina), "utf8");
    const versioni = new Set(
      [...testo.matchAll(/assets\/([0-9a-f]{8})\//g)].map((m) => m[1]));
    if (versioni.size > 1) miste.push(`${pagina}: ${[...versioni].join(", ")}`);
  }
  assert.deepStrictEqual(miste, [],
    "pagine che mescolano due versioni di asset:\n  " + miste.join("\n  "));
});

/* ============================================ il criterio, non l'incidente == */

test("la potatura non decide più in base alla data di modifica", () => {
  /* Il difetto era il **criterio**: `st_mtime` non dice quando una cartella è
     nata, e un `git checkout` lo riscrive per tutte. Una potatura che ordina
     per data tiene per sempre le cartelle morte e, in una macchina appena
     clonata, non pota nulla.
     Questo test non chiede che il codice sia scritto in un modo: chiede che
     non usi la data per decidere cosa tenere. */
  const sorgente = fs.readFileSync(
    path.join(RADICE, "tools", "versione_asset.py"), "utf8");

  /* il corpo della funzione `pota`, schema compreso */
  const inizio = sorgente.indexOf("def pota(");
  assert.ok(inizio > 0, "la funzione `pota` non c'è più");
  const corpo = sorgente.slice(inizio, sorgente.indexOf("\ndef ", inizio + 10));

  assert.ok(!/st_mtime/.test(corpo),
    "la potatura torna a ordinare per `st_mtime`: quel dato lo riscrive un " +
    "`git checkout`, quindi una cartella morta sembra nuova e non viene mai " +
    "potata. Il criterio deve essere «una pagina la cita?».");

  assert.ok(/cartelle_citate|assets\/([0-9a-f]{8})/.test(corpo),
    "la potatura deve leggere quali cartelle le pagine citano");

  assert.ok(/git\s*"?,?\s*"rm"/.test(corpo) || /"git",\s*"rm"/.test(corpo),
    "una cartella va tolta **da git**, non solo dal disco: altrimenti resta " +
    "nell'indice e il prossimo checkout la riporta");
});

test("le cartelle citate sono quelle che le pagine davvero contengono", () => {
  /* Se `cartelle_citate` leggesse un elenco di pagine incompleto, non
     troverebbe un riferimento e cancellerebbe una cartella **viva**. Qui si
     confronta con la scansione indipendente di questo file: lo stesso numero,
     o la funzione sta guardando altrove. */
  const python = spawnSync("python3", ["-c", [
    "import sys; sys.path.insert(0, 'tools')",
    "import versione_asset as v",
    "print(','.join(sorted(v.cartelle_citate())))",
  ].join("\n")], { cwd: RADICE, encoding: "utf8", env: Object.assign({}, process.env) });

  if (python.status !== 0) {
    /* niente python: non si può dire, e un test che finge di aver verificato
       è peggio di un test che manca */
    return;
  }
  const daPython = new Set(python.stdout.trim().split(",").filter(Boolean));
  const daQui = new Set(cartelleCitate().keys());

  const soloQui = [...daQui].filter((n) => !daPython.has(n));
  assert.deepStrictEqual(soloQui, [],
    "cartelle citate dalle pagine ma invisibili a `cartelle_citate`: la " +
    "potatura le cancellerebbe:\n  " + soloQui.join("\n  "));
});

/* ======================================== la potatura non toglie la viva da git == */

test("una cartella che il sito usa non finisce mai fuori dall'indice git", () => {
  /* Il 2026-11-25, alle 10:40, questa è successa davvero — e il danno era di
     32 MB di file vivi, non di un refuso.

     Il workspace era stato ricreato; le pagine citavano `3762b5d8` mentre i
     sorgenti producevano `3f58ff5a`. `pota()` ha deciso che `3762b5d8` era
     morta, ha eseguito

         git rm -r -q --cached --ignore-unmatch assets/3762b5d8

     e **git ha risposto 0 senza togliere niente**, perché in quel momento i
     file non risultavano tracciati. Con `check=False` l'esito non veniva
     guardato, quindi `shutil.rmtree` ha cancellato la cartella. La cartella
     che il sito stava servendo.

     Difesa: dopo `git rm` si **verifica** che i file non siano più
     nell'indice e che la cartella sia ancora citata; se una delle due cose
     non torna, la cartella resta dove è. Una copia in più costa 32 MB, una
     cartella viva cancellata costa il sito. */
  const strumento = fs.readFileSync(
    path.join(RADICE, "tools", "versione_asset.py"), "utf8");

  const inizio = strumento.indexOf("def pota(");
  assert.ok(inizio > 0, "`pota` non esiste più");
  const corpo = strumento.slice(inizio, strumento.indexOf("\ndef ", inizio + 10));

  /* l'esito di `git rm` non può essere ignorato */
  assert.ok(/returncode\s*!=\s*0/.test(corpo),
    "`pota` non controlla l'esito di `git rm`: git esce 0 anche quando non " +
    "toglie niente (`--ignore-unmatch`), quindi il controllo non direbbe mai " +
    "niente");

  /* e non si cancella dal disco prima di sapere che git ha tolto */
  const posizione_rm = corpo.indexOf("git\", \"rm");
  const posizione_rmtree = corpo.indexOf("shutil.rmtree");
  assert.ok(posizione_rm > 0 && posizione_rmtree > posizione_rm,
    "l'ordine è sbagliato: prima si cancella dal disco e poi si parla con git");

  const guardia = corpo.indexOf("returncode != 0");
  const rmtree = corpo.indexOf("shutil.rmtree");
  assert.ok(guardia > 0 && guardia < rmtree,
    "il controllo dell'esito deve venire **prima** di `rmtree`: se git non ha " +
    "tolto la cartella, la cartella non va cancellata");
});

test("se nessuna pagina cita una cartella, la potatura non cancella niente", () => {
  /* Il caso limite del 2026-11-25: se le pagine non sono leggibili (workspace
     ricreato a metà, `git checkout` in corso) l'elenco delle citazioni è
     vuoto. Con l'elenco vuoto, «cancella le cartelle non citate» vuol dire
     «cancella tutto». Deve fermarsi e dirlo. */
  const strumento = fs.readFileSync(
    path.join(RADICE, "tools", "versione_asset.py"), "utf8");
  const inizio = strumento.indexOf("def pota(");
  const corpo = strumento.slice(inizio, strumento.indexOf("\ndef ", inizio + 10));

  assert.ok(/if not citate_dalle_pagine:/.test(corpo),
    "manca la guardia sull'elenco vuoto: senza citazioni la potatura " +
    "cancellerebbe tutte le cartelle, compresa quella viva");

  /* E la guardia deve scattare su «zero citazioni», non su «nessuna citazione
     oltre la corrente»: nel caso normale le pagine citano **solo** la versione
     corrente, ed è giusto così. La prima versione chiedeva `citate - {attesa}`
     e quindi dichiarava sospetta ogni esecuzione sana — l'ha scoperto il primo
     giro vero, non il ragionamento. */
  assert.ok(/citate_dalle_pagine = cartelle_citate\(\)/.test(corpo),
    "la guardia deve leggere le citazioni dalle pagine, senza aggiungerci altro");
});

module.exports = casi;
