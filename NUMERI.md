# I numeri del sito: quali sono veri e quali no

Ultimo aggiornamento: 2026-10-31.

Questo file esiste perché il sito dichiara cifre, e una cifra dichiarata è una
promessa fatta a chi legge. Serve a rispondere a una domanda sola, in dieci
secondi: **se un cliente contesta un numero, abbiamo il riscontro?**

Se la risposta è no, il numero è un segnaposto e deve essere trattato come tale
— non perché sia illecito un segnaposto, ma perché un numero senza fonte, su un
sito che vende analisi, è la prima cosa che un avvocato della controparte
guarda.

> `tests/risultati.test.js` legge questa tabella. Un numero in pagina che non
> compare qui fa fallire la suite: è il modo per impedire che una cifra
> «provvisoria» resti in pagina per anni perché nessuno ricorda più da dove
> veniva.

## Stato dei numeri

| Cifra | Dove | Stato | Fonte |
|---|---|---|---|
| **24,0 Mln €** | `index.html`, `casi.html` | VERO | Fornito dal titolare il 2026-10-31, con i riscontri: somme arrivate ai clienti nel corso del 2026, dato parziale dell'anno. Arrotondato a 24,0. |
| 41,5 Mln € (€41.5 mn, 41,5 Mio. €, 41,5 M €) | `casi.html` e le tre traduzioni | SEGNAPOSTO | Scelto il 2026-10-31 su richiesta esplicita («fai delle cifre anche numeri qualsiasi»). Somme tracciate, non rientrate: nessun riscontro allegato. |
| 840 casi | `index.html` | SEGNAPOSTO | Idem. Segnalazioni analizzate dall'ufficio, cumulato. |
| 380 perizie | `index.html`, `casi.html`, `chi-siamo.html` | SEGNAPOSTO | Idem. Perizie tecniche consegnate e firmate. |
| 27 % | `index.html` | SEGNAPOSTO | Ereditato: era già in pagina prima del 2026-10-31. Casi in cui restava un punto di aggancio. |
| 31 % | `casi.html` | SEGNAPOSTO | Ereditato, come sopra. Pratiche chiuse senza costi in fase 2. |
| 9, 14, 4 | `chi-siamo.html` | VERO | Persone del team, giurisdizioni, lingue di lavoro: verificabili in pagina. |
| 38.400 €, 12.400 €, 6.900 €, 22.000 € | `casi.html` | SEGNAPOSTO | I quattro casi pubblicati: sono dimostrativi e lo erano già prima. |

## Come si aggiorna

Una cifra vive in più punti, e i punti sono tutti obbligatori:

1. **le pagine** — `index.html`, `casi.html`, `chi-siamo.html`: sono la fonte da
   cui il catalogo si allinea, quindi si cambiano per prime;
2. **il catalogo** — `python3 tools/allinea_catalogo.py --aggiungi` prende la
   frase nuova, poi le traduzioni si scrivono a mano in `tools/i18n/en|de|es.json`;
3. **le pagine tradotte** — `python3 tools/build_i18n.py`;
4. **questa tabella**, riga per riga;
5. **la suite** — `tests/risultati.test.js` controlla che i sei punti dicano la
   stessa cosa in quattro lingue.

Il giro completo è:

```bash
python3 tools/versione_asset.py
python3 tools/allinea_catalogo.py --aggiungi   # se ci sono frasi nuove
python3 tools/build_shell.py
python3 tools/build_i18n.py
python3 tools/misurazione.py
node tests/run.js
```

## Perché il numero dei rientrati è più piccolo di quello dei tracciati

Non è un errore e non va «sistemato». Le due cifre rispondono a due domande
diverse:

- **41,5 Mln € tracciati** — il denaro era ancora riconducibile a un soggetto
  identificabile su cui agire;
- **24,0 Mln € rientrati** — il denaro è arrivato ai clienti.

Ricostruire un percorso è più facile che ottenere un rimborso, quindi è normale
— ed è credibile — che la prima cifra sia più alta della seconda. Un sito in cui
il denaro *recuperato* supera quello *tracciato* sta dicendo una cosa
impossibile, e chi lo legge con un po' di esperienza lo capisce subito.

## Il limite che questo file non risolve

Un segnaposto dichiarato qui dentro resta un numero falso in pagina. La
differenza fra questo file e niente è che ora il falso ha un indirizzo: si sa
che c'è, si sa dove, e sostituirlo è un lavoro con una fine. Prima non lo sapeva
nessuno.
