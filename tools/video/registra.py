# -*- coding: utf-8 -*-
"""
Compone la voce dei video dai pezzi, uno per scena.

Perché esiste: la voce dei video è sintetica, e quasi tutti i servizi hanno un
limite di caratteri per richiesta. La narrazione italiana è di 1.400 caratteri
e passa intera; quella tedesca, con le due scene sul recupero, no. Serve quindi
registrare una frase per volta e ricomporre, e questo script fa la seconda
parte: prende i pezzi, li unisce con la pausa giusta e controlla che il
risultato dica esattamente quello che le scene dicono.

Uso:
  python3 tools/video/registra.py --testo it          # stampa le frasi da registrare
  python3 tools/video/registra.py --componi it        # unisce i pezzi in audio/voce-it.mp3

I pezzi si mettono in `tools/video/audio/pezzi/<lingua>/01.mp3`, `02.mp3`, …
uno per frase, nell'ordine in cui `--testo` li elenca. Se un pezzo manca, lo dice e
si ferma: meglio nessun video che un video con una scena muta.

La pausa fra un pezzo e l'altro è 0,35 s. Non è un numero scelto a occhio: il
taglio delle scene (`rendi.py`) cerca le pause sopra 0,12 s e sceglie quella più
vicina alla stima, e con pause troppo vicine il taglio finisce dentro la frase
successiva.
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contenuti as C

QUI = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(QUI, "audio")
PEZZI = os.path.join(AUDIO, "pezzi")
PAUSA = 0.35


def ffmpeg_bin():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def frasi(lingua):
    """Le frasi da registrare, una per scena.

    Una per scena e non una per periodo: il taglio delle scene si aggancia
    alla pausa più vicina alla stima, e una pausa a ogni scena è il modo più
    sicuro perché ogni cambio scena cada dove deve.
    """
    return [scena["voce"] for scena in C.SCENE[lingua]]


def elenca(lingua):
    righe = frasi(lingua)
    for i, riga in enumerate(righe, 1):
        print("%02d  %s" % (i, riga))
    print()
    print("%d frasi, %d caratteri" % (len(righe), sum(len(r) for r in righe)))
    print("la più lunga: %d caratteri" % max(len(r) for r in righe))


def componi(lingua):
    cartella = os.path.join(PEZZI, lingua)
    attese = []
    for i in range(1, len(frasi(lingua)) + 1):
        for ext in ("mp3", "wav", "m4a"):
            if os.path.exists(os.path.join(cartella, "%02d.%s" % (i, ext))):
                attese.append("%02d.%s" % (i, ext))
                break
        else:
            attese.append("%02d.mp3" % i)
    mancanti = [f for f in attese if not os.path.exists(os.path.join(cartella, f))]
    if mancanti:
        print("mancano %d pezzi in %s: %s" % (len(mancanti), cartella, ", ".join(mancanti)))
        return 1

    ff = ffmpeg_bin()
    elenco = os.path.join(cartella, "elenco.txt")
    with open(elenco, "w", encoding="utf8") as f:
        for nome in attese:
            f.write("file '%s'\n" % os.path.join(cartella, nome))
    # la pausa si ottiene come silenzio fra i pezzi: `concat` da solo
    # incollerebbe le frasi una sull'altra e il taglio non avrebbe appigli
    silenzio = os.path.join(cartella, "pausa.wav")
    subprocess.run([ff, "-y", "-f", "lavfi", "-i",
                    "anullsrc=r=44100:cl=mono", "-t", str(PAUSA), silenzio],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(elenco, "w", encoding="utf8") as f:
        for nome in attese:
            f.write("file '%s'\n" % os.path.join(cartella, nome))
            f.write("file '%s'\n" % silenzio)

    uscita = os.path.join(AUDIO, "voce-%s.mp3" % lingua)
    subprocess.run([ff, "-y", "-f", "concat", "-safe", "0", "-i", elenco,
                    "-c:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", "-ac", "1", uscita],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("%s composto: %d frasi" % (uscita, len(attese)))
    return 0


def main():
    p = argparse.ArgumentParser(description="Compone la voce dei video dai pezzi.")
    p.add_argument("azione", choices=["testo", "componi"])
    p.add_argument("lingua", choices=C.LINGUE)
    a = p.parse_args()
    if a.azione == "testo":
        elenca(a.lingua)
        return 0
    return componi(a.lingua)


if __name__ == "__main__":
    sys.exit(main())
