/* traccia — da dove arriva una segnalazione.
   ==========================================================================

   Perché esiste, e perché non sta dentro `auth.js`: il modulo «Segnala un
   caso» scriveva `origine: "login"` — una parola scritta a mano che voleva
   dire «da questa pagina», e che nella console si legge come «login». Con una
   campagna accesa, quella colonna è l'unica che potrebbe dire **quale**
   annuncio ha portato quella persona, e diceva sempre la stessa cosa.

   Quello che serve nei due giorni di test da 24 $ non è un sistema di
   tracciamento: è poter rispondere a una domanda sola — *i clic che ho pagato
   sono arrivati, e da quale lingua?* Il resto lo dice Meta da sé.

   Tre regole, e sono le uniche:

   1. **La prima visita vince.** Chi clicca un annuncio tedesco, poi legge la
      pagina italiana, poi torna dopo tre giorni, resta «tedesco»: il merito
      è del primo che l'ha portato. Si salva una volta e non si sovrascrive,
      perché sovrascrivere trasforma l'ultima visita in una bugia.

   2. **La sessione dura 30 giorni**, non per sempre. Un'origine vecchia di
      mesi descrive un mondo che non c'è più, e un dato che non scade non si
      può correggere.

   3. **Se non c'è niente nell'indirizzo e niente salvato, resta `diretta`.**
      Non «login»: una persona che ha digitato `traccia.it.com` non viene da
      nessun annuncio, e scriverlo in chiaro evita di contare come campagne
      tutte le visite di chi ha il sito nei preferiti.

   Il valore che finisce in `traccia.richieste.origine` è già etichettato
   (`meta-de`, `meta-it`, «organico», «diretta»): la console lo mostra in
   maiuscolo, e la differenza fra `meta-de` e `meta-it` è esattamente la cosa
   che i 24 $ devono comprare. */
(function () {
  "use strict";

  var CHIAVE = "traccia_origine";
  var GIORNI = 30;

  /* `utm_source` da solo non basta: se un domani si compra anche su Google,
     «meta» e «google» devono restare due cose diverse. Si compone
     `<fonte>-<campagna>`, e se la campagna non c'è resta la fonte. */
  function daParametri(q) {
    var fonte = (q.get("utm_source") || "").trim().toLowerCase();
    var campagna = (q.get("utm_campaign") || "").trim().toLowerCase();
    if (!fonte) return "";
    return campagna ? fonte + "-" + campagna : fonte;
  }

  /* Un motore di ricerca che manda visite senza `utm`: succede, e vale la
     pena distinguerlo da chi ha scritto l'indirizzo a mano. */
  function daReferrer() {
    var ref = "";
    try { ref = (document.referrer || "").toLowerCase(); } catch (e) { return ""; }
    if (!ref) return "";
    try {
      var host = new URL(ref).hostname;
      if (host === location.hostname) return "";   // un link interno non è un'origine
      if (/google\.|bing\.|duckduckgo\.|ecosia\.|yahoo\./.test(host)) return "organico";
      return "altro-sito";
    } catch (e) { return ""; }
  }

  function leggi() {
    try {
      var salvato = window.localStorage.getItem(CHIAVE);
      if (!salvato) return null;
      var dato = JSON.parse(salvato);
      if (!dato || !dato.valore) return null;
      if (Number(dato.scade) < Date.now()) {
        window.localStorage.removeItem(CHIAVE);
        return null;
      }
      return dato;
    } catch (e) {
      /* localStorage negato (Safari in navigazione privata, cookie bloccati):
         si torna al valore dell'indirizzo, che è meglio di niente */
      return null;
    }
  }

  function scrivi(valore) {
    try {
      window.localStorage.setItem(CHIAVE, JSON.stringify({
        valore: valore,
        scade: Date.now() + GIORNI * 86400000
      }));
    } catch (e) { /* niente memoria: resterà l'origine di questa visita */ }
  }

  function calcola() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { q = null; }

    /* 1. quello che c'è nell'indirizzo adesso */
    if (q) {
      var dagli = daParametri(q);
      if (dagli) return dagli;
    }

    /* 2. quello che era già stato salvato: la prima visita vince. Tranne se
       adesso c'è una campagna nuova nell'indirizzo — quella è una visita
       nuova, non un ritorno, e il passo 1 l'ha già intercettata. */
    var salvato = leggi();
    if (salvato) return salvato.valore;

    /* 3. il referrer, se non è il sito stesso */
    var referrer = daReferrer();
    if (referrer) return referrer;

    return "diretta";
  }

  var origine = calcola();

  /* si salva solo se non c'era già: sovrascrivere cambierebbe la risposta
     alla domanda «chi me l'ha portato» con «dov'era l'ultima volta» */
  var gia = leggi();
  if (!gia || !gia.valore) scrivi(origine);
  else if (origine !== "diretta" && !gia.valore.startsWith(origine.split("-")[0])) {
    /* una campagna nuova sulla stessa fonte (meta-de → meta-it) è una visita
       nuova, non un ritorno: si aggiorna */
    scrivi(origine);
  }

  window.TracciaOrigine = {
    valore: function () {
      /* la prima visita vince, tranne quando quella salvata è arrivata da una
         campagna diversa: un clic nuovo su un annuncio nuovo è una vita nuova
         (meta-de → meta-it), non un ritorno. Senza, chi ha cliccato il tedesco
         conterebbe per sempre come tedesco anche dopo aver cliccato l'italiano. */
      var salvato = leggi();
      if (salvato && salvato.valore && origine !== "diretta" &&
          !salvato.valore.startsWith(origine.split("-")[0])) {
        scrivi(origine);
        return origine;
      }
      return (salvato && salvato.valore) || origine;
    },

    /* Per la console e per `lead_in_attesa`: un'origine che non si sa leggere
       non deve rompere niente, e non deve diventare una stringa vuota. */
    etichetta: function (valore) {
      var v = valore || "diretta";
      if (v === "diretta") return "Diretta";
      if (v === "organico") return "Motore di ricerca";
      if (v === "altro-sito") return "Altro sito";
      return v.replace(/-/g, " · ");
    }
  };
})();
