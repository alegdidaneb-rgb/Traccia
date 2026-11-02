/* traccia — pulsante WhatsApp.
   Un solo posto in cui si costruisce il collegamento: `wa.me` accetta solo
   cifre, quindi il numero scritto con spazi o "+" va normalizzato, e il
   messaggio deve essere codificato. Se il numero non è configurato il
   pulsante non compare: meglio nessun pulsante che un link rotto. */
(function (global) {
  "use strict";

  var CFG = global.TRACCIA_CONFIG || {};
  var TEXT = CFG.whatsappText || "Buongiorno, vi scrivo dal sito Traccia.";

  /* Il numero si scrive come lo si legge (+1 539 215 1268); `wa.me` vuole
     solo cifre, quindi il "+" e gli spazi si tolgono qui e in nessun altro
     posto. Il prefisso internazionale resta: senza, WhatsApp cerca il numero
     nel paese di chi apre il link. */
  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function configured() {
    var n = digits(CFG.whatsapp);
    return n.length >= 8;
  }

  function numero() {
    return digits(CFG.whatsapp);
  }

  /* parte leggibile: usata nei testi accanto al pulsante. Un numero
     internazionale non si spezzetta a caso — si mostra con il suo prefisso e
     il resto come l'ha scritto chi lo ha configurato, invece di indovinare
     dove finisce il prefisso. */
  function leggibile() {
    var n = numero();
    if (!n) return "";
    /* i prefissi che il sito può usare: 1 (USA/Canada), 39 (Italia) */
    if (n.indexOf("1") === 0 && n.length === 11) {
      return "+1 " + n.slice(1, 4) + " " + n.slice(4, 7) + " " + n.slice(7);
    }
    if (n.indexOf("39") === 0) {
      return "+39 " + n.slice(2).replace(/(\d{3})(\d{3})(\d+)/, "$1 $2 $3");
    }
    return "+" + n;
  }

  function link(pratica) {
    if (!configured()) return "";
    var testo = String(TEXT);

    /* Se non c'è un codice pratica si toglie l'intera frase che lo contiene:
       meglio un messaggio più corto che uno con un buco dentro. */
    var frasi = testo.split(/(?<=[.!?])\s+/);
    if (pratica) {
      frasi = frasi.map(function (f) { return f.replace("{pratica}", pratica); });
    } else {
      frasi = frasi.filter(function (f) { return f.indexOf("{pratica}") === -1; });
      if (!frasi.length) frasi = ["Buongiorno, vi scrivo dal sito Traccia."];
    }

    testo = frasi.join(" ").replace(/\s{2,}/g, " ").trim();
    if (!/[.!?]$/.test(testo)) testo += ".";
    return "https://wa.me/" + numero() + "?text=" + encodeURIComponent(testo);
  }

  /* codice pratica corrente, se il cliente ha una sessione aperta */
  function pratica() {
    var el = document.querySelector("[data-case-ref]");
    var ref = el ? (el.getAttribute("data-case-ref") || el.textContent || "").trim() : "";
    if (!ref || ref === "—" || /T-0000/.test(ref)) return "";
    return ref;
  }

  /* Il numero scritto in chiaro in una pagina deve venire dalla stessa fonte
     del collegamento: due copie divergono, e quella vecchia resta lì per mesi.
     Se il testo non ha il segnaposto, lo si aggiunge accanto al pulsante. */
  function scriviNumero() {
    var n = leggibile();
    if (!n) return;
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-whatsapp-numero]"),
      function (el) { el.textContent = n; }
    );
  }

  function init() {
    if (!configured()) {
      /* niente numero: si toglie anche quello che è stato scritto a mano */
      Array.prototype.forEach.call(
        document.querySelectorAll("[data-whatsapp]"),
        function (el) { el.remove(); }
      );
      return;
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-whatsapp]"), function (el) {
      var href = link(pratica());
      if (el.tagName === "A") el.setAttribute("href", href);
      el.hidden = false;
    });

    scriviNumero();
  }

  global.TracciaWhatsApp = {
    link: link,
    numero: numero,
    leggibile: leggibile,
    configured: configured,
    scriviNumero: scriviNumero,
    init: init
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
