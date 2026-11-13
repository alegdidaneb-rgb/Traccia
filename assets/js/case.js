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

  /* ------------------------------------------------- la pratica, dal vero -- */
  /* Le cinque fasi non sono più scritte nell'HTML: qui si disegnano dalla
     storia (`case_events`). Una fase è «fatta» solo se nella storia c'è una
     riga che dice che è stata raggiunta, e la data accanto è quella di quella
     riga. Se la storia non ha date — è il caso delle pratiche aperte prima
     del 2026-11-12 — la fase si mostra senza data invece di inventarne una.
     È il punto: meglio un trattino che una bugia. */
  var FASI = [
    { n: 1, nome: "Raccolta", testo: "Documenti e colloquio iniziale." },
    { n: 2, nome: "Ricostruzione", testo: "Flussi e indirizzi ricostruiti." },
    { n: 3, nome: "Perizia", testo: "Redazione del documento tecnico." },
    { n: 4, nome: "Denunce", testo: "Predisposizione degli atti per la denuncia." },
    { n: 5, nome: "Legale", testo: "Passaggio all'avvocato che assiste il recupero." }
  ];

  function quandoFase(storia, numero) {
    for (var i = 0; i < storia.length; i++) {
      if (Number(storia[i].phase) === numero) return storia[i].quando || null;
    }
    return null;
  }

  function paintStoria(kase, data) {
    var storia = (kase && kase.storia) || [];
    var attuale = Number(kase.phase_index || 1);
    var track = document.querySelector("[data-phase-track]");
    var feed = document.getElementById("ops-table");

    if (track) {
      track.innerHTML = "";
      FASI.forEach(function (fase) {
        var quando = quandoFase(storia, fase.n);
        var fatta = !!quando || fase.n < attuale;
        var corrente = fase.n === attuale;
        var li = document.createElement("li");
        li.className = "tl__item" +
          (fatta && !corrente ? " tl__item--done" : "") +
          (corrente ? " tl__item--current" : "");
        li.innerHTML =
          '<span class="tl__dot" aria-hidden="true">' +
          (fatta && !corrente
            ? '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : "") +
          "</span>" +
          '<div class="tl__main"><b></b><span></span></div>' +
          '<span class="tl__when"></span>';
        li.querySelector("b").textContent =
          String(fase.n).padStart(2, "0") + " · " + fase.nome;
        li.querySelector(".tl__main span").textContent = fase.testo;
        li.querySelector(".tl__when").textContent =
          quando ? dataISO(quando)
            : corrente ? "in corso"
            : fatta ? "completata"     /* fatta ma senza data: non si inventa */
            : "—";
        track.appendChild(li);
      });
    }

    if (!feed) return;
    /* La cronologia mette insieme le due cose che il cliente ha diritto di
       sapere e che il database conosce davvero: la storia delle fasi e i
       documenti caricati. In ordine di tempo, dal più recente. */
    var voci = [];
    storia.forEach(function (e) {
      if (primaDellaNascita(e.quando)) return;
      voci.push({
        quando: e.quando,
        titolo: e.phase === 0 ? "Pratica aperta"
                              : "Fase " + e.phase + " · " + (e.phase_name || ""),
        testo: e.note || (e.phase === 0
          ? "La pratica è stata registrata e presa in carico dall'ufficio."
          : "Passaggio registrato dall'ufficio analisi."),
        chi: e.chi
      });
    });
    (data.documents || []).forEach(function (d) {
      var giorno = d.created_at
        ? new Date(d.created_at * 1000).toISOString() : null;
      if (primaDellaNascita(giorno)) return;
      voci.push({
        quando: giorno,
        titolo: "Documento · " + (d.label || "caricato"),
        testo: d.status === "received" ? "Acquisito al fascicolo."
             : d.status === "rejected" ? (d.decision_note || "Da ricaricare.")
             : "In verifica da parte dell'ufficio.",
        chi: null
      });
    });
    voci.sort(function (a, b) {
      return new Date(b.quando || 0) - new Date(a.quando || 0);
    });

    if (!voci.length) {
      feed.innerHTML = '<li class="feed__item"><span class="feed__dot" aria-hidden="true"></span>' +
        '<div><b>Ancora nessun aggiornamento.</b> Qui compare tutto ciò che succede ' +
        'alla pratica, con la data: appena l\'ufficio registra il primo passaggio lo vedi.</div></li>';
      return;
    }

    feed.innerHTML = "";
    voci.forEach(function (v, indice) {
      var li = document.createElement("li");
      li.className = "feed__item" + (indice === 0 ? " feed__item--new" : "");
      li.innerHTML =
        '<span class="feed__dot' + (indice === 0 ? " feed__dot--on" : "") +
        '" aria-hidden="true"></span>' +
        "<div><b></b> <span class=\"feed__testo\"></span>" +
        '<span class="feed__when"></span></div>';
      li.querySelector("b").textContent = v.titolo + ".";
      li.querySelector(".feed__testo").textContent = v.testo;
      li.querySelector(".feed__when").textContent =
        dataISO(v.quando) + (v.chi ? " · " + v.chi : "");
      feed.appendChild(li);
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

  /* ------------------------------------------------------------ sezioni --
     Otto sezioni, una visibile per volta. Prima erano tutte una sotto
     l'altra: per arrivare agli onorari bisognava scorrere conto, bonifici,
     addebiti, interessi, carta. Chi non lo faceva non li vedeva.

     Il menu è fatto di collegamenti veri e la sezione è nell'indirizzo
     (`#onorari`): così si può mandare a qualcuno il punto esatto, il tasto
     indietro torna dove si era, e senza JavaScript le sezioni restano tutte
     visibili — degrada, non si rompe.

     La sezione attiva si deduce dall'indirizzo, non dal clic: un solo posto
     decide cosa si vede (`mostraSezione`), chiamato sia dal clic sia
     dall'apertura della pagina sia dal tasto indietro. */
  var SEZIONI = ["panoramica", "pratica", "documenti", "cronologia", "conto",
                 "onorari", "contratto", "sicurezza"];

  function sezioneDaIndirizzo() {
    var id = (window.location.hash || "").replace("#", "");
    return SEZIONI.indexOf(id) >= 0 ? id : "panoramica";
  }

  function mostraSezione(id, scorri) {
    SEZIONI.forEach(function (nome) {
      var sezione = document.getElementById(nome);
      if (sezione) sezione.hidden = nome !== id;
    });
    /* anche i pannelli dentro una sezione (`#carica`, dentro i documenti):
       senza questa riga restano visibili anche quando la loro sezione è
       nascosta, e comparivano in cima a ogni altra. Il caricamento dei file
       appartiene ai documenti, quindi si vede solo lì. */
    Array.prototype.forEach.call(document.querySelectorAll(".pnl--inner[id]"), function (pannello) {
      pannello.hidden = id !== (DOVE_STA[pannello.id] || id);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".area-nav__link"), function (link) {
      var attiva = link.getAttribute("data-tab") === id;
      link.classList.toggle("is-active", attiva);
      if (attiva) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    /* cambiando sezione si riparte dall'inizio del contenuto: restare a metà
       pagina dopo aver scelto «Contratto» fa credere che non sia successo
       niente */
    if (scorri !== false) {
      var testa = document.getElementById("main");
      if (testa) testa.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  /* I collegamenti che portano a un pannello dentro una sezione — «Aggiungi un
     file» → il caricamento, dentro i documenti — devono prima aprire la
     sezione, altrimenti il pannello è `hidden` e il clic sembra non fare
     niente. Vale anche per la voce «Versa» dell'intestazione, che porta al
     conto e apre già il modulo del versamento. */
  var DOVE_STA = { carica: "documenti" };

  function bindAncoreInterne() {
    Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
      var id = link.getAttribute("href").replace("#", "");
      if (!id || id === "main" || SEZIONI.indexOf(id) >= 0) return;
      if (!document.getElementById(id)) return;
      link.addEventListener("click", function () {
        mostraSezione(DOVE_STA[id] || "panoramica");
        var bersaglio = document.getElementById(id);
        if (bersaglio && bersaglio.scrollIntoView) bersaglio.scrollIntoView({ block: "start" });
      });
    });
  }

  function bindTabs() {
    var link = document.querySelectorAll(".area-nav__link");
    if (!link.length) return;
    mostraSezione(sezioneDaIndirizzo(), false);
    window.addEventListener("hashchange", function () {
      mostraSezione(sezioneDaIndirizzo());
    });
    bindAncoreInterne();
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

  /* La data intera, con l'anno.
     Prima era `{day:"2-digit", month:"short"}`: «12 mar». Su una pagina che
     deve dire quando è nata una pratica, senza l'anno «12 mar» non si può
     verificare — e chi legge pensa al marzo di quest'anno anche quando è un
     altro. Costa quattro caratteri e toglie un dubbio. */
  function shortDate(epoch) {
    if (!epoch) return "—";
    return new Intl.DateTimeFormat("it-IT",
      { day: "2-digit", month: "short", year: "numeric" })
      .format(new Date(epoch * 1000));
  }

  /* La stessa cosa per una data che arriva già in ISO dal database (la
     storia delle fasi). Se la stringa non è una data, si restituisce com'è:
     meglio una cosa scritta male che «Invalid Date» in faccia al cliente. */
  function dataISO(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("it-IT",
      { day: "2-digit", month: "short", year: "numeric" })
      .format(d);
  }

  /* Quando la pratica è nata. È il confine: nessuna riga della pagina può
     portare una data anteriore a questa, e se ne arriva una si nasconde
     invece di mostrarla — un evento prima della nascita è un dato sbagliato,
     non una notizia. */
  var nascita = null;

  function primaDellaNascita(iso) {
    if (!nascita || !iso) return false;
    var d = new Date(iso);
    return !isNaN(d.getTime()) && d.getTime() < nascita.getTime();
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
    /* senza il «/ 4»: non esiste un numero giusto di documenti, dipende dal
       caso. «2 / 4» faceva sembrare mancante qualcosa che nessuno ha chiesto. */
    set("stat-docs", String(data.documents_count || 0));
    set("docs-count", String(data.documents_count || 0));
    /* il numero accanto alla voce «Documenti» nella barra laterale: serve a
       sapere se c'è qualcosa nella sezione **senza aprirla**. Zero non si
       mostra: un «0» accanto a una voce è un avviso, e non c'è niente da
       avvisare. */
    var navDocumenti = document.querySelector("[data-nav-documenti]");
    if (navDocumenti) {
      var quanti = Number(data.documents_count) || 0;
      navDocumenti.textContent = String(quanti);
      navDocumenti.hidden = quanti === 0;
    }
    set("phase-index", String(kase.phase_index || 1).padStart(2, "0"));
    set("phase-name", kase.phase_name || "—");
    set("phase-pct", (kase.percent || 0) + "%");

    set("docs-missing", (data.documents_count || 0)
      ? "nel fascicolo" : "nessuno ancora caricato");

    var statusLine = "Pratica " + (kase.ref || "—") + " · Fase " +
      String(kase.phase_index || 1).padStart(2, "0") + " — " + (kase.phase_name || "");
    set("user-status-line", statusLine);

    /* la nascita della pratica: la data più vecchia che questa pagina può
       mostrare, e il filtro di tutto ciò che segue */
    nascita = kase.aperta_il ? new Date(kase.aperta_il) : null;
    if (nascita && isNaN(nascita.getTime())) nascita = null;

    paintStoria(kase, data);
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
    /* `pill--rejected` non esiste nel foglio di stile: la pillola usciva
       senza colore, cioè un avviso che sembrava una nota. Lo stato «da
       ricaricare» è la cosa più urgente che questa pagina può dire, e ora ha
       il rosso delle cose da fare (`pill--denied`). */
    if (doc.status === "received") {
      return { classe: "", pill: "pill--active", testo: "Acquisito",
               sotto: "acquisito il " + shortDate(doc.created_at) };
    }
    if (doc.status === "rejected") {
      return { classe: " vault__item--missing", pill: "pill--denied", testo: "Da ricaricare",
               sotto: doc.decision_note || "L'analista ha chiesto un nuovo documento." };
    }
    return { classe: "", pill: "pill--pending", testo: "In verifica",
             sotto: doc.has_file ? "caricato il " + shortDate(doc.created_at) : "in attesa di caricamento" };
  }

  var rigaVuotaSalvata = null;

  function rigaVuota() {
    if (rigaVuotaSalvata) {
      var copia = rigaVuotaSalvata.cloneNode(true);
      copia.setAttribute("data-docs-empty", "");
      return copia;
    }
    var li = document.createElement("li");
    li.className = "vault__item vault__item--missing";
    li.setAttribute("data-docs-empty", "");
    li.innerHTML =
      '<span class="vault__ico" aria-hidden="true">' +
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 5.4v3.2M8 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/></svg>' +
      "</span>" +
      '<div class="vault__main"><b>Nessun documento ancora</b>' +
      "<span>Carica il primo qui sotto: estratto conto, ricevute dei bonifici, screenshot della piattaforma.</span></div>" +
      '<span class="vault__act"><span class="pill pill--pending">Vuoto</span></span>';
    return li;
  }

  function renderDocuments(docs) {
    var vault = document.getElementById("docs-table");
    if (!vault || !docs) return;
    if (!rigaVuotaSalvata) {
      var esistente = vault.querySelector("[data-docs-empty]");
      if (esistente) rigaVuotaSalvata = esistente.cloneNode(true);
    }
    vault.innerHTML = "";
    if (!docs.length) {
      /* La riga che spiega il vuoto sta nell'HTML: la prima volta si prende
         da lì, le volte dopo si ricostruisce — perché quella originale viene
         staccata appena arriva il primo documento, e senza questo una pratica
         che tornasse vuota mostrerebbe un riquadro bianco. */
      vault.appendChild(rigaVuota());
      return;
    }
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
        /* Caricare il file sbagliato è normale (è la ricevuta di un'altra
           banca, uno screenshot illeggibile). Senza questo bottone l'unica
           via era scrivere all'assistenza per farlo togliere. */
        (doc.status !== "received"
          ? '<button class="link-arrow xs" type="button" data-remove-doc="' + doc.id + '">Togli</button> '
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
      if (bottone) {
        apriDocumento(bottone.getAttribute("data-open-file"), bottone);
        return;
      }
      /* Togliere un documento: si chiede conferma, perché non c'è un
         «annulla» e il file va ricaricato. La conferma dice anche cosa si
         perde, che è la sola cosa che rende la domanda utile. */
      var togli = e.target.closest("[data-remove-doc]");
      if (!togli) return;
      var riga = togli.closest(".vault__item");
      var nome = riga && riga.querySelector("b") ? riga.querySelector("b").textContent : "questo documento";
      /* `ask` restituisce `null` se si annulla e una stringa se si conferma
         (vuota quando non c'è campo da compilare): il vero è nel primo caso
         `null`, nel secondo una stringa — anche vuota, che con `if (!si)`
         sarebbe stata letta come un rifiuto. */
      window.ui.ask({
        title: "Togliere il documento?",
        message: "«" + nome + "» verrà rimosso dal fascicolo. Potrai caricarlo di nuovo quando vuoi.",
        confirm: "Togli",
        danger: true
      }).then(function (si) {
        if (si === null) return;
        togli.disabled = true;
        api.rimuoviDocumento(togli.getAttribute("data-remove-doc"))
          .then(function () { return load(); })
          .catch(function (err) {
            togli.disabled = false;
            window.ui.toast(err.message || "Non è stato possibile togliere il documento.", "error");
          });
      });
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
      /* Su un conto senza movimenti il saldo non è «zero»: non c'è nessun
         movimento che lo giustifichi. Il numero può esserci lo stesso (una
         rettifica importata, un saldo iniziale) e allora va tenuto — ma va
         detto che non si può ricostruire, altrimenti chi legge crede di aver
         perso dei soldi. Prima la pagina scriveva «Nessun movimento» sotto un
         saldo senza spiegazione. */
      var saldo = Number(dati.saldo) || 0;
      lista.innerHTML = saldo
        ? '<li class="empty-state">Nessun movimento sul conto. Il saldo di ' +
          euro(saldo) + " è stato registrato dall'ufficio e non risulta da " +
          "movimenti: chiedi il dettaglio all'analista.</li>"
        : '<li class="empty-state">Nessun movimento sul conto.</li>';
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
  /* «Preleva» non crea più un'operazione a parte: apre un bonifico già
     compilato verso l'IBAN del cliente. Due percorsi per far uscire denaro
     erano due percorsi da tenere allineati, e il prelievo vecchio non passava
     dai canali SEPA (niente IBAN del beneficiario, niente esito della banca).
     Ora c'è un modo solo, e la differenza sta nel beneficiario. */
  function apriPrelievo() {
    var dati = contoState.dati || {};
    if (!dati.iban) {
      if (window.ui && ui.toast) {
        ui.toast("Prima indica l'IBAN del tuo conto: è lì che vanno i prelievi.", "error");
      }
      var form = document.querySelector("[data-iban-form]");
      if (form) {
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        var campo = form.querySelector("#iban-value");
        if (campo) campo.focus();
      }
      return;
    }
    if (!dati.iban_verified) {
      if (window.ui && ui.toast) {
        ui.toast("Le coordinate sono salvate ma non ancora verificate: il prelievo si dispone dopo la verifica dell'analista.", "error");
      }
      return;
    }
    apriBonifico();
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    modale.querySelector("#bon-iban").value = dati.iban_formatted || dati.iban;
    modale.querySelector("#bon-ben").value = ((window.api && api.cachedUser && api.cachedUser()) || {}).name || "";
    var causale = modale.querySelector("#bon-causale");
    if (causale) causale.value = "Prelievo sul mio conto";
    var titolo = modale.querySelector("#bon-title");
    if (titolo) titolo.textContent = "Preleva sul tuo conto";
    aggiornaRiepilogoBonifico();
    modale.querySelector("#bon-importo").focus();
  }

  function apriMovimento(tipo) {
    if (tipo === "withdrawal") return apriPrelievo();
    var modale = document.querySelector("[data-move-modal]");
    if (!modale) return;
    var prelievo = false;
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

  /* ------------------------------------------------ bonifici e canali -- */
  /* Un conto senza canali di pagamento è un salvadanaio. Qui ci sono le
     quattro cose che mancavano: mandare denaro fuori (bonifico SEPA),
     autorizzare qualcuno a prelevarlo (addebito diretto), maturare interessi,
     e avere una carta da bloccare in fretta.
     L'interfaccia non decide nulla: mostra lo stato che il database ha già
     deciso, perché un bonifico "inviato" e uno "eseguito" sono cose diverse e
     il cliente deve poterle distinguere a colpo d'occhio. */
  var bancaState = { dati: null, modale: null };

  var STATO_BONIFICO = {
    queued: { testo: "In coda", pill: "pill--pending" },
    sent: { testo: "Inviato alla banca", pill: "pill--pending" },
    executed: { testo: "Eseguito", pill: "pill--active" },
    rejected: { testo: "Respinto", pill: "pill--rejected" },
    returned: { testo: "Restituito", pill: "pill--rejected" },
    cancelled: { testo: "Annullato", pill: "pill--muted" }
  };

  var STATO_MANDATO = {
    active: { testo: "Attivo", pill: "pill--active" },
    revoked: { testo: "Revocato", pill: "pill--muted" }
  };

  var STATO_ADDEBITO = {
    pending: { testo: "In arrivo", pill: "pill--pending" },
    collected: { testo: "Incassato", pill: "pill--active" },
    refused: { testo: "Rifiutato", pill: "pill--rejected" },
    refunded: { testo: "Rimborsato", pill: "pill--active" },
    cancelled: { testo: "Annullato", pill: "pill--muted" }
  };

  var STATO_CARTA = {
    pending: { testo: "In attivazione", pill: "pill--pending" },
    active: { testo: "Attiva", pill: "pill--active" },
    blocked: { testo: "Bloccata", pill: "pill--rejected" },
    cancelled: { testo: "Annullata", pill: "pill--muted" }
  };

  function pillStato(mappa, stato) {
    var s = mappa[stato] || { testo: stato || "—", pill: "pill--pending" };
    return '<span class="pill ' + s.pill + '">' + ui.esc(s.testo) + "</span>";
  }

  function dataLunga(iso) {
    if (!iso) return "—";
    /* la data SEPA arriva come "2026-11-05": la stessa funzione dell'estratto
       conto evita due formati diversi nello stesso schermo */
    return dataBreve(iso);
  }

  function caricaBanca() {
    return api.banca().then(renderBanca).catch(function (err) {
      if (err && err.code === "28000") return;
      if (window.ui && ui.toast) ui.toast(err.message || "Canali di pagamento non disponibili.", "error");
    });
  }

  function renderBanca(dati) {
    bancaState.dati = dati;
    renderBonifici(dati.bonifici || []);
    renderMandati(dati.mandati || []);
    renderInteressi(dati.interessi || {});
    renderCarta((dati.carte || [])[0]);
    popolaCause(dati.purposes || []);
  }

  function renderBonifici(lista) {
    var ul = document.querySelector("[data-bonifici]");
    if (!ul) return;
    if (!lista.length) {
      ul.innerHTML = '<li class="empty-state">Nessun bonifico disposto.</li>';
      return;
    }
    ul.innerHTML = "";
    lista.forEach(function (b) {
      var li = document.createElement("li");
      li.className = "rail-item";
      var st = STATO_BONIFICO[b.status] || { testo: b.status, pill: "pill--pending" };
      /* annullabile solo finché la banca non l'ha preso: dopo, tocca
         all'assistenza, e il pulsante non deve suggerire il contrario */
      /* «Ricevuta» c'è sempre, anche per un bonifico respinto: è proprio il
         respinto quello che serve mostrare alla banca o al creditore. */
      var azioni = '<button class="link-arrow xs" type="button" data-bonifico-ricevuta="' + ui.esc(b.id) + '">ricevuta</button>';
      if (b.status === "queued") {
        azioni += ' <button class="link-arrow xs" type="button" data-bonifico-annulla="' + ui.esc(b.id) + '">annulla</button>';
      }
      var motivo = (b.bank_code || b.bank_message)
        ? '<div class="xs muted">' + ui.esc([b.bank_code, b.bank_message].filter(Boolean).join(" · ")) + "</div>"
        : "";
      li.innerHTML =
        '<div class="rail-item__main">' +
          "<b>" + ui.esc(b.beneficiary_name) + "</b>" +
          '<div class="xs muted mono">' + ui.esc(b.beneficiary_iban) + "</div>" +
          '<div class="xs muted">' + (b.scheme === "sepa_instant" ? "Istantaneo" : "Ordinario") +
            " · richiesta " + dataLunga(b.requested_date) +
            (b.remittance ? " · " + ui.esc(b.remittance) : "") + "</div>" +
          motivo +
        "</div>" +
        '<div class="rail-item__side">' +
          '<span class="rail-item__amount">' + euro(b.amount_eur) + "</span>" +
          '<span class="pill ' + st.pill + '">' + ui.esc(st.testo) + "</span>" +
          '<span class="xs mono muted">' + ui.esc(b.reference) + "</span>" +
          azioni +
        "</div>";
      ul.appendChild(li);
    });
  }

  function renderMandati(lista) {
    var ul = document.querySelector("[data-mandati]");
    if (!ul) return;
    if (!lista.length) {
      ul.innerHTML = '<li class="empty-state">Nessun mandato firmato.</li>';
      return;
    }
    ul.innerHTML = "";
    lista.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "rail-item rail-item--stack";
      var st = STATO_MANDATO[m.status] || { testo: m.status, pill: "pill--pending" };
      var revoca = m.status === "active"
        ? '<button class="link-arrow xs" type="button" data-mandato-revoca="' + ui.esc(m.id) + '">revoca</button>'
        : "";
      var addebiti = (m.debits || []).length
        ? '<ul class="rail-sublist">' + m.debits.map(function (d) {
            var ds = STATO_ADDEBITO[d.status] || { testo: d.status, pill: "pill--pending" };
            var contesta = (d.status === "pending" || d.status === "collected")
              ? '<button class="link-arrow xs" type="button" data-addebito-contesta="' + ui.esc(d.id) +
                '" data-addebito-stato="' + ui.esc(d.status) + '">contesta</button>'
              : "";
            return "<li>" +
              '<span class="mono xs">' + ui.esc(d.reference) + "</span>" +
              "<span>" + euro(d.amount_eur) + "</span>" +
              '<span class="pill ' + ds.pill + '">' + ui.esc(ds.testo) + "</span>" +
              '<span class="xs muted">' + dataLunga(d.due_date) + "</span>" +
              contesta +
            "</li>";
          }).join("") + "</ul>"
        : '<div class="xs muted">Nessun addebito presentato.</div>';
      li.innerHTML =
        '<div class="rail-item__main">' +
          "<b>" + ui.esc(m.creditor_name) + "</b>" +
          '<div class="xs muted">' + ui.esc(m.scheme === "b2b" ? "Mandato B2B" : "Mandato CORE") +
            " · firmato il " + dataLunga(m.signed_on) + " · " + ui.esc(m.umr) + "</div>" +
          '<div class="xs muted mono">' + ui.esc(m.account_iban) + "</div>" +
        "</div>" +
        '<div class="rail-item__side">' +
          '<span class="pill ' + st.pill + '">' + ui.esc(st.testo) + "</span>" +
          revoca +
        "</div>" + addebiti;
      ul.appendChild(li);
    });
  }

  /* Gli interessi si mostrano come tasso e come maturato, non come promessa:
     «0,00 € / giorno» con un tasso a zero è l'informazione giusta, e dice
     perché non arriva niente. */
  function renderInteressi(i) {
    var tasso = Number(i.rate_pct || 0);
    var testo = tasso > 0
      ? String(tasso).replace(".", ",") + " % annuo"
      : "non previsti";
    var set1 = function (sel, valore) {
      var nodo = document.querySelector(sel);
      if (nodo) nodo.textContent = valore;
    };
    set1("[data-interessi-tasso]", testo);
    set1("[data-interessi-tasso-testo]", testo);
    set1("[data-interessi-giorno]", euro(i.giornaliero_eur || 0));
    set1("[data-interessi-maturato]", euro(i.maturato_eur || 0));
    set1("[data-interessi-prossimo]", i.prossimo_accredito ? dataLunga(i.prossimo_accredito) : "—");
    var nota = document.querySelector("[data-interessi-nota]");
    if (nota) {
      nota.textContent = tasso > 0
        ? "Maturano sulla giacenza e si accreditano in un movimento unico il " +
          dataLunga(i.prossimo_accredito) + ". Sotto il centesimo si accumulano, non si perdono."
        : "Su questo conto il tasso creditore è a zero: non maturano interessi. " +
          "Il tasso è indicato nel contratto e non cambia senza comunicazione.";
    }
  }

  function renderCarta(carta) {
    var box = document.querySelector("[data-carta]");
    var vuota = document.querySelector("[data-carta-vuota]");
    var azioni = document.querySelector("[data-carta-azioni]");
    var richiedi = document.querySelector("[data-carta-richiedi]");
    if (!box) return;

    if (!carta) {
      box.hidden = true;
      if (azioni) azioni.hidden = true;
      if (vuota) vuota.hidden = false;
      if (richiedi) richiedi.hidden = false;
      return;
    }

    box.hidden = false;
    if (vuota) vuota.hidden = true;
    if (richiedi) richiedi.hidden = true;
    if (azioni) azioni.hidden = carta.status === "cancelled";

    var pill = box.querySelector("[data-carta-pill]");
    var stato = STATO_CARTA[carta.status] || { testo: carta.status, pill: "pill--pending" };
    if (pill) {
      pill.textContent = stato.testo;
      pill.className = "pill " + stato.pill;
    }
    var numero = box.querySelector("[data-carta-numero]");
    if (numero) numero.textContent = "•••• •••• •••• " + carta.last4;
    var rif = box.querySelector("[data-carta-reference]");
    if (rif) rif.textContent = carta.reference;
    var scad = box.querySelector("[data-carta-scadenza]");
    if (scad) scad.textContent = "scad. " + (carta.expires_on ? dataLunga(carta.expires_on) : "—");

    var blocca = document.querySelector("[data-carta-blocca]");
    var sblocca = document.querySelector("[data-carta-sblocca]");
    if (blocca) blocca.hidden = carta.status !== "pending" && carta.status !== "active";
    if (sblocca) sblocca.hidden = carta.status !== "blocked";

    box.setAttribute("data-card-status", carta.status);
  }

  function popolaCause(lista) {
    var sel = document.querySelector("[data-bon-purpose]");
    if (!sel || sel.options.length) return;
    lista.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.code;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
  }

  /* ISO 13616: il codice di controllo di un IBAN sono le cifre 3 e 4, e si
     verificano con un mod 97 sul numero ottenuto spostando i primi quattro
     caratteri in fondo e sostituendo A=10 … Z=35. Un IBAN con una cifra
     sbagliata non arriva alla banca: torna indietro, e il cliente pensa di
     aver pagato. Il controllo costa un ciclo e vale un bonifico respinto. */
  function ibanValido(valore) {
    var s = String(valore || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s.length < 15 || s.length > 34) return false;
    if (!/^[A-Z]{2}[0-9]{2}$/.test(s.slice(0, 4))) return false;
    var spostato = s.slice(4) + s.slice(0, 4);
    var resto = 0;
    for (var i = 0; i < spostato.length; i++) {
      var ch = spostato.charAt(i);
      var cifre = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (var j = 0; j < cifre.length; j++) {
        resto = (resto * 10 + Number(cifre.charAt(j))) % 97;
      }
    }
    return resto === 1;
  }

  /* --------------------------------------------------- modale bonifico -- */
  function apriBonifico() {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var titolo = modale.querySelector("#bon-title");
    if (titolo) titolo.textContent = "Nuovo bonifico SEPA";
    var dati = contoState.dati || {};
    var hint = modale.querySelector("[data-bon-importo-hint]");
    if (hint) hint.textContent = "Disponibile: " + euro(dati.disponibile || 0);
    var data = modale.querySelector("#bon-data");
    if (data) data.value = new Date().toISOString().slice(0, 10);
    modale.querySelector("[data-bonifico-form]").reset();
    if (data) data.value = new Date().toISOString().slice(0, 10);
    var errore = modale.querySelector("[data-bonifico-error]");
    if (errore) errore.hidden = true;
    aggiornaRiepilogoBonifico();
    modale.hidden = false;
    setTimeout(function () {
      var primo = modale.querySelector("#bon-iban");
      if (primo) primo.focus();
    }, 30);
  }

  function chiudiBonifico() {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (modale) modale.hidden = true;
    var form = modale && modale.querySelector("[data-bonifico-form]");
    var pannello = modale && modale.querySelector("[data-bonifico-conferma]");
    if (form) form.hidden = false;
    if (pannello) pannello.hidden = true;
    /* chiudere con una conferma aperta significa rinunciarci: i soldi tornano
       disponibili subito, e il cliente non deve aspettare dieci minuti */
    if (bonificoInCorso.challenge) {
      var ch = bonificoInCorso.challenge;
      bonificoInCorso.challenge = null;
      api.rinunciaBonifico(ch).then(function () { return caricaConto(); })
        .catch(function () {});
    }
  }

  function datiBonifico() {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return null;
    var importo = Number(modale.querySelector("#bon-importo").value);
    return {
      iban: modale.querySelector("#bon-iban").value.trim(),
      beneficiario: modale.querySelector("#bon-ben").value.trim(),
      importo: importo,
      causale: modale.querySelector("#bon-causale").value.trim(),
      purpose: modale.querySelector("#bon-purpose").value || "OTHR",
      istantaneo: modale.querySelector("#bon-istantaneo").checked,
      data: modale.querySelector("#bon-data").value || null,
      date: modale.querySelector("#bon-data")
    };
  }

  /* Il riepilogo serve a un'altra cosa che il riquadro non fa: dire *quando*
     il denaro arriva. Istantaneo e ordinario non sono la stessa promessa. */
  function aggiornaRiepilogoBonifico() {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var riepilogo = modale.querySelector("[data-bonifico-riepilogo]");
    if (!riepilogo) return;
    var d = datiBonifico();
    if (!d) return;
    var quando = d.istantaneo
      ? "entro pochi secondi"
      : "entro il giorno lavorativo successivo alla data indicata";
    riepilogo.textContent = d.importo > 0
      ? euro(d.importo) + " a " + (d.beneficiario || "beneficiario") + ", " + quando + "."
      : "Seleziona istantaneo o ordinario: cambia quando arriva il denaro.";
  }

  /* ------------------------------------------------------ due tempi -- */
  /* Il cliente ha descritto il difetto così: «non mi permette di andare avanti
     e tutto si blocca». Il blocco non era la rete: era il pulsante che si
     spegneva perché il browser confrontava l'importo con la disponibilità
     letta in un altro momento. Qui quel confronto non c'è più. Si controlla
     solo ciò che il browser può sapere senza mentire — che i campi siano
     compilati e che l'IBAN abbia una forma plausibile — e tutto il resto lo
     decide il server, che ha i soldi davanti.
     Il secondo tempo è il codice: il bonifico non esiste finché il cliente non
     lo conferma con le sei cifre. */
  var bonificoInCorso = { challenge: null, dati: null };

  function inviaBonifico(event) {
    if (event) event.preventDefault();
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var errore = modale.querySelector("[data-bonifico-error]");
    var submit = modale.querySelector("[data-bonifico-submit]");
    var d = datiBonifico();
    if (!d) return;

    /* solo forma, mai disponibilità: quella non è una cosa che il browser sa */
    var problema = null;
    if (!d.importo || d.importo <= 0) problema = "Indica un importo maggiore di zero.";
    else if (!ibanValido(d.iban)) problema = "L'IBAN del beneficiario non è valido: controlla le cifre.";
    else if (d.beneficiario.length < 3) problema = "Indica il nome del beneficiario.";
    if (problema) {
      errore.hidden = false;
      errore.textContent = problema;
      return;
    }

    errore.hidden = true;
    submit.disabled = true;
    submit.textContent = "Verifico…";
    api.preparaBonifico(d).then(function (res) {
      bonificoInCorso.challenge = res.challenge_id;
      bonificoInCorso.dati = res;
      mostraConfermaBonifico(res);
      /* la disponibilità è cambiata: si rilegge, ma per mostrarla, non per
         decidere se il cliente può */
      return caricaConto();
    }).catch(function (err) {
      errore.hidden = false;
      errore.textContent = err.message || "Bonifico non disposto.";
    }).then(function () {
      submit.disabled = false;
      submit.textContent = "Continua";
    });
  }

  /* Il secondo pannello della stessa modale. Non è una seconda finestra: il
     cliente ha appena compilato un modulo e non deve ritrovarsi a ricominciare
     da capo se sbaglia una cifra. */
  function mostraConfermaBonifico(res) {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var form = modale.querySelector("[data-bonifico-form]");
    var pannello = modale.querySelector("[data-bonifico-conferma]");
    if (!pannello) return;
    if (form) form.hidden = true;
    pannello.hidden = false;

    var importo = euro(res.importo_eur || 0);
    arrayEach("[data-conferma-riepilogo]", function (n) {
      n.innerHTML = "<strong>" + ui.esc(importo) + "</strong> a " +
        ui.esc(res.beneficiario || "") +
        "<br><span class=\"small muted\">" + ui.esc(res.iban || "") + "</span>";
    });
    arrayEach("[data-conferma-email]", function (n) {
      n.textContent = res.email || "il tuo indirizzo";
    });
    arrayEach("[data-conferma-scadenza]", function (n) {
      n.textContent = res.minuti || 10;
    });
    var errore = modale.querySelector("[data-conferma-error]");
    if (errore) { errore.hidden = true; errore.textContent = ""; }
    var codice = modale.querySelector("[data-conferma-codice]");
    if (codice) { codice.value = ""; codice.disabled = false; }
    var invia = modale.querySelector("[data-conferma-submit]");
    if (invia) { invia.disabled = false; invia.textContent = "Conferma il bonifico"; }
    var annulla = modale.querySelector("[data-conferma-indietro]");
    if (annulla) annulla.textContent = "Modifica i dati";

    setTimeout(function () {
      var primo = modale.querySelector("[data-conferma-codice]");
      if (primo) primo.focus();
    }, 60);
  }

  function tornaAlModuloBonifico(annullaRichiesta) {
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var form = modale.querySelector("[data-bonifico-form]");
    var pannello = modale.querySelector("[data-bonifico-conferma]");
    if (form) form.hidden = false;
    if (pannello) pannello.hidden = true;
    /* Tornare indietro senza dirlo lascerebbe i soldi impegnati per una
       richiesta che il cliente crede di aver ritirato. */
    if (annullaRichiesta && bonificoInCorso.challenge) {
      api.rinunciaBonifico(bonificoInCorso.challenge).then(function () {
        bonificoInCorso.challenge = null;
        return caricaConto();
      }).catch(function () { /* scade da sola: non è un errore da mostrare */ });
    }
  }

  function confermaBonifico(event) {
    if (event) event.preventDefault();
    var modale = document.querySelector("[data-bonifico-modal]");
    if (!modale) return;
    var campo = modale.querySelector("[data-conferma-codice]");
    var errore = modale.querySelector("[data-conferma-error]");
    var submit = modale.querySelector("[data-conferma-submit]");
    var codice = campo ? String(campo.value || "").replace(/\D/g, "") : "";

    if (!bonificoInCorso.challenge) {
      if (errore) {
        errore.hidden = false;
        errore.textContent = "La richiesta è scaduta: disponi di nuovo il bonifico.";
      }
      return;
    }
    if (codice.length !== 6) {
      if (errore) {
        errore.hidden = false;
        errore.textContent = "Il codice ha sei cifre.";
      }
      return;
    }

    if (errore) errore.hidden = true;
    if (submit) { submit.disabled = true; submit.textContent = "Confermo…"; }
    api.confermaBonifico(bonificoInCorso.challenge, codice).then(function (res) {
      bonificoInCorso.challenge = null;
      chiudiBonifico();
      if (window.ui && ui.toast) {
        ui.toast("Bonifico " + (res.reference || "") + " disposto. Resta in coda finché la banca non lo esegue.", "ok");
      }
      if (res && res.id) raggiungiRicevuta(res.id, res.reference);
      return Promise.all([caricaBanca(), caricaConto()]);
    }).catch(function (err) {
      if (errore) {
        errore.hidden = false;
        errore.textContent = err.message || "Codice non accettato.";
      }
      if (err && /annullata|scaduto|usata/i.test(err.message || "")) {
        /* la richiesta non esiste più: si torna al modulo invece di lasciare
           il cliente a premere un pulsante che non può funzionare */
        bonificoInCorso.challenge = null;
        var invia = modale.querySelector("[data-conferma-submit]");
        if (invia) { invia.disabled = true; invia.textContent = "Richiesta chiusa"; }
        if (campo) campo.disabled = true;
        if (errore) errore.textContent = (err.message || "") + " Ricomincia dal modulo.";
        if (typeof caricaConto === "function") caricaConto();
      }
    }).then(function () {
      if (submit && submit.textContent === "Confermo…") {
        submit.disabled = false;
        submit.textContent = "Conferma il bonifico";
      }
    });
  }

  /* Appena disposto, il bonifico compare nell'elenco: la ricevuta si offre lì.
     Un modale sopra un modale, o un dialogo che ruba la scena, sarebbe di
     troppo; il pulsante «ricevuta» è già sulla riga, e questo lo evidenzia. */
  function raggiungiRicevuta(id, riferimento) {
    setTimeout(function () {
      var riga = document.querySelector('[data-bonifico-ricevuta="' + id + '"]');
      if (riga) {
        riga.classList.add("is-new");
        setTimeout(function () { riga.classList.remove("is-new"); }, 4000);
      }
      if (window.ui && ui.toast) {
        ui.toast("Ricevuta di " + (riferimento || "disposizione") + " pronta: «ricevuta» nell'elenco.", "ok");
      }
    }, 400);
  }

  /* ------------------------------------------------------- ricevuta -- */
  /* Una ricevuta si legge come un documento, non come una schermata: chi la
     stampa la mostra a un commercialista o a un creditore. Per questo il
     codice della banca e la data valuta stanno in chiaro, e la nota dice cosa
     il documento NON è. */
  function statoBonifico(b) {
    var st = STATO_BONIFICO[b.stato] || { testo: b.stato, pill: "pill--pending" };
    return st;
  }

  function testoRicevuta(r) {
    var st = statoBonifico(r);
    var righe = [
      ["Numero", r.numero],
      ["Stato", st.testo],
      ["Schema", r.schema],
      ["Importo", euro(r.importo_eur)],
      ["Beneficiario", (r.beneficiario || {}).nome],
      ["IBAN beneficiario", (r.beneficiario || {}).iban],
      ["Causale", r.causale || "—"],
      ["Codice causale", r.codice_causale || "—"],
      ["Data disposizione", dataLunga(String(r.data_disposizione || "").slice(0, 10))],
      ["Data richiesta", dataLunga(r.data_richiesta)],
      ["Data valuta", r.data_valuta ? dataLunga(r.data_valuta) : "non ancora eseguito"],
      ["Saldo dopo", r.saldo_dopo_eur === null || r.saldo_dopo_eur === undefined
        ? "—" : euro(r.saldo_dopo_eur)]
    ];
    if (r.codice_banca || r.messaggio_banca) {
      righe.push(["Esito banca", [r.codice_banca, r.messaggio_banca].filter(Boolean).join(" · ")]);
    }
    return righe;
  }

  function apriRicevuta(id) {
    var modale = document.querySelector("[data-receipt-modal]");
    if (!modale) return;
    var corpo = modale.querySelector("[data-receipt-body]");
    var testa = modale.querySelector("[data-receipt-head]");
    var piede = modale.querySelector("[data-receipt-foot]");
    if (corpo) corpo.innerHTML = '<p class="empty-state">Preparo la ricevuta…</p>';
    modale.hidden = false;

    api.ricevutaBonifico(id).then(function (r) {
      var p = r.provider || {};
      if (testa) {
        testa.innerHTML =
          "<b>" + ui.esc(p.name || "Traccia") + "</b>" +
          '<div class="xs muted">' + ui.esc(p.address || "") + "</div>" +
          '<div class="xs muted">P.IVA ' + ui.esc(p.vat || "—") +
            " · Email " + ui.esc(p.email || "assistenza@traccia.it.com") + "</div>";
      }
      var st = statoBonifico(r);
      if (corpo) {
        corpo.innerHTML =
          '<div class="receipt__top">' +
            '<div><span class="xs muted">Ricevuta di disposizione</span>' +
              '<div class="receipt__num mono">' + ui.esc(r.numero) + "</div></div>" +
            '<span class="pill ' + st.pill + '">' + ui.esc(st.testo) + "</span>" +
          "</div>" +
          '<div class="receipt__amount">' + euro(r.importo_eur) + "</div>" +
          '<table class="data-table receipt__table"><tbody>' +
            /* numero, stato, schema e importo sono già in testa alla ricevuta:
               ripeterli in tabella fa sembrare il documento compilato due volte */
            testoRicevuta(r).slice(4).map(function (c) {
              return "<tr><th>" + ui.esc(c[0]) + "</th><td>" + ui.esc(c[1]) + "</td></tr>";
            }).join("") +
            "<tr><th>Cliente</th><td>" + ui.esc((r.cliente || {}).name) +
              '<div class="xs muted">' + ui.esc((r.cliente || {}).case || "") + "</div></td></tr>" +
          "</tbody></table>";
      }
      if (piede) {
        piede.innerHTML = ui.esc(r.nota) + '<div class="xs muted mt-1">Emessa il ' +
          dataLunga(String(r.emesso_il || "").slice(0, 10)) + " · " +
          ui.esc((r.cliente || {}).name) + " · " + ui.esc((r.cliente || {}).email) + "</div>";
      }
    }).catch(function (err) {
      if (corpo) {
        corpo.innerHTML = '<p class="empty-state">' + ui.esc(err.message || "Ricevuta non disponibile.") + "</p>";
      }
    });
  }

  function chiudiRicevuta() {
    var modale = document.querySelector("[data-receipt-modal]");
    if (modale) modale.hidden = true;
  }

  /* ------------------------------------------------- estratto bonifici -- */
  /* CSV e non PDF: un estratto serve a chi lo rilegge in un foglio di calcolo,
     e un CSV si apre ovunque senza dipendere da un visualizzatore. Il PDF
     resta possibile per la via di stampa. */
  function csvBonifici(dati) {
    var q = function (v) {
      var t = v === null || v === undefined ? "" : String(v);
      return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    var righe = [[
      "Numero", "Disposto il", "Data richiesta", "Data valuta", "Beneficiario",
      "IBAN beneficiario", "Importo", "Divisa", "Causale", "Codice causale",
      "Schema", "Stato", "Codice banca", "Messaggio banca"
    ]];
    (dati.bonifici || []).forEach(function (b) {
      righe.push([
        b.reference,
        String(b.disposto_il || "").slice(0, 10),
        b.data_richiesta || "",
        b.data_valuta || "",
        b.beneficiario || "",
        b.iban || "",
        /* numero con la virgola: è un foglio italiano, e un importo letto
           come testo non si somma */
        Number(b.importo_eur || 0).toFixed(2).replace(".", ","),
        b.divisa || "EUR",
        b.causale || "",
        b.codice_causale || "",
        b.schema === "sepa_instant" ? "SEPA istantaneo" : "SEPA ordinario",
        (STATO_BONIFICO[b.stato] || {}).testo || b.stato || "",
        b.codice_banca || "",
        b.messaggio_banca || ""
      ]);
    });
    return righe.map(function (r) { return r.map(q).join(";"); }).join("\r\n");
  }

  function scaricaTesto(nome, testo) {
    var blob = new Blob(["\ufeff" + testo], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* su Safari la revoca immediata annulla il download: si aspetta un giro */
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function scaricaEstrattoBonifici() {
    var bottone = document.querySelector("[data-bonifici-csv]");
    if (bottone) bottone.disabled = true;
    api.estrattoBonifici().then(function (dati) {
      if (!dati.bonifici || !dati.bonifici.length) {
        if (window.ui && ui.toast) ui.toast("Nessun bonifico nel periodo: non c'è niente da scaricare.", "error");
        return;
      }
      scaricaTesto("bonifici-" + dati.da + "_" + dati.a + ".csv", csvBonifici(dati));
      if (window.ui && ui.toast) {
        ui.toast(dati.numero_bonifici + " bonifici esportati.", "ok");
      }
    }).catch(function (err) {
      if (window.ui && ui.toast) ui.toast(err.message || "Estratto non disponibile.", "error");
    }).then(function () {
      if (bottone) bottone.disabled = false;
    });
  }

  function annullaBonifico(id, bottone) {
    if (!window.confirm("Annullare il bonifico? I fondi tornano disponibili.")) return;
    bottone.disabled = true;
    api.annullaBonifico(id).then(function () {
      if (window.ui && ui.toast) ui.toast("Bonifico annullato: i fondi sono di nuovo disponibili.", "ok");
      return Promise.all([caricaBanca(), caricaConto()]);
    }).catch(function (err) {
      bottone.disabled = false;
      if (window.ui && ui.toast) ui.toast(err.message, "error");
    });
  }

  /* ---------------------------------------------------- modale mandato -- */
  function apriMandato() {
    var modale = document.querySelector("[data-mandato-modal]");
    if (!modale) return;
    modale.querySelector("[data-mandato-form]").reset();
    var errore = modale.querySelector("[data-mandato-error]");
    if (errore) errore.hidden = true;
    modale.hidden = false;
    setTimeout(function () {
      var primo = modale.querySelector("#man-creditore");
      if (primo) primo.focus();
    }, 30);
  }

  function chiudiMandato() {
    var modale = document.querySelector("[data-mandato-modal]");
    if (modale) modale.hidden = true;
  }

  function inviaMandato(event) {
    event.preventDefault();
    var modale = document.querySelector("[data-mandato-modal]");
    var errore = modale.querySelector("[data-mandato-error]");
    var submit = modale.querySelector("[data-mandato-submit]");
    var creditore = modale.querySelector("#man-creditore").value.trim();
    if (creditore.length < 3) {
      errore.hidden = false;
      errore.textContent = "Indica il nome del creditore.";
      return;
    }
    errore.hidden = true;
    submit.disabled = true;
    submit.textContent = "Firma…";
    api.mandato({
      creditore: creditore,
      creditoreId: modale.querySelector("#man-id").value.trim(),
      scheme: modale.querySelector("#man-scheme").value
    }).then(function (res) {
      chiudiMandato();
      if (window.ui && ui.toast) ui.toast("Mandato " + (res.reference || "") + " firmato.", "ok");
      return Promise.all([caricaBanca(), caricaConto()]);
    }).catch(function (err) {
      errore.hidden = false;
      errore.textContent = err.message || "Mandato non firmato.";
    }).then(function () {
      submit.disabled = false;
      submit.textContent = "Firma il mandato";
    });
  }

  function revocaMandato(id, bottone) {
    if (!window.confirm("Revocare il mandato? Gli addebiti non ancora incassati vengono annullati.")) return;
    bottone.disabled = true;
    api.revocaMandato(id).then(function () {
      if (window.ui && ui.toast) ui.toast("Mandato revocato.", "ok");
      return Promise.all([caricaBanca(), caricaConto()]);
    }).catch(function (err) {
      bottone.disabled = false;
      if (window.ui && ui.toast) ui.toast(err.message, "error");
    });
  }

  /* ------------------------------------------------- contestazione SDD -- */
  var contestaState = { id: null, stato: null };

  function apriContesta(id, stato) {
    var modale = document.querySelector("[data-contesta-modal]");
    if (!modale) return;
    contestaState = { id: id, stato: stato };
    var intro = modale.querySelector("[data-contesta-intro]");
    if (intro) {
      intro.textContent = stato === "collected"
        ? "L'addebito è già stato incassato. Se il mandato è CORE, la contestazione produce lo storno dell'importo sul conto; per i mandati B2B il rimborso va concordato con il creditore."
        : "L'addebito non è ancora stato incassato: la contestazione lo ferma prima che il denaro esca.";
    }
    modale.querySelector("[data-contesta-form]").reset();
    var errore = modale.querySelector("[data-contesta-error]");
    if (errore) errore.hidden = true;
    modale.hidden = false;
    setTimeout(function () {
      var campo = modale.querySelector("#con-motivo");
      if (campo) campo.focus();
    }, 30);
  }

  function chiudiContesta() {
    var modale = document.querySelector("[data-contesta-modal]");
    if (modale) modale.hidden = true;
  }

  function inviaContesta(event) {
    event.preventDefault();
    var modale = document.querySelector("[data-contesta-modal]");
    var errore = modale.querySelector("[data-contesta-error]");
    var submit = modale.querySelector("[data-contesta-submit]");
    var motivo = modale.querySelector("#con-motivo").value.trim();
    if (motivo.length < 5) {
      errore.hidden = false;
      errore.textContent = "Spiega il motivo: senza, la contestazione non può essere esaminata.";
      return;
    }
    errore.hidden = true;
    submit.disabled = true;
    submit.textContent = "Invio…";
    api.contestaAddebito(contestaState.id, motivo).then(function (res) {
      chiudiContesta();
      if (window.ui && ui.toast) {
        ui.toast(res.status === "refunded"
          ? "Addebito stornato: l'importo è tornato sul conto."
          : "Addebito fermato prima dell'incasso.", "ok");
      }
      return Promise.all([caricaBanca(), caricaConto()]);
    }).catch(function (err) {
      errore.hidden = false;
      errore.textContent = err.message || "Contestazione non inviata.";
    }).then(function () {
      submit.disabled = false;
      submit.textContent = "Invia contestazione";
    });
  }

  /* ------------------------------------------------------------ carta -- */
  function richiediCarta() {
    var tetto = window.prompt("Limite mensile di spesa della carta, in euro (50 – 10.000):", "500");
    if (tetto === null) return;
    var valore = Number(String(tetto).replace(",", "."));
    if (!valore || valore < 50 || valore > 10000) {
      if (window.ui && ui.toast) ui.toast("Il limite va da € 50,00 a € 10.000,00.", "error");
      return;
    }
    api.richiediCarta(valore).then(function (res) {
      if (window.ui && ui.toast) {
        ui.toast("Carta " + (res.reference || "") + " richiesta. Sarà attiva dopo la verifica dell'analista.", "ok");
      }
      return caricaBanca();
    }).catch(function (err) {
      if (window.ui && ui.toast) ui.toast(err.message, "error");
    });
  }

  /* Il blocco è l'unica azione che non chiede conferma due volte: una carta
     persa è una corsa contro il tempo, e chiedere "sei sicuro?" è il modo di
     perderla. La riattivazione invece chiede, perché è irreversibile al
     contrario. */
  function bloccaCarta(id, riattiva) {
    var motivo = null;
    if (!riattiva) {
      motivo = window.prompt("Motivo del blocco (facoltativo: smarrimento, furto, sospetto):", "");
      if (motivo === null) return;
    } else if (!window.confirm("Riattivare la carta? Tornerà utilizzabile subito.")) {
      return;
    }
    api.bloccaCarta(id, motivo, riattiva).then(function () {
      if (window.ui && ui.toast) {
        ui.toast(riattiva ? "Carta riattivata." : "Carta bloccata. Nessun pagamento passerà.", "ok");
      }
      return caricaBanca();
    }).catch(function (err) {
      if (window.ui && ui.toast) ui.toast(err.message, "error");
    });
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

    bindBanca();
  }

  /* Una sola delega sul contenitore: le righe dei bonifici e dei mandati
     vengono ridisegnate a ogni ricarica, e un listener attaccato a ogni riga
     sarebbe un listener da riattaccare ogni volta (e da dimenticare). */
  function bindBanca() {
    var nodo = document.querySelector("[data-rails]");
    if (nodo) {
      nodo.addEventListener("click", function (e) {
        var b;
        if ((b = e.target.closest("[data-bonifico-annulla]"))) {
          return annullaBonifico(b.getAttribute("data-bonifico-annulla"), b);
        }
        if ((b = e.target.closest("[data-bonifico-ricevuta]"))) {
          return apriRicevuta(b.getAttribute("data-bonifico-ricevuta"));
        }
        if ((b = e.target.closest("[data-mandato-revoca]"))) {
          return revocaMandato(b.getAttribute("data-mandato-revoca"), b);
        }
        if ((b = e.target.closest("[data-addebito-contesta]"))) {
          return apriContesta(b.getAttribute("data-addebito-contesta"), b.getAttribute("data-addebito-stato"));
        }
      });
    }

    arrayEach("[data-bonifico-apri]", function (b) { b.addEventListener("click", apriBonifico); });
    arrayEach("[data-mandato-apri]", function (b) { b.addEventListener("click", apriMandato); });
    arrayEach("[data-carta-richiedi]", function (b) { b.addEventListener("click", richiediCarta); });

    var blocco = document.querySelector("[data-carta-blocca]");
    if (blocco) {
      blocco.addEventListener("click", function () {
        var c = (bancaState.dati && bancaState.dati.carte && bancaState.dati.carte[0]) || null;
        if (c) bloccaCarta(c.id, false);
      });
    }
    var sblocco = document.querySelector("[data-carta-sblocca]");
    if (sblocco) {
      sblocco.addEventListener("click", function () {
        var c = (bancaState.dati && bancaState.dati.carte && bancaState.dati.carte[0]) || null;
        if (c) bloccaCarta(c.id, true);
      });
    }

    /* modale bonifico */
    var bon = document.querySelector("[data-bonifico-modal]");
    if (bon) {
      var formBon = bon.querySelector("[data-bonifico-form]");
      if (formBon) formBon.addEventListener("submit", inviaBonifico);
      var annullaBon = bon.querySelector("[data-bonifico-cancel]");
      if (annullaBon) annullaBon.addEventListener("click", chiudiBonifico);
      bon.addEventListener("click", function (e) { if (e.target === bon) chiudiBonifico(); });
      ["#bon-importo", "#bon-ben", "#bon-istantaneo"].forEach(function (sel) {
        var campo = bon.querySelector(sel);
        if (campo) campo.addEventListener("input", aggiornaRiepilogoBonifico);
        if (campo) campo.addEventListener("change", aggiornaRiepilogoBonifico);
      });

      /* secondo tempo: il codice */
      var formCodice = bon.querySelector("[data-conferma-form]");
      if (formCodice) formCodice.addEventListener("submit", confermaBonifico);
      var indietro = bon.querySelector("[data-conferma-indietro]");
      if (indietro) {
        indietro.addEventListener("click", function () { tornaAlModuloBonifico(true); });
      }
      var campoCodice = bon.querySelector("[data-conferma-codice]");
      if (campoCodice) {
        /* solo cifre, e non oltre sei: un codice incollato con spazi o
           trattini deve funzionare lo stesso */
        campoCodice.addEventListener("input", function () {
          var pulito = String(campoCodice.value || "").replace(/\D/g, "").slice(0, 6);
          if (pulito !== campoCodice.value) campoCodice.value = pulito;
        });
      }
    }

    /* modale ricevuta. Ogni pulsante si attacca solo se c'è: una bind che
       assume la presenza di tutti i nodi trasforma un elemento mancante in una
       schermata muta — è il modo in cui il pulsante del bonifico era già
       rimasto senza ascoltatore una volta. */
    var ric = document.querySelector("[data-receipt-modal]");
    if (ric) {
      var chiudiRic = ric.querySelector("[data-receipt-close]");
      if (chiudiRic) chiudiRic.addEventListener("click", chiudiRicevuta);
      var stampaRic = ric.querySelector("[data-receipt-print]");
      if (stampaRic) stampaRic.addEventListener("click", function () { window.print(); });
      ric.addEventListener("click", function (e) { if (e.target === ric) chiudiRicevuta(); });
    }

    var csv = document.querySelector("[data-bonifici-csv]");
    if (csv) csv.addEventListener("click", scaricaEstrattoBonifici);

    /* modale mandato */
    var man = document.querySelector("[data-mandato-modal]");
    if (man) {
      man.querySelector("[data-mandato-form]").addEventListener("submit", inviaMandato);
      man.querySelector("[data-mandato-cancel]").addEventListener("click", chiudiMandato);
      man.addEventListener("click", function (e) { if (e.target === man) chiudiMandato(); });
    }

    /* modale contestazione */
    var con = document.querySelector("[data-contesta-modal]");
    if (con) {
      con.querySelector("[data-contesta-form]").addEventListener("submit", inviaContesta);
      con.querySelector("[data-contesta-cancel]").addEventListener("click", chiudiContesta);
      con.addEventListener("click", function (e) { if (e.target === con) chiudiContesta(); });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      chiudiBonifico();
      chiudiMandato();
      chiudiContesta();
    });
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
    caricaBanca();
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
