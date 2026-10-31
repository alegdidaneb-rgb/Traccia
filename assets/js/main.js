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
