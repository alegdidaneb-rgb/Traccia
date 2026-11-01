/* traccia — area riservata "La mia pratica".
   Riempie i dati del fascicolo, anima la timeline e gestisce le interazioni
   della nuova interfaccia. In modalità demo nessun dato lascia il browser. */
(function () {
  "use strict";

  /* dati di sessione noti alla pagina: `me` porta anche `read_only`,
     che vale true quando un analista apre la pratica di un cliente */
  var state = { me: null };

  var PHASES = [
    { short: "01 · Raccolta", name: "Raccolta", desc: "Documenti e colloquio iniziale acquisiti." },
    { short: "02 · Ricostruzione", name: "Ricostruzione", desc: "Flussi e indirizzi ricostruiti." },
    { short: "03 · Perizia", name: "Perizia", desc: "Redazione del documento tecnico." },
    { short: "04 · Denunce", name: "Denunce", desc: "Predisposizione degli atti." },
    { short: "05 · Legale", name: "Legale", desc: "Passaggio all'avvocato." }
  ];

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function arrayEach(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function set(name, value) {
    each("[data-" + name + "]", function (node) { node.textContent = value; });
  }

  function initials(name) {
    return (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("");
  }

  function readUser() {
    return (window.api && api.cachedUser) ? api.cachedUser() : null;
  }

  function caseRef() {
    /* il riferimento della pratica è assegnato dal database: qui leggiamo
       quello dell'utente, altrimenti mostriamo un trattino */
    var user = readUser();
    return (user && user.case_ref) || "—";
  }

  /* ------------------------------------------------------------ timeline -- */
  function paintPhases(current, steps) {
    steps.forEach(function (step, index) {
      var position = index + 1;
      step.classList.remove("tl__item--done", "tl__item--current");
      var dot = step.querySelector(".tl__dot");
      if (position < current) {
        step.classList.add("tl__item--done");
        if (dot && !dot.querySelector("svg")) {
          dot.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
            '<path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
      } else if (position === current) {
        step.classList.add("tl__item--current");
        if (dot) dot.innerHTML = "";
      } else if (dot) {
        dot.innerHTML = "";
      }
    });
  }

  function animateProgress(value) {
    var bar = document.querySelector("[data-progress]");
    var fill = bar && bar.querySelector(".progress__fill");
    if (!fill) return;
    fill.style.setProperty("--p", "0");
    window.requestAnimationFrame(function () {
      window.setTimeout(function () {
        fill.style.setProperty("--p", value.toFixed(2));
      }, 220);
    });
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  }

  /* -------------------------------------------------------- interazioni -- */
  function bindCopy(ref) {
    each("[data-copy-ref]", function (copy) {
      copy.addEventListener("click", function () {
        if (navigator.clipboard) navigator.clipboard.writeText(ref);
        var original = copy.textContent;
        copy.textContent = "Copiato";
        window.setTimeout(function () { copy.textContent = original; }, 1600);
      });
    });
  }

  function bindTabs() {
    var tabs = document.querySelectorAll(".appv2__tab");
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
      });
    });

    /* la tab attiva segue lo scroll: la sezione visibile più in alto vince */
    var targets = Array.prototype.map.call(tabs, function (tab) {
      var id = tab.getAttribute("href").replace("#", "");
      return { tab: tab, section: document.getElementById(id) };
    }).filter(function (t) { return t.section; });

    if (!targets.length || !("IntersectionObserver" in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        targets.forEach(function (t) {
          t.tab.classList.toggle("is-active", t.section === entry.target);
        });
      });
    }, { rootMargin: "-15% 0px -70% 0px", threshold: 0 });

    targets.forEach(function (t) { observer.observe(t.section); });
  }

  function bindRefresh(reload) {
    each("[data-refresh]", function (button) {
      button.addEventListener("click", function () {
        if (typeof reload === "function") reload();
        var icon = button.querySelector("svg");
        if (icon) {
          icon.style.transition = "transform .6s cubic-bezier(.16,1,.3,1)";
          icon.style.transform = "rotate(360deg)";
          window.setTimeout(function () {
            icon.style.transition = "none";
            icon.style.transform = "";
          }, 620);
        }
        if (window.ui && ui.toast) {
          ui.toast("Pratica aggiornata adesso.", "ok");
        }
      });
    });
  }

  function bindDropzone() {
    var zone = document.querySelector("[data-dropzone]");
    if (!zone) return;
    ["dragenter", "dragover"].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      zone.addEventListener(name, function (e) {
        e.preventDefault();
        zone.classList.remove("is-over");
      });
    });
    zone.addEventListener("click", function () {
      var select = document.getElementById("op-type");
      if (select) select.focus();
    });
  }

  function bindSearch() {
    var input = document.querySelector("[data-search]");
    if (!input) return;
    /* ⌘K / Ctrl+K porta il cursore nella ricerca */
    window.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /* ------------------------------------------------------- avvisi -- */
  /* Gli avvisi arrivano dal database: quando un analista sposta la pratica
     di fase, il cliente lo trova qui. La campanella mostra quanti sono
     ancora da leggere; aprendola si segnano come letti. */
  function renderNotifiche(lista, nonLette) {
    var panel = document.querySelector("[data-notify-panel]");
    var ul = document.querySelector("[data-notify-list]");
    var count = document.querySelector("[data-notify-count]");
    var dot = document.querySelector(".appv2__dot");
    if (!ul) return;

    if (count) {
      count.textContent = nonLette > 9 ? "9+" : String(nonLette || "");
      count.hidden = !nonLette;
    }
    if (dot) dot.hidden = !nonLette;

    if (!lista || !lista.length) {
      ul.innerHTML = '<li class="notif__item notif__item--empty">Nessun avviso.</li>';
      return;
    }

    ul.innerHTML = lista.map(function (n) {
      return '<li class="notif__item' + (n.read ? "" : " is-unread") + '">' +
        '<span class="notif__dot" aria-hidden="true"></span>' +
        "<div><b>" + ui.esc(n.title) + "</b>" +
        (n.body ? "<p>" + ui.esc(n.body) + "</p>" : "") +
        '<span class="notif__when">' + shortDate(n.created_at) + "</span></div></li>";
    }).join("");
    if (panel) panel.dataset.loaded = "1";
  }

  function caricaNotifiche() {
    return api.notifications().then(function (res) {
      renderNotifiche(res.notifications, res.unread);
      return res;
    }).catch(function () {
      /* un errore sugli avvisi non deve bloccare la pratica */
      return null;
    });
  }

  function bindNotify() {
    var button = document.querySelector("[data-notify]");
    var panel = document.querySelector("[data-notify-panel]");
    if (!button || !panel) return;

    button.addEventListener("click", function (e) {
      e.stopPropagation();
      var aperto = !panel.hidden;
      panel.hidden = aperto;
      button.setAttribute("aria-expanded", String(!aperto));
      if (aperto) return;

      /* aprendo si considerano letti: l'avviso ha fatto il suo lavoro */
      var nonLette = Number((document.querySelector("[data-notify-count]") || {}).textContent || 0);
      if (nonLette) {
        api.readNotifications().then(caricaNotifiche).catch(function () {});
      }
    });

    document.addEventListener("click", function (e) {
      if (!panel.hidden && !e.target.closest(".notif")) {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });

    var all = document.querySelector("[data-notify-read-all]");
    if (all) {
      all.addEventListener("click", function (e) {
        e.stopPropagation();
        api.readNotifications().then(function () {
          ui.toast("Avvisi segnati come letti.", "ok");
          return caricaNotifiche();
        }).catch(function (err) { ui.toast(err.message, "error"); });
      });
    }
  }

  /* ------------------------------------------------------------- upload -- */
  function bindLogoutAll() {
    var button = document.querySelector("[data-logout-all]");
    if (!button) return;
    button.addEventListener("click", function () {
      var note = document.querySelector("[data-logout-all-msg]");
      button.disabled = true;
      api.logoutAll().then(function (res) {
        var n = (res && res.closed) || 0;
        if (note) {
          note.textContent = n
            ? "Sessioni chiuse: " + n + ". Ti stiamo portando al login."
            : "Nessuna sessione aperta oltre a questa. Ti stiamo portando al login.";
        }
        setTimeout(function () { location.href = "login.html?uscita=1"; }, 1200);
      }).catch(function (err) {
        button.disabled = false;
        if (note) note.textContent = err.message || "Non è stato possibile chiudere le sessioni.";
      });
    });
  }

  /* ------------------------------------------------------- caricamento -- */
  function bindForm() {
    var form = document.getElementById("op-form");
    if (!form) return;
    var input = document.getElementById("op-file");
    var progress = form.querySelector("[data-upload-progress]");
    var barra = form.querySelector("[data-upload-bar]");
    var stato = form.querySelector("[data-upload-status]");
    var etichetta = form.querySelector("[data-dropzone-label]");
    var meta = form.querySelector("[data-dropzone-meta]");

    function statoScrivi(testo) {
      if (!stato) return;
      stato.textContent = testo;
    }

    /* Il file viene scelto una volta sola: se l'utente ne trascina un altro,
       il nome nel riquadro deve cambiare, altrimenti carica il file sbagliato
       credendone di aver scelto un altro. */
    function mostraFile(file) {
      if (!file) return;
      if (etichetta) etichetta.textContent = file.name;
      if (meta) {
        meta.textContent = (file.size / 1048576).toFixed(2).replace(".", ",") + " MB · pronto";
      }
    }

    if (input) {
      input.addEventListener("change", function () {
        mostraFile(input.files && input.files[0]);
      });
    }

    ["dragenter", "dragover"].forEach(function (nome) {
      form.addEventListener(nome, function (e) { e.preventDefault(); });
    });
    form.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length && input) {
        input.files = e.dataTransfer.files;
        mostraFile(input.files[0]);
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var nota = form.querySelector("[data-form-error]");
      var tipo = document.getElementById("op-type");
      var notaInput = document.getElementById("op-note");
      var etichettaTipo = tipo ? tipo.options[tipo.selectedIndex].textContent : "Documento";
      var submit = form.querySelector('button[type="submit"]');
      var file = input && input.files && input.files[0];

      if (nota) nota.hidden = true;

      if (!file) {
        if (nota) {
          nota.hidden = false;
          nota.textContent = "Scegli un file da caricare: senza file la pratica non avanza.";
        }
        if (input) input.focus();
        return;
      }

      if (submit) { submit.disabled = true; submit.textContent = "Caricamento…"; }
      if (progress) progress.hidden = false;
      if (barra) barra.style.width = "55%";
      statoScrivi("Caricamento in corso…");

      api.uploadDocument({
        file: file,
        label: etichettaTipo,
        kind: tipo ? tipo.value : "altro",
        note: notaInput ? notaInput.value : ""
      }).then(function (res) {
        var doc = res.document || {};
        if (barra) barra.style.width = "100%";
        statoScrivi("Caricato. L'analista lo verifica appena possibile.");
        if (nota) {
          nota.hidden = false;
          nota.textContent = "Documento caricato nella pratica. L'analista lo verifica appena possibile.";
        }
        prependDocument(doc);
        form.reset();
        if (etichetta) etichetta.textContent = "Trascina qui un file, o scegli dal computer";
        if (meta) meta.textContent = "PDF, JPG o PNG · massimo 10 MB";
        if (window.ui && ui.toast) ui.toast("Documento caricato.", "ok");
        setTimeout(function () { if (progress) progress.hidden = true; }, 2500);
      }).catch(function (err) {
        if (barra) barra.style.width = "0";
        if (progress) progress.hidden = true;
        if (nota) {
          nota.hidden = false;
          nota.textContent = err.message || "Non è stato possibile caricare il documento.";
        }
      }).then(function () {
        if (submit) { submit.disabled = false; submit.textContent = "Carica il documento"; }
      });
    });
  }

  function prependDocument(doc) {
    if (!doc || !doc.id) return;
    var vault = document.getElementById("docs-table");
    if (!vault) return;
    var item = document.createElement("li");
    item.className = "vault__item";
    item.innerHTML =
      '<span class="vault__ico" aria-hidden="true">' +
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none">' +
      '<path d="M9 1.8H4.2a1.4 1.4 0 00-1.4 1.4v9.6a1.4 1.4 0 001.4 1.4h7.6a1.4 1.4 0 001.4-1.4V6.2L9 1.8z" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span>' +
      '<div class="vault__main"><b></b><span>appena caricato · in verifica</span></div>' +
      '<span class="vault__act"><span class="pill pill--pending">In verifica</span></span>';
    item.querySelector("b").textContent = doc.label || "Documento";
    vault.insertBefore(item, vault.firstChild);

    var count = document.querySelector("[data-docs-count]");
    if (count) count.textContent = String(vault.children.length);
    var stat = document.querySelector("[data-stat-docs]");
    if (stat) stat.textContent = vault.children.length + " / 4";
  }

  /* ------------------------------------------------------------ helpers -- */
  /* Formattazione esplicita, non `Intl`: alcuni runtime (e la build Node di
     questo progetto, compilata senza ICU) restituiscono «1234,50 €» senza il
     separatore delle migliaia. Su un estratto conto 1234 e 1.234 devono
     leggersi diversi a colpo d'occhio. */
  function euro(value) {
    var n = Number(value);
    if (isNaN(n)) n = 0;
    var negativo = n < 0;
    var assoluto = Math.abs(n);
    var intero = Math.floor(assoluto).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    var cent = Math.round((assoluto - Math.floor(assoluto)) * 100);
    if (cent === 100) { cent = 0; intero = (Math.floor(assoluto) + 1).toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
    return (negativo ? "-" : "") + intero + "," + String(cent).padStart(2, "0") + " €";
  }

  function shortDate(epoch) {
    if (!epoch) return "—";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" })
      .format(new Date(epoch * 1000));
  }

  /* ------------------------------------------------- sola lettura analista -- */
  /* La console apre questa pagina con una sessione `staff`: gettone a parte,
     durata di due ore, e il database rifiuta ogni scrittura (`need_write_user`).
     Qui si nasconde tutto ciò che scrive, così il cliente non vede un modulo
     che poi fallirebbe. Non è una protezione: la protezione è nel database. */
  var STAFF_KEY = "traccia.staff_view";

  function staffView() {
    if (window.location.search.indexOf("staff=1") === -1) return null;
    try {
      var dati = JSON.parse(window.localStorage.getItem(STAFF_KEY) || "null");
      if (!dati || !dati.token || (dati.scade && dati.scade < Date.now())) return null;
      return dati;
    } catch (e) {
      return null;
    }
  }

  function applyStaffView(dati) {
    api.setToken(dati.token);
    if (dati.user) api.cacheUser(dati.user);

    document.body.classList.add("is-staff-view");

    var banner = document.querySelector("[data-staff-banner]");
    if (banner) {
      banner.hidden = false;
      var nome = banner.querySelector("[data-staff-name]");
      if (nome) nome.textContent = dati.nome || (dati.user && dati.user.name) || "cliente";
    }

    /* niente scritture: via i moduli che scrivono */
    ["#carica", "#sicurezza"].forEach(function (sel) {
      var nodo = document.querySelector(sel);
      if (nodo) nodo.hidden = true;
    });
    each("[data-staff-hide]", function (nodo) { nodo.hidden = true; });

    var esci = document.querySelector("[data-staff-exit]");
    if (esci) {
      esci.addEventListener("click", function () {
        try { window.localStorage.removeItem(STAFF_KEY); } catch (e) {}
        api.setToken("");
        api.cacheUser(null);
        window.location.href = "admin.html#clienti";
      });
    }
  }

  function guardSession() {
    if (!api.token()) {
      window.location.replace("login.html?next=" + encodeURIComponent("app.html"));
      return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- boot -- */
  function renderDashboard(data) {
    var user = data.user || {};
    var kase = data.case || {};

    var name = user.name || "";
    if (name) {
      set("user-name", name);
      set("user-first", name.split(/\s+/)[0]);
      set("user-initials", initials(name));
    }
    if (user.email) set("user-email", user.email);
    set("case-ref", kase.ref || "—");

    set("stat-phase", kase.phase_name || "—");
    set("stat-updated", shortDate(user.last_login_at) || "—");
    set("stat-amount", euro(kase.amount_eur));
    set("stat-docs", String(data.documents_count || 0) + " / 4");
    set("docs-count", String(data.documents_count || 0));
    set("phase-index", String(kase.phase_index || 1).padStart(2, "0"));
    set("phase-name", kase.phase_name || "—");
    set("phase-pct", (kase.percent || 0) + "%");

    var missing = Math.max(4 - (data.documents_count || 0), 0);
    set("docs-missing", missing ? missing + " da integrare" : "tutti acquisiti");

    var statusLine = "Pratica " + (kase.ref || "—") + " · Fase " +
      String(kase.phase_index || 1).padStart(2, "0") + " — " + (kase.phase_name || "");
    set("user-status-line", statusLine);

    paintPhases(kase.phase_index || 1, document.querySelectorAll("[data-phase-track] .tl__item"));
    animateProgress((kase.percent || 0) / 100);

    renderFees(data.fees);
    renderDocuments(data.documents);
  }

  function renderFees(fees) {
    if (!fees) return;
    var cards = document.querySelectorAll("#onorari .summary-card__value");
    if (cards[0] && fees.start_fee_eur !== undefined) {
      cards[0].textContent = euro(fees.start_fee_eur);
    }
    if (cards[1] && fees.success_pct !== undefined) {
      cards[1].textContent = String(fees.success_pct) + " %";
    }
  }

  /* Un documento può essere in uno di tre stati, e la differenza conta:
     - `received`  → l'analista l'ha accettato
     - `rejected`  → l'analista ha chiesto di ricaricarlo, con una nota
     - `pending`   → caricato, in attesa di valutazione
     La nota del rifiuto va mostrata: senza, il cliente sa che c'è un problema
     ma non cosa correggere. */
  function statoDocumento(doc) {
    if (doc.status === "received") {
      return { classe: "", pill: "pill--active", testo: "Acquisito",
               sotto: "acquisito il " + shortDate(doc.created_at) };
    }
    if (doc.status === "rejected") {
      return { classe: " vault__item--missing", pill: "pill--rejected", testo: "Da ricaricare",
               sotto: doc.decision_note || "L'analista ha chiesto un nuovo documento." };
    }
    return { classe: "", pill: "pill--pending", testo: "In verifica",
             sotto: doc.has_file ? "caricato il " + shortDate(doc.created_at) : "in attesa di caricamento" };
  }

  function renderDocuments(docs) {
    var vault = document.getElementById("docs-table");
    if (!vault || !docs) return;
    vault.innerHTML = "";
    docs.forEach(function (doc) {
      var stato = statoDocumento(doc);
      var item = document.createElement("li");
      item.className = "vault__item" + stato.classe;
      item.innerHTML =
        '<span class="vault__ico" aria-hidden="true">' +
        (doc.status === "received"
          ? '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M9 1.8H4.2a1.4 1.4 0 00-1.4 1.4v9.6a1.4 1.4 0 001.4 1.4h7.6a1.4 1.4 0 001.4-1.4V6.2L9 1.8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
          : '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 5.4v3.2M8 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/></svg>') +
        "</span>" +
        '<div class="vault__main"><b></b><span></span></div>' +
        '<span class="vault__act">' +
        (doc.has_file
          ? '<button class="link-arrow xs" type="button" data-open-file="' + doc.id + '">Apri file</button> '
          : "") +
        '<span class="pill ' + stato.pill + '">' + stato.testo + "</span></span>";
      item.querySelector("b").textContent = doc.label;
      item.querySelector(".vault__main span").textContent = stato.sotto;
      vault.appendChild(item);
    });
  }

  /* Il documento non ha un indirizzo pubblico: si chiede un link firmato che
     scade dopo dieci minuti. Così un link incollato in una chat smette di
     funzionare, e il registro attività sa chi l'ha aperto. */
  function apriDocumento(id, bottone) {
    var testo = bottone.textContent;
    bottone.disabled = true;
    bottone.textContent = "Apro…";
    api.documentLink(id).then(function (res) {
      window.open(res.url, "_blank", "noopener");
    }).catch(function (err) {
      if (window.ui && ui.toast) ui.toast(err.message || "File non disponibile.", "error");
    }).then(function () {
      bottone.disabled = false;
      bottone.textContent = testo;
    });
  }

  function bindDocumenti() {
    var vault = document.getElementById("docs-table");
    if (!vault) return;
    vault.addEventListener("click", function (e) {
      var bottone = e.target.closest("[data-open-file]");
      if (!bottone) return;
      apriDocumento(bottone.getAttribute("data-open-file"), bottone);
    });
  }


  /* ------------------------------------------------------------- conto -- */
  /* Un conto si legge così: quanto è disponibile adesso, quanto è già
     impegnato, e cosa è successo. Il numero grande è il disponibile, non il
     saldo: è quello su cui il cliente può contare. Il resto è storia. */
  var contoState = { dati: null, movimenti: [] };

  function dataBreve(iso) {
    if (!iso) return "—";
    var mesi = ["gen", "feb", "mar", "apr", "mag", "giu",
                "lug", "ago", "set", "ott", "nov", "dic"];
    var p = String(iso).slice(0, 10).split("-");
    if (p.length !== 3) return String(iso);
    return Number(p[2]) + " " + mesi[Number(p[1]) - 1] + " " + p[0];
  }

  function etichettaMovimento(kind) {
    return {
      deposit: "Versamento",
      withdrawal: "Prelievo",
      buy: "Acquisto cripto",
      sell: "Vendita cripto",
      transfer_out: "Trasferimento",
      fee: "Spese",
      adjustment: "Rettifica",
      reversal: "Storno"
    }[kind] || kind;
  }

  function renderConto(dati) {
    contoState.dati = dati;
    set("conto-disponibile", euro(dati.disponibile));
    set("conto-saldo", euro(dati.saldo));
    set("conto-prenotato", euro(dati.prenotato));

    var pill = document.querySelector("[data-iban-pill]");
    var valore = document.querySelector("[data-iban-value]");
    var holder = document.querySelector("[data-iban-holder]");
    var hint = document.querySelector("[data-iban-hint]");

    if (dati.iban) {
      if (valore) valore.textContent = dati.iban_formatted;
      if (holder) holder.textContent = dati.iban_holder || "";
      if (pill) {
        pill.hidden = false;
        pill.textContent = dati.iban_verified ? "Verificato" : "Da verificare";
        pill.className = "pill " + (dati.iban_verified ? "pill--active" : "pill--pending");
      }
      if (hint) hint.textContent = dati.iban_verified
        ? "Coordinate confermate dall'analista."
        : "Le coordinate sono state salvate. L'analista le verifica prima del primo prelievo.";
    }

    var lista = document.querySelector("[data-movimenti]");
    if (!lista) return;
    if (!dati.movimenti || !dati.movimenti.length) {
      lista.innerHTML = '<li class="empty-state">Nessun movimento sul conto.</li>';
      return;
    }
    lista.innerHTML = "";
    dati.movimenti.slice(0, 6).forEach(function (m) {
      lista.appendChild(rigaMovimento(m));
    });
  }

  function rigaMovimento(m) {
    var item = document.createElement("li");
    var entrata = Number(m.amount_eur) > 0;
    item.className = "mov" + (entrata ? " mov--in" : " mov--out");
    item.innerHTML =
      '<span class="mov__sign" aria-hidden="true">' + (entrata ? "↓" : "↑") + "</span>" +
      '<span class="mov__main"><b></b><span></span></span>' +
      '<span class="mov__amount"></span>' +
      '<span class="mov__balance"></span>';
    item.querySelector("b").textContent = m.reference || etichettaMovimento(m.kind);
    item.querySelector(".mov__main span").textContent =
      etichettaMovimento(m.kind) + " · " + dataBreve(m.value_date);
    item.querySelector(".mov__amount").textContent =
      (entrata ? "+" : "") + euro(m.amount_eur);
    item.querySelector(".mov__balance").textContent = "saldo " + euro(m.balance_after);
    return item;
  }

  function caricaConto() {
    return api.conto().then(renderConto).catch(function (err) {
      if (err && err.code !== "28000" && window.ui && ui.toast) {
        ui.toast(err.message || "Conto non disponibile.", "error");
      }
    });
  }

  /* ------------------------------------------------- versa / preleva -- */
  function apriMovimento(tipo) {
    var modale = document.querySelector("[data-move-modal]");
    if (!modale) return;
    var prelievo = tipo === "withdrawal";
    var dati = contoState.dati || {};

    modale.querySelector("[data-move-title]").textContent = prelievo ? "Preleva" : "Versa";
    modale.querySelector("[data-move-intro]").textContent = prelievo
      ? "Il prelievo va sul conto che hai indicato. Resta in attesa finché un analista non lo approva, e fino ad allora l'importo resta impegnato."
      : "Un versamento si registra quando il bonifico arriva sul conto indicato dal contratto. Puoi prenotarlo qui e allegare la ricevuta.";
    modale.querySelector("[data-move-submit]").textContent = prelievo ? "Richiedi il prelievo" : "Registra il versamento";
    modale.querySelector("[data-move-hint]").textContent = prelievo
      ? "Disponibile: " + euro(dati.disponibile || 0)
      : "L'importo sarà accreditato dopo la verifica dell'analista.";
    modale.querySelector("[data-move-file-field]").hidden = prelievo;

    modale.setAttribute("data-tipo", tipo);
    modale.hidden = false;
    modale.querySelector("#move-amount").value = "";
    modale.querySelector("#move-note").value = "";
    var errore = modale.querySelector("[data-move-error]");
    if (errore) errore.hidden = true;
    setTimeout(function () { modale.querySelector("#move-amount").focus(); }, 30);
  }

  function chiudiMovimento() {
    var modale = document.querySelector("[data-move-modal]");
    if (modale) modale.hidden = true;
  }

  function inviaMovimento(event) {
    event.preventDefault();
    var modale = document.querySelector("[data-move-modal]");
    var tipo = modale.getAttribute("data-tipo") || "deposit";
    var importo = Number(modale.querySelector("#move-amount").value);
    var nota = modale.querySelector("#move-note").value;
    var errore = modale.querySelector("[data-move-error]");
    var submit = modale.querySelector("[data-move-submit]");

    if (!importo || importo <= 0) {
      errore.hidden = false;
      errore.textContent = "Indica un importo maggiore di zero.";
      return;
    }
    /* Il controllo dei fondi è nel database: qui si evita solo di far
       partire una richiesta che sappiamo già impossibile, così il cliente
       legge subito perché. */
    if (tipo === "withdrawal" && importo > Number((contoState.dati || {}).disponibile || 0)) {
      errore.hidden = false;
      errore.textContent = "Puoi prelevare al massimo " + euro((contoState.dati || {}).disponibile || 0) + ".";
      return;
    }

    submit.disabled = true;
    submit.textContent = "Invio…";
    errore.hidden = true;

    /* La ricevuta è facoltativa: se c'è, la allego alla pratica prima di
       registrare il movimento, così l'analista che approva trova già il
       documento senza doverlo chiedere. Se l'allegato fallisce, la richiesta
       parte lo stesso: il denaro non deve dipendere dall'upload. */
    var ricevuta = modale.querySelector("#move-file");
    var file = ricevuta && ricevuta.files && ricevuta.files[0];
    var allegato = file
      ? api.uploadDocument({
          file: file,
          label: (tipo === "withdrawal" ? "Richiesta di prelievo" : "Ricevuta di versamento") +
                 " · " + euro(importo),
          kind: "bancario",
          note: nota
        }).catch(function () { return null; })
      : Promise.resolve(null);

    allegato.then(function () {
      return api.createOperation({ type: tipo, amount_eur: importo, note: nota });
    })
      .then(function () {
        chiudiMovimento();
        if (window.ui && ui.toast) {
          ui.toast(tipo === "withdrawal"
            ? "Richiesta di prelievo inviata. Resta in attesa di approvazione."
            : "Versamento registrato. L'importo sarà accreditato dopo la verifica.", "ok");
        }
        return Promise.all([caricaConto(), load ? load() : null]);
      })
      .catch(function (err) {
        errore.hidden = false;
        errore.textContent = err.message || "Operazione non riuscita.";
      })
      .then(function () {
        submit.disabled = false;
        submit.textContent = tipo === "withdrawal" ? "Richiedi il prelievo" : "Registra il versamento";
      });
  }

  /* ---------------------------------------------------- estratto conto -- */
  var RANGE = {
    mese: [function (d) { return new Date(d.getFullYear(), d.getMonth(), 1); }, function (d) { return d; }],
    trimestre: [function (d) { return new Date(d.getFullYear(), d.getMonth() - 2, 1); }, function (d) { return d; }],
    anno: [function (d) { return new Date(d.getFullYear(), 0, 1); }, function (d) { return d; }],
    tutto: [function () { return new Date(2000, 0, 1); }, function (d) { return d; }]
  };

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function caricaEstratto(intervallo) {
    var oggi = new Date();
    var scelta = RANGE[intervallo] || RANGE.mese;
    var da = iso(scelta[0](oggi));
    var a = iso(scelta[1](oggi));
    var corpo = document.querySelector("[data-statement-body]");
    var piede = document.querySelector("[data-statement-foot]");
    corpo.innerHTML = '<tr><td colspan="5" class="empty-state">Caricamento…</td></tr>';

    return api.estrattoConto(da, a).then(function (dati) {
      if (!dati.movimenti.length) {
        corpo.innerHTML = '<tr><td colspan="5" class="empty-state">Nessun movimento nel periodo.</td></tr>';
      } else {
        corpo.innerHTML = dati.movimenti.map(function (m) {
          var entrata = Number(m.amount_eur) > 0;
          return "<tr>" +
            '<td class="xs mono">' + dataBreve(m.value_date) + "</td>" +
            "<td>" + ui.esc(m.reference || etichettaMovimento(m.kind)) +
              '<div class="xs muted">' + ui.esc(etichettaMovimento(m.kind)) + "</div></td>" +
            '<td class="num">' + (entrata ? euro(m.amount_eur) : "") + "</td>" +
            '<td class="num">' + (entrata ? "" : euro(m.amount_eur)) + "</td>" +
            '<td class="num mono">' + euro(m.balance_after) + "</td>" +
            "</tr>";
        }).join("");
      }
      if (piede) {
        piede.textContent = "Periodo " + dataBreve(dati.da) + " – " + dataBreve(dati.a) +
          " · saldo del periodo " + euro(dati.saldo_periodo) +
          " · saldo finale " + euro(dati.saldo_finale) +
          (dati.conto ? " · conto " + dati.conto : "");
      }
    }).catch(function (err) {
      corpo.innerHTML = '<tr><td colspan="5" class="empty-state">' +
        ui.esc(err.message || "Estratto non disponibile.") + "</td></tr>";
    });
  }

  function apriEstratto() {
    var modale = document.querySelector("[data-statement-modal]");
    if (!modale) return;
    modale.hidden = false;
    caricaEstratto("mese");
  }

  function bindConto() {
    arrayEach("[data-move]", function (bottone) {
      bottone.addEventListener("click", function () {
        apriMovimento(bottone.getAttribute("data-move"));
      });
    });

    var modale = document.querySelector("[data-move-modal]");
    if (modale) {
      modale.querySelector("[data-move-form]").addEventListener("submit", inviaMovimento);
      modale.querySelector("[data-move-cancel]").addEventListener("click", chiudiMovimento);
      modale.addEventListener("click", function (e) {
        if (e.target === modale) chiudiMovimento();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modale.hidden) chiudiMovimento();
      });
    }

    var moduloIban = document.querySelector("[data-iban-form]");
    if (moduloIban) {
      moduloIban.addEventListener("submit", function (e) {
        e.preventDefault();
        var errore = moduloIban.querySelector("[data-iban-error]");
        var iban = moduloIban.querySelector("#iban-value").value;
        var holder = moduloIban.querySelector("#iban-holder").value;
        var bottone = moduloIban.querySelector('button[type="submit"]');
        bottone.disabled = true;
        api.impostaIban(iban, holder).then(function () {
          errore.hidden = true;
          moduloIban.reset();
          if (window.ui && ui.toast) ui.toast("Coordinate salvate. L'analista le verifica.", "ok");
          return caricaConto();
        }).catch(function (err) {
          errore.hidden = false;
          errore.textContent = err.message || "Coordinate non valide.";
        }).then(function () { bottone.disabled = false; });
      });
    }

    var estratto = document.querySelector("[data-estratto]");
    if (estratto) estratto.addEventListener("click", apriEstratto);

    var modaleEstratto = document.querySelector("[data-statement-modal]");
    if (modaleEstratto) {
      modaleEstratto.querySelector("[data-statement-close]").addEventListener("click", function () {
        modaleEstratto.hidden = true;
      });
      modaleEstratto.querySelector("[data-statement-print]").addEventListener("click", function () {
        window.print();
      });
      modaleEstratto.addEventListener("click", function (e) {
        if (e.target === modaleEstratto) modaleEstratto.hidden = true;
      });
      arrayEach("[data-statement-range] .chip", function (chip) {
        chip.addEventListener("click", function () {
          arrayEach("[data-statement-range] .chip", function (c) { c.classList.remove("is-active"); });
          chip.classList.add("is-active");
          caricaEstratto(chip.getAttribute("data-range"));
        });
      });
    }
  }

  /* ------------------------------------------------------- contratto -- */
  /* La barra con "Accetta" compare solo se il contratto è ancora da
     accettare. `read_only` arriva da `auth_me`: quando un analista apre la
     pratica di un cliente la sessione è di sola lettura e l'accettazione,
     che è un atto del cliente, non deve essere possibile. */
  function syncContractBar(contract) {
    var accept = document.querySelector("[data-contract-accept]");
    if (!accept) return;
    var readOnly = !!(state.me && state.me.read_only);
    var accepted = !!(contract && contract.status === "accepted");
    accept.hidden = readOnly || accepted;
  }

  function renderContract() {
    var host = document.querySelector("[data-contract-host]");
    if (!host) return Promise.resolve(null);

    return api.contract().then(function (res) {
      var c = res && res.contract;
      if (!c || !window.TracciaContract) {
        host.innerHTML = '<p class="empty-state">Contratto non disponibile.</p>';
        return null;
      }
      host.innerHTML = window.TracciaContract.render(c);

      var numero = document.querySelector("[data-contract-number]");
      if (numero) numero.textContent = c.number || "—";

      var bar = document.querySelector("[data-contract-bar]");
      if (bar) bar.hidden = false;

      var stateEl = document.querySelector("[data-contract-state]");
      if (stateEl) {
        stateEl.textContent = c.status === "accepted"
          ? "Accettato il " + window.TracciaContract.data(c.accepted_at)
          : "In attesa di accettazione";
      }

      var accept = document.querySelector("[data-contract-accept]");
      if (accept) {
        /* `onclick` e non `addEventListener`: il render si ripete dopo
           l'accettazione e i gestori non devono accumularsi. */
        accept.onclick = function () {
          accept.disabled = true;
          accept.textContent = "Attendi…";
          api.acceptContract().then(function () {
            if (window.ui && ui.toast) ui.toast("Contratto accettato.", "success");
            return renderContract();
          }).catch(function (err) {
            accept.disabled = false;
            accept.textContent = "Accetta il contratto";
            if (window.ui && ui.toast) ui.toast(err.message, "error");
          });
        };
      }

      syncContractBar(c);
      return c;
    }).catch(function (err) {
      host.innerHTML = '<p class="empty-state">' +
        (window.ui && ui.esc ? ui.esc(err.message) : "Contratto non disponibile.") + "</p>";
      return null;
    });
  }

  function bindContractPrint() {
    var btn = document.querySelector("[data-contract-print]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      /* il contratto è annidato in .appv2__col: senza marcare la colonna la
         regola di stampa nasconderebbe anche il contenitore */
      var section = document.getElementById("contratto");
      var col = section && section.parentElement;
      if (col) col.classList.add("is-print-host");
      document.body.classList.add("is-printing");
      window.print();
      window.setTimeout(function () {
        document.body.classList.remove("is-printing");
        if (col) col.classList.remove("is-print-host");
      }, 600);
    });
  }

  function load() {
    caricaNotifiche();
    caricaConto();
    api.dashboard()
      .then(renderDashboard)
      .catch(function (err) {
        if (err.status === 401 || err.status === 403 || err.code === "28000") {
          window.location.replace("login.html?next=" + encodeURIComponent("app.html"));
          return;
        }
        if (window.ui && ui.toast) ui.toast(err.message, "error");
      });
  }

  function boot() {
    if (!guardSession()) return;
    bindContractPrint();

    bindTabs();
    bindNotify();
    bindRefresh(load);
    bindDropzone();
    bindSearch();
    bindForm();
    bindDocumenti();
    bindConto();
    bindLogoutAll();

    var staff = staffView();
    if (staff) applyStaffView(staff);

    var copyRef = function (ref) { bindCopy(ref); };
    var ref = caseRef();
    copyRef(ref);

    api.me().then(function (me) {
      state.me = me;
    }).catch(function () {
      /* se la sessione non è valida ci pensa `load()` a rimandare al login */
    }).then(function () {
      load();
      return renderContract();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
