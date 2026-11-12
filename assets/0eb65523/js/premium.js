/* traccia — motore di movimento premium.
   Reveal all'ingresso nel viewport con cascata, contatori, barra di lettura,
   parallasse leggera e micro-interazioni. Tutto opzionale: senza JS o con
   prefers-reduced-motion la pagina resta completa e leggibile. */
(function () {
  "use strict";

  var reduced = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  var hasIO = "IntersectionObserver" in window;
  var root = document.documentElement;

  /* ------------------------------------------------------------ utilities -- */
  function raf(fn) { return window.requestAnimationFrame(fn); }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ------------------------------------------------------- barra lettura -- */
  function scrollProgress() {
    var bar = document.querySelector(".scroll-progress");
    if (!bar) return;
    var ticking = false;
    function update() {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var value = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      bar.style.setProperty("--scroll-progress", value.toFixed(4));
    }
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      raf(update);
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  /* ------------------------------------------------------- reveal engine -- */
  var STAGGER = 80;
  var MAX_STAGGER = 560;

  function collect() {
    var all = Array.prototype.slice.call(
      document.querySelectorAll("[data-reveal], .reveal")
    );
    var groups = {};
    return all.map(function (el, index) {
      var group = el.getAttribute("data-reveal-group");
      var order = index;
      if (group) {
        if (!groups[group]) {
          groups[group] = all.filter(function (s) {
            return s.getAttribute("data-reveal-group") === group;
          });
        }
        order = groups[group].indexOf(el);
      }
      var delay = Math.min(order * STAGGER, MAX_STAGGER);
      if (el.hasAttribute("data-reveal-delay")) {
        delay = parseInt(el.getAttribute("data-reveal-delay"), 10) || 0;
      }
      return { el: el, delay: delay };
    });
  }

  function revealNow(item) {
    if (item.el.classList.contains("is-visible")) return;
    window.setTimeout(function () {
      item.el.style.setProperty("--reveal-delay", item.delay + "ms");
      item.el.classList.add("is-visible");
    }, reduced ? 0 : item.delay);
  }

  function revealPass(items) {
    // rete di sicurezza: rivela ciò che è a schermo o già superato
    items.forEach(function (item) {
      if (item.el.classList.contains("is-visible")) return;
      var r = item.el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.96 && r.bottom > 0) {
        revealNow(item);
      } else if (r.bottom <= 0) {
        item.el.style.setProperty("--reveal-delay", "0ms");
        item.el.classList.add("is-visible");
      }
    });
  }

  function startReveal() {
    var items = collect();
    if (!items.length) { root.classList.remove("js-anim"); return; }

    if (reduced || !hasIO) {
      root.classList.remove("js-anim");
      root.classList.add("no-anim");
      items.forEach(function (i) { i.el.classList.add("is-visible"); });
      return;
    }

    root.classList.add("js-anim");

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var match = null;
        for (var i = 0; i < items.length; i++) {
          if (items[i].el === entry.target) { match = items[i]; break; }
        }
        if (match) revealNow(match);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.01 });

    items.forEach(function (item) {
      var r = item.el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92) revealNow(item);
      else observer.observe(item.el);
    });

    var pending = false;
    function onMove() {
      if (pending) return;
      pending = true;
      raf(function () { revealPass(items); pending = false; });
    }
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove, { passive: true });
    window.setTimeout(function () { revealPass(items); }, 260);
  }

  /* ------------------------------------------------------------ contatori -- */
  function formatNumber(value, decimals) {
    return Number(value).toLocaleString("it-IT", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true
    });
  }

  function animateCounter(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (isNaN(target)) return;
    var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = parseInt(el.getAttribute("data-duration") || "1600", 10);
    var start = null;

    function frame(ts) {
      if (start === null) start = ts;
      var p = clamp((ts - start) / duration, 0, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + formatNumber(target * eased, decimals) + suffix;
      if (p < 1) raf(frame);
      else el.textContent = prefix + formatNumber(target, decimals) + suffix;
    }
    raf(frame);
  }

  function startCounters() {
    var counters = document.querySelectorAll("[data-count]");
    if (!counters.length) return;

    function settle(el) {
      var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
      el.textContent = (el.getAttribute("data-prefix") || "") +
        formatNumber(parseFloat(el.getAttribute("data-count")), decimals) +
        (el.getAttribute("data-suffix") || "");
    }

    if (reduced || !hasIO) { each(counters, settle); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.35 });
    each(counters, function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------- parallasse -- */
  function startParallax() {
    if (reduced) return;
    var targets = document.querySelectorAll("[data-parallax]");
    if (!targets.length) return;
    var ticking = false;

    function update() {
      ticking = false;
      var vh = window.innerHeight;
      each(targets, function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var strength = parseFloat(el.getAttribute("data-parallax")) || 18;
        var progress = (vh - r.top) / (vh + r.height);
        var shift = (progress - 0.5) * strength * 2;
        el.style.transform = "translate3d(0," + (-shift).toFixed(2) + "px,0)";
      });
    }
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      raf(update);
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  /* ----------------------------------------------------- micro-interazioni -- */
  function startSpotlight() {
    if (reduced) return;
    var cards = document.querySelectorAll(".card--spot, .kpi__cell");
    each(cards, function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      });
    });
  }

  function startMagnetic() {
    if (reduced) return;
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
    each(document.querySelectorAll("[data-magnetic]"), function (el) {
      var strength = 6;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
        var dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        el.style.transform = "translate(" + (dx * strength).toFixed(2) + "px," +
          (dy * strength).toFixed(2) + "px)";
      });
      el.addEventListener("pointerleave", function () {
        el.style.transform = "";
      });
    });
  }

  /* attesa minima prima di mostrare gli skeleton (evita il lampeggio) */
  function delayClass(el, cls, ms) {
    if (!el) return;
    window.setTimeout(function () { el.classList.add(cls); }, ms);
  }

  function boot() {
    scrollProgress();
    startReveal();
    startCounters();
    startParallax();
    startSpotlight();
    startMagnetic();
    root.classList.add("js-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.Traccia = {
    reveal: startReveal,
    counters: startCounters,
    reduced: function () { return reduced; },
    delayClass: delayClass
  };
})();
