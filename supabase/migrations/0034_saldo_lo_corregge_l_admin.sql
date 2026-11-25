-- ============================================================================
-- 0034 — Il saldo lo corregge l'amministratore, e resta scritto da dove viene
-- ============================================================================
-- Richiesta: «il saldo deve essere modificabile da parte dell'admin».
--
-- Fino a oggi non si poteva, e non per dimenticanza. Il progetto ha una regola
-- scritta in `0015_conto_corrente.sql`:
--
--     «Nessuna funzione deve più fare `update users set balance_eur = ...`.
--      Passando sempre da qui: il movimento c'è sempre, il saldo è sempre la
--      sua somma, e il controllo del segno non si dimentica.»
--
-- Anche `admin_salva_pratica` (la finestra «Modifica» della console) elenca i
-- campi modificabili e **il saldo non c'è**: nome, cognome, telefono, importo
-- segnalato, note. Aggiungerlo lì avrebbe rotto la regola per la porta di
-- servizio: il saldo sarebbe cambiato senza un movimento, e l'estratto conto
-- del cliente avrebbe smesso di tornare.
--
-- Questa funzione apre la strada giusta invece di quella corta. Il saldo si
-- scrive **registrando un movimento di rettifica** (`adjustment`), che il
-- database prevede già dal primo giorno con un commento che sembra scritto per
-- questa richiesta: «correzione con nota obbligatoria».
--
-- Cosa ne segue, e perché è la parte che conta:
--
--   * il saldo resta la somma del libro movimenti, quindi i conti tornano
--     sempre: il commercialista, il cliente e la banca leggono lo stesso
--     numero;
--   * il cliente **vede** la rettifica nel suo estratto conto, con la causale
--     scritta dall'analista. Una correzione invisibile è un saldo che cambia
--     di notte, ed è esattamente ciò di cui un servizio di questo settore non
--     può essere sospettato;
--   * resta nel registro attività con il valore di prima e quello di dopo;
--   * il denaro già impegnato da un prelievo in attesa non si può toccare: se
--     un cliente ha chiesto di prelevare 5.000 €, il saldo non può scendere
--     sotto quei 5.000 €, altrimenti la richiesta diventerebbe impossibile da
--     onorare dopo essere stata accettata.
--
-- Perché serve una motivazione di almeno otto caratteri: la rettifica è
-- l'unica scrittura del sistema che non ha un documento dietro (un bonifico, un
-- contratto, un'operazione approvata). Il testo è l'unica traccia, e «ok» non è
-- una traccia.
-- ============================================================================

create or replace function traccia.admin_rettifica_saldo(
  p_token        text,
  p_id           uuid,
  p_nuovo_saldo  numeric,
  p_motivo       text
) returns jsonb
language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a      traccia.users := traccia.need_admin(p_token);
  t      traccia.users;
  voce   traccia.ledger_entries;
  delta  numeric;
  nuovo  numeric;
  motivo text;
  prima  numeric;
begin
  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;

  -- le stesse due difese di `admin_salva_pratica`: un amministratore non
  -- tocca l'account master, e un account amministratore non è una pratica
  -- cliente con un conto da correggere
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;
  if t.role = 'admin' then
    raise exception 'L''account non è una pratica cliente.' using errcode = '22023';
  end if;

  if p_nuovo_saldo is null then
    raise exception 'Indica il saldo corretto.' using errcode = '22023';
  end if;
  nuovo := round(p_nuovo_saldo, 2);
  if nuovo < 0 then
    raise exception 'Il saldo non può essere negativo.' using errcode = '22023';
  end if;

  motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if motivo is null or length(motivo) < 8 then
    raise exception 'Serve una motivazione: è l''unica traccia di questa correzione.'
      using errcode = '22023';
  end if;

  prima := coalesce(t.balance_eur, 0);
  delta := nuovo - prima;

  if delta = 0 then
    return jsonb_build_object('ok', true, 'changed', false,
                              'balance_after', prima);
  end if;

  -- il denaro impegnato da un prelievo o un acquisto in attesa non è più
  -- disponibile: abbassare il saldo sotto quella soglia renderebbe
  -- impossibile onorare una richiesta già accettata
  if nuovo < coalesce(t.reserved_eur, 0) then
    raise exception
      'Saldo non modificabile: ci sono % impegnati in operazioni in attesa. Il saldo può scendere al massimo fino a quella cifra.',
      traccia.euro(t.reserved_eur)
      using errcode = '22023';
  end if;

  -- l'unico punto in cui il saldo cambia, come dice il 0015
  voce := traccia.registra_movimento(
    t.id, delta, 'adjustment',
    'Rettifica manuale - ' || motivo,
    null, current_date, a.id
  );

  perform traccia.log_action(a, 'saldo_rettifica', t.email,
    traccia.euro(prima) || ' -> ' || traccia.euro(voce.balance_after) ||
    ' | ' || motivo);

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'balance_before', prima,
    'balance_after', voce.balance_after,
    'delta', delta,
    'reference', voce.reference
  );
end $$;

-- ============================================================================
-- Permessi
-- ============================================================================
-- Come tutte le funzioni `admin_*`: `public` non deve poterla chiamare
-- direttamente, e il controllo vero è dentro (`need_admin` sul token).
revoke all on function traccia.admin_rettifica_saldo(text, uuid, numeric, text) from public;
grant execute on function traccia.admin_rettifica_saldo(text, uuid, numeric, text)
  to anon, authenticated;

-- ============================================================================
-- Il wrapper pubblico
-- ============================================================================
-- Il client chiama `public.admin_rettifica_saldo` (è lì che arriva il POST
-- `/rest/v1/rpc/...`, con `p_token` iniettato da `call()` in `api.js`), che
-- delega a `traccia`. Tutte le altre funzioni admin hanno questo doppione:
-- senza, la chiamata risponde 404 e la console mostra un errore che non dice
-- niente di utile.
create or replace function public.admin_rettifica_saldo(
  p_token text, p_id uuid, p_nuovo_saldo numeric, p_motivo text
) returns jsonb
language sql security definer
set search_path = traccia, public, extensions as $$
  select traccia.admin_rettifica_saldo(p_token, p_id, p_nuovo_saldo, p_motivo);
$$;

revoke all on function public.admin_rettifica_saldo(text, uuid, numeric, text) from public;
grant execute on function public.admin_rettifica_saldo(text, uuid, numeric, text)
  to anon, authenticated;
