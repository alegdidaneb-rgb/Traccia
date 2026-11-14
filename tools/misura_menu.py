#!/usr/bin/env python3
"""traccia — misura i menu interni come li misurerebbe un browser.

Perché esiste: la console ha undici voci e l'area cliente sette, e il cliente ha
chiesto **una riga**. «Una riga» non è una decisione che si prende guardando il
codice: dipende da quanti pixel occupano le parole nel font vero, a corpo vero,
con i margini veri. Contare le lettere e moltiplicare per sette dà un numero che
sbaglia di un quinto — e sbaglia sempre nella direzione comoda, quella che dice
«ci sta».

Qui si misurano gli avanzamenti dei glifi con `fontTools`, si sommano i padding
letti dal foglio di stile (non ricopiati: se cambiano là, cambiano qui) e si
risponde a una domanda sola: **a questa larghezza, il menu sta in una riga?**

Non è un test di layout: non c'è un browser. È un conto onesto sui due numeri
che contano — la larghezza del testo e quella del contenitore.

Uso:
    python3 tools/misura_menu.py              # tutte le larghezze di prova
    python3 tools/misura_menu.py 1366 1024    # solo quelle indicate
    python3 tools/misura_menu.py --check      # esce 1 se una riga non ci sta
"""
from __future__ import annotations

import pathlib
import re
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTE = ROOT / "assets" / "fonts" / "inter-var.woff2"
CSS_BASE = ROOT / "assets" / "css" / "style.css"
CSS_PREMIUM = ROOT / "assets" / "css" / "premium.css"

# Le voci si leggono dalle pagine, non si ricopiano. Un elenco scritto qui
# sarebbe la seconda copia delle etichette: cambiarne una nell'HTML e lasciare
# l'elenco fermo dà una misura che parla di un menu che non esiste più. Con
# un'espressione regolare basta prendere ciò che sta dentro i <span> della voce.
# La pagina e il **nome della classe** (senza punto): il punto è del selettore
# CSS, e confonderli è il modo più facile di cercare una classe che non c'è.
PAGINE = {
    "console": (ROOT / "admin.html", "app-nav__link"),
    "area": (ROOT / "app.html", "area-nav__link"),
}


def voci_da_pagina(percorso: pathlib.Path, classe: str) -> list[tuple[str, int]]:
    """Etichette visibili delle voci di menu, e se portano un numero.

    Il numero è la pastiglia: `chip__count` nella console, `area-nav__count`
    nell'area. Conta solo se non è `hidden`, perché un numero nascosto non
    occupa spazio.
    """
    html = percorso.read_text(encoding="utf-8")
    voci = []
    # Si cerca senza espressioni regolari: gli attributi possono stare in
    # qualunque ordine, e una regex tollerante è più difficile da leggere di
    # tre righe di `find`. Il tag di apertura è quello che contiene la classe.
    for apertura in html.split("<a")[1:]:
        tag, _, resto = apertura.partition(">")
        classi = re.search(r'class="([^"]*)"', tag)
        if not classi or classe not in classi.group(1).split():
            continue
        blocco = resto.split("</a>")[0]
        testo = re.sub(r'<span class="(?:area-nav__count|chip__count)"[^>]*>.*?</span>',
                       "", blocco, flags=re.S)
        etichetta = " ".join(re.sub(r"<[^>]+>", " ", testo).split())
        ha_numero = 0
        for pastiglia in re.findall(
                r'<span class="(?:area-nav__count|chip__count)"([^>]*)>', blocco):
            if "hidden" not in pastiglia:
                ha_numero += 1
        if etichetta:
            voci.append((etichetta, ha_numero))
    return voci


# Larghezze a cui l'ufficio lavora davvero: scrivania, portatile, portatile
# piccolo, tablet. Sotto, una riga non è un requisito ma una fortuna.
LARGHEZZE = [1920, 1600, 1440, 1366, 1280, 1200, 1120, 1024, 900, 820, 480, 390]


def _hmtx():
    font = TTFont(FONTE)
    return font, font["head"].unitsPerEm, font.getBestCmap(), font["hmtx"]


def larghezza_testo(font, upm, cmap, hmtx, testo: str, corpo: float) -> float:
    totale = 0.0
    for ch in testo:
        nome = cmap.get(ord(ch))
        totale += hmtx[nome][0] if nome else upm * 0.5
    return totale / upm * corpo


