#!/usr/bin/env python3
"""traccia — la misurazione delle campagne (Google Tag Manager), da un solo posto.

Perché non si incolla lo snippet a mano nelle pagine: le pagine si
rigenerano. `build_shell.py` riscrive header e piè di pagina, `build_i18n.py`
riscrive `en/ de/ es/` partendo dalle pagine italiane, `versione_asset.py`
riscrive tutti gli indirizzi di CSS e JS. Uno snippet incollato a mano in 58
file sopravvive fino alla prima rigenerazione e poi sparisce da quelli che
nessuno ha ricontrollato — e un sito che misura solo metà delle pagine non si
distingue da un sito che non misura, finché non si guardano i numeri e non
tornano.

Qui la testa di ogni pagina viene **riscritta a ogni giro**:

    <!-- shell:misurazione -->  …  <!-- /shell:misurazione -->

Come per header e footer, i marcatori restano al loro posto. Il generatore è
idempotente: se la pagina è già giusta non la tocca (`--check` esce 0).

**Perché script esterni e non `window.dataLayer` bell'e pronto in pagina**: la
policy di sicurezza (`vercel.json`, `script-src`) ammette script del sito e
deve ammettere `googletagmanager.com`, altrimenti il browser blocca GTM, la
CSP scrive l'errore solo nella console di chi apre gli strumenti e il sito
sembra misurare senza misurare niente.

**Perché il `<noscript>` in `<body>`**: c'è chi naviga senza JavaScript. Non
è la maggioranza, ma è l'unica fetta di traffico che senza quel tag non
compare da nessuna parte.

Uso:
    python3 tools/misurazione.py            # riscrive le pagine
    python3 tools/misurazione.py --check    # esce 1 se una pagina è indietro
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Una sola formula per l'impronta degli asset, in un solo posto: due calcoli
# diversi produrrebbero pagine che si rimandano la colpa a vicenda.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from versione_asset import impronta  # noqa: E402
CONFIG = ROOT / "tools" / "misurazione.json"

SEGNA_INIZIO = "<!-- shell:misurazione -->"
SEGNA_FINE = "<!-- /shell:misurazione -->"

# Le pagine che vengono servite. `admin.html` e `app.html` comprese: sono
# l'area riservata, e sapere quante persone aprono la console è esattamente
# ciò che dice se un lead è stato lavorato.
PAGINE = [
    "index.html", "come-funziona.html", "casi.html", "crypto.html",
    "chi-siamo.html", "team.html", "onorari.html", "supporto.html",
    "login.html", "privacy.html", "termini.html", "cookie.html",
    "note-legali.html", "404.html", "app.html", "admin.html",
]
# Le pagine tradotte non hanno l'area riservata: `app.html` e `admin.html`
# esistono solo in italiano. Chiederne una copia in tedesco e segnalarla come
# «mancante» a ogni giro vorrebbe dire un avviso che si impara a ignorare.
TRADOTTE = [p for p in PAGINE if p not in ("app.html", "admin.html")]
LINGUE = ["en", "de", "es"]


def identificatori() -> tuple[str, str]:
    dati = json.loads(CONFIG.read_text(encoding="utf-8"))
    return (dati.get("gtm") or "").strip(), (dati.get("ga4") or "").strip()


def blocco_testa(gtm: str, ga4: str, versione: str, prefisso: str = "") -> str:
    """Il codice che va in `<head>`, il più in alto possibile.

    GTM deve stare **prima** di ogni altro script: se parte dopo, il primo
    clic dell'annuncio può arrivare quando il contenitore non è ancora
    inizializzato e la visita non viene attribuita.
    """
    if not gtm and not ga4:
        return ""

    righe = [SEGNA_INIZIO]
    # `assets/<impronta>/` non è in nessuna cache: è il motivo per cui la
    # cartella ha un nome che cambia. L'impronta la calcola `versione_asset.py`
    # sulla stessa formula, altrimenti `versione_asset.py --check` direbbe che
    # le pagine sono indietro dopo che questo script le ha appena riscritte.
    if gtm:
        righe.append(
            f'  <script>(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{\'gtm.start\':'
            f"new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],"
            f"j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src="
            f"'https://www.googletagmanager.com/gtm.js?id='+i+dl;"
            f"f.parentNode.insertBefore(j,f);}})(window,document,'script','dataLayer','{gtm}');"
            f"</script>"
        )
    if ga4:
        righe.append(
            f'  <script async src="https://www.googletagmanager.com/gtag/js?id={ga4}"></script>'
        )
        righe.append(
            "  <script>window.dataLayer=window.dataLayer||[];"
            "function gtag(){dataLayer.push(arguments);}gtag('js',new Date());"
            f"gtag('config','{ga4}');</script>"
        )
    # Ultimo, e non primo: l'evento `lead` deve trovare il `dataLayer` che il
    # contenitore ha appena creato. Prima di GTM finirebbe in un array che
    # nessuno legge.
    if gtm or ga4:
        # `prefisso` è `/` nelle pagine tradotte: `build_i18n.py` porta gli
        # indirizzi degli asset alla radice assoluta, perché `de/index.html`
        # sta in una cartella e `assets/…` relativo punterebbe a
        # `de/assets/…`. Generare qui sempre la forma relativa faceva
        # risultare «vecchie» tutte e 42 le pagine a ogni giro.
        righe.append(
            f'  <script src="{prefisso}assets/{versione}/js/conversione.js" defer></script>'
        )
    righe.append("  " + SEGNA_FINE)
    return "\n".join(righe)





def blocco_corpo(gtm: str) -> str:
    """Il `<noscript>` di GTM: va subito dopo `<body>`, non in `<head>`."""
    if not gtm:
        return ""
    return (
        "<!-- Google Tag Manager (noscript) -->\n"
        f'<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={gtm}"'
        ' height="0" width="0" style="display:none;visibility:hidden"'
        ' title="Google Tag Manager"></iframe></noscript>\n'
        "<!-- End Google Tag Manager (noscript) -->"
    )


def senza_blocchi(html: str) -> str:
    """Toglie lo snippet e il `<noscript>` da una pagina, comunque siano messi.

    Serve perché le versioni precedenti di questo script (o una modifica fatta
    a mano) possono averli lasciati in punti diversi: prima si toglie tutto,
    poi si rimette. Così non si accumulano due contenitori sulla stessa pagina
    — che misurerebbero ogni visita due volte.
    """
    html = re.sub(
        re.escape(SEGNA_INIZIO) + r".*?" + re.escape(SEGNA_FINE) + r"\n?",
        "", html, flags=re.S,
    )
    html = re.sub(
        r"<!-- Google Tag Manager \(noscript\) -->\n?<noscript>.*?</noscript>\n?"
        r"<!-- End Google Tag Manager \(noscript\) -->\n?",
        "", html, flags=re.S,
    )
    return html


def inserisci_testa(html: str, blocco: str) -> str:
    """Subito dopo `<head>`, prima di tutto il resto."""
    if not blocco:
        return html
    # `<head>` può portare attributi: si aggancia al tag, non alla stringa esatta
    m = re.search(r"<head[^>]*>", html)
    if not m:
        return html
    fine = m.end()
    return html[:fine] + "\n" + blocco + html[fine:]


def inserisci_corpo(html: str, blocco: str) -> str:
    if not blocco:
        return html
    m = re.search(r"<body[^>]*>", html)
    if not m:
        return html
    fine = m.end()
    return html[:fine] + "\n" + blocco + html[fine:]


def riscrivi(html: str, testa: str, corpo: str, prefisso: str = "") -> str:
    return inserisci_corpo(inserisci_testa(senza_blocchi(html), testa), corpo)


def pagine() -> list[pathlib.Path]:
    return [ROOT / p for p in PAGINE] + [ROOT / l / p for l in LINGUE for p in TRADOTTE]


def main() -> int:
    gtm, ga4 = identificatori()
    if not gtm and not ga4:
        print("Nessun identificatore in tools/misurazione.json: niente da fare.")
        return 1

    check = "--check" in sys.argv
    versione, corpo = impronta(), blocco_corpo(gtm)
    modificate, mancanti, indietro = [], [], []

    for percorso in pagine():
        if not percorso.exists():
            mancanti.append(percorso.relative_to(ROOT).as_posix())
            continue
        prima = percorso.read_text(encoding="utf-8")
        prefisso = "" if percorso.parent == ROOT else "/"
        dopo = riscrivi(prima, blocco_testa(gtm, ga4, versione, prefisso), corpo, prefisso)
        if dopo == prima:
            continue
        indietro.append(percorso.relative_to(ROOT).as_posix())
        if not check:
            percorso.write_text(dopo, encoding="utf-8")
            modificate.append(percorso.relative_to(ROOT).as_posix())

    if mancanti:
        print("Pagine attese e non trovate:")
        for p in mancanti:
            print("  · " + p)

    if check:
        if indietro:
            print("Pagine senza la misurazione (o con una vecchia):")
            for p in indietro:
                print("  · " + p)
            print("\nEsegui: python3 tools/misurazione.py")
            return 1
        print(f"Misurazione presente e identica su tutte le {len(pagine()) - len(mancanti)} pagine.")
        return 0

    print(f"Misurazione aggiornata su {len(modificate)} pagine (GTM {gtm}"
          + (f", GA4 {ga4}" if ga4 else "") + ").")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
