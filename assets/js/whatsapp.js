/* traccia — pulsante WhatsApp.
   Un solo posto in cui si costruisce il collegamento: `wa.me` accetta solo
   cifre, quindi il numero scritto con spazi o "+" va normalizzato, e il
   messaggio deve essere codificato. Se il numero non è configurato il
   pulsante non compare: meglio nessun pulsante che un link rotto. */
(function (global) {
  "use strict";

  var CFG = global.TRACCIA_CONFIG || {};
  var TEXT = CFG.whatsappText || "Buongiorno, vi scrivo dal sito Traccia.";

  /* +39 011 0000 0000  →  390110000000 */
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

  /* parte leggibile: usata nei testi accanto al pulsante */
  function leggibile() {
    var n = numero();
    if (!n) return "";
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
  }

  global.TracciaWhatsApp = {
    link: link,
    numero: numero,
    leggibile: leggibile,
    configured: configured,
    init: init
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
