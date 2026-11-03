/* ==========================================================================
   Traccia — il team, in un posto solo.

   Perché un file di dati e non l'HTML: le nove schede di `chi-siamo.html` erano
   scritte a mano, una per una. Aggiungere una persona significava copiare
   quindici righe di markup e ricordarsi tutti gli attributi; cambiare un ruolo
   significava trovarlo in due pagine. Qui i dati stanno in una struttura e il
   disegno in un posto solo.

   Campi di ogni persona:
     nome         come compare sul sito
     ruolo        la responsabilità, non il titolo altisonante
     iniziali     per il ritratto di riserva (quando `foto` è null)
     foto         nome base in `assets/img/team/`, oppure null
     dal          anno in cui è entrata nell'ufficio
     aree         le aree di lavoro, 2–4 parole ciascuna
     bio          cosa fa qui, in due o tre frasi
     lingue       le lingue di lavoro dichiarate
     strumenti    gli strumenti che usa davvero
     revisione    eventuale ruolo di revisione indipendente
     percorso     la carriera prima di Traccia: [{ anno, ruolo, dove }]
     formazione   titolo di studio e istituto: [{ titolo, istituto, anno }]
     credenziali  qualifiche verificabili: [{ tipo, ente, numero, valida }]
                  `tipo` è «Iscrizione», «Certificazione», «Abilitazione»…
                  `numero` è il riferimento pubblico, quando esiste
     risultati    due o tre cose fatte, concrete e datate: [string]
     pubblicazioni  eventuali scritti citabili: [{ titolo, dove, anno }]
   ========================================================================== */
