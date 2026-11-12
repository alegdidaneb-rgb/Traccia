#!/usr/bin/env python3
"""traccia — misura la testata come la misurerebbe un browser.

Perché esiste: il selettore di lingua sta nella riga dell'header, accanto a
sette voci di menu e due pulsanti. Se non ci sta, o va a capo, o spinge fuori
qualcosa — e questo non si vede leggendo l'HTML né contando i caratteri a
occhio. Qui si misura con i numeri veri del font (avanzamento dei glifi,
`fontTools`) invece di indovinare una media di 7px per lettera.

Cosa non fa: niente layout CSS completo. Misura le larghezze del testo e le
somma ai padding dichiarati nel foglio di stile, che è quanto basta per
rispondere a una domanda sola: a questa larghezza, ci sta?

Uso:
    python3 tools/misura_header.py            # tutte le larghezze di prova
    python3 tools/misura_header.py 1280 900   # solo quelle indicate
"""
from __future__ import annotations

import pathlib
import sys

import re

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / "assets" / "fonts" / "inter-var.woff2"
CSS = ROOT / "assets" / "css" / "premium.css"
CSS_BASE = ROOT / "assets" / "css" / "style.css"


def padding_orizzontale(selettore: str, predefinito_rem: float) -> float:
    """Il padding laterale di un `padding: A B` in rem → px.

    Due settori: `0.55rem 0.75rem`. Il secondo è quello orizzontale.
    """
    for foglio in (CSS, CSS_BASE):
        testo = foglio.read_text(encoding="utf-8")
        for blocco in re.findall(re.escape(selettore) + r"\s*\{([^}]*)\}", testo):
            m = re.search(r"padding:\s*([\d.]+)rem\s+([\d.]+)rem", blocco)
            if m:
                return float(m.group(2)) * 16
    return predefinito_rem * 16


def dal_css(selettore: str, proprieta: str, predefinito: float) -> float:
    """Un valore in px letto da una regola del foglio di stile.

    Perché non ricopiarlo qui: il padding dei link e la larghezza della barra
    sono **la** cosa che questo file misura. Ricopiati, cambiarli nel CSS non
    cambiava il conto e il test continuava a dire «sta» — è già successo una
    volta con le pastiglie di lingua. `rem` si converte a 16px, che è la base
    del foglio.
    """
    for foglio in (CSS, CSS_BASE):
        testo = foglio.read_text(encoding="utf-8")
        for blocco in re.findall(re.escape(selettore) + r"\s*\{([^}]*)\}", testo):
            m = re.search(re.escape(proprieta) + r":\s*([\d.]+)(px|rem)", blocco)
            if m:
                valore = float(m.group(1))
                return valore * 16 if m.group(2) == "rem" else valore
    return predefinito


def leggi_contenitore() -> int:
    """La larghezza della barra, letta dal foglio di stile. **Deve** esserci.

    Se manca, il misuratore non deve ripiegare su un numero suo: misurerebbe
    una barra che non esiste e direbbe «sta» su una riga che si spezza — che è
    esattamente il guasto da cui nasce questo file. Meglio fermarsi.
    """
    testo = (CSS_BASE).read_text(encoding="utf-8")
    for blocco in re.findall(r"\.site-header \.container\s*\{([^}]*)\}", testo):
        m = re.search(r"max-width:\s*(\d+)px", blocco)
        if m:
            return int(m.group(1))
    raise SystemExit(
        "misura_header: `.site-header .container { max-width: <px> }` non trovata "
        "in style.css. La barra dell'header deve avere una larghezza sua, in px: "
        "senza, il conto dell'ingombro misura il contenitore sbagliato."
    )


def misura_pastiglia(schermo_stretto: bool) -> tuple[int, int]:
    """`min-width` e `height` di `.lang__opt`, letti dal foglio di stile.

    Le pastiglie sono definite tre volte (normale, sotto 1360, sotto 480):
    copiarne le misure qui significa misurarne una versione che il sito non usa
    più, e nessuno se ne accorge finché non si rompe in produzione.
    """
    css = CSS.read_text(encoding="utf-8")
    for blocco in re.findall(r"\.lang__opt \{([^}]*)\}", css):
        m = re.search(r"min-width: (\d+)px", blocco)
        h = re.search(r"height: (\d+)px", blocco)
        if not m or not h:
            continue
        larg, alt = int(m.group(1)), int(h.group(1))
        if schermo_stretto and larg <= 30:
            return larg, alt
        if not schermo_stretto and larg > 30:
            return larg, alt
    return (34, 30)

# Larghezze a cui il sito deve reggere: la scrivania, il portatile piccolo, il
# telefono. Sono le stesse dei punti di rottura nel foglio di stile.
# 1360 è il punto in cui l'hamburger prende il posto del menu, 480 quello in
# cui il nome «Traccia» lascia il posto alla sola «T». Le soglie sono nel
# foglio di stile: misurarle con numeri diversi da quelli veri sarebbe una
# bugia comoda — direbbe «sta» dove il sito sborda.
LARGHEZZE = [1920, 1440, 1361, 1360, 1357, 1356, 1340, 1301, 1300, 1280, 1221, 1024, 820, 481, 480, 390, 360]

