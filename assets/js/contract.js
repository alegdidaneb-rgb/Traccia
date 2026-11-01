/* traccia — contratto di incarico.
   Trasforma la fotografia salvata dal database (`traccia.contracts`) in un
   documento leggibile e stampabile. Il testo è fisso: qui non si calcola
   nulla di nuovo, si impagina soltanto ciò che è stato accettato. */
(function (global) {
  "use strict";

  var FASI = [
    ["Raccolta", "acquisizione di bonifici, estratti conto, conversazioni e ogni documento fornito dal Cliente."],
    ["Ricostruzione", "mappatura dei trasferimenti, anche in valuta virtuale, e individuazione dei conti di destinazione."],
    ["Perizia", "relazione tecnica sul percorso dei fondi e quantificazione del danno."],
    ["Denunce", "predisposizione degli esposti e supporto nelle segnalazioni a banche, exchanger e autorità."],
    ["Legale", "affiancamento nella fase contenziosa, tramite professionisti iscritti agli albi competenti."]
  ];

  var KYC = {
    0: "non verificata",
    1: "base — identità",
    2: "avanzata — residenza e fonte dei fondi",
    3: "completa — documentazione integrale"
  };

  var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function euro(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  /* timestamp unix (secondi) oppure stringa ISO → "31 ottobre 2026" */
  function data(value) {
    if (value === null || value === undefined || value === "") return "—";
    var d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.getDate() + " " + MESI[d.getMonth()] + " " + d.getFullYear();
  }

  /* Zero è ambiguo: nel database significa "nessun limite", ma ai livelli
     bassi lo stesso zero significa "non consentito". Chi chiama deve dire
     quale dei due, perché il contratto non può sbagliare.
       unlimited → il livello è verificato e non c'è tetto
       numero > 0 → tetto giornaliero
       numero = 0 e non illimitato → operazione non consentita a quel livello */
  function limite(value, unlimited) {
    if (unlimited) return "nessun limite giornaliero";
    var n = Number(value);
    if (value === null || value === undefined || value === "" || !isFinite(n)) {
      return "non previsto";
    }
    if (n <= 0) return "non consentito a questo livello";
    return euro(n) + " al giorno";
  }

  function render(c) {
    if (!c) return "";
    var p = c.provider || {};
    var k = c.client || {};
    var f = c.fees || {};
    var t = c.terms || {};
    var l = c.limits || {};

    var pct = (f.success_pct === null || f.success_pct === undefined)
      ? "—" : String(f.success_pct).replace(".", ",") + "%";

    var sede = p.address
      ? esc(p.address)
      : '<span class="ctr__todo">sede legale non indicata</span>';

    var accettato = c.status === "accepted"
      ? '<p class="ctr__ok">Contratto accettato dal Cliente il ' + esc(data(c.accepted_at)) + ".</p>"
      : "";

    var fasi = FASI.map(function (item) {
      return "<li><b>" + esc(item[0]) + "</b> — " + esc(item[1]) + "</li>";
    }).join("");

    var kyc = esc(KYC[Number(k.kyc_level)] || "non definita");

    /* A verifica completa non ci sono tetti interni su nessuna operazione:
       è una scelta di prodotto, ma va detta con precisione, perché "nessun
       limite" riguarda ciò che dipende dal Prestatore, non ciò che dipende
       dalla banca o dall'autorità. */
    var notaIllimitato = l.unlimited
      ? " A verifica completata il Prestatore non applica limiti giornalieri " +
        "interni ad alcuna operazione, ivi compresi i trasferimenti in valuta " +
        "virtuale. Restano fermi i controlli disposti dalla banca, dagli " +
        "intermediari coinvolti o dall'Autorità, che il Prestatore non può " +
        "disattendere né anticipare."
      : "";

    return '' +
'<article class="ctr" data-contract-doc>' +

'  <header class="ctr__head">' +
'    <div class="ctr__brand"><span class="ctr__mark">T</span> Traccia</div>' +
'    <div class="ctr__meta">' +
'      <span>Contratto</span><b class="ctr__num">' + esc(c.number || "—") + "</b>" +
'      <span>Data</span><b>' + esc(data(c.generated_at)) + "</b>" +
'      <span>Versione</span><b>' + esc(c.version || t.version || "1.0") + "</b>" +
"    </div>" +
"  </header>" +

'  <h1 class="ctr__title">Contratto di incarico per servizi di analisi<br>e recupero crediti</h1>' +
accettato +

'  <section class="ctr__parties">' +
"    <div>" +
'      <span class="ctr__label">Prestatore del servizio</span>' +
"      <b>" + esc(p.name || "—") + "</b><br>" +
"      P.IVA / Codice Fiscale " + esc(p.vat || "—") + "<br>" +
"      Sede legale: " + sede + "<br>" +
"      PEC " + esc(p.pec || "—") +
"    </div>" +
"    <div>" +
'      <span class="ctr__label">Cliente</span>' +
"      <b>" + esc(k.name || "—") + "</b><br>" +
"      " + esc(k.email || "—") + "<br>" +
"      Codice pratica: " + esc(k.case_ref || "da assegnare") + "<br>" +
'      IBAN dedicato: <span class="ctr__mono">' + esc(k.iban_formatted || k.iban || "—") + "</span>" +
"    </div>" +
"  </section>" +

'  <div class="ctr__body">' +

'    <section>' +
"      <h2>1. Oggetto dell'incarico</h2>" +
"      <p>Il Prestatore assume l'incarico di analizzare i fatti segnalati dal" +
"      Cliente in relazione a una presunta frode finanziaria, di ricostruire i" +
"      flussi di denaro, di raccogliere e ordinare la documentazione utile e di" +
"      assistere il Cliente nella predisposizione delle denunce all'Autorità" +
"      Giudiziaria e agli istituti di credito coinvolti.</p>" +
"      <p>L'incarico comprende le seguenti attività, svolte in cinque fasi:</p>" +
'      <ul class="ctr__phases">' + fasi + "</ul>" +
"    </section>" +

"    <section>" +
"      <h2>2. Corrispettivo</h2>" +
"      <p>Il Cliente corrisponde al Prestatore:</p>" +
'      <table class="ctr__table">' +
"        <tr><th>Voce</th><th>Importo</th><th>Quando è dovuto</th></tr>" +
"        <tr><td>Quota di apertura pratica</td><td>" + esc(euro(f.start_fee_eur)) +
"</td><td>Una sola volta, all'avvio dell'incarico</td></tr>" +
"        <tr><td>Quota di successo</td><td>" + esc(pct) +
"</td><td>Sulle somme effettivamente recuperate</td></tr>" +
"      </table>" +
"      <p>La quota di successo è calcolata esclusivamente sulle somme che il" +
"      Cliente incassa effettivamente. Se il recupero è nullo, la quota di" +
"      successo non è dovuta. La quota di apertura non è rimborsabile una volta" +
"      avviate le attività di analisi, salvo il diritto di recesso di cui al" +
"      punto 6.</p>" +
"    </section>" +

"    <section>" +
"      <h2>3. Modalità di pagamento</h2>" +
"      <p>I pagamenti sono effettuati esclusivamente a mezzo bonifico bancario" +
"      sull'IBAN dedicato indicato in intestazione, il cui beneficiario è il" +
"      Prestatore. Non sono richiesti né accettati pagamenti in contanti, su" +
"      carte prepagate, in valuta virtuale o verso conti intestati a terzi.</p>" +
"      <p>Per ogni bonifico il Cliente riceve dall'area riservata la conferma di" +
"      registrazione. Le somme versate dal Cliente restano distinte dal" +
"      corrispettivo e sono restituite secondo gli accordi della singola" +
"      pratica.</p>" +
"    </section>" +

"    <section>" +
"      <h2>4. Obblighi del Cliente</h2>" +
"      <p>Il Cliente si impegna a: fornire documentazione veritiera e completa;" +
"      non intrattenere contatti diretti con i soggetti segnalati senza" +
"      informarne il Prestatore; comunicare tempestivamente ogni evoluzione" +
"      della vicenda; corrispondere il compenso nei termini.</p>" +
"    </section>" +

"    <section>" +
"      <h2>5. Limiti del servizio</h2>" +
"      <p>Il Prestatore è tenuto a un'obbligazione di mezzi e non di risultato." +
"      Non garantisce il recupero delle somme, che dipende da fattori esterni" +
"      quali le decisioni dell'Autorità Giudiziaria, la solvibilità dei soggetti" +
"      coinvolti e i tempi dei procedimenti. Non fornisce consulenza legale o" +
"      fiscale: le attività riservate sono svolte da professionisti abilitati.</p>" +
"    </section>" +

"    <section>" +
"      <h2>6. Recesso e durata</h2>" +
"      <p>Il Cliente può recedere senza motivazione entro " +
"      <b>" + esc(t.recesso_giorni || 14) + " giorni</b> dalla conclusione del" +
"      presente contratto, con comunicazione scritta alla PEC del Prestatore." +
"      In tal caso resta dovuta la quota di apertura per le attività già svolte" +
"      e nessuna quota di successo. Il contratto si conclude con la chiusura" +
"      della pratica o con il recesso di una delle parti.</p>" +
"    </section>" +

"    <section>" +
"      <h2>7. Trattamento dei dati personali</h2>" +
"      <p>I dati sono trattati per l'esecuzione dell'incarico e per gli" +
"      adempimenti di legge, secondo l'informativa resa al Cliente ai sensi del" +
"      Regolamento (UE) 2016/679. La documentazione è conservata per il tempo" +
"      necessario alla pratica e comunque non oltre i termini di legge.</p>" +
"    </section>" +

"    <section>" +
"      <h2>8. Riservatezza</h2>" +
"      <p>Entrambe le parti mantengono riservate le informazioni apprese in" +
"      ragione dell'incarico. Il Prestatore può citare l'incarico in forma" +
"      anonima a fini statistici, salvo diverso divieto scritto del Cliente.</p>" +
"    </section>" +

"    <section>" +
"      <h2>9. Legge applicabile e foro</h2>" +
"      <p>Il contratto è regolato dalla legge italiana. Per le controversie è" +
"      competente il foro del luogo di residenza o domicilio elettivo del" +
"      Cliente, se consumatore ai sensi del Codice del consumo.</p>" +
"    </section>" +

"    <section>" +
"      <h2>10. Livello di verifica</h2>" +
"      <p>Al momento della generazione il livello di verifica del Cliente è" +
"      <b>" + kyc + "</b>" +
". I limiti operativi applicati sono i seguenti e possono essere elevati solo a" +
"      seguito di verifica. I trasferimenti in valuta virtuale richiedono il" +
"      livello avanzato e non sono consentiti ai livelli inferiori." +
    notaIllimitato + "</p>" +
'      <table class="ctr__table ctr__table--limits">' +
"        <tr><th>Versamenti</th><td>" + esc(limite(l.daily_deposit, l.unlimited)) + "</td></tr>" +
"        <tr><th>Prelievi</th><td>" + esc(limite(l.daily_withdrawal, l.unlimited)) + "</td></tr>" +
"        <tr><th>Acquisti</th><td>" + esc(limite(l.daily_buy, l.unlimited)) + "</td></tr>" +
"        <tr><th>Vendite</th><td>" + esc(limite(l.daily_sell, l.unlimited)) + "</td></tr>" +
"        <tr><th>Trasferimenti crypto</th><td>" + esc(limite(l.crypto_transfer_max, l.unlimited)) + "</td></tr>" +
"      </table>" +
"    </section>" +

"  </div>" +

'  <section class="ctr__sign">' +
"    <div>" +
'      <span class="ctr__line"></span>' +
"      <p><b>" + esc(p.name || "Prestatore") + "</b><br>per accettazione</p>" +
"    </div>" +
"    <div>" +
'      <span class="ctr__line"></span>' +
"      <p><b>" + esc(k.name || "Cliente") + "</b><br>per accettazione</p>" +
"    </div>" +
"  </section>" +

'  <footer class="ctr__foot">' +
"    Documento generato automaticamente il " + esc(data(c.generated_at)) +
"    · " + esc(c.number || "—") + " · versione " + esc(c.version || "1.0") +
"  </footer>" +

"</article>";
  }

  global.TracciaContract = {
    render: render,
    euro: euro,
    data: data,
    limite: limite,
    esc: esc
  };
})(typeof window !== "undefined" ? window : this);
