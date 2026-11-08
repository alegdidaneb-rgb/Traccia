# I due giorni da 12 $

Il budget è 24 $ in totale. Non compra lead: compra **una risposta a una
domanda sola**. Questo foglio serve a decidere la domanda prima di spendere,
perché dopo è troppo tardi — con 22 clic la differenza fra «funziona» e «non
funziona» è una persona, e chi guarda i numeri senza una regola decide con la
pancia.

---

## Cosa ci si può aspettare

| Passo | Valore realistico | Da dove viene |
|---|---|---|
| Spesa | 24 $ (12 × 2 giorni) | il budget |
| CPM Austria, finanza/legale | 8–11 $ | benchmark 2026: Austria 7–11 $, Germania 7,60–12,40 $ |
| Impressioni | 2 200–3 000 | 24 $ ÷ CPM |
| CTR | 0,8–1,5 % | media del settore; sotto 0,5 % l'annuncio è sbagliato |
| Clic | **18–45** | |
| Modulo compilato | 2–5 % | traffico freddo su sei campi |
| **Segnalazioni** | **0,4 – 2,2** | |

| | CPM | CTR | Clic | Segnalazioni | Costo per segnalazione |
|---|---|---|---|---|---|
| Buono | 8 $ | 1,5 % | 45 | ~1,8 | ~13 $ |
| Centrale | 11 $ | 1,0 % | 22 | ~0,7 | ~37 $ |
| Scarso | 15 $ | 0,6 % | 10 | ~0,2 | — |

**La più probabile è una segnalazione. Zero è probabile quanto una.** Nello
scenario centrale la probabilità di chiudere a zero è circa il 50 %. Questo non
è un difetto della campagna: è il rumore di 22 clic.

Due avvertenze che valgono più dei numeri:

- **Meta non impara con 24 $.** L'apprendimento chiede circa 50 eventi a
  settimana; con 18–45 clic in due giorni non ci si arriva, e si paga il prezzo
  di un annuncio che non ha ancora trovato il pubblico. Va bene lo stesso,
  purché non si concluda che «Meta non funziona».
- **Potrebbe spendere meno.** Una campagna nuova con 12 $/giorno a volte
  consegna 7 $ il primo giorno. Contare su 15–24 $ effettivi, non su 24.

---

## La regola, decisa adesso

Si guarda **una cosa sola**: i clic. Non le segnalazioni.

| Dopo due giorni | Cosa vuol dire | Cosa fare |
|---|---|---|
| **≥ 25 clic**, zero moduli | l'annuncio funziona, la pagina no | il prossimo euro va sulla pagina: il modulo ha sei campi, e ognuno costa |
| **12–24 clic** | non si sa | rifare due giorni *identici* cambiando una cosa sola: il titolo |
| **< 12 clic** | l'annuncio funziona male | cambiare immagine e pubblico, non il testo |
| **≥ 1 segnalazione** | esiste | è già un risultato: si guarda da dove è arrivata |

Una segnalazione sola non dice niente sul *costo per lead* — dice che il
percorso esiste, dalla foto al telefono che squilla. Con 24 $ è tutto quello
che si può comprare, e vale la pena comprarlo bene.

Per leggere un numero che non sia rumore servono **~10 segnalazioni**: con
questi costi, 250–400 $ (tre settimane a 12 $/giorno, o una settimana a
40–55 $).

---

## Come si monta, in Meta

1. **Obiettivo:** *Traffico*, non *Lead*. Il modulo è sul sito e non è un
   modulo nativo di Meta: scegliere *Lead* senza il modulo collegato fa
   spendere per un evento che non esiste.
2. **Budget:** 12 $/giorno, **a livello di campagna** (CBO) con un solo
   gruppo di inserzioni. Due gruppi con 6 $ ciascuno non arrivano a niente.
3. **Pubblico:** Austria, 30–70 anni, tutti i generi. Niente interessi: con
   questo budget l'algoritmo non ha dati per usarli, e restringerlo alza il
   costo. Un'esclusione sola: chi ha già visitato il sito negli ultimi 30
   giorni, così i 24 $ non si spendono su chi ci conosce già.
4. **Posizionamenti:** automatici. Con 24 $ togliere le storie significa
   togliere metà delle impressioni possibili.
5. **Annuncio:** una lingua sola — **tedesco**. Dividerlo su italiano e
   tedesco dà 12 clic per lingua: due test che non concludono niente invece di
   uno.
6. **Immagini:** `feed-quadrato.jpg` e `storia.jpg`. Caricarne quattro
   significa dividere i dati su quattro; due bastano, e la storia è quella che
   su Instagram si vede a schermo intero.
7. **Testi:** da `annunci.md`, colonna `de`. Limiti già contati.
8. **Indirizzo:** `https://traccia.it.com/de/?utm_source=meta&utm_medium=ads&utm_campaign=de`

Il parametro `utm` non è decorazione: finisce nella colonna `origine` della
console insieme alla segnalazione, quindi alla fine dei due giorni si sa se i
clic venivano dal tedesco o dall'italiano. Senza, si è speso 24 $ e non si è
imparato niente.

---

## Cosa guardare in console

In `admin.html` → **Segnalazioni dal sito**, la colonna **Origine** dice
`meta · de` quando la segnalazione è arrivata dall'annuncio. Se dice `diretta`,
la persona ha scritto l'indirizzo o è arrivata da un preferito: non è
pubblicità.

Se dopo due giorni ci sono clic su Meta e **zero righe** in console, il
problema non è l'annuncio: è la pagina. Vai su `traccia.it.com/de/`, prova il
modulo dal telefono, e guarda se il pulsante manda davvero — è già successo una
volta, ed è costato più di 24 $.

---

## Cosa non c'è, e perché

- **Nessuna promessa di risultato.** Né «garantito», né «recuperiamo», né «ti
  restituiamo». La promessa è un metodo e una risposta entro 48 ore lavorative.
  Il pubblico dell'annuncio sta cercando proprio le parole dei truffatori per
  riconoscerle.
- **Nessun testo dentro le immagini.** Meta abbassa la distribuzione delle
  immagini con molto testo, e un'immagine con le parole dentro non si corregge
  il secondo giorno né si traduce.
- **Nessun remarketing.** Con 24 $ non c'è pubblico da inseguire: c'è una
  domanda a cui rispondere.