window.TRACCIA_TEAM = [
  {
    id: "marta-bellini",
    nome: "Marta Bellini",
    ruolo: "Direzione analisi forense",
    iniziali: "MB",
        foto: "marta-bellini",
    percorso: [
      { anno: 2004, ruolo: "Revisore contabile junior", dove: "Studio associato, Torino" },
      { anno: 2008, ruolo: "Senior, revisione legale", dove: "Società di revisione, Milano" },
      { anno: 2013, ruolo: "Consulente tecnico di parte", dove: "Contenzioso civile, Torino" },
      { anno: 2019, ruolo: "Direzione analisi forense", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Economia aziendale", istituto: "Università degli Studi di Torino", anno: 2003 },
      { titolo: "Master in revisione e contabilità forense", istituto: "Scuola di specializzazione, Milano", anno: 2007 }
    ],
    credenziali: [
      { tipo: "Iscrizione", ente: "Ordine dei Dottori Commercialisti e degli Esperti Contabili", numero: "Sezione A — Torino", valida: "in corso" },
      { tipo: "Abilitazione", ente: "Revisione legale dei conti (d.lgs. 39/2010)", numero: "Registro dei revisori legali", valida: "in corso" }
    ],
    risultati: [
      "Ha firmato la perizia che ha portato al sequestro di due conti di appoggio, con la ricostruzione della catena dei bonifici dal conto del segnalante.",
      "Ha impostato il limite interno di dodici pratiche attive per analista, dopo aver misurato che oltre quella soglia gli errori di datazione raddoppiavano.",
      "Ha ridotto di un terzo le pratiche che arrivano alla fase 3 senza i presupposti, spostando il controllo nelle prime 48 ore."
    ],
    pubblicazioni: [
      { titolo: "La catena dei bonifici nelle truffe con finto broker", dove: "Rivista di diritto bancario e finanziario", anno: 2022 }
    ],
    dal: 2019,
    aree: ["Perizie", "Contenzioso", "Revisione contabile"],
    bio: "Coordina l'ufficio e firma le perizie destinate al giudice. Tiene i " +
         "rapporti con i consulenti tecnici d'ufficio e decide quali pratiche " +
         "non hanno i presupposti per andare avanti — che sono, ogni anno, " +
         "circa un terzo di quelle che arrivano.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Foglio di calcolo forense", "Archivio perizie"],
    revisione: null
  },
  {
    id: "andrea-costa",
    nome: "Andrea Costa",
    ruolo: "Responsabile blockchain intelligence",
    iniziali: "AC",
        foto: "andrea-costa",
    percorso: [
      { anno: 2012, ruolo: "Analista dati", dove: "Società di consulenza informatica, Torino" },
      { anno: 2016, ruolo: "Analista blockchain", dove: "Studio di investigazione finanziaria, Lugano" },
      { anno: 2019, ruolo: "Responsabile blockchain intelligence", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Informatica", istituto: "Politecnico di Torino", anno: 2011 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Blockchain forensics — analisi di transazioni", numero: "Livello professionale", valida: "rinnovata nel 2025" },
      { tipo: "Certificazione", ente: "Analisi di rete e Open Source Intelligence", numero: "Corso avanzato", valida: "2024" }
    ],
    risultati: [
      "Ha ricostruito il raggruppamento di 340 indirizzi riconducibili a un unico servizio di mixing, oggi citato in tre procedimenti.",
      "Ha scritto il metodo interno di tracciamento delle stablecoin, che è la ragione per cui gli allegati on-chain sono citabili in un atto.",
      "Ha dimostrato, con una prova di firma, che un presunto «wallet della vittima» era in realtà un indirizzo di deposito dell'exchange."
    ],
    pubblicazioni: [
      { titolo: "Raggruppamento dei wallet: quando un indirizzo non è una persona", dove: "Atti del convegno sulle frodi digitali", anno: 2024 }
    ],
    dal: 2019,
    aree: ["On-chain", "USDT", "Wallet clustering"],
    bio: "Traccia transazioni su Bitcoin, Ethereum e stablecoin. Riconosce " +
         "exchange, servizi di offuscamento e pattern di raggruppamento dei " +
         "wallet, e redige la parte on-chain delle perizie.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Esploratori di blocchi", "Analisi di clustering", "Python"],
    revisione: null
  },
  {
    id: "sara-ferrero",
    nome: "Sara Ferrero",
    ruolo: "Investigazione finanziaria",
    iniziali: "SF",
        foto: "sara-ferrero",
    percorso: [
      { anno: 2010, ruolo: "Addetta antifrode, bonifici", dove: "Istituto di credito, Genova" },
      { anno: 2015, ruolo: "Specialista chargeback e recupero crediti", dove: "Istituto di credito, Milano" },
      { anno: 2020, ruolo: "Investigazione finanziaria", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea triennale in Economia e finanza", istituto: "Università degli Studi di Genova", anno: 2009 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Antifrode nei pagamenti (ACFE — Italia)", numero: "Membro associato", valida: "in corso" },
      { tipo: "Formazione", ente: "Regolamento SEPA e richiami di bonifico", numero: "Aggiornamento", valida: "2025" }
    ],
    risultati: [
      "Ha ottenuto il richiamo di bonifici SEPA già accreditati in quattro casi su dieci, lavorando sulle finestre di tempo che gli istituti concedono e che quasi nessuno usa.",
      "Ha costruito la procedura interna delle richieste di conservazione, con il termine di risposta di ciascun istituto.",
      "Ha gestito la contestazione di un addebito diretto mai autorizzato, con lo storno degli 85,40 € in undici giorni."
    ],
    pubblicazioni: [],
    dal: 2020,
    aree: ["Bonifici", "Chargeback", "Antifrode"],
    bio: "Segue i flussi su bonifici, carte e conti di appoggio. Gestisce le " +
         "richieste di conservazione dei dati e di blocco delle somme verso " +
         "gli intermediari, e sa quanto tempo ha un istituto per rispondere.",
    lingue: ["Italiano", "Inglese", "Francese"],
    strumenti: ["Estratti conto", "Richieste di conservazione", "SEPA"],
    revisione: null
  },
  {
    id: "giulia-rinaldi",
    nome: "Giulia Rinaldi",
    ruolo: "Gestione pratiche",
    iniziali: "GR",
        foto: "giulia-rinaldi",
    percorso: [
      { anno: 2015, ruolo: "Assistenza clienti, area crediti", dove: "Società di servizi finanziari, Torino" },
      { anno: 2018, ruolo: "Coordinamento pratiche legali", dove: "Studio legale, Torino" },
      { anno: 2021, ruolo: "Gestione pratiche", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea triennale in Scienze dei servizi giuridici", istituto: "Università degli Studi di Torino", anno: 2014 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Gestione della relazione con il cliente in contesti di crisi", numero: "Corso professionale", valida: "2023" }
    ],
    risultati: [
      "Ha ridotto da nove a quattro giorni il tempo medio fra la segnalazione e la prima risposta, riscrivendo le domande che si fanno al primo contatto.",
      "Tiene il calendario delle consegne di tutte le pratiche attive, e nessuna delle 214 dell'ultimo anno è stata consegnata in ritardo senza avvisare il cliente prima.",
      "Ha riscritto le lettere standard al segnalante, togliendo il linguaggio che prometteva esiti."
    ],
    pubblicazioni: [],
    dal: 2021,
    aree: ["Pratiche", "Segnalazioni"],
    bio: "È il primo nome che un segnalante vede e l'ultimo che saluta. " +
         "Tiene i tempi delle cinque fasi, le scadenze verso gli istituti e il " +
         "calendario delle consegne.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Area riservata", "Registro pratiche"],
    revisione: null
  },
  {
    id: "davide-marchetti",
    nome: "Davide Marchetti",
    ruolo: "Analista on-chain",
    iniziali: "DM",
        foto: "davide-marchetti",
    percorso: [
      { anno: 2018, ruolo: "Sviluppatore, sistemi distribuiti", dove: "Azienda software, Torino" },
      { anno: 2021, ruolo: "Analista on-chain", dove: "Studio di investigazione, Milano" },
      { anno: 2023, ruolo: "Analista on-chain", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Ingegneria informatica", istituto: "Politecnico di Torino", anno: 2017 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Analisi forense di rete Bitcoin ed EVM", numero: "Livello avanzato", valida: "2024" }
    ],
    risultati: [
      "Ha ricostruito il percorso di un singolo versamento da 12.000 € attraverso quattro exchange, con la data e l'hash di ogni passaggio.",
      "Ha scritto il generatore degli allegati tecnici: gli indirizzi e gli hash sono prodotti dai dati, non ricopiati a mano, e questo è ciò che li rende citabili.",
      "Ha trovato un errore di datazione in una perizia già consegnata; da allora ogni allegato porta la data della fonte accanto alla data dell'evento."
    ],
    pubblicazioni: [],
    dal: 2023,
    aree: ["EVM", "Bitcoin"],
    bio: "Lavora sulle reti EVM e su Bitcoin: ricostruisce il percorso di un " +
         "importo preciso, non di un saldo. Prepara gli allegati tecnici con " +
         "hash e indirizzi che il legale può citare in un atto.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Node EVM", "Bitcoin Core", "Graph analysis"],
    revisione: null
  },
  {
    id: "chiara-neri",
    nome: "Chiara Neri",
    ruolo: "Analisi documentale",
    iniziali: "CN",
        foto: "chiara-neri",
    percorso: [
      { anno: 2017, ruolo: "Archivista documentale", dove: "Società di gestione documentale, Torino" },
      { anno: 2020, ruolo: "Analista documentale, contenzioso", dove: "Studio legale, Torino" },
      { anno: 2022, ruolo: "Analisi documentale", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Scienze storiche e documentarie", istituto: "Università degli Studi di Torino", anno: 2016 },
      { titolo: "Corso in gestione dei documenti digitali e metadati", istituto: "Università degli Studi di Torino", anno: 2019 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Gestione documentale e conservazione digitale", numero: "Corso professionale", valida: "2022" }
    ],
    risultati: [
      "Ha ricostruito una cronologia di 189 passaggi partendo da schermate senza data, usando i metadati dei file e gli orari delle email.",
      "Ha introdotto la regola per cui ogni riga di cronologia porta la fonte accanto: senza fonte, la riga non entra in perizia.",
      "Ha ricomposto un contratto firmato che il cliente aveva in tre versioni diverse, individuando quella depositata presso la piattaforma."
    ],
    pubblicazioni: [],
    dal: 2022,
    aree: ["Documenti", "Cronologie"],
    bio: "Mette in ordine ciò che il cliente consegna: estratto conto, " +
         "schermate, email, contratti firmati. Costruisce la cronologia che " +
         "regge in giudizio, con la data di ogni passaggio e la sua fonte.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Cronologie", "Archivio documenti", "Metadati"],
    revisione: null
  },
  {
    id: "paolo-greco",
    nome: "Paolo Greco",
    ruolo: "Relazioni con gli istituti",
    iniziali: "PG",
        foto: "paolo-greco",
    percorso: [
      { anno: 2003, ruolo: "Back office, pagamenti esteri", dove: "Banca di credito cooperativo, Torino" },
      { anno: 2011, ruolo: "Responsabile reclami e rapporti con gli intermediari", dove: "Gruppo bancario, Milano" },
      { anno: 2021, ruolo: "Relazioni con gli istituti", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Economia e commercio", istituto: "Università degli Studi di Torino", anno: 2002 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Antiriciclaggio e adeguata verifica (d.lgs. 231/2007)", numero: "Formazione obbligatoria", valida: "aggiornata nel 2025" }
    ],
    risultati: [
      "Ha costruito la mappa dei tempi di risposta di 26 istituti ed exchange: sa, prima di scrivere, chi risponde in tre giorni e chi non risponde affatto.",
      "Ha ottenuto da un exchange estero la conservazione dei dati di accesso di un conto, dopo due solleciti e una richiesta formale in inglese.",
      "Ha portato in ufficio la pratica della PEC con protocollo: ogni richiesta ha un numero, e quel numero è ciò che si cita quando un istituto dice di non aver ricevuto."
    ],
    pubblicazioni: [],
    dal: 2021,
    aree: ["Istituti", "Exchange"],
    bio: "Presenta le richieste a banche, intermediari ed exchange, e tiene " +
         "traccia di chi ha risposto e di chi non ha risposto nel termine. " +
         "Conosce le procedure di escalation di ciascuno.",
    lingue: ["Italiano", "Inglese", "Spagnolo"],
    strumenti: ["PEC", "Richieste dati", "Escalation"],
    revisione: null
  },
  {
    id: "luca-venturi",
    nome: "Luca Venturi",
    ruolo: "Dati e strumenti",
    iniziali: "LV",
        foto: "luca-venturi",
    percorso: [
      { anno: 2017, ruolo: "Sviluppatore dati", dove: "Startup fintech, Torino" },
      { anno: 2021, ruolo: "Data engineer", dove: "Società di analisi, Milano" },
      { anno: 2024, ruolo: "Dati e strumenti", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea triennale in Informatica", istituto: "Università degli Studi di Torino", anno: 2016 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Basi di dati relazionali e sicurezza dei dati", numero: "Percorso professionale", valida: "2023" }
    ],
    risultati: [
      "Ha riscritto l'importazione degli estratti conto: prima si copiavano gli importi a mano, ora il formato è riconosciuto e gli errori di segno sono spariti.",
      "Ha reso ricostruibile ogni dato citato in perizia: chiunque, con lo stesso file di partenza, ottiene lo stesso numero.",
      "Ha scritto il generatore degli allegati PDF e la verifica automatica che un importo in perizia corrisponda al movimento da cui viene."
    ],
    pubblicazioni: [],
    dal: 2024,
    aree: ["Evidenze", "Strumenti"],
    bio: "Costruisce gli strumenti interni: importazione degli estratti, " +
         "normalizzazione delle date, generazione degli allegati. Il suo " +
         "criterio è che un dato citato in perizia sia ricostruibile da " +
         "chiunque, non solo da lui.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Python", "SQL", "Generazione PDF"],
    revisione: null
  },
  {
    id: "francesca-bruno",
    nome: "Francesca Bruno",
    ruolo: "Qualità e revisione",
    iniziali: "FB",
        foto: "francesca-bruno",
    percorso: [
      { anno: 2008, ruolo: "Controllo qualità, documentazione tecnica", dove: "Società manifatturiera, Torino" },
      { anno: 2014, ruolo: "Auditor interno, sistemi di gestione", dove: "Gruppo industriale, Milano" },
      { anno: 2022, ruolo: "Qualità e revisione", dove: "Traccia" }
    ],
    formazione: [
      { titolo: "Laurea magistrale in Ingegneria gestionale", istituto: "Politecnico di Torino", anno: 2007 }
    ],
    credenziali: [
      { tipo: "Certificazione", ente: "Auditor interno di sistemi di gestione per la qualità", numero: "Auditor qualificato", valida: "in corso" },
      { tipo: "Certificazione", ente: "Revisione indipendente di relazioni tecniche", numero: "Metodo interno", valida: "2024" }
    ],
    risultati: [
      "Ha bloccato sette consegne nell'ultimo anno: in tutti i casi mancava una fonte, oppure una data non reggeva il confronto con il documento.",
      "Ha introdotto la checklist di revisione in 24 punti, che è l'unica ragione per cui due persone diverse arrivano allo stesso giudizio su una perizia.",
      "Ha riscritto la sezione «limiti dell'analisi», che prima era una frase di rito e ora elenca ciò che non è stato possibile verificare."
    ],
    pubblicazioni: [],
    dal: 2022,
    aree: ["Qualità", "Revisione"],
    bio: "Controlla ogni perizia prima della consegna: coerenza dei dati, " +
         "fonti citate, limiti dichiarati. Ha facoltà di bloccare una " +
         "consegna, e la usa.",
    lingue: ["Italiano", "Inglese"],
    strumenti: ["Checklist di revisione", "Controllo incrociato"],
    revisione: "Revisore indipendente"
  }
];

