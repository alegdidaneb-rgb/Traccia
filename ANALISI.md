# Analisi del repository `Traccia`

**Data:** 31 ottobre 2026 · **Branch:** `arena/e73554a7-traccia` · **Commit analizzato:** `868ab15`

---

## 1. Che cos'è, in una riga

Il repository contiene **un solo file**: `traccia-sito.zip` (141 KB). Dentro c'è il
build di un sito vetrina + area riservata per **Traccia**, un servizio italiano di
*indagini forensi su truffe finanziarie e criptovalute* (ricostruzione dei flussi
di fondi, perizie tecniche, assistenza nella denuncia).

Sito **statico puro**: 15 pagine HTML, una stylesheet da 86 KB, 9 file JS.
Nessun build, nessun package manager, nessuna dipendenza, nessun test, nessuna CI.
Dichiarato per il deploy su Vercel così com'è.

---

## 2. Mappa del contenuto

| Area | Pagine |
|---|---|
| Marketing | `index`, `come-funziona`, `casi`, `crypto`, `chi-siamo`, `onorari`, `supporto` |
| Applicazione | `login`, `app` (area cliente), `admin` (console analisti) |
| Legale | `privacy`, `cookie`, `termini`, `note-legali` |
| Sistema | `404`, `robots.txt`, `sitemap.xml`, `vercel.json`, `README-DEPLOY.md` |

Ogni pagina è **autonoma**: header, footer nav, CSS e bundle JS vengono ripetuti
15 volte (*copia-incolla*). Nessun template, nessun include lato server.

---

## 3. Il punto più interessante: il "backend" è finito dentro `api.js`

Questo è il cuore dell'architettura, e va capito prima di tutto il resto.

Il sito non ha un backend. Ma `assets/js/api.js` (30 KB) implementa un
**finto backend completo, in esecuzione nel browser**:

1. `detectMode()` fa una sonda `GET /api/health`. Se la risposta non è
   `{"service":"traccia"}`, il client entra in **modalità demo**.
2. In modalità demo, `demoRequest()` risponde a **tutte** le rotte `/api/*`
   leggendo e scrivendo su `localStorage`.
3. Se invece un backend Python risponde, le stesse funzioni fanno `fetch` reale
   con `Authorization: Bearer`.

Cosa è reimplementato lato client:

- login / registrazione / sessione (`localStorage`, token `demo.<base64 email>`)
- utenti, ruoli, `is_master`, KYC 1–3, saldi
- limiti giornalieri per livello KYC (deposito/prelievo/acquisto/vendita)
- **generazione di IBAN italiani con CIN e checksum modulo 97** (corretta)
- prezzi crypto live da **CoinGecko** (con fallback su valori di riferimento)
- operazioni (deposito, acquisto, prelievo) con stati e note
- wallet crypto con challenge/firma
- intera console admin: approvazioni, KYC, ruoli, impostazioni, audit

### Il problema strutturale

Tutto il **controllo di autorizzazione** gira nel browser, sui dati in
`localStorage`. In modalità demo la password è in chiaro nel file e la sessione
è `demo.<base64 dell'email>`: chiunque apra la console del browser diventa master
con due righe di JS. **Questo è accettabile per una demo** (ed è onestamente
etichettato come tale), ma è un vicolo cieco architetturale: quelle rotte sono
state scritte per sembrare un'API, quindi un domani andranno *riscritte* sul
server, non spostate. Il rischio concreto è che qualcuno le prenda per
"quasi pronte".

**Il backend non esiste.** `README-DEPLOY.md` e i banner in `login`, `app`,
`admin` rimandano a `python3 backend/app.py`, ma la cartella `backend/` non è
nel pacchetto. Allo stato attuale il backend Python è **irrecuperabile da questo
repository**: non è versionato da nessuna parte.

---

## 4. Qualità tecnica: cosa è fatto bene

Va detto, perché è sopra la media di un sito statichetto:

- **Controllo di sintassi JS pulito**: tutti i 9 file passano `node --check`.
- **HTML ben formato**: parser Python, zero tag non chiusi, zero ID duplicati.
- **Nessun riferimento rotto**: ogni `href`/`src` locale esiste.
- **Nessun asset mancante**: zero `<img>` (tutto SVG inline, 53), icona da data-URI.
- **Zero dipendenze esterne** oltre a CoinGecko (voluto), zero tracker, zero cookie
  di terze parti, zero font remoti. Privacy-friendly by design.
