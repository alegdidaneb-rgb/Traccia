#!/usr/bin/env python3
"""traccia — intestazione e piè di pagina da un'unica fonte.

Il problema che risolve: 14 pagine portavano ciascuna una copia dell'header e
del footer. Ogni ritocco (un numero di telefono, un'eccezione legale, una voce
di menu) andava ripetuto quattordici volte e bastava dimenticarne una perché le
pagine dicessero cose diverse. È già successo: una sanificazione delle
affermazioni non verificabili ha dovuto toccare 14 file a mano.

Come funziona: i blocchi comuni stanno in `partials/`. Questo script li cuce
dentro le pagine, tra marcatori che non intaccano l'HTML:

    <!-- shell:header -->  ...  <!-- /shell:header -->

Dentro la pagina resta HTML vero, quindi il sito continua a essere statico:
nessun `fetch`, nessun JavaScript in più da scaricare, nessun lampo di pagina
vuota. Si modifica `partials/`, si esegue `python3 tools/build_shell.py` e le
pagine si aggiornano.

La voce di menu della pagina corrente si deduce dal nome del file, quindi non
va più scritta a mano: `is-active` e `aria-current="page"` li mette lo script.

Uso:
    python3 tools/build_shell.py            # riscrive le pagine
    python3 tools/build_shell.py --check    # esce 1 se una pagina è disallineata
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARTIALS = ROOT / "partials"

SEGNA_INIZIO = "<!-- shell:header -->"
SEGNA_FINE = "<!-- /shell:header -->"
SEGNA_INIZIO_FOOTER = "<!-- shell:footer -->"
SEGNA_FINE_FOOTER = "<!-- /shell:footer -->"

# Pagine con l'intestazione pubblica completa.
PAGINE_PUBBLICHE = [
    "index.html", "come-funziona.html", "casi.html", "crypto.html",
    "chi-siamo.html", "onorari.html", "supporto.html", "login.html",
    "privacy.html", "termini.html", "cookie.html", "note-legali.html",
    "404.html", "admin.html",
]

# L'area riservata ha una barra propria: non è un errore che sia diversa,
# ma deve comunque venire da un solo posto.
PAGINE_AREA = ["app.html"]


def leggi(nome: str) -> str:
    return (PARTIALS / nome).read_text(encoding="utf-8").rstrip() + "\n"


def voci_menu() -> list[tuple[str, str, str]]:
    """(chiave, etichetta, file) — l'ordine è quello che si vede nel menu."""
    return [
        ("come-funziona", "Come funziona", "come-funziona.html"),
        ("casi", "Casi seguiti", "casi.html"),
        ("crypto", "Truffe cripto", "crypto.html"),
        ("chi-siamo", "Chi siamo", "chi-siamo.html"),
        ("onorari", "Onorari", "onorari.html"),
        ("supporto", "Supporto", "supporto.html"),
    ]


def nav_links(pagina: str) -> str:
    righe = []
    for chiave, etichetta, file in voci_menu():
        attiva = pagina == file
        classe = "nav-link is-active" if attiva else "nav-link"
        corrente = ' aria-current="page"' if attiva else ""
        righe.append(
            f'        <li><a class="{classe}" data-nav="{chiave}" '
            f'href="{file}"{corrente}>{etichetta}</a></li>'
        )
    return "\n".join(righe)


def costruisci_header(pagina: str) -> str:
    return leggi("header.html").replace("{{nav_links}}", nav_links(pagina))


def sostituisci(html: str, inizio: str, fine: str, nuovo: str) -> str:
    """Riscrive il blocco tra i due marcatori.

    I marcatori restano al loro posto: se sparissero, la build successiva non
    troverebbe più dove intervenire e si fermerebbe (o peggio, duplicherebbe
    l'header). Quindi si ricostruisce sempre `inizio … contenuto … fine`.
    """
    i = html.find(inizio)
    j = html.find(fine)
    if i == -1 or j == -1 or j < i:
        raise SystemExit(f"  marcatori mancanti: {inizio} … {fine}")
    return (
        html[:i] + inizio + "\n" + nuovo.rstrip("\n") + "\n  " + fine
        + html[j + len(fine):]
    )


def main() -> int:
    check = "--check" in sys.argv
    footer = leggi("footer.html")
    area_bar = leggi("area-bar.html")
    modificati, disallineati = [], []

    for pagina in PAGINE_PUBBLICHE:
        percorso = ROOT / pagina
        if not percorso.exists():
            continue
        prima = percorso.read_text(encoding="utf-8")
        dopo = sostituisci(prima, SEGNA_INIZIO, SEGNA_FINE, costruisci_header(pagina))
        dopo = sostituisci(dopo, SEGNA_INIZIO_FOOTER, SEGNA_FINE_FOOTER, footer)
        if dopo != prima:
            disallineati.append(pagina)
            if not check:
                percorso.write_text(dopo, encoding="utf-8")
                modificati.append(pagina)

    for pagina in PAGINE_AREA:
        percorso = ROOT / pagina
        if not percorso.exists():
            continue
        prima = percorso.read_text(encoding="utf-8")
        dopo = sostituisci(prima, SEGNA_INIZIO, SEGNA_FINE, area_bar)
        if dopo != prima:
            disallineati.append(pagina)
            if not check:
                percorso.write_text(dopo, encoding="utf-8")
                modificati.append(pagina)

    if check:
        if disallineati:
            print("Pagine disallineate da partials/:")
            for p in disallineati:
                print("  · " + p)
            print("\nEsegui: python3 tools/build_shell.py")
            return 1
        print("Tutte le pagine sono allineate a partials/.")
        return 0

    if not modificati:
        print("Nessuna modifica: le pagine erano già allineate.")
    else:
        print(f"Aggiornate {len(modificati)} pagine da partials/:")
        for p in modificati:
            print("  · " + p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
