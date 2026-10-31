/* traccia — admin console: approve/deny accounts & operations, audit. */
(function () {
  "use strict";

  var state = {
    me: null,
    accounts: [],
    operations: [],
    accountFilter: "pending",
    operationFilter: "pending",
    walletFilter: "pending",
    wallets: [],
    settings: null,
    defaults: null
  };

  var L = {
    accountsBody: document.querySelector("#accounts-table tbody"),
    opsBody: document.querySelector("#operations-table tbody"),
    allAccountsBody: document.querySelector("#all-accounts-table tbody"),
    audit: document.querySelector("[data-audit]"),
    kpiAccounts: document.querySelector("[data-kpi-accounts]"),
    cardAccounts: document.querySelector("[data-kpi-accounts]") &&
                  document.querySelector("[data-kpi-accounts]").closest(".summary-card"),
    cardOperations: document.querySelector("[data-kpi-operations]") &&
                    document.querySelector("[data-kpi-operations]").closest(".summary-card"),
    cardWallets: document.querySelector("[data-kpi-wallets]") &&
                 document.querySelector("[data-kpi-wallets]").closest(".summary-card"),
    kpiOperations: document.querySelector("[data-kpi-operations]"),
    kpiActive: document.querySelector("[data-kpi-active]"),
    kpiBalance: document.querySelector("[data-kpi-balance]"),
    countAccounts: document.querySelector("[data-count-accounts]"),
    countOperations: document.querySelector("[data-count-operations]"),
    countWallets: document.querySelector("[data-count-wallets]"),
    kpiWallets: document.querySelector("[data-kpi-wallets]"),
    walletsBody: document.querySelector("#wallets-table tbody"),
    settingsForm: document.querySelector("#settings-form"),
    messages: document.querySelector("[data-messages]"),
    messagesCount: document.querySelector("[data-messages-count]"),
    scope: document.querySelector("[data-admin-scope]")
  };

  function badgeFor(user) {
    if (user.is_master) return "master";
    return user.role === "admin" ? "admin" : null;
  }

  /* ------------------------------------------------------------ accounts -- */
  function renderAccounts() {
    var list = state.accounts;
    if (!list.length) {
      L.accountsBody.innerHTML =
        '<tr><td colspan="6" class="empty-state">Nessun account in questo stato.</td></tr>';
      return;
    }
    L.accountsBody.innerHTML = list.map(function (user) {
      var actions = [];
      if (user.is_master) {
        actions.push('<span class="xs muted">Protetto</span>');
      } else {
        if (user.status !== "active") {
          actions.push('<button class="btn btn--approve btn--sm" data-account="' +
            user.id + '" data-action="approve" type="button">Approva</button>');
        }
        if (user.status !== "denied") {
          actions.push('<button class="btn btn--deny btn--sm" data-account="' +
            user.id + '" data-action="deny" type="button">Rifiuta</button>');
        }
        if (user.status === "active") {
          actions.push('<button class="btn btn--ghost btn--sm" data-account="' +
            user.id + '" data-action="suspend" type="button">Sospendi</button>');
        }
      }
      var kyc = user.is_master
        ? '<span class="xs muted">—</span>'
        : '<select class="kyc-select" data-kyc="' + user.id + '" aria-label="Livello di verifica">' +
          [1, 2, 3].map(function (lvl) {
            return '<option value="' + lvl + '"' +
              (Number(user.kyc_level) === lvl ? " selected" : "") + ">KYC " + lvl + "</option>";
          }).join("") + "</select>";
      return "<tr>" +
        "<td><strong>" + ui.esc(user.name) + "</strong>" +
        '<div class="xs muted">' + ui.esc(user.email) + "</div></td>" +
        "<td>" + ui.when(user.created_at) + "</td>" +
        "<td>" + kyc + "</td>" +
        '<td class="num">' + ui.money(user.balance_eur) + "</td>" +
        '<td class="num">' + user.operations_count + "</td>" +
        "<td>" + ui.pill(user.status, badgeFor(user)) + "</td>" +
        '<td class="data-table__actions">' + actions.join("") + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderAllAccounts() {
    if (!state.allAccounts.length) {
      L.allAccountsBody.innerHTML =
        '<tr><td colspan="8" class="empty-state">Nessun account.</td></tr>';
      return;
    }
    L.allAccountsBody.innerHTML = state.allAccounts.map(function (user) {
      var roleBtn = "";
      if (!user.is_master && state.me && state.me.is_master) {
        var nextRole = user.role === "admin" ? "user" : "admin";
        roleBtn = '<button class="btn btn--ghost btn--sm" data-role="' + user.id +
          '" data-next="' + nextRole + '" type="button">' +
          (nextRole === "admin" ? "Rendi admin" : "Revoca admin") + "</button>";
      }
      return "<tr>" +
        "<td><strong>" + ui.esc(user.name) + "</strong></td>" +
        '<td class="xs muted">' + ui.esc(user.email) + "</td>" +
        '<td class="xs mono">' + (user.iban_formatted
          ? ui.esc(user.iban_formatted)
          : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (user.is_master
          ? '<span class="pill pill--master">Master</span>'
          : user.role === "admin"
            ? '<span class="pill pill--admin">Admin</span>'
            : '<span class="xs muted">Cliente</span>') + "</td>" +
        "<td>" + ui.pill(user.status) + "</td>" +
        '<td class="num">' + ui.money(user.balance_eur) + "</td>" +
        '<td class="num">' + (user.holdings_value
          ? ui.money(user.holdings_value)
          : '<span class="xs muted">—</span>') + "</td>" +
        '<td class="data-table__actions">' + roleBtn + "</td>" +
        "</tr>";
    }).join("");
  }

  /* ---------------------------------------------------------- operations -- */
  function renderOperations() {
    if (!state.operations.length) {
      L.opsBody.innerHTML =
        '<tr><td colspan="9" class="empty-state">Nessuna operazione in coda.</td></tr>';
      return;
    }
    L.opsBody.innerHTML = state.operations.map(function (op) {
      var actions = op.status === "pending"
        ? '<button class="btn btn--approve btn--sm" data-op="' + op.id +
          '" data-action="approve" type="button">Approva</button>' +
          '<button class="btn btn--deny btn--sm" data-op="' + op.id +
          '" data-action="deny" type="button">Rifiuta</button>'
        : '<span class="xs muted">' + ui.esc(op.decision_note || "—") + "</span>";
      var executed = op.price_eur
        ? ui.money(op.price_eur) + ' <span class="xs muted">× ' +
          ui.num(op.quantity, 6) + "</span>"
        : "—";
      return "<tr>" +
        "<td>" + ui.when(op.created_at) + "</td>" +
        "<td>" + ui.esc(op.user_name) +
        '<div class="xs muted">' + ui.esc(op.user_email) + "</div></td>" +
        "<td>" + (ui.labels[op.type] || op.type) + "</td>" +
        "<td>" + (op.symbol ? ui.esc(op.symbol) : "EUR") + "</td>" +
        '<td class="num">' + ui.money(op.amount_eur) + "</td>" +
        '<td class="num">' + executed + "</td>" +
        "<td>" + ui.pill(op.status) + "</td>" +
        '<td class="xs muted">' + ui.esc(op.decision_note || "—") + "</td>" +
        '<td class="data-table__actions">' + actions + "</td>" +
        "</tr>";
    }).join("");
  }

  /* ------------------------------------------------------------- wallets -- */
  function renderWallets() {
    if (!state.wallets.length) {
      L.walletsBody.innerHTML =
        '<tr><td colspan="7" class="empty-state">Nessun wallet in questo stato.</td></tr>';
      return;
    }
    L.walletsBody.innerHTML = state.wallets.map(function (w) {
      var actions = w.status === "pending"
        ? '<button class="btn btn--approve btn--sm" data-wallet="' + w.id +
          '" data-action="approve" type="button">Verifica</button>' +
          '<button class="btn btn--deny btn--sm" data-wallet="' + w.id +
          '" data-action="deny" type="button">Rifiuta</button>'
        : '<span class="xs muted">' + ui.esc(w.decision_note || "—") + "</span>";
      return "<tr>" +
        "<td><strong>" + ui.esc(w.user_name) + "</strong>" +
        '<div class="xs muted">' + ui.esc(w.user_email) +
        " · KYC " + (w.kyc_level || 1) + "</div></td>" +
        "<td><strong>" + ui.esc(w.symbol) + "</strong></td>" +
        '<td class="mono xs">' + ui.esc(w.address) +
        (w.challenge_done_at
          ? '<div class="delta is-up" style="margin-top:.25rem">firma acquisita</div>' +
            (w.signature
              ? '<div class="xs muted mono">' + ui.esc(String(w.signature).slice(0, 18)) + "…</div>"
              : "")
          : '<div class="xs muted" style="margin-top:.25rem">nessuna firma</div>') +
        "</td>" +
        '<td class="xs muted">' + ui.esc(w.network || "—") + "</td>" +
        "<td>" + ui.when(w.created_at) + "</td>" +
        "<td>" + ui.pill(w.status) + "</td>" +
        '<td class="data-table__actions">' + actions + "</td>" +
        "</tr>";
    }).join("");
  }

  function loadWallets() {
    return api.adminWallets(state.walletFilter || undefined).then(function (data) {
      state.wallets = data.wallets;
      renderWallets();
    });
  }

  /* ------------------------------------------------------------ settings -- */
  function renderSettings() {
    if (!state.settings) return;
    Object.keys(state.settings).forEach(function (key) {
      var input = document.querySelector('[data-setting="' + key + '"]');
      if (input) input.value = state.settings[key];
      var toggle = document.querySelector('[data-setting-bool="' + key + '"]');
      if (toggle) toggle.checked = String(state.settings[key]) === "1";
    });
  }

  /* ---------------------------------------------------------- messaggi -- */
  function renderMessages(data) {
    var rows = (data && data.messages) || [];
    if (!L.messages) return;
    if (L.messagesCount) {
      L.messagesCount.textContent = data && data.new_count
        ? data.new_count + " da leggere"
        : "nessuna nuova";
    }
    if (!rows.length) {
      L.messages.innerHTML = '<div class="empty-state">Nessuna richiesta dal sito.</div>';
      return;
    }
    L.messages.innerHTML = rows.map(function (m) {
      var pill = m.status === "new" ? "pill--pending"
               : m.status === "read" ? "pill--active" : "pill--muted";
      var cuando = ui.when(m.created_at);
      return '<div class="msg-item' + (m.status === "new" ? " msg-item--new" : "") + '">' +
        '<div class="msg-item__head">' +
          "<b>" + ui.esc(m.name) + "</b>" +
          '<a class="xs" href="mailto:' + ui.esc(m.email) + '">' + ui.esc(m.email) + "</a>" +
          '<span class="pill ' + pill + '">' +
            (m.status === "new" ? "Nuova" : m.status === "read" ? "Letta" : "Chiusa") + "</span>" +
          "<time>" + cuando + "</time>" +
        "</div>" +
        '<p class="msg-item__body">' + ui.esc(m.message) + "</p>" +
        '<div class="msg-item__foot">' +
          (m.phone ? '<span class="xs muted">' + ui.esc(m.phone) + "</span>" : "") +
          (m.amount_eur ? '<span class="xs muted">Importo dichiarato: ' +
            ui.money(m.amount_eur) + "</span>" : "") +
          (m.status !== "read" ? '<button class="btn btn--ghost btn--sm" type="button" ' +
            'data-msg-read="' + ui.esc(m.id) + '">Segna come letta</button>' : "") +
          (m.status !== "closed" ? '<button class="btn btn--ghost btn--sm" type="button" ' +
            'data-msg-close="' + ui.esc(m.id) + '">Chiudi</button>' : "") +
        "</div>" +
      "</div>";
    }).join("");

    L.messages.querySelectorAll("[data-msg-read], [data-msg-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-msg-read") || button.getAttribute("data-msg-close");
        var next = button.hasAttribute("data-msg-read") ? "read" : "closed";
        button.disabled = true;
        api.messageStatus(id, next)
          .then(function () { return loadMessages(); })
          .catch(function (err) { ui.toast(err.message, "error"); button.disabled = false; });
      });
    });
  }

  function loadMessages() {
    return api.messages().then(renderMessages)
      .catch(function (err) { ui.toast(err.message, "error"); });
  }

  function loadSettings() {
    return api.settings().then(function (data) {
      state.settings = data.settings;
      state.defaults = data.defaults;
      renderSettings();
    });
  }

  /* --------------------------------------------------------------- audit -- */
  function renderAudit(rows) {
    if (!rows.length) {
      L.audit.innerHTML = '<div class="empty-state">Nessuna attività registrata.</div>';
      return;
    }
    L.audit.innerHTML = rows.map(function (row) {
      return '<div class="audit-item">' +
        '<span class="audit-item__action">' + ui.esc(row.action) + "</span>" +
        "<span>" + ui.esc(row.actor_email || "—") + "</span>" +
        '<span class="muted">' + ui.esc(row.target || "") + "</span>" +
        (row.note ? '<span class="muted">· ' + ui.esc(row.note) + "</span>" : "") +
        "<time>" + ui.when(row.created_at) + "</time>" +
        "</div>";
    }).join("");
  }

  /* ------------------------------------------------------------ loading -- */
  function loadOverview() {
    return api.overview().then(function (data) {
      L.kpiAccounts.textContent = String(data.pending_accounts);
      L.kpiOperations.textContent = String(data.pending_operations);
      L.kpiWallets.textContent = String(data.pending_wallets || 0);
      L.countWallets.textContent = data.pending_wallets ? data.pending_wallets : "";
      L.kpiActive.textContent = String(data.active_users);
      L.kpiBalance.textContent = ui.money(data.total_balance_eur);
      L.countAccounts.textContent = data.pending_accounts ? data.pending_accounts : "";
      L.countOperations.textContent = data.pending_operations ? data.pending_operations : "";
      [[L.cardAccounts, data.pending_accounts],
       [L.cardOperations, data.pending_operations],
       [L.cardWallets, data.pending_wallets || 0]].forEach(function (pair) {
        var card = pair[0];
        if (!card) return;
        var pending = Number(pair[1]) || 0;
        card.classList.toggle("is-zero", pending === 0);
        card.classList.toggle("has-items", pending > 0);
      });
      renderAudit(data.audit);
    });
  }

  function loadAccounts() {
    return api.accounts(state.accountFilter || undefined).then(function (data) {
      state.accounts = data.accounts;
      renderAccounts();
    });
  }

  function loadAllAccounts() {
    return api.accounts().then(function (data) {
      state.allAccounts = data.accounts;
      renderAllAccounts();
    });
  }

  function loadOperations() {
    return api.operations(state.operationFilter || undefined).then(function (data) {
      state.operations = data.operations;
      renderOperations();
    });
  }

  function refresh() {
    return Promise.all([
      loadOverview(), loadAccounts(), loadAllAccounts(), loadOperations(),
      loadWallets(), loadSettings(), loadMessages()
    ]);
  }

  /* ------------------------------------------------------------- actions -- */
  function accountAction(id, action) {
    var labels = {
      approve: { title: "Prendere in carico questa segnalazione?", confirm: "Approva" },
      deny: { title: "Rifiutare questa segnalazione?", confirm: "Rifiuta", danger: true },
      suspend: { title: "Sospendere questa pratica?", confirm: "Sospendi", danger: true }
    }[action];

    ui.ask({
      title: labels.title,
      message: "L'azione viene registrata nel registro attività.",
      prompt: "Nota per il segnalante (opzionale)",
      confirm: labels.confirm,
      danger: !!labels.danger
    }).then(function (note) {
      if (note === null) return;
      return api.accountAction(id, action, note).then(function () {
        ui.toast("Pratica aggiornata.", "ok");
        return refresh();
      });
    }).catch(function (err) {
      ui.toast(err.message, "error");
    });
  }

  function operationAction(id, action, row) {
    var amount = row ? ui.money(row.amount_eur) : "";
    var what = row ? ui.labels[row.type] + " " + amount : "questa operazione";
    ui.ask({
      title: action === "approve" ? "Approvare " + what + "?" : "Rifiutare " + what + "?",
      message: action === "approve"
        ? "All'approvazione saldo e posizioni vengono aggiornati immediatamente."
        : "L'operazione viene archiviata come rifiutata.",
      prompt: "Nota (opzionale)",
      confirm: action === "approve" ? "Approva" : "Rifiuta",
      danger: action !== "approve"
    }).then(function (note) {
      if (note === null) return;
      return api.operationAction(id, action, note).then(function () {
        ui.toast(action === "approve" ? "Richiesta approvata." : "Richiesta rifiutata.",
                 action === "approve" ? "ok" : "warn");
        return refresh();
      });
    }).catch(function (err) {
      ui.toast(err.message, "error");
    });
  }

  function walletAction(id, action) {
    ui.ask({
      title: action === "approve"
        ? "Verificare questo indirizzo?"
        : "Rifiutare questo indirizzo?",
      message: action === "approve"
        ? "Il cliente potrà trasferire cripto solo verso indirizzi verificati. " +
          "Confronta asset, rete e indirizzo, e controlla che la firma di " +
          "proprietà sia presente, prima di confermare."
        : "Il cliente non potrà trasferire cripto verso questo indirizzo.",
      prompt: "Nota (opzionale)",
      confirm: action === "approve" ? "Verifica" : "Rifiuta",
      danger: action !== "approve"
    }).then(function (note) {
      if (note === null) return;
      return api.walletAction(id, action, note).then(function () {
        ui.toast(action === "approve" ? "Indirizzo verificato." : "Indirizzo rifiutato.",
                 action === "approve" ? "ok" : "warn");
        return refresh();
      });
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  function changeKyc(id, level, select) {
    ui.ask({
      title: "Impostare il livello di verifica " + level + " per questo cliente?",
      message: "Il cambio di livello modifica immediatamente i limiti giornalieri " +
               "e l'accesso ai trasferimenti cripto.",
      confirm: "Conferma"
    }).then(function (note) {
      if (note === null) return;
      return api.setKyc(id, level, "").then(function () {
        ui.toast("Livello di verifica aggiornato.", "ok");
        return refresh();
      });
    }).catch(function (err) {
      ui.toast(err.message, "error");
      if (select) select.value = String(select.dataset.previous || "");
    });
  }

  function collectSettings() {
    var out = {};
    document.querySelectorAll("[data-setting]").forEach(function (input) {
      out[input.getAttribute("data-setting")] = Number(input.value || 0);
    });
    document.querySelectorAll("[data-setting-bool]").forEach(function (input) {
      out[input.getAttribute("data-setting-bool")] = input.checked ? 1 : 0;
    });
    return out;
  }

  /* ------------------------------------------- registrazione manuale -- */
  var newModal = document.querySelector("[data-new-account-modal]");
  var newForm = document.querySelector("#new-account-form");
  var naError = document.querySelector("[data-na-error]");
  var naResult = document.querySelector("[data-na-result]");
  var lastCredentials = null;

  function openNewAccount() {
    newForm.reset();
    document.getElementById("na-kyc").value = "2";
    document.getElementById("na-status").value = "active";
    document.getElementById("na-role").value = "user";
    document.getElementById("na-balance").value = "0";
    naError.hidden = true;
    naResult.hidden = true;
    newForm.hidden = false;
    var masterOnly = document.querySelector("[data-master-only]");
    if (masterOnly) masterOnly.hidden = !(state.me && state.me.is_master);
    newModal.hidden = false;
    document.getElementById("na-name").focus();
  }

  function closeNewAccount() {
    newModal.hidden = true;
    lastCredentials = null;
  }

  document.querySelector("[data-new-account]").addEventListener("click", openNewAccount);
  document.querySelector("[data-na-cancel]").addEventListener("click", closeNewAccount);
  document.querySelector("[data-na-close]").addEventListener("click", function () {
    closeNewAccount();
    refresh().catch(function (err) { ui.toast(err.message, "error"); });
  });
  newModal.addEventListener("click", function (e) {
    if (e.target === newModal) closeNewAccount();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !newModal.hidden) closeNewAccount();
  });

  newForm.addEventListener("submit", function (e) {
    e.preventDefault();
    naError.hidden = true;
    var button = newForm.querySelector('button[type="submit"]');
    button.disabled = true;

    var payload = {
      name: document.getElementById("na-name").value.trim(),
      email: document.getElementById("na-email").value.trim(),
      password: document.getElementById("na-password").value,
      balance_eur: Number(document.getElementById("na-balance").value || 0),
      kyc_level: Number(document.getElementById("na-kyc").value),
      status: document.getElementById("na-status").value,
      note: document.getElementById("na-note").value.trim()
    };
    var roleField = document.querySelector("[data-master-only]");
    if (roleField && !roleField.hidden) {
      payload.role = document.getElementById("na-role").value;
    }

    api.createAccount(payload).then(function (res) {
      lastCredentials = res.credentials;
      newForm.hidden = true;
      naResult.hidden = false;
      document.querySelector("[data-na-summary]").textContent =
        res.user.name + " · " + (res.user.status === "active" ? "attivo" : "in attesa") +
        " · KYC " + res.user.kyc_level +
        (res.user.balance_eur ? " · saldo " + ui.money(res.user.balance_eur) : "");
      document.querySelector("[data-na-email]").textContent = res.credentials.email;
      document.querySelector("[data-na-password]").textContent = res.credentials.password;
      var ibanCell = document.querySelector("[data-na-iban]");
      if (ibanCell) ibanCell.textContent = res.user.iban_formatted || res.user.iban || "—";
      document.querySelector("[data-na-generated-note]").textContent =
        res.credentials.generated
          ? "Password generata automaticamente: copiala ora, non verrà mostrata di nuovo."
          : "Password scelta da te.";
      ui.toast("Pratica aperta.", "ok");
      return refresh();
    }).catch(function (err) {
      naError.textContent = err.message;
      naError.hidden = false;
      naError.style.color = "var(--down)";
    }).then(function () { button.disabled = false; });
  });

  document.querySelector("[data-na-copy]").addEventListener("click", function () {
    if (!lastCredentials) return;
    var text = "traccia — credenziali di accesso\n" +
      "Email: " + lastCredentials.email + "\n" +
      "Password: " + lastCredentials.password + "\n" +
      (lastCredentials.iban ? "IBAN: " + lastCredentials.iban + "\n" : "") +
      "Accedi da: " + location.origin + "/login.html";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { ui.toast("Credenziali copiate.", "ok"); })
        .catch(function () { ui.toast("Copia non disponibile.", "error"); });
    } else {
      ui.toast("Copia non supportata da questo browser.");
    }
  });

  /* --------------------------------------------------------------- bind -- */
  function bind() {
        document.querySelector(".app-side__foot [data-logout]").addEventListener("click", function (e) {
      e.preventDefault();
      if (window.TracciaSession) window.TracciaSession.logout();
      else api.logout().then(function () { location.href = "login.html?uscita=1"; });
    });

    document.querySelector("[data-refresh]").addEventListener("click", function () {
      refresh().then(function () { ui.toast("Dati aggiornati.", "ok"); })
        .catch(function (err) { ui.toast(err.message, "error"); });
    });

    L.accountsBody.addEventListener("click", function (e) {
      var button = e.target.closest("[data-account]");
      if (!button) return;
      accountAction(button.getAttribute("data-account"), button.getAttribute("data-action"));
    });

    L.opsBody.addEventListener("click", function (e) {
      var button = e.target.closest("[data-op]");
      if (!button) return;
      var id = button.getAttribute("data-op");
      var row = state.operations.filter(function (o) { return String(o.id) === id; })[0];
      operationAction(id, button.getAttribute("data-action"), row);
    });

    L.allAccountsBody.addEventListener("click", function (e) {
      var button = e.target.closest("[data-role]");
      if (!button) return;
      var next = button.getAttribute("data-next");
      ui.ask({
        title: next === "admin" ? "Conferire i permessi di amministratore?"
                               : "Revocare i permessi di amministratore?",
        message: "Solo l'account master può modificare i ruoli.",
        confirm: next === "admin" ? "Conferisci" : "Revoca",
        danger: next !== "admin"
      }).then(function (ok) {
        if (ok === null) return;
        return api.setRole(button.getAttribute("data-role"), next).then(function () {
          ui.toast("Ruolo aggiornato.", "ok");
          return refresh();
        });
      }).catch(function (err) { ui.toast(err.message, "error"); });
    });

    L.walletsBody.addEventListener("click", function (e) {
      var button = e.target.closest("[data-wallet]");
      if (!button) return;
      walletAction(button.getAttribute("data-wallet"), button.getAttribute("data-action"));
    });

    L.accountsBody.addEventListener("change", function (e) {
      var select = e.target.closest("[data-kyc]");
      if (!select) return;
      changeKyc(select.getAttribute("data-kyc"), Number(select.value), select);
    });
    L.accountsBody.addEventListener("focusin", function (e) {
      var select = e.target.closest("[data-kyc]");
      if (select) select.dataset.previous = select.value;
    });

    document.querySelector("[data-settings-save]").addEventListener("click", function () {
      api.saveSettings(collectSettings()).then(function (data) {
        state.settings = data.settings;
        renderSettings();
        ui.toast("Limiti salvati.", "ok");
        return Promise.all([loadOverview(), loadOperations()]);
      }).catch(function (err) { ui.toast(err.message, "error"); });
    });

    document.querySelector("[data-settings-reset]").addEventListener("click", function () {
      ui.ask({
        title: "Ripristinare i limiti predefiniti?",
        message: "Le impostazioni personalizzate vengono sostituite dai valori di default.",
        confirm: "Ripristina"
      }).then(function (ok) {
        if (ok === null) return;
        var defaults = {};
        Object.keys(state.defaults || {}).forEach(function (k) {
          defaults[k] = Number(state.defaults[k]);
        });
        return api.saveSettings(defaults).then(function (data) {
          state.settings = data.settings;
          renderSettings();
          ui.toast("Limiti predefiniti ripristinati.", "ok");
        });
      }).catch(function (err) { ui.toast(err.message, "error"); });
    });

    document.querySelectorAll("[data-wallet-filters] .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("[data-wallet-filters] .chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        state.walletFilter = chip.getAttribute("data-filter");
        loadWallets().catch(function (err) { ui.toast(err.message, "error"); });
      });
    });

    document.querySelectorAll("[data-account-filters] .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("[data-account-filters] .chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        state.accountFilter = chip.getAttribute("data-filter");
        loadAccounts().catch(function (err) { ui.toast(err.message, "error"); });
      });
    });

    document.querySelectorAll("[data-op-filters] .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("[data-op-filters] .chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        state.operationFilter = chip.getAttribute("data-filter");
        loadOperations().catch(function (err) { ui.toast(err.message, "error"); });
      });
    });

    document.querySelectorAll(".app-side a[data-tab]").forEach(function (link) {
      link.addEventListener("click", function () {
        document.querySelectorAll(".app-side a").forEach(function (a) {
          a.classList.remove("is-active");
        });
        link.classList.add("is-active");
      });
    });
  }

  /* --------------------------------------------------------------- boot -- */
  ui.requireAdmin().then(function (data) {
    state.me = data.user;
    document.querySelector("[data-user-name]").textContent = data.user.name;
    document.querySelector("[data-user-initials]").textContent = ui.initials(data.user.name);
    document.querySelector("[data-user-role]").textContent =
      data.user.is_master ? "Account master" : "Amministratore";
    L.scope.textContent = data.user.is_master
      ? "Accesso master: puoi approvare, rifiutare e gestire i ruoli."
      : "Accesso amministratore: puoi approvare e rifiutare. I ruoli sono riservati al master.";
    bind();
    return refresh();
  }).catch(function (err) {
    if (err && err.status && err.status !== 401) ui.toast(err.message, "error");
  });
})();
