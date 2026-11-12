-- ============================================================================
-- 0030 — Correggere i dati di una pratica, dalla console
-- ============================================================================
-- Il vuoto che questa migrazione chiude non si vede: è un'assenza. In console
-- si può cambiare la fase (`admin_set_phase`), il livello di verifica
-- (`admin_set_kyc`) e il ruolo (`admin_set_role`), ma **non** il nome, il
-- telefono, l'importo segnalato o la nota di una pratica. Se un cliente scrive
-- «Marco Rosi» invece di «Marco Rossi», o dichiara diecimila euro invece di
-- centomila, l'unico modo era il SQL a mano fuori dal sito.
--
-- Il sintomo si vede anche nei dati: `first_name` e `last_name` sono vuoti su
-- tutte le pratiche. Non perché nessuno li abbia compilati — non c'è mai stato
-- un posto da cui scriverli.
--
-- Contenuto:
--   1. `admin_salva_pratica` — un solo punto di scrittura, con i controlli;
--   2. il registro attività che dice **cosa** è cambiato, non solo «modificata»:
--      un registro che non dice da che valore a che valore è un registro che
--      non serve a ricostruire niente;
--   3. il wrapper pubblico, perché il client parla solo con `public.*`.
-- ============================================================================

-- --------------------------------------------------------- dove si scrive ---
/* Tre scelte che vale la pena spiegare:
   - si passano solo i campi da cambiare: un `jsonb` con dentro `name` cambia
     il nome e lascia il resto com'è. Così due analisti che salvano schede
     diverse non si sovrascrivono il lavoro a vicenda;
   - il nome non può diventare vuoto: `users.name` è ciò che la console mostra
     e ciò che il cliente vede nel suo profilo, e un campo svuotato per sbaglio
     non si recupera da nessuna parte;
   - `null` in un campo non significa «cancella», significa «non toccare».
     Cancellare un telefono si fa con la stringa vuota, che è un gesto
     esplicito. */
create or replace function traccia.admin_salva_pratica(
  p_token text, p_id uuid, p_dati jsonb
) returns jsonb language plpgsql security definer
set search_path = traccia, public, extensions as $$
declare
  a        traccia.users := traccia.need_admin(p_token);
  t        traccia.users;
  cambi    text[] := '{}';
  nuovo_nome text;
  nuovo_first text;
  nuovo_last  text;
  nuovo_tel   text;
  nuovo_importo numeric;
  nuovo_note  text;
  chiavi   text[];
