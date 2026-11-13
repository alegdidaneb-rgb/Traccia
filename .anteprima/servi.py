#!/usr/bin/env python3
"""Serve la copia locale del sito con le storie finte, senza toccare il repo.

Perché non `python3 -m http.server` e basta: le pagine caricano gli asset da
`assets/<hash>/…`, e le pagine «riservate» (`app.html`, `admin.html`) hanno lo
script di sessione che rimanda al login. Qui si fanno due sole cose:
  · si toglie `<script src="…/session.js">` da app/admin, così l'anteprima si
    apre senza account (solo per questa copia, mai nel repo);
  · si aggiunge `.anteprima/storie-finte.js` subito dopo `api.js` alle pagine che
    servono a guardare le storie.
Nient'altro viene modificato: tutto il resto è il sito vero.
"""
from __future__ import annotations

import http.server
import pathlib
import re
import socketserver
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

PAGINE = {
    "index.html", "storie.html", "casi.html", "app.html", "admin.html", "login.html",
    "en/index.html", "de/index.html", "es/index.html",
    "en/storie.html", "de/storie.html", "es/storie.html",
}
RISERVATE = {"app.html", "admin.html"}

# L'iniezione va **subito dopo `api.js`**, non prima di `</body>`: gli script
# `defer` girano nell'ordine in cui compaiono, e `stories.js` chiama il
# database appena parte. Messa in fondo, l'anteprima arrivava dopo la prima
# chiamata vera — cioè mostrava zero storie e sembrava rotta.
INIEZIONE = '<script src="/.anteprima/storie-finte.js" defer></script>'


def trasforma(percorso: pathlib.Path) -> bytes | None:
    rel = percorso.relative_to(ROOT).as_posix()
    if rel not in PAGINE:
        return None
    testo = percorso.read_text(encoding="utf-8")
    if rel in RISERVATE:
        testo = re.sub(r'\s*<script src="[^"]*session\.js"[^>]*></script>', "", testo)
    if "storie-finte" not in testo:
        import re as _re
        m = _re.search(r'<script src="(/?assets/[0-9a-f]+/js/api\.js)" defer></script>', testo)
        if m:
            testo = testo.replace(m.group(0), m.group(0) + "\n  " + INIEZIONE, 1)
        else:                                   # nessuna api.js: in fondo
            testo = testo.replace("</body>", "  " + INIEZIONE + "\n</body>", 1)
    return testo.encode("utf-8")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def do_GET(self):  # noqa: N802
        pulito = self.path.split("?")[0].split("#")[0]
        if pulito == "/":
            pulito = "/index.html"
        file = (ROOT / pulito.lstrip("/")).resolve()
        if file.is_file() and file.suffix == ".html" and str(file).startswith(str(ROOT)):
            corpo = trasforma(file)
            if corpo is not None:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(corpo)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(corpo)
                return
        super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with Server(("0.0.0.0", porta), Handler) as httpd:
        print(f"anteprima su http://0.0.0.0:{porta}", flush=True)
        httpd.serve_forever()
