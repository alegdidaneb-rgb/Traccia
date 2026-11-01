/* ==========================================================================
   Traccia — configurazione client.
   Entrambe le chiavi qui sotto sono fatte per stare nel browser: non danno
   alcun accesso diretto ai dati. Le tabelle hanno RLS attiva e nessun
   permesso per anon/authenticated; si passa solo dalle funzioni RPC, che
   richiedono un token di sessione valido. La chiave di servizio
   (`service_role` / `sb_secret_…`) NON va mai messa in questo file.
   ========================================================================== */
window.TRACCIA_CONFIG = {
  supabaseUrl: "https://mmjycpdfjlbckeefbtuq.supabase.co",

  // chiave pubblicabile (formato nuovo)
  supabaseKey: "sb_publishable_SFs7ps_VEw5pcFuH5NksRw_WDWh4k4L",

  // chiave anon storica: usata come riserva se il gateway rifiuta la nuova
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tanljcGRmamxiY2tlZWZidHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzODMzNTQsImV4cCI6MjEwODk1OTM1NH0.KUEnvUGi2wsCHQh79BkcfZglqzMez57o2N58dSESWlI",

  sessionDays: 30,

  /* Documenti: il file va su Supabase Storage, nella cartella del cliente.
     Il limite è ripetuto nel database (10 MB, solo PDF/JPG/PNG): qui serve
     solo per fermare il caricamento prima di consumare banda. */
  storageBucket: "documenti",
  uploadMaxBytes: 10 * 1024 * 1024,
  uploadMime: ["application/pdf", "image/jpeg", "image/png"],

  /* Numero WhatsApp dell'assistenza, in formato internazionale senza spazi
     né "+" (es. 393331234567). Lascialo vuoto per nascondere ovunque il
     pulsante: nessun collegamento rotto finché il numero non è attivo. */
  whatsapp: "",

  /* Messaggio già scritto nella chat. `{pratica}` viene sostituito con il
     codice della pratica quando il cliente ha una sessione aperta. */
  whatsappText: "Buongiorno, vi scrivo dalla mia area riservata Traccia. Pratica {pratica}."
};
