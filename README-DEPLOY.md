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

Nel progetto Vercel → **Settings → Domains** → aggiungi `traccia.it`.
Poi, nel pannello del registrar:

| Tipo | Nome | Valore |
|---|---|---|
| A | `@` | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

Verifica con `dig traccia.it` dopo qualche ora.

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

### 4. Account di prova

Creati direttamente nel database. **Cambia o elimina queste password prima di
condividere il link con chiunque.**

| Ruolo | Email | Password |
|---|---|---|
| Analista master | `master@traccia.it` | `Master!2026` |
| Analista | `ops@traccia.it` | `Ops!2026` |
| Cliente attivo | `luca.bianchi@example.it` | `Demo!2026` |
| Cliente in attesa | `giulia.rossi@example.it` | `Demo!2026` |
| Cliente sospeso | `elena.ferrari@example.it` | `Demo!2026` |

Per cambiare una password senza passare dall'interfaccia, da SQL Editor:

```sql
update traccia.users
set password_hash = extensions.crypt('NuovaPassword', extensions.gen_salt('bf', 10))
where email = 'master@traccia.it';
```

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

- Intestazione: **ERSEL SPA**, P.IVA 06900230018, PEC `traccia@pec.it`,
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

### 6. Registrarità

`traccia.audit` è append-only e registra ogni azione amministrativa con
l'operatore che l'ha eseguita: approvazioni, rifiuti, sospensioni, cambi di
ruolo e di KYC, modifiche ai limiti. Non ci sono endpoint per cancellarla.

---

## Attenzione prima di andare online per davvero

I numeri e i contenuti dei casi sono **dimostrativi**: 38,4 Mln €, 9,7 Mln €
rientrati, 612 perizie, i quattro casi con i loro importi, i nomi e le
biografie delle nove persone del team, gli indirizzi email su `traccia.it`.

Sono affermazioni verificabili. Vanno sostituite con dati reali prima della
pubblicazione, altrimenti il sito dichiara cose non vere — ed è esattamente il
tipo di contenuto per cui un servizio di questo settore perde ogni credibilità.

Le affermazioni non verificabili sono già state tolte: il footer non cita più
l'Albo delle Banche né una vigilanza che non esercitiamo, `note-legali.html` §7
dice cosa siamo e cosa non siamo, e gli importi inventati (9,7 Mln €,
38,4 Mln €, 612 perizie, 1840 casi) sono stati sostituiti da un trattino.

Punti da rivedere, in ordine di rischio:

1. **Team** (`chi-siamo.html` e sezione team in home): nomi, ruoli, biografie
2. **Risultati** (`casi.html`): i quattro casi con i loro importi
3. **Recapiti**: `ciao@traccia.it`, `assistenza@traccia.it`, PEC, telefono
   (`tel:+3901100000000` è ancora un segnaposto)
4. **WhatsApp**: `assets/js/config.js` → `whatsapp: ""` nasconde il pulsante;
   mettere il numero reale lo fa comparire ovunque
5. **Onorari**: 190 € + 12% — da allineare al contratto reale
6. **Contratto**: è stato scritto da chi scrive codice, non da un avvocato.
   Va letto da un legale italiano prima che qualcuno lo firmi.
