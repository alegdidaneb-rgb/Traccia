/* traccia — login / registrazione (versione semplice). */
(function () {
  "use strict";

  var next = new URLSearchParams(location.search).get("next") || "";
  var loginForm = document.getElementById("login-form");
  var registerForm = document.getElementById("register-form");
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
      var password = valore("reg-password");

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
      if (password.length < 8) {
        return segnalaCampo(document.getElementById("reg-password"),
          "La password deve avere almeno 8 caratteri.");
      }

      var button = registerForm.querySelector('button[type="submit"]');
      busy(button, true);

      api.register({
        name: nome + " " + cognome,
        first_name: nome,
        last_name: cognome,
        email: email,
        phone: telefono,
        amount_eur: importo,
        password: password
      }).then(function () {
        busy(button, false);
        registerForm.reset();
        registerForm.hidden = true;
        loginForm.hidden = false;
        setMode("login");
        showError(loginError, "Richiesta inviata: ti ricontattiamo entro 48 ore lavorative.");
        if (loginError) loginError.style.color = "var(--accent)";
      }).catch(function (err) {
        showError(registerError, err.message || "Invio non riuscito. Riprova.");
        busy(button, false);
      });
    });
  }

  /* ------------------------------------------------ switch / autofill -- */
  /* il titolo della scheda segue il pannello visibile */
  var titleEl = document.getElementById("auth-title");
  var subtitleEl = document.getElementById("auth-subtitle");
  function setMode(mode) {
    if (!titleEl) return;
    if (mode === "register") {
      titleEl.textContent = "Apri un conto";
      if (subtitleEl) subtitleEl.textContent = "Bastano pochi dati: l'approvazione è manuale.";
    } else {
      titleEl.textContent = "Accedi";
      if (subtitleEl) subtitleEl.textContent = "Inserisci le credenziali del tuo conto.";
    }
  }

  document.querySelectorAll("[data-show-register]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      loginForm.hidden = true;
      registerForm.hidden = false;
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
