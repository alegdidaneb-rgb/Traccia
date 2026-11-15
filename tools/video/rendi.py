# -*- coding: utf-8 -*-
"""
Rende i video della guida: quattro lingue, due formati, con la voce e i
sottotitoli dentro l'immagine.

Perché è scritto così:
  - le scene sono statiche. Il movimento è una dissolvenza e una barra di
    avanzamento: disegnare duemila fotogrammi da zero darebbe lo stesso
    risultato e impiegherebbe il triplo;
  - i confini delle scene arrivano dalla voce vera (`silencedetect`), non da
    una stima: la barra si sposta dove finisce la frase. Se non c'è una pausa
    vicina resta la stima per caratteri, che qui ha sbagliato di poco;
  - i due formati condividono scene e audio, quindi non possono divergere;
  - i sottotitoli sono dentro l'immagine, non solo nella traccia `.vtt`: chi
    guarda un video muto deve poterlo seguire lo stesso. Per questo ogni scena
    lascia libera una fascia in fondo, e il testo è quello della voce, parola
    per parola;
  - genera anche i sottotitoli `.vtt` dai confini veri.

Uso:
  python tools/video/rendi.py                  # otto video, i sottotitoli, la copertina
  python tools/video/rendi.py it               # una lingua
  python tools/video/rendi.py it --prova       # 12 secondi, per controllare
"""
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contenuti as C

QUI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(QUI, "..", ".."))
AUDIO = os.path.join(QUI, "audio")
USCITA = os.path.join(ROOT, "assets", "video")
POSTER_DIR = os.path.join(ROOT, "assets", "img")

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

FORMATI = {"verticale": dict(w=1080, h=1920, fps=25),
           "orizzontale": dict(w=1920, h=1080, fps=30)}

INK, BIANCO, SOFT, MUTO = "#0b0b0f", "#ffffff", "#c7c7d1", "#8a8a97"
LIME, VERDE, AMBRA = "#c8f169", "#0e6b47", "#f4b942"

DISSOLVENZA = 0.45
CODA = 1.1


def a_capo(testo, font, larghezza, draw):
    righe = []
    for paragrafo in testo.split("\n"):
        if not paragrafo.strip():
            righe.append("")
            continue
        corrente = ""
        for parola in paragrafo.split(" "):
            prova = (corrente + " " + parola).strip()
            if draw.textlength(prova, font=font) <= larghezza:
                corrente = prova
                continue
            if corrente:
                righe.append(corrente)
            pezzo = ""
            for ch in parola:
                if draw.textlength(pezzo + ch, font=font) <= larghezza:
                    pezzo += ch
                else:
                    righe.append(pezzo)
                    pezzo = ch
            corrente = pezzo
        righe.append(corrente)
    return righe


def disegna_righe(draw, righe, x, y, font, colore, interlinea):
    for i, r in enumerate(righe):
        draw.text((x, y + i * interlinea), r, font=font, fill=colore)
    return y + len(righe) * interlinea


