/* ==========================================================================
   0025 — la notifica di una nuova segnalazione
   ==========================================================================

   Il cliente, il giorno prima di lanciare la campagna: «abbiamo bisogno anche
   di un sistema dove riceve i lead». Le segnalazioni arrivano già in
   `traccia.richieste`, e la console admin le mostra. Ma una segnalazione che
   nessuno guarda non è un lead: è una persona che ha appena perso dei soldi e
   aspetta. Con una campagna accesa, il tempo fra il modulo e la prima chiamata
   è la differenza fra un cliente e un rimbalzo.

   Tre strati, dal più semplice al più completo, e funzionano anche da soli:

   1. **In pagina** (funziona da subito, nessuna configurazione). `admin.html`
      chiede il numero di segnalazioni nuove ogni 60 secondi e mostra una
      notifica del browser se il contatore sale. Serve la console aperta — o
      un telefono con la console in background.

   2. **Webhook** (una configurazione). Se in `traccia.impostazioni` c'è una
      chiave `webhook_lead` con un indirizzo, ogni nuova segnalazione parte
      verso quell'indirizzo come JSON: un bot Telegram, un Canale, una
      automazione. Nessuna dipendenza esterna: si usa `pg_net` se c'è, e se non
      c'è la chiamata resta in coda e non blocca il modulo.

   3. **Posta** (serve un servizio). Senza un servizio di posta configurato non
      si manda un'email da qui, e fingere di mandarla sarebbe peggio che non
      averla: il cliente crederebbe di essere avvisato. Per questo la `0025`
      non contiene un `send_email` finto — contiene il posto dove andrà.

   Perché la notifica non può far fallire il modulo: è tutto dentro un blocco
   `exception when others` che scrive nel registro. Chi ha perso 12.000 € non
   deve vedere «errore» perché il bot Telegram era irraggiungibile.
   ------------------------------------------------------------------------
   COME SI APPLICA
     supabase db push          (oppure: incolla il file in Supabase → SQL)
   Se `create extension pg_net` viene rifiutata per permessi, togli quella
   riga: il resto funziona lo stesso, e le notifiche restano in tabella con
   esito «senza-canale» finché non c'è un canale. Meglio una segnalazione
   salvata e non annunciata di una segnalazione persa.
   ========================================================================== */

-- pg_net: le chiamate HTTP da Postgres. Non è installato qui; se in futuro si
-- attiva, il blocco qui sotto lo usa senza altre modifiche.
create extension if not exists pg_net with schema extensions;

/* --------------------------------------------------------------------------
   La coda delle notifiche
   --------------------------------------------------------------------------
   Una riga per ogni segnalazione che deve essere annunciata. Non si cancella
   dopo l'invio: se un giorno qualcuno chiede «mi avevate avvisato?», la
   risposta sta qui, con l'errore eventuale.
   -------------------------------------------------------------------------- */
