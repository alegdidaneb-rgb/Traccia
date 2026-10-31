# Traccia — pubblicazione su Vercel

Questa cartella contiene **il sito già compilato**, pronto da pubblicare.
`index.html` è in radice, gli asset sono in `assets/`, e `vercel.json` imposta
URL puliti, header di sicurezza e cache lunga per CSS/JS.

## Cosa c'è dentro

- 15 pagine HTML (home, come funziona, casi, cripto, chi siamo, onorari,
  supporto, login, area riservata, console analisti, 404, e le quattro legali)
- `assets/css/style.css` e 9 file JS
- `robots.txt`, `sitemap.xml`, `404.html`
- `vercel.json` con `cleanUrls: true` (quindi `/casi` funziona, oltre a `/casi.html`)

Peso totale: ~490 KB. Nessuna build, nessuna dipendenza: Vercel serve i file così
come sono.

---

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

Per riapplicarle su un progetto nuovo: incolla il contenuto di ciascun file in
SQL Editor (o `supabase db push` con la CLI) e poi crea il primo amministratore
con `traccia.auth_register(...)` seguito da un `update` che imposti
`role = 'admin', is_master = true, status = 'active'`.

Dopo aver cambiato dominio, aggiungi l'origine alle policy CSP in `vercel.json`
(`connect-src ... https://mmjycpdfjlbckeefbtuq.supabase.co`) e, se attivi il
redirect di autenticazione Supabase, imposta il Site URL in
**Authentication → URL Configuration**.

---

## Attenzione prima di andare online per davvero

I numeri e i contenuti dei casi sono **dimostrativi**: 38,4 Mln €, 9,7 Mln €
rientrati, 612 perizie, i quattro casi con i loro importi, i nomi e le
biografie delle nove persone del team, gli indirizzi email su `traccia.it`.

Sono affermazioni verificabili. Vanno sostituite con dati reali prima della
pubblicazione, altrimenti il sito dichiara cose non vere — ed è esattamente il
tipo di contenuto per cui un servizio di questo settore perde ogni credibilità.

Punti da rivedere, in ordine di rischio:

1. **Team** (`chi-siamo.html` e sezione team in home): nomi, ruoli, biografie
2. **Risultati** (`casi.html`, banda numerica in home): importi e conteggi
3. **Dati societari** nel footer: attualmente ERSEL SPA con Albo Banche n. 5573
   e vigilanza Banca d'Italia e CONSOB — da confermare per questa attività
4. **Recapiti**: `ciao@traccia.it`, `assistenza@traccia.it`, PEC, telefono
5. **Onorari**: 190 € + 12% — da allineare al contratto reale
