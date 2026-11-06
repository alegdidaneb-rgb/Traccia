#!/usr/bin/env python3
"""traccia — le altre lingue del sito, generate dal catalogo.

Il problema che risolve: il sito è scritto in italiano dentro l'HTML. Per averlo
in inglese, tedesco e spagnolo senza un traduttore che gira nel browser (il
progetto non usa `fetch`: c'è scritto in `build_shell.py`, «nessun lampo di
pagina vuota»), le pagine tradotte si costruiscono qui, come già fa
`build_shell.py` per intestazione e piè di pagina.

Come funziona, in tre passi:

    1. si legge la pagina italiana (`index.html`);
    2. si sostituiscono i testi del catalogo (`tools/i18n/en.json`, …);
    3. si scrive il risultato in `en/index.html`, `de/index.html`, …

Le sostituzioni avvengono **solo dentro il corpo della pagina** — fra `<main`
e `</main>`. Fuori da lì non si tocca niente: intestazione, piè di pagina,
`<title>`, i metadati sociali e gli attributi restano quelli della pagina
italiana. Non è pigrizia: una sostituzione ingenua del testo tradotto dentro
l'intero file riscriverebbe anche `content="…"` dei meta tag e le `alt` delle
immagini, e la prima parola tradotta che compare in un attributo romperebbe
l'HTML.

Perché non si usa `str.replace` sul file intero: una chiave come «conto» o
«wallet» compare decine di volte, dentro classi CSS (`conto-corrente`), `id`,
`href` e nomi di file. Sostituirla alla cieca produrrebbe un sito rotto in un
modo difficile da vedere. Qui si sostituisce **solo il testo fra `>` e `<`**,
cioè ciò che l'utente legge, e solo se coincide esattamente con una chiave del
catalogo dopo aver normalizzato gli spazi.

Uso:
    python3 tools/build_i18n.py            # scrive en/ de/ es/
    python3 tools/build_i18n.py --check    # esce 1 se una pagina è disallineata
    python3 tools/build_i18n.py --lingua de --pagina index.html
"""
from __future__ import annotations

import html as html_mod
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGO = ROOT / "tools" / "i18n"

LINGUE = ["en", "de", "es"]
SORGENTE = "it"
# la sigla nel pulsante: due lettere, maiuscole, come le legge il visitatore
SIGLE = {"it": "IT", "en": "EN", "de": "DE", "es": "ES"}

# Le pagine che hanno una versione in ogni lingua. Sono tutte quelle che
# `build_shell.py` tratta come pubbliche, più `404.html` — che è il posto in
# cui si atterra quando un indirizzo non esiste, e che in tedesco deve parlare
# tedesco come tutte le altre.
#
# Restano fuori di proposito `app.html` e `admin.html`: sono l'area riservata e
# la console degli analisti, cioè schermate che leggono e scrivono dati, e
# tradurle significa tradurre ogni messaggio che il database restituisce. Si
# fanno dopo, con il loro giro di prove: qui si sta chiudendo il sito pubblico.
PAGINE = [
    "index.html", "come-funziona.html", "casi.html", "crypto.html",
    "chi-siamo.html", "team.html", "onorari.html", "supporto.html", "login.html",
    "privacy.html", "termini.html", "cookie.html", "note-legali.html",
    "404.html",
]

# Dati che non sono testo: non vanno toccati nemmeno dentro il corpo.
SALTA = ("script", "style", "code", "pre")

# Il blocco che si traduce: tutto ciò che sta fra questi due marcatori.
INIZIO_CORPO = re.compile(r"<main\b", re.I)
FINE_CORPO = re.compile(r"</main>", re.I)


def leggi_catalogo(lingua: str) -> dict[str, str]:
    percorso = CATALOGO / f"{lingua}.json"
    if not percorso.exists():
        raise SystemExit(f"  catalogo mancante: {percorso.relative_to(ROOT)}")
    dati = json.loads(percorso.read_text(encoding="utf-8"))
    dati.pop("_meta", None)
    return dati


_ITALIANO: dict[str, str] | None = None


