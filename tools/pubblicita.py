#!/usr/bin/env python3
"""traccia — gli annunci: quattro formati, quattro lingue, un solo posto.

Perché uno script e non Canva: con 24 $ di budget (due giorni a 12 $) non si
compra un grafico, e un'immagine fatta a mano invecchia subito — il telefono ne
serve tre misure, il desktop una, e ognuna vuole il testo al posto giusto.
Qui i numeri stanno in una tabella, e rigenerare tutto è un comando.

**Regola del marchio, e non è un dettaglio estetico:** negli annunci non c'è
testo fuori dal velo. Meta penalizza le immagini con troppo testo sopra (la
vecchia regola «meno del 20%» non è più un rifiuto, ma resta un costo: la
distribuzione cala). Quindi la foto da sola occupa la parte alta, e il velo
scuro parte al 62% dell'altezza e arriva al 65% di nero: lì dentro ci sta il
marchio, e niente altro.

La foto di base è `assets/img/hero-trace-1600.jpg` — quella della home, perché
chi clicca trova la stessa immagine e capisce di essere arrivato dove pensava.

Uso:
    python3 tools/pubblicita.py            # scrive pubblicita/
    python3 tools/pubblicita.py --check    # esce 1 se manca qualcosa
"""

from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FOTO = ROOT / "assets" / "img" / "hero-trace-1600.jpg"
MARCHIO = ROOT / "assets" / "img" / "marchio" / "marchio-512.png"
USCITA = ROOT / "pubblicita"

INK = (11, 11, 15)
LIME = (200, 241, 105)

# I quattro formati che servono davvero. `feed-quadrato` è quello che Meta
# mostra per primo; `storia` è verticale e si vede a schermo intero; il
# `orizzontale` è l'unico che va anche fuori da Meta (anteprima di un link).
FORMATI = {
    "feed-quadrato": (1080, 1080),
    "feed-verticale": (1080, 1350),
    "storia": (1080, 1920),
    "orizzontale": (1200, 628),
}

# Il velo: da che altezza parte (frazione) e quanto è nero in fondo.
VELO_INIZIO = 0.62
VELO_NERO = 0.65

# L'unica cosa scritta nell'immagine è il marchio (la «T»). Il resto lo mette
# Meta: titolo, testo primario, descrizione e pulsante sono campi dell'annuncio,
# non pixel. Un'immagine con le parole dentro non si può tradurre, non si può
# correggere dopo il primo giorno, e non si legge su uno schermo al sole.

LINGUE = ["de", "it", "en", "es"]


