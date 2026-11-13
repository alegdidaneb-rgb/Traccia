-- ============================================================================
-- 0031 · Le storie dei clienti
-- ============================================================================
-- Il cliente, il 2026-11-12: «we need to add testimonials to the webpage where
-- customers create and tell their story how we helped them».
--
-- Le storie che il sito ha già (`casi.html`) sono scritte dall'ufficio: sono la
-- nostra voce su un caso, con i numeri e le fasi. Questa è un'altra cosa — è la
-- voce di chi ha vissuto la truffa — e le due non vanno mescolate: chi legge
-- deve sapere chi sta parlando.
--
-- Tre decisioni, prese insieme al cliente:
--
--   1. **Solo chi ha una pratica.** Niente modulo pubblico: «storia di un
--      nostro cliente» deve essere vero. La testimonianza si scrive dalla
--      propria area, e solo quando la pratica è arrivata almeno in fase 3
--      (Denunce) — prima non c'è niente da raccontare, e una storia scritta il
--      giorno dopo la segnalazione è un reclamo, non una testimonianza.
--
--   2. **Pubblicazione immediata, ma non di dati personali.** Il cliente ha
--      scelto di non avere una coda di approvazione. Il rischio di quella
--      scelta è concreto e ha un nome: chi scrive può metterci dentro il
--      proprio IBAN, il numero di telefono, l'email, l'importo. Le iniziali non
--      nascondono un IBAN scritto nel testo. Quindi il testo passa se non
--      contiene **nessuna** di queste forme: email, numero di telefono, IBAN,
--      codice fiscale, partita IVA, importi in cifre. Se ne contiene una, la
--      storia resta salvata e visibile al cliente col motivo, e la console la
--      segnala: si sistema in un minuto, e intanto non finisce online.
--
--   3. **Cosa si vede accanto alla storia.** Le iniziali le ricava il database
--      dal nome in archivio, mai dal testo (altrimenti chi scrive «sono Maria
--      Rossi» pubblica il suo nome). La città la scrive il cliente: nel
--      database non esiste una colonna «città» e inventarla vorrebbe dire
--      mostrare un dato che non abbiamo. Il tipo di truffa è un elenco chiuso,
--      lo stesso delle cinque tipologie usate in home. L'importo **no**: un
--      numero accanto a un racconto è una promessa travestita.
--
-- Il consenso è esplicito (`consenso` deve essere vero), revocabile
-- (`ritira`), e la revoca toglie la storia dal sito subito — non la cancella:
-- resta in archivio perché è la traccia di cosa il cliente ci ha autorizzato a
-- pubblicare, e perché revocare non deve far perdere il testo a chi l'ha
-- scritto.
-- ============================================================================

-- --------------------------------------------------------------- la città ---
/* Il cliente la scrive; finisce solo sulla storia, non sull'account. Colonna
   dell'utente perché è un dato anagrafico che serve anche alla console («da
   dove chiama questa persona»), e perché il contratto la chiede. */
alter table traccia.users add column if not exists city text;

-- ---------------------------------------------------------------- tabella ---
create table if not exists traccia.testimonianze (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references traccia.users (id) on delete cascade,
  /* il racconto, come l'ha scritto il cliente */
  testo         text not null,
  /* «broker» | «crypto» | «unlock» | «recovery» | «altro» — le stesse chiavi
     del modulo di segnalazione e delle cinque tipologie in home */
  tipo          text not null default 'altro'
                check (tipo in ('broker', 'crypto', 'unlock', 'recovery', 'altro')),
  /* la città che il cliente ha scelto di dichiarare; null = «non dirla» */
  citta         text,
  /* consenso a pubblicare: senza, la storia resta privata */
  consenso      boolean not null default false,
  /* quando il consenso è stato dato e quando è stato ritirato. Timestamp e non
     booleano da solo: «ha acconsentito il 12 novembre» è la frase che serve se
     un giorno qualcuno chiede conto di quella pubblicazione. */
  consenso_il   timestamptz,
  ritirata_il   timestamptz,
  /* perche una storia non è pubblicabile: null = pubblicabile. Non è uno stato
     di moderazione (non c'è nessuno che approva), è il risultato del controllo
     automatico sui dati personali. */
  blocco        text,
  /* in evidenza in home: lo decide l'ufficio, sono tre posti */
  in_evidenza   boolean not null default false,
  ordine        integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  /* una storia per pratica: due racconti della stessa persona sono due volte
     la stessa cosa, e nella pagina delle storie si vedono come un doppione */
  unique (user_id)
);