def italiano() -> dict[str, str]:
    """Il catalogo italiano, solo per distinguere «manca» da «già tradotto».

    Il titolo di una pagina passa due volte: `traduci_corpo` lo sostituisce
    perché sta fra `>` e `<`, poi `titolo` lo rivede e non trova più la chiave.
    Senza questo controllo il rapporto segnalava come mancante ogni titolo
    già tradotto, e un avviso che grida sempre non si legge più.
    """
    global _ITALIANO
    if _ITALIANO is None:
        _ITALIANO = leggi_catalogo(SORGENTE)
    return _ITALIANO


def parti_della_pagina(pagina: str) -> tuple[str, str, str]:
    """(prima del corpo, corpo, dopo il corpo).

    Se i marcatori mancano si ferma: meglio un errore che un sito per metà
    tradotto, che nessuno nota finché un cliente tedesco non apre la pagina.
    """
    i = INIZIO_CORPO.search(pagina)
    j = FINE_CORPO.search(pagina)
    if not i or not j or j.start() < i.start():
        raise SystemExit("  marcatori <main> … </main> mancanti: impossibile tradurre")
    return pagina[: i.start()], pagina[i.start(): j.end()], pagina[j.end():]


def zone_non_tradotte(corpo: str) -> list[tuple[int, int]]:
    """Intervalli di `<script>…</script>`, `<style>…</style>` e simili."""
    zone = []
    for tag in SALTA:
        for m in re.finditer(rf"<{tag}\b[^>]*>.*?</{tag}>", corpo, re.S | re.I):
            zone.append((m.start(), m.end()))
    return zone


def dentro(posizione: int, zone: list[tuple[int, int]]) -> bool:
    return any(a <= posizione < b for a, b in zone)


def traduci_corpo(corpo: str, catalogo: dict[str, str], lingua: str) -> tuple[str, list[str]]:
    """Sostituisce i nodi di testo del corpo. Restituisce (nuovo, non tradotti).

    Un «nodo di testo» è ciò che sta fra `>` e `<`. Gli spazi attorno si
    conservano: nel sorgente l'indentazione è parte del file, e riscriverla
    renderebbe il diff illeggibile al prossimo giro.
    """
    zone = zone_non_tradotte(corpo)
    non_tradotti: list[str] = []
    pezzi: list[str] = []
    ultimo = 0

    for m in re.finditer(r">([^<>]+)<", corpo):
        inizio_testo = m.start(1)
        if dentro(inizio_testo, zone):
            continue
        grezzo = m.group(1)
        # conserva gli spazi iniziali e finali: sono indentazione, non contenuto
        iniziali = grezzo[: len(grezzo) - len(grezzo.lstrip())]
        finali = grezzo[len(grezzo.rstrip()):]
        centro = grezzo.strip()
        if not centro:
            continue

        tradotto = catalogo.get(centro)
        if tradotto is None:
            # prova con gli spazi normalizzati: il sorgente va a capo dentro le
            # frasi, il catalogo le tiene su una riga sola
            normalizzato = " ".join(centro.split())
            tradotto = catalogo.get(normalizzato)
            if tradotto is not None:
                centro = normalizzato
        if tradotto is None:
            # un nodo di sola punteggiatura («.», «·», «—») non è testo da
            # tradurre: segnalarlo riempirebbe il rapporto di rumore e
            # nasconderebbe le frasi vere rimaste indietro
            # le iniziali delle schede del team («MB», «AC») non sono testo
            if re.search(r"[^\W\d_]", centro) and not re.fullmatch(r"[A-Z]{1,3}", centro):
                non_tradotti.append(centro)
            continue
        if tradotto == centro and lingua != SORGENTE:
            continue

        pezzi.append(corpo[ultimo:inizio_testo])
        pezzi.append(iniziali + tradotto + finali)
        # il nodo finisce dove finiva il testo: `m.end(1)`
        ultimo = m.end(1)

    pezzi.append(corpo[ultimo:])
    return "".join(pezzi), non_tradotti


