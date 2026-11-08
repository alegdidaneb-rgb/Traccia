# Traccia — pubblicazione su Vercel

Questa cartella contiene **il sito già compilato**, pronto da pubblicare.
`index.html` è in radice, gli asset sono in `assets/`, e `vercel.json` imposta
URL puliti, header di sicurezza e cache lunga per CSS/JS.

## Cosa c'è dentro

- 15 pagine HTML (home, come funziona, casi, cripto, chi siamo, onorari,
  supporto, login, area riservata, console analisti, 404, e le quattro legali)
- `assets/css/premium.css` + `style.css` e 10 file JS
- `robots.txt`, `sitemap.xml`, `404.html`
- `vercel.json` con `cleanUrls: true` (quindi `/casi` funziona, oltre a `/casi.html`)

Peso totale: ~1,9 MB (foto e font sono locali). Nessuna build e nessuna
dipendenza npm: Vercel serve i file così come sono. Il database è su Supabase,
non serve alcun processo lato server.

---

## Le altre lingue: inglese, tedesco, spagnolo

Ogni pagina pubblica esiste in quattro lingue: `index.html` (italiano) e
`en/`, `de/`, `es/`. Le pagine tradotte **non si scrivono a mano**: si
generano dal catalogo.

    tools/i18n/it.json     le frasi italiane, una per chiave (fonte di verità)
    tools/i18n/en.json     le stesse chiavi in inglese
    tools/i18n/de.json     … in tedesco
    tools/i18n/es.json     … in spagnolo

**Aggiungere o cambiare una frase in una pagina italiana**

