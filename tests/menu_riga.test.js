/* ==========================================================================
   Il menu interno non si allarga, si stringe
   ==========================================================================
   Il cliente, il 2026-11-13: il backend «è orribile, per niente professionale»,
   e la richiesta concreta è stata: **il menu in una riga, in cima, al posto
   della barra a sinistra**. Una riga di undici voci è una promessa che si
   mantiene o no a seconda di quanti pixel occupano le parole nel font vero —
   e questo non si vede leggendo l'HTML.

   `tools/misura_menu.py` fa quel conto con gli avanzamenti dei glifi di Inter
   (lo stesso metodo di `misura_header.py`, che esiste per lo stesso motivo).
   Qui lo si esegue: se qualcuno allunga le etichette o allarga i margini fino
   a far scorrere la barra, questo test cade **prima** che il cliente lo veda.

   Il criterio è quello giusto: non «una riga a ogni costo». Con `flex-wrap` una
   voce in più va a capo e resta visibile; quello che non deve succedere è che
   la barra **scorra di lato**, perché allora le voci oltre il bordo esistono
   solo per chi pensa di trascinare. È esattamente il difetto che il cliente
   ha descritto.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RADICE = path.join(__dirname, "..");
const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const CSS_BASE = fs.readFileSync(path.join(RADICE, "assets/css/style.css"), "utf8");
const CSS_PREMIUM = fs.readFileSync(path.join(RADICE, "assets/css/premium.css"), "utf8");

function regola(css, selettore) {
  const blocchi = [...css.matchAll(new RegExp(selettore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g"))];
  return blocchi.map((m) => m[1]).join(" ");
}

/* ------------------------------------------------------------------------
   La garanzia strutturale: a capo sì, scorrimento no.
   ------------------------------------------------------------------------ */
[["console", ".app-nav__bar", CSS_BASE],
 ["area cliente", ".area-nav__bar", CSS_PREMIUM]].forEach(([nome, selettore, css]) => {
  test(`${nome}: le voci vanno a capo invece di scorrere`, () => {
    const regolaBarra = regola(css, selettore);
    assert.ok(regolaBarra, `manca la regola ${selettore}: le voci non hanno un contenitore`);
    assert.ok(/flex-wrap:\s*wrap/.test(regolaBarra),
      `${selettore} deve dichiarare \`flex-wrap: wrap\`: senza, le voci che non ci ` +
      "stanno escono dal contenitore e spariscono");

    /* lo scorrimento può stare sul contenitore o su un antenato prossimo: si
       controlla tutta la catena del menu, non solo la barra */
    [".app-nav", ".area-nav"].forEach((contenitore) => {
      const r = regola(css, contenitore);
      assert.ok(!/overflow-x:\s*(auto|scroll)/.test(r),
        `${contenitore} dichiara \`overflow-x\`: la barra scorre di lato e le voci ` +
        "oltre il bordo diventano invisibili a chi non trascina");
    });
  });
});

/* ------------------------------------------------------------------------
   Il conto vero, con il font vero.
   ------------------------------------------------------------------------ */
test("misura_menu: il menu non sfonda il contenitore a nessuna larghezza d'ufficio", () => {
  /* `fontTools` non è una dipendenza del repository: se manca, il misuratore
     non può girare. Il test lo dice invece di fallire in modo incomprensibile
     — e non lo salta in silenzio, perché una misura che non gira è una
     promessa non verificata. */
  const esito = spawnSync("python3", ["tools/misura_menu.py", "--check"], {
    cwd: RADICE, encoding: "utf8",
  });
  const uscita = (esito.stdout || "") + (esito.stderr || "");
  assert.ok(!/No module named 'fontTools'/.test(uscita),
    "manca `fontTools`: `pip install fonttools brotli` — senza, la larghezza del " +
    "menu non è verificabile e questo test non può dire se la promessa regge");
  assert.equal(esito.status, 0,
    "il menu interno non ci sta:\n" + uscita);
});

test("misura_menu: le voci sono lette dalle pagine, non da un elenco ricopiato", () => {
  /* Una seconda copia delle etichette è la cosa che diverge: si cambia il menu
     e la misura continua a parlare di quello vecchio, dicendo «ci sta». */
  const sorgente = fs.readFileSync(path.join(RADICE, "tools/misura_menu.py"), "utf8");
  assert.ok(/voci_da_pagina\(/.test(sorgente),
    "misura_menu deve leggere le etichette da admin.html e app.html");
  assert.ok(!/^CONSOLE = \[/m.test(sorgente),
    "misura_menu non deve avere un elenco di voci scritto a mano");
});

/* ------------------------------------------------------------------------
   Le pastiglie: un numero vuoto non è un'informazione.
   ------------------------------------------------------------------------ */
test("console: il numero accanto a una voce si vede solo quando c'è", () => {
  const r = regola(CSS_BASE, ".app-nav__link .chip__count");
  assert.ok(r, "manca la regola della pastiglia nel menu della console");
  assert.ok(/display:\s*none/.test(r),
    "la pastiglia deve partire nascosta: undici `span` vuoti con un margine " +
    "allargano il menu senza dire niente");
  assert.ok(/\.is-numerato\s*\{\s*display:\s*inline-block/.test(CSS_BASE),
    "manca `.is-numerato`: la pastiglia non ha modo di comparire quando il " +
    "numero c'è");

  /* e la logica: un solo posto scrive il numero e accende la pastiglia */
  const js = fs.readFileSync(path.join(RADICE, "assets/js/admin.js"), "utf8");
  assert.ok(/function conta\(nodo, quanti\)/.test(js),
    "manca `conta()`: il numero va scritto in un posto solo");
  assert.ok(!/classList\.toggle\("is-hot", pending > 0\)/.test(js),
    "la pastiglia viene ancora accesa a mano fuori da `conta()`");
});

module.exports = casi;
