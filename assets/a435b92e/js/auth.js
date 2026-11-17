/* traccia — login / registrazione (versione semplice). */
(function () {
  "use strict";

  /* Un lead arrivato. Lo script che lo sa mandare è `conversione.js`, e in
     una pagina servita da una cache vecchia può non esserci: qui si controlla,
     perché un evento mancante è un dato in meno, un'eccezione è un modulo
     rotto. */
  function segnalaConversione(modulo) {
    try {
      if (window.TracciaConversione) window.TracciaConversione.lead(modulo);
    } catch (e) { /* niente: la richiesta è già arrivata al server */ }
  }

  var next = new URLSearchParams(location.search).get("next") || "";
  var loginForm = document.getElementById("login-form");
  var registerForm = document.getElementById("register-form");
  /* vero quando qualcuno ha premuto «Preferisco scrivere i dettagli»: da quel
     momento il modulo completo è la sua scelta, e `setMode` non la annulla */
  var loginError = loginForm && loginForm.querySelector("[data-form-error]");
  var registerError = registerForm && registerForm.querySelector("[data-form-error]");

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.style.color = "var(--down)";
  }
  function clearError(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }
  function busy(button, state) {
    if (!button) return;
    button.dataset.label = button.dataset.label || button.textContent;
    button.disabled = state;
    button.textContent = state ? "Attendi…" : button.dataset.label;
  }

  function destination(user) {
    if (next) return next;
    return user.role === "admin" ? "admin.html" : "app.html";
  }

  /* ------------------------------------------- sessione appena chiusa -- */
  if (new URLSearchParams(location.search).get("uscita") && loginForm) {
    showError(loginError, "Sei uscito dal tuo conto. A presto.");
    if (loginError) loginError.style.color = "var(--accent)";
  }

  /* ------------------------------------------------------------- login -- */
  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError(loginError);
      var button = loginForm.querySelector('button[type="submit"]');
      busy(button, true);

      api.login(loginForm.email.value.trim(), loginForm.password.value)
        .then(function (data) {
          window.location.href = destination(data.user);
        })
        .catch(function (err) {
          showError(loginError, err.message || "Accesso non riuscito.");
          busy(button, false);
        });
    });
  }

  /* ---------------------------------------------------------- register -- */
  /* Richiesta di informazioni: nome, cognome, email, telefono, importo.
     I controlli stanno qui **e** nel database, non per sfiducia ma perché
     dicono cose diverse: qui si segnala il campo sbagliato e si tiene quello
     che la persona ha già scritto; nel database si rifiuta un dato che non può
     essere vero, anche se arriva da qualcuno che non passa da questa pagina.

     L'ordine dei controlli è quello in cui si compila il modulo: chi sbaglia
     il telefono al quarto campo non deve scoprire al sesto che mancava il
     nome. */
  var regolaTelefono = /^[+0-9][0-9 ()-]{5,24}$/;

  /* «12.500,00 €» e «12500» sono lo stesso importo. Si accetta quello che le
     persone scrivono davvero: punto per le migliaia, virgola per i decimali,
     il simbolo dell'euro, gli spazi. Restituisce null se non è un numero. */
  function importoInEuro(testo) {
    var grezzo = String(testo || "");
    /* il segno meno non è un carattere da buttare: buttarlo trasformerebbe
       «-500» nel suo contrario. Un importo perduto non è negativo, e se
       qualcuno scrive un numero negativo ha sbagliato campo. */
    if (/[-\u2212]/.test(grezzo)) return null;
    var t = grezzo.replace(/[^0-9.,]/g, "");
    if (!t) return null;
    /* se ci sono sia punti sia virgole, l'ultimo è il separatore decimale */
    if (t.indexOf(",") > -1 && t.indexOf(".") > -1) {
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) {
        t = t.replace(/\./g, "").replace(",", ".");
      } else {
        t = t.replace(/,/g, "");
      }
    } else if (t.indexOf(",") > -1) {
      t = t.replace(",", ".");
    } else if ((t.match(/\./g) || []).length > 1) {
      t = t.replace(/\./g, "");          /* 1.234.567: punti delle migliaia */
    } else if (/^\d{1,3}\.\d{3}$/.test(t)) {
      t = t.replace(".", "");             /* 12.500: migliaia, non 12,5 */
    }
    var n = Number(t);
    return isFinite(n) && n > 0 ? n : null;
  }

  /* Il campo che ha un problema, evidenziato e annunciato: senza questo il
     messaggio d'errore è in fondo al modulo e chi ha sbagliato il telefono
     non sa quale dei sei campi guardare. */
  function segnalaCampo(campo, messaggio) {
    if (!campo) return;
    campo.setAttribute("aria-invalid", "true");
    var avviso = campo.parentElement.querySelector("[data-field-error]");
    if (!avviso) {
      avviso = document.createElement("span");
      avviso.className = "field__error";
      avviso.setAttribute("data-field-error", "");
      campo.parentElement.appendChild(avviso);
    }
    avviso.textContent = messaggio;
    campo.focus();
  }

  function pulisciCampi(form) {
    form.querySelectorAll("[aria-invalid]").forEach(function (campo) {
      campo.removeAttribute("aria-invalid");
    });
    form.querySelectorAll("[data-field-error]").forEach(function (avviso) {
      avviso.remove();
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError(registerError);
      pulisciCampi(registerForm);

      var valore = function (id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : "";
      };

      var nome = valore("reg-first-name");
      var cognome = valore("reg-last-name");
      var email = valore("reg-email");
      var telefono = valore("reg-phone");
      var importo = importoInEuro(valore("reg-amount"));
      var situazione = valore("reg-tipo");

      /* i cinque dati richiesti, nell'ordine in cui compaiono */
      if (nome.length < 2) {
        return segnalaCampo(document.getElementById("reg-first-name"), "Inserisci il nome.");
      }
      if (cognome.length < 2) {
        return segnalaCampo(document.getElementById("reg-last-name"), "Inserisci il cognome.");
      }
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
        return segnalaCampo(document.getElementById("reg-email"), "Inserisci un indirizzo email valido.");
      }
      if (!regolaTelefono.test(telefono) ||
          telefono.replace(/\D/g, "").length < 8) {
        return segnalaCampo(document.getElementById("reg-phone"),
          "Inserisci un numero di telefono con il prefisso, per esempio +39 333 123 4567.");
      }
      if (importo === null) {
        return segnalaCampo(document.getElementById("reg-amount"),
          "Indica l'importo approssimativo che hai perso, per esempio 12.500.");
      }
      var button = registerForm.querySelector('button[type="submit"]');
      busy(button, true);

      /* Nessuna password: non stiamo creando un account ma una richiesta.
         L'account lo crea un analista quando prende in carico la pratica. */
      api.register({
        first_name: nome,
        last_name: cognome,
        email: email,
        phone: telefono,
        amount_eur: importo,
        situation: situazione,
        /* non «login»: la pagina non è un'origine, è un posto. Quello che
           vogliamo sapere è se questa persona è arrivata da un annuncio, e
           quale — vedi `origine.js`. Se lo script non c'è, il valore resta
           quello di prima invece di essere `undefined`. */
        origine: (window.TracciaOrigine && window.TracciaOrigine.valore())
          || "sito"
      }).then(function (res) {
        busy(button, false);
        segnalaConversione("completo");
        registerForm.reset();
        /* la conferma si legge dove si è appena scritto: portare alla scheda
           dell'accesso, come si faceva prima, faceva sembrare che la
           richiesta fosse diventata un account da aprire con una password */
        setMode("register");
        showError(registerError,
          (res && res.message) ||
          "Richiesta ricevuta. Ti ricontattiamo entro 48 ore lavorative.");
        if (registerError) registerError.style.color = "var(--accent)";
      }).catch(function (err) {
        showError(registerError, err.message || "Invio non riuscito. Riprova.");
        busy(button, false);
      });
    });
  }

  /* ------------------------------------------------ switch / autofill -- */
  /* Due schede, un solo pannello visibile per volta. `setMode` è l'unico
     punto che cambia stato: prima il titolo e i due moduli si muovevano
     ognuno per conto suo, e bastava un ramo dimenticato per mostrare il campo
     password sopra il modulo di segnalazione — la cosa che questo lavoro
     doveva togliere. */
  var titleEl = document.getElementById("auth-title");
  var subtitleEl = document.getElementById("auth-subtitle");
  /* I testi delle due schede stanno nei `data-` della testata della scheda,
     dove `build_i18n.py` li traduce; gli italiani qui sotto restano come rete
     di sicurezza per una pagina costruita a mano. */
  var testi = (titleEl && titleEl.parentElement && titleEl.parentElement.dataset) || {};
  function testo(chiave, difetto) {
    return testi[chiave] || difetto;
  }
  var schede = Array.prototype.slice.call(document.querySelectorAll("[data-auth-tab]"));

  function setMode(mode) {
    var registrazione = mode === "register";
    if (loginForm) loginForm.hidden = registrazione;

    /* Un modulo solo. Fino al 2026-11-12 qui c'erano due porte: la via veloce
       (nome e numero) e il modulo completo dietro il link «Preferisco scrivere
       i dettagli». Il cliente l'ha bocciata — «these type of registration
       should not even be there» — e ha ragione: chi ha appena perso dei soldi
       non deve scoprire che il modulo serio era nascosto sotto quello corto.
       La scheda della segnalazione mostra il modulo completo, e basta. */
    if (registerForm) registerForm.hidden = !registrazione;
    /* la frase «non hai un account» appartiene all'accesso: sulla scheda della
       segnalazione sarebbe una porta che dà sulla stanza in cui sei già */
    var senzaAccount = document.getElementById("auth-no-account");
    if (senzaAccount) senzaAccount.hidden = registrazione;
    schede.forEach(function (scheda) {
      scheda.setAttribute("aria-selected",
        scheda.getAttribute("data-auth-tab") === mode ? "true" : "false");
    });
    if (!titleEl) return;
    if (registrazione) {
      titleEl.textContent = testo("titoloSegnalazione", "Segnala il tuo caso");
      if (subtitleEl) subtitleEl.textContent = testo("sottotitoloSegnalazione",
        "Bastano pochi dati. Ti ricontattiamo noi, senza password da scegliere.");
    } else {
      titleEl.textContent = testo("titoloAccesso", "Accedi");
      if (subtitleEl) subtitleEl.textContent = testo("sottotitoloAccesso",
        "Inserisci le credenziali della tua pratica.");
    }
  }

  /* Da dove si arriva: `#registrati` (il pulsante «Segnala un caso» in ogni
     pagina) apre la scheda della segnalazione. Si guarda l'indirizzo e non il
     clic, perché il link può essere premuto da un'altra pagina — in quel caso
     il browser non emette nessun clic qui, cambia solo l'indirizzo. */
  function modalitaDaIndirizzo() {
    return location.hash.replace(/^#/, "") === "registrati" ? "register" : null;
  }

  function applicaIndirizzo(mettiAFuoco) {
    var modo = modalitaDaIndirizzo();
    if (!modo) {
      setMode("login");
      return;
    }
    setMode(modo);
    var primo = document.getElementById("reg-first-name");
    if (mettiAFuoco && primo) primo.focus();
  }

  schede.forEach(function (scheda) {
    scheda.addEventListener("click", function (e) {
      var modo = scheda.getAttribute("data-auth-tab");
      e.preventDefault();
      /* l'indirizzo resta leggibile e condivisibile: `login.html#registrati`
         apre la scheda giusta, `/login.html` quella dell'accesso */
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "",
          location.pathname + (modo === "register" ? "#registrati" : ""));
      }
      setMode(modo);
      var primo = document.getElementById(modo === "register" ? "reg-first-name" : "email");
      if (primo) primo.focus();
    });
  });

  /* il tasto indietro e i link `#registrati` premuti da un'altra pagina */
  window.addEventListener("hashchange", function () { applicaIndirizzo(true); });
  applicaIndirizzo(false);

  /* Chi arriva sull'accesso e non ha un account non deve cercare il link in
     fondo alla scheda: il modulo di segnalazione gli serve subito. */
  var senzaAccount = document.getElementById("auth-no-account");
  if (senzaAccount) {
    senzaAccount.hidden = false;
    senzaAccount.addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest("[data-go-register]") : null;
      if (!link) return;
      e.preventDefault();
      setMode("register");
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", location.pathname + "#registrati");
      }
      var primo = document.getElementById("reg-first-name");
      if (primo) primo.focus();
    });
  }

  /* compatibilità: resta il vecchio aggancio `data-show-register`, se una
     pagina lo usa ancora */
  document.querySelectorAll("[data-show-register]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      setMode("register");
      var primo = document.getElementById("reg-first-name");
      if (primo) primo.focus();
    });
  });

  /* già autenticato? vai direttamente all'area giusta */
  if (api.token()) {
    api.me().then(function (data) {
      window.location.replace(destination(data.user));
    }).catch(function () { /* resta sulla pagina */ });
  }
})();