- **Accessibilità discreta**: `lang="it"` ovunque, skip-link in tutte le 15 pagine,
  un solo `<h1` per pagina, gerarchia `h2` sensata, `aria-live` presente,
  `prefers-reduced-motion` rispettato sia in CSS che in JS.
- **Animazioni fatte con criterio**: la classe `html.js-anim` viene messa da uno
  script inline *prima* del paint; senza JS il contenuto resta visibile
  (`opacity: 1` di default). È il modo giusto di evitare il flash of unstyled content.
- **Navigazione mobile**: gestita con `aria-expanded`, chiusura su Escape e su click.
- **Peso onesto**: home ≈ **41 KB gzip** totali (HTML + CSS + 5 JS).

## 5. Qualità tecnica: cosa non va

| # | Problema | Gravità |
|---|---|---|
| 1 | `vercel.json` manda `Cache-Control: public, max-age=31536000, immutable` su `/assets/*`, ma i file **non hanno hash nel nome** e non c'è cache-busting: dopo un deploy i visitatori di ritorno tengono CSS/JS vecchi **per un anno**. È il bug più fastidioso e il più facile da correggere. | **Alta** |
| 2 | `admin.html`, `app.html`, `404.html` hanno `<meta name="robots" content="index, follow">` **e stanno nella `sitemap.xml`**. Console e area riservata indicizzabili. | **Alta** |
| 3 | `sitemap.xml` elenca URL `*.html` ma `vercel.json` ha `cleanUrls: true` (gli URL veri sono `/casi`, non `/casi.html`): la sitemap indica URL che vengono redirectati. | Media |
| 4 | Nessuna **Content-Security-Policy**. Su un sito che gestisce un login, con 7 script inline per pagina e un JSON-LD inline, è la difesa più economica che manca. | Media |
| 5 | **Nessun `og:image`** (e nessuna immagine raster in tutto il progetto): ogni condivisione su WhatsApp/LinkedIn/Facebook esce senza anteprima. Per un servizio che vive di passaparola è un danno concreto. | Media |
| 6 | Favicon: data-URI con la lettera **"A"**, non "T". Residuo del template di partenza. | Bassa |
| 7 | Il namespace globale si chiama `PatSession` / `PatAnim` / `PatMarket` — altro residuo del template ("Pat" presumibilmente dal progetto originale). | Bassa |
| 8 | `sitemap.xml` senza `<lastmod>`; 15 copie dell'header/footer/CSS/JS da mantenere a mano. | Bassa |
| 9 | `X-Frame-Options: SAMEORIGIN` è ok ma ridondante senza `frame-ancestors` in una CSP. | Bassa |

Sul **performance**: CSS da 86 KB (16,8 KB gzip) caricato render-blocking su ogni
pagina, non minificato (3.113 righe). Non è grave con HTTP/2 + gzip, ma la pagina
legale non ha bisogno dello stesso CSS dell'app. Nessun `preload` — inutile
però, dato che c'è un solo stylesheet.

---

## 6. Il rischio numero uno: i contenuti dichiarano fatti non verificati

Questo è più importante di tutti i punti tecnici messi insieme.

Il sito fa **affermazioni fattuali, verificabili e molto specifiche**:

- **Numeri di risultato**: 38,4 Mln € di flussi ricostruiti, **9,7 Mln € rientrati
  ai segnalanti**, 1.840 casi analizzati, 612 perizie, 462 qualcos'altro, 31% / 27%
  di pratiche chiuse senza esito.
- **Nove persone con nome e cognome** (`chi-siamo.html`): Marta Bellini, Andrea
  Costa, Sara Ferrero, Giulia Rinaldi, Davide Marchetti, Chiara Neri, Paolo Greco,
  Luca Venturi, Francesca Bruno — con biografie e ruoli.
- **Dati societari**: ERSEL SPA, Piazza Solferino 11, Torino, P.IVA 06900230018,
  **"Iscrizione Albo delle Banche n. 5573"**, **"Iscritta nei registri e vigilata
  da Banca d'Italia e CONSOB"**.
- **Prezzi**: 190 € IVA inclusa + 12% sul recuperato.
- Recapiti: `ciao@traccia.it`, `assistenza@traccia.it`, PEC `traccia@pec.it`.

Lo stesso `README-DEPLOY.md` ammette che **tutti** questi dati sono dimostrativi.
Ma nel codice non c'è nulla che lo dica al visitatore: nessun watermark "dati di
esempio", nessun `noindex`. Un visitatore vede un sito pronto, con numeri
autorevoli e una vigilanza CONSOB/Banca d'Italia dichiarata.

