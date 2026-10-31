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
  if (registerForm) {
    registerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError(registerError);
      var button = registerForm.querySelector('button[type="submit"]');
      busy(button, true);

      api.register({
        name: document.getElementById("reg-name").value.trim(),
        email: document.getElementById("reg-email").value.trim(),
        password: document.getElementById("reg-password").value
      }).then(function () {
        busy(button, false);
        registerForm.reset();
        registerForm.hidden = true;
        loginForm.hidden = false;
        setMode("login");
        showError(loginError, "Richiesta inviata: l'account è in attesa di approvazione.");
        loginError.style.color = "var(--accent)";
      }).catch(function (err) {
        showError(registerError, err.message || "Registrazione non riuscita.");
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
      document.getElementById("reg-name").focus();
    });
  });

  document.querySelectorAll("[data-demo]").forEach(function (button) {
    button.addEventListener("click", function () {
      var parts = button.getAttribute("data-demo").split("|");
      loginForm.hidden = false;
      registerForm.hidden = true;
      setMode("login");
      document.getElementById("email").value = parts[0];
      document.getElementById("password").value = parts[1];
      clearError(loginError);
      document.getElementById("password").focus();
    });
  });

  /* già autenticato? vai direttamente all'area giusta */
  if (api.token()) {
    api.me().then(function (data) {
      window.location.replace(destination(data.user));
    }).catch(function () { /* resta sulla pagina */ });
  }
})();
