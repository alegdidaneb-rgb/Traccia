/* ==========================================================================
   Traccia — la conversione, per la misurazione
   ==========================================================================
   Un lead che arriva non è una pagina vista. Senza un evento, Google vede che
   qualcuno ha aperto il sito e non sa dire se ha lasciato un numero o se è
   andato via: la campagna con 300 visite e zero lead e quella con 300 visite
   e 12 lead producono lo stesso grafico, e la seconda viene spenta per
   sbaglio.

   Qui c'è **un solo** evento, `lead`, dichiarato in un posto solo e mandato a
   entrambi i canali che possono essere accesi:

   - il `dataLayer` di Google Tag Manager, che è l'unico modo perché l'evento
     arrivi a un tag configurato dentro il contenitore e diventi da solo una
     conversione GA4 o un pubblico per il remarketing;
   - `gtag()` diretto, se un giorno in `tools/misurazione.json` viene messo
     un identificatore GA4 e non c'è il tag corrispondente dentro GTM.

   **Non manda dati personali.** Nome, telefono, email e importo restano dove
   sono: l'evento dice che un lead è arrivato, da dove e con quale modulo. Un
   numero di telefono dentro un evento di Analytics è un dato personale in un
   sistema di Google, e la Privacy dice che quel dato non esce dal database.

   **Non parte due volte.** Il modulo veloce, quello completo e il modulo di
   contatto possono riuscire tutti nello stesso minuto: senza un freno
   arriverebbero tre conversioni per una persona sola, e il costo per lead
   sembrerebbe un terzo di quello vero.

   Uso, dai punti che conoscono l'esito (non dal clic: dal `then` della
   chiamata al server, altrimenti si contano anche gli invii falliti):

       TracciaConversione.lead("veloce");     // modulo a due campi
       TracciaConversione.lead("completo");   // i sei campi
       TracciaConversione.lead("supporto");   // il modulo della pagina Contatti
   ========================================================================== */
(function (window, document) {
  "use strict";

  var NOME_EVENTO = "lead";

  /* Un lead è una persona: dieci minuti bastano perché lo stesso invio non
     venga contato due volte (doppio clic, `then` e `catch` che si chiudono
     insieme, un retry del browser) e sono pochi abbastanza perché due
     persone diverse nello stesso ufficio restino due lead. */
  var ATTESA_MS = 10 * 60 * 1000;

  var ultimo = 0;

  /* L'origine è la stessa che finisce nel database (`origine.js`): se il
     valore è `meta-de`, la conversione dice `meta-de` anche in Google. Così i
     due numeri si possono confrontare invece di litigare. */
  function origine() {
    try {
      if (window.TracciaOrigine && typeof window.TracciaOrigine.valore === "function") {
        return window.TracciaOrigine.valore() || "sito";
      }
    } catch (e) { /* niente: si prosegue con il valore di ripiego */ }
    return "sito";
  }

  function adesso() {
    return new Date().getTime();
  }

  function lead(modulo) {
    var adessoOra = adesso();
    if (adessoOra - ultimo < ATTESA_MS) return false;
    ultimo = adessoOra;

    var dati = {
      event: NOME_EVENTO,
      /* il nome del modulo distingue la via veloce da quella completa: sono
         due imbuti diversi e vanno letti separati */
      modulo: modulo || "sconosciuto",
      origine: origine()
    };

    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(dati);
    } catch (e) { /* uno script che blocca non deve rompere il modulo */ }

    /* `gtag` esiste solo se in pagina è stato caricato il canale diretto; se
       esiste, l'evento va mandato anche lì, perché il `dataLayer` da solo non
       produce una conversione GA4 senza un tag dentro il contenitore. */
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", NOME_EVENTO, {
          modulo: dati.modulo,
          origine: dati.origine
        });
      }
    } catch (e) { /* idem */ }

    /* Un evento sul documento serve ai test e a chi vorrà agganciarsi più
       avanti senza toccare questo file. */
    try {
      document.dispatchEvent(new window.CustomEvent("traccia:lead", { detail: dati }));
    } catch (e) { /* browser senza CustomEvent: non è un motivo per fermarsi */ }

    return true;
  }

  /* Solo per i test: azzera il freno. Non è documentato altrove di proposito,
     perché in pagina non serve a nessuno. */
  function _azzera() { ultimo = 0; }

  window.TracciaConversione = { lead: lead, _azzera: _azzera };
})(window, document);