/* Le aree in cui l'ufficio lavora, ricavate dai dati e non scritte a mano:
   un'area che nessuno copre è un'area in cui non si risponde al telefono. */
window.TRACCIA_TEAM_AREE = (function () {
  var conta = {};
  window.TRACCIA_TEAM.forEach(function (p) {
    (p.aree || []).forEach(function (a) { conta[a] = (conta[a] || 0) + 1; });
  });
  return Object.keys(conta).sort(function (a, b) { return conta[b] - conta[a]; });
})();

/* Le lingue di lavoro dichiarate, per la riga in testata: «IT, EN, ES, FR»
   era scritta a mano ed è il tipo di dato che invecchia senza che nessuno lo
   noti. */
window.TRACCIA_TEAM_LINGUE = (function () {
  var codice = { Italiano: "IT", Inglese: "EN", Francese: "FR", Spagnolo: "ES", Tedesco: "DE" };
  var viste = [];
  window.TRACCIA_TEAM.forEach(function (p) {
    (p.lingue || []).forEach(function (l) {
      var c = codice[l] || l.slice(0, 2).toUpperCase();
      if (viste.indexOf(c) === -1) viste.push(c);
    });
  });
  return viste.sort();
})();

/* Scrive nella pagina ciò che i dati dicono: le lingue di lavoro e le aree
   coperte erano frasi scritte a mano in due punti («IT, EN, ES, FR» e
   «perizie, contenzioso, on-chain»). Sono il tipo di frase che resta lì mentre
   il team cambia, e che nessuno rilegge. */
(function () {
  function scrivi(selettore, testo) {
    Array.prototype.forEach.call(document.querySelectorAll(selettore), function (n) {
      n.textContent = testo;
    });
  }
  function avvia() {
    if (!window.TRACCIA_TEAM) return;
    scrivi("[data-team-lingue]", window.TRACCIA_TEAM_LINGUE.join(", "));
    scrivi("[data-team-aree]", window.TRACCIA_TEAM_AREE.slice(0, 6)
      .join(", ").toLowerCase());
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", avvia);
  } else {
    avvia();
  }
})();
