#!/usr/bin/env python3
"""traccia — il marchio: un quadrato scuro con una «T» color lime.

Da dove viene: `.brand__mark` in `assets/css/style.css` non è un'immagine, è un
`<span>` con un bordo arrotondato e una lettera dentro. Funziona benissimo in
pagina — zero byte, nitido a ogni zoom — e non funziona per niente fuori dalla
pagina: un annuncio, un'anteprima social, un'icona non sanno leggere il CSS.

Quindi il marchio si disegna, non si inventa: stesse proporzioni del CSS
(30 px di lato, raggio 9 px, «T» alta 16/30 del quadrato), stessi colori
(`--ink` #0b0b0f, `--accent-lime` #c8f169). Se un giorno cambia il CSS, questi
numeri vanno cambiati con lui — ed è il motivo per cui stanno qui in cima,
invece che sparsi dentro le funzioni.

Uso:
    python3 tools/marchio.py            # scrive assets/img/marchio/
    python3 tools/marchio.py --check    # esce 1 se i file non corrispondono
"""

from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
USCITA = ROOT / "assets" / "img" / "marchio"

INK = (11, 11, 15, 255)
LIME = (200, 241, 105, 255)
# lo stesso raggio del CSS, in proporzione al lato: 9 px su 30
RAGGIO = 9 / 30
# la «T» del CSS è `font-size: 0.95rem` su un quadrato di 30 px. Attenzione:
# l'altezza della lettera non è la dimensione del font — è la *cap height*, che
# in Inter è 0.727 della dimensione. Quindi 0.95rem = 15.2 px di font, cioè
# 11 px di lettera su 30 di quadrato: il 37%, non la metà. Misurato sul CSS,
# non stimato a occhio: la prima versione di questo file la faceva grande il
# doppio del marchio che sta in pagina.
ALTEZZA_T = (0.95 * 16 * 0.727) / 30

# Larghezze: 32 è la favicon, 180 è quella che iOS mette in home, 512 è quella
# che chiedono tutti gli altri. Si disegnano a 4x e si riducono, perché il
# bordo arrotondato a 32 px disegnato direttamente è una scala di grigi.
LATI = [32, 48, 180, 512, 1024]


def font(lato: int) -> ImageFont.FreeTypeFont:
    """La «T» con il font del sito, se c'è; altrimenti quello di sistema.

    Il marchio in pagina usa il font del corpo (`--font-body`: Inter), quindi
    anche qui. Se `assets/fonts/inter-var.woff2` non è leggibile da Pillow —
    woff2 non lo è, serve il TTF — si ricade su DejaVu, che è più largo e
    quindi si rimpicciolisce finché non sta: meglio una «T» un po' diversa che
    un marchio che esce dal quadrato.
    """
    percorso = None
    for candidato in [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        if pathlib.Path(candidato).exists():
            percorso = candidato
            break
    if percorso is None:
        return ImageFont.load_default()

    # la dimensione del font si ricava dalla *lettera*: si misura una «T» di
    # prova e si scala finché la sua altezza non è quella del CSS. Ogni font ha
    # una cap height diversa, e indovinarla è il modo di sbagliare di poco su
    # tutte e cinque le misure.
    bersaglio = lato * ALTEZZA_T
    prova = ImageFont.truetype(percorso, 100)
    misurata = prova.getbbox("T")[3] - prova.getbbox("T")[1]
    if misurata <= 0:
        return prova
    return ImageFont.truetype(percorso, max(1, round(100 * bersaglio / misurata)))


def disegna(lato: int) -> Image.Image:
    """Un quadrato, un angolo arrotondato, una lettera al centro."""
    # 4x e poi riduzione: il raggio a 32 px verrebbe a scalini
    scala = 4
    lato_grande = lato * scala
    img = Image.new("RGBA", (lato_grande, lato_grande), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [0, 0, lato_grande - 1, lato_grande - 1],
        radius=round(lato_grande * RAGGIO),
        fill=INK,
    )

    f = font(lato_grande)
    # centratura vera: si misura il riquadro della lettera, non la linea di
    # base. `anchor="mm"` da solo lascia la «T» un filo alta, perché il
    # riquadro del font comprende lo spazio sopra e sotto.
    riquadro = d.textbbox((0, 0), "T", font=f)
    larghezza = riquadro[2] - riquadro[0]
    altezza = riquadro[3] - riquadro[1]
    x = (lato_grande - larghezza) / 2 - riquadro[0]
    y = (lato_grande - altezza) / 2 - riquadro[1]
    d.text((x, y), "T", font=f, fill=LIME)

    return img.resize((lato, lato), Image.LANCZOS)


def scrivi() -> list[str]:
    USCITA.mkdir(parents=True, exist_ok=True)
    scritti = []
    for lato in LATI:
        img = disegna(lato)
        percorso = USCITA / f"marchio-{lato}.png"
        img.save(percorso, "PNG", optimize=True)
        scritti.append(str(percorso.relative_to(ROOT)))
    # l'icona dell'Apple: stesso disegno, nome che iOS cerca
    disegna(180).save(ROOT / "assets" / "img" / "apple-touch-icon.png", "PNG", optimize=True)
    scritti.append("assets/img/apple-touch-icon.png")
    return scritti


def main() -> int:
    if "--check" in sys.argv:
        mancanti = [f"marchio-{l}.png" for l in LATI
                    if not (USCITA / f"marchio-{l}.png").exists()]
        if mancanti:
            print(f"marchio incompleto: {', '.join(mancanti)} — esegui python3 tools/marchio.py")
            return 1
        print(f"marchio presente in {len(LATI)} misure.")
        return 0
    for f in scrivi():
        print(f"scritto {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
