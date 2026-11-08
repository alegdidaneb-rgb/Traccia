# Catalogo WhatsApp Business

Sette articoli, cioè tutto quello che offriamo: le cinque fasi del servizio, la
percentuale sul recuperato e la guida gratuita delle prime 48 ore. Quattro
lingue, un file per lingua.

| File | Lingua | Da dove si importa |
|---|---|---|
| `it.csv` | italiano | catalogo principale |
| `en.csv` | inglese | catalogo per i clienti fuori dall'Italia |
| `de.csv` | tedesco | idem |
| `es.csv` | spagnolo | idem |

Ogni riga ha le colonne che Meta si aspetta per un data feed di catalogo:

| Colonna | Cosa contiene |
|---|---|
| `id` | identificativo stabile: `perizia-tecnica`, `valutazione-iniziale`, … |
| `title` | nome dell'articolo |
| `description` | cosa comprende, in una frase lunga |
| `availability` | `in stock` (è un servizio: si può sempre chiedere) |
| `condition` | `new` |
| `price` | `190.00 EUR` oppure `0.00 EUR` dove la cifra dipende dal caso |
| `link` | la pagina del sito che ne parla |
| `image_link` | la foto quadrata in `ritagli/` |
| `brand` | `Traccia` |

## Come si importa

**WhatsApp Business Manager → Catalogo → Aggiungi articoli → Importa da file.**
Se l'importazione non passa (succede: il catalogo di un'azienda non verificata
rifiuta i feed), le schede in `schede-it.md`, `schede-en.md`, … sono gli stessi
testi, da caricare a mano dall'app.

### Prima di incollare il file, due controlli

**1. Le immagini rispondono?** `image_link` è un indirizzo assoluto, e Meta lo
scarica dai suoi server: se il file non risponde `200`, la riga viene scartata
con un errore che non dice quale. Da terminale, una riga:

    for f in catalogo-whatsapp/ritagli/*.jpg; do
      curl -s -o /dev/null -w "%{http_code} " "https://traccia.it.com/$f"; echo "$f"
    done

Tutti `200`. Se qualcuno è `404` o `500`, la cartella non è pubblicata: `.vercelignore`
la deve lasciar passare (non è nell'elenco) e il deploy deve essere quello di
`main`.

**2. Le pagine del sito rispondono?** Il `link` di ogni articolo porta a una
pagina del sito, nella lingua del catalogo. Anche quelle devono essere raggiungibili.

### Le foto non si caricano dal telefono

`image_link` non accetta un file allegato: vuole un indirizzo pubblico. Se
preferisci non pubblicare la cartella, carica le immagini una volta a mano
dall'app e sostituisci `image_link` con gli indirizzi che ti restituisce Meta:
sono sempre gli stessi 28 file (`ritagli/<lingua>-<articolo>.jpg`).

## Le due regole che valgono più del resto

**1. Il prezzo deve essere vero.** Il contributo di 190 € c'è, e chi lo legge
nel catalogo lo ritrova identico sulla pagina Onorari e nel contratto. Dove la
cifra dipende dal caso (la percentuale sul recuperato) il prezzo nel catalogo è
0 e la regola sta nella descrizione: 12 % sulle somme effettivamente rientrate.
Un articolo a 0 € senza spiegazione è una promessa di gratuità che non possiamo
mantenere.

**2. Niente promesse di risultato.** Il catalogo è pubblico e lo legge anche
chi è appena stato truffato una seconda volta: è il pubblico più esposto che
esista. Nessuna descrizione dice «recuperiamo», nessuna promette tempi di
rientro. La frase che chiude la perizia — «non garantiamo alcun recupero:
nessun operatore può farlo» — sta lì per questo, e resta.

## Se cambi un testo o un prezzo

Non si modificano i CSV a mano: si modifica `tools/catalogo_whatsapp.py` e si
rigenera, altrimenti il catalogo e le schede dicono cose diverse.

    python3 tools/catalogo_whatsapp.py            # riscrive CSV, foto e schede
    python3 tools/catalogo_whatsapp.py --check    # esce 1 se sono indietro

Il prezzo della perizia deve restare uguale a quello di `onorari.html`: se
cambia là, cambia anche qui, e il test in `tests/catalogo_whatsapp.test.js`
fallisce finché non lo allinei.

## Cosa non c'è, e perché

Nel catalogo non ci sono gli onorari del legale: li paga il cliente
direttamente al suo avvocato, secondo il preventivo di quello. Metterli qui
come articolo a 0 € farebbe credere che siano compresi nel nostro contributo.
