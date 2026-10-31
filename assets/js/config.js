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

  sessionDays: 30
};
