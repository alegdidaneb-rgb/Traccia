#!/usr/bin/env node
/* Runner minimo: nessuna dipendenza. `node tests/run.js` esegue tutto. */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const elenco = file ? [file] : fs.readdirSync(__dirname)
  .filter(f => f.endsWith(".test.js"))
  .map(f => path.join(__dirname, f));

let passati = 0, falliti = 0;

/* I test possono essere sincroni o `async`: il runner li attende entrambi,
   altrimenti una promessa rifiutata passerebbe per un successo. */
async function esegui() {
  for (const f of elenco) {
    const casi = require(path.resolve(f));
    console.log("\n" + path.basename(f));
    for (const { nome, fn } of casi) {
      try {
        await fn();
        passati++;
        console.log("  ✓ " + nome);
      } catch (e) {
        falliti++;
        console.log("  ✗ " + nome);
        console.log("      " + (e && e.message ? e.message : e).split("\n")[0]);
      }
    }
  }
  console.log(`\n${passati} passati, ${falliti} falliti`);
  process.exit(falliti ? 1 : 0);
}

esegui().catch((e) => {
  console.error(e);
  process.exit(1);
});
