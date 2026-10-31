/* traccia — tiny UI toolkit: formatting, toasts, modals, guards. */
(function (global) {
  "use strict";

  var eur = new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2
  });

  var dateFmt = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });

  function money(value) { return eur.format(Number(value) || 0); }
  function num(value, digits) {
    return new Intl.NumberFormat("it-IT", {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: 8
    }).format(Number(value) || 0);
  }
  function when(ts) { return ts ? dateFmt.format(new Date(ts * 1000)) : "—"; }
  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var LABELS = {
    pending: "In attesa",
    active: "Attivo",
    approved: "Approvata",
    denied: "Rifiutato",
    suspended: "Sospeso",
    cancelled: "Annullata",
    deposit: "Deposito",
    withdrawal: "Prelievo",
    buy: "Acquisto",
    sell: "Vendita",
    transfer_out: "Trasferimento"
  };

  function pill(status, extra) {
    var cls = "pill pill--" + status;
    return '<span class="' + cls + '">' + (LABELS[status] || status) + "</span>" +
      (extra ? '<span class="pill pill--' + extra + '">' +
        (extra === "master" ? "Master" : "Admin") + "</span>" : "");
  }

  /* ------------------------------------------------------------- toasts -- */
  function toastStack() {
    var el = document.querySelector(".toast-stack");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast-stack";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, kind) {
    var stack = toastStack();
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      el.style.transition = "opacity .25s, transform .25s";
      setTimeout(function () { el.remove(); }, 260);
    }, 3800);
  }

  /* -------------------------------------------------------------- modal -- */
  function ask(options) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        '<h3 id="modal-title">' + esc(options.title) + "</h3>" +
        "<p>" + esc(options.message || "") + "</p>" +
        (options.prompt
          ? '<div class="field" style="margin-top:1rem"><label for="modal-note">' +
            esc(options.prompt) + "</label>" +
            '<input id="modal-note" type="text" autocomplete="off"></div>'
          : "") +
        '<div class="btn-row">' +
        '<button class="btn btn--ghost" data-modal-cancel type="button">' +
        esc(options.cancel || "Annulla") + "</button>" +
        '<button class="btn ' + (options.danger ? "btn--deny" : "btn--accent") +
        '" data-modal-ok type="button">' + esc(options.confirm || "Conferma") + "</button>" +
        "</div></div>";

      function close(result) {
        backdrop.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") close(null);
      }

      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) close(null);
      });
      backdrop.querySelector("[data-modal-cancel]").addEventListener("click", function () {
        close(null);
      });
      backdrop.querySelector("[data-modal-ok]").addEventListener("click", function () {
        var note = backdrop.querySelector("#modal-note");
        /* null = cancelled; string (possibly empty) = confirmed */
        close(note ? note.value.trim() : "");
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(backdrop);
      var input = backdrop.querySelector("#modal-note");
      if (input) input.focus();
      else backdrop.querySelector("[data-modal-ok]").focus();
    });
  }

  /* --------------------------------------------------------------- auth -- */
  function isAuthError(err) {
    return !!(err && (err.status === 401 || err.status === 403 ||
      err.code === "28000" || err.code === "28P01" || err.code === "42501"));
  }

  function requireAuth(redirect) {
    return api.me().catch(function (err) {
      if (isAuthError(err)) {
        location.replace("login.html?next=" + encodeURIComponent(redirect || location.pathname));
      }
      throw err;
    });
  }

  function requireAdmin() {
    return requireAuth("admin.html").then(function (data) {
      if (!data.user || data.user.role !== "admin") {
        location.replace("app.html");
        throw new Error("not admin");
      }
      return data;
    });
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join("");
  }

  global.ui = {
    money: money, num: num, when: when, esc: esc,
    pill: pill, toast: toast, ask: ask,
    requireAuth: requireAuth, requireAdmin: requireAdmin, isAuthError: isAuthError,
    initials: initials, labels: LABELS
  };
})(window);