# Le voci del menu, come le scrive `build_shell.voci_menu`. Se cambiano là,
# cambiano qui: sono il dato che rende utile la misura.
VOCI = [
    "Come funziona", "Casi seguiti", "Truffe cripto", "Chi siamo",
    "Il team", "Onorari", "Supporto",
]
PULSANTI = ["Accedi", "Segnala un caso"]
SIGLE = ["IT", "EN", "DE", "ES"]

# Il contenitore della testata. È **il** numero che mancava: il `.container`
# standard si ferma a 1200 e il contenuto a 1218 non ci sta, quindi la barra
# ha una regola sua (`style.css`, `.site-header .container`). Il misuratore
# deve leggere quel valore, non la larghezza dello schermo: confrontando con
# la finestra diceva «sta» a 1440 su una barra che si ferma a 1200.
CONTENITORE_HEADER = leggi_contenitore()

# Quanto spazio deve restare nella barra perché «ci sta» sia vero: vedi
# `soglia_menu`.
MARGINE_SICURO = 24

# La soglia dell'hamburger. Si **ricava** dal contenuto (vedi `soglia_menu`),
# non si sceglie: è il motivo per cui questo file ora la calcola.
SOGLIA_MENU = 1300

# Sotto la soglia dell'hamburger i pulsanti di accesso **non sono in barra**:
# il foglio di stile li nasconde (`.nav__actions { display: none }` nel blocco
# del pannello) perché il pannello ha già «Accedi» e «Segnala un caso» fra le
# sue voci. Il misuratore deve saperlo, altrimenti conta degli spazi che il
# browser non disegna. Prima non lo sapeva: sommava i pulsanti alla barra
# mobile e segnalava sforamenti a 481px che a schermo non esistono.

# Padding e spaziature presi dal foglio di stile, in px.
PAD_PAGINA = 40          # --pad-x, clamp(1.25rem, 4vw, 2.5rem) al massimo
PAD_PAGINA_MIN = 20      # --pad-x, clamp(1.25rem, 4vw, 2.5rem) al minimo
GAP_NAV = 40             # gap fra brand e menu, .nav clamp(1rem, 3vw, 2.5rem)
NAV_LINK_GAP = 0.25 * 16       # .nav__links gap
BTN_FONT = 0.82 * 16           # .btn--sm font-size
BTN_PAD = 1.05 * 2 * 16        # .btn--sm padding-inline
BTN_GAP = 0.5 * 16             # .nav__actions gap
BTN_MARGIN = 0.9 * 16          # .nav__actions margin-inline-start
LANG_OPT = 34 + 6              # .lang__opt min-width + padding
LANG_GAP = 2
LANG_PAD = 3 * 2
BRAND = 30 + 0.6 * 16 + 90     # marchio, spazio, «Traccia» a 1.2rem


def pad_x(w: int) -> float:
    """`--pad-x: clamp(1.25rem, 4vw, 2.5rem)`, in px, alla larghezza `w`.

    Era il secondo errore del conto: dato per 40 fisso, il misuratore
    riservava 80px di padding anche a 360px di schermo, dove sono 40 (2×20).
    Su un telefono quel margine inesistente faceva sembrare che la barra
    sbordasse — cioè il difetto si vedeva, ma sulla larghezza sbagliata.
    """
    return max(PAD_PAGINA_MIN, min(0.04 * w, PAD_PAGINA))


def gap_nav(w: int) -> float:
    """`gap: clamp(1rem, 3vw, 2.5rem)` su `.nav`."""
    return max(16, min(0.03 * w, 40))


def misuratore(font_path: pathlib.Path):
    """Ritorna una funzione che dà la larghezza in px di un testo.

    Il font è variabile: si prende il peso 500 del menu, che è quello dei link
    di navigazione. Gli avanzamenti sono in unità del font, quindi si scala
    per il corpo (`size`) diviso `unitsPerEm`.
    """
    font = TTFont(font_path)
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    cache: dict[str, float] = {}

    def larghezza(testo: str, size: float, peso: str = "500") -> float:
        chiave = f"{testo}|{size}|{peso}"
        if chiave in cache:
            return cache[chiave]
        totale = 0.0
        for ch in testo:
            nome = cmap.get(ord(ch))
            if nome is None:
                totale += upm * 0.5  # glifo assente: si stima mezzo em
                continue
            totale += hmtx[nome][0]
        px = totale / upm * size
        cache[chiave] = px
        return px

    return larghezza


