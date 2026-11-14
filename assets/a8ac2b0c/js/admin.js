/* traccia — admin console: approve/deny accounts & operations, audit. */
(function () {
  "use strict";

  var state = {
    me: null,
    accounts: [],
    richieste: [],
    richiestaFilter: "new",
    operations: [],
    accountFilter: "pending",
    /* le pratiche: che scheda è aperta e cosa si sta cercando. Stanno qui e
       non nel DOM perché il ridisegno le deve ritrovare uguali. */
    schedaPratiche: "tutte",
    ricercaPratiche: "",
    operationFilter: "pending",
    banca: { bonifici: [], mandati: [], addebiti: [], carte: [], conteggi: {} },
    walletFilter: "pending",
    wallets: [],
    documents: [],
    documentFilter: "pending",
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
    countLead: document.querySelector("[data-count-lead]"),
    kpiLead: document.querySelector("[data-kpi-lead]"),
    cardLead: document.querySelector("[data-kpi-lead]") &&
              document.querySelector("[data-kpi-lead]").closest(".summary-card"),
    richiesteBody: document.querySelector("#lead-table tbody"),
    countOperations: document.querySelector("[data-count-operations]"),
    countWallets: document.querySelector("[data-count-wallets]"),
    kpiWallets: document.querySelector("[data-kpi-wallets]"),
    walletsBody: document.querySelector("#wallets-table tbody"),
    documentsBody: document.querySelector("#documents-table tbody"),
    countDocuments: document.querySelector("[data-count-documents]"),
    kpiDocuments: document.querySelector("[data-kpi-documents]"),
    readonlyBanner: document.querySelector("[data-readonly-banner]"),
    readonlyName: document.querySelector("[data-readonly-name]"),
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
  /* «Importo segnalato»: quanto il cliente dichiara di aver perso. Prima
     questa colonna mostrava il saldo del conto, che è un'altra cosa — per una
     pratica appena aperta vale zero, e l'analista leggeva «0,00 €» dove il
     cliente aveva scritto dodicimilacinquecento. Il saldo resta visibile nella
     tabella dei conti (`renderAllAccounts`), dove significa qualcosa. */
  function importoSegnalato(user) {
    var dichiarato = Number(user.case_amount_eur) || 0;
    if (dichiarato > 0) return ui.money(dichiarato);
    var saldo = Number(user.balance_eur) || 0;
    return saldo > 0 ? ui.money(saldo) : '<span class="xs muted">—</span>';
  }

  function renderAccounts() {
    var list = state.accounts;
    if (!list.length) {
      L.accountsBody.innerHTML =
        '<tr><td colspan="9" class="empty-state">Nessun account in questo stato.</td></tr>';
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
      var fase = user.is_master
        ? '<span class="xs muted">—</span>'
        : '<select class="phase-select" data-phase="' + user.id +
          '" data-previous="' + (Number(user.case_phase) || 1) +
          '" aria-label="Fase della pratica">' +
          FASI_CLIENTE.map(function (nome, i) {
            var n = i + 1;
            return '<option value="' + n + '"' +
              (Number(user.case_phase) === n ? " selected" : "") + ">" +
              String(n).padStart(2, "0") + " · " + nome + "</option>";
          }).join("") + "</select>";

      var kyc = user.is_master
        ? '<span class="xs muted">—</span>'
        : '<select class="kyc-select" data-kyc="' + user.id + '" aria-label="Livello di verifica">' +
          [1, 2, 3].map(function (lvl) {
            return '<option value="' + lvl + '"' +
              (Number(user.kyc_level) === lvl ? " selected" : "") + ">KYC " + lvl + "</option>";
          }).join("") + "</select>";
      /* Il telefono sta sotto nome ed email, non in una colonna sua: è il
         dato per cui si apre questa tabella — si guarda una riga e si chiama.
         Nella tabella larga duecento righe il numero servirebbe a poco. */
      return "<tr>" +
        "<td><strong>" + ui.esc(user.name) + "</strong>" +
        '<div class="xs muted">' + ui.esc(user.email) + "</div>" +
        (user.phone ? '<div class="xs muted">' + ui.esc(user.phone) + "</div>" : "") +
        "</td>" +
        "<td>" + ui.when(user.created_at) + "</td>" +
        "<td>" + kyc + "</td>" +
        "<td>" + fase + "</td>" +
        '<td class="num">' + importoSegnalato(user) + "</td>" +
        '<td class="num">' + user.operations_count + "</td>" +
        "<td>" + ui.pill(user.status, badgeFor(user)) + "</td>" +
        '<td class="data-table__actions">' + actions.join("") + "</td>" +
        "</tr>";
    }).join("");
  }

  /* le cinque fasi, scritte una volta: erano ricopiate in tre punti di questo
     file, e aggiungerne una voleva dire trovarli tutti e tre */
  var FASI_CLIENTE = ["Raccolta", "Ricostruzione", "Perizia", "Denunce", "Legale"];

  /* ------------------------------------------------------------ pratiche -- */
  /* Una pratica non si legge come una riga di database: si legge come una
     persona, con accanto la cosa che le manca. Prima le tre informazioni che
     bloccano una pratica (IBAN da verificare, contratto da accettare, fase) e
     le tre che invece si cercano solo ogni tanto (saldo cripto, ruolo, numero
     di contratto) occupavano lo stesso spazio, in colonne identiche.

     Adesso: a sinistra chi è (nome, email, telefono — il telefono serve a
     chiamare, che è ciò che si fa), poi **cosa manca**, poi la fase, poi i
     soldi. Il codice pratica non è una colonna: è la prima cosa che il cliente
     dice al telefono, quindi sta nel nome, in piccolo, e si cerca. */
  function cosaManca(user) {
    var manca = [];
    if (String(user.status) === "pending") {
      manca.push({ testo: "Risposta all'apertura", tipo: "pending" });
    }
    if (!user.iban_formatted) {
      manca.push({ testo: "Coordinate bancarie", tipo: "pending" });
    } else if (!user.iban_verified) {
      manca.push({ testo: "Verifica IBAN", tipo: "verify" });
    }
    if (!user.contract_number) {
      manca.push({ testo: "Contratto da generare", tipo: "pending" });
    } else if (user.contract_status !== "accepted") {
      manca.push({ testo: "Contratto da accettare", tipo: "pending" });
    }
    if (!user.phone) {
      manca.push({ testo: "Telefono", tipo: "muted" });
    }
    return manca;
  }

  /* le quattro domande che si fanno davvero su un elenco di pratiche */
  function inScheda(user, scheda) {
    var manca = cosaManca(user).map(function (m) { return m.testo; });
    if (scheda === "da-rispondere") return String(user.status) === "pending";
    if (scheda === "da-completare") {
      return manca.some(function (m) {
        return m === "Coordinate bancarie" || m === "Contratto da generare" ||
               m === "Contratto da accettare" || m === "Telefono";
      });
    }
    if (scheda === "da-verificare") return manca.indexOf("Verifica IBAN") > -1;
    return true;
  }

  /* la ricerca: nome, email, telefono e codice pratica. Il codice perché è
     l'unica cosa che il cliente ha in mano quando chiama. */
  function corrisponde(user, q) {
    if (!q) return true;
    /* Due versioni dello stesso testo: com'è scritto, e senza separatori.
       Chi cerca un numero di telefono lo scrive «3331112222», non «+39 333
       111 2222» — ed è il momento in cui ha il cliente in linea. Vale lo
       stesso per l'IBAN, che si legge a gruppi di quattro. */
    var grezzo = [
      user.name, user.email, user.phone, user.case_ref, user.contract_number,
      user.iban_formatted
    ].join(" ").toLowerCase();
    var compatto = grezzo.replace(/[^a-z0-9]/g, "");
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (pezzo) {
      var p = pezzo.replace(/[^a-z0-9]/g, "");
      return grezzo.indexOf(pezzo) > -1 || (p.length > 2 && compatto.indexOf(p) > -1);
    });
  }

  function praticheVisibili() {
    var q = state.ricercaPratiche || "";
    return (state.allAccounts || []).filter(function (user) {
      return inScheda(user, state.schedaPratiche || "tutte") && corrisponde(user, q);
    });
  }

  function renderAllAccounts() {
    var tutte = state.allAccounts || [];

    /* i numeri delle schede: si contano sulle pratiche vere, non su un totale
       scritto a mano — ed è il motivo per cui prima non c'erano */
    ["tutte", "da-rispondere", "da-completare", "da-verificare"].forEach(function (scheda) {
      var nodo = document.querySelector('[data-quante="' + scheda + '"]');
      if (!nodo) return;
      var n = tutte.filter(function (u) { return inScheda(u, scheda); }).length;
      nodo.textContent = n ? String(n) : "";
      conta(nodo, n);
    });
    var conteggio = document.querySelector("[data-pratiche-conteggio]");
    if (conteggio) {
      var visibili = praticheVisibili().length;
      conteggio.textContent = visibili === tutte.length
        ? tutte.length + (tutte.length === 1 ? " pratica" : " pratiche")
        : visibili + " di " + tutte.length + " pratiche";
    }

    if (!tutte.length) {
      L.allAccountsBody.innerHTML =
        '<tr><td colspan="5" class="empty-state">' +
        "Nessuna pratica. Le pratiche nascono da «Nuova pratica» o da una " +
        "segnalazione dal sito.</td></tr>";
      return;
    }
    var visibili = praticheVisibili();
    if (!visibili.length) {
      /* «Caricamento…» che resta lì è il difetto da cui nasce questa console:
         se non c'è niente, va detto **perché** e cosa fare */
      var perRicerca = (state.ricercaPratiche || "").length > 0;
      L.allAccountsBody.innerHTML =
        '<tr><td colspan="5" class="empty-state">' +
        (perRicerca
          ? "Nessuna pratica corrisponde a «" + ui.esc(state.ricercaPratiche) +
            "». Prova con il codice pratica, o cancella la ricerca."
          : "Nessuna pratica in questa scheda. Le altre schede in alto hanno il " +
            "numero di pratiche che contengono.") +
        "</td></tr>";
      return;
    }

    L.allAccountsBody.innerHTML = visibili.map(function (user) {
      /* Prima si corregge, poi si guarda: «Modifica» è il pulsante che si
         cerca quando un nome è sbagliato, e deve stare sulla riga dove il nome
         è sbagliato — non dietro un menu, o si finisce a farlo col SQL.

         Le azioni sono tre, ma non uguali: «Apri» è quella che si preme
         sempre ed è colorata; le altre due sono in secondo piano. Prima erano
         tre pulsanti identici e si rileggeva ogni volta quale serviva. */
      var editBtn = user.is_master ? "" :
        '<button class="btn btn--ghost btn--sm" type="button" data-modifica="' +
        user.id + '" title="Correggi nome, contatti, importo e fase">Modifica</button>';
      var killBtn = user.is_master ? "" :
        '<button class="btn btn--ghost btn--sm" type="button" data-kill="' +
        user.id + '" title="Chiudi tutte le sessioni di questo account">Esci</button>';
      var openBtn = '<button class="btn btn--accent btn--sm" data-open="' + user.id +
        '" data-open-name="' + ui.esc(user.name) + '" type="button">Apri</button>';

      var manca = cosaManca(user);
      var statoManca = manca.length
        ? manca.map(function (m) {
            return '<span class="pill pill--' + (m.tipo === "muted" ? "muted" : m.tipo) +
              '">' + ui.esc(m.testo) + "</span>";
          }).join("")
        : '<span class="pill pill--active">Completa</span>';

      var contatti = [user.email, user.phone].filter(Boolean).map(function (v) {
        return '<span class="pratica__contatto">' + ui.esc(v) + "</span>";
      }).join("");

      return '<tr class="pratica">' +
        '<td class="pratica__chi">' +
          '<strong>' + ui.esc(user.name) + "</strong>" +
          (user.is_master ? ' <span class="pill pill--master">Master</span>' : "") +
          '<div class="pratica__dettagli">' + contatti +
          (user.case_ref
            ? '<span class="pratica__codice mono" title="Codice pratica">' +
              ui.esc(user.case_ref) + "</span>"
            : "") +
          "</div>" +
        "</td>" +
        '<td class="pratica__manca">' + statoManca + "</td>" +
        '<td class="pratica__fase"><span class="pill pill--phase">' +
          String(Number(user.case_phase) || 1).padStart(2, "0") + " · " +
          FASI_CLIENTE[Math.max(0, Math.min(4, Number(user.case_phase || 1) - 1))] +
          "</span></td>" +
        '<td class="num pratica__soldi">' + ui.money(user.balance_eur) +
          (user.holdings_value
            ? '<div class="xs muted">+ ' + ui.money(user.holdings_value) + " cripto</div>"
            : "") +
        "</td>" +
        '<td class="data-table__actions">' + editBtn + killBtn + openBtn + "</td>" +
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

  /* ------------------------------------------------------------ documenti -- */
  function renderDocuments() {
    if (!L.documentsBody) return;
    var list = state.documents;
    if (!list.length) {
      L.documentsBody.innerHTML =
        '<tr><td colspan="7" class="empty-state">Nessun documento in questo stato.</td></tr>';
      return;
    }
    L.documentsBody.innerHTML = list.map(function (doc) {
      var azioni = doc.status === "pending"
        ? '<button class="btn btn--accent btn--sm" data-doc="' + doc.id +
          '" data-doc-action="approve" type="button">Accetta</button>' +
          '<button class="btn btn--ghost btn--sm" data-doc="' + doc.id +
          '" data-doc-action="deny" type="button">Rifiuta</button>'
        : '<span class="xs muted">' + ui.when(doc.decided_at) + "</span>";

      return "<tr>" +
        "<td><strong>" + ui.esc(doc.user_name) + "</strong>" +
          '<div class="xs muted">' + ui.esc(doc.case_ref || doc.user_email) + "</div></td>" +
        "<td>" + ui.esc(doc.label) +
          (doc.has_file
            ? ' <button class="link-arrow xs" type="button" data-doc-file="' + doc.id +
              '">Apri file</button>'
            : ' <span class="xs muted">nessun file</span>') + "</td>" +
        '<td class="xs muted">' + ui.esc(documentKind(doc.kind)) + "</td>" +
        '<td class="xs muted">' + ui.when(doc.created_at) + "</td>" +
        "<td>" + ui.pill(doc.status) + "</td>" +
        '<td class="xs muted">' + ui.esc(doc.decision_note || doc.note || "—") + "</td>" +
        '<td class="data-table__actions">' + azioni + "</td>" +
        "</tr>";
    }).join("");
  }

  function documentKind(kind) {
    var nomi = {
      identita: "Documento d'identità",
      residenza: "Prova di residenza",
      reddito: "Documentazione reddituale",
      bancario: "Estratto conto",
      contratto: "Contratto",
      altro: "Altro"
    };
    return nomi[kind] || kind || "Altro";
  }

  function loadDocuments() {
    if (!L.documentsBody) return Promise.resolve();
    return api.documents(state.documentFilter || undefined).then(function (data) {
      state.documents = data.documents || [];
      renderDocuments();
      if (L.countDocuments) {
        conta(L.countDocuments, data.pending_count);
      }
      if (L.kpiDocuments) L.kpiDocuments.textContent = String(data.pending_count || 0);
    });
  }

  function documentAction(id, action) {
    var rifiuto = action === "deny";
    ui.ask({
      title: rifiuto ? "Rifiutare questo documento?" : "Accettare questo documento?",
      message: rifiuto
        ? "Il cliente riceverà la tua nota e potrà caricare un nuovo documento."
        : "Il documento risulterà acquisito nella pratica del cliente.",
      prompt: rifiuto ? "Cosa deve correggere il cliente? (in italiano)" : "Nota interna (opzionale)",
      confirm: rifiuto ? "Rifiuta" : "Accetta",
      danger: rifiuto
    }).then(function (note) {
      if (note === null) return;
      if (rifiuto && !note) {
        ui.toast("Per rifiutare serve una nota: il cliente deve sapere cosa correggere.", "error");
        return;
      }
      return api.documentAction(id, action, note).then(function () {
        ui.toast(rifiuto ? "Documento da ricaricare." : "Documento acquisito.", "ok");
        return loadDocuments();
      });
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  /* ------------------------------------------------- sola lettura cliente -- */
  /* Apre l'area del cliente in una scheda nuova con una sessione `staff`:
     il database marca quella sessione come sola lettura e `need_write_user`
     rifiuta ogni scrittura. Nessuna azione viene registrata a nome del
     cliente, quindi non c'è impersonificazione. */
  function openClient(id, nome) {
    api.viewClient(id).then(function (data) {
      var chiave = "traccia.staff_view";
      try {
        window.localStorage.setItem(chiave, JSON.stringify({
          token: data.token,
          user: data.user,
          nome: nome || (data.user && data.user.name) || "",
          scade: Date.now() + (data.expires_in || 7200) * 1000
        }));
      } catch (e) {
        ui.toast("Il browser blocca la memoria locale: apri l'area del cliente senza schede anonime.", "error");
        return;
      }
      var scheda = window.open("app.html?staff=1", "_blank", "noopener");
      if (!scheda) ui.toast("Il browser ha bloccato la scheda: consentine l'apertura per questa console.", "error");
      else ui.toast("Aperta la pratica di " + (nome || "cliente") + " in sola lettura.", "ok");
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  /* --------------------------------------------------------------- audit -- */
  /* ------------------------------------------------- correggere la pratica -- */
  /* Un pannello solo: nome, contatti, importo, nota **e** la fase, nella
     stessa finestra.

     Perché insieme: la fase oggi sta in una scheda diversa («Nuove segnalazioni
     in attesa») da quella dove si guarda la pratica («Tutte le pratiche»).
     Cambiarla voleva dire cambiare pannello, ritrovare la riga, tornare
     indietro — ed è così che si finisce a farlo fuori dal sito. I due lavori
     si fanno sulla stessa persona, nello stesso momento, e il pannello lo
     rispetta.

     Il salvataggio manda **solo i campi cambiati**: se non cambia niente, non
     parte nessuna chiamata e non si scrive niente nel registro. Un registro
     pieno di «modificata» senza modifiche è un registro che non si legge. */
  function modificaPratica(id) {
    var pratica = (state.allAccounts || []).filter(function (u) {
      return String(u.id) === String(id);
    })[0];
    if (!pratica) {
      ui.toast("Pratica non trovata: ricarica la pagina.", "error");
      return;
    }
    var faseAttuale = Number(pratica.case_phase) || 1;

    return ui.form({
      title: "Pratica " + (pratica.case_ref || "") + " · " + (pratica.name || ""),
      message: "Le correzioni restano nel registro attività. Il cliente non riceve un avviso: " +
               "correggere un dato sbagliato non è una novità della pratica.",
      confirm: "Salva",
      campi: [
        { nome: "name", etichetta: "Nome completo", valore: pratica.name || "" },
        { nome: "phone", etichetta: "Telefono", tipo: "tel", valore: pratica.phone || "",
          suggerimento: "Con il prefisso: è il numero che si chiama." },
        { nome: "first_name", etichetta: "Nome proprio", valore: pratica.first_name || "" },
        { nome: "last_name", etichetta: "Cognome", valore: pratica.last_name || "" },
        { nome: "case_amount_eur", etichetta: "Importo segnalato", tipo: "number",
          valore: Number(pratica.case_amount_eur) || 0,
          suggerimento: "Quanto dichiara di aver perso, non il saldo del conto." },
        { nome: "fase", etichetta: "Fase della pratica", tipo: "select", valore: faseAttuale,
          opzioni: FASI_CLIENTE.map(function (nome, i) {
            return { valore: i + 1, testo: String(i + 1).padStart(2, "0") + " · " + nome };
          }) },
        { nome: "notes", etichetta: "Nota interna", tipo: "textarea",
          valore: pratica.notes || "",
          suggerimento: "La vede solo l'ufficio. Non arriva al cliente." }
      ]
    }).then(function (dati) {
      if (dati === null) return;   /* annullato: non si tocca niente */

      /* solo quello che è cambiato davvero */
      var corpo = {};
      if (dati.name.trim() !== (pratica.name || "")) corpo.name = dati.name.trim();
      if (dati.phone.trim() !== (pratica.phone || "")) corpo.phone = dati.phone.trim();
      if (dati.first_name.trim() !== (pratica.first_name || "")) corpo.first_name = dati.first_name.trim();
      if (dati.last_name.trim() !== (pratica.last_name || "")) corpo.last_name = dati.last_name.trim();
      var importo = Number(dati.case_amount_eur);
      if (importo !== Number(pratica.case_amount_eur || 0)) corpo.case_amount_eur = importo;
      if (dati.notes.trim() !== (pratica.notes || "")) corpo.notes = dati.notes.trim();

      var faseScelta = Number(dati.fase);
      var faseCambiata = faseScelta !== faseAttuale;
      var lavori = [];
      var campiCambiati = Object.keys(corpo).length;

      if (campiCambiati) {
        lavori.push(api.salvaPratica(id, corpo).then(function (res) {
          return campiCambiati;
        }));
      }
      if (faseCambiata) {
        /* l'avviso al cliente si chiede quando la fase cambia davvero, e
           riguarda la fase, non la correzione di un refuso */
        lavori.push(ui.ask({
          title: "Portare la pratica alla fase " + faseScelta + " · " + FASI_CLIENTE[faseScelta - 1] + "?",
          message: "Il cliente vedrà la nuova fase nel suo cruscotto.",
          prompt: "Nota per il cliente (facoltativa)",
          confirm: "Sposta di fase"
        }).then(function (nota) {
          if (nota === null) return 0;
          return api.setPhase(id, faseScelta, nota, true).then(function () { return 1; });
        }));
      }

      if (!lavori.length) {
        ui.toast("Niente da salvare: non hai cambiato nulla.", "ok");
        return;
      }

      return Promise.all(lavori).then(function (esiti) {
        var quanti = esiti.reduce(function (a, b) { return a + (b || 0); }, 0);
        ui.toast(quanti ? "Pratica aggiornata." : "Nessuna modifica.", "ok");
        return refresh();
      });
    }).catch(function (err) {
      ui.toast(err.message, "error");
    });
  }

  /* ------------------------------------------------------- da fare adesso --
     Le quattro (cinque) cose che aspettano una persona, in cima alla pagina e
     come collegamenti: si legge quanto c'è, si clicca, si è lì.

     Zero non si mostra — un riquadro con dentro «0 da chiamare» insegna a
     ignorare il riquadro. Se sono tutti zero sparisce il blocco intero. */
  function aggiornaDaFare(numeri) {
    var blocco = document.querySelector("[data-da-fare]");
    if (!blocco) return;
    var qualcosa = false;
    Object.keys(numeri).forEach(function (chiave) {
      var voce = document.querySelector("[data-da-fare-" + chiave + "]");
      var cifra = document.querySelector("[data-da-fare-" + chiave + "-n]");
      var quanti = Number(numeri[chiave]) || 0;
      if (voce) voce.hidden = quanti === 0;
      if (cifra) cifra.textContent = String(quanti);
      if (quanti > 0) qualcosa = true;
    });
    blocco.hidden = !qualcosa;
  }

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
  /* Un numero accanto a una voce di menu è un avviso: «qualcuno aspetta te».
     Zero non si mostra, e nemmeno una pastiglia vuota: prima erano undici
     `span` vuoti con un margine, che allargavano il menu senza dire niente.
     Qui c'è un posto solo che decide — scrivere il numero e accendere la
     pastiglia — perché sparsa su cinque funzioni è la stessa cosa detta in
     cinque modi, e basta dimenticarne uno. */
  function conta(nodo, quanti) {
    if (!nodo) return;
    var n = Number(quanti) || 0;
    nodo.textContent = n > 0 ? String(n) : "";
    nodo.classList.toggle("is-numerato", n > 0);
    nodo.classList.toggle("is-hot", n > 0);
  }

  function loadOverview() {
    return api.overview().then(function (data) {
      L.kpiAccounts.textContent = String(data.pending_accounts);
      L.kpiOperations.textContent = String(data.pending_operations);
      L.kpiWallets.textContent = String(data.pending_wallets || 0);
      conta(L.countWallets, data.pending_wallets);
      L.kpiActive.textContent = String(data.active_users);
      L.kpiBalance.textContent = ui.money(data.total_balance_eur);
      conta(L.countAccounts, data.pending_accounts);
      conta(L.countOperations, data.pending_operations);
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
      state.pendingAccounts = Number(data.pending_accounts) || 0;
      state.pendingOperations = Number(data.pending_operations) || 0;
      state.pendingWallets = Number(data.pending_wallets) || 0;
      state.pendingDocuments = Number(data.pending_documents) || 0;
      aggiornaDaFare({
        lead: state.leadNew || 0,
        richieste: state.pendingAccounts,
        operazioni: state.pendingOperations,
        wallet: state.pendingWallets,
        documenti: state.pendingDocuments,
      });
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

  /* --------------------------------------------------------------- banca -- */
  /* Tre code e una tabella: bonifici da mandare alla banca, mandati firmati,
     addebiti da incassare, carte da attivare. Il conteggio in cima esiste
     perché queste sono le cose che, se nessuno guarda, si fermano. */
  function renderBanca(dati) {
    state.banca = dati || {};
    var c = (dati && dati.conteggi) || {};

    var kp = {
      "[data-banca-kpi-queued]": c.bonifici_da_inviare || 0,
      "[data-banca-kpi-sent]": c.bonifici_inviati || 0,
      "[data-banca-kpi-debits]": c.addebiti_aperti || 0,
      "[data-banca-kpi-cards]": c.carte_da_attivare || 0
    };
    Object.keys(kp).forEach(function (sel) {
      var nodo = document.querySelector(sel);
      if (nodo) {
        nodo.textContent = String(kp[sel]);
        nodo.classList.toggle("is-alert", kp[sel] > 0);
      }
    });
    conta(document.querySelector("[data-count-banca]"),
      (c.bonifici_da_inviare || 0) + (c.addebiti_aperti || 0) + (c.carte_da_attivare || 0));

    caricaConferme();
    renderBonifici(dati && dati.bonifici);
    renderMandati(dati && dati.mandati);
    renderAddebiti(dati && dati.addebiti);
    renderCarte(dati && dati.carte);
    popolaClientiEntrata();
  }

  function esitoBottoni(t) {
    if (t.status === "queued") {
      return '<button class="btn btn--approve btn--sm" data-bonifica="' +
        ui.esc(t.id) + '" data-azione="invia" type="button">Invia alla banca</button>';
    }
    if (t.status === "sent") {
      return '<button class="btn btn--ghost btn--sm" data-bonifica="' +
        ui.esc(t.id) + '" data-azione="esito" type="button">Registra esito</button>';
    }
    return '<span class="xs muted">' + ui.esc(t.remittance || "—") + "</span>";
  }

  function renderBonifici(lista) {
    var corpo = document.querySelector("#bonifici-table tbody");
    if (!corpo) return;
    if (!lista || !lista.length) {
      corpo.innerHTML = '<tr><td colspan="7" class="empty-state">Nessun bonifico.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map(function (t) {
      return "<tr>" +
        '<td class="mono xs">' + ui.esc(t.reference) + "</td>" +
        "<td><strong>" + ui.esc(t.user_name) + "</strong>" +
          '<div class="xs muted">' + ui.esc(t.user_email) + "</div></td>" +
        "<td>" + ui.esc(t.beneficiary_name) +
          '<div class="xs mono muted">' + ui.esc(t.beneficiary_iban) + "</div></td>" +
        '<td class="num">' + ui.money(t.amount_eur) + "</td>" +
        "<td>" + ui.esc(t.scheme === "sepa_instant" ? "Istantaneo" : "Ordinario") + "</td>" +
        "<td>" + pillBanca(t.status) + "</td>" +
        '<td class="data-table__actions">' + esitoBottoni(t) + "</td>" +
      "</tr>";
    }).join("");
  }

  function renderMandati(lista) {
    var corpo = document.querySelector("#mandati-table tbody");
    if (!corpo) return;
    if (!lista || !lista.length) {
      corpo.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun mandato.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map(function (m) {
      var azioni = m.status === "active"
        ? '<button class="btn btn--ghost btn--sm" data-addebito="' + ui.esc(m.id) +
          '" type="button">Presenta addebito</button>'
        : '<span class="xs muted">revocato</span>';
      return "<tr>" +
        '<td class="mono xs">' + ui.esc(m.reference) + "</td>" +
        "<td><strong>" + ui.esc(m.user_name) + "</strong>" +
          '<div class="xs muted">' + ui.esc(m.user_email) + "</div></td>" +
        "<td>" + ui.esc(m.creditor_name) + "</td>" +
        "<td>" + ui.esc(m.scheme === "b2b" ? "B2B" : "CORE") + "</td>" +
        "<td>" + pillBanca(m.status) + "</td>" +
        '<td class="data-table__actions">' + azioni + "</td>" +
      "</tr>";
    }).join("");
  }

  function renderAddebiti(lista) {
    var corpo = document.querySelector("#addebiti-table tbody");
    if (!corpo) return;
    if (!lista || !lista.length) {
      corpo.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun addebito aperto.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map(function (b) {
      return "<tr>" +
        '<td class="mono xs">' + ui.esc(b.reference) + "</td>" +
        "<td>" + ui.esc(b.user_name) + "</td>" +
        "<td>" + ui.esc(b.creditor_name) + "</td>" +
        '<td class="num">' + ui.money(b.amount_eur) + "</td>" +
        "<td>" + ui.when(b.due_date) + "</td>" +
        '<td class="data-table__actions">' +
          '<button class="btn btn--approve btn--sm" data-addebito-esito="' + ui.esc(b.id) +
            '" data-azione="collected" type="button">Incassa</button>' +
          '<button class="btn btn--deny btn--sm" data-addebito-esito="' + ui.esc(b.id) +
            '" data-azione="refused" type="button">Rifiuta</button>' +
        "</td>" +
      "</tr>";
    }).join("");
  }

  function renderCarte(lista) {
    var corpo = document.querySelector("#carte-table tbody");
    if (!corpo) return;
    if (!lista || !lista.length) {
      corpo.innerHTML = '<tr><td colspan="7" class="empty-state">Nessuna carta.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map(function (c) {
      var azioni = "";
      if (c.status === "pending") {
        azioni = '<button class="btn btn--approve btn--sm" data-carta="' + ui.esc(c.id) +
          '" data-azione="approve" type="button">Attiva</button>' +
          '<button class="btn btn--deny btn--sm" data-carta="' + ui.esc(c.id) +
          '" data-azione="deny" type="button">Rifiuta</button>';
      } else if (c.status === "active") {
        azioni = '<button class="btn btn--deny btn--sm" data-carta="' + ui.esc(c.id) +
          '" data-azione="block" type="button">Blocca</button>';
      }
      return "<tr>" +
        '<td class="mono xs">' + ui.esc(c.reference) + "</td>" +
        "<td><strong>" + ui.esc(c.user_name) + "</strong>" +
          '<div class="xs muted">' + ui.esc(c.user_email) + "</div></td>" +
        '<td class="mono">•••• ' + ui.esc(c.last4) + "</td>" +
        '<td class="num">' + ui.money(c.monthly_cap_eur) + "</td>" +
        "<td>" + ui.when(c.expires_on) + "</td>" +
        "<td>" + pillBanca(c.status) + "</td>" +
        '<td class="data-table__actions">' + azioni + "</td>" +
      "</tr>";
    }).join("");
  }

  /* Gli stati della banca non sono quelli delle operazioni: «inviato» qui
     vuol dire «aspetta la banca», non «in attesa di un analista». */
  var ETICHETTE_BANCA = {
    queued: ["In coda", "pending"],
    sent: ["Inviato", "pending"],
    executed: ["Eseguito", "active"],
    rejected: ["Respinto", "rejected"],
    returned: ["Restituito", "rejected"],
    cancelled: ["Annullato", "cancelled"],
    active: ["Attivo", "active"],
    revoked: ["Revocato", "cancelled"],
    pending: ["In attesa", "pending"],
    collected: ["Incassato", "active"],
    refused: ["Rifiutato", "rejected"],
    blocked: ["Bloccata", "rejected"]
  };

  function pillBanca(stato) {
    var e = ETICHETTE_BANCA[stato] || [stato, "pending"];
    return '<span class="pill pill--' + e[1] + '">' + ui.esc(e[0]) + "</span>";
  }

  function loadBanca() {
    return api.adminBanca().then(renderBanca);
  }

  function popolaClientiEntrata() {
    var sel = document.querySelector("[data-entrata-cliente]");
    if (!sel || sel.options.length) return;
    var clienti = (state.allAccounts || []).filter(function (u) { return u.role !== "admin"; });
    sel.innerHTML = clienti.map(function (u) {
      return '<option value="' + ui.esc(u.id) + '">' + ui.esc(u.name) + " — " +
        ui.esc(u.email) + "</option>";
    }).join("") || '<option value="">Nessun cliente</option>';
  }

  function apriEntrata() {
    var modale = document.querySelector("[data-entrata-modal]");
    if (!modale) return;
    popolaClientiEntrata();
    modale.querySelector("[data-entrata-form]").reset();
    modale.querySelector("[data-entrata-error]").hidden = true;
    var oggi = new Date().toISOString().slice(0, 10);
    modale.querySelector("#ent-valuta").value = oggi;
    modale.hidden = false;
  }

  function inviaEntrata(event) {
    event.preventDefault();
    var modale = document.querySelector("[data-entrata-modal]");
    var errore = modale.querySelector("[data-entrata-error]");
    var submit = modale.querySelector("[data-entrata-submit]");
    var dati = {
      userId: modale.querySelector("#ent-cliente").value,
      importo: Number(modale.querySelector("#ent-importo").value),
      valuta: modale.querySelector("#ent-valuta").value || null,
      ordinante: modale.querySelector("#ent-ordinante").value.trim(),
      causale: modale.querySelector("#ent-causale").value.trim()
    };
    if (!dati.userId || !dati.importo || dati.importo <= 0) {
      errore.hidden = false;
      errore.textContent = "Scegli il segnalante e un importo maggiore di zero.";
      return;
    }
    submit.disabled = true;
    api.bonificoEntrata(dati).then(function (res) {
      modale.hidden = true;
      ui.toast("Bonifico " + (res.reference || "") + " registrato: saldo " + ui.money(res.balance_after) + ".", "ok");
      return refresh();
    }).catch(function (err) {
      errore.hidden = false;
      errore.textContent = err.message || "Bonifico non registrato.";
    }).then(function () { submit.disabled = false; });
  }

  var esitoState = { id: null };

  function apriEsito(id) {
    var modale = document.querySelector("[data-esito-modal]");
    if (!modale) return;
    var t = (state.banca && state.banca.bonifici || []).filter(function (x) {
      return String(x.id) === String(id);
    })[0];
    esitoState.id = id;
    var intro = modale.querySelector("[data-esito-intro]");
    if (intro) {
      intro.textContent = t
        ? (t.reference + " · " + ui.money(t.amount_eur) + " a " + t.beneficiary_name +
           " · " + t.beneficiary_iban)
        : "";
    }
    modale.querySelector("[data-esito-form]").reset();
    modale.querySelector("[data-esito-error]").hidden = true;
    modale.hidden = false;
  }

  function inviaEsito(event) {
    event.preventDefault();
    var modale = document.querySelector("[data-esito-modal]");
    var errore = modale.querySelector("[data-esito-error]");
    var submit = modale.querySelector("[data-esito-submit]");
    submit.disabled = true;
    api.esitoBonifico(
      esitoState.id,
      modale.querySelector("#esito-scelta").value,
      modale.querySelector("#esito-codice").value.trim(),
      modale.querySelector("#esito-messaggio").value.trim()
    ).then(function (res) {
      modale.hidden = true;
      ui.toast(res.status === "executed"
        ? "Bonifico eseguito: movimento scritto."
        : "Esito registrato: i fondi sono di nuovo disponibili.", "ok");
      return refresh();
    }).catch(function (err) {
      errore.hidden = false;
      errore.textContent = err.message || "Esito non registrato.";
    }).then(function () { submit.disabled = false; });
  }

  function presentaAddebito(mandatoId) {
    /* ui.ask è il dialogo già usato dalla console: un importo e un motivo */
    ui.ask({
      title: "Presentare un addebito?",
      message: "L'importo viene addebitato al cliente con il mandato firmato.",
      prompt: "Importo in euro",
      confirm: "Presenta"
    }).then(function (valore) {
      var n = Number(String(valore || "").replace(",", "."));
      if (!n || n <= 0) return;
      return api.addebitoCrea(mandatoId, n, null).then(function (res) {
        ui.toast("Addebito " + (res.reference || "") + " presentato.", "ok");
        return refresh();
      });
    }).catch(function (err) {
      if (err && err.message) ui.toast(err.message, "error");
    });
  }

  function azioneBanca(id, azione) {
    if (azione === "invia") {
      api.inviaBonifico(id).then(function () {
        ui.toast("Bonifico inviato alla banca.", "ok");
        return refresh();
      }).catch(function (err) { ui.toast(err.message, "error"); });
    } else if (azione === "esito") {
      apriEsito(id);
    }
  }

  function azioneAddebito(id, esito) {
    api.addebitoEsito(id, esito).then(function (res) {
      ui.toast(res.status === "collected"
        ? "Addebito incassato."
        : "Addebito rifiutato" + (res.reason ? ": " + res.reason : "."), "ok");
      return refresh();
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  function azioneCarta(id, azione) {
    api.cartaAzione(id, azione).then(function (res) {
      ui.toast("Carta: " + res.status + ".", "ok");
      return refresh();
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  function maturaInteressi() {
    api.maturaInteressi(null).then(function (res) {
      ui.toast(res.message || ("Maturazioni scritte: " + res.accrued + " · " + ui.money(res.total_eur || 0)),
        "ok");
      return refresh();
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  /* ------------------------------------------- conferme dei bonifici -- */
  /* Il codice non arriva al cliente da solo: il progetto non ha un servizio di
     posta configurato, e un codice «inviato» che nessuno riceve sarebbe il
     blocco di ieri in un'altra forma. Lo legge un analista, lo comunica, e il
     database annota chi e quando. Quando ci sarà un servizio di posta, cambia
     solo questa funzione: il flusso del cliente non sa come il codice arriva.
     Mostrarlo qui e non nel sito è la differenza fra un secondo fattore e una
     password scritta sul muro.

     Perché la tabella mostra anche le richieste scadute e non solo le «aperte».
     Prima sparivano nell'istante in cui morivano: il cliente diceva «non ricevo
     il codice», e qui non c'era più niente da guardare. Una riga scaduta non è
     rumore, è la spiegazione di quello che il cliente ha appena visto — e
     l'unico posto da cui si possono restituire i suoi soldi con «Rilascia». */

  /* Minuti che restano, ricalcolati dall'orologio del browser a ogni giro:
     `minuti_rimasti` arriva dal server, ma la tabella può restare aperta per
     mezz'ora e un numero fermo direbbe una bugia. */
  function minutiRimasti(c) {
    if (c.stato === "scaduta" || c.stato === "annullata" || c.stato === "usata") return 0;
    if (typeof c.scade_il !== "number") return c.minuti_rimasti || 0;
    return Math.max(0, Math.ceil((c.scade_il * 1000 - Date.now()) / 60000));
  }

  function azioneConferma(c) {
    var id = ui.esc(c.id);
    if (c.stato === "scaduta" || c.stato === "annullata") {
      /* scaduta ma ancora aperta: i soldi sono ancora impegnati, e questo è
         l'unico punto da cui si liberano senza aspettare che il cliente
         ricominci */
      return '<button class="btn btn--ghost btn--sm" data-rilascia="' + id +
        '" type="button">Rilascia i fondi</button>';
    }
    if (c.stato === "usata") {
      return '<span class="xs muted">ha prodotto il bonifico</span>';
    }
    if (c.consegnata_il) {
      return '<span class="xs muted">codice consegnato: vale fino alle ' +
        ui.time(c.scade_il) + "</span>";
    }
    return '<button class="btn btn--approve btn--sm" data-codice="' + id +
      '" type="button">Leggi il codice</button>';
  }

  function renderConferme(lista) {
    var corpo = document.querySelector("#conferme-table tbody");
    if (!corpo) return;
    if (!lista || !lista.length) {
      corpo.innerHTML = '<tr><td colspan="7" class="empty-state">Nessuna conferma in attesa.</td></tr>';
      return;
    }
    corpo.innerHTML = lista.map(function (c) {
      var rimasti = minutiRimasti(c);
      var vivo = c.stato === "aperta" || c.stato === "confermata";
      /* sotto i cinque minuti la consegna è già in ritardo: dirlo con il
         colore, non con una frase che nessuno legge */
      var urgente = vivo && rimasti > 0 && rimasti <= 5;
      var scadenza = vivo
        ? (rimasti > 0
            ? '<span class="' + (urgente ? "is-alert" : "") + '">' + rimasti + " min</span>"
            : "adesso")
        : ui.when(c.scade_il);
      return "<tr>" +
        '<td class="mono xs">' + ui.esc(c.reference) +
          '<div class="xs muted">' + ui.esc(c.stato) + "</div></td>" +
        "<td><strong>" + ui.esc(c.cliente) + "</strong>" +
          '<div class="xs muted">' + ui.esc(c.email) + "</div></td>" +
        "<td>" + ui.esc(c.beneficiario) +
          '<div class="xs mono muted">' + ui.esc(c.iban) + "</div></td>" +
        '<td class="num">' + ui.money(c.importo_eur) + "</td>" +
        "<td>" + scadenza + "</td>" +
        '<td class="xs muted">' + (c.consegnata_il
          ? ui.esc(c.consegnata_da || "") + "<br>" + ui.when(c.consegnata_il)
          : "—") + "</td>" +
        '<td class="data-table__actions">' + azioneConferma(c) + "</td>" +
      "</tr>";
    }).join("");
  }

  function caricaConferme() {
    /* «aperte» da sola non basta: una richiesta scaduta e mai consegnata è
       esattamente il caso in cui il cliente dice «non ho ricevuto niente», e
       deve restare sotto gli occhi con il pulsante che la chiude */
    return api.confermeBonifico("aperte").then(function (res) {
      var aperte = (res && res.conferme) || [];
      return api.confermeBonifico("scadute").then(function (res2) {
        var scadute = ((res2 && res2.conferme) || []).filter(function (c) {
          /* «scadute» include le annullate: qui servono solo quelle ancora da
             chiudere, dove i fondi sono davvero ancora impegnati */
          return c.stato === "scaduta";
        });
        var lista = aperte.concat(scadute);
        renderConferme(lista);

        /* il contatore dice quante richiedono una persona adesso, non quante
           righe si vedono: una scaduta da rilasciare è lavoro, una già
           annullata no */
        var daFare = lista.filter(function (c) {
          return c.stato === "scaduta" || (!c.consegnata_il && c.stato !== "usata");
        }).length;
        var nodo = document.querySelector("[data-banca-kpi-conferme]");
        if (nodo) {
          nodo.textContent = String(daFare);
          nodo.classList.toggle("is-alert", daFare > 0);
        }
        conta(document.querySelector("[data-count-banca]"), daFare);
        return lista;
      });
    }).catch(function () {
      /* se il secondo elenco non arriva, la tabella mostra almeno le aperte:
         meglio parziale che vuota */
      return [];
    });
  }

  function rilasciaConferma(id, btn) {
    if (btn) btn.disabled = true;
    api.rilasciaConferma(id).then(function (res) {
      ui.toast(res && res.liberati_eur
        ? ui.money(res.liberati_eur) + " tornati disponibili a " + (res.cliente || "il cliente") +
          ". Fagli disporre un nuovo bonifico."
        : "Richiesta chiusa.", "ok");
      caricaConferme();
      refresh();
    }).catch(function (err) {
      ui.toast(err.message, "error");
      if (btn) btn.disabled = false;
    });
  }

  function leggiCodice(id) {
    var modale = document.querySelector("[data-codice-modal]");
    if (!modale) return;
    var intro = modale.querySelector("[data-codice-intro]");
    var valore = modale.querySelector("[data-codice-valore]");
    var dettagli = modale.querySelector("[data-codice-dettagli]");
    var errore = modale.querySelector("[data-codice-error]");
    if (errore) errore.hidden = true;
    if (intro) intro.textContent = "Recupero il codice…";
    if (valore) valore.textContent = "";
    if (dettagli) dettagli.textContent = "";
    modale.hidden = false;

    api.codiceConferma(id).then(function (res) {
      if (intro) {
        intro.textContent = "Comunica questo codice a " + (res.cliente || "il cliente") +
          ". Vale fino alle " + ui.time(res.scade_il) + " e una volta sola.";
      }
      if (valore) {
        /* spezzato in due gruppi: si legge al telefono senza confondere le cifre */
        var c = String(res.codice || "");
        valore.textContent = c.slice(0, 3) + " " + c.slice(3);
      }
      if (dettagli) {
        dettagli.textContent = (res.importo_eur ? ui.money(res.importo_eur) : "") +
          " a " + (res.beneficiario || "") + " · " + (res.email || "") +
          ". " + (res.avviso || "");
      }
      caricaConferme();
      refresh();
    }).catch(function (err) {
      if (errore) {
        errore.hidden = false;
        errore.textContent = err.message || "Codice non disponibile.";
      }
      if (intro) intro.textContent = "Il codice non è stato consegnato.";
      if (valore) valore.textContent = "";
      caricaConferme();
    });
  }

  function scadiConferme(btn) {
    if (btn) btn.disabled = true;
    api.scadiConferme().then(function (res) {
      ui.toast((res && res.scadute ? res.scadute + " richieste chiuse, " +
        ui.money(res.liberati_eur) + " tornati disponibili." : "Nessuna richiesta scaduta."), "ok");
      caricaConferme();
      refresh();
    }).catch(function (err) {
      ui.toast(err.message, "error");
    }).then(function () { if (btn) btn.disabled = false; });
  }

  function bindBanca() {
    var nodo = document.querySelector("#banca");
    if (!nodo) return;
    nodo.addEventListener("click", function (e) {
      var b;
      if ((b = e.target.closest("[data-bonifica]"))) {
        return azioneBanca(b.getAttribute("data-bonifica"), b.getAttribute("data-azione"));
      }
      if ((b = e.target.closest("[data-addebito-esito]"))) {
        return azioneAddebito(b.getAttribute("data-addebito-esito"), b.getAttribute("data-azione"));
      }
      if ((b = e.target.closest("[data-addebito]"))) {
        return presentaAddebito(b.getAttribute("data-addebito"));
      }
      if ((b = e.target.closest("[data-carta]"))) {
        return azioneCarta(b.getAttribute("data-carta"), b.getAttribute("data-azione"));
      }
      if ((b = e.target.closest("[data-codice]"))) {
        return leggiCodice(b.getAttribute("data-codice"));
      }
      if ((b = e.target.closest("[data-rilascia]"))) {
        return rilasciaConferma(b.getAttribute("data-rilascia"), b);
      }
      if ((b = e.target.closest("[data-conferme-scadi]"))) {
        return scadiConferme(b);
      }
    });

    var modaleCodice = document.querySelector("[data-codice-modal]");
    if (modaleCodice) {
      var chiudiCodice = function () { modaleCodice.hidden = true; };
      var bChiudi = modaleCodice.querySelector("[data-codice-close]");
      if (bChiudi) bChiudi.addEventListener("click", chiudiCodice);
      modaleCodice.addEventListener("click", function (e) {
        if (e.target === modaleCodice) chiudiCodice();
      });
    }

    var entrata = document.querySelector("[data-banca-entrata-apri]");
    if (entrata) entrata.addEventListener("click", apriEntrata);
    var interessi = document.querySelector("[data-banca-interessi]");
    if (interessi) interessi.addEventListener("click", maturaInteressi);

    var modaleEntrata = document.querySelector("[data-entrata-modal]");
    if (modaleEntrata) {
      modaleEntrata.querySelector("[data-entrata-form]").addEventListener("submit", inviaEntrata);
      modaleEntrata.querySelector("[data-entrata-cancel]").addEventListener("click", function () {
        modaleEntrata.hidden = true;
      });
      modaleEntrata.addEventListener("click", function (e) {
        if (e.target === modaleEntrata) modaleEntrata.hidden = true;
      });
    }

    var modaleEsito = document.querySelector("[data-esito-modal]");
    if (modaleEsito) {
      modaleEsito.querySelector("[data-esito-form]").addEventListener("submit", inviaEsito);
      modaleEsito.querySelector("[data-esito-cancel]").addEventListener("click", function () {
        modaleEsito.hidden = true;
      });
      modaleEsito.addEventListener("click", function (e) {
        if (e.target === modaleEsito) modaleEsito.hidden = true;
      });
    }
  }

  /* --------------------------------------------------- segnalazioni dal sito -- */
  /* Il cliente: «abbiamo bisogno di un sistema dove anche riceve i lead».
     Il database le raccoglieva già — ogni modulo compilato finisce in
     `traccia.richieste` — ma l'unico modo di vederle era una query a mano:
     un lead che nessuno guarda non è un lead, è una persona che aspetta.

     Tre scelte che si vedono in questa tabella:
       * l'**attesa** viene prima del nome. Il dato che cambia la giornata non
         è chi ha scritto, è da quanto tempo aspetta: sotto le 24 ore si chiama
         oggi, oltre le 48 la persona ha già cercato qualcun altro;
       * il **telefono** sta sotto il nome, come nel resto della console: si
         guarda una riga e si chiama;
       * «cosa è successo» è la parola del cliente, non una categoria nostra:
         il valore grezzo (`situation`) si traduce in un'etichetta, ma la
         `message`, quando c'è, si legge per intero al passaggio del mouse.
  */
  var SITUAZIONI = {
    broker: "Finto broker o piattaforma",
    crypto: "Truffa con criptovalute",
    unlock: "Soldi chiesti per sbloccare il prelievo",
    recovery: "Finto recupero fondi",
    altro: "Non lo sa ancora"
  };

  function etichettaSituazione(s) {
    if (!s) return '<span class="xs muted">—</span>';
    return ui.esc(SITUAZIONI[s] || s);
  }

  /* Ore di attesa, calcolate dall'orologio del browser a ogni giro: la
     tabella può restare aperta per ore e un numero fermo direbbe una bugia. */
  function attesaOre(r) {
    if (!r.created_at) return 0;
    return Math.max(0, (Date.now() / 1000 - Number(r.created_at)) / 3600);
  }

  function attesaLeggibile(r) {
    var ore = attesaOre(r);
    if (r.status !== "new") return '<span class="xs muted">' + ui.when(r.created_at) + "</span>";
    var testo = ore < 1 ? "adesso"
      : ore < 24 ? Math.floor(ore) + " h"
      : Math.floor(ore / 24) + " g";
    /* oltre le 48 ore è un lead che si sta perdendo: si vede dal colore,
       non da una frase che nessuno legge */
    var classe = ore >= 48 ? "is-alert" : (ore >= 24 ? "is-warn" : "");
    return '<span class="' + classe + '"><strong>' + testo + "</strong></span>";
  }

  /* I bottoni sono tre al massimo, e ognuno fa **una** cosa. Prima ce n'erano
     fino a quattro con etichette che si somigliavano («Contattata», «Non
     nostra», «Chiudi») e nessuno stato mostrava a che punto era il lavoro.
     Ora c'è sempre la chiamata, poi l'azione che fa avanzare, poi quella che
     chiude — nell'ordine in cui si fanno. */
  function azioniRichiesta(r) {
    var id = ui.esc(r.id);
    var bottoni = [];
    bottoni.push('<a class="btn btn--ghost btn--sm" href="tel:' + ui.esc(r.phone) +
      '">Chiama</a>');

    if (r.status === "new") {
      bottoni.push('<button class="btn btn--accent btn--sm" data-richiesta="' + id +
        '" data-stato="contacted" type="button">Contattata</button>');
    } else if (r.status === "contacted") {
      bottoni.push('<button class="btn btn--approve btn--sm" data-richiesta="' + id +
        '" data-stato="account" type="button">Apri pratica</button>');
    }

    if (r.status === "new" || r.status === "contacted") {
      bottoni.push('<button class="btn btn--ghost btn--sm" data-richiesta="' + id +
        '" data-stato="denied" type="button" title="Archivia: non è un caso nostro">Non nostra</button>');
    }
    if (r.status === "account") {
      bottoni.push('<button class="btn btn--ghost btn--sm" data-richiesta="' + id +
        '" data-stato="closed" type="button">Chiudi</button>');
    }
    return bottoni.join(" ");
  }

  /* Da dove è arrivata. Il valori li scrive `origine.js` sulle pagine del
     sito; quelli vecchi (`login`) restano e vanno mostrati per quello che
     sono, senza farli sembrare un canale. */
  function etichettaOrigine(origine) {
    var v = (origine || "").trim();
    if (!v || v === "login" || v === "sito") return "diretta";
    if (v === "organico") return "motore di ricerca";
    if (v === "altro-sito") return "altro sito";
    return v.replace(/-/g, " · ");
  }

  function renderRichieste() {
    if (!L.richiesteBody) return;
    if (!state.richieste.length) {
      L.richiesteBody.innerHTML =
        '<tr><td colspan="8" class="empty-state">Nessuna segnalazione in questo filtro.' +
        '<div class="xs muted mt-1">Le nuove arrivano dal modulo «Segnala un caso» del sito.</div>' +
        "</td></tr>";
      return;
    }
    L.richiesteBody.innerHTML = state.richieste.map(function (r) {
      /* La riga è modificabile: la nota si scrive qui, non in un modale, e
         chi lavora la segnalazione non perde il posto in tabella. */
      return "<tr data-lead-row=\"" + ui.esc(r.id) + "\">" +
        "<td>" + attesaLeggibile(r) + "</td>" +
        "<td><strong>" + ui.esc(r.name) + "</strong>" +
          (r.email ? '<div class="xs muted">' + ui.esc(r.email) + "</div>" : "") +
          '<div class="xs muted"><a href="tel:' + ui.esc(r.phone) + '">' + ui.esc(r.phone) + "</a></div></td>" +
        '<td class="num">' + ui.money(r.amount_eur) + "</td>" +
        '<td title="' + ui.esc(r.message || "") + '">' + etichettaSituazione(r.situation) + "</td>" +
        /* «META-DE» non si legge: si legge «Meta · de». Con una campagna
           accesa questa colonna è la sola che dice quale annuncio ha portato
           quella persona, e deve costare zero decodifica. */
        '<td class="xs">' + ui.esc(etichettaOrigine(r.origine)) + "</td>" +
        "<td>" + ui.pill(r.status, r.status === "new" ? "pending" : null) +
          (r.taken_by_name ? '<div class="xs muted">' + ui.esc(r.taken_by_name) + "</div>" : "") +
        "</td>" +
        '<td class="lead-note"><input class="lead-note__input" type="text"' +
          ' data-note-for="' + ui.esc(r.id) + '"' +
          ' value="' + ui.esc(r.note || "") + '"' +
          ' placeholder="Scrivi una nota…" aria-label="Nota per ' + ui.esc(r.name) + '"></td>' +
        '<td class="data-table__actions">' + azioniRichiesta(r) + "</td>" +
        "</tr>";
    }).join("");
  }

  function loadRichieste() {
    if (!L.richiesteBody) return Promise.resolve();
    return api.richieste(state.richiestaFilter || undefined).then(function (data) {
      state.richieste = data.richieste || [];
      renderRichieste();
      /* il contatore in barra laterale conta solo le nuove: è il numero che
         dice «c'è qualcuno da chiamare» */
      conta(L.countLead, data.new_count);
      if (L.kpiLead) L.kpiLead.textContent = String(data.new_count || 0);
      if (L.cardLead) {
        L.cardLead.classList.toggle("is-zero", !data.new_count);
        L.cardLead.classList.toggle("has-items", !!data.new_count);
      }
      /* lo stesso numero anche in cima, nel blocco «da fare adesso»: due punti
         della stessa schermata non possono dire due cifre diverse */
      state.leadNew = Number(data.new_count) || 0;
      aggiornaDaFare({
        lead: state.leadNew,
        richieste: state.pendingAccounts,
        operazioni: state.pendingOperations,
        wallet: state.pendingWallets,
        documenti: state.pendingDocuments,
      });
      avvisaSeNuove(data.new_count || 0, data.richieste || []);
    });
  }

  /* ------------------------------------------------- l'avviso in pagina -- */
  /* Il primo dei tre strati di LEAD.md, e l'unico che funziona senza
     configurare niente: la console chiede ogni 60 secondi quante segnalazioni
     nuove ci sono, e quando il numero sale lo dice.

     Due dettagli che fanno la differenza fra un avviso e un fastidio:
       * il primo giro non avvisa. All'apertura il contatore «sale» da zero a
         quello che c'è, e un avviso per ogni segnalazione già vista insegnerebbe
         a ignorarli;
       * l'avviso dice **chi** e **quanto**, non «hai una nuova segnalazione»:
         chi lo legge decide in due secondi se alzarsi dal tavolo. */
  var ultimoConteggio = null;

  function avvisaSeNuove(conteggio, elenco) {
    var precedente = ultimoConteggio;
    ultimoConteggio = conteggio;
    if (precedente === null || conteggio <= precedente) return;

    var ultima = elenco.filter(function (r) { return r.status === "new"; })[0] || null;
    var testo = ultima
      ? ultima.name + " · " + ui.money(ultima.amount_eur) + " · " + (ultima.phone || "")
      : "Nuova segnalazione dal sito";
    ui.toast("Nuova segnalazione: " + testo, "ok");

    /* notifica del browser: chiede il permesso la prima volta, e se viene
       negato non insiste — la richiesta ripetuta è ciò che fa disattivare le
       notifiche per sempre */
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
      return;
    }
    if (Notification.permission !== "granted") return;
    try {
      var n = new Notification("Traccia — nuova segnalazione", {
        body: testo,
        tag: "lead",
        requireInteraction: true
      });
      n.onclick = function () {
        window.focus();
        var voce = document.querySelector('.app-nav__link[data-tab="lead"]');
        if (voce) voce.click();
        n.close();
      };
    } catch (e) { /* un browser che non le supporta non deve rompere altro */ }
  }

  /* ogni 60 secondi. `document.hidden` non ferma il giro: è proprio quando la
     scheda è in secondo piano che l'avviso serve */
  window.setInterval(function () {
    if (!state.me) return;
    api.richieste("new").then(function (data) {
      avvisaSeNuove(data.new_count || 0, data.richieste || []);
      conta(L.countLead, data.new_count);
      if (L.kpiLead) L.kpiLead.textContent = String(data.new_count || 0);
    }).catch(function () { /* rete assente: si riprova al giro dopo */ });
  }, 60000);

  /* Cambiare stato a una segnalazione.
     Prima ogni cambio passava da un modale con un campo nota: tre clic e una
     finestra per dire «l'ho chiamata», e la nota si poteva annullare *dopo*
     aver già scelto lo stato — due gesti pensati per essere uno.
     Ora: un clic cambia lo stato, e la nota si scrive nella riga, dove resta
     visibile. Il modale resta solo per le due azioni che non si annullano:
     aprire la pratica (crea un account) e archiviare. */
  function richiestaStato(id, stato, nota) {
    var irreversibili = {
      account: { titolo: "Aprire la pratica?",
                 testo: "Da qui nasce l'account: la password la sceglie il cliente al primo accesso." },
      denied:  { titolo: "Non è un nostro caso?",
                 testo: "La segnalazione viene archiviata; nessun messaggio parte da sola." }
    };

    function applica(notaFinale) {
      return api.richiestaImposta(id, stato, notaFinale).then(function () {
        /* il messaggio dice cosa è cambiato: «aggiornata» da solo non dice a
           chi guarda se il clic ha fatto quello che voleva */
        ui.toast("Segnalazione: " + (etichettaStato(stato) || stato) + ".", "ok");
        return refresh();
      });
    }

    if (!irreversibili[stato]) {
      return applica(nota).catch(function (err) { ui.toast(err.message, "error"); });
    }

    var testo = irreversibili[stato];
    return ui.ask({
      title: testo.titolo,
      message: testo.testo + " L'azione viene registrata nel registro attività.",
      prompt: "Nota (opzionale)",
      confirm: stato === "denied" ? "Archivia" : "Apri la pratica",
      danger: stato === "denied"
    }).then(function (notaModale) {
      if (notaModale === null) return;
      return applica(notaModale);
    }).catch(function (err) { ui.toast(err.message, "error"); });
  }

  function etichettaStato(stato) {
    return {
      new: "da chiamare", contacted: "contattata", account: "con pratica aperta",
      closed: "chiusa", denied: "archiviata"
    }[stato] || stato;
  }

  /* La nota si modifica nella riga. `Enter` salva, `Escape` lascia com'era:
     è il comportamento di ogni campo che si modifica per sbaglio. */
  function salvaNota(id, testo, nodo, originale) {
    api.richiestaImposta(id, statoDellaRiga(id), testo)
      .then(function () { ui.toast("Nota salvata.", "ok"); return loadRichieste(); })
      .catch(function (err) {
        ui.toast(err.message, "error");
        if (nodo) nodo.value = originale || "";
      });
  }

  /* Lo stato attuale della riga: serve perché `richiestaImposta` vuole uno
     stato, e cambiare la nota non deve cambiare lo stato. */
  function statoDellaRiga(id) {
    var r = (state.richieste || []).filter(function (x) { return String(x.id) === String(id); })[0];
    return r ? r.status : "new";
  }

  function refresh() {
    return Promise.all([
      loadOverview(), loadRichieste(), loadAccounts(), loadAllAccounts(), loadOperations(),
      loadWallets(), loadDocuments(), loadSettings(), loadMessages(), loadBanca(),
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

  /* La fase è ciò che il cliente vede sul cruscotto: cambiarla è una
     comunicazione, non solo un dato. Per questo la nota è facoltativa ma
     incoraggiata, e l'avviso al cliente è attivo per impostazione predefinita. */
  function avvisaCliente() {
    var box = document.getElementById("phase-notify");
    return box ? box.checked : true;
  }

  function changePhase(id, phase, select) {
    var from = Number(select.dataset.previous || 1);

    ui.ask({
      title: "Portare la pratica alla fase " + phase + " · " + FASI_CLIENTE[phase - 1] + "?",
      message: "Il cliente vedrà la nuova fase nel suo cruscotto" +
        (avvisaCliente() ? " e riceverà un avviso nell'area riservata." : "."),
      prompt: "Nota per il cliente (facoltativa)",
      confirm: "Sposta di fase"
    }).then(function (note) {
      if (note === null) {
        if (select) select.value = String(from);
        return;
      }
      return api.setPhase(id, phase, note, avvisaCliente()).then(function (res) {
        if (res && res.changed === false) {
          ui.toast("La pratica era già in questa fase.", "ok");
        } else {
          ui.toast("Pratica portata in fase " + phase + " · " + FASI_CLIENTE[phase - 1] + ".", "ok");
        }
        return refresh();
      });
    }).catch(function (err) {
      ui.toast(err.message, "error");
      if (select) select.value = String(from);
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
        document.querySelector(".app-nav__io [data-logout]").addEventListener("click", function (e) {
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
      var verifica = e.target.closest("[data-iban-verify]");
      if (verifica) {
        verifica.disabled = true;
        api.verificaIban(verifica.getAttribute("data-iban-verify")).then(function () {
          ui.toast("Coordinate verificate.", "ok");
          return loadAllAccounts();
        }).catch(function (err) {
          ui.toast(err.message, "error");
          verifica.disabled = false;
        });
        return;
      }

      var modifica = e.target.closest("[data-modifica]");
      if (modifica) {
        modificaPratica(modifica.getAttribute("data-modifica"));
        return;
      }

      var apri = e.target.closest("[data-open]");
      if (apri) {
        openClient(apri.getAttribute("data-open"), apri.getAttribute("data-open-name"));
        return;
      }

      var kill = e.target.closest("[data-kill]");
      if (kill) {
        ui.ask({
          title: "Chiudere tutte le sessioni di questo account?",
          message: "L'utente dovrà accedere di nuovo. L'azione viene registrata nel registro attività.",
          confirm: "Chiudi sessioni",
          danger: true
        }).then(function (ok) {
          if (ok === null) return;
          return api.revokeSessions(kill.getAttribute("data-kill")).then(function (res) {
            ui.toast("Sessioni chiuse: " + ((res && res.closed) || 0) + ".", "ok");
          });
        }).catch(function (err) { ui.toast(err.message, "error"); });
        return;
      }

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
      var kyc = e.target.closest("[data-kyc]");
      if (kyc) {
        changeKyc(kyc.getAttribute("data-kyc"), Number(kyc.value), kyc);
        return;
      }
      var fase = e.target.closest("[data-phase]");
      if (fase) changePhase(fase.getAttribute("data-phase"), Number(fase.value), fase);
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

    if (L.documentsBody) {
      L.documentsBody.addEventListener("click", function (e) {
        var apriFile = e.target.closest("[data-doc-file]");
        if (apriFile) {
          apriFile.disabled = true;
          api.documentLink(apriFile.getAttribute("data-doc-file")).then(function (res) {
            window.open(res.url, "_blank", "noopener");
          }).catch(function (err) {
            ui.toast(err.message || "File non disponibile.", "error");
          }).then(function () {
            apriFile.disabled = false;
          });
          return;
        }

        var bottone = e.target.closest("[data-doc]");
        if (!bottone) return;
        documentAction(bottone.getAttribute("data-doc"), bottone.getAttribute("data-doc-action"));
      });

      document.querySelectorAll("[data-document-filters] .chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
          document.querySelectorAll("[data-document-filters] .chip").forEach(function (c) {
            c.classList.remove("is-active");
          });
          chip.classList.add("is-active");
          state.documentFilter = chip.getAttribute("data-filter");
          loadDocuments().catch(function (err) { ui.toast(err.message, "error"); });
        });
      });
    }

    document.querySelectorAll("[data-lead-filters] .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("[data-lead-filters] .chip").forEach(function (c) {
          c.classList.remove("is-active");
        });
        chip.classList.add("is-active");
        state.richiestaFilter = chip.getAttribute("data-lead-filter");
        loadRichieste().catch(function (err) { ui.toast(err.message, "error"); });
      });
    });

    /* i bottoni di stato dentro la tabella: delegati sul corpo, perché le
       righe vengono ricostruite a ogni aggiornamento e i listener singoli
       sparirebbero al primo giro */
    if (L.richiesteBody) {
      /* La nota nella riga: si salva con Enter o uscendo dal campo, se è
         cambiata. Salvare a ogni tasto voleva dire una chiamata per
         lettera; salvare solo col bottone voleva dire perdere quello che si
         è scritto chiudendo la pagina. */
      L.richiesteBody.addEventListener("keydown", function (e) {
        var campo = e.target.closest ? e.target.closest("[data-note-for]") : null;
        if (!campo) return;
        if (e.key === "Enter") {
          e.preventDefault();
          campo.blur();
        } else if (e.key === "Escape") {
          campo.value = campo.defaultValue;
          campo.blur();
        }
      });
      L.richiesteBody.addEventListener("focusin", function (e) {
        var campo = e.target.closest ? e.target.closest("[data-note-for]") : null;
        if (campo) campo.dataset.prima = campo.value;
      });
      L.richiesteBody.addEventListener("focusout", function (e) {
        var campo = e.target.closest ? e.target.closest("[data-note-for]") : null;
        if (!campo) return;
        var prima = campo.dataset.prima === undefined ? campo.defaultValue : campo.dataset.prima;
        if (campo.value === prima) return;
        salvaNota(campo.getAttribute("data-note-for"), campo.value.trim(), campo, prima);
      });

      L.richiesteBody.addEventListener("click", function (e) {
        var bottone = e.target.closest ? e.target.closest("[data-richiesta]") : null;
        if (!bottone) return;
        e.preventDefault();
        /* la nota già scritta nella riga viaggia con il cambio di stato:
           «contattata» e «ho parlato con lei, richiamare lunedì» sono la
           stessa informazione e devono restare insieme */
        var riga = bottone.closest("tr");
        var campoNota = riga ? riga.querySelector("[data-note-for]") : null;
        richiestaStato(bottone.getAttribute("data-richiesta"),
                       bottone.getAttribute("data-stato"),
                       campoNota ? campoNota.value.trim() : null);
      });
    }

    /* --- pratiche: schede e ricerca -------------------------------------
       Le schede filtrano sul client (`state.allAccounts` è già tutto qui): non
       serve una chiamata al server per nascondere delle righe, e una chiamata
       per ogni clic renderebbe l'elenco lento proprio mentre lo si guarda.

       La ricerca non aspetta «Invio»: si scrive e l'elenco si stringe. È il
       gesto che si fa al telefono, con il cliente in linea. */
    document.querySelectorAll("[data-pratiche-filtri] .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("[data-pratiche-filtri] .chip").forEach(function (c) {
          c.classList.remove("is-active");
          c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("is-active");
        chip.setAttribute("aria-pressed", "true");
        state.schedaPratiche = chip.getAttribute("data-filtro");
        renderAllAccounts();
      });
      chip.setAttribute("aria-pressed", chip.classList.contains("is-active") ? "true" : "false");
    });

    var campoRicerca = document.querySelector("[data-pratiche-ricerca]");
    if (campoRicerca) {
      campoRicerca.addEventListener("input", function () {
        state.ricercaPratiche = campoRicerca.value.trim();
        renderAllAccounts();
      });
      /* Esc cancella: è il modo in cui si esce da una ricerca sbagliata senza
         selezionare il testo a mano */
      campoRicerca.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        campoRicerca.value = "";
        state.ricercaPratiche = "";
        renderAllAccounts();
      });
    }

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

    bindBanca();

    bindSezioni();
  }

  /* ------------------------------------------------------------- sezioni --
     Nove pannelli, uno per volta. Prima erano tutti aperti in fila: per
     arrivare al registro attività si attraversavano segnalazioni, richieste,
     operazioni, pratiche, wallet, banca, soglie e documenti — e chi ci
     arrivava non sapeva più cosa aveva guardato.

     La sezione attiva si deduce dall'indirizzo (`#richieste`), non dal clic:
     un solo posto decide cosa si vede, chiamato all'apertura, al clic e al
     tasto indietro del browser. Così si può mandare a un collega il punto
     esatto, e tornare indietro funziona.

     Senza JavaScript i pannelli restano tutti visibili: si legge, si scorre,
     si usa. Peggio di prima ma non rotto — che è la sola differenza
     accettabile. */
  function sezioneDaIndirizzo() {
    var id = (window.location.hash || "").replace("#", "");
    var esiste = id && document.getElementById(id) &&
      document.getElementById(id).classList.contains("panel");
    return esiste ? id : "overview";
  }

  function mostraSezione(id, scorri) {
    document.querySelectorAll(".panel[id]").forEach(function (pannello) {
      pannello.hidden = pannello.id !== id;
    });
    document.querySelectorAll(".app-nav__link[data-tab]").forEach(function (link) {
      var attiva = link.getAttribute("data-tab") === id;
      link.classList.toggle("is-active", attiva);
      if (attiva) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (scorri !== false) window.scrollTo({ top: 0, behavior: "auto" });
  }

  function bindSezioni() {
    if (!document.querySelector(".app-nav__link[data-tab]")) return;
    mostraSezione(sezioneDaIndirizzo(), false);
    window.addEventListener("hashchange", function () {
      mostraSezione(sezioneDaIndirizzo());
    });
    /* i collegamenti che portano a un pannello senza essere nel menu (una
       riga «apri» che salta alle verifiche) devono aprire la sua sezione */
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      if (link.getAttribute("data-tab")) return;
      var id = link.getAttribute("href").replace("#", "");
      var bersaglio = id && document.getElementById(id);
      if (!bersaglio || !bersaglio.classList.contains("panel")) return;
      link.addEventListener("click", function () { mostraSezione(id); });
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
