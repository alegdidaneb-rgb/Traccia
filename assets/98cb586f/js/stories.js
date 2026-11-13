/* traccia — le storie dei clienti, lato pubblico.
   ============================================================================
   Riempie due posti con la stessa funzione `api.storie()`:
     · la sezione in home (`#storie`), con le tre in evidenza;
     · la pagina `storie.html`, con tutte.

   Tre regole, e sono il motivo per cui questo file esiste invece di scrivere
   dodici blocchi a mano dentro l'HTML:

   1. **Se non c'è niente, non si vede niente.** La sezione in home nasce
      `hidden`; qui si mostra solo se il database ha restituito almeno una
      storia. Un sito che annuncia «nessuna storia» fa più danno della sezione
      che non c'è.

   2. **Il testo viene dal database, e si inserisce come testo.** Non con
      `innerHTML`: chi scrive una storia può scriverci dentro `<script>`, e
      quel testo finisce su una pagina pubblica. `textContent`, sempre.

   3. **Nessun importo, nessuna promessa.** Il database già non pubblica storie
      con cifre o dati personali; qui non si aggiunge niente — l'unico numero
      che si mostra è la data.
   ========================================================================== */
(function () {
  "use strict";

  /* Le parole e il nome dei mesi seguono la lingua della pagina, non quella
     del database: la stessa storia si legge in italiano, inglese, tedesco e
     spagnolo senza essere tradotta, perché il racconto resta quello che il
     cliente ha scritto e si traducono solo le etichette attorno. Se la lingua
     non è fra queste si resta sull'italiano — meglio una parola nota che una
     chiave. */
  var LINGUE = {
    it: {
      tipi: {
        broker: "Finto broker", crypto: "Criptovalute", unlock: "Prelievo bloccato",
        recovery: "Finto recupero", altro: "Truffa finanziaria"
      },
      mesi: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
             "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
    },
    en: {
      tipi: {
        broker: "Fake broker", crypto: "Cryptocurrency", unlock: "Blocked withdrawal",
        recovery: "Fake recovery", altro: "Financial fraud"
      },
      mesi: ["January", "February", "March", "April", "May", "June",
             "July", "August", "September", "October", "November", "December"]
    },
    de: {
      tipi: {
        broker: "Falscher Broker", crypto: "Kryptowährungen", unlock: "Blockierte Auszahlung",
        recovery: "Falsche Rückholung", altro: "Finanzbetrug"
      },
      mesi: ["Januar", "Februar", "März", "April", "Mai", "Juni",
             "Juli", "August", "September", "Oktober", "November", "Dezember"]
    },
    es: {
      tipi: {
        broker: "Falso bróker", crypto: "Criptomonedas", unlock: "Retirada bloqueada",
        recovery: "Falsa recuperación", altro: "Fraude financiero"
      },
      mesi: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    }
  };

  function lingua() {
    var codice = String(document.documentElement.lang || "it").slice(0, 2).toLowerCase();
    return LINGUE[codice] || LINGUE.it;
  }

  function tipoDi(chiave) {
    var tipi = lingua().tipi;
    return tipi[chiave] || tipi.altro;
  }

  function data(iso) {
    if (!iso) return "";
    var parti = String(iso).split("-");
    if (parti.length !== 3) return "";
    var m = Number(parti[1]);
    if (!m || m < 1 || m > 12) return "";
    return lingua().mesi[m - 1] + " " + Number(parti[0]);
  }

  function nodo(tag, classe, testo) {
    var el = document.createElement(tag);
    if (classe) el.className = classe;
    if (testo !== undefined && testo !== null) el.textContent = testo;
    return el;
  }

  /* una tessera: chi parla, di cosa, e le sue parole */
  function tessera(s) {
    var card = nodo("figure", "storia");

    var testa = nodo("div", "storia__head");
    var firma = nodo("span", "storia__firma", s.firma || "");
    testa.appendChild(firma);

    var dove = [tipoDi(s.tipo)];
    if (s.citta) dove.push(s.citta);
    testa.appendChild(nodo("span", "storia__dove", dove.join(" · ")));
    card.appendChild(testa);

    var citazione = nodo("blockquote", "storia__testo");
    citazione.appendChild(nodo("p", null, s.testo || ""));
    card.appendChild(citazione);

    var piede = nodo("figcaption", "storia__piede");
    if (s.quando) piede.appendChild(nodo("span", null, data(s.quando)));
    card.appendChild(piede);

    return card;
  }

  function riempi(host, storie, quante) {
    host.textContent = "";
    storie.slice(0, quante).forEach(function (s) {
      host.appendChild(tessera(s));
    });
  }

  function avvia() {
    if (!window.api || !window.api.storie) return;

    var inHome = document.querySelector("[data-storie-host]");
    var sezioneHome = document.getElementById("storie");
    var pagina = document.querySelector("[data-storie-pagina]");

    if (!inHome && !pagina) return;

    window.api.storie(50).then(function (storie) {
      storie = Array.isArray(storie) ? storie : [];

      if (inHome && sezioneHome) {
        if (!storie.length) return;      /* resta nascosta: è il caso normale
                                            finché non c'è una storia vera */
        riempi(inHome, storie, 3);
        sezioneHome.hidden = false;
        /* il link «tutte le storie» ha senso solo se ce ne sono altre */
        var altro = sezioneHome.querySelector('a[href^="storie"]');
        if (altro) altro.hidden = storie.length <= 3;
      }

      if (pagina) {
        var vuoto = document.querySelector("[data-storie-vuoto]");
        if (!storie.length) {
          if (vuoto) vuoto.hidden = false;
          return;
        }
        riempi(pagina, storie, 200);
        if (vuoto) vuoto.hidden = true;
      }
    }).catch(function () {
      /* niente storie, nessun errore a schermo: una pagina pubblica non deve
         mostrare un messaggio tecnico perché una funzione non ha risposto */
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", avvia);
  } else {
    avvia();
  }
})();