# `data-titolo-*` e `data-sottotitolo-*` non sono decorazioni: sono i testi che
# `auth.js` scrive quando si passa da una scheda all'altra. Se restano in
# italiano, la pagina tedesca mostra un titolo tedesco al caricamento e uno
# italiano al primo clic.
ATTRIBUTI_VISIBILI = (
    "alt", "aria-label", "title", "placeholder",
    "data-titolo-accesso", "data-titolo-segnalazione",
    "data-sottotitolo-accesso", "data-sottotitolo-segnalazione",
)


def traduci_attributi(pagina: str, catalogo: dict[str, str], lingua: str) -> tuple[str, list[str]]:
    """Traduce `alt`, `aria-label`, `title`, `placeholder`.

    Questi testi non sono fra `>` e `<`, quindi `traduci_corpo` non li vede.
    E sono proprio quelli che nessuno rilegge: il testo alternativo di
    un'immagine resta in italiano per anni, invisibile a chi guarda la pagina
    e presente a chi la ascolta con un lettore di schermo. Verificato in
    produzione su `/de/`: l'immagine del grafo annunciava ancora
    «Grafo di transazioni…».
    """
    non_tradotti: list[str] = []

    def sostituisci(m: re.Match[str]) -> str:
        attributo, valore = m.group(1), m.group(2)
        centro = valore.strip()
        if not centro or not re.search(r"[^\W\d_]", centro):
            return m.group(0)
        tradotto = catalogo.get(centro)
        if tradotto is None:
            normalizzato = " ".join(centro.split())
            tradotto = catalogo.get(normalizzato) or catalogo.get(centro.strip().rstrip("."))
        if tradotto is None:
            non_tradotti.append(centro)
            return m.group(0)
        return f'{attributo}="{tradotto}"'

    modello = r'\b(' + "|".join(ATTRIBUTI_VISIBILI) + r')="([^"]*)"'
    return re.sub(modello, sostituisci, pagina), non_tradotti


# Campi della `<head>` che contengono testo leggibile. `og:site_name`,
# `og:locale`, `og:type`, `twitter:card` e gli URL restano: non sono frasi da
# tradurre, e cambiarli romperebbe le anteprime invece di migliorarle.
METADATI = re.compile(
    r'<meta\s+(?:name|property)="'
    r'(description|og:title|og:description|og:image:alt|'
    r'twitter:title|twitter:description|twitter:image:alt)'
    r'"\s+content="([^"]*)"',
    re.I,
)


def _meta_tradotto(m: re.Match[str], catalogo: dict[str, str]) -> str:
    """Traduce il `content` di un meta sociale, se il catalogo lo conosce."""
    campo, valore = m.group(1), html_mod.unescape(m.group(2))
    centro = " ".join(valore.split())
    tradotto = catalogo.get(centro)
    if tradotto is None or tradotto == centro:
        return m.group(0)
    return m.group(0).replace(f'content="{m.group(2)}"', f'content="{tradotto}"', 1)


LD_DESCRIZIONE = re.compile(r'"description": "([^"]*)"')


def _json_ld_tradotto(testata: str, catalogo: dict[str, str]) -> str:
    """La `description` dentro `<script type="application/ld+json">`.

    È il testo che Google mostra sotto il titolo quando il risultato è una
    scheda arricchita: lasciarlo in italiano significa che il risultato
    tedesco si presenta in italiano anche con il resto tradotto.
    """
    def dentro(m: re.Match[str]) -> str:
        def campo(c: re.Match[str]) -> str:
            centro = " ".join(c.group(1).split())
            tradotto = catalogo.get(centro)
            if tradotto is None or tradotto == centro:
                return c.group(0)
            return f'"description": "{tradotto}"'
        return LD_DESCRIZIONE.sub(campo, m.group(0))

    return LD_JSON.sub(dentro, testata)


LD_JSON = re.compile(
    r'<script\s+type="application/ld\+json"[^>]*>.*?</script>', re.S | re.I
)