create index if not exists testimonianze_pubbliche
  on traccia.testimonianze (created_at desc)
  where consenso and ritirata_il is null and blocco is null;

/* ------------------------------------------------------------------ iniziali --
   «Maria Teresa Lonardi» → «M. L.». Sull'ultima parola e sulla prima: i nomi
   doppi sono la norma in italiano, e «M. T.» per Maria Teresa è più gentile di
   «M.». Se il nome manca, si usano le iniziali dell'email; se manca anche
   quella, la storia non si pubblica con un nome inventato. */
create or replace function traccia.iniziali(p_first text, p_last text, p_name text, p_email text)
returns text language plpgsql immutable
set search_path = traccia, public as $$
declare
  primo text := nullif(btrim(coalesce(p_first, '')), '');
  ultimo text := nullif(btrim(coalesce(p_last, '')), '');
  nome text := nullif(btrim(coalesce(p_name, '')), '');
  resto text;
begin
  if ultimo is null and nome is not null then
    /* l'ultima parola del nome completo è il cognome */
    ultimo := btrim(right(nome, position(' ' in reverse(nome)) - 1));
    if position(' ' in nome) = 0 then
      primo := nome;
      ultimo := null;
    end if;
  end if;
  if primo is null and nome is not null then
    primo := btrim(left(nome, position(' ' in nome || ' ') - 1));
  end if;
  if primo is null then
    primo := nullif(split_part(coalesce(p_email, ''), '@', 1), '');
    if primo is null then return null; end if;
    return upper(left(primo, 1)) || '.';
  end if;
  resto := upper(left(primo, 1)) || '.';
  if ultimo is not null then
    resto := resto || ' ' || upper(left(ultimo, 1)) || '.';
  end if;
  return resto;
end $$;

/* ------------------------------------------------- il controllo sui dati ---
   Restituisce il motivo per cui una storia non si può pubblicare, oppure null.
   È il cuore della scelta «pubblicazione immediata»: invece di far leggere
   tutto a una persona, si rifiuta di pubblicare le poche forme che non possono
   mai stare su un sito pubblico. I pattern sono volutamente larghi: un falso
   positivo costa al cliente una frase da riscrivere, un falso negativo mette
   il suo IBAN su internet.

   Nota su cosa **non** si blocca: le cifre in lettere («quarantamila euro»)
   passano. Non sono un dato personale e non sono un numero verificabile — e
   bloccarle renderebbe impossibile raccontare la propria storia. */
create or replace function traccia.perche_non_pubblicabile(p_testo text)
returns text language plpgsql immutable
set search_path = traccia, public as $$
declare
  t text := coalesce(p_testo, '');
begin
  if btrim(t) = '' then
    return 'Il racconto è vuoto.';
  end if;

  /* email */
  if t ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then
    return 'C''è un indirizzo email. Toglilo: la storia si pubblica senza.';
  end if;

  /* IBAN (IT e esteri) e coordinate: due lettere, due cifre, poi almeno 10
     caratteri alfanumerici. Prima dell'email no: «IT60X...» non è un'email. */
  if t ~* '\m[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}\M' then
    return 'C''è quello che sembra un IBAN. Non pubblichiamo coordinate bancarie.';
  end if;
  if t ~* '\mIT[0-9]{2}[A-Z][A-Z0-9]{10,}\M' then
    return 'C''è quello che sembra un IBAN. Non pubblichiamo coordinate bancarie.';
  end if;

  /* telefono: almeno 8 cifre consecutive, con separatori tollerati. Le date
     («12/11/2026») non arrivano a 8 cifre consecutive. */
  if t ~* '\+?[0-9][0-9 ()/.-]{7,}[0-9]' then
    return 'C''è un numero di telefono. La storia si pubblica senza: il numero
            serve a noi, non a chi legge.';
  end if;

  /* codice fiscale (16 caratteri) */
  if t ~* '\m[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\M' then
    return 'C''è quello che sembra un codice fiscale.';
  end if;
  /* partita IVA (11 cifre). Prima delle regole sugli importi, altrimenti un
     numero di partita IVA finisce nello stesso messaggio di una cifra in euro
     e chi legge non capisce cosa togliere. */
  if t ~* '\m(IT)?[0-9]{11}\M' then
    return 'C''è quello che sembra una partita IVA.';
  end if;

  /* importi in cifre: «12.500 €», «€ 12.500», «12500 euro». Non pubblichiamo
     numeri accanto a un racconto: somigliano a una promessa di recupero. */
  if t ~* '(€|EUR|euro)\s*[0-9]|[0-9][0-9.,]*\s*(€|EUR|euro)' then
    return 'C''è una cifra in euro. Le storie non riportano importi: parla di
            quello che è cambiato, non di quanto.';
  end if;
  if t ~* '\m[0-9]{4,}([.,][0-9]{2})?\M' then
    return 'C''è un numero a quattro cifre o più: se è un importo, toglilo.';
  end if;

  return null;