def font_display(lato: int) -> ImageFont.FreeTypeFont:
    for candidato in [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if pathlib.Path(candidato).exists():
            return ImageFont.truetype(candidato, lato)
    return ImageFont.load_default()


def velo(img: Image.Image) -> Image.Image:
    """La sfumatura che rende leggibile il marchio senza coprire la foto.

    Non è un rettangolo nero: un rettangolo si vede come un rettangolo. È una
    rampa verticale che parte da trasparente e arriva a `VELO_NERO`, così la
    foto finisce nel buio invece di essere tagliata.
    """
    larghezza, altezza = img.size
    inizio = int(altezza * VELO_INIZIO)
    maschera = Image.new("L", (1, altezza), 0)
    for y in range(inizio, altezza):
        # 0 all'inizio del velo, 1 in fondo, con una curva che si addolcisce
        t = (y - inizio) / max(1, altezza - inizio)
        maschera.putpixel((0, y), round(255 * VELO_NERO * (t ** 0.75)))
    # NEAREST, non LANCZOS: la maschera è larga un pixel e va *ripetuta* su
    # tutta la larghezza. Interpolarla produce una banda verticale visibile
    # dove il filtro si aggancia al bordo — si vedeva sul lato destro.
    maschera = maschera.resize((larghezza, altezza), Image.NEAREST)
    nero = Image.new("RGB", img.size, INK)
    return Image.composite(nero, img, maschera)


def ritaglia(img: Image.Image, larghezza: int, altezza: int) -> Image.Image:
    """Riempie il formato senza deformare la foto: taglia, non stira."""
    rapporto = larghezza / altezza
    larg, alt = img.size
    if larg / alt > rapporto:
        nuova_larg = round(alt * rapporto)
        img = img.crop(((larg - nuova_larg) // 2, 0, (larg + nuova_larg) // 2, alt))
    else:
        nuova_alt = round(larg / rapporto)
        # si tiene la parte alta: la luce e le tracce stanno lì
        img = img.crop((0, 0, larg, nuova_alt))
    return img.resize((larghezza, altezza), Image.LANCZOS)


def disegna(nome: str, larghezza: int, altezza: int) -> Image.Image:
    foto = Image.open(FOTO).convert("RGB")
    img = ritaglia(foto, larghezza, altezza)
    img = velo(img)

    # il marchio in basso a sinistra, alla misura che in pagina ha la testata
    # (30 px su una pagina di 1200), scalata al formato
    lato = round(min(larghezza, altezza) * 0.075)
    marchio = Image.open(MARCHIO).convert("RGBA").resize((lato, lato), Image.LANCZOS)
    margine = round(lato * 0.8)
    img = img.convert("RGBA")
    img.alpha_composite(marchio, (margine, altezza - margine - lato))

    # e il nome accanto, in piccolo e in basso: un annuncio senza nome è un
    # annuncio che nessuno riconosce quando lo rivede
    d = ImageDraw.Draw(img)
    f = font_display(round(lato * 0.42))
    d.text((margine + lato + round(lato * 0.35), altezza - margine - lato * 0.72),
           "Traccia", font=f, fill=(255, 255, 255, 240))

    return img.convert("RGB")


# I testi degli annunci. Stanno qui e non in `pubblicita/` perché valgono per
# tutte e quattro le immagini: l'immagine è la stessa idea in quattro misure,
# il testo è quello che cambia la lingua.
#
# Limiti di Meta, e sono vincoli duri: titolo ≤ 40 caratteri, testo primario
# ≤ 125, descrizione ≤ 30.
TESTI = {
    "de": {
        "titolo": "Wohin das Geld verschwindet",
        "primario": "Wir prüfen, was mit Ihrem Geld passiert ist. "
                    "Erste Einschätzung kostenlos, Antwort in 48 Arbeitsstunden.",
        "descrizione": "Gutachten zu Online-Betrug",
        "cta": "Mehr erfahren",
        "destinazione": "https://traccia.it.com/de/",
        "utm": "?utm_source=meta&utm_medium=ads&utm_campaign=de",
    },
    "it": {
        "titolo": "Dove finiscono i soldi",
        "primario": "Ricostruiamo cosa è successo ai tuoi soldi. "
                    "Prima valutazione gratuita, risposta in 48 ore lavorative.",
        "descrizione": "Perizia su truffe online",
        "cta": "Scopri di più",
        "destinazione": "https://traccia.it.com/",
        "utm": "?utm_source=meta&utm_medium=ads&utm_campaign=it",
    },
    "en": {
        "titolo": "Where the money went",
        "primario": "We work out what happened to your money. "
                    "First assessment free, reply within 48 working hours.",
        "descrizione": "Assessment of online fraud",
        "cta": "Learn more",
        "destinazione": "https://traccia.it.com/en/",
        "utm": "?utm_source=meta&utm_medium=ads&utm_campaign=en",
    },
    "es": {
        "titolo": "¿Dónde está el dinero?",
        "primario": "Reconstruimos qué pasó con su dinero. "
                    "Primera valoración gratuita, respuesta en 48 horas laborables.",
        "descrizione": "Peritaje sobre fraude online",
        "cta": "Más información",
        "destinazione": "https://traccia.it.com/es/",
        "utm": "?utm_source=meta&utm_medium=ads&utm_campaign=es",
    },
}


def scrivi() -> list[str]:
    USCITA.mkdir(parents=True, exist_ok=True)
    scritti = []
    for nome, (larghezza, altezza) in FORMATI.items():
        img = disegna(nome, larghezza, altezza)
        percorso = USCITA / f"{nome}.jpg"
        img.save(percorso, "JPEG", quality=88, optimize=True, progressive=True)
        scritti.append(str(percorso.relative_to(ROOT)))

    # il foglio da copiare e incollare in Meta: quattro lingue, i testi e i
    # limiti già contati. Chi carica l'annuncio non deve riaprire il codice.
    righe = [
        "# Gli annunci — testi pronti, limiti già contati",
        "",
        "Le immagini sono `feed-quadrato.jpg`, `feed-verticale.jpg`, `storia.jpg`,",
        "`orizzontale.jpg`: stesse quattro per ogni lingua, perché dentro",
        "l'immagine non c'è testo. Il testo si incolla dai campi qui sotto.",
        "",
        "| | limite Meta | " + " | ".join(LINGUE) + " |",
        "|---|---|" + "---|" * len(LINGUE),
    ]
    for campo, limite in [("titolo", 40), ("primario", 125), ("descrizione", 30)]:
        celle = []
        for lingua in LINGUE:
            testo = TESTI[lingua][campo]
            celle.append(f"{testo} *({len(testo)})*")
        righe.append(f"| **{campo}** | {limite} | " + " | ".join(celle) + " |")

    righe += ["", "## Destinazioni", ""]
    for lingua in LINGUE:
        t = TESTI[lingua]
        righe += [
            f"- **{lingua.upper()}** — pulsante «{t['cta']}», indirizzo "
            f"`{t['destinazione']}{t['utm']}`",
        ]

    righe += [
        "",
        "Il parametro `utm_source` non è decorazione: finisce nella colonna",
        "`origine` della console, quindi una segnalazione arrivata da qui si",
        "riconosce, e alla fine dei due giorni si sa se i clic venivano dal",
        "tedesco o dall'italiano.",
        "",
        "## Cosa non c'è, e perché",
        "",
        "Nessuna promessa di risultato: né «garantito», né «recuperiamo», né",
        "«ti restituiamo». La promessa è un metodo e una risposta entro 48 ore",
        "lavorative, che è quello che il sito dice già — e chi è appena stato",
        "truffato sta cercando proprio le parole dei truffatori per riconoscerle.",
        "",
    ]
    (USCITA / "annunci.md").write_text("\n".join(righe), encoding="utf-8")
    scritti.append("pubblicita/annunci.md")

    # e i testi in JSON, così un domani si possono caricare via API o tradurre
    # senza riaprire lo script
    (USCITA / "annunci.json").write_text(
        json.dumps(TESTI, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    scritti.append("pubblicita/annunci.json")
    return scritti


def main() -> int:
    if "--check" in sys.argv:
        mancanti = [f"{n}.jpg" for n in FORMATI if not (USCITA / f"{n}.jpg").exists()]
        if not (USCITA / "annunci.md").exists():
            mancanti.append("annunci.md")
        if mancanti:
            print(f"annunci incompleti: {', '.join(mancanti)} — esegui python3 tools/pubblicita.py")
            return 1
        print(f"annunci presenti: {len(FORMATI)} formati, {len(LINGUE)} lingue.")
        return 0
    for f in scrivi():
        print(f"scritto {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
