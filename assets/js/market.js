/* traccia — live market prices.
   Aggiorna prezzi e variazioni ogni pochi secondi su tutte le pagine.
   Progressive enhancement: l'HTML contiene già i prezzi di riferimento, quindi
   la pagina funziona anche senza JavaScript o senza rete. */
(function () {
  "use strict";

  var INTERVAL = 10000;        // 10s: la cache del backend è di 20s, resta fluido
  var rows = document.querySelectorAll("[data-symbol]");
  var anyTarget = rows.length || document.querySelector("[data-live-price]") ||
                  document.querySelector(".ticker") || document.querySelector("[data-live-note]");
  if (!anyTarget) return;

  var lastPrices = {};

  function eur(value) {
    return new Intl.NumberFormat("it-IT", {
      style: "currency", currency: "EUR", minimumFractionDigits: 2
    }).format(Number(value) || 0);
  }
  function pct(value) {
    var up = value >= 0;
    return {
      text: (up ? "+" : "−") + Math.abs(value).toFixed(2).replace(".", ",") + " %",
      up: up
    };
  }
  function clock(seconds) {
    if (seconds === null || seconds === undefined) return "";
    var date = new Date(seconds * 1000);
    return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  /* lampeggio verde/rosso quando il prezzo cambia */
  function flash(node, up) {
    if (!node) return;
    node.classList.remove("is-tick-up", "is-tick-down");
    void node.offsetWidth;                       // reflow: riavvia l'animazione
    node.classList.add(up ? "is-tick-up" : "is-tick-down");
  }

  function apply(assets, market) {
    var bySymbol = {};
    assets.forEach(function (a) { bySymbol[a.symbol] = a; });

    rows.forEach(function (row) {
      var symbol = row.getAttribute("data-symbol");
      var asset = bySymbol[symbol];
      if (!asset) return;
      var priceEl = row.querySelector("[data-live-price]");
      var changeEl = row.querySelector("[data-live-change]");
      var previous = lastPrices[symbol];
      lastPrices[symbol] = asset.price_eur;

      if (priceEl) {
        priceEl.textContent = eur(asset.price_eur);
        if (previous !== undefined && previous !== asset.price_eur) {
          flash(priceEl, asset.price_eur > previous);
        }
      }
      if (changeEl) {
        var p = pct(asset.change_24h);
        changeEl.textContent = p.text;
        changeEl.classList.toggle("is-up", p.up);
        changeEl.classList.toggle("is-down", !p.up);
      }
    });

    /* ticker strip in cima alle pagine marketing */
    document.querySelectorAll(".ticker li").forEach(function (item, index) {
      var asset = assets[index];
      if (!asset) return;
      var price = item.querySelector(".num");
      var change = item.querySelector(".delta");
      if (price) price.textContent = eur(asset.price_eur);
      if (change) {
        var p = pct(asset.change_24h);
        change.textContent = p.text;
        change.classList.toggle("is-up", p.up);
        change.classList.toggle("is-down", !p.up);
      }
    });

    /* nota "aggiornato alle …" */
    document.querySelectorAll("[data-live-note]").forEach(function (note) {
      note.hidden = false;
      var stamp = market && market.fetched_at ? clock(market.fetched_at) : "";
      var sources = {
        reference: "listino di riferimento Traccia",
        coingecko: "CoinGecko",
        coinbase: "Coinbase",
        cache: "ultimo dato disponibile"
      };
      var label = sources[(market && market.source) || ""] || "listino interno";
      note.textContent = market && market.stale
        ? "Dati non aggiornati" + (stamp ? " · ultimo rilevamento " + stamp : "")
        : "Prezzi indicativi · " + label + (stamp ? " · aggiornato alle " + stamp : "");
      note.classList.toggle("is-stale", !!(market && market.stale));
    });

    document.querySelectorAll("[data-crypto-count]").forEach(function (count) {
      count.textContent = String(assets.length);
    });
  }

  var errored = false;

  function poll() {
    // tutti i prezzi arrivano dal database (funzione RPC `market`)
    if (!window.api || !api.crypto) return;
    var load = api.crypto();

    load.then(function (data) {
      if (data && data.assets) {
        document.body.classList.remove("is-offline");
        apply(data.assets, data.market);
        errored = false;
      }
    }).catch(function () {
      // anteprima statica senza rete: restano i prezzi presenti nell'HTML
      document.body.classList.add("is-offline");
      if (!errored) {
        document.querySelectorAll("[data-live-note]").forEach(function (note) {
          note.hidden = false;
          note.classList.add("is-stale");
          note.textContent = "Prezzi di riferimento: aggiornamento non disponibile";
        });
        errored = true;
      }
    });
  }

  function start() {
    poll();
    window.setInterval(poll, INTERVAL);
    // riallinea subito quando la scheda torna in primo piano
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  /* esposto per l'area clienti, che riusa la stessa formattazione */
  window.TracciaMarket = { apply: apply, poll: poll, eur: eur, pct: pct, interval: INTERVAL };
})();
