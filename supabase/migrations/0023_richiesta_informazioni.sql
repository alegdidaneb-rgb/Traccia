/* ==========================================================================
   0023 — richiedere informazioni: nome, cognome, email, telefono, importo
   ==========================================================================

   Cosa cambia e perché.

   Il modulo «Segnala un caso» chiedeva nome e cognome in un campo solo, email
   e una password. Non chiedeva **un telefono** e non chiedeva **quanto è
   andato perso**: due informazioni che servono prima di qualunque altra cosa.
   Il telefono perché una persona che ha appena perso dei soldi non vuole
   aspettare un'email; l'importo perché dice subito se il caso è da analisi
   forense o da denuncia, e perché senza quella cifra il primo colloquio
   comincia con una domanda invece che con una risposta.

   Qui si aggiungono le colonne che il modulo raccoglie. Non si rompe niente
   per gli account che esistono già: tutte le colonne nuove ammettono NULL o
   hanno un valore predefinito.

   Perché nome e cognome separati e non un campo solo: `name` resta la forma
   completa («Mario Rossi») e continua a essere quello che l'area riservata e
   la console analisti mostrano. `first_name` e `last_name` si aggiungono
   accanto, perché un campo solo non dice quale delle due parole è il cognome,
   e in un contratto di incarico quello conta.
   ========================================================================== */

alter table traccia.users
  add column if not exists first_name text,
  add column if not exists last_name  text;

comment on column traccia.users.first_name is
  'Nome, come dichiarato nella richiesta di informazioni. `name` resta la forma completa.';
comment on column traccia.users.last_name is
  'Cognome, come dichiarato nella richiesta di informazioni.';

/* `phone` e `case_amount_eur` esistono già dalla 0001: le uso, non le
   duplico. Qui rendo esplicito a cosa servono. */
comment on column traccia.users.phone is
  'Telefono di contatto fornito nella richiesta di informazioni.';
comment on column traccia.users.case_amount_eur is
  'Importo approssimativo perduto, dichiarato dal cliente. Zero quando non dichiarato.';

/* --------------------------------------------------------------------------
   La forma del telefono, controllata una volta sola qui
   --------------------------------------------------------------------------
   Non è pedanteria: un numero senza prefisso internazionale, scritto da un
   cliente italiano, è raggiungibile solo dall'Italia, e la console analisti
   lo mostra così com'è. Si accettano cifre, spazi, «+», trattini e parentesi
   (come lo si scrive davvero) ma si pretende che le cifre siano almeno otto:
   meno di così non è un numero, è un refuso. Il formato lo normalizza il
   client; qui si rifiuta solo ciò che non può essere un telefono.
   -------------------------------------------------------------------------- */
create or replace function traccia.telefono_valido(p_phone text)
returns boolean language sql immutable as $$
  select p_phone is null
      or p_phone ~ '^[+0-9][0-9 ()-]{5,24}$'
         and length(regexp_replace(p_phone, '\D', '', 'g')) between 8 and 15
$$;
revoke all on function traccia.telefono_valido(text) from public;

/* --------------------------------------------------------------------------
   auth_register: la registrazione chiede i cinque dati
   --------------------------------------------------------------------------
   Cambia la firma, quindi la vecchia funzione a tre parametri va tolta:
   lasciarne due con lo stesso nome e firme diverse è il modo più semplice per
   far chiamare quella sbagliata a chi chiama. I parametri nuovi hanno un
   valore predefinito, così una chiamata vecchia non fallisce con «function
   not found» ma con un messaggio che dice cosa manca.
   -------------------------------------------------------------------------- */
drop function if exists traccia.auth_register(text, text, text);

create or replace function traccia.auth_register(
  p_name text,
  p_email text,
  p_password text,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_amount_eur numeric default null
)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail   text := lower(trim(coalesce(p_email, '')));
  nome   text := trim(coalesce(p_first_name, ''));
  cognome text := trim(coalesce(p_last_name, ''));
  tel    text := nullif(trim(coalesce(p_phone, '')), '');
  completo text;