create table if not exists traccia.notifiche (
  id          uuid primary key default extensions.gen_random_uuid(),
  kind        text not null,                  -- 'lead' (per ora l'unico)
  target_id   uuid,                           -- la segnalazione
  canale      text not null,                  -- 'webhook' | 'in-pagina' | 'email'
  esito       text not null default 'attesa'
              check (esito in ('attesa', 'inviata', 'fallita', 'senza-canale')),
  dettaglio   text,
  created_at  timestamptz not null default now()
);
create index if not exists notifiche_created_idx on traccia.notifiche (created_at desc);
alter table traccia.notifiche enable row level security;
revoke all on traccia.notifiche from anon, authenticated;

comment on table traccia.notifiche is
  'Una riga per ogni annuncio di una nuova segnalazione: serve a sapere se qualcuno è stato avvisato, e a non annunciare due volte la stessa cosa.';

/* --------------------------------------------------------------------------
   L'indirizzo del webhook, senza metterlo nel codice
   --------------------------------------------------------------------------
   Un bot Telegram si fa in due minuti con @BotFather, e l'indirizzo è
   `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>&text=…`.
   Il token è un segreto: non va nel repository, e non va in chiaro nel
   database. Vive in `vault`, e questa funzione lo legge solo qui dentro
   (security definer): chi chiama non lo vede mai.
   -------------------------------------------------------------------------- */
create or replace function traccia.webhook_lead()
returns text language plpgsql security definer
set search_path = traccia, extensions as $$
declare
  url text;
begin
  select decrypted_secret into url
  from vault.decrypted_secrets
  where name = 'webhook_lead'
  limit 1;
  return nullif(trim(coalesce(url, '')), '');
exception when others then
  /* il vault vuoto non deve far fallire l'inserimento di una segnalazione:
     l'assenza di un canale è una condizione normale, non un errore */
  return null;
end $$;
revoke all on function traccia.webhook_lead() from public, anon, authenticated;

/* --------------------------------------------------------------------------
   L'annuncio vero
   -------------------------------------------------------------------------- */
create or replace function traccia.annuncia_lead(
  p_id uuid, p_nome text, p_email text, p_phone text,
  p_amount numeric, p_situation text, p_origine text
) returns void language plpgsql security definer
set search_path = traccia, extensions as $$
declare
  url     text := traccia.webhook_lead();
  testo   text;
  risposta bigint;
begin
  /* il testo è quello che deve stare in una notifica: chi legge sta
     camminando per strada e deve capire se chiamare adesso */
  testo := format(
    E'Nuova segnalazione dal sito\n' ||
    E'Nome: %s\n' ||
    E'Telefono: %s\n' ||
    E'Email: %s\n' ||
    E'Importo dichiarato: %s EUR\n' ||
    E'Cosa: %s\n' ||
    E'Canale: %s',
    p_nome, p_phone, p_email, to_char(p_amount, 'FM999G999G999D00'),
    coalesce(p_situation, 'non indicato'), p_origine);

  if url is null then
    insert into traccia.notifiche (kind, target_id, canale, esito, dettaglio)
    values ('lead', p_id, 'webhook', 'senza-canale',
            'nessun webhook configurato in vault.secrets (webhook_lead)');
    return;
  end if;

  begin
    select net.http_post(
      url := url,
      body := jsonb_build_object('text', testo),
      headers := '{"Content-Type": "application/json"}'::jsonb
    ) into risposta;

    insert into traccia.notifiche (kind, target_id, canale, esito, dettaglio)
    values ('lead', p_id, 'webhook', 'inviata', 'richiesta ' || risposta);
  exception when others then
    /* l'unica cosa che una notifica non deve mai fare è impedire che il lead
       venga salvato: se il telefono di chi legge è offline, la segnalazione
       resta in tabella e la console la mostra lo stesso */
    insert into traccia.notifiche (kind, target_id, canale, esito, dettaglio)
    values ('lead', p_id, 'webhook', 'fallita', sqlerrm);
  end;
end $$;
revoke all on function traccia.annuncia_lead(uuid, text, text, text, numeric, text, text)
  from public, anon, authenticated;

/* --------------------------------------------------------------------------
   auth_register chiama l'annuncio
   --------------------------------------------------------------------------
   Stessa funzione di prima, con una riga in più in fondo: dopo l'insert e
   dopo l'audit, si annuncia. `auth_register` continua a rispondere al cliente
   quello che rispondeva — se la notifica fallisce, lui non lo sa e non deve
   saperlo.
   -------------------------------------------------------------------------- */
create or replace function traccia.auth_register(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_amount_eur numeric,
  p_situation  text default null,
  p_message    text default null,
  p_origine    text default 'login'
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail   text := lower(trim(coalesce(p_email, '')));
  nome   text := trim(coalesce(p_first_name, ''));
  cognome text := trim(coalesce(p_last_name, ''));
  tel    text := nullif(trim(coalesce(p_phone, '')), '');
  row_id uuid;
begin
  if length(nome) < 2 then
    raise exception 'Inserisci il nome.' using errcode = '22023';
  end if;
  if length(cognome) < 2 then
    raise exception 'Inserisci il cognome.' using errcode = '22023';
  end if;
  if mail = '' or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;
  if tel is null then
    raise exception 'Inserisci un numero di telefono.' using errcode = '22023';
  end if;
  if not traccia.telefono_valido(tel) then
    raise exception 'Il numero di telefono non sembra valido: controlla le cifre.'
      using errcode = '22023';
  end if;
  if p_amount_eur is null or p_amount_eur <= 0 then
    raise exception 'Indica l''importo approssimativo che hai perso.'
      using errcode = '22023';
  end if;
  if p_amount_eur > 100000000 then
    raise exception 'L''importo indicato è troppo alto: controlla le cifre.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from traccia.richieste
    where lower(email) = mail and created_at > now() - interval '1 hour'
  ) then
    raise exception 'Abbiamo già ricevuto una richiesta con questa email: ti ricontattiamo noi. Se hai urgenza, scrivi a assistenza@traccia.it.com.'
      using errcode = '22023';
  end if;

  insert into traccia.richieste
    (first_name, last_name, email, phone, amount_eur, situation, message, origine)
  values
    (nome, cognome, mail, tel, round(p_amount_eur, 2),
     nullif(trim(coalesce(p_situation, '')), ''),
     nullif(trim(coalesce(p_message, '')), ''),
     coalesce(nullif(trim(coalesce(p_origine, '')), ''), 'login'))
  returning id into row_id;

  insert into traccia.audit (actor_email, action, target, note)
  values (mail, 'richiesta', row_id::text, 'Richiesta di informazioni dal sito');

  /* l'annuncio, dentro un guscio: un guasto della notifica non è un guasto
     della segnalazione */
  begin
    perform traccia.annuncia_lead(
      row_id, nome || ' ' || cognome, mail, tel,
      round(p_amount_eur, 2), p_situation,
      coalesce(nullif(trim(coalesce(p_origine, '')), ''), 'login'));
  exception when others then
    insert into traccia.notifiche (kind, target_id, canale, esito, dettaglio)
    values ('lead', row_id, 'webhook', 'fallita', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'richiesta', row_id,
    'message', 'Richiesta ricevuta. Ti ricontattiamo entro 48 ore lavorative al numero che ci hai indicato.'
  );
end $$;

revoke all on function traccia.auth_register(text, text, text, text, numeric, text, text, text) from public;
grant execute on function traccia.auth_register(text, text, text, text, numeric, text, text, text)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   Per la console: quante nuove, e da quando aspetta la più vecchia
   --------------------------------------------------------------------------
   Il contatore da solo dice «3». Non dice «la più vecchia aspetta da due
   giorni», che è la cosa che dovrebbe far alzare il telefono.
   -------------------------------------------------------------------------- */
create or replace function traccia.admin_lead_attesa(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
begin
  return jsonb_build_object(
    'new_count', (select count(*) from traccia.richieste where status = 'new'),
    'piu_vecchia_ore', coalesce((
      select round(extract(epoch from (now() - min(created_at))) / 3600)
      from traccia.richieste where status = 'new'), 0),
    'oggi', (select count(*) from traccia.richieste
             where created_at > now() - interval '24 hours')
  );
end $$;
revoke all on function traccia.admin_lead_attesa(text) from public;
grant execute on function traccia.admin_lead_attesa(text) to anon, authenticated;

create or replace function public.admin_lead_attesa(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_lead_attesa(p_token); $f$;
revoke all on function public.admin_lead_attesa(text) from public;
grant execute on function public.admin_lead_attesa(text) to anon, authenticated;

/* Le notifiche si possono leggere dalla console: «mi è arrivato un lead e non
   ho ricevuto l'avviso» è una domanda a cui serve una risposta. */
create or replace function traccia.admin_notifiche(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
begin
  return jsonb_build_object('notifiche', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'canale', n.canale, 'esito', n.esito,
      'dettaglio', n.dettaglio,
      'created_at', extract(epoch from n.created_at)) order by n.created_at desc)
    from traccia.notifiche n limit 50), '[]'::jsonb));
end $$;
revoke all on function traccia.admin_notifiche(text) from public;
grant execute on function traccia.admin_notifiche(text) to anon, authenticated;

create or replace function public.admin_notifiche(p_token text)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.admin_notifiche(p_token); $f$;
revoke all on function public.admin_notifiche(text) from public;
grant execute on function public.admin_notifiche(text) to anon, authenticated;
