#!/usr/bin/env python3
"""traccia — tiene il catalogo allineato alle pagine, nei due sensi.

Perché esiste: il catalogo delle lingue era una fotografia scattata una volta e
mai più rinnovata. Ne sono usciti due difetti che nessuno vede leggendo:

  * una frase italiana aggiunta in pagina dopo la fotografia non è nel
    catalogo, quindi resta italiana in `en/`, `de/` ed `es/` per sempre;
  * una frase tolta dalla pagina resta nel catalogo, e la sua traduzione è
    lavoro fatto e buttato via. Peggio: il test «nessuna chiave orfana» grida
    per aria finché qualcuno non lo zittisce, e da quel momento non lo legge
    più nessuno.

Lo strumento elenca quello che le pagine contengono davvero — nodi di testo,
`alt`, `aria-label`, `title`, `placeholder`, `<title>`, i metadati social e la
descrizione JSON-LD — e lo confronta con i cataloghi.

Uso:
    python3 tools/allinea_catalogo.py           # dice cosa manca e cosa avanza
    python3 tools/allinea_catalogo.py --pota    # toglie le chiavi orfane
    python3 tools/allinea_catalogo.py --aggiungi  # aggiunge all'italiano le
                                                  # frasi senza chiave, vuote
                                                  # nelle altre lingue
Le chiavi `--aggiungi` nascono con il valore italiano anche in en/de/es: è
voluto. Una traduzione vuota si vede subito e il test la segnala; una
traduzione inventata sembra fatta.
"""
from __future__ import annotations

import html as html_mod
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOGO = ROOT / "tools" / "i18n"
LINGUE = ("it", "en", "de", "es")

# Le pagine che hanno una versione in ogni lingua. `app.html` e `admin.html`
# restano fuori: sono l'area riservata e la console, leggono e scrivono dati, e
# si traducono quando si traduce ogni messaggio che il database restituisce.
PAGINE = [
    "index.html", "come-funziona.html", "casi.html", "crypto.html",
    "chi-siamo.html", "team.html", "onorari.html", "supporto.html",
    "login.html", "privacy.html", "termini.html", "cookie.html",
    "note-legali.html", "404.html",
]
PARTIAL = ["partials/header.html", "partials/footer.html", "partials/area-bar.html"]

# Testi che stanno nel catalogo e che nessuna pagina contiene come testo
# letterale: li compone lo script al momento.
COMPOSTI = {
    "Lingua / Language",
    "Bastano pochi dati. Ti ricontattiamo noi, senza password da scegliere.",
    "Segnala il tuo caso",
}

SALTA = ("script", "style", "code", "pre")
META = re.compile(
    r'<meta\s+(?:name|property)="'
    r'(description|og:title|og:description|og:image:alt|'
    r'twitter:title|twitter:description|twitter:image:alt)'
    r'"\s+content="([^"]*)"',
    re.I,
)


def _pulito(testo: str) -> str:
    return " ".join(html_mod.unescape(testo).split())


def _zone(testo: str) -> list[tuple[int, int]]:
    zone = []
    for tag in SALTA:
        for m in re.finditer(rf"<{tag}\b[^>]*>.*?</{tag}>", testo, re.S | re.I):
            zone.append((m.start(), m.end()))
    return zone


# C'è testo che non è una frase e non va tradotto: importi, percentuali, anni,
# codici pratica, sigle di due o tre lettere. Trattarli come traduzioni
# mancanti riempirebbe il rapporto di rumore — e un rapporto rumoroso è un
# rapporto che non si legge. La regola vale nei due sensi: quello che è dato
# non è una chiave orfana quando non compare più in pagina.
DATI = [
    re.compile(r"^[^\w]*[\d\s.,%€$+−–-]*[^\w]*$"),      # «12 %», «190 €», «2024», «404»
    re.compile(r"^[A-Z]{1,3}$"),                          # «IT», «MB», «EVM»
    re.compile(r"^[A-Z]+·? ?[A-Z]*$"),                    # sigle con separatore
    re.compile(r"^T-\d{4}( · \d{4})?$"),                 # codici pratica
    re.compile(r"^TRC-\d{4}-\d{2}( · dal \d{4})?$"),    # tessere del team
]