begin
  /* --- nome e cognome ------------------------------------------------- */
  /* Se chi chiama manda i due campi si usano quelli; se manda solo `p_name`
     (una pagina vecchia, un test) si accetta la forma completa: rifiutare una
     registrazione per un campo che il database può ricavare da solo sarebbe
     un ostacolo inutile davanti a un cliente. */
  if nome = '' or cognome = '' then
    if length(trim(coalesce(p_name, ''))) >= 2 then
      completo := trim(p_name);
      if nome = '' then nome := split_part(completo, ' ', 1); end if;
      if cognome = '' and position(' ' in completo) > 0 then
        cognome := trim(substr(completo, position(' ' in completo) + 1));
      end if;
    end if;
  end if;
  if length(nome) < 1 or length(cognome) < 1 then
    raise exception 'Inserisci nome e cognome.' using errcode = '22023';
  end if;
  completo := coalesce(nullif(trim(coalesce(p_name, '')), ''), nome || ' ' || cognome);

  /* --- email ---------------------------------------------------------- */
  if mail = '' or position('@' in mail) = 0 then
    raise exception 'Inserisci un indirizzo email valido.' using errcode = '22023';
  end if;

  /* --- password ------------------------------------------------------- */
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'La password deve avere almeno 8 caratteri.' using errcode = '22023';
  end if;

  /* --- telefono e importo --------------------------------------------- */
  /* Servono entrambi: è la richiesta del committente, e sono anche i due dati
     che rendono utile la telefonata. Il messaggio dice quale manca, uno alla
     volta, invece di un generico «compila i campi». */
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

  if exists (select 1 from traccia.users where lower(email) = mail) then
    raise exception 'Esiste già un account con questa email.' using errcode = '23505';
  end if;

  insert into traccia.users (
    email, password_hash, name, first_name, last_name, phone,
    case_amount_eur, role, status, kyc_level, iban
  ) values (
    mail, crypt(p_password, gen_salt('bf', 10)), completo, nome, cognome, tel,
    round(p_amount_eur, 2), 'user', 'pending', 1, traccia.make_iban()
  );

  insert into traccia.audit (actor_email, action, target, note)
  values (mail, 'register', mail, 'Richiesta di informazioni');

  return jsonb_build_object(
    'ok', true,
    'message', 'Richiesta inviata: ti ricontattiamo entro 48 ore lavorative.'
  );
end $$;

revoke all on function traccia.auth_register(text, text, text, text, text, text, numeric) from public;
grant execute on function traccia.auth_register(text, text, text, text, text, text, numeric)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   Il wrapper in public: senza questo il browser non arriva alla funzione
   --------------------------------------------------------------------------
   PostgREST espone solo lo schema `public`. Lo scrive la 0017 e lo ricorda
   `tests/banca.test.js`: una funzione in `traccia` senza gemella in `public`
   risponde «function not found» dal sito e funziona dal SQL editor, che è il
   modo più confuso di guastarsi.
   -------------------------------------------------------------------------- */
drop function if exists public.auth_register(text, text, text);

create or replace function public.auth_register(
  p_name text,
  p_email text,
  p_password text,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_amount_eur numeric default null
)
returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.auth_register(
         p_name, p_email, p_password, p_first_name, p_last_name, p_phone, p_amount_eur
       ); $f$;
revoke all on function public.auth_register(text, text, text, text, text, text, numeric) from public;
grant execute on function public.auth_register(text, text, text, text, text, text, numeric)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   La console analisti deve poterli leggere
   --------------------------------------------------------------------------
   `admin_accounts` costruisce a mano il JSON di ogni riga: una colonna che
   non compare lì è una colonna che l'analista non vede, anche se è nel
   database. Telefono e importo dichiarato servono per richiamare il cliente,
   quindi entrano nel payload.

   Il resto del corpo è copiato dalla 0015 **senza toccarlo**, comprese le
   date in `extract(epoch …)` e i campi `iban_formatted`, `case_ref`,
   `contract_status`: riscriverla «pulita» avrebbe cambiato il formato delle
   date e svuotato colonne della tabella, e la console si sarebbe rotta in un
   modo che nei test del database non si vede.
   -------------------------------------------------------------------------- */
