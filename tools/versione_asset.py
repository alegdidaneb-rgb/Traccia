#!/usr/bin/env python3
"""traccia — la versione negli indirizzi di CSS e JS, calcolata dai file.

Perché esiste, e perché non basta `?v=`: il 2026-11-08 un cliente ha scritto
che «quando si segnala un caso i campi da compilare non ci sono», da telefono e
da computer. I campi c'erano, nel file e in produzione — la pagina era giusta.

Il difetto era `?v=20261102d`: una versione scritta a mano, ferma da mesi.
`vercel.json` serve i CSS e i JS con `public, max-age=604800`, e quel `?v`
identico faceva sembrare nuovo un file di mesi prima. Chi aveva già visitato
il sito usava un `auth.js` vecchio — e nell'`auth.js` vecchio la funzione che
apre la scheda della segnalazione non esisteva: il clic sulla scheda cambiava
l'indirizzo e non apriva niente. Da lì «non ci sono i campi».

**Cambiare `?v` non basta**, ed è la trappola in cui sono ricaduto: la query
string viaggia con la pagina, e la pagina (l'HTML) non ha nessun `Cache-Control`
in `vercel.json`, quindi il browser decide da sé per quanto tenerla. Chi ha
l'HTML di ieri riceve `?v` di ieri e i file di ieri, per sempre.

Per questo la cartella `assets/` porta un **nome** che nasce dal contenuto:
`assets/4c7ea4fc/js/auth.js`. Un indirizzo nuovo non è in nessuna cache, e non
c'è niente da scadere. La vecchia cartella resta con il suo contenuto, così le
pagine ancora in cache non trovano un 404 e non perdono il foglio di stile.

Come funziona: si legge il contenuto di `assets/css/style.css`,
`assets/css/premium.css` e di tutti gli `assets/js/*.js`, si somma, e se ne
prende un'impronta corta. Quell'impronta diventa il nome di una cartella in
`assets/`, creata per copia (niente build: sono dieci file piccoli), e tutte le
pagine puntano lì. Le pagine `en/ de/ es/` si rigenerano con `build_i18n.py`,
che legge questi indirizzi nuovi.

Uso:
    python3 tools/versione_asset.py            # crea la cartella, riscrive le pagine
    python3 tools/versione_asset.py --check    # esce 1 se le pagine sono indietro
"""

from __future__ import annotations

import hashlib
import pathlib
import shutil
import subprocess
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSET = ROOT / "assets"

# Le pagine servite: le italiane, più l'area riservata e la console. Le pagine
# tradotte non si toccano qui — le rigenera `build_i18n.py` partendo da queste.
PAGINE = [
    "index.html", "come-funziona.html", "casi.html", "crypto.html",
    "chi-siamo.html", "team.html", "onorari.html", "supporto.html",
    "login.html", "privacy.html", "termini.html", "cookie.html",
    "note-legali.html", "404.html", "app.html", "admin.html",
]

# La versione è un'impronta del **contenuto**, non una data: due giorni in cui
# nessuno tocca CSS e JS non producono due versioni diverse, e quindi nessun
# download inutile a chi torna sul sito.
def impronta() -> str:
    file = [ASSET / "css" / "style.css", ASSET / "css" / "premium.css"]
    file += sorted((ASSET / "js").glob("*.js"))
    sommario = hashlib.sha256()
    for f in file:
        sommario.update(f.name.encode())
        sommario.update(f.read_bytes())
    # otto caratteri: abbastanza per non collidere, corto da leggere in un diff
    return sommario.hexdigest()[:8]


# Un indirizzo nuovo non è in nessuna cache. La cartella vecchia resta dov'è:
# qualcuno ha ancora in memoria una pagina che la chiama, e un 404 gli
# toglierebbe il foglio di stile — peggio di una copia vecchia.
def crea_cartella(versione: str) -> bool:
    destinazione = ASSET / versione
    if destinazione.exists():
        return False
    for sorgente in sorted(ASSET.glob("*")):
        if sorgente.is_dir() and re.fullmatch(r"[0-9a-f]{8}", sorgente.name):
            continue
        if sorgente.is_dir():
            (destinazione / sorgente.name).mkdir(parents=True, exist_ok=True)
            for f in sorted(sorgente.glob("*")):
                if f.is_file():
                    (destinazione / sorgente.name / f.name).write_bytes(f.read_bytes())
        elif sorgente.is_file():
            destinazione.mkdir(parents=True, exist_ok=True)
            (destinazione / sorgente.name).write_bytes(sorgente.read_bytes())
    return True


# Le pagine scritte prima del 2026-11-08 chiamano gli asset con `assets/…` e un
# `?v=`; quelle nuove con `assets/<impronta>/…`. Il controllo accetta solo la
# seconda forma: la prima è il difetto, non una variante.
def asset_correnti(versione: str) -> bool:
    """Vero se `assets/<versione>/` contiene già il contenuto attuale.

    Serve perché l'impronta è calcolata **sui sorgenti**, e i sorgenti
    contengono anche i riferimenti ad altri asset (le immagini del team nel
    CSS, per esempio). Al primo giro la cartella viene creata da sorgenti senza
    impronta; poi `riscrivi()` cambia i riferimenti, l'impronta cambia, e la
    cartella creata non corrisponde più. Senza questo controllo si entra in un
    ciclo: una cartella nuova a ogni esecuzione, il repository che cresce di
    dieci file per volta. Misurato ieri: 28 000 righe di differenza.
    """
    for f in sorted((ASSET / "js").glob("*.js")):
        copia = ASSET / versione / "js" / f.name
        if not copia.exists() or copia.read_bytes() != f.read_bytes():
            return False
    for f in sorted((ASSET / "css").glob("*.css")):
        copia = ASSET / versione / "css" / f.name
        if not copia.exists() or copia.read_bytes() != f.read_bytes():
            return False
    return True


