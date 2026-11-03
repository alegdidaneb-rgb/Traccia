#!/usr/bin/env python3
"""traccia — la pagina del team, generata dai dati.

Il problema che risolve: le nove schede di `chi-siamo.html` erano scritte a mano.
Aggiungere una persona voleva dire copiare quindici righe di markup, e un campo
dimenticato produceva una scheda muta senza che nessuno se ne accorgesse.

Qui i dati stanno in un posto solo — `assets/js/team.js`, che è anche ciò che il
browser legge — e questa pagina è la loro resa completa: profilo, aree di
lavoro, lingue, strumenti, ritratto. Il file JS resta la fonte di verità perché
serve anche alla home, che mostra le schede brevi.

La pagina ha due parti generate da due script — i profili (qui) e le tessere
(`build_tessere.py`) — ma un solo comando, questo: chi aggiunge una persona
lancia `build_team.py` e si aggiornano tutte e due. Due comandi separati
sarebbero due occasioni di dimenticarne uno, e la pagina mostrerebbe una
tessera in meno senza un errore da nessuna parte.

Uso:
    python3 tools/build_team.py            # riscrive team.html (profili e tessere)
    python3 tools/build_team.py --check    # esce 1 se una delle due parti è disallineata
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATI = ROOT / "assets" / "js" / "team.js"
PAGINA = ROOT / "team.html"
INIZIO = "<!-- team:profili -->"
FINE = "<!-- /team:profili -->"


def leggi_dati() -> list[dict]:
    """Legge `window.TRACCIA_TEAM` da team.js **eseguendolo** con Node.

    Non si estrae l'array con una regex: `team.js` è JavaScript, non JSON — ha
    chiavi senza virgolette e stringhe concatenate. Un parser artigianale
    funzionerebbe fino al giorno in cui qualcuno scrive una virgola in un modo
    che non aveva previsto, e quel giorno la pagina si svuoterebbe senza un
    errore. Eseguirlo con Node, che il progetto usa già per le prove, garantisce
    che la pagina e il browser leggano lo stesso valore.
    """
    # il file scrive anche sulla pagina (le lingue di lavoro): qui serve solo la
    # struttura dei dati, quindi il DOM è finto e `document` non fa nulla
    script = (
        "global.window = {};"
        "global.document = { readyState: 'complete',"
        " querySelectorAll: function () { return []; },"
        " addEventListener: function () {} };"
        "require(" + json.dumps(str(DATI)) + ");"
        "process.stdout.write(JSON.stringify(global.window.TRACCIA_TEAM));"
    )
    esito = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, cwd=str(ROOT)
    )
    if esito.returncode != 0:
        raise SystemExit(
            "Non riesco a leggere assets/js/team.js con Node:\n" + esito.stderr.strip()
        )
    return json.loads(esito.stdout)


def esc(testo: str) -> str:
    return (testo.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def ritratto(p: dict) -> str:
    """Il ritratto, con le iniziali come riserva.

    `foto: null` non è un errore: è lo stato normale finché la fotografia non
    arriva. La scheda mostra le iniziali, che è già l'aspetto di oggi, invece di
    un riquadro rotto.
    """
    if not p.get("foto"):
        return (
            '<span class="profilo__ritratto profilo__ritratto--iniziali" '
            'aria-hidden="true">' + esc(p["iniziali"]) + "</span>"
        )
    base = p["foto"]
    return (
        '<picture class="profilo__ritratto">\n'
        '        <source type="image/webp" '
        f'srcset="assets/img/team/{esc(base)}-480.webp 480w, '
        f'assets/img/team/{esc(base)}-960.webp 960w" '
        'sizes="(max-width: 700px) 38vw, 180px">\n'
        f'        <img src="assets/img/team/{esc(base)}-480.jpg" '
        f'srcset="assets/img/team/{esc(base)}-480.jpg 480w, '
        f'assets/img/team/{esc(base)}-960.jpg 960w" '
        'sizes="(max-width: 700px) 38vw, 180px" '
        f'alt="Ritratto di {esc(p["nome"])}" width="480" height="480" '
        'loading="lazy" decoding="async">\n'
        "      </picture>"
    )


def profilo(p: dict, numero: str) -> str:
    """Una scheda completa.

    L'ordine non è arbitrario: prima chi è (ritratto, nome, ruolo, aree), poi
    **cosa può dimostrare** (le credenziali, subito sotto la testata: è la
    prima cosa che un cliente istituzionale cerca, e prima stava in fondo come
    un dettaglio), poi cosa fa e come lavora, e in coda il percorso di carriera,
    che è la parte che si legge solo se la persona interessa davvero.

    La colonna di sinistra — ritratto, nome, aree, credenziali — è appiccicata
    in alto su schermo largo: scorrendo il merito di un profilo lungo, il nome
    resta a vista e non si perde di chi si sta leggendo.
    """
    aree = "".join(
        f'<span class="member__tag">{esc(a)}</span>' for a in p.get("aree", [])
    )

    # ------------------------------------------------------- credenziali --
    # In evidenza sotto la testata: tipo, ente per esteso, riferimento e stato.
    # Lo stato non è decorazione — «in corso» e «aggiornata nel 2025» sono due
    # situazioni diverse e chi legge ha diritto di distinguerle.
    credenziali = ""
    if p.get("credenziali"):
        voci = "".join(
            '<li class="profilo__credenziale">'
            f'<span class="profilo__credenziale-tipo">{esc(c["tipo"])}</span>'
            f'<strong class="profilo__credenziale-ente">{esc(c["ente"])}</strong>'
            f'<span class="profilo__credenziale-dettaglio">{esc(c.get("numero", ""))}'
            + (f' · <em>{esc(c["valida"])}</em>' if c.get("valida") else "")
            + "</span></li>"
            for c in p["credenziali"]
        )
        credenziali = (
            '\n      <h4 class="profilo__sezione">Credenziali</h4>'
            f'\n      <ul class="profilo__credenziali">{voci}</ul>'
        )

    # ----------------------------------------------------------- metodo --
    # Tre criteri operativi. Prima qui c'era «Cosa ha fatto qui», tre aneddoti
    # con i numeri: «ha bloccato sette consegne», «ha ridotto da nove a quattro
    # giorni». Su persone inventate quei numeri fingevano una referenza. Il
    # criterio si può leggere e giudicare; il numero no.
    metodo = ""
    if p.get("metodo"):
        voci = "".join(f"<li>{esc(m)}</li>" for m in p["metodo"])
        metodo = (
            '\n      <h4 class="profilo__sezione">Ambito e metodo</h4>'
            f'\n      <ul class="profilo__metodo">{voci}</ul>'
        )

    # ----------------------------------------------------------- percorso --
    percorso = ""
    if p.get("percorso"):
        voci = "".join(
            f'<li><span class="profilo__anno">{esc(str(v["anno"]))}</span>'
            f'<span class="profilo__tappa"><strong>{esc(v["ruolo"])}</strong>'
            f'<span class="profilo__dove">{esc(v["dove"])}</span></span></li>'
            for v in p["percorso"]
        )
        percorso = (
            '\n        <div class="profilo__blocco">'
            '\n        <h4 class="profilo__sezione">Percorso</h4>'
            f'\n        <ol class="profilo__percorso">{voci}</ol></div>'
        )

    # ---------------------------------------------------------- formazione --
    formazione = ""
    if p.get("formazione"):
        voci = "".join(
            f'<li><strong>{esc(v["titolo"])}</strong>'
            f'<span class="profilo__dove">{esc(v["istituto"])} · {esc(str(v["anno"]))}</span></li>'
            for v in p["formazione"]
        )
        formazione = (
            '\n        <div class="profilo__blocco">'
            '\n        <h4 class="profilo__sezione">Formazione</h4>'
            f'\n        <ul class="profilo__formazione">{voci}</ul></div>'
        )

    # ------------------------------------------------------- pubblicazioni --
    pubblicazioni = ""
    if p.get("pubblicazioni"):
        voci = "".join(
            f'<li>{esc(x["titolo"])} <span class="profilo__dove">{esc(x["dove"])}, '
            f'{esc(str(x["anno"]))}</span></li>'
            for x in p["pubblicazioni"]
        )
        pubblicazioni = (
            '\n        <div class="profilo__blocco">'
            '\n        <h4 class="profilo__sezione">Pubblicazioni</h4>'
            f'\n        <ul class="profilo__formazione">{voci}</ul></div>'
        )

    # ------------------------------------------------- dettagli operativi --
    dettagli = (
        '<dl class="profilo__dettagli">'
        "<div><dt>Lingue di lavoro</dt><dd><ul class=\"profilo__elenco\">"
        + "".join(f"<li>{esc(l)}</li>" for l in p.get("lingue", []))
        + "</ul></dd></div>"
        "<div><dt>Strumenti</dt><dd><ul class=\"profilo__elenco\">"
        + "".join(f"<li>{esc(x)}</li>" for x in p.get("strumenti", []))
        + "</ul></dd></div></dl>"
    )

    revisione = ""
    if p.get("revisione"):
        revisione = (
            '\n      <p class="profilo__revisione">'
            '<span class="profilo__revisione-label">Ruolo di controllo</span>'
            f"{esc(p['revisione'])}</p>"
        )

    return f"""<article class="profilo" id="{esc(p['id'])}">
      <div class="profilo__testata">
      {ritratto(p)}
        <div class="profilo__anagrafica">
          <p class="profilo__occhiello">{esc(numero)} · dal {p['dal']}</p>
          <h3 class="profilo__nome">{esc(p['nome'])}</h3>
          <p class="profilo__ruolo">{esc(p['ruolo'])}</p>
          <div class="member__tags profilo__aree">{aree}</div>
        </div>{credenziali}
      </div>

      <div class="profilo__corpo">
        <p class="profilo__bio">{esc(p['bio'])}</p>{metodo}{revisione}

        <div class="profilo__carriera">{percorso}{formazione}{pubblicazioni}
        </div>
        {dettagli}
      </div>
    </article>"""


def costruisci() -> str:
    persone = leggi_dati()
    attuale = PAGINA.read_text(encoding="utf-8") if PAGINA.exists() else ""
    if INIZIO not in attuale or FINE not in attuale:
        raise SystemExit(
            "team.html non contiene i marcatori " + INIZIO + " / " + FINE
        )
    from build_tessere import numero_interno
    numeri = numero_interno(persone)
    profili = "\n\n".join(profilo(p, numeri[p["id"]]) for p in persone)
    prima, resto = attuale.split(INIZIO, 1)
    _, dopo = resto.split(FINE, 1)
    return prima + INIZIO + "\n" + profili + "\n      " + FINE + dopo


def main(argomenti: list[str]) -> int:
    esito = profili(argomenti)
    # le tessere si aggiornano con lo stesso comando: import locale per non
    # creare un ciclo (build_tessere importa da questo file la lettura dei dati)
    from build_tessere import main as tessere
    esito_tessere = tessere(argomenti)
    return 1 if (esito or esito_tessere) else 0


def profili(argomenti: list[str]) -> int:
    nuovo = costruisci()
    vecchio = PAGINA.read_text(encoding="utf-8") if PAGINA.exists() else ""
    if "--check" in argomenti:
        if nuovo != vecchio:
            print("team.html non è allineata a assets/js/team.js: esegui "
                  "python3 tools/build_team.py")
            return 1
        print("team.html allineata a assets/js/team.js.")
        return 0
    if nuovo != vecchio:
        PAGINA.write_text(nuovo, encoding="utf-8")
        persone = leggi_dati()
        print(f"team.html riscritta: {len(persone)} profili.")
    else:
        print("team.html già allineata.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