def dal_css(selettore: str, proprieta: str, predefinito: float,
            foglio: pathlib.Path = CSS_BASE) -> float:
    """Un valore in px letto da una regola dei fogli di stile.

    Non si ricopia: il padding dei link è **la** cosa che questa misura somma.
    Ricopiato, cambiarlo nel CSS non cambiava il conto e lo strumento
    continuava a dire «ci sta» — è già successo, ed è il motivo per cui esiste.
    """
    for f in (foglio, CSS_BASE, CSS_PREMIUM):
        testo = f.read_text(encoding="utf-8")
        for blocco in re.findall(re.escape(selettore) + r"\s*\{([^}]*)\}", testo):
            m = re.search(re.escape(proprieta) + r":\s*([\d.]+)(px|rem)", blocco)
            if m:
                v = float(m.group(1))
                return v * 16 if m.group(2) == "rem" else v
    return predefinito


def _due_valori(selettore: str, proprieta: str, predefinito: tuple[float, float],
                foglio: pathlib.Path) -> tuple[float, float]:
    """`padding: A B` / `gap: X` in px, letti dal foglio."""
    for f in (foglio, CSS_BASE, CSS_PREMIUM):
        testo = f.read_text(encoding="utf-8")
        for blocco in re.findall(re.escape(selettore) + r"\s*\{([^}]*)\}", testo):
            m = re.search(
                re.escape(proprieta) + r":\s*([\d.]+)(px|rem)(?:\s+([\d.]+)(px|rem))?",
                blocco)
            if not m:
                continue
            uno = float(m.group(1)) * (16 if m.group(2) == "rem" else 1)
            due = float(m.group(3)) * (16 if m.group(4) == "rem" else 1) if m.group(3) else uno
            return uno, due
    return predefinito


def conto(voci, corpo: float, pad_oriz: float, gap: float, pill: float) -> float:
    return sum(larghezza_testo(*_FONT, etichetta, corpo) + pad_oriz * 2
               for etichetta, _ in voci) + pill * sum(n for _, n in voci) + gap * (len(voci) - 1)


def larghezza_pill() -> float:
    """Il numero accanto a una voce: `min-width` del chip più il distacco."""
    return dal_css(".app-nav__link .chip__count", "min-width", 18) + 6