def sfondo(w, h):
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)],
               fill=(int(0x0B + 8 * t), int(0x0B + 11 * t), int(0x0F + 14 * t)))
    alone = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    da = ImageDraw.Draw(alone)
    raggio = int(min(w, h) * 0.55)
    da.ellipse([w - raggio, -raggio // 2, w + raggio // 2, raggio],
               fill=(200, 241, 105, 16))
    alone = alone.filter(ImageFilter.GaussianBlur(int(min(w, h) * 0.09)))
    return Image.alpha_composite(img.convert("RGBA"), alone)


def marchio(draw, x, y, lato):
    draw.rounded_rectangle([x, y, x + lato, y + lato], radius=lato // 4, fill=LIME)
    f = ImageFont.truetype(FONT_B, int(lato * 0.62))
    tw = draw.textlength("T", font=f)
    draw.text((x + (lato - tw) / 2, y + lato * 0.14), "T", font=f, fill=INK)
    draw.text((x + lato + lato * 0.34, y + lato * 0.16), "Traccia", font=f, fill=BIANCO)


def tessera(draw, box, raggio=28):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([x0 + 4, y0 + 10, x1 + 4, y1 + 14], radius=raggio,
                           fill=(0, 0, 0, 90))
    draw.rounded_rectangle(box, radius=raggio, fill=BIANCO)


def campo_finto(draw, box, etichetta, attivo, scala=1.0):
    x0, y0, x1, y1 = box
    if attivo:
        draw.rounded_rectangle(box, radius=14, fill="#ffffff", outline=VERDE, width=4)
    else:
        draw.rounded_rectangle(box, radius=14, fill="#f4f4f0", outline="#e2e2da", width=2)
    f = ImageFont.truetype(FONT_B if attivo else FONT, int(26 * scala))
    draw.text((x0 + 22, y0 + (y1 - y0) / 2 - 15), etichetta, font=f,
              fill=INK if attivo else "#a8a8a2")
    if attivo:
        lx = x0 + 22 + draw.textlength(etichetta, font=f) + 14
        draw.rectangle([lx, y0 + 16, lx + 3, y1 - 16], fill=VERDE)


def pulsante_finto(draw, box, testo):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=(y1 - y0) // 2, fill=VERDE)
    f = ImageFont.truetype(FONT_B, 34)
    tw = draw.textlength(testo, font=f)
    draw.text((x0 + (x1 - x0 - tw) / 2, y0 + (y1 - y0) / 2 - 20), testo, font=f, fill=BIANCO)


def passo_campi(lang, box):
    """Quanto è alto un campo, quando la scheda è alta `box`.

    Le scene dei sei campi stanno in due formati di altezza molto diversa: nel
    verticale c'è spazio per 104 px a campo, nell'orizzontale no. Prima il
    disegno si adattava e la misura no, così la scheda si centrava su
    un'altezza sbagliata e il primo campo finiva sopra il bordo bianco.
    """
    y0, y1 = box[1], box[3]
    n = len(C.CAMPI[lang])
    return min(104.0, (y1 - y0 - 88 - 20 * (n - 1)) / n)


def altezza_scheda(draw, lang, scheda, box):
    x0, y0, x1, y1 = box
    dentro, utile = 44, x1 - x0 - 88
    tipo = scheda["tipo"]
    if tipo == "pulsante":
        return 150
    if tipo == "invia":
        return 200
    if tipo == "elenco":
        return 3 * (104 + 18) - 18
    if tipo == "campi":
        n = len(C.CAMPI[lang])
        passo = passo_campi(lang, box)
        return n * passo + (n - 1) * 20
    if tipo == "prove":
        return len(C.PROVE[lang]) * min(150, (y1 - y0 - 80) / len(C.PROVE[lang]))
    if tipo == "esito":
        f = ImageFont.truetype(FONT_B, 26)
        f2 = ImageFont.truetype(FONT, 23)
        larga = (utile - 20) / 2
        massimo = max(len(a_capo(r, f2, larga - 40, draw)) for _, rs in C.ESITI[lang] for r in rs)
        massimo = max(massimo, max(len(a_capo(t, f, larga - 84, draw)) for t, _ in C.ESITI[lang]))
        return 74 + massimo * 32 + 28
    if tipo == "scelte":
        f = ImageFont.truetype(FONT, 27)
        return sum(len(a_capo(t, f, utile - 70, draw)) * 36 + 34 for t in C.SCELTE[lang])
    return 0


def disegna_scheda(draw, lang, scheda, box):
    x0, y0, x1, y1 = box
    dentro, utile = 44, x1 - x0 - 88
    alto = altezza_scheda(draw, lang, scheda, box)
    top = y0 + (y1 - y0 - alto) / 2
    tipo = scheda["tipo"]

    if tipo == "pulsante":
        pulsante_finto(draw, (x0 + dentro, top, x1 - dentro, top + 108), C.PULSANTE[lang])
        f = ImageFont.truetype(FONT, 30)
        tw = draw.textlength(C.SITO, font=f)
        draw.text(((x0 + x1 - tw) / 2, top + 134), C.SITO, font=f, fill="#8a8a82")

    elif tipo == "elenco":
        larga = (utile - 24) / 2
        for i, nome in enumerate(C.CAMPI[lang]):
            riga, col = divmod(i, 2)
            cx = x0 + dentro + col * (larga + 24)
            cy = top + riga * (104 + 18)
            draw.rounded_rectangle([cx, cy, cx + larga, cy + 104], radius=16,
                                   fill="#f4f4f0", outline="#e2e2da", width=2)
            draw.text((cx + 20, cy + 18), "%d" % (i + 1), font=ImageFont.truetype(FONT_B, 28), fill=VERDE)
            f2 = ImageFont.truetype(FONT_B, 27)
            righe = a_capo(nome, f2, larga - 76, draw)
            disegna_righe(draw, righe, cx + 58, cy + (104 - len(righe) * 34) / 2 + 2, f2, INK, 34)

    elif tipo == "campi":
        campi = C.CAMPI[lang]
        passo = passo_campi(lang, box)
        for i, nome in enumerate(campi):
            cy = top + i * (passo + 20)
            campo_finto(draw, (x0 + dentro, cy, x1 - dentro, cy + passo), nome,
                        i in scheda["attivo"], scala=passo / 104.0)

    elif tipo == "scelte":
        f = ImageFont.truetype(FONT, 27)
        cy = top
        for i, testo in enumerate(C.SCELTE[lang]):
            righe = a_capo(testo, f, utile - 70, draw)
            alta = len(righe) * 36 + 26
            ultima = i == len(C.SCELTE[lang]) - 1
            if ultima:
                draw.rounded_rectangle([x0 + dentro - 10, cy - 6, x1 - dentro + 10, cy + alta + 6],
                                       radius=12, fill="#eef7e3")
            cx = x0 + dentro + 10
            draw.ellipse([cx, cy + alta / 2 - 11, cx + 22, cy + alta / 2 + 11],
                         outline=VERDE if ultima else "#c9c9c2", width=3)
            if ultima:
                draw.ellipse([cx + 6, cy + alta / 2 - 5, cx + 16, cy + alta / 2 + 5], fill=VERDE)
            disegna_righe(draw, righe, cx + 40, cy + 8, f, INK if ultima else "#5c5c58", 36)
            cy += alta + 8

    elif tipo == "prove":
        # il percorso del denaro: quattro tappe, ognuna con la sua prova
        f = ImageFont.truetype(FONT_B, 27)
        f2 = ImageFont.truetype(FONT, 24)
        tappe = C.PROVE[lang]
        passo = min(150, (y1 - y0 - 80) / len(tappe))
        cy = top + 6
        for i, (cosa, prova) in enumerate(tappe):
            r = 15
            centro = cy + passo / 2
            if i < len(tappe) - 1:
                draw.line([(x0 + dentro + r, centro + r), (x0 + dentro + r, centro + passo - r)],
                          fill="#d9d9d2", width=3)
            draw.ellipse([x0 + dentro, centro - r, x0 + dentro + 2 * r, centro + r],
                         fill="#eef7e3", outline=VERDE, width=3)
            draw.text((x0 + dentro + 2 * r + 22, centro - 30), cosa, font=f, fill=INK)
            draw.text((x0 + dentro + 2 * r + 22, centro + 4), prova, font=f2, fill="#6b6b66")
            cy += passo

    elif tipo == "esito":
        # due esiti, uno accanto all'altro, con lo stesso peso: il «no» non è
        # una nota a piè di pagina, è metà della risposta
        f = ImageFont.truetype(FONT_B, 26)
        f2 = ImageFont.truetype(FONT, 23)
        larga = (utile - 20) / 2
        # l'altezza la decidono le righe di testo: con il fondo a y1 restava
        # mezzo riquadro vuoto, e due schede semivuote sembrano un errore
        interno = larga - 40
        righe_titolo = max(len(a_capo(t, f, interno, draw)) for t, _ in C.ESITI[lang])
        righe_corpo = max(len(a_capo(r, f2, interno, draw)) for _, rs in C.ESITI[lang] for r in rs)
        alta = 72 + righe_titolo * 32 + 6 + righe_corpo * 30 + 20
        for i, (titolo, righe) in enumerate(C.ESITI[lang]):
            cx = x0 + dentro + i * (larga + 18)
            si = i == 0
            draw.rounded_rectangle([cx, top, cx + larga, top + alta], radius=16,
                                   fill="#eef7e3" if si else "#f4f4f0",
                                   outline=VERDE if si else "#dcdcd6", width=3)
            fsegno = ImageFont.truetype(FONT_B, 40)
            draw.text((cx + 20, top + 16), "✓" if si else "–", font=fsegno,
                      fill=VERDE if si else "#8a8a82")
            # il corpo parte da dove finisce davvero il titolo: con un salto
            # fisso, un titolo andato a capo ci finiva sopra
            y = disegna_righe(draw, a_capo(titolo, f, interno, draw), cx + 20, top + 72,
                              f, INK if si else "#4a4a46", 32) + 6
            for riga in righe:
                y = disegna_righe(draw, a_capo(riga, f2, larga - 40, draw), cx + 20, y,
                                  f2, "#5c5c58", 30) + 8

    elif tipo == "invia":
        nota = {"it": "Nessuna password da scegliere", "en": "No password to choose",
                "de": "Kein Passwort zu wählen", "es": "Ninguna contraseña que elegir"}[lang]
        draw.text((x0 + dentro, top + 4), "✓", font=ImageFont.truetype(FONT_B, 30), fill=VERDE)
        draw.text((x0 + dentro + 46, top + 6), nota, font=ImageFont.truetype(FONT, 28), fill="#5c5c58")
        pulsante_finto(draw, (x0 + dentro, top + 70, x1 - dentro, top + 178), C.INVIA[lang])


def disegna_scena(lang, idx, W, H, orizzontale):
    scena = C.SCENE[lang][idx]
    img = sfondo(W, H)
    d = ImageDraw.Draw(img)
    margine = 96 if not orizzontale else 110
    marchio(d, margine, 90 if not orizzontale else 70, 60 if not orizzontale else 54)

    passi = [i for i, s in enumerate(C.SCENE[lang]) if s["tipo"] == "passo"]
    if scena["tipo"] == "passo":
        testo = "%02d / %02d" % (passi.index(idx) + 1, len(passi))
        f = ImageFont.truetype(FONT_B, 34 if not orizzontale else 30)
        d.text((W - margine - d.textlength(testo, font=f), 100 if not orizzontale else 80),
               testo, font=f, fill=LIME)

    if orizzontale:
        col, larg = margine, int(W * 0.44)
        # il fondo a H-260, non H-160: sotto ci sta la fascia dei sottotitoli
        # (fino a 142 px) e la barra. Con il fondo a 160 la fascia le finiva
        # sopra, e la scheda sembrava tagliata a metà
        tessera_box = (int(W * 0.52), 170, W - margine, H - 260)
        y_tit, dim_t, dim_c, inter_c = 300, 74, 38, 56
    else:
        col, larg = margine, W - 2 * margine
        tessera_box = None
        y_tit, dim_t, dim_c, inter_c = 420, 88, 44, 64

    if scena["tipo"] == "titolo":
        f = ImageFont.truetype(FONT_B, 104 if not orizzontale else 92)
        y = disegna_righe(d, a_capo(scena["titolo"], f, larg, d), col, y_tit + 40, f,
                          BIANCO, 110 if not orizzontale else 98)
        y = disegna_righe(d, [scena["corpo"]], col, y + 24,
                          ImageFont.truetype(FONT_B, 46 if not orizzontale else 40), LIME, 60)
        d.text((col, (H - 300) if not orizzontale else (H - 190)), C.SITO,
               font=ImageFont.truetype(FONT, 34 if not orizzontale else 30), fill=SOFT)
        return img

    f_t = ImageFont.truetype(FONT_B, dim_t)
    y = disegna_righe(d, a_capo(scena["titolo"], f_t, larg, d), col, y_tit, f_t,
                      AMBRA if scena["tipo"] == "avviso" else BIANCO, dim_t + 14)
    f_c = ImageFont.truetype(FONT, dim_c)
    fondo = disegna_righe(d, a_capo(scena["corpo"], f_c, larg, d), col,
                          y + (26 if not orizzontale else 20), f_c, SOFT, inter_c)

    if scena["tipo"] == "avviso":
        cx, cy = (W // 2, 1180) if not orizzontale else (int(W * 0.75), H // 2 + 10)
        r = 130 if not orizzontale else 110
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#2a2010", outline=AMBRA, width=6)
        f = ImageFont.truetype(FONT_B, int(r * 1.25))
        d.text((cx - d.textlength("!", font=f) / 2, cy - r + int(r * 0.18)), "!", font=f, fill=AMBRA)
        return img

    if tessera_box is None:
        # 200 px in fondo: la fascia dei sottotitoli (fino a quattro righe,
        # 170 px, misurato su tutte e quattro le lingue) e la barra. Lasciarne
        # 150 come prima voleva dire una fascia che nei casi lunghi sfondava
        # nella scheda: misurato, non indovinato.
        alto = max(520, H - 360 - (fondo + 80))
        # con poche righe di contenuto (le due schede del recupero) una scheda
        # da 520 px resta mezza vuota, e ancorata in fondo lascia un buco fra
        # il testo e il riquadro. Qui la scheda si appoggia sotto il testo:
        # alto quanto serve, e non oltre la fascia dei sottotitoli.
        if scena["scheda"]["tipo"] == "esito":
            alto = int(altezza_scheda(d, lang, scena["scheda"], (margine, 0, W - margine, alto))) + 56
            alto = max(300, min(alto, H - 360 - fondo - 120))
            tessera_box = (margine, fondo + 90, W - margine, fondo + 90 + alto)
        tessera_box = (margine, H - 360 - alto, W - margine, H - 360)
    tessera(d, tessera_box)
    disegna_scheda(d, lang, scena["scheda"], tessera_box)
    return img


def _pezzi(testo, f, larg, d):
    """La frase spezzata alle frasi, non a metà parola: un sottotitolo che
    finisce con «Sie» invece di «Sie senden eine Anfrage» è peggio di nessun
    sottotitolo — chi legge resta in mezzo al pensiero."""
    pezzi, corrente = [], ""
    for frase in re.split(r"(?<=[.!?])\s+", testo):
        prova = (corrente + " " + frase).strip()
        if not corrente or d.textlength(prova, font=f) <= larg * 2.2:
            corrente = prova
        else:
            pezzi.append(corrente)
            corrente = frase
    if corrente:
        pezzi.append(corrente)
    return pezzi


def sottotitolo(img, testo, orizzontale):
    """La frase della scena, in basso, sopra la barra di avanzamento.

    Bruciata nel video e non solo come traccia: la traccia la vede chi apre i
    sottotitoli, e quasi nessuno li apre. Il testo è quello della voce, parola
    per parola, quindi le due versioni non possono dire cose diverse.

    Sotto la scheda ci stanno 200 px, cioè quattro righe: si usano tutte
    invece di tagliare la frase a metà. Tagliare è peggio di una riga in più —
    chi legge «...bonifici, indirizzi dei wallet, transazioni e chat…» non sa
    se il pensiero finiva lì. Si taglia solo quando nemmeno quattro righe
    bastano, e allora si rimpicciolisce prima il carattere.
    """
    if not testo:
        return img
    d = ImageDraw.Draw(img)
    W, H = img.size
    margine = 96 if not orizzontale else 110
    larg = W - 2 * margine - 40
    MASSIME = 4 if not orizzontale else 3

    for corpo, righe_max in ((28, MASSIME), (26, MASSIME), (24, MASSIME)):
        f = ImageFont.truetype(FONT_B, corpo)
        inter = int(corpo * 1.32)
        if orizzontale:
            righe = a_capo(testo, f, larg, d)
            if len(righe) <= righe_max:
                break
        else:
            # la frase intera se ci sta, altrimenti il maggior numero di frasi
            # intere che ci sta: mai una frase spezzata a metà
            intera = a_capo(testo, f, larg, d)
            if len(intera) <= righe_max:
                righe = intera
                break
            scelta = None
            for pezzo in _pezzi(testo, f, larg, d):
                prova = a_capo(pezzo, f, larg, d)
                if len(prova) <= righe_max:
                    scelta = pezzo if scelta is None else scelta
                    # si prova ad aggiungere la frase successiva, se ci sta
                    continue
                break
            if scelta:
                righe = a_capo(scelta, f, larg, d)
                if scelta != testo:
                    righe[-1] = righe[-1].rstrip(" .,;:") + "…"
                break
    else:
        f = ImageFont.truetype(FONT_B, 24)
        inter = 32
        righe = a_capo(testo, f, larg, d)
        if len(righe) > MASSIME:
            righe = righe[:MASSIME]
            righe[-1] = righe[-1].rstrip(" .,;:") + "…"

    alto = len(righe) * inter + 22
    y = H - (60 if not orizzontale else 52) - alto
    d.rounded_rectangle([margine, y, W - margine, y + alto], radius=12,
                        fill=(11, 11, 15, 200))
    disegna_righe(d, righe, margine + 20, y + 11, f, BIANCO, inter)
    return img


def barra(img, frazione, orizzontale):
    d = ImageDraw.Draw(img)
    W, H = img.size
    y, margine = H - 22, (96 if not orizzontale else 110)
    d.rectangle([margine, y, W - margine, y + 6], fill="#26262e")
    d.rectangle([margine, y, margine + (W - 2 * margine) * frazione, y + 6], fill=LIME)


def ffmpeg_bin():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def durata_audio(percorso, ff):
    out = subprocess.run([ff, "-i", percorso], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def confini(lang, percorso, ff):
    """Confini delle scene: stima dai caratteri agganciata alla pausa vera più
    vicina. Meglio un cambio scena un filo in anticipo che uno spostato di due
    frasi."""
    durata = durata_audio(percorso, ff)
    out = subprocess.run([ff, "-i", percorso, "-af", "silencedetect=noise=-30dB:d=0.12",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    inizi = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    fini = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    pause = [((a + b) / 2, b - a) for a, b in zip(inizi, fini) if b - a < 1.3]
    scene = C.SCENE[lang]
    totale = sum(len(s["voce"]) for s in scene)
    tagli, acc, prima = [], 0, 0.0
    for s in scene[:-1]:
        acc += len(s["voce"])
        stima = durata * acc / totale
        vicine = [p for p in pause if abs(p[0] - stima) < 1.7]
        punto = (min(vicine, key=lambda p: abs(p[0] - stima) - min(p[1], 0.4))[0]
                 if vicine else stima)
        punto = max(punto, prima + 1.6)
        tagli.append(punto)
        prima = punto
    return [0.0] + tagli + [durata]


def vtt(lang, tagli, percorso):
    """I sottotitoli: una riga per scena, con i tempi veri dei cambi scena."""
    def t(s):
        h, resto = divmod(s, 3600)
        m, sec = divmod(resto, 60)
        return "%02d:%02d:%06.3f" % (h, m, sec).replace(".", ",") if False else \
               "%02d:%02d:%02d,%03d" % (h, m, int(sec), int((sec - int(sec)) * 1000))
    righe = ["WEBVTT", ""]
    for i, testo in enumerate(C.SOTTOTITOLI_VTT[lang]):
        righe.append("%d" % (i + 1))
        righe.append("%s --> %s" % (t(tagli[i]), t(tagli[i + 1])))
        righe.append(testo)
        righe.append("")
    fuori = os.path.join(USCITA, "come-segnalare-un-caso-%s.vtt" % lang)
    with open(fuori, "w", encoding="utf8") as f:
        f.write("\n".join(righe))
    return fuori


def rendi(lang, formato, prova=False, cartella=None):
    ff = ffmpeg_bin()
    cfg = FORMATI[formato]
    W, H, FPS = cfg["w"], cfg["h"], cfg["fps"]
    orizzontale = formato == "orizzontale"
    audio = os.path.join(AUDIO, "voce-%s.mp3" % lang)
    tagli = confini(lang, audio, ff)
    durata = tagli[-1] + CODA
    if prova:
        tagli = tagli[:3] + [min(tagli[2] + 3.0, tagli[-1])]
        durata = tagli[-1] + 0.6

    basi = [disegna_scena(lang, i, W, H, orizzontale) for i in range(len(C.SCENE[lang]))]
    uscita_dir = cartella or USCITA
    os.makedirs(uscita_dir, exist_ok=True)
    # la prova non scrive mai sul file buono: una volta, lanciata per guardare
    # tre scene, ha sovrascritto i video veri con tredici secondi
    nome = "come-segnalare-un-caso-%s-%s%s.mp4" % (lang, formato, "-prova" if prova else "")
    uscita = os.path.join(uscita_dir, nome)

    proc = subprocess.Popen(
        [ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H),
         "-r", str(FPS), "-i", "-", "-i", audio, "-map", "0:v", "-map", "1:a",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "medium",
         "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k",
         # il video dura `durata`, l'audio meno: senza il riempimento il video
         # verrebbe tagliato sull'ultima parola e la scena finale sparirebbe
         "-af", "apad", "-t", "%.2f" % durata, uscita],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for f in range(int(durata * FPS)):
        t = f / FPS
        i = 0
        while i < len(tagli) - 2 and t >= tagli[i + 1]:
            i += 1
        # la dissolvenza viene prima dei sottotitoli: fusa dopo, riportava in
        # scena i fotogrammi senza fascia e il testo spariva per mezzo secondo
        # a ogni cambio di scena (visto nell'es, al minuto 1:02)
        if i > 0 and t - tagli[i] < DISSOLVENZA:
            img = Image.blend(basi[i - 1], basi[i], (t - tagli[i]) / DISSOLVENZA)
        else:
            img = basi[i].copy()
        img = sottotitolo(img, C.SOTTOTITOLI_VTT[lang][i], orizzontale)
        barra(img, min(t / durata, 1.0), orizzontale)
        proc.stdin.write(img.convert("RGB").tobytes())
    proc.stdin.close()
    proc.wait()
    print("%s  %.1fs" % (os.path.basename(uscita), durata))
    return uscita, tagli


def poster(lingua):
    """Il fotogramma di copertina: la scena con i sei campi, che è quella che
    dice di cosa parla il video senza leggere il titolo."""
    img = disegna_scena(lingua, 2, 1920, 1080, True).convert("RGB")
    os.makedirs(POSTER_DIR, exist_ok=True)
    fuori = os.path.join(POSTER_DIR, "guida-video-poster.jpg")
    img.resize((1280, 720), Image.LANCZOS).save(fuori, quality=82, optimize=True)
    print("guida-video-poster.jpg")
    return fuori


if __name__ == "__main__":
    lingue = [a for a in sys.argv[1:] if not a.startswith("--")] or C.LINGUE
    prova = "--prova" in sys.argv
    for lang in lingue:
        for formato in FORMATI:
            _, tagli = rendi(lang, formato, prova)
        if not prova:
            vtt(lang, tagli, None)
    if not prova:
        poster("it")