def attributi_lingua(testata: str, lingua: str, catalogo: dict[str, str] | None = None,
                     pagina: str = "index.html") -> str:
    """`lang`, `canonical`, `og:locale`, `hreflang` e Open Graph.

    `pagina` è il nome del file italiano da cui si parte. Prima questa funzione
    conosceva solo la radice, perché l'unica pagina tradotta era la home: con
    dodici pagine per lingua, un canonical che punta tutte a `/de/` dice a
    Google che `/de/supporto` è un duplicato della home tedesca. Si vede poco
    dal sito e molto dai risultati di ricerca.
    """
    base = "https://traccia.it.com"
    prefisso = "" if lingua == SORGENTE else f"/{lingua}"
    # l'indirizzo canonico della home è la cartella, quello delle altre pagine
    # è il file: `/de/` e `/de/supporto.html`
    coda = "" if pagina == "index.html" else pagina

    testata = re.sub(r'<html lang="[^"]*"', f'<html lang="{lingua}"', testata, count=1)
    testata = re.sub(r'(<html lang="[^"]*")', rf'\1 class="lang-page"', testata, count=1)

    # canonical e og:url vanno sull'indirizzo di questa lingua
    testata = re.sub(
        r'<link rel="canonical" href="[^"]*"',
        f'<link rel="canonical" href="{base}{prefisso}/{coda}"',
        testata,
    )
    testata = re.sub(
        r'<meta property="og:url" content="[^"]*"',
        f'<meta property="og:url" content="{base}{prefisso}/{coda}"',
        testata,
    )
    # I metadati della testata: `<title>` (già in `costruisci`), la descrizione,
    # i campi Open Graph e Twitter e il blocco JSON-LD. Sono attributi o JSON,
    # quindi non passano da `traduci_corpo`, ma sono testo che il visitatore
    # legge — nella scheda del browser, in una anteprima di link, nei risultati
    # di ricerca. Prima di questa funzione la pagina tedesca si presentava in
    # italiano su Google.
    if catalogo:
        testata = METADATI.sub(lambda m: _meta_tradotto(m, catalogo), testata)
        testata = _json_ld_tradotto(testata, catalogo)

    locale = {"it": "it_IT", "en": "en_GB", "de": "de_DE", "es": "es_ES"}[lingua]
    testata = re.sub(
        r'<meta property="og:locale" content="[^"]*"',
        f'<meta property="og:locale" content="{locale}"',
        testata,
    )

    # hreflang: tutte le lingue si dichiarano a vicenda, più x-default
    if 'rel="alternate" hreflang=' not in testata:
        righe = []
        for codice in ["it"] + LINGUE:
            p = "" if codice == "it" else f"/{codice}"
            righe.append(
                f'  <link rel="alternate" hreflang="{codice}" href="{base}{p}/{coda}">'
            )
        righe.append(f'  <link rel="alternate" hreflang="x-default" href="{base}/{coda}">')
        testata = testata.replace(
            "</head>", "\n".join(righe) + "\n</head>", 1
        )
    return testata


def intestazione_tradotta(lingua: str, catalogo: dict[str, str],
                          pagina_nome: str = "index.html") -> str:
    """L'header per una pagina in `lingua/`: link nella lingua, voci tradotte.

    Si riparte da `partials/header.html` — la fonte di verità — invece di
    riusare l'header della pagina italiana: lì il brand punta a `index.html` e
    il menu alle pagine italiane, e da `/de/` quei link riporterebbero il
    visitatore in italiano al primo clic.

    Chi possiede questi file è questo script e solo questo: `build_shell.py`
    non tocca `en/ de/ es/`, altrimenti i due si sovrascriverebbero a vicenda
    a ogni giro (è successo, ed è il motivo di questo commento).
    """
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tools"))
    import build_shell  # stesse voci di menu, stesso markup

    corpo = build_shell.costruisci_header(pagina_nome, lingua)
    corpo, _ = traduci_corpo(corpo, catalogo, lingua)

    # Il nome di una lingua non si traduce: «Deutsch» è «Deutsch» anche in una
    # pagina spagnola — è così che lo cerca chi parla tedesco. Nel catalogo
    # però «Italiano» diventa «Italian» nella pagina inglese, ed è giusto per
    # il testo visibile ma sbagliato per il `title` e per l'`aria-label` del
    # selettore: lì deve restare il nome che quella lingua dà a sé stessa,
    # altrimenti un lettore di schermo legge «Spanish» a un madrileno che
    # cerca «Español».
    for codice, nome in (
        ("it", "Italiano"), ("en", "English"), ("de", "Deutsch"), ("es", "Español")
    ):
        corpo = re.sub(
            rf'(<a class="lang__opt"[^>]*data-lang="{codice}"[^>]*)',
            lambda m, n=nome: re.sub(
                r'(title|aria-label)="[^"]*"',
                lambda a: f'{a.group(1)}="{n}"',
                m.group(1),
            ),
            corpo,
            count=1,
        )

    # La pastiglia della lingua corrente la segna `build_shell.costruisci_header`,
    # che è l'unico a costruire l'header. Qui non si ripete: due punti che
    # fanno la stessa cosa divergono, ed è già successo in questo file.

    return "<!-- shell:header -->\n" + corpo.rstrip("\n") + "\n  <!-- /shell:header -->"


