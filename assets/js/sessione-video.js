/* traccia — il video della guida, in quattro lingue.
   ------------------------------------------------------------------------
   Il problema che risolve: un `<video>` con quattro sorgenti non esiste.
   Cambiare lingua significa cambiare file, e con `<source>` l'unico modo è
   ricaricare la pagina o togliere e rimettere i nodi a mano — con il risultato
   che il browser mostra i sottotitoli della lingua precedente.

   Qui si tiene una sola cosa vera: il `<video>` c'è, con tutti i `<track>`
   già dentro (uno per lingua), e si cambia `src` e `track.mode`. La lingua
   scelta si ricorda in `localStorage` perché chi guarda il video in tedesco
   probabilmente legge il sito in tedesco.

   Niente `fetch`, niente dipendenze: il file è servito dal sito come gli altri. */
(function (global) {
  "use strict";

  var CHIAVE = "traccia.video.lingua";
  var LINGUE = ["it", "en", "de", "es"];
  var video = null;
  var corrente = "it";

  function leggi() {
    try {
      var v = window.localStorage.getItem(CHIAVE);
      return LINGUE.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }

  function scrivi(l) {
    try { window.localStorage.setItem(CHIAVE, l); } catch (e) { /* niente */ }
  }

  var CARTELLA = null;

  function cartella() {
    /* La cartella degli asset (con l'impronta della versione) si legge da una
       `<source>` della pagina, non si scrive qui: un percorso copiato in
       questo file diventa vecchio in silenzio al primo giro di
       `versione_asset.py`, e il video smette di partire senza un errore. */
    if (CARTELLA) return CARTELLA;
    var fonte = document.querySelector("[data-video-tela] source");
    var m = fonte && /^(assets\/[0-9a-f]{8}\/video\/)/.exec(fonte.getAttribute("src") || "");
    CARTELLA = m ? m[1] : "assets/video/";
    return CARTELLA;
  }

  function sorgente(l) {
    /* Il verticale non è una scelta della pagina: è un file più alto che serve
       quando lo schermo è stretto. Qui si sceglie il formato in base alla
       finestra, non alla lingua. */
    var verticale = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    return cartella() + "come-segnalare-un-caso-" + l +
      (verticale ? "-verticale" : "-orizzontale") + ".mp4";
  }

  function mostra(l) {
    if (!video) return;
    corrente = l;
    var eraInRiproduzione = !video.paused && !video.ended;
    video.src = sorgente(l);
    video.load();
    /* i sottotitoli seguono la lingua, non il file: se restassero quelli
       italiani sotto una voce inglese, la pagina direbbe due cose diverse */
    var tracce = video.textTracks || [];
    for (var i = 0; i < tracce.length; i++) {
      var t = tracce[i];
      t.mode = (t.language === l) ? "showing" : "disabled";
    }
    if (eraInRiproduzione) {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* l'utente ripreme play */ });
    }
    var bottoni = document.querySelectorAll("[data-video-lingua]");
    for (var k = 0; k < bottoni.length; k++) {
      var attivo = bottoni[k].getAttribute("data-video-lingua") === l;
      bottoni[k].classList.toggle("is-active", attivo);
      bottoni[k].setAttribute("aria-pressed", attivo ? "true" : "false");
    }
    /* la lingua è una scelta visibile: senza questo, chi usa un lettore di
       schermo non sa che è cambiata */
    var tela = document.querySelector("[data-video-tela]");
    if (tela) tela.setAttribute("data-lingua", l);
  }

  function init() {
    video = document.getElementById("video-guida");
    var bottoni = document.querySelectorAll("[data-video-lingua]");
    if (!video || !bottoni.length) return;

    for (var i = 0; i < bottoni.length; i++) {
      bottoni[i].addEventListener("click", function (e) {
        var l = e.currentTarget.getAttribute("data-video-lingua");
        if (LINGUE.indexOf(l) < 0 || l === corrente) return;
        scrivi(l);
        mostra(l);
      });
    }

    var scelta = leggi();
    if (scelta && scelta !== corrente) mostra(scelta);
    else mostra(corrente);

    /* cambiando la larghezza cambia il formato: si ricarica sulla stessa
       lingua, senza toccare la posizione se il video non sta girando */
    var ultimoStretto = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
    window.addEventListener("resize", function () {
      var stretto = window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
      if (stretto === ultimoStretto) return;
      ultimoStretto = stretto;
      if (video.paused) mostra(corrente);
    });
  }

  /* la lingua del documento è la scelta migliore per partire: chi arriva da
     `/de/` sta leggendo in tedesco, e il video parte in tedesco */
  function linguaDocumento() {
    var l = (document.documentElement.getAttribute("lang") || "it").slice(0, 2);
    return LINGUE.indexOf(l) >= 0 ? l : "it";
  }

  global.VideoGuida = { init: init, mostra: mostra, linguaDocumento: linguaDocumento };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      corrente = linguaDocumento();
      init();
    });
  } else {
    corrente = linguaDocumento();
    init();
  }
})(window);