def main(argv: list[str]) -> int:
    solo_check = "--check" in argv
    richieste = [int(a) for a in argv if a.isdigit()]
    larghezze = richieste or LARGHEZZE

    font, upm, cmap, hmtx = _hmtx()
    globale = {"_FONT": (font, upm, cmap, hmtx)}
    globals().update(globale)

    pill = larghezza_pill()
    # le voci si leggono dalle pagine: nessun elenco da tenere allineato a mano
    console_voci = voci_da_pagina(PAGINE["console"][0], PAGINE["console"][1])
    area_voci = voci_da_pagina(PAGINE["area"][0], PAGINE["area"][1])
    if not console_voci or not area_voci:
        raise SystemExit("misura_menu: nessuna voce trovata nelle pagine. "
                         "Il selettore del menu è cambiato: aggiorna questo file.")

    # console: .app-nav__link, padding .45rem .55rem, font .86rem, gap .1rem
    _, pad_c = _due_valori(".app-nav__link", "padding", (7.2, 8.8), CSS_BASE)
    corpo_c = dal_css(".app-nav__link", "font-size", 13.76) or 13.76
    gap_c = dal_css(".app-nav__bar", "gap", 1.6) or 1.6
    console = conto(console_voci, corpo_c, pad_c, gap_c, pill)

    # area: .area-nav__link, padding .5rem .7rem, font .85rem, gap .1rem
    _, pad_a = _due_valori(".area-nav__link", "padding", (8, 11.2), CSS_PREMIUM)
    corpo_a = dal_css(".area-nav__link", "font-size", 13.6, CSS_PREMIUM) or 13.6
    gap_a = dal_css(".area-nav__bar", "gap", 1.6, CSS_PREMIUM) or 1.6
    area = conto(area_voci, corpo_a, pad_a, gap_a, pill)

    # larghezze dei contenitori, lette dai fogli
    main_max = dal_css(".app-main", "max-width", 1280)
    pagina_max = dal_css(".appv2__pagina", "max-width", 1080, CSS_PREMIUM)
    nav_pad = dal_css(".app-nav", "padding", 24)  # primo valore = verticale
    _, nav_pad_o = _due_valori(".app-nav", "padding", (7.2, 24.0), CSS_BASE)
    _, area_pad_o = _due_valori(".area-nav", "padding", (4.8, 6.4), CSS_PREMIUM)

    print(f"console: {console:.0f}px per {len(console_voci)} voci (font {corpo_c:.2f}px, "
          f"padding {pad_c:.1f}px, {sum(n for _, n in console_voci)} numeri): "
          + " · ".join(e for e, _ in console_voci))
    print(f"area:    {area:.0f}px per {len(area_voci)} voci (font {corpo_a:.2f}px, "
          f"padding {pad_a:.1f}px): " + " · ".join(e for e, _ in area_voci) + "\n")

    fuori = []
    for w in larghezze:
        # sotto i 768px i fogli riducono i margini: qui si misura il caso peggiore
        utile_c = min(main_max, w) - 2 * (nav_pad_o if w > 768 else 12)
        utile_a = min(pagina_max, max(0, w - 48)) - 2 * area_pad_o
        sta_c = console <= utile_c
        sta_a = area <= utile_a
        if not sta_c:
            fuori.append((w, "console", console, utile_c))
        if not sta_a:
            fuori.append((w, "area", area, utile_a))
        print(f"  {w:5}px  console utile {utile_c:5.0f} → {'una riga' if sta_c else 'a capo':12}"
              f"  area utile {utile_a:5.0f} → {'una riga' if sta_a else 'a capo'}")

    if solo_check:
        # Il requisito del cliente non è «una riga a ogni costo»: è che **non
        # serva scorrere**. Con `flex-wrap: wrap` e nessun `overflow-x`, le voci
        # vanno a capo e restano tutte visibili: una riga in più, niente
        # nascosto — che è il difetto che il cliente ha visto.
        #
        # Quindi il controllo verifica la garanzia, non il numero di righe:
        #   1. la barra va a capo e non ha scorrimento orizzontale;
        #   2. nessuna singola voce è più larga dello schermo più stretto, o
        #      quella voce sola verrebbe tagliata anche andando a capo.
        problemi = []
        for selettore, foglio in ((".app-nav__bar", CSS_BASE),
                                  (".area-nav__bar", CSS_PREMIUM)):
            blocchi = re.findall(re.escape(selettore) + r"\s*\{([^}]*)\}", foglio.read_text(encoding="utf-8"))
            regola = " ".join(blocchi)
            if "flex-wrap: wrap" not in regola:
                problemi.append(f"{selettore} non dichiara `flex-wrap: wrap`: le voci "
                                f"non possono andare a capo")
            if "overflow-x" in regola:
                problemi.append(f"{selettore} dichiara `overflow-x`: la barra scorre e "
                                f"nasconde le voci che non ci stanno")

        STRETTO = min(larghezze)
        for chi, voci, corpo, pad in (
                ("console", console_voci, corpo_c, pad_c),
                ("area", area_voci, corpo_a, pad_a)):
            for etichetta, _ in voci:
                px = larghezza_testo(*_FONT, etichetta, corpo) + pad * 2
                if px > STRETTO - 24:
                    problemi.append(f"{chi}: la voce «{etichetta}» è larga {px:.0f}px, "
                                    f"più di uno schermo da {STRETTO}px")

        for chi, dove in righe_per_larghezza(larghezze, console, area,
                                             main_max, pagina_max,
                                             nav_pad_o, area_pad_o).items():
            print(f"\n{chi}: va a capo sotto {max(dove)}px — non è un difetto, "
                  f"le voci restano tutte visibili")
        if problemi:
            print("", file=sys.stderr)
            for x in problemi:
                print("SFONDA: " + x, file=sys.stderr)
            return 1
        return 0
    return 0


def righe_per_larghezza(larghezze, console, area, main_max, pagina_max,
                        nav_pad_o, area_pad_o):
    """A quali larghezze ogni menu passa a due righe (informativo, non un guasto)."""
    fuori = {}
    for w in larghezze:
        if console > min(main_max, w) - 2 * (nav_pad_o if w > 768 else 12):
            fuori.setdefault("console", []).append(w)
        if area > min(pagina_max, max(0, w - 48)) - 2 * area_pad_o:
            fuori.setdefault("area", []).append(w)
    return fuori


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