Tre nodi, in ordine di gravità:

1. **La vigilanza dichiarata.** "Iscritta nei registri e vigilata da Banca d'Italia
   e CONSOB" + numero di Albo Banche, su un servizio che si presenta come
   *«non un istituto di credito, non un intermediario finanziario»*, sono in
   contraddizione tra loro. E l'elenco degli iscritti all'Albo è pubblico: la
   verificabilità è immediata. Questo è il tipo di affermazione che espone
   all'art. 2598 c.c. (concorrenza sleale) e, se usata per acquisire clienti,
   a profili di truffa.
2. **"9,7 Mln € rientrati ai segnalanti"** è una promessa implicita di risultato,
   e `note-legali.html` si affretta a precisare che i numeri «hanno valore
   descrittivo e non costituiscono previsione né promessa». Le due cose convivono
   male sulla stessa pagina.
3. **Nove persone reali** con nome, ruolo e biografia: o sono dipendenti veri, o
   sono inventate. Nel secondo caso è la fattispecie più a rischio reputazionale
   e legale dell'intero sito.

**Nota di contesto:** un sito che vende ricostruzione di truffe crypto e chiede
190 € di "contributo di avvio" non rimborsabile opera esattamente nel perimetro
in cui il visitatore è stato appena truffato. La pagina avverte correttamente che
nessun operatore serio chiede anticipi — ma poi chiede un anticipo. La
differenza è reale (l'analisi viene consegnata comunque) ed è argomentata bene in
`onorari.html`; resta il fatto che la soglia di scetticismo del pubblico è
altissima e va gestita con trasparenza, non con numeri.

---

## 7. Priorità consigliate

**Prima di qualunque deploy pubblico**

1. Sostituire o rimuovere **tutti** i dati dimostrativi (team, importi, Albo
   Banche, vigilanza). In alternativa: `noindex` globale + banner "dati di
   esempio" ben visibile.
2. `Disallow: /` per `admin.html` e `app.html` in `robots.txt` **e**
   `noindex,nofollow` nel `<meta>` **e** rimozione dalla `sitemap.xml`.
3. Decidere la questione societaria con un consulente: la dicitura
   "vigilata da Banca d'Italia e CONSOB" va cancellata o documentata.

**Subito dopo (mezz'ora di lavoro, grande ritorno)**

4. Togliere `immutable` dal `Cache-Control`, oppure aggiungere un hash/versione
   ai nomi degli asset (`style.a1b2c3.css`) e aggiornare i 15 HTML.
5. Aggiungere una CSP in `vercel.json`. Con 7 script inline per pagina serve
   `'unsafe-inline'` per gli script (o spostarli in file), ma `default-src 'self'`
   + `frame-ancestors 'self'` + `object-src 'none'` chiude già molto.
6. Generare un'immagine `og:image` (1200×630) e un `favicon.ico`/`apple-touch-icon`
   veri: è l'unica cosa che manca perché il sito *sembri* finito quando lo si
   condivide.
7. Allineare `sitemap.xml` agli URL puliti o disattivare `cleanUrls`.

**Manutenzione**

8. Introdurre un template minimo (anche solo un `build.py` da 40 righe) per
   header/footer/nav: 15 copie sono 15 occasioni di divergenza.
9. Versionare il backend Python, che oggi non esiste nel repo, e chiarire nel
   README che `api.js` in modalità demo è **solo** una vetrina: la logica di
   autorizzazione va riscritta lato server.

---

## 8. Giudizio complessivo

**Come manufatto tecnico: buono.** Codice scritto a mano con cura, zero
dipendenze, nessun errore di sintassi o di markup, accessibilità e animazioni
trattate con cognizione. Si vede l'esperienza.

**Come prodotto: non pubblicabile così.** Due ostacoli, entrambi non tecnici:
i contenuti dichiarano fatti verificabili che il README stesso definisce falsi,
e il backend che il sito promette non è nel repository. Il primo è un rischio
legale, il secondo un debito architetturale — `api.js` è un simulacro così
convincente che il passo successivo sembra "collegare il server", mentre in
realtà va **riscritto**.

Basterebbe poco per portarlo online con dignità: dati veri (o un bell'avviso
"demo"), `noindex` su area riservata, e i quattro fix di caching/SEO/OG/CSP.
Il resto è già a posto.