def costruisci(pagina_nome: str, lingua: str, catalogo: dict[str, str]) -> tuple[str, list[str]]:
    sorgente = (ROOT / pagina_nome).read_text(encoding="utf-8")

    # Si traduce la pagina intera, non solo `<main>`: header, footer e banner
    # cookie sono parte di ciò che il visitatore legge, e lasciarli in italiano
    # su una pagina tedesca è il difetto che si nota per primo.
    intera, non_tradotti = traduci_corpo(sorgente, catalogo, lingua)
    # Gli asset vanno alla radice assoluta, e **prima** di ricostruire l'header.
    # Da `/de/`, `src="assets/js/main.js"` diventa `/de/assets/js/main.js`, che
    # non esiste: le pagine tradotte resterebbero senza CSS e senza script, e
    # sembrerebbero «un po' diverse» invece che rotte. Verificato servendole da
    # un server locale.
    intera = re.sub(r'(src|href)="assets/', r'\1="/assets/', intera)

    prima, corpo, dopo = parti_della_pagina(intera)
    testata = attributi_lingua(prima, lingua, catalogo, pagina_nome)

    # l'header si ricostruisce da `partials/`, con i link che restano in lingua
    testata = re.sub(
        r"(<!-- shell:header -->).*?(<!-- /shell:header -->)",
        lambda _m: intestazione_tradotta(lingua, catalogo, pagina_nome),
        testata,
        flags=re.S,
    )

    # Gli asset vanno alla radice assoluta. Da `/de/`, `src="assets/js/main.js"`
    # diventa `/de/assets/js/main.js`, che non esiste: le pagine tradotte
    # resterebbero senza CSS e senza uno script, e sembrerebbero solo «un po'
    # diverse» invece che rotte. Verificato servendole da un server locale.

    pagina = testata + corpo + dopo

    # I link interni si riscrivono sulla pagina **intera**, non solo su `<main>`:
    # il banner cookie (che sta dopo `</main>`) e il piè di pagina portavano a
    # `/cookie.html` e `/privacy.html`, cioè all'italiano, da ogni lingua.
    # L'anchor si conserva: `/de/supporto#faq` deve aprire la FAQ, non la cima
    # della pagina. `index.html` diventa la radice della lingua, che è
    # l'indirizzo canonico (`/de/`, non `/de/index.html`).
    # L'italiano è l'unica lingua senza cartella, e Vercel qui gira con
    # `cleanUrls: true`: `/de/casi` esiste solo finché qualcuno non crea un
    # file `de/casi` vero accanto a `de/casi.html`. L'estensione resta
    # (`/de/casi.html`), che funziona sempre, anche servendo il sito da una
    # cartella qualsiasi per provarlo.
    if lingua != SORGENTE:
        def riscrivi(m: re.Match[str]) -> str:
            nome, anchor = m.group(1), m.group(2) or ""
            if nome == "index":
                return f'href="/{lingua}/{anchor}"'
            return f'href="/{lingua}/{nome}.html{anchor}"'

        pagina = re.sub(
            r'href="(?!https?:|/|#|mailto:|tel:)([a-z0-9\-]+)\.html(#[^"]*)?"',
            riscrivi,
            pagina,
        )

        # L'area riservata (`app.html`) e la console (`admin.html`) restano in
        # italiano, e restano alla radice: non esiste `/de/app.html`, e un link
        # che ci punta porta al 404 — il difetto che questa generazione doveva
        # chiudere, riaperto dalla parte più facile da dimenticare. Il link
        # porta alla pagina vera, che è una sola e non ha una lingua da
        # scegliere (per ora).
        pagina = re.sub(r'href="/(?:en|de|es)/(app|admin)\.html((?:#[^"]*)?)"',
                        r'href="/\1.html\2"', pagina)

    # Gli attributi si traducono **alla fine**, sulla pagina già assemblata:
    # l'header viene ricostruito più sotto da `partials/`, e traducendo prima
    # si traducevano gli attributi di un header che poi veniva buttato via —
    # `aria-label="Apri il menu"` restava italiano su tutte e tre le pagine.
    pagina, attr_non_tradotti = traduci_attributi(pagina, catalogo, lingua)
    non_tradotti += [f"[attributo] {a}" for a in attr_non_tradotti]

    # `<title>` e la descrizione social sono testo che il visitatore legge —
    # nella scheda del browser e quando il link viene incollato in una chat —
    # ma non stanno fra `>` e `<`, quindi `traduci_corpo` non li tocca. Senza
    # questa riga ogni pagina tedesca si presenta con il titolo italiano.
    def titolo(m: re.Match[str]) -> str:
        centro = " ".join(m.group(2).split())
        tradotto = catalogo.get(centro)
        if tradotto is None:
            if centro in italiano():
                non_tradotti.append(f"[title] {centro}")
            return m.group(0)
        return f"<{m.group(1)}>{tradotto}</{m.group(1)}>"

    pagina = re.sub(r"<(title)>([^<]*)</\1>", titolo, pagina)
    return pagina, non_tradotti