def soglia_menu(larghezza: "callable") -> int:
    """La larghezza di finestra sotto la quale il menu in riga non ci sta.

    Si ricava, non si scrive: è il numero che il foglio di stile deve usare
    nel suo `@media`, e se i due divergono il misuratore mente. Prima era
    scritto a mano in due posti (1360 nel CSS, 1360 qui) e sbagliato in
    entrambi — perché il conto partiva dalla finestra invece che dalla barra.
    """
    pezzi = ingombro(larghezza, CONTENITORE_HEADER + 100)
    serve = sum(pezzi.values()) + gap_nav(CONTENITORE_HEADER + 100) * 2
    # Il margine non è un vezzo: una soglia a margine zero vuol dire che alla
    # larghezza di confine la riga è piena fino all'ultimo pixel, e basta una
    # voce in grassetto — il link attivo è peso 600 — per farla spezzare.
    # 24px coprono una voce in grassetto; sotto, l'hamburger.
    return int(serve + PAD_PAGINA * 2 + MARGINE_SICURO)


def ingombro(larghezza: "callable", w: int) -> dict[str, float]:
    """Quanto occupa ogni pezzo della testata, in px, a una data larghezza.

    Sotto i 1360 il foglio di stile stringe il menu e i pulsanti: misurarli con
    le misure della scrivania darebbe un allarme falso, o peggio nasconderebbe
    un problema vero.
    """
    stretto = w <= SOGLIA_MENU
    voce = 0.875 * 16  # --fs-small = .875rem = 14px esatti
    # `.nav-link { padding: 0.55rem 0.75rem }`: si legge la parte orizzontale
    # (la seconda del shorthand), non la prima che è quella verticale
    pad_link = padding_orizzontale(".nav-link", 0.75) * 2
    pad_btn = BTN_PAD
    # Le misure delle pastiglie si **leggono dal foglio di stile**: scritte qui
    # a mano, allargare il selettore nel CSS non cambiava la misura e il test
    # continuava a dire «sta». L'ho scoperto allargandole apposta per vedere se
    # il test mordeva: non mordeva.
    if w <= 480:
        larg_opt = misura_pastiglia(True)[0] + 8
    elif stretto:
        larg_opt = misura_pastiglia(False)[0] + 12
    else:
        larg_opt = LANG_OPT
    # il menu in riga ha sempre le misure della scrivania: sotto la soglia
    # non è più in riga, è nel pannello, e non entra nel conto della barra
    # sotto i 480 il nome «Traccia» sparisce dal marchio (resta la «T»)
    brand = 26 if w <= 480 else BRAND

    menu = sum(larghezza(v, voce) + pad_link for v in VOCI) + NAV_LINK_GAP * len(VOCI)
    pulsanti = sum(larghezza(p, BTN_FONT) + pad_btn for p in PULSANTI) + BTN_GAP + BTN_MARGIN
    selettore = len(SIGLE) * larg_opt + LANG_GAP * (len(SIGLE) - 1) + LANG_PAD
    if w <= 480:
        selettore = len(SIGLE) * (26 + 8) + LANG_PAD
    return {"marchio": brand, "menu": menu, "selettore": selettore, "pulsanti": pulsanti}


def main() -> int:
    larghezza = misuratore(FONT)
    chiesti = [int(a) for a in sys.argv[1:] if a.isdigit()] or LARGHEZZE
    problemi = 0

    print("Ingombro della testata (px, misurati sul font Inter Variable)\n")
    soglia = soglia_menu(larghezza)
    print(f"  la soglia dell'hamburger, ricavata dal contenuto: {soglia}px\n")
    for w in chiesti:
        pezzi = ingombro(larghezza, w)
        # Lo spazio disponibile è quello della **barra**, non della finestra:
        # il contenitore si ferma a 1360 comunque, anche su uno schermo da
        # 2560. Ed è largo `w` quando la finestra è più stretta.
        barra = min(w, CONTENITORE_HEADER)
        disponibile = barra - pad_x(w) * 2
        if w > soglia:
            # menu in riga: deve starci tutto
            # Tre gruppi in barra (marchio, lista, pulsanti) = due spazi, non
            # uno. Con uno il conto dava 1252 invece di 1292: 40px regalati a
            # una barra che non li ha.
            serve = sum(pezzi.values()) + gap_nav(w) * 2
            esito = "sta" if serve <= disponibile else f"SBORDA di {serve - disponibile:.0f}px"
            if serve > disponibile:
                problemi += 1
            nota = f"  menu in riga, servono {serve:.0f} su {disponibile:.0f}"
        else:
            # menu nel pannello: in barra restano marchio, selettore, hamburger
            barra_serve = (pezzi["marchio"] + pezzi["selettore"] + 44 + gap_nav(w) * 2)
            esito = "sta" if barra_serve <= disponibile else f"SBORDA di {barra_serve - disponibile:.0f}px"
            if barra_serve > disponibile:
                problemi += 1
            nota = (
                f"  hamburger: marchio {pezzi['marchio']:.0f} + selettore "
                f"{pezzi['selettore']:.0f} + 44 = {barra_serve:.0f} su {disponibile:.0f}"
            )
        print(f"{w:5}px  {esito}{nota}")

    return 1 if problemi else 0


if __name__ == "__main__":
    sys.exit(main())
