# I lead: come arrivano, dove si vedono, come avvisano

Tre cose, e servono tutte e tre. Se manca la terza, le prime due non servono a
niente: un lead che nessuno sa di aver ricevuto è una persona che aspetta.

---

## 1. Dove finiscono

Chi compila **«Segnala un caso»** — in italiano, inglese, tedesco o spagnolo —
scrive in una tabella del database, `traccia.richieste`. Non crea un account:
l'account nasce dopo, quando un analista ha parlato con la persona.

I cinque dati che il modulo chiede, e che finiscono in tabella:

| Campo | Perché |
|---|---|
| nome e cognome | il contratto di incarico li vuole distinti |
| email | dove arriva la risposta |
| telefono | chi ha appena perso dei soldi non aspetta un'email: si chiama |
| importo approssimativo | dice subito di che ordine di grandezza si parla |
| tipo di truffa | dice all'analista quale parte dell'ufficio aprire |

---

## 2. Dove si vedono

**`admin.html` → «Segnalazioni dal sito»** (prima voce della barra laterale).

La tabella è ordinata da chi aspetta di più. La **prima colonna è l'attesa**, non
il nome: il dato che cambia la giornata è da quanto tempo quella persona è in
coda.

| Colore | Cosa vuol dire |
|---|---|
| nessuno | arrivata da meno di 24 ore: si chiama oggi |
| ambra | da più di 24 ore |
| rosso | **oltre 48 ore**: si sta perdendo. La persona ha già cercato qualcun altro |

Da ogni riga:

- **Chiama** — apre il telefono con il numero già composto;
- **Contattata** — sposta la riga fuori dalla coda «Da chiamare»;
- **Apri pratica** — crea l'account: la password la sceglie il cliente al primo
  accesso, quindi non c'è niente da comunicargli;
- **Non nostra** — archivia, senza mandare messaggi da solo;
- **Chiudi** — quando la pratica è avviata o la persona non si è più fatta viva.

Il filtro in alto parte su **«Da chiamare»**: le altre schede sono per quando
qualcuno chiede «che fine ha fatto quello di ieri?».

---

## 3. Come avvisano

Tre strati. Funzionano anche da soli, e ognuno copre quello che il precedente
non copre.

### a. La tessera in cima alla console

`admin.html` chiede ogni **60 secondi** quante segnalazioni nuove ci sono, e
scrive il numero nella tessera «Da chiamare (dal sito)». Se il numero sale
mentre la console è aperta, compare una **notifica del browser** (la prima volta
il browser chiede il permesso).

Copre: il caso normale, con la console aperta su un telefono o sul computer
dell'ufficio.

**Non copre:** la console chiusa. Ed è il caso che conta di più, perché una
campagna porta lead di notte e nel fine settimana.

### b. Il webhook (il modo giusto per non perdere niente)

Un messaggio su Telegram ogni volta che arriva una segnalazione. Si configura in
cinque minuti e non richiede nessun servizio a pagamento.

1. Apri Telegram, cerca **@BotFather**, scrivi `/newbot`, scegli un nome. Ti
   risponde con un **token**, una stringa tipo
   `123456789:AAH...` — quello è un segreto: non incollarlo nel repository.
2. Scrivi qualcosa al tuo bot nuovo (serve perché Telegram conosca la chat),
   poi apri `https://api.telegram.org/bot<TOKEN>/getUpdates` e leggi il
   `"chat":{"id":…}`: è il tuo **chat_id**.
3. Apri **Supabase → SQL Editor** e incolla:

```sql
select vault.create_secret(
  'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=nuova%20segnalazione',
  'webhook_lead'
);
```

   Nota: il testo del messaggio lo costruisce la funzione `annuncia_lead`; se il
   tuo bot vuole `sendMessage` con il corpo JSON, va bene lo stesso — il
   parametro `text=…` qui serve solo a far accettare l'indirizzo a Telegram.

