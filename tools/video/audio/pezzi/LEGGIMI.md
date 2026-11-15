# I pezzi della voce

Qui vanno le registrazioni, una per scena, prima di comporle in
`../../audio/voce-<lingua>.mp3`.

Il testo esatto da registrare lo stampa:

    python3 tools/video/registra.py testo it
    python3 tools/video/registra.py testo en
    python3 tools/video/registra.py testo de
    python3 tools/video/registra.py testo es

Poi i file vanno messi in una cartella per lingua, numerati come l'elenco:

    audio/pezzi/it/01.mp3 … 12.mp3

...un pezzo per frase, `mp3` o `wav`, voce sintetica, e si compone tutto con:

    python3 tools/video/registra.py componi it

Perché a pezzi e non tutto in una volta: la narrazione tedesca, con le due
scene sul recupero, supera i 1.400 caratteri, e i servizi di sintesi vocale
hanno quasi sempre un limite per richiesta. Una frase per volta lo aggira e
dà al taglio delle scene una pausa pulita a ogni cambio.

**La voce deve restare la stessa.** Non è un dettaglio estetico: chi ha visto
la prima versione del video riconosce la voce, e cambiarla a metà guida
sembra un'altra azienda. Prima di registrare, riascolta `../voce-it.mp3`.

Le pause fra i pezzi le mette `registra.py`: non serve lasciare silenzio in
fondo a ogni registrazione, e non va tagliato via l'inizio della frase.