def riscrivi(versione: str) -> list[str]:
    cambiate = []
    for nome in PAGINE:
        percorso = ROOT / nome
        if not percorso.exists():
            continue
        testo = percorso.read_text(encoding="utf-8")
        nuovo = re.sub(r"assets/(?:[0-9a-f]{8}/)?(?=(?:fonts|img|css|js)/)",
                       f"assets/{versione}/", testo)
        # la vecchia versione: `...?v=20261102d` dopo il nome del file
        nuovo = re.sub(r"\?v=[0-9a-zA-Z]+", "", nuovo)
        if nuovo != testo:
            percorso.write_text(nuovo, encoding="utf-8")
            cambiate.append(nome)
    return cambiate


def pota(attesa: str, quante: int = 3) -> list[str]:
    """Elimina le cartelle di asset più vecchie, tenendone `quante`.

    Perché non si possono tenere tutte: erano tredici, ognuna una copia intera
    di CSS, JS, font e immagini. Il motivo per cui nascono — un indirizzo nuovo
    non è in nessuna cache — vale finché una pagina vecchia può essere ancora
    nel browser di qualcuno. Con `vercel.json` che non mette `Cache-Control`
    sull'HTML, la coda è breve: due versioni indietro sono larghe abbastanza.
    Oltre, la copia non serve più a nessuno e pesa nel repository.

    L'ordine è quello dei `git log`… no: è l'ordine di modifica dei file, che
    qui è `st_mtime`. Se manca, si tiene: cancellare per errore la cartella
    che il sito usa lo romperebbe, e vale la pena sbagliare per eccesso.
    """
    cartelle = [
        d for d in (ROOT / "assets").iterdir()
        if d.is_dir() and re.fullmatch(r"[0-9a-f]{8}", d.name)
    ]
    cartelle.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    tenere = {d.name for d in cartelle[:quante]} | {attesa}
    potate = []
    for d in cartelle:
        if d.name in tenere:
            continue
        # Se la cartella è nel repository, va togliuta **da git** oltre che dal
        # disco: `rmtree` da solo la fa sparire dal disco e resta nell'indice,
        # e git la considera cancellata. Non è la stessa cosa: un test che
        # scandisce `git ls-files` cerca file che non ci sono più e si rompe
        # con un ENOENT, che non dice niente a chi lo legge.
        subprocess.run(["git", "rm", "-r", "-q", "--cached", "--ignore-unmatch", str(d)],
                       cwd=ROOT, check=False, capture_output=True)
        shutil.rmtree(d)
        potate.append(d.name)
    return potate


def main() -> int:
    controlla = "--check" in sys.argv
    attesa = impronta()
    vecchie = []
    for nome in PAGINE:
        percorso = ROOT / nome
        if not percorso.exists():
            continue
        testo = percorso.read_text(encoding="utf-8")
        # ogni riferimento agli asset deve stare nella cartella dell'impronta
        riferimenti = re.findall(
            r"assets/(?:[0-9a-f]{8}/)?(?=(?:css|js|fonts|img)/)", testo)
        fuori = [r for r in riferimenti if r != f"assets/{attesa}/"]
        if fuori:
            vecchie.append(f"{nome} ({fuori[0]})")

    if controlla:
        if vecchie:
            print(f"cartella degli asset superata: serve assets/{attesa}/, "
                  f"non combaciano {len(vecchie)} pagine (es. {vecchie[0]})")
            return 1
        print(f"asset in assets/{attesa}/: pagine allineate.")
        return 0

    # Si ripete finché l'impronta non smette di muoversi: riscrivere le pagine
    # cambia i riferimenti dentro il CSS/JS? Sì, e va assorbito qui, non alla
    # prossima esecuzione.
    for _ in range(5):
        if asset_correnti(attesa):
            break
        creata = crea_cartella(attesa)
        if creata:
            print(f"creata assets/{attesa}/")
        cambiate = riscrivi(attesa)
        if cambiate:
            print(f"versione {attesa}: aggiornate {len(cambiate)} pagine")
        nuova = impronta()
        if nuova == attesa:
            break
        attesa = nuova

    potate = pota(attesa)
    if potate:
        print(f"potate {len(potate)} cartelle di asset vecchie: {', '.join(potate)}")

    if not asset_correnti(attesa):
        print(f"attenzione: assets/{attesa}/ non corrisponde ai sorgenti")
        return 1
    cambiate = riscrivi(attesa)
    if cambiate:
        print(f"versione {attesa}: aggiornate {len(cambiate)} pagine")
    else:
        print(f"versione {attesa}: nessuna pagina da aggiornare")
    return 0


if __name__ == "__main__":
    sys.exit(main())
