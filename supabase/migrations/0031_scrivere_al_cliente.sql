-- ============================================================================
-- 0031 — Scrivere a un cliente, dalla console
-- ============================================================================
-- Il vuoto che questa migrazione chiude è quello che il cliente ha descritto
-- dal lato opposto: «dal master si deve poter mandare ogni tipo di messaggio
-- nell'account del cliente, e lì deve esserci una campanella in alto a destra».
--
-- La tabella degli avvisi esiste da 0011, e la campanella era già scritta in
-- `case.js`. Due cose mancavano:
--   1. il markup della campanella in `app.html` — per questo la logica girava
--      a vuoto e nessuno ha mai visto un avviso (lo aggiunge questa sessione
--      nel lato pagina, non qui);
--   2. **il modo di scrivere un avviso a mano**. Fino a ieri gli avvisi
--      nascevano solo da eventi: cambio di fase, documento valutato. Un
--      operatore che voleva dire «manca il documento, ricaricalo» non aveva
--      nessun posto dove scriverlo.
--
-- Contenuto:
--   1. il tipo `messaggio` fra i `kind` ammessi: distinguere «lo dice il
--      sistema» da «te l'ha scritto una persona» è la differenza fra un avviso
--      e una comunicazione, e il cliente la vede;
--   2. `admin_invia_avviso` — a una pratica sola;
--   3. `admin_invia_avviso_a_tutti` — a tutte le pratiche attive, con un tetto
--      e un resoconto di quante ne sono partite;
--   4. il registro attività: chi ha scritto, a chi, e l'inizio del testo.
-- ============================================================================

begin;

-- ------------------------------------------------------- il tipo nuovo -----
/* Il vincolo si sostituisce, non si aggiunge: `check (kind in (…))` senza nome
   genererebbe un secondo vincolo accanto al primo, e il primo continuerebbe a
   rifiutare `messaggio`. Si toglie quello vecchio per nome — che Postgres ha
   dato da solo — e se ne mette uno nuovo con un nome suo, così la prossima
   volta si sa cosa togliere senza indovinare. */
do $$
declare
  v record;
begin
  for v in
    select conname
      from pg_constraint
     where conrelid = 'traccia.notifications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table traccia.notifications drop constraint %I', v.conname);
  end loop;
end $$;

alter table traccia.notifications
  add constraint notifications_kind_check
  check (kind in ('phase', 'document', 'operation', 'contract', 'system', 'messaggio'));

comment on column traccia.notifications.kind is
  'Da dove nasce l''avviso. «messaggio» è scritto a mano da un operatore: è '
  'l''unico che il cliente deve leggere come una persona che gli parla.';

-- --------------------------------------------------------- a una pratica ---
/* Perché due funzioni e non una con `p_id` nullabile: «a uno» e «a tutti»
   sono due gesti diversi, con due conferme diverse nella console. Una
   funzione sola con un parametro opzionale invita a chiamarla con `null` per
   sbaglio, e a mandare un messaggio a tutti credendo di mandarlo a uno. */
