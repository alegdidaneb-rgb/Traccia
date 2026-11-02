/* ==========================================================================
   0017 — la superficie pubblica, scritta una volta per tutte
   ==========================================================================

   Cosa è successo. PostgREST espone solo lo schema `public`. Le funzioni del
   progetto vivono in `traccia`, e per arrivarci serve un wrapper in `public`
   con gli stessi nomi dei parametri. Nel #12 si è scoperto che
   `public.conto` non esisteva: il conto e il pulsante «verifica IBAN»
   rispondevano «function not found» dal sito, mentre dal SQL editor
   funzionavano, perché lì `traccia` è raggiungibile direttamente.

   Quella scoperta era la punta. Confrontando il database vivo con le
   migrazioni: **69 funzioni in `public`, 29 scritte nei file**. Le altre 40
   erano state create a mano, una sessione alla volta. Il sito funzionava, ma
   ricostruire il database da questa cartella avrebbe prodotto un progetto in
   cui login, area riservata e console analisti non esistono.

   Regola che ne esce, e che questo file mette per iscritto: **ogni funzione
   che il client chiama ha un wrapper in `public` scritto in una migrazione**,
   e nessuna funzione interna viene esposta. `tests/banca.test.js` lo verifica
   confrontando `assets/js/api.js` con questa cartella: se qualcuno aggiunge
   una chiamata senza il wrapper, il test diventa rosso.

   Secondo difetto, dello stesso giro: tutto ciò che sta in `public` è
   eseguibile da `anon` per impostazione predefinita di PostgreSQL. Fra questi
   c'erano `hash_token` (calcola l'impronta di un gettone di sessione),
   `holdings_value` (legge il valore del portafoglio di un utente qualsiasi) e
   `set_updated_at` (una funzione di trigger). Qui sotto vengono revocate ad
   `anon` e `authenticated`: restano al loro posto, perché qualcosa potrebbe
   dipenderne, ma non sono raggiungibili dal browser.
   ========================================================================== */

