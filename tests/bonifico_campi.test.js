/* ==========================================================================
   Il modulo del bonifico SEPA
   ==========================================================================
   Il testo di aiuto sotto il campo «IBAN del beneficiario» diceva:

       «Deve essere un conto non tuo: un bonifico verso il tuo stesso
        conto non ha senso.»

   Due errori in una riga. Il primo è di merito: versare su un conto
   proprio — un deposito, un secondo conto, un conto di appoggio — è
   un'operazione legittima, e il modulo non ha motivo di vietarla. Il
   secondo è di tono: un divieto sull'uso del proprio conto, in una
   pagina che gestisce denaro, suona come qualcosa che il lettore non ha
   chiesto e non capisce.

   Il testo ora dice quello che serve davvero: il beneficiario deve
   corrispondere all'intestatario reale dell'IBAN, altrimenti il
   bonifico viene stornato. Informativo al posto di prescrittivo.
   ========================================================================== */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const casi = [];
function test(nome, fn) { casi.push({ nome, fn }); }

const APP = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

test("bonifico: il modulo non vieta di usare un conto proprio", () => {
  assert.ok(
    APP.indexOf("conto non tuo") === -1,
    "il modulo vieta ancora un bonifico verso un conto proprio, che è lecito"
  );
  assert.ok(
    APP.indexOf("tuo stesso conto non ha senso") === -1,
    "è tornata la frase secondo cui un bonifico verso il proprio conto non ha senso"
  );
});

test("bonifico: l'aiuto sul campo IBAN parla di intestazione, non di divieti", () => {
  /* Il suggerimento deve stare sotto il campo giusto: se qualcuno lo sposta
     altrove, il test lo nota perché cerca la coppia campo + testo. */
  const campo = APP.indexOf('id="bon-iban"');
  assert.ok(campo > -1, "manca il campo IBAN del beneficiario");

  const dopo = APP.slice(campo, campo + 1200);
  assert.ok(
    dopo.indexOf("Intestato a chi riceve il denaro") > -1,
    "l'aiuto sul campo IBAN non spiega più che deve corrispondere all'intestatario"
  );
});

test("bonifico: il campo IBAN resta obbligatorio", () => {
  const campo = APP.indexOf('id="bon-iban"');
  const tag = APP.slice(campo, APP.indexOf(">", campo));
  assert.ok(/\brequired\b/.test(tag), "il campo IBAN ha perso l'attributo required");
});

module.exports = casi;
