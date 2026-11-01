/* traccia — API client.
   Parla con Supabase (PostgREST → funzioni RPC del schema `traccia`).
   Il token di sessione viaggia come parametro `p_token`; ogni funzione
   lato database verifica che sia valido. Nessun dato viene salvato in
   chiaro nel browser: qui restano solo il token e una copia dell'utente
   per l'interfaccia. */
(function (global) {
  "use strict";

  var CFG = global.TRACCIA_CONFIG || {};
  var BASE = (CFG.supabaseUrl || "").replace(/\/$/, "");
  var KEY = CFG.supabaseKey || CFG.supabaseAnonKey || "";
  var FALLBACK_KEY = CFG.supabaseAnonKey || "";
  // se il gateway rifiuta il formato nuovo di chiave si passa a quello storico
  var keySwapped = false;

  var TOKEN_KEY = "traccia.session";
  var USER_KEY = "traccia.session.user";
  var memory = {};

  /* ------------------------------------------------------------- storage -- */
  function store(op, key, value) {
    try {
      if (op === "get") return window.localStorage.getItem(key) || "";
      if (op === "set") return window.localStorage.setItem(key, value);
      return window.localStorage.removeItem(key);
    } catch (e) {
      if (op === "get") return memory[key] || "";
      if (op === "set") memory[key] = value;
      else delete memory[key];
    }
  }

  function token() { return store("get", TOKEN_KEY); }
  function setToken(value) {
    if (value) store("set", TOKEN_KEY, value);
    else store("del", TOKEN_KEY);
  }
  function cachedUser() {
    try { return JSON.parse(store("get", USER_KEY) || "null"); } catch (e) { return null; }
  }
  function cacheUser(user) {
    if (user) store("set", USER_KEY, JSON.stringify(user));
    else store("del", USER_KEY);
  }

  /* ---------------------------------------------------------------- error -- */
  /* ------------------------------------------- avviso stato connessione -- */
  var banner = null;
  var bannerTimer = null;

  function statusBanner(message, kind) {
    if (typeof document === "undefined" || !document.body) return;
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "net-status";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    banner.setAttribute("data-kind", kind || "warn");
    // il reflow forza la transizione anche se l'elemento era già visibile
    void banner.offsetWidth;
    banner.classList.add("is-visible");
    window.clearTimeout(bannerTimer);
    if (kind !== "error") {
      bannerTimer = window.setTimeout(function () { hideBanner(); }, 6000);
    }
  }

  function hideBanner() {
    if (banner) banner.classList.remove("is-visible");
  }

  function apiError(payload, status) {
    var message = "Errore di comunicazione con il server.";
    var code = null;
    if (payload) {
      message = payload.message || payload.error || payload.hint || message;
      code = payload.code || null;
    }
    if (status === 0) message = "Nessuna connessione. Controlla la rete e riprova.";
    if (code === "28000" || code === "28P01") message = message.replace(/^.*ERROR:\s*/, "");
    var err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
  }

  /* ------------------------------------------------------------- chiamate -- */
  function rpc(fn, args) {
    if (!BASE || !KEY) {
      return Promise.reject(new Error("Configurazione Supabase mancante (assets/js/config.js)."));
    }
    return send(fn, args).then(null, function (err) {
      // 401/403 con chiave pubblicabile: riprova una volta con la chiave anon
      if (!keySwapped && FALLBACK_KEY && (err.status === 401 || err.status === 403)) {
        keySwapped = true;
        KEY = FALLBACK_KEY;
        return send(fn, args);
      }
      throw err;
    });
  }

  function send(fn, args) {
    return fetch(BASE + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": KEY,
        "Authorization": "Bearer " + KEY,
        "Accept": "application/json"
      },
      body: JSON.stringify(args || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var detail = data && (data.message || data.error || data.details);
          throw apiError(data || { message: detail }, res.status);
        }
        hideBanner();
        return data;
      });
    }, function () {
      statusBanner("Nessuna connessione al database: i dati non sono aggiornati.", "error");
      throw apiError({}, 0);
    });
  }

  // ogni chiamata autenticata aggiunge il token
  function call(fn, args) {
    var payload = Object.assign({}, args || {});
    payload.p_token = token();
    return rpc(fn, payload);
  }

  /* ---------------------------------------------------------------- health -- */
  function health() {
    return rpc("health", {}).then(function (data) {
      var ok = !!(data && data.service === "traccia");
      return { ok: ok, version: data && data.version };
    });
  }

  /* ------------------------------------------------------------------ api -- */
  var api = {
    config: CFG,
    token: token,
    setToken: setToken,
    cachedUser: cachedUser,
    cacheUser: cacheUser,
    health: health,
    isDemo: function () { return false; },

    /* --- autenticazione --- */
    login: function (email, password) {
      return rpc("auth_login", { p_email: email, p_password: password })
        .then(function (data) {
          /* Il server restituisce gli errori come dati, non come eccezioni:
             un'eccezione annullerebbe la registrazione del tentativo fallito
             e il freno ai tentativi non scatterebbe mai. */
          if (data && data.ok === false) {
            var err = new Error(data.error || "Accesso non riuscito.");
            err.code = "LOGIN_REFUSED";
            throw err;
          }
          setToken(data.token);
          cacheUser(data.user);
          return data;
        });
    },
    register: function (payload) {
      return rpc("auth_register", {
        p_name: payload.name,
        p_email: payload.email,
        p_password: payload.password
      });
    },
    logout: function () {
      var current = token();
      if (!current) { setToken(""); cacheUser(null); return Promise.resolve({ ok: true }); }
      return rpc("auth_logout", { p_token: current })
        .catch(function () { /* la sessione locale va chiusa comunque */ })
        .then(function () { setToken(""); cacheUser(null); return { ok: true }; });
    },
    me: function () {
      return call("auth_me").then(function (data) {
        cacheUser(data.user);
        return data;
      });
    },
    logoutAll: function () {
      return call("auth_logout_all").then(function (data) {
        setToken(""); cacheUser(null);
        return data;
      });
    },
    changePassword: function (current, next) {
      return call("auth_change_password", { p_current: current, p_new: next });
    },

    /* --- area cliente --- */
    dashboard: function () { return call("me_dashboard"); },
    limits: function () { return call("my_limits"); },
    crypto: function () { return rpc("market", {}); },
    myOperations: function (status) { return call("my_operations", { p_status: status || null }); },
    createOperation: function (payload) {
      return call("create_operation", {
        p_type: payload.type,
        p_symbol: payload.symbol || null,
        p_amount_eur: payload.amount_eur || 0,
        p_note: payload.note || null
      });
    },
    cancelOperation: function (id) { return call("cancel_operation", { p_id: id }); },
    documents: function () { return call("my_documents"); },
    addDocument: function (payload) {
      return call("add_document", {
        p_label: payload.label,
        p_kind: payload.kind || "altro",
        p_note: payload.note || null
      });
    },
    /* --- contratto di incarico --- */
    notifications: function () { return call("my_notifications", { p_limit: 20 }); },
    readNotifications: function (id) {
      return call("mark_notifications_read", { p_id: id || null });
    },

    contract: function () { return call("my_contract"); },
    acceptContract: function () { return call("accept_contract"); },

    myWallets: function () { return call("my_wallets"); },
    addWallet: function (payload) {
      return call("add_wallet", {
        p_symbol: payload.symbol,
        p_address: payload.address,
        p_network: payload.network || null
      });
    },
    walletChallenge: function (id) { return call("wallet_challenge", { p_id: id }); },
    walletSignature: function (id, signature) {
      return call("wallet_signature", { p_id: id, p_signature: signature });
    },

    /* --- modulo contatti pubblico --- */
    contact: function (payload) {
      return rpc("contact_send", {
        p_name: payload.name,
        p_email: payload.email,
        p_message: payload.message,
        p_phone: payload.phone || null,
        p_amount_eur: payload.amount_eur || null,
        p_source: payload.source || "supporto"
      });
    },

    /* --- console analisti --- */
    overview: function () { return call("admin_overview"); },
    accounts: function (status) { return call("admin_accounts", { p_status: status || null }); },
    createAccount: function (payload) {
      return call("admin_create_account", {
        p_name: payload.name,
        p_email: payload.email,
        p_password: payload.password || null,
        p_role: payload.role || "user",
        p_status: payload.status || "active",
        p_kyc_level: payload.kyc_level || 1,
        p_balance_eur: payload.balance_eur || 0,
        p_case_amount_eur: payload.case_amount_eur || 0
      });
    },
    accountAction: function (id, action, note) {
      return call("admin_account_action", { p_id: id, p_action: action, p_note: note || null });
    },
    setRole: function (id, role) { return call("admin_set_role", { p_id: id, p_role: role }); },
    setKyc: function (id, level, note) {
      return call("admin_set_kyc", { p_id: id, p_level: level, p_note: note || null });
    },
    setPhase: function (id, phase, note, notify) {
      return call("admin_set_phase", {
        p_id: id, p_phase: phase,
        p_note: note || null,
        p_notify: notify !== false
      });
    },
    operations: function (status) { return call("admin_operations", { p_status: status || null }); },
    operationAction: function (id, action, note) {
      return call("admin_operation_action", { p_id: id, p_action: action, p_note: note || null });
    },
    adminWallets: function (status) { return call("admin_wallets", { p_status: status || null }); },
    revokeSessions: function (id) { return call("admin_revoke_sessions", { p_id: id }); },
    documents: function (status) { return call("admin_documents", { p_status: status || null }); },
    documentAction: function (id, action, note) {
      return call("admin_document_action", { p_id: id, p_action: action, p_note: note || null });
    },
    viewClient: function (id) { return call("admin_view_client", { p_user_id: id }); },
    walletAction: function (id, action, note) {
      return call("admin_wallet_action", { p_id: id, p_action: action, p_note: note || null });
    },
    settings: function () { return call("admin_settings"); },
    saveSettings: function (settings) {
      return call("admin_save_settings", { p_settings: settings || {} });
    },
    audit: function () { return call("admin_audit"); },
    messages: function (status) { return call("admin_messages", { p_status: status || null }); },
    messageStatus: function (id, status) {
      return call("admin_message_status", { p_id: id, p_status: status });
    }
  };

  global.api = api;
})(window);