def main() -> int:
    check = "--check" in sys.argv
    solo_lingua = None
    if "--lingua" in sys.argv:
        solo_lingua = sys.argv[sys.argv.index("--lingua") + 1]
    if "--pagina" in sys.argv:
        pagine = [sys.argv[sys.argv.index("--pagina") + 1]]
    else:
        pagine = PAGINE

    italiano = leggi_catalogo(SORGENTE)
    lingue = [solo_lingua] if solo_lingua else LINGUE

    disallineate, scritti, problemi = [], [], []
    for lingua in lingue:
        catalogo = leggi_catalogo(lingua)
        # ogni chiave italiana deve esistere nella lingua: un buco qui è una
        # frase che resta in italiano in mezzo alla pagina tradotta
        mancanti = [k for k in italiano if k not in catalogo]
        if mancanti:
            problemi.append(
                f"{lingua}: {len(mancanti)} chiavi mancanti (es. «{mancanti[0][:60]}»)"
            )
        for pagina_nome in pagine:
            nuova, non_tradotti = costruisci(pagina_nome, lingua, catalogo)
            relativo = f"{lingua}/{pagina_nome}"
            destinazione = ROOT / lingua / pagina_nome
            vecchia = (destinazione.read_text(encoding="utf-8")
                       if destinazione.exists() else "")
            if nuova != vecchia:
                disallineate.append(relativo)
                if not check:
                    destinazione.parent.mkdir(parents=True, exist_ok=True)
                    destinazione.write_text(nuova, encoding="utf-8")
                    scritti.append(relativo)
            if non_tradotti:
                problemi.append(
                    f"{relativo}: {len(non_tradotti)} testi senza traduzione "
                    f"(es. «{non_tradotti[0][:60]}»)"
                )

    for p in problemi:
        print("  · " + p)

    if check:
        if disallineate or problemi:
            print("Lingue disallineate dal catalogo:")
            for d in disallineate:
                print("  · " + d)
            return 1
        print("Le lingue sono allineate al catalogo.")
        return 0

    if scritti:
        print("Generate: " + ", ".join(scritti))
    else:
        print("Nessuna pagina da rigenerare.")
    return 1 if problemi else 0


if __name__ == "__main__":
    sys.exit(main())
