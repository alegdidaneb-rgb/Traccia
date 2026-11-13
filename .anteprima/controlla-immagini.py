#!/usr/bin/env python3
"""Controlla che **ogni** immagine chiesta dalle pagine risponda, non solo quelle
citate in `src`.

Perché non basta il test della suite: il test guarda l'HTML e il disco, e non
vede due cose che succedono solo quando il browser chiede davvero il file —
un `srcset` con un indirizzo relativo su una pagina tradotta, e una cartella
che esiste sul disco ma non è nel repository. Le ho trovate entrambe così:
servendo le pagine e chiedendo le immagini una per una.

Uso (con l'anteprima accesa):
    python3 .anteprima/controlla-immagini.py http://127.0.0.1:8080
"""
from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
SALTA = {"node_modules", "assets", "supabase", "tools", ".anteprima", ".git"}


def pagine() -> list[Path]:
    out = []
    for percorso in ROOT.rglob("*.html"):
        if any(parte in SALTA or parte.startswith(".") for parte in percorso.relative_to(ROOT).parts[:-1]):
            continue
        out.append(percorso)
    return sorted(out)


def indirizzi(html: str, base: str) -> set[str]:
    radice = base.split("//")[0] + "//" + base.split("//")[1].split("/")[0] + "/"
    """Tutti gli indirizzi di immagine di una pagina: `src`, `srcset` e `<source>`."""
    trovati: set[str] = set()
    for m in re.finditer(r'\bsrc="([^"]+)"', html):
        trovati.add(urljoin(base, m.group(1)))
    for m in re.finditer(r'\bsrcset="([^"]*)"', html):
        for pezzo in m.group(1).split(","):
            url = pezzo.strip().split()[0] if pezzo.strip() else ""
            if url:
                trovati.add(urljoin(base, url))
    # solo le immagini di questo sito: gli indirizzi esterni non si provano
    return {u for u in trovati if u.startswith(radice)}


def stato(url: str) -> int:
    richiesta = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(richiesta, timeout=10) as risposta:
            return risposta.status
    except urllib.error.HTTPError as errore:
        return errore.code
    except Exception:
        return 0


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/") + "/"
    totale, rotte = 0, []
    for percorso in pagine():
        relativo = percorso.relative_to(ROOT).as_posix()
        with urllib.request.urlopen(base + relativo, timeout=10) as risposta:
            html = risposta.read().decode("utf-8", "replace")
        for url in sorted(indirizzi(html, base + relativo)):
            totale += 1
            codice = stato(url)
            if codice != 200:
                rotte.append(f"{relativo} → {url.replace(base, '')} {codice}")

    print(f"pagine: {len(pagine())} · immagini controllate: {totale} · rotte: {len(rotte)}")
    for r in rotte[:20]:
        print("  ·", r)
    return 1 if rotte else 0


if __name__ == "__main__":
    sys.exit(main())
