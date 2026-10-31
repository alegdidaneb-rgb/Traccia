#!/usr/bin/env python3
"""
Traccia — aggiornamento della "shell" comune a tutte le pagine.

Applica, in modo idempotente:
  • link a premium.css dopo style.css
  • preload dei due font principali
  • favicon corretta (T, non A) + apple-touch-icon
  • meta og:image e twitter:image
  • noindex su area riservata e 404
  • barra di avanzamento lettura + script premium.js
  • correzione riferimenti a file JS non esistenti

Uso: python3 tools/upgrade_shell.py
"""
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = sorted(p for p in ROOT.glob("*.html"))

FAVICON = (
    "<link rel=\"icon\" href=\"data:image/svg+xml,"
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
    "<rect width='100' height='100' rx='24' fill='%230a0a0d'/>"
    "<text x='50' y='71' font-size='58' font-family='Georgia,serif' "
    "font-style='italic' fill='%23c9f26b' text-anchor='middle'>T</text></svg>\">\n"
    "  <link rel=\"apple-touch-icon\" href=\"assets/img/apple-touch-icon.png\">"
)

FONT_PRELOAD = (
    "  <link rel=\"preload\" href=\"assets/fonts/inter-var.woff2\" as=\"font\" "
    "type=\"font/woff2\" crossorigin>\n"
    "  <link rel=\"preload\" href=\"assets/fonts/display-serif.woff2\" as=\"font\" "
    "type=\"font/woff2\" crossorigin>"
)

NOINDEX = '<meta name="robots" content="noindex, nofollow">'
NOINDEX_TARGETS = {"app.html", "admin.html", "404.html"}

OG_IMAGE = (
    '<meta property="og:image" content="https://traccia.it/assets/img/og-cover.jpg">\n'
    '  <meta property="og:image:width" content="1200">\n'
    '  <meta property="og:image:height" content="630">\n'
    '  <meta property="og:image:alt" content="Traccia — indagini forensi su truffe finanziarie e criptovalute">'
)

PROGRESS_TAG = '  <div class="scroll-progress" aria-hidden="true"></div>\n'


def ensure_premium_css(html: str) -> str:
    if "premium.css" in html:
        return html
    return html.replace(
        '<link rel="stylesheet" href="assets/css/style.css">',
        '<link rel="stylesheet" href="assets/css/style.css">\n'
        '  <link rel="stylesheet" href="assets/css/premium.css">',
    )


def ensure_font_preload(html: str) -> str:
    if "assets/fonts/inter-var.woff2" in html:
        return html
    return html.replace(
        '<link rel="stylesheet" href="assets/css/style.css">',
        FONT_PRELOAD + "\n  " + '<link rel="stylesheet" href="assets/css/style.css">',
    )


def fix_favicon(html: str) -> str:
    html = re.sub(
        r'<link rel="icon" href="data:image/svg\+xml,<svg[^"]*?">',
        FAVICON,
        html,
    )
    return html


def ensure_og_image(html: str) -> str:
    if 'property="og:image"' in html:
        return html
    if '<meta property="og:url"' in html:
        return re.sub(
            r'(<meta property="og:url"[^>]*>)',
            r"\1\n  " + OG_IMAGE,
            html,
            count=1,
        )
    # 404 e simili: inserisci dopo description
    return re.sub(
        r'(<meta name="description"[^>]*>)',
        r"\1\n  " + OG_IMAGE,
        html,
        count=1,
    )


def apply_noindex(html: str) -> str:
    html = re.sub(
        r'<meta name="robots" content="[^"]*">',
        NOINDEX,
        html,
        count=1,
    )
    return html


def ensure_scripts(html: str) -> str:
    # rimuovi riferimenti a JS inesistenti
    html = re.sub(r'\s*<script src="assets/js/anim\.js"[^>]*></script>', "", html)
    if "premium.js" not in html:
        html = html.replace(
            "</body>",
            '  <script src="assets/js/premium.js" defer></script>\n</body>',
        )
    return html


def ensure_progress(html: str) -> str:
    if "scroll-progress" in html:
        return html
    return html.replace('<a class="skip-link"', PROGRESS_TAG + '  <a class="skip-link"', 1)


def main() -> None:
    for page in PAGES:
        raw = page.read_text(encoding="utf-8")
        out = raw
        out = fix_favicon(out)
        out = ensure_premium_css(out)
        out = ensure_font_preload(out)
        out = ensure_og_image(out)
        if page.name in NOINDEX_TARGETS:
            out = apply_noindex(out)
        out = ensure_scripts(out)
        out = ensure_progress(out)
        if out != raw:
            page.write_text(out, encoding="utf-8")
            print(f"aggiornata  {page.name}")
        else:
            print(f"invariata   {page.name}")


if __name__ == "__main__":
    main()