create or replace function traccia.admin_invia_avviso(
  p_token text, p_id uuid, p_titolo text, p_testo text, p_kind text default 'messaggio'
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a       traccia.users := traccia.need_admin(p_token);
  t       traccia.users;
  titolo  text := nullif(trim(coalesce(p_titolo, '')), '');
  testo   text := nullif(trim(coalesce(p_testo, '')), '');
  tipo    text := coalesce(nullif(trim(p_kind), ''), 'messaggio');
  nuovo   uuid;
begin
  if titolo is null then
    raise exception 'Serve un titolo: è la riga che il cliente legge nella campanella.'
      using errcode = '22023';
  end if;
  /* Un tetto, non un limite di gusto: `title` è ciò che si vede nell'elenco
     senza aprire niente, e oltre una certa lunghezza viene tagliato dal CSS —
     quindi va tagliato qui, dove si può ancora dire all'operatore di
     accorciarlo. */
  if length(titolo) > 120 then
    raise exception 'Titolo troppo lungo (% caratteri, massimo 120).', length(titolo)
      using errcode = '22023';
  end if;
  if testo is null then
    raise exception 'Serve un testo: un avviso vuoto apre una campanella per niente.'
      using errcode = '22023';
  end if;
  if length(testo) > 4000 then
    raise exception 'Testo troppo lungo (% caratteri, massimo 4000).', length(testo)
      using errcode = '22023';
  end if;

  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Pratica non trovata.' using errcode = 'P0002';
  end if;
  /* A un master non si manda un avviso «cliente»: non ha una pratica e non ha
     una campanella. Dirlo è meglio che scrivere una riga che nessuno vedrà. */
  if t.is_master then
    raise exception 'L''account master non ha una pratica: non c''è una campanella da avvisare.'
      using errcode = '22023';
  end if;

  insert into traccia.notifications (user_id, kind, title, body)
  values (t.id, tipo, titolo, testo)
  returning id into nuovo;

  /* Nel registro va **chi** ha scritto e **a chi**, più l'inizio del testo: il
     registro serve a ricostruire cosa è stato detto a un cliente, e «avviso
     inviato» senza il testo non ricostruisce niente. Il testo intero no — il
     registro si legge, e un messaggio lungo lo rende illeggibile: si tiene la
     prima parte, che basta a riconoscerlo. */
  perform traccia.log_action(a, 'avviso_inviato', t.email,
    left(titolo, 80) || case when t.status <> 'active'
      then ' · pratica ' || t.status else '' end ||
    case when length(testo) > 120 then ' · ' || left(testo, 120) || '…'
         else ' · ' || testo end);

  return jsonb_build_object(
    'ok', true,
    'id', nuovo,
    'user_id', t.id,
    'email', t.email,
    'kind', tipo,
    'inviato', true);
end $$;

revoke all on function traccia.admin_invia_avviso(text, uuid, text, text, text) from public;
grant execute on function traccia.admin_invia_avviso(text, uuid, text, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------- a tutte -------
/* «A tutti» è un gesto che non si annulla: una volta partito, cento clienti
   hanno una campanella accesa. Per questo:
   - si manda solo alle pratiche **attive**, non a chi è in attesa, sospeso o
     rifiutato: a un cliente sospeso una comunicazione dell'ufficio non serve,
     e a uno in attesa ricorda che non è ancora stato preso in carico;
   - il tetto è esplicito (`p_max`), e la funzione dice quante ne ha saltate
     invece di troncare in silenzio;
   - il resoconto torna indietro, così la console può dire «partito a 37
     pratiche» invece di «fatto».
   Il master è escluso per la stessa ragione della funzione sopra. */
create or replace function traccia.admin_invia_avviso_a_tutti(
  p_token text, p_titolo text, p_testo text, p_kind text default 'messaggio',
  p_max int default 500
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a        traccia.users := traccia.need_admin(p_token);
  titolo   text := nullif(trim(coalesce(p_titolo, '')), '');
  testo    text := nullif(trim(coalesce(p_testo, '')), '');
  tipo     text := coalesce(nullif(trim(p_kind), ''), 'messaggio');
  quante   int := 0;
  escluse  int := 0;
  tetto    int := greatest(1, least(coalesce(p_max, 500), 5000));
begin
  if titolo is null then
    raise exception 'Serve un titolo.' using errcode = '22023';
  end if;
  if length(titolo) > 120 then
    raise exception 'Titolo troppo lungo (% caratteri, massimo 120).', length(titolo)
      using errcode = '22023';
  end if;
  if testo is null then
    raise exception 'Serve un testo.' using errcode = '22023';
  end if;
  if length(testo) > 4000 then
    raise exception 'Testo troppo lungo (% caratteri, massimo 4000).', length(testo)
      using errcode = '22023';
  end if;

  /* il conteggio di chi resta fuori, prima di scegliere: serve a dire la
     verità nel resoconto */
  select count(*) into escluse
    from traccia.users
   where not is_master and status <> 'active';

  with destinatari as (
    select id from traccia.users
     where not is_master
       and status = 'active'
     order by created_at
     limit tetto
  ), inserite as (
    insert into traccia.notifications (user_id, kind, title, body)
    select d.id, tipo, titolo, testo from destinatari d
    returning 1
  )
  select count(*) into quante from inserite;

  perform traccia.log_action(a, 'avviso_a_tutti', null,
    quante || ' pratiche · ' || left(titolo, 80) ||
    case when length(testo) > 120 then ' · ' || left(testo, 120) || '…'
         else ' · ' || testo end);

  return jsonb_build_object(
    'ok', true,
    'inviate', quante,
    'escluse', escluse,
    'tetto', tetto,
    'kind', tipo);
end $$;

revoke all on function traccia.admin_invia_avviso_a_tutti(text, text, text, text, int) from public;
grant execute on function traccia.admin_invia_avviso_a_tutti(text, text, text, text, int)
  to anon, authenticated;

-- ------------------------------------------------------ superficie pubblica -
-- Il client parla solo con `public.*`: senza questi due wrapper la funzione
-- esiste ma il browser non la trova.
create or replace function public.admin_invia_avviso(
  p_token text, p_id uuid, p_titolo text, p_testo text, p_kind text default 'messaggio'
) returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_invia_avviso(p_token, p_id, p_titolo, p_testo, p_kind);
$f$;
revoke all on function public.admin_invia_avviso(text, uuid, text, text, text) from public;
grant execute on function public.admin_invia_avviso(text, uuid, text, text, text)
  to anon, authenticated;

create or replace function public.admin_invia_avviso_a_tutti(
  p_token text, p_titolo text, p_testo text, p_kind text default 'messaggio',
  p_max int default 500
) returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_invia_avviso_a_tutti(p_token, p_titolo, p_testo, p_kind, p_max);
$f$;
revoke all on function public.admin_invia_avviso_a_tutti(text, text, text, text, int) from public;
grant execute on function public.admin_invia_avviso_a_tutti(text, text, text, text, int)
  to anon, authenticated;

commit;