end $$;

/* ------------------------------------------------------- scrive il cliente ---
   Una sola funzione per scrivere, correggere, ritirare e ripubblicare: quattro
   funzioni sarebbero quattro modi di sbagliare lo stesso consenso. */
create or replace function traccia.salva_testimonianza(
  p_token text,
  p_testo text,
  p_tipo text default 'altro',
  p_citta text default null,
  p_consenso boolean default false,
  p_ritira boolean default false
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u      traccia.users := traccia.need_user(p_token);
  t      traccia.testimonianze;
  /* nomi diversi da quelli delle colonne: `set testo = testo` in plpgsql
     confronta la colonna con se stessa e non aggiorna niente, senza dire
     niente. È il tipo di difetto che si scopre quando un cliente corregge il
     racconto e ritrova quello di prima. */
  nuovo_testo text := btrim(coalesce(p_testo, ''));
  nuovo_tipo  text := coalesce(nullif(btrim(p_tipo), ''), 'altro');
  nuova_citta text := nullif(btrim(coalesce(p_citta, '')), '');
  motivo text;
  prima  boolean;
begin
  if u.role = 'admin' then
    raise exception 'Le storie le scrivono i clienti, non l''ufficio.' using errcode = '22023';
  end if;
  if u.case_ref is null then
    raise exception 'Serve una pratica aperta per raccontare la propria storia.'
      using errcode = '22023';
  end if;

  select * into t from traccia.testimonianze where user_id = u.id;
  prima := t.id is not null;

  /* ritirare il consenso non richiede di aver scritto niente: è un diritto,
     non un'operazione sul testo */
  if p_ritira then
    if not prima then
      return jsonb_build_object('ok', true, 'stato', 'nessuna');
    end if;
    update traccia.testimonianze
       set consenso = false, ritirata_il = now(), in_evidenza = false,
           updated_at = now()
     where user_id = u.id;
    perform traccia.log_action(u, 'storia_ritirata', u.email, null);
    return jsonb_build_object('ok', true, 'stato', 'ritirata');
  end if;

  if length(nuovo_testo) < 80 then
    raise exception 'Il racconto è troppo corto: servono almeno ottanta caratteri, altrimenti non dice niente a chi legge.'
      using errcode = '22023';
  end if;
  if length(nuovo_testo) > 2500 then
    raise exception 'Il racconto è troppo lungo: sopra i 2500 caratteri nessuno lo legge fino in fondo.'
      using errcode = '22023';
  end if;
  if nuovo_tipo not in ('broker', 'crypto', 'unlock', 'recovery', 'altro') then
    raise exception 'Tipo di truffa non riconosciuto.' using errcode = '22023';
  end if;

  /* La fase minima: prima delle denunce non c'è ancora niente da raccontare.
     Non è una limitazione tecnica, è una scelta: «ci hanno aiutato» scritto il
     giorno dopo la segnalazione non è vero, e il sito non lo pubblica. */
  if coalesce(u.case_phase, 1) < 3 then
    raise exception 'Si può raccontare la propria storia dalla fase 3 (Denunce) in poi: prima non c''è ancora niente da dire.'
      using errcode = '22023';
  end if;

  motivo := traccia.perche_non_pubblicabile(nuovo_testo);

  /* il consenso non si dà per scontato: senza `p_consenso` vero la storia si
     salva ma resta privata, e chi la legge in console sa perché */
  if not p_consenso then
    motivo := coalesce(motivo, 'Manca il consenso alla pubblicazione.');
  end if;

  if prima then
    update traccia.testimonianze set
      testo = nuovo_testo,
      tipo = nuovo_tipo,
      citta = nuova_citta,
      consenso = p_consenso,
      consenso_il = case when p_consenso and not consenso then now()
                         when p_consenso then consenso_il else consenso_il end,
      /* ripubblicare dopo una revoca è una nuova revoca al contrario: la data
         del ritiro si azzera, il consenso resta datato */
      ritirata_il = case when p_consenso then null else ritirata_il end,
      blocco = motivo,
      in_evidenza = case when motivo is null then in_evidenza else false end,
      updated_at = now()
    where user_id = u.id;
  else
    insert into traccia.testimonianze
      (user_id, testo, tipo, citta, consenso, consenso_il, blocco)
    values
      (u.id, nuovo_testo, nuovo_tipo, nuova_citta, p_consenso,
       case when p_consenso then now() else null end, motivo);
  end if;

  perform traccia.log_action(u, 'storia_scritta', u.email,
    case when motivo is null then 'pubblicata' else motivo end);

  select * into t from traccia.testimonianze where user_id = u.id;

  return jsonb_build_object(
    'ok', true,
    'stato', case
      when not t.consenso then 'privata'
      when t.blocco is not null then 'da_sistemare'
      else 'pubblicata' end,
    'motivo', t.blocco,
    /* cosa vede il pubblico: glielo si mostra mentre scrive, così sa già come
       apparirà e non si sorprende dopo */
    'firma', traccia.iniziali(u.first_name, u.last_name, u.name, u.email),
    'citta', t.citta,
    'tipo', t.tipo
  );
end $$;

revoke all on function traccia.salva_testimonianza(text, text, text, text, boolean, boolean) from public;
grant execute on function traccia.salva_testimonianza(text, text, text, text, boolean, boolean)
  to anon, authenticated;

/* ------------------------------------------------------ legge il pubblico ---
   `public_storie` è l'unica porta senza sessione. Restituisce solo quello che
   si vede: iniziali, città, tipo, testo, data. Mai l'email, mai l'id utente,
   mai l'importo. L'ordinamento mette prima quelle scelte dall'ufficio per la
   home, poi le più recenti. */
create or replace function traccia.public_storie(p_limite integer default 50)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'testo', s.testo,
      'tipo', s.tipo,
      'citta', s.citta,
      'firma', traccia.iniziali(u.first_name, u.last_name, u.name, u.email),
      'quando', to_char(coalesce(s.consenso_il, s.created_at), 'YYYY-MM-DD')
    ) order by s.in_evidenza desc, s.ordine, coalesce(s.consenso_il, s.created_at) desc), '[]'::jsonb)
  from (
    select * from traccia.testimonianze
     where consenso and ritirata_il is null and blocco is null
     order by in_evidenza desc, ordine, coalesce(consenso_il, created_at) desc
     limit greatest(1, least(200, coalesce(p_limite, 50)))
  ) s
  join traccia.users u on u.id = s.user_id
  where traccia.iniziali(u.first_name, u.last_name, u.name, u.email) is not null;
