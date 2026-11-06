/* traccia — site behaviour. Plain ES2018, no dependencies. */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- nav -- */
  var toggle = document.querySelector(".nav__toggle");
  var links = document.querySelector(".nav__links");
  var header = document.querySelector(".site-header");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      links.classList.toggle("is-open", !open);
      document.body.classList.toggle("nav-open", !open);
    });

    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("is-open");
        document.body.classList.remove("nav-open");
      }
    });

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        toggle.setAttribute("aria-expanded", "false");
        links.classList.remove("is-open");
        document.body.classList.remove("nav-open");
      }
    });
  }

  /* ------------------------------------------------------- header state -- */
  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Le animazioni d'ingresso vivono in anim.js (caricato dopo questo file):
     qui resta solo ciò che riguarda il comportamento del sito. */

  /* --------------------------------------------------------------- FAQ -- */
  // Only one open at a time, accordion style.
  var faqItems = document.querySelectorAll(".faq__item");
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ------------------------------------------------------ cookie bar -- */
  var KEY = "traccia.cookie.choice";
  var bar = document.querySelector("[data-cookie-bar]");

  function stored() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function store(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) {}
  }

  if (bar && !stored()) {
    setTimeout(function () { bar.classList.add("is-visible"); }, 900);
  }

  if (bar) {
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cookie-choice]");
      if (!btn) return;
      store(btn.getAttribute("data-cookie-choice"));
      bar.classList.remove("is-visible");
      window.dispatchEvent(
        new CustomEvent("cookie:choice", {
          detail: btn.getAttribute("data-cookie-choice")
        })
      );
    });
  }

  /* -------------------------------------------------- modulo contatti -- */
  var form = document.querySelector("[data-demo-form]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector("[data-form-status]");
      var button = form.querySelector('button[type="submit"]');
      var label = button ? button.textContent : "";
      var field = function (sel) {
        var el = form.querySelector(sel);
        return el ? el.value.trim() : "";
      };

      if (button) { button.disabled = true; button.textContent = "Invio…"; }
      if (status) { status.classList.add("sr-only"); status.textContent = ""; }

      api.contact({
        name: field('[name="nome"], #c-nome'),
        email: field('[name="email"], #c-email'),
        phone: field('[name="telefono"], #c-telefono'),
        amount_eur: Number(field('[name="importo"], #c-importo').replace(/\./g, "").replace(",", ".")) || null,
        message: field('[name="messaggio"], #c-messaggio'),
        source: "supporto"
      }).then(function (res) {
        if (status) {
          status.textContent = res.message || "Richiesta ricevuta.";
          status.classList.remove("sr-only");
          status.style.color = "var(--accent)";
        }
        form.reset();
      }).catch(function (err) {
        if (status) {
          status.textContent = err.message || "Invio non riuscito. Riprova.";
          status.classList.remove("sr-only");
          status.style.color = "var(--down)";
        }
      }).then(function () {
        if (button) { button.disabled = false; button.textContent = label; }
      });
    });
  }

  /* --------------------------------------------------- current year -- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();

/* ------------------------------------------------- media placeholders -- */
(function () {
  document.querySelectorAll("[data-media-img]").forEach(function (img) {
    if (!img.getAttribute("src")) { img.remove(); return; }
    var ph = img.parentElement.querySelector("[data-media-ph]");
    function ok() {
      img.hidden = false;
      if (ph) ph.style.display = "none";
    }
    if (img.complete && img.naturalWidth > 0) ok();
    else img.addEventListener("load", ok);
    img.addEventListener("error", function () {
      img.remove();
      if (ph) ph.style.display = "";
    });
  });
})();

/* ============================================================================
   Lingua
   ============================================================================
   Il selettore è HTML puro: ogni voce è un link vero a `/`, `/en/`, `/de/`,
   `/es/`. Nessuna traduzione avviene nel browser — le pagine sono già scritte
   nella lingua giusta — quindi qui c'è solo ciò che l'HTML non può fare da
   solo: ricordare la scelta, correggere il bersaglio dei link quando serve, e
   dire all'utente in che lingua si trova.

   Perché la lingua sta nell'indirizzo e non in `localStorage` come fonte di
   verità: un link `/de/` incollato in una chat deve aprire il tedesco anche a
   chi non ha mai scelto niente. La memoria locale serve solo a riportare chi
   torna sul sito nella lingua che aveva scelto. */
(function () {
  "use strict";

  var LINGUE = ["it", "en", "de", "es"];
  var CHIAVE = "traccia.lingua";

  /* quale lingua sta servendo questa pagina: l'attributo lang è la verità */
  var corrente = (document.documentElement.getAttribute("lang") || "it").slice(0, 2);
  if (LINGUE.indexOf(corrente) === -1) corrente = "it";

  function ricorda(lingua) {
    try { window.localStorage.setItem(CHIAVE, lingua); } catch (e) { /* niente */ }
  }

  function ricordata() {
    try {
      var v = window.localStorage.getItem(CHIAVE);
      return LINGUE.indexOf(v) === -1 ? null : v;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------- voce della lingua attiva -- */
  /* Le quattro lingue sono sempre in vista: quella corrente non è un link ma
     la pastiglia accesa, e non è nemmeno cliccabile. Prima era un `<a>` che
     puntava alla pagina in cui si era già: si premeva e non succedeva niente,
     che è il difetto che fa dire «non riesco a cambiare lingua». Un `<a>`
     senza `href` resta raggiungibile da tastiera e annunciato come «link
     corrente» dai lettori di schermo, quindi tanto vale togliere il link. */
  document.querySelectorAll("[data-lang]").forEach(function (a) {
    var sua = a.getAttribute("data-lang");
    if (sua === corrente) {
      a.setAttribute("aria-current", "true");
      a.removeAttribute("href");
      a.removeAttribute("role");
    } else {
      a.addEventListener("click", function () { ricorda(sua); });
    }
  });

  /* ------------------------------------------------------- lingua del browser -- */
  /* Un visitatore nuovo che arriva dalla Germania deve trovare il tedesco senza
     cercare il menu. Si guarda una volta sola, e solo sulla home italiana: se
     scattasse a ogni pagina, chi ha scelto l'italiano verrebbe riportato al
     tedesco dal browser a ogni ritorno, e la scelta non conterebbe niente. */
  var percorso = location.pathname.replace(/\/+$/, "");
  var sullaHomeItaliana = (percorso === "" || percorso === "/index.html");
  if (sullaHomeItaliana && !ricordata()) {
    var preferite = navigator.languages || [navigator.language || ""];
    var scelta = null;
    for (var i = 0; i < preferite.length && !scelta; i++) {
      var codice = String(preferite[i] || "").slice(0, 2).toLowerCase();
      if (codice !== "it" && LINGUE.indexOf(codice) !== -1) scelta = codice;
    }
    if (scelta) {
      ricorda(scelta);
      location.replace("/" + scelta + "/");
      return;
    }
  }

  /* chi non ha mai scelto niente e naviga in italiano: la scelta implicita è
     l'italiano, così non gli si propone il tedesco al ritorno */
  if (!ricordata()) ricorda(corrente);

})();
