/* traccia — stato sessione nell'header pubblico.
   Mostra "Accedi / Apri un conto" quando nessuno è collegato e
   "Area riservata / Esci" quando c'è una sessione attiva. */
(function (global) {
  "use strict";

  function cachedUser() {
    return (global.api && api.cachedUser) ? api.cachedUser() : null;
  }

  function cacheUser(user) {
    if (global.api && api.cacheUser) api.cacheUser(user);
  }

  function logout() {
    var done = function () {
      cacheUser(null);
      window.location.href = "login.html?uscita=1";
    };
    if (global.api && api.logout) api.logout().then(done, done);
    else done();
  }

  function toggleAll(slot, selector, show) {
    slot.querySelectorAll(selector).forEach(function (node) {
      node.hidden = !show;
    });
  }

  function initials(name) {
    return (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return part[0].toUpperCase(); })
      .join("");
  }

  function paint(user) {
    var slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    var isAdmin = !!(user && user.role === "admin");
    var label = user ? (user.name || user.email || "") : "";

    toggleAll(slot, "[data-auth-guest]", !user);
    toggleAll(slot, "[data-auth-member]", !!user);
    toggleAll(slot, "[data-auth-admin]", isAdmin);
    toggleAll(slot, "[data-auth-user]", !!user);
    toggleAll(slot, "[data-auth-initials]", !!user);

    slot.querySelectorAll("[data-auth-user]").forEach(function (node) {
      node.textContent = label;
    });
    slot.querySelectorAll("[data-auth-initials]").forEach(function (node) {
      node.textContent = initials(label);
    });
    slot.querySelectorAll("[data-logout]").forEach(function (node) {
      node.setAttribute("title", user ? "Esci dall'account di " + label : "Esci");
      node.setAttribute("aria-label", "Esci dall'account");
    });
  }

  function bind() {
    var slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;

    var out = slot.querySelector("[data-logout]");
    if (out) {
      out.addEventListener("click", function (e) {
        e.preventDefault();
        logout();
      });
    }

    // il token c'è? allora c'è una sessione da verificare col server
    var hasToken = false;
    try { hasToken = !!window.localStorage.getItem("traccia.session"); } catch (e) {}

    if (!hasToken || !global.api || !api.me) {
      cacheUser(null);
      paint(null);
      return;
    }

    var optimistic = cachedUser();
    paint(optimistic);

    api.me().then(function (data) {
      cacheUser(data.user);
      paint(data.user);
    }).catch(function () {
      cacheUser(null);
      paint(null);
    });
  }

  global.TracciaSession = { bind: bind, logout: logout, cachedUser: cachedUser };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})(window);
