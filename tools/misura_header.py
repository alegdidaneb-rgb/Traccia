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
LARGHEZZE = [1440, 1361, 1360, 1280, 1221, 1024, 820, 481, 480, 390, 360]

# Le voci del menu, come le scrive `build_shell.voci_menu`. Se cambiano là,
# cambiano qui: sono il dato che rende utile la misura.
VOCI = [
    "Come funziona", "Casi seguiti", "Truffe cripto", "Chi siamo",
    "Il team", "Onorari", "Supporto",
]
PULSANTI = ["Accedi", "Segnala un caso"]
SIGLE = ["IT", "EN", "DE", "ES"]

# Padding e spaziature presi dal foglio di stile, in px.
PAD_PAGINA = 40          # --pad-x, clamp(1.25rem, 4vw, 2.5rem)
GAP_NAV = 24             # gap fra brand e menu, clamp(1rem, 3vw, 2.5rem)
NAV_LINK_PAD = 0.85 * 2 * 16   # .nav-link padding-inline
NAV_LINK_GAP = 0.25 * 16       # .nav__links gap
BTN_PAD = 0.95 * 2 * 16        # .btn padding, lato
BTN_GAP = 0.5 * 16             # .nav__actions gap
BTN_MARGIN = 0.9 * 16
LANG_OPT = 34 + 6              # .lang__opt min-width + padding
LANG_GAP = 2
LANG_PAD = 3 * 2
BRAND = 30 + 14 + 0.6 * 16 + 90  # marchio, spazio, «Traccia» a 1.2rem


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


def ingombro(larghezza: "callable", w: int) -> dict[str, float]:
    """Quanto occupa ogni pezzo della testata, in px, a una data larghezza.

    Sotto i 1360 il foglio di stile stringe il menu e i pulsanti: misurarli con
    le misure della scrivania darebbe un allarme falso, o peggio nasconderebbe
    un problema vero.
    """
    stretto = w <= 1360
    voce = 15  # --fs-small = .875rem ≈ 15px a 16px di base, arrotondato
    pad_link = (0.62 if stretto else 0.85) * 2 * 16
    pad_btn = (0.78 if stretto else 0.95) * 2 * 16
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
    # sotto i 480 il nome «Traccia» sparisce dal marchio (resta la «T»)
    brand = 26 if w <= 480 else BRAND

    menu = sum(larghezza(v, voce) + pad_link for v in VOCI) + NAV_LINK_GAP * (len(VOCI) - 1)
    pulsanti = sum(larghezza(p, 14) + pad_btn for p in PULSANTI) + BTN_GAP + BTN_MARGIN
    selettore = len(SIGLE) * larg_opt + LANG_GAP * (len(SIGLE) - 1) + LANG_PAD
    if w <= 480:
        selettore = len(SIGLE) * (26 + 8) + LANG_PAD
    return {"marchio": brand, "menu": menu, "selettore": selettore, "pulsanti": pulsanti}


def main() -> int:
    larghezza = misuratore(FONT)
    chiesti = [int(a) for a in sys.argv[1:] if a.isdigit()] or LARGHEZZE
    problemi = 0

    print("Ingombro della testata (px, misurati sul font Inter Variable)\n")
    for w in chiesti:
        pezzi = ingombro(larghezza, w)
        disponibile = w - PAD_PAGINA
        if w > 1360:
            # menu in riga: deve starci tutto
            serve = sum(pezzi.values()) + GAP_NAV
            esito = "sta" if serve <= disponibile else f"SBORDA di {serve - disponibile:.0f}px"
            if serve > disponibile:
                problemi += 1
            nota = f"  menu in riga, servono {serve:.0f} su {disponibile:.0f}"
        else:
            # menu nel pannello: in barra restano marchio, selettore, hamburger
            barra = pezzi["marchio"] + pezzi["selettore"] + 44 + GAP_NAV * 2
            esito = "sta" if barra <= disponibile else f"SBORDA di {barra - disponibile:.0f}px"
            if barra > disponibile:
                problemi += 1
            nota = (
                f"  hamburger: marchio {pezzi['marchio']:.0f} + selettore "
                f"{pezzi['selettore']:.0f} + 44 = {barra:.0f} su {disponibile:.0f}"
            )
        print(f"{w:5}px  {esito}{nota}")

    return 1 if problemi else 0


if __name__ == "__main__":
    sys.exit(main())