def e_dato(testo: str) -> bool:
    return any(r.match(testo) for r in DATI)


def stringhe(testo: str) -> list[str]:
    """Tutto ciò che un visitatore legge, nella forma in cui il catalogo lo tiene."""
    raccolte: list[str] = []
    zone = _zone(testo)

    for m in re.finditer(r">([^<>]+)<", testo):
        if any(a <= m.start(1) < b for a, b in zone):
            continue
        s = _pulito(m.group(1))
        if not s:
            continue
        if e_dato(s):
            continue
        raccolte.append(s)

    for m in re.finditer(r'\b(alt|aria-label|title|placeholder)="([^"]*)"', testo):
        s = _pulito(m.group(2))
        if s and not e_dato(s):
            raccolte.append(s)

    raccolte += [_pulito(m.group(1)) for m in re.finditer(r"<title>([^<]*)</title>", testo)]
    raccolte += [_pulito(m.group(2)) for m in META.finditer(testo)]
    raccolte += [_pulito(m.group(1)) for m in re.finditer(r'"description": "([^"]*)"', testo)]
    return [s for s in raccolte if s]


def stringhe_delle_pagine() -> dict[str, str]:
    """Testo → file in cui compare. Serve a dire dove aggiungere una chiave."""
    trovate: dict[str, str] = {}
    for nome in PAGINE + PARTIAL:
        percorso = ROOT / nome
        if not percorso.exists():
            continue
        for s in stringhe(percorso.read_text(encoding="utf-8")):
            trovate.setdefault(s, nome)
    return trovate


def leggi(lingua: str) -> dict[str, str]:
    dati = json.loads((CATALOGO / f"{lingua}.json").read_text(encoding="utf-8"))
    dati.pop("_meta", None)
    return dati


def scrivi(lingua: str, dati: dict[str, str]) -> None:
    percorso = CATALOGO / f"{lingua}.json"
    vecchio = json.loads(percorso.read_text(encoding="utf-8"))
    ordinate: dict[str, str] = {}
    if "_meta" in vecchio:
        ordinate["_meta"] = vecchio["_meta"]
    ordinate.update({k: dati[k] for k in sorted(dati)})
    percorso.write_text(json.dumps(ordinate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    pota = "--pota" in sys.argv
    aggiungi = "--aggiungi" in sys.argv
    testi = stringhe_delle_pagine()
    italiano = leggi("it")

    orfane = sorted(k for k in italiano
                    if k not in testi and k not in COMPOSTI and not e_dato(k))
    mancanti = sorted(s for s in testi
                      if s not in italiano and not s.startswith("{{") and not e_dato(s))

    if orfane:
        print(f"chiavi che nessuna pagina usa più: {len(orfane)}")
        for k in orfane:
            print(f"  - {k[:100]}")
    if mancanti:
        print(f"testi in pagina senza chiave italiana: {len(mancanti)}")
        for s in mancanti:
            print(f"  + {testi[s]}: {s[:100]}")
    if not orfane and not mancanti:
        print("catalogo e pagine sono allineati.")
        return 0

    for lingua in LINGUE:
        dati = leggi(lingua)
        if pota:
            for k in orfane:
                dati.pop(k, None)
        if aggiungi and lingua == "it":
            for s in mancanti:
                dati[s] = s
        elif aggiungi:
            # una frase nuova compare identica in tutte le lingue finché
            # qualcuno non la traduce: si vede, e il test la segnala
            for s in mancanti:
                dati[s] = s
        if pota or aggiungi:
            scrivi(lingua, dati)
            print(f"{lingua}: {len(dati)} chiavi")

    if not (pota or aggiungi):
        print("\nniente è stato cambiato: usa --pota per togliere le orfane, "
              "--aggiungi per aggiungere le mancanti.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
