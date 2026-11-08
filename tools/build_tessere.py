#!/usr/bin/env python3
"""traccia — una tessera interna per ogni persona del team.

Perché non una carta d'identità. Una CIE è un documento dello Stato: emblema
della Repubblica, numero di serie, chip, codice MRZ, ologramma. Riprodurla,
anche per persone inventate, produce qualcosa che alla vista è indistinguibile
da un documento falso — e su un sito pubblico non è una scelta grafica, è un
problema. Qui c'è l'opposto: una tessera di ufficio, che dichiara sé stessa.

Cosa dice la tessera, e cosa non dice:

  · nome, ruolo, «nell'ufficio dal» — dagli stessi dati della pagina del team;
  · un numero interno progressivo (`TRC-2019-01`), che non è un codice fiscale
    e non ha validità fuori da questa scrivania;
  · le lingue di lavoro e il ruolo di controllo, dove c'è;
  · la riga «Tessera interna — non è un documento di identità», stampata sulla
    tessera e non solo nella didascalia sotto.

Non c'è, di proposito: nessun simbolo dello Stato, nessun chip, nessun codice a
barre o MRZ, nessuna banda olografica, nessuna data di nascita, nessun luogo di
nascita, nessun indirizzo. Sono i campi che rendono un'immagine un documento.

Il numero interno nasce dall'ordine dei dati: chi è entrato prima ha il numero
più basso. Se qualcuno cambia `dal` in `team.js`, il numero lo segue — meglio di
un contatore a parte, che resta fermo mentre le persone cambiano.

Uso:
    python3 tools/build_tessere.py            # riscrive la sezione in team.html
    python3 tools/build_tessere.py --check    # esce 1 se la sezione è disallineata

Il file è gemello di `build_team.py` e condivide la lettura dei dati: nessuno
dei due scrive dentro i marcatori dell'altro.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from build_team import cartella_asset, esc, leggi_dati  # noqa: E402  (dipendenza voluta: una sola lettura dei dati)

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGINA = ROOT / "team.html"
INIZIO = "<!-- team:tessere -->"
FINE = "<!-- /team:tessere -->"

# Le lingue si dichiarano per esteso nei dati, sulla tessera si abbreviano:
# è una tessera, non una biografia.
CODICE_LINGUA = {
    "Italiano": "IT",
    "Inglese": "EN",
    "Francese": "FR",
    "Spagnolo": "ES",
    "Tedesco": "DE",
    "Portoghese": "PT",
}


def numero_interno(persone: list[dict]) -> dict[str, str]:
    """`TRC-<anno di ingresso>-<progressivo dentro quell'anno>`.

    Il progressivo è per anno, non globale: `TRC-2019-01` e `TRC-2019-02` sono i
    due che c'erano nel 2019, e leggendo la tessera si capisce da quanto uno è
    lì senza contare. L'ordine dentro l'anno è quello dei dati, che è stabile
    finché nessuno riordina l'array senza motivo.
    """
    contatori: dict[int, int] = {}
    numeri: dict[str, str] = {}
    for p in persone:
        anno = int(p["dal"])
        contatori[anno] = contatori.get(anno, 0) + 1
        numeri[p["id"]] = f"TRC-{anno}-{contatori[anno]:02d}"
    return numeri


def ritratto_tessera(p: dict) -> str:
    """Il ritratto in formato tessera: quadrato, piccolo, con le iniziali di
    riserva come nella pagina. Le due misure servono a non scaricare il 960 su
    una tessera da 96 px."""
    if not p.get("foto"):
        return ('<span class="tessera__foto tessera__foto--iniziali" '
                'aria-hidden="true">' + esc(p["iniziali"]) + "</span>")
    base = esc(p["foto"])
    return (
        '<picture class="tessera__foto">\n'
        '            <source type="image/webp" '
        f'srcset="{cartella_asset()}{base}-480.webp 480w" sizes="96px">\n'
        f'            <img src="{cartella_asset()}{base}-480.jpg" '
        f'srcset="{cartella_asset()}{base}-480.jpg 480w" sizes="96px" '
        f'alt="Ritratto di {esc(p["nome"])}" width="480" height="480" '
        'loading="lazy" decoding="async">\n'
        "          </picture>"
    )


def tessera(p: dict, numero: str) -> str:
    """Il corpo di una tessera.

    La composizione è quella dei badge da collo, non quella di un documento:
    ritratto centrato in alto, nome sotto, ruolo sotto ancora, e le aree di
    lavoro come etichette. Il primo tentativo metteva ritratto e nome sulla
    stessa riga come una scheda: lasciava un vuoto di duecento pixel in mezzo,
    perché una tessera verticale ha più altezza che contenuto. Qui il contenuto
    scende e il vuoto sparisce senza aggiungere niente che non sia un dato.
    """
    lingue = " ".join(
        CODICE_LINGUA.get(l, l[:2].upper()) for l in p.get("lingue", [])
    )
    aree = "".join(f'<span class="tessera__area">{esc(a)}</span>'
                   for a in p.get("aree", []))
    revisione = ""
    if p.get("revisione"):
        revisione = ('\n            <p class="tessera__revisione">'
                     f'{esc(p["revisione"])}</p>')
    return f"""<li class="tessera">\n        <a class="tessera__link" href="#{esc(p['id'])}" data-persona="{esc(p['id'])}">
          <div class="tessera__alto">
            <span class="tessera__marchio">Traccia</span>
            <span class="tessera__numero">{esc(numero)}</span>
          </div>
          {ritratto_tessera(p)}
          <div class="tessera__anagrafica">
            <p class="tessera__nome">{esc(p['nome'])}</p>
            <p class="tessera__ruolo">{esc(p['ruolo'])}</p>
            <p class="tessera__dal">Nell'ufficio dal {p['dal']}</p>{revisione}
          </div>
          <div class="tessera__aree">{aree}</div>
          <div class="tessera__basso">
            <span class="tessera__lingue">Lingue di lavoro <b>{esc(lingue)}</b></span>
            <span class="tessera__avvertenza">Tessera interna — non è un documento di identità</span>
          </div>
        </a>
        </li>"""


def costruisci() -> str:
    persone = leggi_dati()
    attuale = PAGINA.read_text(encoding="utf-8")
    if INIZIO not in attuale or FINE not in attuale:
        raise SystemExit(
            "team.html non contiene i marcatori " + INIZIO + " / " + FINE +
            ": la sezione delle tessere va inserita una volta sola a mano, "
            "poi la riscrive questo script."
        )
    numeri = numero_interno(persone)
    # In pagina le tessere si leggono in ordine di arrivo in ufficio, non
    # nell'ordine dell'array: così i numeri crescono da sinistra a destra e la
    # sezione è una scala di anzianità. L'ordine dei *profili* resta quello dei
    # dati, che è un'altra cosa — lì conta chi coordina, qui conta da quando.
    ordinate = sorted(persone, key=lambda p: (int(p["dal"]), numeri[p["id"]]))
    voci = "\n        ".join(tessera(p, numeri[p["id"]]) for p in ordinate)
    prima, resto = attuale.split(INIZIO, 1)
    _, dopo = resto.split(FINE, 1)
    return prima + INIZIO + "\n        " + voci + "\n        " + FINE + dopo


def main(argomenti: list[str]) -> int:
    nuovo = costruisci()
    vecchio = PAGINA.read_text(encoding="utf-8")
    if "--check" in argomenti:
        if nuovo != vecchio:
            print("la sezione delle tessere non è allineata a assets/js/team.js: "
                  "esegui python3 tools/build_tessere.py")
            return 1
        print("tessere allineate a assets/js/team.js.")
        return 0
    if nuovo != vecchio:
        PAGINA.write_text(nuovo, encoding="utf-8")
        print(f"tessere riscritte in team.html: {len(leggi_dati())} persone.")
    else:
        print("tessere già allineate.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
