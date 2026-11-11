/* Traccia — i lead in CSV, per il foglio Google.
   ------------------------------------------------------------------
   Google Sheets legge un indirizzo che restituisce testo separato da virgole
   con una formula sola — `=IMPORTDATA("…")` — e si aggiorna da sé, senza
   script, senza estensioni e senza che nessuno apra un pannello. Qui dentro
   c'è solo il traduttore JSON → CSV: la lettura è `leads_per_foglio` nel
   database (migrazione 0026_foglio_lead.sql).

   La protezione è il segreto nell'indirizzo (`?k=…`), lo stesso che sta in
   `traccia.settings`, chiave `foglio_segreto`. Chi non ce l'ha non riceve
   righe, e non c'è nessuna sessione da rubare: `IMPORTDATA` non manda header,
   quindi un token non potrebbe nemmeno arrivare.

   Tre cose imparate provando il 2026-11-08, e sono il motivo per cui questo
   file sembra più complicato di quello che fa:

   1. `SUPABASE_ANON_KEY` esiste ancora nei progetti nuovi, accanto a
      `SUPABASE_PUBLISHABLE_KEYS` che è un oggetto JSON `{"default":"…"}`.
      Cercare solo il secondo nome lasciava la funzione senza chiave.
   2. `IMPORTDATA` **non manda header HTTP**. Se l'indirizzo non contiene già
      tutto, il foglio non legge niente.
   3. Il tipo `text/csv` viene rifiutato a monte (un 500 muto, prima del nostro
      codice); `text/plain` no. Il contenuto è CSV identico e `IMPORTDATA`
      guarda il testo, quindi si dichiara `text/plain`.

   Il foglio è uno specchio: si legge e basta. Il lavoro si fa in `admin.html`,
   dove «Prendi» è atomico. Una segnalazione in due posti dove si può scrivere
   diventa due verità, e due verità vogliono dire due telefonate alla stessa
   persona.
*/

function chiavePubblica(): string {
  const diretta = Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (diretta) return diretta;
  const json = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (json) {
    try {
      const mappa = JSON.parse(json);
      const prima = mappa.default || Object.values(mappa)[0];
      if (typeof prima === "string" && prima) return prima;
    } catch (_e) { /* non è JSON: si esce con stringa vuota */ }
  }
  return "";
}

/* Un campo CSV: se contiene virgola, virgolette o a capo va racchiuso, e le
   virgolette interne raddoppiate. Un nome come «Rossi, Maria» senza questo
   sposterebbe tutte le colonne di quella riga. */
function campo(valore: unknown): string {
  const testo = valore === null || valore === undefined ? "" : String(valore);
  if (!/["\n\r,]/.test(testo)) return testo;
  return '"' + testo.replace(/"/g, '""') + '"';
}

/* L'importo col punto decimale e senza separatore delle migliaia: un foglio
   impostato in italiano legge «1.500,00» come testo, e la colonna smette di
   essere una somma. */
function numero(valore: unknown): string {
  const n = Number(valore);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

/* La data in un formato che Sheets riconosce da solo, senza dipendere dalle
   impostazioni locali di chi guarda. */
function data(iso: unknown): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

const INTESTAZIONE = [
  "Arrivata", "Nome", "Telefono", "Email", "Importo perso",
  "Tipo di truffa", "Origine", "Stato", "In carico a", "Note", "ID",
];

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const segreto = url.searchParams.get("k") || "";
    if (!segreto) {
      return new Response("Manca il segreto.", { status: 401 });
    }

    const chiave = chiavePubblica();
    if (!chiave) {
      return new Response("Configurazione mancante.", { status: 503 });
    }

    const risposta = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/leads_per_foglio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: chiave,
          Authorization: `Bearer ${chiave}`,
        },
        body: JSON.stringify({ p_segreto: segreto, p_limite: 1000 }),
      },
    );

    if (!risposta.ok) {
      /* 42501 arriva qui quando il segreto è sbagliato: il messaggio del
         database non si rimanda al foglio, che lo mostrerebbe in una cella */
      return new Response("Non autorizzato.", { status: 401 });
    }

    const dati = await risposta.json();
    const righe: Record<string, unknown>[] = Array.isArray(dati?.righe)
      ? dati.righe
      : [];

    /* `?debug=1` restituisce gli stessi dati in JSON invece del testo: serve a
       distinguere «il database non risponde» da «il foglio non legge», che
       dall'esterno sembrano lo stesso guasto. */
    if (url.searchParams.get("debug") === "1") {
      return new Response(
        JSON.stringify({ righe, ultima: dati?.ultima, quante: righe.length }, null, 2),
        { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }

    const corpo = righe.map((r) =>
      [
        data(r.creata), r.nome, r.telefono, r.email, numero(r.importo),
        r.tipo, r.origine, r.stato, r.in_carico_a, r.note, r.id,
      ].map(campo).join(",")
    );

    /* Il BOM tiene assieme gli accenti: senza, «Lonardi» arriva integro ma
       «città» no, e in un foglio di nomi italiani si vede subito. */
    const testo = "\uFEFF" + [INTESTAZIONE.join(","), ...corpo].join("\r\n");

    return new Response(testo, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (errore) {
    /* Un errore non gestito diventa un 500 muto, e un foglio che non si
       aggiorna non dice perché. Almeno la ragione viaggia. */
    return new Response("Errore: " + String(errore), { status: 500 });
  }
});