create or replace function public.add_document(p_token text, p_label text, p_kind text DEFAULT 'altro'::text, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.add_document(p_token,p_label,p_kind,p_note); $f$;
revoke all on function public.add_document(p_token text, p_label text, p_kind text, p_note text) from public;
grant execute on function public.add_document(p_token text, p_label text, p_kind text, p_note text) to anon, authenticated;
create or replace function public.add_wallet(p_token text, p_symbol text, p_address text, p_network text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.add_wallet(p_token,p_symbol,p_address,p_network); $f$;
revoke all on function public.add_wallet(p_token text, p_symbol text, p_address text, p_network text) from public;
grant execute on function public.add_wallet(p_token text, p_symbol text, p_address text, p_network text) to anon, authenticated;
create or replace function public.admin_account_action(p_token text, p_id uuid, p_action text, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_account_action(p_token,p_id,p_action,p_note); $f$;
revoke all on function public.admin_account_action(p_token text, p_id uuid, p_action text, p_note text) from public;
grant execute on function public.admin_account_action(p_token text, p_id uuid, p_action text, p_note text) to anon, authenticated;
create or replace function public.admin_accounts(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_accounts(p_token,p_status); $f$;
revoke all on function public.admin_accounts(p_token text, p_status text) from public;
grant execute on function public.admin_accounts(p_token text, p_status text) to anon, authenticated;
create or replace function public.admin_audit(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_audit(p_token); $f$;
revoke all on function public.admin_audit(p_token text) from public;
grant execute on function public.admin_audit(p_token text) to anon, authenticated;
create or replace function public.admin_create_account(p_token text, p_name text, p_email text, p_password text DEFAULT NULL::text, p_role text DEFAULT 'user'::text, p_status text DEFAULT 'active'::text, p_kyc_level integer DEFAULT 1, p_balance_eur numeric DEFAULT 0, p_case_amount_eur numeric DEFAULT 0)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_create_account(p_token,p_name,p_email,p_password,p_role,p_status,p_kyc_level,p_balance_eur,p_case_amount_eur); $f$;
revoke all on function public.admin_create_account(p_token text, p_name text, p_email text, p_password text, p_role text, p_status text, p_kyc_level integer, p_balance_eur numeric, p_case_amount_eur numeric) from public;
grant execute on function public.admin_create_account(p_token text, p_name text, p_email text, p_password text, p_role text, p_status text, p_kyc_level integer, p_balance_eur numeric, p_case_amount_eur numeric) to anon, authenticated;
create or replace function public.admin_document_action(p_token text, p_id uuid, p_action text, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_document_action(p_token,p_id,p_action,p_note); $f$;
revoke all on function public.admin_document_action(p_token text, p_id uuid, p_action text, p_note text) from public;
grant execute on function public.admin_document_action(p_token text, p_id uuid, p_action text, p_note text) to anon, authenticated;
create or replace function public.admin_documents(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_documents(p_token,p_status); $f$;
revoke all on function public.admin_documents(p_token text, p_status text) from public;
grant execute on function public.admin_documents(p_token text, p_status text) to anon, authenticated;
create or replace function public.admin_message_status(p_token text, p_id uuid, p_status text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_message_status(p_token,p_id,p_status); $f$;
revoke all on function public.admin_message_status(p_token text, p_id uuid, p_status text) from public;
grant execute on function public.admin_message_status(p_token text, p_id uuid, p_status text) to anon, authenticated;
create or replace function public.admin_messages(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_messages(p_token,p_status); $f$;
revoke all on function public.admin_messages(p_token text, p_status text) from public;
grant execute on function public.admin_messages(p_token text, p_status text) to anon, authenticated;
create or replace function public.admin_operation_action(p_token text, p_id uuid, p_action text, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_operation_action(p_token,p_id,p_action,p_note); $f$;
revoke all on function public.admin_operation_action(p_token text, p_id uuid, p_action text, p_note text) from public;
grant execute on function public.admin_operation_action(p_token text, p_id uuid, p_action text, p_note text) to anon, authenticated;
create or replace function public.admin_operations(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_operations(p_token,p_status); $f$;
revoke all on function public.admin_operations(p_token text, p_status text) from public;
grant execute on function public.admin_operations(p_token text, p_status text) to anon, authenticated;
/* Questa mancava anche nel database: `api.revokeSessions` la chiamava dal
   #11, e in console il pulsante «chiudi le sessioni» rispondeva «function not
   found». È l'unico caso trovato dal test e non dal confronto con il database
   vivo, perché non esisteva da nessuna delle due parti. */
create or replace function public.admin_revoke_sessions(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_revoke_sessions(p_token,p_id); $f$;
revoke all on function public.admin_revoke_sessions(p_token text, p_id uuid) from public;
grant execute on function public.admin_revoke_sessions(p_token text, p_id uuid) to anon, authenticated;

create or replace function public.admin_overview(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_overview(p_token); $f$;
revoke all on function public.admin_overview(p_token text) from public;
grant execute on function public.admin_overview(p_token text) to anon, authenticated;
create or replace function public.admin_save_settings(p_token text, p_settings jsonb)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_save_settings(p_token,p_settings); $f$;
revoke all on function public.admin_save_settings(p_token text, p_settings jsonb) from public;
grant execute on function public.admin_save_settings(p_token text, p_settings jsonb) to anon, authenticated;
create or replace function public.admin_set_kyc(p_token text, p_id uuid, p_level integer, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_set_kyc(p_token,p_id,p_level,p_note); $f$;
revoke all on function public.admin_set_kyc(p_token text, p_id uuid, p_level integer, p_note text) from public;
grant execute on function public.admin_set_kyc(p_token text, p_id uuid, p_level integer, p_note text) to anon, authenticated;
create or replace function public.admin_set_role(p_token text, p_id uuid, p_role text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_set_role(p_token,p_id,p_role); $f$;
revoke all on function public.admin_set_role(p_token text, p_id uuid, p_role text) from public;
grant execute on function public.admin_set_role(p_token text, p_id uuid, p_role text) to anon, authenticated;
create or replace function public.admin_settings(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_settings(p_token); $f$;
revoke all on function public.admin_settings(p_token text) from public;
grant execute on function public.admin_settings(p_token text) to anon, authenticated;
create or replace function public.admin_view_client(p_token text, p_user_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_view_client(p_token,p_user_id); $f$;
revoke all on function public.admin_view_client(p_token text, p_user_id uuid) from public;
grant execute on function public.admin_view_client(p_token text, p_user_id uuid) to anon, authenticated;
create or replace function public.admin_wallet_action(p_token text, p_id uuid, p_action text, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_wallet_action(p_token,p_id,p_action,p_note); $f$;
revoke all on function public.admin_wallet_action(p_token text, p_id uuid, p_action text, p_note text) from public;
grant execute on function public.admin_wallet_action(p_token text, p_id uuid, p_action text, p_note text) to anon, authenticated;
create or replace function public.admin_wallets(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_wallets(p_token,p_status); $f$;
revoke all on function public.admin_wallets(p_token text, p_status text) from public;
grant execute on function public.admin_wallets(p_token text, p_status text) to anon, authenticated;
create or replace function public.auth_change_password(p_token text, p_current text, p_new text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_change_password(p_token,p_current,p_new); $f$;
revoke all on function public.auth_change_password(p_token text, p_current text, p_new text) from public;
grant execute on function public.auth_change_password(p_token text, p_current text, p_new text) to anon, authenticated;
create or replace function public.auth_login(p_email text, p_password text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_login(p_email,p_password); $f$;
revoke all on function public.auth_login(p_email text, p_password text) from public;
grant execute on function public.auth_login(p_email text, p_password text) to anon, authenticated;
create or replace function public.auth_logout(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_logout(p_token); $f$;
revoke all on function public.auth_logout(p_token text) from public;
grant execute on function public.auth_logout(p_token text) to anon, authenticated;
create or replace function public.auth_me(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_me(p_token); $f$;
revoke all on function public.auth_me(p_token text) from public;
grant execute on function public.auth_me(p_token text) to anon, authenticated;
create or replace function public.auth_register(p_name text, p_email text, p_password text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_register(p_name,p_email,p_password); $f$;
revoke all on function public.auth_register(p_name text, p_email text, p_password text) from public;
grant execute on function public.auth_register(p_name text, p_email text, p_password text) to anon, authenticated;
create or replace function public.cancel_operation(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.cancel_operation(p_token,p_id); $f$;
revoke all on function public.cancel_operation(p_token text, p_id uuid) from public;
grant execute on function public.cancel_operation(p_token text, p_id uuid) to anon, authenticated;
create or replace function public.contact_send(p_name text, p_email text, p_message text, p_phone text DEFAULT NULL::text, p_amount_eur numeric DEFAULT NULL::numeric, p_source text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.contact_send(p_name,p_email,p_message,p_phone,p_amount_eur,p_source); $f$;
revoke all on function public.contact_send(p_name text, p_email text, p_message text, p_phone text, p_amount_eur numeric, p_source text) from public;
grant execute on function public.contact_send(p_name text, p_email text, p_message text, p_phone text, p_amount_eur numeric, p_source text) to anon, authenticated;
create or replace function public.create_operation(p_token text, p_type text, p_symbol text DEFAULT NULL::text, p_amount_eur numeric DEFAULT 0, p_note text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.create_operation(p_token,p_type,p_symbol,p_amount_eur,p_note); $f$;
revoke all on function public.create_operation(p_token text, p_type text, p_symbol text, p_amount_eur numeric, p_note text) from public;
grant execute on function public.create_operation(p_token text, p_type text, p_symbol text, p_amount_eur numeric, p_note text) to anon, authenticated;
-- hash_token: resta al suo posto, ma il browser non deve poterla chiamare
revoke all on function public.hash_token(p_token text) from public, anon, authenticated;
create or replace function public.health()
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.health(); $f$;
revoke all on function public.health() from public;
grant execute on function public.health() to anon, authenticated;
-- holdings_value: resta al suo posto, ma il browser non deve poterla chiamare
revoke all on function public.holdings_value(p_user uuid) from public, anon, authenticated;
create or replace function public.market()
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.market(); $f$;
revoke all on function public.market() from public;
grant execute on function public.market() to anon, authenticated;
create or replace function public.me_dashboard(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.me_dashboard(p_token); $f$;
revoke all on function public.me_dashboard(p_token text) from public;
grant execute on function public.me_dashboard(p_token text) to anon, authenticated;
create or replace function public.my_documents(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.my_documents(p_token); $f$;
revoke all on function public.my_documents(p_token text) from public;
grant execute on function public.my_documents(p_token text) to anon, authenticated;
create or replace function public.my_limits(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.my_limits(p_token); $f$;
revoke all on function public.my_limits(p_token text) from public;
grant execute on function public.my_limits(p_token text) to anon, authenticated;
create or replace function public.my_operations(p_token text, p_status text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.my_operations(p_token,p_status); $f$;
revoke all on function public.my_operations(p_token text, p_status text) from public;
grant execute on function public.my_operations(p_token text, p_status text) to anon, authenticated;
create or replace function public.my_wallets(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.my_wallets(p_token); $f$;
revoke all on function public.my_wallets(p_token text) from public;
grant execute on function public.my_wallets(p_token text) to anon, authenticated;
-- set_updated_at è una funzione di trigger, non un endpoint: fuori dalla portata del browser
revoke all on function public.set_updated_at() from public, anon, authenticated;
-- il "from public" qui è quello che conta: PostgreSQL concede EXECUTE a
-- PUBLIC per impostazione predefinita, e senza revocare quello la revoca ad
-- anon non serve a niente.
create or replace function public.wallet_challenge(p_token text, p_id uuid)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.wallet_challenge(p_token,p_id); $f$;
revoke all on function public.wallet_challenge(p_token text, p_id uuid) from public;
grant execute on function public.wallet_challenge(p_token text, p_id uuid) to anon, authenticated;
create or replace function public.wallet_signature(p_token text, p_id uuid, p_signature text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.wallet_signature(p_token,p_id,p_signature); $f$;
revoke all on function public.wallet_signature(p_token text, p_id uuid, p_signature text) from public;
grant execute on function public.wallet_signature(p_token text, p_id uuid, p_signature text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Come si controlla, senza fidarsi di questo file
-- ---------------------------------------------------------------------------
-- Dal repository: `node tests/run.js` confronta le chiamate di
-- assets/js/api.js con i `create function public.*` di tutte le migrazioni e
-- fallisce se ne manca una. Dal database, invece:
--
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'execute')
--   order by 1;
--
-- Se in quell'elenco compare qualcosa che non è un endpoint, è un wrapper da
-- revocare — non una funzione da nascondere.