create or replace function traccia.admin_accounts(p_token text, p_status text default null)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', u.name, 'role', u.role,
      'is_master', u.is_master, 'status', u.status, 'kyc_level', u.kyc_level,
      'balance_eur', u.balance_eur,
      'reserved_eur', u.reserved_eur,
      'available_eur', u.balance_eur - u.reserved_eur,
      'holdings_value', traccia.holdings_value(u.id),
      'iban', u.iban, 'iban_holder', u.iban_holder,
      'iban_verified', u.iban_verified_at is not null,
      'iban_formatted', regexp_replace(coalesce(u.iban,''), '(.{4})', '\1 ', 'g'),
      'case_ref', u.case_ref, 'case_phase', u.case_phase,
      'phone', u.phone,
      'first_name', u.first_name, 'last_name', u.last_name,
      'case_amount_eur', u.case_amount_eur,
      'operations_count', (select count(*) from traccia.operations o where o.user_id = u.id),
      'documents_count', (select count(*) from traccia.documents d where d.user_id = u.id),
      'contract_number', (select c.number from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'contract_status', (select c.status from traccia.contracts c
                          where c.user_id = u.id and c.status <> 'superseded'
                          order by c.generated_at desc limit 1),
      'created_at', extract(epoch from u.created_at),
      'last_login_at', extract(epoch from u.last_login_at)
    ) order by u.created_at desc), '[]'::jsonb)
  into res
  from traccia.users u
  where p_status is null or u.status = p_status;
  return jsonb_build_object('accounts', res);
end $$;
revoke all on function traccia.admin_accounts(text, text) from public;
grant execute on function traccia.admin_accounts(text, text) to anon, authenticated;

/* --------------------------------------------------------------------------
   contact_send: anche il modulo pubblico chiede telefono e importo
   --------------------------------------------------------------------------
   Prima il telefono era facoltativo e l'importo pure: due dati che servono per
   richiamare il cliente finivano nel database vuoti, e l'analista doveva
   chiederli al primo contatto. Ora sono obbligatori, con gli stessi controlli
   della registrazione — un solo posto in cui la regola è scritta: nel database.
   -------------------------------------------------------------------------- */
create or replace function traccia.contact_send(
  p_name text, p_email text, p_message text,
  p_phone text default null, p_amount_eur numeric default null, p_source text default null
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  mail text := lower(trim(coalesce(p_email, '')));
  msg  text := nullif(trim(coalesce(p_message, '')), '');
  tel  text := nullif(trim(coalesce(p_phone, '')), '');
  row_id uuid;
  recent int;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Inserisci nome e cognome.' using errcode = '22023';
  end if;
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
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
  if msg is null then
    raise exception 'Racconta in due righe cosa è successo.' using errcode = '22023';
  end if;

  /* semplice freno anti-abuso: max 3 invii per email ogni ora */
  select count(*) into recent from traccia.contact_messages
  where email = mail and created_at > now() - interval '1 hour';
  if recent >= 3 then
    raise exception 'Hai già inviato più richieste. Ti risponderemo a breve.'
      using errcode = '22023';
  end if;

  insert into traccia.contact_messages (name, email, phone, amount_eur, message, source)
  values (trim(p_name), mail, tel, round(p_amount_eur, 2), msg,
          coalesce(nullif(trim(p_source), ''), 'supporto'))
  returning id into row_id;

  return jsonb_build_object('ok', true, 'id', row_id,
    'message', 'Richiesta ricevuta. Ti ricontattiamo entro un giorno lavorativo.');
end $$;
revoke all on function traccia.contact_send(text, text, text, text, numeric, text) from public;
grant execute on function traccia.contact_send(text, text, text, text, numeric, text)
  to anon, authenticated;

/* --------------------------------------------------------------------------
   Il wrapper public di contact_send: stessa firma
   --------------------------------------------------------------------------
   `tests/banca.test.js` confronta gli elenchi dei parametri fra i due schemi:
   se uno diverge, la chiamata dal sito risponde «function not found» e la
   funzione dal SQL editor funziona, che è il modo più confuso di guastarsi.
   -------------------------------------------------------------------------- */
create or replace function public.contact_send(
  p_name text, p_email text, p_message text,
  p_phone text default null, p_amount_eur numeric default null, p_source text default null
) returns jsonb language sql security definer set search_path = traccia, extensions
as $f$ select traccia.contact_send(p_name, p_email, p_message, p_phone, p_amount_eur, p_source); $f$;
revoke all on function public.contact_send(text, text, text, text, numeric, text) from public;
grant execute on function public.contact_send(text, text, text, text, numeric, text)
  to anon, authenticated;