$$;

revoke all on function traccia.public_storie(integer) from public;
grant execute on function traccia.public_storie(integer) to anon, authenticated;

/* ----------------------------------------------------- la propria storia ---
   Per l'area del cliente: cosa ho scritto, è pubblicata, perché no. */
create or replace function traccia.me_testimonianza(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  u traccia.users := traccia.need_user(p_token);
  t traccia.testimonianze;
begin
  select * into t from traccia.testimonianze where user_id = u.id;
  return jsonb_build_object(
    'testo', t.testo,
    'tipo', t.tipo,
    'citta', t.citta,
    'consenso', coalesce(t.consenso, false),
    'ritirata', t.ritirata_il is not null,
    'blocco', t.blocco,
    'pubblicata', coalesce(t.consenso and t.ritirata_il is null and t.blocco is null, false),
    'scritta_il', case when t.id is null then null
                       else to_char(t.created_at, 'YYYY-MM-DD') end,
    'firma', traccia.iniziali(u.first_name, u.last_name, u.name, u.email),
    'fase', coalesce(u.case_phase, 1),
    /* il modulo si apre dalla fase 3: dirlo prima evita che qualcuno scriva
       duecento parole e poi trovi l'errore al salvataggio */
    'puo_scrivere', u.role <> 'admin' and u.case_ref is not null
                    and coalesce(u.case_phase, 1) >= 3
  );
end $$;

revoke all on function traccia.me_testimonianza(text) from public;
grant execute on function traccia.me_testimonianza(text) to anon, authenticated;

/* ------------------------------------------------------------- la console ---
   L'ufficio non approva (non c'è coda), ma deve sapere: quante storie ci sono,
   quali sono bloccate e perché, e scegliere le tre in evidenza. */
create or replace function traccia.admin_testimonianze(p_token text)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  righe jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'nome', u.name,
      'email', u.email,
      'testo', t.testo,
      'tipo', t.tipo,
      'citta', t.citta,
      'firma', traccia.iniziali(u.first_name, u.last_name, u.name, u.email),
      'consenso', t.consenso,
      'ritirata', t.ritirata_il is not null,
      'blocco', t.blocco,
      'in_evidenza', t.in_evidenza,
      'pubblicata', t.consenso and t.ritirata_il is null and t.blocco is null,
      'quando', to_char(t.created_at, 'YYYY-MM-DD')
    ) order by (t.blocco is not null) desc, t.created_at desc), '[]'::jsonb)
  into righe
  from traccia.testimonianze t join traccia.users u on u.id = t.user_id;

  return jsonb_build_object('storie', righe);