1. modificala in `index.html` (o nell'altra pagina);
2. `python3 tools/allinea_catalogo.py` dice cosa manca e cosa avanza: `--aggiungi`
   crea le chiavi nuove, `--pota` toglie quelle che nessuna pagina usa più;
3. traduci le chiavi nuove nei tre cataloghi;
4. `python3 tools/build_i18n.py` riscrive `en/`, `de/`, `es/`;
5. `node tests/run.js` deve finire con `0 falliti`.

Il generatore traduce anche quello che non si vede leggendo la pagina:
`<title>`, `<meta name="description">`, `og:title`, `og:description`,
`og:image:alt`, i campi `twitter:`, la descrizione JSON-LD, e gli attributi
`alt`, `aria-label`, `title`, `placeholder`. Restano fuori di proposito
`app.html` e `admin.html`: sono l'area riservata e la console degli analisti,
leggono e scrivono dati, e si traducono insieme ai messaggi che il database
restituisce.

`python3 tools/build_i18n.py --check` esce con errore se una pagina tradotta è
disallineata dal catalogo: è il comando da mettere in CI.

---

## Il catalogo WhatsApp Business

Quello che offriamo, in vetrina dentro WhatsApp: sette articoli in quattro
lingue, in `catalogo-whatsapp/`.

    catalogo-whatsapp/it.csv           da importare in WhatsApp Business Manager
    catalogo-whatsapp/en.csv  de  es   lo stesso, per le altre lingue
    catalogo-whatsapp/ritagli/         le foto quadrate 1080×1080 degli articoli
    catalogo-whatsapp/schede-*.md      gli stessi testi, da caricare a mano
    catalogo-whatsapp/README.md        come si importa, e cosa non promettere

Non si scrivono a mano: `python3 tools/catalogo_whatsapp.py` li genera da
`onorari.html`, `come-funziona.html` e `supporto.html`, così il prezzo del
catalogo e quello della pagina Onorari non possono divergere. Il test
`tests/catalogo_whatsapp.test.js` controlla che sia così, e che nessun articolo
prometta un recupero — è un catalogo pubblico, e lo legge anche chi è appena
stato truffato una seconda volta.

---

## Intestazione e piè di pagina: un solo posto

L'intestazione e il piè di pagina non stanno più dentro le quattordici pagine
come copie separate: stanno in `partials/` (`header.html`, `footer.html`,
`area-bar.html`) e uno script li cuce dentro le pagine.

```bash
python3 tools/build_shell.py          # riscrive le pagine dai partials
python3 tools/build_shell.py --check  # esce 1 se una pagina è disallineata
```

Dentro la pagina resta **HTML vero**, tra due marcatori:

```html
<!-- shell:header -->
...
<!-- /shell:header -->
```

Quindi il sito resta statico: nessun `fetch`, nessun JavaScript in più, nessun
lampo di pagina vuota al caricamento. La voce di menu attiva (`is-active` e
`aria-current="page"`) la decide lo script dal nome del file, non si scrive più
a mano.

**Regola pratica:** un ritocco all'header o al footer si fa in `partials/` e si
rilancia lo script. Modificare l'header dentro una singola pagina funziona fino
alla build successiva, che lo sovrascrive.

Per bloccare le regressioni, `python3 tools/build_shell.py --check` va eseguito
prima di ogni pubblicazione: se qualcuno ha toccato una pagina a mano, lo dice.

## Opzione A — drag & drop (2 minuti, nessun comando)

1. Vai su <https://vercel.com/new>
2. Trascina **questa cartella** nella zona di caricamento
3. Nome progetto: `traccia`
4. Framework preset: **Other** (non c'è nulla da compilare)
5. Deploy

## Opzione B — da terminale

```bash
cd traccia-deploy
npx vercel          # anteprima
npx vercel --prod   # produzione
```

Alla prima esecuzione risponde a poche domande: framework `Other`,
build command vuoto, output directory `.` (la radice).

## Opzione C — GitHub + deploy automatico

```bash
cd traccia-deploy
git init && git add -A
git commit -m "Traccia — sito di analisi forense"
git branch -M main
git remote add origin git@github.com:<tuo-utente>/traccia.git
git push -u origin main
```

Poi su Vercel: **Add New → Project → Import Git Repository → traccia → Deploy**.
Da quel momento ogni push su `main` ripubblica il sito.

---

## Dopo il deploy

### 1. Imposta il dominio reale

Nel progetto Vercel → **Settings → Domains** → aggiungi `traccia.it.com`.
Poi, nel pannello del registrar:

| Tipo | Nome | Valore |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

Verifica con `dig traccia.it.com` dopo qualche ora.

### 2. Aggiorna gli URL assoluti

`robots.txt`, `sitemap.xml` e i meta tag contengono il dominio definitivo.
Quando cambia, aggiornali con una sostituzione unica su tutti i file e rilancia
il deploy.

### 3. Backend: Supabase

Il sito è statico ma **non è più in modalità demo**: login, pratiche, documenti,
wallet e console analisti leggono e scrivono su un database PostgreSQL Supabase.
Non c'è alcun processo Python da avviare — `backend/app.py` non esiste.

| Voce | Valore |
|---|---|
| Progetto | `mmjycpdfjlbckeefbtuq` |
| Endpoint | `https://mmjycpdfjlbckeefbtuq.supabase.co` |
| Schema | `traccia` |
| Chiave client | publishable, dentro `assets/js/config.js` |

La chiave publishable è fatta apposta per stare nel browser: non concede alcun
accesso diretto. Le tabelle hanno RLS attiva e `anon`/`authenticated` non hanno
permessi su di esse; si passa solo dalle funzioni RPC, che richiedono un token
di sessione valido (hash SHA-256 salvato lato server, scadenza 30 giorni).
La chiave `service_role` non deve mai finire nel repository.

**Migrations** (`supabase/migrations/`, da applicare in ordine):

| File | Contenuto |
|---|---|
| `0001_schema.sql` | tabelle, RLS, revoke |
| `0002_auth.sql` | hash token, login/registrazione, helper |
| `0003_client_api.sql` | listino, dashboard, operazioni, documenti, wallet |
| `0004_admin_api.sql` | console analisti, audit |
| `0005_contact.sql` | modulo contatti |
| `0006_holdings.sql` | controvalore cripto per cliente |
| `0008_public_wrappers.sql` | **wrapper in `public` (indispensabile)** |
| `0010_contracts.sql` | contratto di incarico generato in automatico |
| `0011_notifications_and_phase.sql` | cambio di fase e avvisi al cliente |
| `0012_limits_and_testing.sql` | limiti per livello di verifica |
| `0013_login_attempts_and_sessions.sql` | freno ai tentativi, sessioni |
| `0014_storage_documents.sql` | file dei documenti su Storage |
| `0015_conto_corrente.sql` | movimenti, prenotazioni, estratto conto |
| `0016_banca_operativa.sql` | bonifici SEPA, SDD, interessi, carta, wrapper |
| `0017_superficie_public.sql` | tutti i wrapper `public`, revoca delle funzioni interne |

Le funzioni devono essere richiamabili da `/rest/v1/rpc/<nome>`, quindi ognuna
ha un wrapper `security definer` in `public` (migrazione `0008` e, per le
funzioni nuove, `0010`). Senza wrapper la risposta è
`Could not find the function ... in the schema cache`: sembra mancare una
funzione, in realtà non è raggiungibile l'API.

Per riapplicarle su un progetto nuovo: incolla il contenuto di ciascun file in
SQL Editor (o `supabase db push` con la CLI) e poi crea il primo amministratore
con `traccia.auth_register(...)` seguito da un `update` che imposti
`role = 'admin', is_master = true, status = 'active'`.

Dopo aver cambiato dominio, aggiungi l'origine alle policy CSP in `vercel.json`
(`connect-src ... https://mmjycpdfjlbckeefbtuq.supabase.co`) e, se attivi il
redirect di autenticazione Supabase, imposta il Site URL in
**Authentication → URL Configuration**.

### 4. Accesso degli analisti

Il sito **non pubblica più account di prova**. Fino al #16 la schermata di
accesso elencava quattro indirizzi con la password accanto, compreso
`master@traccia.it.com`: chiunque aprisse il link aveva la console degli analisti,
senza dover indovinare niente. Non era una funzione da nascondere con il CSS —
le credenziali non devono stare in un file che il browser scarica.

Gli account dimostrativi (`luca.bianchi`, `giulia.rossi`, `elena.ferrari`,
`marco.verdi`, `paola.neri`) sono stati **eliminati** con le loro pratiche: le
password erano state scritte su una pagina pubblica e non c'era modo di sapere
chi le avesse lette. Le sessioni aperte sono state chiuse.

Restano due account amministrativi: `master@traccia.it.com` e `ops@traccia.it.com`.

**Le loro password non sono scritte qui, e non devono esserlo.** Questo file sta
in un repository pubblico: qualunque password scritta in questo file è una
password pubblicata, con l'unica differenza che nessuno la linka. È successo due
volte — prima con la pagina di accesso, poi con questa tabella — quindi la regola
non è «stare attenti», è non avere il posto dove scriverle.

Per impostarle, dalla SQL Editor del progetto:

```sql
update traccia.users
set password_hash = extensions.crypt('LA-PASSWORD-SCELTA', extensions.gen_salt('bf', 10))
where email = 'master@traccia.it.com';

-- e chiude le sessioni già aperte con la vecchia
update traccia.sessions set expires_at = now()
where user_id = (select id from traccia.users where email = 'master@traccia.it.com');
```

Conservale in un gestore di password. Se una di queste password finisce in un
file, in una chat o in uno screenshot, va cambiata: la rotazione costa una riga
di SQL, non farlo costa l'area riservata.

Serve una password provvisoria per entrare la prima volta? Si genera con
`openssl rand -base64 18` e si mette nel comando qui sopra. Non va salvata nel
repository per ricordarsela: se serve ricordarla, il posto è il gestore di
password.

Il cliente dimostrativo non c'è più: per provare l'area riservata bisogna
registrarne uno dal sito, che è esattamente ciò che fa un cliente vero. La
console funziona lo stesso — un analista apre la pratica di un cliente iscritto
con `admin_view_client`, senza conoscerne la password (§5).

**Perché eliminare e non svuotare.** Gli account dimostrativi non potevano
restare inattivi con la vecchia password: `auth_login` non guarda lo stato prima
di emettere il gettone, quindi un account «sospeso» con una password pubblica è
un account aperto. Svuotare la password avrebbe lasciato in piedi un indirizzo
che risponde a un tentativo di accesso; eliminarlo lo toglie di mezzo.

Una nota su cosa si è perso: i movimenti di conto e i bonifici di quegli
account sono spariti con loro (cascata su `user_id`). Il registro attività
invece **resta**: le righe perdono il puntatore all'utente ma conservano
`actor_email`, che è ciò che serve per ricostruire chi ha fatto cosa. Il ledger
si è potuto svuotare solo sospendendo per una transazione il trigger
`ledger_no_update`, che di norma rifiuta anche i `DELETE` che arrivano dalla
cascata — è la sua ragione d'essere, e vale la pena saperlo prima di cancellare
un utente che ha movimenti.

### 4-bis. Il repository è pubblico, e la build pubblica la cartella

Due cose che sembrano ovvie e sono costate due giri:

**1. `.gitignore` non toglie un file già versionato.** `traccia-sito.zip` era
nell'ignore dal primo giorno ed era comunque dentro git: l'ignore vale per i file
nuovi, non per quelli già tracciati. Dentro c'erano il vecchio `login.html` e un
`api.js` con sei account e le relative password in chiaro. Il file è stato
rimosso dal versionamento con `git rm --cached`, non cancellato dal disco.

Restare nella storia di git, però, non basta a metterlo al sicuro: un repository
pubblico conserva ogni versione. Se un giorno questo repository tornerà privato o
verrà riscritto, la storia va ripulita; nel frattempo ciò che conta è che le
password contenute lì dentro **non valgano più**, ed è così.

**2. Vercel pubblica la cartella, non le pagine linkate.** Un file che sta nel
repository finisce online anche se nessuna pagina lo cita. Per questo esiste
`.vercelignore`, che tiene fuori archivi, documentazione e cartelle di lavoro —
`README-DEPLOY.md` compreso. `tests/login.test.js` verifica che ci sia e che
elenchi le voci giuste.

La conseguenza pratica: **in questo repository non si scrivono password.** Non
nel README, non nei commenti, non negli esempi. Se una password serve a qualcuno,
si comunica per un canale suo; se serve a ricordarsela, il posto è un gestore di
password. La SQL per impostarla è qui sopra, e prende la password come testo da
sostituire.

### 5. Cosa può fare un analista

Dalla console, la pratica di un cliente si apre con un clic, senza conoscerne
la password: `admin_view_client` emette una sessione di **sola lettura** che
scade dopo 2 ore e lascia traccia (`client_view`) nel registro attività.
L'analista vede tutto ciò che vede il cliente — documenti, operazioni,
contratto — ma non può scrivere: ogni funzione di modifica passa da
`need_write_user` e risponde `42501`.

### 5-bis. Il contratto di incarico

Ogni cliente ha **un contratto generato automaticamente**, senza che nessuno
debba prepararlo a mano:

| Momento | Cosa succede |
|---|---|
| registrazione dal sito | `auth_register` crea l'account e chiama `ensure_contract` |
| account creato da un analista | `admin_create_account` fa lo stesso |
| clienti già esistenti | il ciclo finale di `0010` li copre tutti |

Il contratto è in italiano e regola **servizi** (le cinque fasi, con
l'obbligazione di mezzi e i limiti espliciti) e **pagamenti** (quota di apertura
di 190 €, quota di successo del 12 % sulle sole somme incassate, pagamento
esclusivamente a mezzo bonifico sull'IBAN dedicato).

- Intestazione: **ERSEL SPA**, P.IVA 06900230018, email `assistenza@traccia.it.com`,
  sede legale in Piazza Solferino, 11 - 10121 Torino (TO).
- Numero progressivo: `TRC-<anno>-<numero>`. Non si riusa.
- Le condizioni sono salvate come **fotografia** (`traccia.contracts.snapshot`):
  cambiare tariffe o limiti in `settings` non riscrive i contratti già emessi.
  Per applicare condizioni nuove serve un contratto nuovo, di versione successiva.
- Il cliente lo legge e lo accetta dalla voce **Contratto** dell'area riservata.
  L'accettazione è registrata in `audit` (`contract_accepted`) e non è ripetibile.
- Un analista che apre la pratica in sola lettura **vede** il contratto ma non
  può accettarlo al posto del cliente: `accept_contract` passa da
  `need_write_user`, che risponde `42501`.
- Dalla console, la tabella *Tutti gli account* mostra numero e stato
  (`accettato` / `da accettare`).

Per correggere la sede legale su un contratto già emesso si riscrive lo
snapshot, annotando la modifica nel registro attività:

```sql
update traccia.contracts
set snapshot = jsonb_set(snapshot, '{provider,address}', '"..."')
where number = 'TRC-2026-0003';
```

### 5-ter. Il pulsante WhatsApp

Il pulsante compare in **tutte le pagine** (fisso in basso a destra) e in
forma estesa nella sezione contatti di `supporto.html`. Il destinatario è
configurato in un solo posto, `assets/js/config.js`:

```js
whatsapp: "393331234567",   // formato internazionale, senza "+" né spazi
whatsappText: "Buongiorno, vi scrivo dalla mia area riservata Traccia. Pratica {pratica}."
```

| Comportamento | Dettaglio |
|---|---|
| Numero assente | `whatsapp: ""` → il pulsante **non compare**, nessun link rotto |
| Numero scritto male | `+39 333 123 4567` va bene: viene normalizzato in `393331234567` |
| Messaggio | precompilato; se il cliente ha una sessione aperta include il codice pratica |
| Senza pratica | la frase con il codice viene tolta, non lasciata vuota |
| Nuova scheda | si apre WhatsApp con `rel="noopener"` |

Il messaggio è solo un testo già scritto nel campo: il cliente può
modificarlo prima di inviare e nessun dato viene inviato in automatico.

**Avvertenza.** Un canale diretto come WhatsApp è anche un bersaglio
prevedibile per i falsi profili, ed è per questo che il piè di pagina di ogni
pagina e la sezione contatti dichiarano che il numero è **solo** quello
pubblicato, che non si scrive mai per primi e che non si chiede denaro in
chat. Tenere quella frase anche dopo aver cambiato numero.

### 5-quater. Spostare una pratica di fase

Le cinque fasi — Raccolta, Ricostruzione, Perizia, Denunce, Legale — si
cambiano dalla console, colonna **Fase** della tabella segnalazioni.

| Aspetto | Comportamento |
|---|---|
| Chi può | solo gli analisti (`need_admin`); il cliente che ci prova riceve `42501` |
| Verso | qualsiasi direzione: un caso può tornare da *Perizia* a *Ricostruzione* |
| Registro | `phase_change` con `Raccolta → Perizia · nota` e l'operatore |
| Nota | facoltativa, ma è quella che il cliente legge |
| Avviso | attivo per impostazione predefinita, disattivabile con la casella accanto ai filtri |

Spostare la fase aggiorna il cruscotto del cliente: percentuale di
avanzamento e timeline. Se l'avviso è attivo, il cliente trova una voce nella
campanella dell'area riservata:

> **La pratica è passata alla fase 3 · Perizia**
> Redazione del documento tecnico. *Relazione in corso.*

Gli avvisi stanno in `traccia.notifications` (RLS attiva, nessun accesso
diretto) e si leggono solo dalle funzioni. Aprire la campanella li segna come
letti; un analista in sola lettura non può farlo al posto del cliente (`28000`).

Disattivare l'avviso serve quando si corregge un errore di impostazione e non
c'è nulla da comunicare.

### 5-quinquies. Documenti da valutare

I documenti caricati dai clienti finivano in una coda che nessuna schermata
leggeva: restavano `pending` per sempre. Ora stanno nella console, sezione
**Documenti da valutare**, con i filtri *Da valutare · Accettati · Rifiutati*.

| Azione | Effetto sul database | Effetto per il cliente |
|---|---|---|
| Accetta | `status = 'received'`, `decided_by`, `decided_at` | il documento risulta acquisito |
| Rifiuta | `status = 'rejected'` + `decision_note` | legge la nota e ricarica il documento |

Il rifiuto **richiede** una nota: senza, la console si ferma. Una riga
«rifiutato» senza spiegazione è peggio di nessuna risposta.

Tutto passa da `admin_document_action`, che rifiuta (`22023`) un documento già
valutato e registra `document_approve` / `document_deny` nel registro attività.

### 5-sexies. Aprire la pratica di un cliente (sola lettura)

Dalla tabella **Tutte le pratiche**, pulsante *Apri pratica*: si apre l'area
riservata del cliente in una scheda nuova, con una striscia in alto che dice di
chi è la pratica e come uscirne.

Non è impersonificazione, e la differenza è nel database:

| | |
|---|---|
| Sessione | `role = 'staff'`, `acting_user_id` = analista, durata **2 ore** |
| Scritture | `need_write_user` le rifiuta tutte con `42501` |
| Verificato | deposito e caricamento documento rifiutati con la sessione staff |
| Registro | `client_view` con l'email del cliente e «accesso in sola lettura» |
| Nell'area | i pannelli che scrivono sono nascosti (`body.is-staff-view`) |

Nascondere i moduli è cortesia verso chi guarda; il divieto vero è nel
database, quindi vale anche se qualcuno chiama l'API a mano.

### 5-septies. Tentativi di accesso e chiusura delle sessioni

| Aspetto | Comportamento |
|---|---|
| Freno | 5 password sbagliate in 15 minuti sulla stessa email → accesso bloccato |
| Messaggio | «Troppi tentativi di accesso. Riprova tra qualche minuto.» |
| Traccia | ogni tentativo in `traccia.login_attempts` (email, IP, esito) |
| Pulizia | i tentativi più vecchi di 7 giorni vengono cancellati al login riuscito |
| Password giusta su account sospeso | non conta come tentativo di intrusione |

Dettaglio che conta: `auth_login` **non solleva eccezioni**. Se le sollevasse,
la transazione verrebbe annullata e anche la registrazione del tentativo
fallito sparirebbe: il contatore resterebbe a zero e il freno non
scatterebbe mai. Gli errori tornano come dati — `{ok: false, error: "..."}` —
e `api.login()` li trasforma in errore per la pagina.

Le sessioni ora si chiudono davvero:

| Da dove | Funzione | Effetto |
|---|---|---|
| Area cliente → *Sicurezza* → *Esci da tutti i dispositivi* | `auth_logout_all` | chiude tutte le sessioni dell'utente |
| Console → *Tutte le pratiche* → *Chiudi sessioni* | `admin_revoke_sessions` | chiude le sessioni di quel cliente |
| Uscita normale | `auth_logout` | chiude solo la sessione corrente |

`auth_user` — il punto in cui ogni funzione autenticata verifica il gettone —
ignora le sessioni con `revoked_at` valorizzato. La revoca vale quindi ovunque,
non solo nella schermata che l'ha chiesta. Verificato: dopo `auth_logout_all`
la stessa chiamata a `auth_me` risponde `28000`.

### 5-octies. Caricamento dei documenti

Il file va su **Supabase Storage**, bucket `documenti`, in un percorso che
contiene cliente e documento:

```
documenti/<user_id>/<document_id>/<nome-file>
```

Il database controlla che il percorso sia davvero quello (`attach_document_file`
rifiuta `22023` se non inizia con `<user_id>/<document_id>/`): senza questo
controllo, un cliente potrebbe far puntare la riga al file di un altro.

| Aspetto | Valore |
|---|---|
| Bucket | `documenti`, **privato** |
| Formati | PDF, JPG, PNG (controllati nel browser **e** nel database) |
| Dimensione | massimo 10 MB |
| Lettura | solo link firmato, valido 10 minuti, chiesto a `document_link` |
| Sovrascrittura | non prevista: un documento caricato non si sostituisce |
| Registro | `document_upload` e `document_link` con chi ha aperto cosa |

Il cliente vede solo i propri file; l'analista li vede tutti. Ogni apertura
lascia una riga nel registro attività, perché «chi ha guardato questo
documento» è una domanda a cui dobbiamo saper rispondere.

**Punto aperto, da leggere prima di andare in produzione.** Le policy su
`storage.objects` usano `auth.uid()`, cioè una sessione Supabase Auth. Le
sessioni di Traccia sono gettoni in `traccia.sessions`, non sessioni Supabase
Auth: finché non si collega un `auth_id` a ogni utente (`traccia.users.auth_id`
esiste già), il caricamento diretto dal browser viene rifiutato e va instradato
su una Edge Function con la chiave di servizio.

Due strade, in ordine di preferenza:

1. **Edge Function `upload-documento`** (consigliata): riceve il file, verifica
   il gettone `traccia`, carica con la chiave di servizio, chiama
   `attach_document_file`. Unico modo per non lasciare file orfani quando una
   riga viene rifiutata, perché il file e la riga si creano nello stesso punto.
2. **Sessione Supabase Auth** per ogni cliente, con `auth_id` compilato: il
   caricamento avviene direttamente dal browser e le policy qui sotto bastano.

Finché non si sceglie, il modulo mostra un errore chiaro («Caricamento non
riuscito») invece di far finta di aver caricato.

### 5-nonies. Il conto: versamenti, prelievi, estratto conto

Prima esistevano richieste di versamento e prelievo senza un conto dietro: il
saldo era un numero che l'analista poteva scrivere a mano, un prelievo non
controllava se i soldi c'erano, e dell'operazione approvata restava solo una
riga con lo stato.

| Pezzo | Dove | Cosa fa |
|---|---|---|
| Movimento | `traccia.ledger_entries` | una riga per movimento, con data valuta e saldo dopo |
| Saldo | `users.balance_eur` | somma dei movimenti, scritta **solo** da `registra_movimento` |
| Impegnato | `users.reserved_eur` | quota bloccata da richieste in attesa |
| Disponibile | calcolato | saldo − impegnato: è il numero grande dell'interfaccia |

**Perché tre numeri e non uno.** Un prelievo in attesa non è ancora uscito, ma
non è nemmeno spendibile: se il cliente ne chiede due da 300 con 400 sul conto,
il secondo deve fermarsi. Con un solo numero il secondo passerebbe, e il
problema si scoprirebbe al momento di pagare. Verificato: prenotato tutto il
saldo, un secondo prelievo anche di 1 € viene rifiutato con «Disponibile
insufficiente».

**I movimenti non si modificano.** Un trigger rifiuta `UPDATE` e `DELETE` su
`ledger_entries`: un errore si corregge con una riga di storno, che resta
visibile. È la differenza fra un estratto conto e un foglio di calcolo.

**Il prelievo richiede un IBAN intestato al cliente** (`imposta_iban`), che
l'analista verifica dalla console (colonna IBAN → *verifica*). Con un saldo
attivo l'IBAN non si cambia da soli: si passa dall'assistenza, perché cambiare
la destinazione dei prelievi è esattamente ciò che farebbe un intruso.

**Estratto conto**: `estratto_conto(token, da, a)` restituisce i movimenti del
periodo con il saldo progressivo. La stampa è già impostata (solo il foglio,
senza navigazione).

### 5-decies. Bonifici SEPA, addebiti diretti, interessi, carta

Migrazione `0016_banca_operativa.sql`. Il conto del §5-nonies sapeva di
contabilità; qui ci sono i canali con cui il denaro esce ed entra davvero.

| Pezzo | Tabella | Regola che conta |
|---|---|---|
| Bonifico | `bank_transfers` | `queued → sent → executed`: il movimento si scrive **solo** su `executed` |
| Mandato | `direct_debit_mandates` | si firma solo con IBAN verificato; la revoca annulla gli addebiti aperti |
| Addebito | `direct_debits` | incassato = movimento; contestato entro 8 settimane (CORE) = storno |
| Interessi | `interest_accruals` | maturazione giornaliera idempotente, accredito in un movimento unico |
| Carta | `cards` | solo le ultime 4 cifre; il blocco non chiede conferma all'analista |

**Perché «inviato» e «eseguito» sono due stati.** Mandare un bonifico alla banca
non è pagare: finché la banca non risponde, il denaro è ancora sul conto e i
fondi restano impegnati. Se l'esito è `rejected` o `returned` i fondi si
liberano senza scrivere alcun movimento; se è `executed` si scrive il movimento
e si libera la prenotazione nello stesso atto. Verificato in produzione: 100 €
disposti, respinti con `AC04` → saldo invariato, prenotato tornato a 300.

**Gli addebiti diretti sono già scritti come li vuole il regolamento.** Mandato
CORE → rimborso entro 8 settimane; mandato B2B → nessun rimborso automatico, e
il sito lo dice invece di lasciare il cliente a scoprirlo. La contestazione non
cancella l'addebito: scrive uno storno (`reversal`) che resta nell'estratto.
Verificato: −85,40 incassato, poi stornato; i due movimenti si leggono in fila.

**Gli interessi non si inventano.** Il tasso sta in `settings.interest`
(`annual_rate_pct`, oggi 1,5 %), parte da zero e il codice non ne conosce
nessuno. `matricola_interessi(token)` è idempotente per giorno (unique su
`user_id, accrued_on`): girare due volte non raddoppia niente — verificato.
`accredita_interessi` somma le maturazioni non pagate e scrive un movimento
solo; sotto il centesimo non accredita e **non azzera**: gli importi restano in
attesa del prossimo accredito. Per farli maturare ogni notte serve un job
(pg_cron) che chiami `select traccia.matricola_interessi();` — senza sessione,
con il ruolo del database.

**La carta** si richiede dal livello 2 con IBAN verificato, e l'analista la
attiva (console → *Banca e pagamenti*). Il numero completo non c'è e non ci
sarà: si conservano `last4`, scadenza e limite mensile, che sono le uniche
informazioni che una schermata deve mostrare.

**Prelievo e bonifico sono la stessa cosa.** «Preleva» apre un bonifico già
compilato verso l'IBAN del cliente: prima erano due percorsi separati, e quello
vecchio non passava dai canali SEPA (niente IBAN del beneficiario, niente esito
della banca). Un modo solo vuol dire un posto solo in cui sbagliare.

**Bug trovati e chiusi in questa migrazione** (tutti in produzione, non in
teoria):

1. `public.conto`, `public.estratto_conto`, `public.imposta_iban`,
   `public.admin_verifica_iban`, `public.document_link` e
   `public.attach_document_file` **non esistevano**: PostgREST espone solo
   `public`, quindi il conto del §5-nonies e il pulsante «verifica» dell'IBAN
   rispondevano «function not found». Ricreati qui, e il test
   `tests/banca.test.js` confronta le funzioni chiamate dal client con quelle
   definite nella migrazione.
2. `users.reserved_eur` era una **copia** di un dato già in `operations` e in
   produzione era arretrata: 300 € di prelievo in attesa e «Impegnato 0 €».
   Ora `traccia.prenotato_eur(user)` calcola dalle operazioni aperte, `conto()`
   legge il calcolo, e `prenota_fondi`/`libera_fondi` riscrivono la cache
   invece di sommarla. `riallinea_prenotazioni()` ha corretto 1 account e resta
   ripetibile.
3. `bonifico_crea` trattava `daily_withdrawal_l3 = 0` come «nessun limite»
   anche sotto il livello 3: un cliente non verificato poteva disporre bonifici.
   Ora zero significa due cose distinte, come nel §0012.

### 5-undecies. La superficie pubblica: perché una funzione che non c'è non si vede

Migrazione `0017_superficie_public.sql`.

PostgREST espone **solo** lo schema `public`. Le funzioni del progetto vivono
in `traccia`, e per arrivarci serve un wrapper in `public` con gli stessi nomi
dei parametri. Un wrapper mancante non dà un errore di compilazione: dà
`function not found` al browser, e nessuno se ne accorge finché non apre quella
schermata. Nel #12 è successo con `public.conto`: il conto e il pulsante
«verifica IBAN» erano morti.

Guardando meglio, il problema era più grande. Confronto fra database vivo e
cartella `supabase/migrations/`:

| | |
|---|---|
| funzioni in `public` nel database | **69** |
| funzioni `public` scritte nei file | **29** |

Le altre 40 erano state create a mano, una sessione alla volta. Il sito
funzionava; **ricostruire il database da questa cartella avrebbe prodotto un
progetto in cui login, area riservata e console analisti non esistono.** Il
repository sembrava completo perché il database lo era.

La 0017 scrive tutti i wrapper che mancavano (38, incluso
`admin_revoke_sessions`, che non esisteva nemmeno nel database e rendeva muto
il pulsante «chiudi le sessioni»).

**La regola, e come si fa rispettare.** Ogni funzione che il client chiama ha
un wrapper in `public` scritto in una migrazione. Non è una convenzione: è un
test. `tests/banca.test.js` legge `assets/js/api.js`, estrae le funzioni
chiamate e le confronta con i `create function public.*` di **tutte** le
migrazioni; poi confronta i nomi dei parametri con la funzione `traccia`
corrispondente, perché un wrapper con i parametri sbagliati dà lo stesso
errore di un wrapper assente ed è più difficile da vedere.

**Il secondo difetto, dello stesso giro.** Tutto ciò che sta in `public` è
eseguibile da `anon`: PostgreSQL concede `EXECUTE` a `PUBLIC` per impostazione
predefinita. C'erano anche `hash_token` (calcola l'impronta di un gettone di
sessione), `holdings_value` (legge il portafoglio di un utente qualsiasi) e
`set_updated_at` (una funzione di trigger, che non è un endpoint). La 0017 le
revoca **`from public, anon, authenticated`** — il `from public` è quello che
conta: senza, la revoca ad `anon` non serve a niente, perché il permesso
arriva da `PUBLIC`. Verificato: tutte e tre rispondono `false` a
`has_function_privilege('anon', …)`.

Per controllare il database invece dei file:

```sql
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
order by 1;
```

Se in quell'elenco compare qualcosa che non è un endpoint del client, è un
wrapper da revocare — non una funzione da nascondere.

Cosa **non** c'è, e non per dimenticanza: eseguire il bonifico, incassare
l'addebito, emettere la carta. Servono un istituto di pagamento e un contratto
con la banca: qui ci sono la richiesta, i controlli, i mandati, la
riconciliazione e gli esiti, che è la parte che il software può fare. Il
contratto (§5) dice che i controlli della banca, degli intermediari e
dell'autorità restano fermi.

### 5-duodecies. La ricevuta di un bonifico e l'estratto dei soli bonifici

Migrazione `0018_documenti_bonifico.sql`.

Due funzioni, perché il cliente chiede due cose diverse:

| funzione | cosa restituisce |
|---|---|
| `public.bonifico_ricevuta(p_token, p_id)` | il documento di **un** bonifico, pronto da stampare |
| `public.bonifici_estratto(p_token, p_da, p_a, p_stato)` | **solo** i bonifici del periodo, con il totale eseguito |

**Perché non bastava `estratto_conto`.** Il ledger ha una riga per movimento:
importo, data, descrizione. Non ha l'IBAN del beneficiario, non ha lo stato,
non ha il codice con cui la banca ha risposto. Un «estratto dei bonifici» fatto
filtrando il ledger sarebbe un elenco di importi senza intestatari — cioè la
cosa che il cliente chiede di non ricevere. `bonifici_estratto` legge
`traccia.bank_transfers`, filtra `direction = 'out'` e, se non gli si dà un
periodo, copre gli ultimi dodici mesi.

Il totale dell'estratto conta **solo i bonifici eseguiti**: sommare anche quelli
in attesa direbbe al cliente che ha spostato denaro che non è ancora partito.

**Ricevuta, non fattura.** Il bonifico non ha un corrispettivo: gli onorari
sono 190 € all'apertura e il 12% di quanto si recupera, e nessuno dei due si
applica a un trasferimento. Non c'è quindi niente da fatturare, e la ricevuta
lo dice: la nota in fondo è «non documento fiscale». Se un giorno comparisse un
costo per singolo bonifico, la ricevuta guadagna una riga di addebito e diventa
una fattura, con numerazione progressiva — che oggi non esiste apposta.

Il documento porta il blocco del prestatore (`traccia.provider_block()`:
ERSEL SPA, P.IVA, PEC, sede), il codice banca e il messaggio quando la banca ha
rifiutato, e la data valuta. La stampa è `window.print()` sulla modale: i CSS
di stampa nascono il foglio.

**L'estratto in CSV** usa il punto e virgola e la virgola nei decimali: è il
formato che Excel italiano apre senza chiedere niente. In testa c'è il BOM,
senza il quale gli accenti arrivano rotti. Nome del file:
`bonifici-<da>_<a>.csv`.

Entrambe le funzioni sono raggiungibili solo dal titolare: `bonifico_ricevuta`
risponde `42501` se il bonifico non è suo, e l'estratto non accetta un utente
come parametro — lo ricava dal gettone.

### 6. Registrarità

`traccia.audit` è append-only e registra ogni azione amministrativa con
l'operatore che l'ha eseguita: approvazioni, rifiuti, sospensioni, cambi di
ruolo e di KYC, modifiche ai limiti. Non ci sono endpoint per cancellarla.

---

## Attenzione prima di andare online per davvero

I numeri e i contenuti dei casi sono **dimostrativi**: 38,4 Mln €, 9,7 Mln €
rientrati, 612 perizie, i quattro casi con i loro importi, i nomi e le
biografie delle nove persone del team, gli indirizzi email su `traccia.it.com`.

Sono affermazioni verificabili. Vanno sostituite con dati reali prima della
pubblicazione, altrimenti il sito dichiara cose non vere — ed è esattamente il
tipo di contenuto per cui un servizio di questo settore perde ogni credibilità.

Le affermazioni non verificabili sono già state tolte: il footer non cita più
l'Albo delle Banche né una vigilanza che non esercitiamo, `note-legali.html` §7
dice cosa siamo e cosa non siamo, e gli importi inventati (9,7 Mln €,
38,4 Mln €, 612 perizie, 1840 casi) sono stati sostituiti da un trattino.

Punti da rivedere, in ordine di rischio:

1. **Team** (`team.html`, `chi-siamo.html` e sezione team in home): nomi, ruoli,
   biografie. La pagina `team.html` è generata da `assets/js/team.js`: formazione,
   credenziali (ordini professionali, registri dei revisori) e pubblicazioni sono
   inventate come i nomi, e su una pagina che dichiara «credenziali verificabili»
   sono la parte più delicata. Sostituirle con i dati reali dell'ufficio prima
   della pubblicazione — o togliere la sezione, che è peggio ma è onesto.
2. **Risultati** (`casi.html`): i quattro casi con i loro importi
3. **Recapiti**: `assistenza@traccia.it.com`, `assistenza@traccia.it.com`, PEC, telefono
   (`tel:+3901100000000` è ancora un segnaposto)
4. **WhatsApp**: `assets/js/config.js` → `whatsapp: ""` nasconde il pulsante;
   mettere il numero reale lo fa comparire ovunque
5. **Onorari**: 190 € + 12% — da allineare al contratto reale
6. **Contratto**: è stato scritto da chi scrive codice, non da un avvocato.
   Va letto da un legale italiano prima che qualcuno lo firmi.