4. Applica la migrazione `supabase/migrations/0025_notifica_lead.sql`
   (`supabase db push`, oppure incolla il file nell'SQL Editor).

Da quel momento ogni segnalazione manda un messaggio con nome, telefono, email,
importo, tipo di truffa e canale. E ogni invio resta scritto in
`traccia.notifiche`, con l'esito: se un giorno qualcuno chiede «mi avevate
avvisato?», la risposta sta lì.

**Se il bot non risponde:** guarda `admin_notifiche` (o la tabella
`traccia.notifiche`): l'esito è `fallita` con il motivo, oppure `senza-canale`
se il segreto non è stato letto.

### c. La posta (serve un servizio)

Non c'è. Non perché sia difficile, ma perché senza un servizio di posta
configurato — Resend, Postmark, SendGrid — un'email «inviata» sarebbe una bugia,
e la bugia che costa di più è quella che ti fa credere di essere avvisato. Il
posto dove andrà è segnato nella migrazione.

---

---

## Il foglio Google

C'è un foglio — **«Traccia — segnalazioni dal sito»** — che si popola da solo:
ogni segnalazione che arriva compare in una riga, con nome, telefono, email,
importo, tipo di truffa, origine, stato e chi l'ha in carico.

**Come è fatto**, perché conta saperlo prima di romperlo: la scheda
`Segnalazioni` ha **una sola formula** in `A1`:

```
=IMPORTDATA("https://mmjycpdfjlbckeefbtuq.supabase.co/functions/v1/leads-csv?k=…")
```

`IMPORTDATA` chiama l'Edge Function `leads-csv`, che chiede le righe a
`traccia.leads_per_foglio` e le restituisce in CSV. Non c'è nessuno script da
incollare, nessuna estensione da installare, e niente da riavviare: premendo
`Ctrl+Shift+F5` il foglio rilegge.

### Il foglio è uno specchio, non una scrivania

Non si lavorano i lead dal foglio, e non è una limitazione tecnica: è la scelta.
Una segnalazione in due posti dove si può scrivere diventa **due verità** —
Marco la prende in console, Sara guarda il foglio (che non sa niente della presa
in carico) e chiama. Il cliente riceve due telefonate e capisce che nessuno sa
chi lo segue. Con due lead al giorno non succede; con cento è esattamente così
che si perde la fiducia di chi ha già perso dei soldi.

Il lavoro si fa in `admin.html`, dove «Prendi» blocca la riga. Il foglio serve a
far vedere cosa sta arrivando — a te, al cliente, a chi non ha una password per
la console.

### Se il foglio non si aggiorna

| Cosa vedi | Cosa vuol dire | Cosa fare |
|---|---|---|
| `#REF! (Please use a desktop web browser…)` | Google chiede il permesso per una fonte esterna, la prima volta | apri il foglio da un computer, concedi l'accesso, ricarica con `Ctrl+Shift+F5` |
| intestazione e nessuna riga | non ci sono segnalazioni dopo l'ultima lettura | niente: la console le mostra lo stesso |
| «Non autorizzato.» | il segreto non è più quello nel database | vedi sotto |
| «Configurazione mancante.» | all'Edge Function manca la chiave pubblicabile | è un guasto del progetto Supabase, non del foglio |

Per capire **dove** si è fermato, apri l'indirizzo con `&debug=1` in fondo:
restituisce gli stessi dati in JSON. Se risponde JSON e il foglio è vuoto, il
problema è il foglio; se non risponde, è il database.

### Il segreto

Nell'indirizzo c'è una chiave: chi ce l'ha legge i contatti. Non va incollata in
un messaggio, in un annuncio, in una pagina. Sta in `traccia.settings`, chiave
`foglio_segreto`, si legge così:

```sql
select value #>> '{}' from traccia.settings where key = 'foglio_segreto';
```

Per cambiarlo: si scrive il nuovo valore in quella riga **e** si aggiorna la
formula nel foglio — le due cose insieme, altrimenti il foglio smette di
leggere.

## Cosa guardare quando la campagna è accesa

| Numero | Dove | Cosa vuol dire |
|---|---|---|
| segnalazioni oggi | tessera «Da chiamare» | se resta a zero per due giorni con la campagna accesa, il problema è il pubblico o il testo |
| attesa della più vecchia | `admin_lead_attesa` | sopra le 48 ore hai un problema di personale, non di pubblicità |
| clic senza segnalazioni | Meta, non qui | molti clic e zero segnalazioni: l'annuncio promette la cosa sbagliata |

Un conto semplice, per decidere se continuare: se una segnalazione costa meno
dei 190 € della perizia, la campagna si ripaga anche quando il caso poi non
prosegue. Se costa di più, o si alza la conversione del modulo, o si cambia
pubblico.
