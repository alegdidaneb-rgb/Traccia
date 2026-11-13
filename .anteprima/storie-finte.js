/* traccia — BANCO DI PROVA, non produzione.
   ============================================================================
   Tre storie finte per guardare le pagine delle storie senza toccare il
   database vero. Si carica solo dalla copia locale (`tools/anteprima.py`), non
   è referenziata da nessuna pagina del sito: se questo file finisse online non
   farebbe niente, perché nessuna pagina lo chiama.

   Due cose che fa, e una che non fa:
     · sostituisce `api.storie` con tre storie inventate — riconoscibili perché
       la firma è `(esempio)`, così nessuno le scambia per clienti veri;
     · per `app.html` e `admin.html` finge una sessione, così le due schermate
       si aprono senza login. Le altre chiamate rispondono «dati di esempio».
     · NON scrive niente: `salvaStoria` mostra cosa sarebbe successo e basta.
   ========================================================================== */
(function () {
  "use strict";

  var STORIE = [
    {
      firma: "(esempio) M. L.",
      tipo: "broker",
      citta: "Milano",
      quando: "2026-09-18",
      testo: "Mi avevano convinta a versare su una piattaforma che sembrava " +
        "serissima: grafici, un consulente che mi chiamava ogni mattina, " +
        "prelievi possibili fino a quando non ho chiesto i miei soldi. Da lì " +
        "in poi il mio «gestore» è diventato irreperibile e l'assistenza ha " +
        "cominciato a chiedermi il 20% di tasse anticipate. Non sapevo a chi " +
        "rivolgermi e mi vergognavo di raccontarlo. Qui ho trovato qualcuno " +
        "che mi ha spiegato cosa era successo, senza farmi sentire stupida."
    },
    {
      firma: "(esempio) A. R.",
      tipo: "unlock",
      citta: "Torino",
      quando: "2026-08-02",
      testo: "Il momento peggiore non è stato perdere i soldi: è stato il " +
        "secondo messaggio, quello in cui mi dicevano che per sbloccare il " +
        "prelievo serviva un altro bonifico. Ci ho pensato tre giorni. Se non " +
        "avessi parlato con qualcuno prima di pagare, adesso sarei al doppio. " +
        "Avevo una pratica aperta con Traccia, ho scritto tutto nella scheda " +
        "della mia storia, ed è servito anche a me per rimettere in ordine le " +
        "date e le cifre."
    },
    {
      firma: "(esempio) G. P.",
      tipo: "crypto",
      citta: "Bologna",
      quando: "2026-06-27",
      testo: "Ho perso i risparmi di sette anni dietro a un wallet che non ho " +
        "mai veramente controllato. Nessuno mi ha promesso che li avrei " +
        "rivisti, ed è la cosa che ho apprezzato di più: nessuna promessa. " +
        "Mi hanno detto con chiarezza cosa si poteva fare, cosa non si " +
        "poteva, e quanto sarebbe costato. Ho scelto di raccontarlo qui " +
        "perché quando mi è successo cercavo una frase come questa e non " +
        "l'ho trovata."
    }
  ];

  function rispondi(valore) { return Promise.resolve(valore); }

  function finta() {
    return {
      /* forma identica a `public_storie`: `{ storie: [...] }` */
      storie: function () { return rispondi({ storie: STORIE.slice() }); },
      miaStoria: function () {
        return rispondi({
          testo: STORIE[0].testo, tipo: STORIE[0].tipo, citta: STORIE[0].citta,
          consenso: true, ritirata: false, blocco: null, pubblicata: true,
          scritta_il: "2026-09-18", firma: STORIE[0].firma, fase: "Denunce",
          puo_scrivere: true
        });
      },
      salvaStoria: function (d) {
        window.alert("Anteprima: nessun dato è stato scritto.\n\n" +
          "Testo: " + String(d.testo || "").length + " caratteri\n" +
          "Tipo: " + d.tipo + " · Città: " + (d.citta || "—") +
          " · Consenso: " + (d.consenso ? "sì" : "no"));
        return rispondi({ ok: true, stato: "pubblicata" });
      },
      storieAdmin: function () {
        return rispondi({
          storie: STORIE.map(function (s, i) {
            return {
              id: "esempio-" + i, nome: s.firma + " (dati di esempio)",
              email: "esempio" + i + "@anteprima.invalido", testo: s.testo,
              tipo: s.tipo, citta: s.citta, firma: s.firma, consenso: true,
              ritirata: i === 2, blocco: i === 1 ? "C e un numero di telefono nel testo." : null,
              in_evidenza: i === 0, pubblicata: i === 0, quando: s.quando
            };
          })
        });
      },
      storiaEvidenza: function () {
        window.alert("Anteprima: la scelta non è stata salvata.");
        return rispondi({ ok: true });
      }
    };
  }

  function travesti() {
    if (!window.api) return;
    var f = finta();
    Object.keys(f).forEach(function (k) { window.api[k] = f[k]; });
    window.api.isDemo = function () { return true; };

    /* le due schermate riservate si aprono senza login, con dati finti ma
       dichiarati tali — il nastro in cima lo dice a chi guarda */
    var tokenFinto = "anteprima-locale";
    window.api.token = function () { return tokenFinto; };
    window.api.dashboard = function () {
      return rispondi({
        user: { name: "Maria Lonardi (esempio)", email: "esempio@anteprima.invalido",
                first_name: "Maria", last_name: "Lonardi" },
        case: { ref: "TRC-2026-0042", phase_name: "Denunce", phase: 3,
                amount_eur: 0, status: "active" }
      });
    };

    /* `api.me()` è la porta d'ingresso di ogni schermata riservata: se
       risponde la persona finta qui sotto, `app.html` e `admin.html` si
       aprono senza account */
    window.api.me = function () {
      return rispondi({
        user: { name: "Maria Lonardi (esempio)", email: "esempio@anteprima.invalido",
                role: "admin", is_master: true,
                first_name: "Maria", last_name: "Lonardi" },
        case: { ref: "TRC-2026-0042", phase_name: "Denunce", phase: 3,
                amount_eur: 0, status: "active" }
      });
    };

    /* `ui.js` carica dopo questo file e si assegna con `window.ui = {…}`:
       per intercettarlo prima che `admin.js` lo usi serve una proprietà con
       setter. Senza, `requireAdmin()` chiama il database vero e rimanda al
       login. */
    var veroUi;
    Object.defineProperty(window, "ui", {
      configurable: true,
      get: function () { return veroUi; },
      set: function (valore) {
        veroUi = valore;
        if (!valore) return;
        valore.requireAuth = function () { return window.api.me(); };
        valore.requireAdmin = function () { return window.api.me(); };
      }
    });

    /* Le altre schede della consolle chiamano il database vero e senza
       sessione riempirebbero lo schermo di «nessuna connessione». Qui le
       chiamate RPC ricevono una risposta vuota: le tabelle restano vuote e la
       scheda delle storie — l'unica che ci interessa — mostra i suoi esempi. */
    var veroFetch = window.fetch;
    window.fetch = function (url) {
      if (String(url).indexOf("/rest/v1/rpc/") > -1) {
        return Promise.resolve({
          ok: true, status: 200,
          text: function () { return Promise.resolve("{}"); }
        });
      }
      return veroFetch.apply(window, arguments);
    };
  }

  /* subito: `stories.js` e `case.js` sono entrambi `defer` e partono al
     momento dello script, non su DOMContentLoaded. Aspettare l'evento
     significherebbe arrivare dopo la prima chiamata al database vero. */
  travesti();

  window.addEventListener("DOMContentLoaded", function () {
    if (!/app\.html$|admin\.html$/.test(location.pathname)) return;
    var nastro = document.createElement("div");
    nastro.textContent = "ANTEPRIMA LOCALE · dati di esempio, nessun dato reale, niente è stato scritto";
    nastro.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
      "background:#c8f169;color:#0b0b0f;font:600 12px/1.4 Inter,system-ui,sans-serif;" +
      "text-align:center;padding:6px 10px;letter-spacing:.02em";
    document.body.appendChild(nastro);
  }, { once: true });
})();