end $$;

revoke all on function traccia.admin_testimonianze(text) from public;
grant execute on function traccia.admin_testimonianze(text) to anon, authenticated;

create or replace function traccia.admin_storia_evidenza(p_token text, p_id uuid, p_accesso boolean)
returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a traccia.users := traccia.need_admin(p_token);
  t traccia.testimonianze;
  quante integer;
begin
  select * into t from traccia.testimonianze where id = p_id;
  if t.id is null then
    raise exception 'Storia non trovata.' using errcode = '22023';
  end if;
  if p_accesso and (not t.consenso or t.ritirata_il is not null or t.blocco is not null) then
    raise exception 'Questa storia non è pubblicabile: non si mette in evidenza.'
      using errcode = '22023';
  end if;
  /* tre posti in home: il quarto non è un errore, è il momento in cui si toglie
     qualcosa — dirlo invece di accettarlo e non mostrarlo */
  select count(*) into quante from traccia.testimonianze
   where in_evidenza and id <> t.id;
  if p_accesso and quante >= 3 then
    raise exception 'In evidenza ce ne sono già tre: togli quella che non serve più.'
      using errcode = '22023';
  end if;
  update traccia.testimonianze set in_evidenza = p_accesso, updated_at = now()
   where id = p_id;
  /* `case` dentro `perform` non è SQL: la scelta va fatta su una variabile */
  perform traccia.log_action(
    a,
    case when p_accesso then 'storia_in_evidenza' else 'storia_tolta' end,
    (select email from traccia.users where id = t.user_id),
    null);
  return jsonb_build_object('ok', true, 'in_evidenza', p_accesso);
end $$;

revoke all on function traccia.admin_storia_evidenza(text, uuid, boolean) from public;
grant execute on function traccia.admin_storia_evidenza(text, uuid, boolean) to anon, authenticated;

/* ------------------------------------------------------- superficie public ---
   Il client chiama `public.*`: stesse firme, un involucro che passa di là. È il
   motivo per cui `tests/banca.test.js` confronta i due elenchi di parametri —
   se divergono, la chiamata dal sito risponde «function not found» mentre dal
   SQL editor funziona, che è il modo più confuso di guastarsi. */
create or replace function public.salva_testimonianza(
  p_token text, p_testo text, p_tipo text default 'altro',
  p_citta text default null, p_consenso boolean default false,
  p_ritira boolean default false
) returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.salva_testimonianza(p_token, p_testo, p_tipo, p_citta, p_consenso, p_ritira);
$$;
revoke all on function public.salva_testimonianza(text, text, text, text, boolean, boolean) from public;
grant execute on function public.salva_testimonianza(text, text, text, text, boolean, boolean)
  to anon, authenticated;

create or replace function public.me_testimonianza(p_token text)
returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.me_testimonianza(p_token);
$$;
revoke all on function public.me_testimonianza(text) from public;
grant execute on function public.me_testimonianza(text) to anon, authenticated;

create or replace function public.public_storie(p_limite integer default 50)
returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.public_storie(p_limite);
$$;
revoke all on function public.public_storie(integer) from public;
grant execute on function public.public_storie(integer) to anon, authenticated;

create or replace function public.admin_testimonianze(p_token text)
returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.admin_testimonianze(p_token);
$$;
revoke all on function public.admin_testimonianze(text) from public;
grant execute on function public.admin_testimonianze(text) to anon, authenticated;

create or replace function public.admin_storia_evidenza(p_token text, p_id uuid, p_accesso boolean)
returns jsonb language sql security definer
set search_path = traccia, public as $$
  select traccia.admin_storia_evidenza(p_token, p_id, p_accesso);
$$;
revoke all on function public.admin_storia_evidenza(text, uuid, boolean) from public;
grant execute on function public.admin_storia_evidenza(text, uuid, boolean) to anon, authenticated;
