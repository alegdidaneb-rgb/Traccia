#!/usr/bin/env python3
"""traccia — le fotografie del team, da un file qualsiasi a un asset del sito.

Perché uno script: una fotografia consegnata da un fotografo arriva a 3000×4000
e 6 MB. Messa così in una pagina, il ritratto di nove persone pesa più di tutto
il resto del sito, e su una connessione mobile la pagina del team si apre a
pezzi. Le immagini vanno quindi ritagliate quadrate sul volto, ridotte a due
misure, convertite in WebP con un JPEG di riserva, e private dei dati EXIF — che
contengono anche le coordinate di dove è stata scattata.

Uso:
    python3 tools/team_foto.py foto/*.jpg         # tutte le foto di una cartella
    python3 tools/team_foto.py foto/marta.jpg --nome marta-bellini
    python3 tools/team_foto.py --check            # mancano delle foto?

Il nome del file generato è quello che va scritto in `assets/js/team.js` nel
campo `foto`: `marta-bellini` diventa `marta-bellini-480.jpg` e `-960` per il
ritina. Il ritaglio si fa dal centro in alto (`gravity=north`) perché in un
ritratto la testa sta nella parte alta del fotogramma: ritagliando dal centro
geometrico si taglia la fronte e si tengono le spalle.

Se una foto manca, il sito non si rompe: `team.js` ha `foto: null` e la pagina
mostra le iniziali, che è già l'aspetto delle schede di oggi. Ma un ritratto
mancante in una pagina «persone» si nota, e `--check` serve a dirlo prima del
deploy invece che dopo.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "assets" / "img" / "team"

# Le due misure servono a questo: 480 per le schede, 960 per gli schermi ad alta
# densità e per la testata del profilo. Oltre i 960 un ritratto in una scheda
# non guadagna niente che l'occhio veda.
MISURE = [(480, 86), (960, 84)]
QUALITA_WEBP = 86
QUALITA_JPEG = 84


def pulisci_nome(testo: str) -> str:
    """«Marta Bellini» → «marta-bellini». Stessa regola dei campi `foto`."""
    import re
    import unicodedata

    testo = unicodedata.normalize("NFKD", testo).encode("ascii", "ignore").decode("ascii")
    testo = re.sub(r"[^a-zA-Z0-9]+", "-", testo).strip("-").lower()
    return testo


def genera(sorgente: pathlib.Path, nome: str) -> list[pathlib.Path]:
    DEST.mkdir(parents=True, exist_ok=True)
    prodotti: list[pathlib.Path] = []

    for lato, qualita in MISURE:
        base = DEST / f"{nome}-{lato}"

        # `-auto-orient` legge il tag EXIF di rotazione: senza, le foto scattate
        # in verticale con il telefono arrivano coricate.
        comune = [
            "convert", str(sorgente),
            "-auto-orient",
            # ritaglio quadrato dalla parte alta del fotogramma
            "-resize", f"{lato}x{lato}^",
            "-gravity", "north",
            "-extent", f"{lato}x{lato}",
            "-strip",                      # via EXIF, ICC e miniatura incorporata
            "-colorspace", "sRGB",
            "-quality", str(qualita),
        ]

        jpg = base.with_suffix(".jpg")
        subprocess.run(comune + [str(jpg)], check=True)
        prodotti.append(jpg)

        webp = base.with_suffix(".webp")
        subprocess.run(comune + ["-define", "webp:method=6", str(webp)], check=True)
        prodotti.append(webp)

    return prodotti


def main(argumenti: list[str]) -> int:
    if not argumenti:
        print(__doc__)
        return 1

    if argumenti[0] == "--check":
        mancanti = []
        for f in sorted(DEST.glob("*.webp")):
            lato = f.stem.rsplit("-", 1)[-1]
            if lato not in {str(m) for m, _ in MISURE}:
                mancanti.append(f.name)
        if not DEST.exists() or not any(DEST.glob("*.jpg")):
            print("Nessun ritratto in assets/img/team/: la pagina mostra le iniziali.")
            return 0
        if mancanti:
            print("File con una misura non prevista: " + ", ".join(mancanti))
            return 1
        print(f"Ritratti presenti: {len(list(DEST.glob('*-480.jpg')))}")
        return 0

    nome = None
    file = None
    i = 0
    while i < len(argumenti):
        if argumenti[i] == "--nome" and i + 1 < len(argumenti):
            nome = pulisci_nome(argumenti[i + 1])
            i += 2
        else:
            file = argumenti[i]
            i += 1

    if file is None:
        print("Serve una fotografia.")
        return 1

    sorgente = pathlib.Path(file)
    if not sorgente.exists():
        print(f"Non trovo {sorgente}")
        return 1

    if nome is None:
        nome = pulisci_nome(sorgente.stem)

    prodotti = genera(sorgente, nome)
    peso = sum(p.stat().st_size for p in prodotti)
    print(f"{nome}: {len(prodotti)} file, {peso / 1024:.0f} KB in tutto")
    for p in prodotti:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