begin
  if p_dati is null or jsonb_typeof(p_dati) <> 'object' then
    raise exception 'Nessun dato da salvare.' using errcode = '22023';
  end if;

  select * into t from traccia.users where id = p_id;
  if t.id is null then
    raise exception 'Account non trovato.' using errcode = '22023';
  end if;
  if t.is_master and not a.is_master then
    raise exception 'Non puoi modificare l''account master.' using errcode = '42501';
  end if;
  if t.role = 'admin' then
    raise exception 'L''account non è una pratica cliente.' using errcode = '22023';
  end if;

  -- chiavi sconosciute: rifiutate invece di ignorate. Un errore di battitura
  -- nel nome del campo, ignorato, fa credere di aver salvato qualcosa.
  select array_agg(k) into chiavi from jsonb_object_keys(p_dati) as k;
  if exists (
    select 1 from unnest(chiavi) k
    where k not in ('name', 'first_name', 'last_name', 'phone', 'case_amount_eur', 'notes')
  ) then
    raise exception 'Campo non modificabile: %.', (
      select string_agg(k, ', ') from unnest(chiavi) k
      where k not in ('name', 'first_name', 'last_name', 'phone', 'case_amount_eur', 'notes')
    ) using errcode = '22023';
  end if;

  -- nome
  if p_dati ? 'name' then
    nuovo_nome := nullif(btrim(p_dati->>'name'), '');
    if nuovo_nome is null then
      raise exception 'Il nome non può restare vuoto.' using errcode = '22023';
    end if;
    if nuovo_nome is distinct from t.name then
      cambi := array_append(cambi, 'nome: ' || coalesce(t.name, '—') || ' → ' || nuovo_nome);
      update traccia.users set name = nuovo_nome where id = p_id;
      /* Se il nome completo cambia e nessuno ha passato nome e cognome, si
         ricavano da qui: sono la stessa informazione scritta due volte, e
         lasciare `first_name` vuoto dopo aver scritto il nome è il modo per
         far comparire «—» nel saluto della pagina del cliente. Si divide
         sull'ultimo spazio: «Maria Teresa Lonardi» → «Maria Teresa» +
         «Lonardi»; una parola sola resta tutta nel nome proprio. */
      if not (p_dati ? 'first_name') and not (p_dati ? 'last_name') then
        if position(' ' in nuovo_nome) > 0 then
          update traccia.users
             set first_name = btrim(left(nuovo_nome, length(nuovo_nome) - position(' ' in reverse(nuovo_nome)))),
                 last_name  = btrim(right(nuovo_nome, position(' ' in reverse(nuovo_nome)) - 1))
           where id = p_id;
        else
          update traccia.users set first_name = nuovo_nome, last_name = null where id = p_id;
        end if;
      end if;
    end if;
  end if;

  -- nome e cognome: facoltativi, ma se ci sono devono stare insieme al nome
  -- che li contiene, altrimenti la pagina del cliente mostra «—» come nome
  -- anche quando il nome c'è.
  nuovo_first := case when p_dati ? 'first_name' then nullif(btrim(p_dati->>'first_name'), '') else t.first_name end;
  nuovo_last  := case when p_dati ? 'last_name'  then nullif(btrim(p_dati->>'last_name'), '')  else t.last_name  end;
  if nuovo_first is distinct from t.first_name then
    cambi := array_append(cambi, 'nome proprio: ' || coalesce(t.first_name, '—') || ' → ' || coalesce(nuovo_first, '—'));
    update traccia.users set first_name = nuovo_first where id = p_id;
  end if;
  if nuovo_last is distinct from t.last_name then
    cambi := array_append(cambi, 'cognome: ' || coalesce(t.last_name, '—') || ' → ' || coalesce(nuovo_last, '—'));
    update traccia.users set last_name = nuovo_last where id = p_id;
  end if;

  -- telefono: serve al richiamo, quindi vale la pena normalizzarlo invece di
  -- accettare «333 1234567» e «+393331234567» come due persone diverse
  if p_dati ? 'phone' then
    nuovo_tel := nullif(btrim(p_dati->>'phone'), '');
    if nuovo_tel is not null then
      nuovo_tel := regexp_replace(nuovo_tel, '[^0-9+]', '', 'g');
      if length(nuovo_tel) < 8 then
        raise exception 'Il telefono «%» è troppo corto per essere chiamato.', p_dati->>'phone'
          using errcode = '22023';
      end if;
    end if;
    if nuovo_tel is distinct from t.phone then
      cambi := array_append(cambi, 'telefono: ' || coalesce(t.phone, '—') || ' → ' || coalesce(nuovo_tel, '—'));
      update traccia.users set phone = nuovo_tel where id = p_id;
    end if;
  end if;

  -- importo segnalato: quanto il cliente dichiara di aver perso, non il saldo.
  -- Zero è un valore legittimo (pratica appena aperta), quindi il controllo è
  -- sul negativo, non sullo zero.
  if p_dati ? 'case_amount_eur' then
    begin
      nuovo_importo := (p_dati->>'case_amount_eur')::numeric;
    exception when others then
      raise exception 'L''importo «%» non è un numero.', p_dati->>'case_amount_eur'
        using errcode = '22023';
    end;
    if nuovo_importo is null or nuovo_importo < 0 then
      raise exception 'L''importo segnalato non può essere negativo.' using errcode = '22023';
    end if;
    if nuovo_importo is distinct from t.case_amount_eur then
      cambi := array_append(cambi, 'importo segnalato: ' || traccia.euro(t.case_amount_eur) ||
                                    ' → ' || traccia.euro(nuovo_importo));
      update traccia.users set case_amount_eur = nuovo_importo where id = p_id;
    end if;
  end if;

  -- nota interna: non arriva al cliente, è quello che serve a chi riprende in
  -- mano la pratica dopo due settimane
  if p_dati ? 'notes' then
    nuovo_note := nullif(btrim(p_dati->>'notes'), '');
    if nuovo_note is distinct from t.notes then
      cambi := array_append(cambi, 'nota aggiornata');
      update traccia.users set notes = nuovo_note where id = p_id;
    end if;
  end if;

  if cardinality(cambi) = 0 then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  perform traccia.log_action(a, 'case_edit', t.email, array_to_string(cambi, ' · '));

  return jsonb_build_object('ok', true, 'changed', true, 'campi', to_jsonb(cambi));
end $$;

-- il cliente della pratica vede la correzione nella sua area: non è una
-- notifica, è il dato che cambia. Nessun avviso: correggere un refuso non è
-- una novità della pratica.

-- ------------------------------------------------------- superficie pubblica ---
create or replace function public.admin_salva_pratica(p_token text, p_id uuid, p_dati jsonb)
returns jsonb language sql security definer
set search_path = traccia, public, extensions as $f$
  select traccia.admin_salva_pratica(p_token, p_id, p_dati);
$f$;
revoke all on function public.admin_salva_pratica(p_token text, p_id uuid, p_dati jsonb) from public;
grant execute on function public.admin_salva_pratica(p_token text, p_id uuid, p_dati jsonb)
  to anon, authenticated;
