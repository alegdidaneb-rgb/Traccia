#!/usr/bin/env python3
"""traccia — il catalogo WhatsApp Business, generato dai testi del sito.

Perché un generatore e non dodici CSV scritti a mano: i prezzi, i tempi e i
limiti stanno già in `onorari.html`, `come-funziona.html` e `supporto.html`.
Copiarli in un file a parte significa che un giorno uno dei due cambia e
l'altro no — e sul catalogo WhatsApp, che il cliente legge prima di parlarci,
un prezzo vecchio è una promessa sbagliata.

Cosa produce, in `catalogo-whatsapp/`:

    it.csv, en.csv, de.csv, es.csv         un file per lingua, da importare
    ritagli/*.jpg                          le foto quadrate degli articoli
    schede-<lingua>.md                     le schede da copiare a mano

Il formato del CSV è quello che Meta si aspetta per un data feed di catalogo:
`id, title, description, availability, condition, price, link, image_link,
brand`. Le colonne sono nell'ordine del file di esempio di Meta, i prezzi
portano la valuta (`190.00 EUR`), la disponibilità è `in stock`.
`wa_compliance_category` resta vuota: vale per i prodotti soggetti a
limitazioni per età, non per un servizio di analisi.

Uso:
    python3 tools/catalogo_whatsapp.py            # scrive tutto
    python3 tools/catalogo_whatsapp.py --check    # esce 1 se i file sono vecchi
"""

from __future__ import annotations

import csv
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
USCITA = ROOT / "catalogo-whatsapp"
RITAGLI = USCITA / "ritagli"
IMMAGINI = ROOT / "assets" / "img"

SITO = "https://traccia.it.com"
BRAND = "Traccia"
DISPONIBILE = "in stock"
NUOVO = "new"
VALUTA = "EUR"

# I colori del sito: le schede devono sembrare fatte dalla stessa mano.
INK = (11, 11, 15)
CORTA = (247, 247, 245)
ACCENTO = (200, 241, 105)
VERDE = (14, 107, 71)
MUTO = (108, 108, 120)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Un articolo per ogni cosa che offriamo. `prezzo` è in euro, con due decimali;
# 0 dove la cifra dipende dal caso — e in quel caso la descrizione dice come si
# calcola, perché un «0 €» senza spiegazione è una promessa di gratuità che non
# possiamo mantenere.
#
# `titolo`, `descrizione` e `scheda` non si inventano qui: sono la stessa cosa
# che il sito dice, accorciata per il catalogo. Il collegamento porta alla
# pagina che ne parla per esteso, così chi vuole i dettagli li trova e chi sta
# scorrendo il telefono non legge un muro di testo.
ARTICOLI = [
    {
        "id": "valutazione-iniziale",
        "titolo": "Valutazione iniziale del caso",
        "prezzo": "0.00",
        "immagine": "support-calm-1400.jpg",
        "pagina": "come-funziona.html#fasi",
        "descrizione": (
            "Un colloquio di circa trenta minuti e la verifica dei documenti. "
            "Capiamo se il caso rientra nel nostro perimetro: truffa finanziaria "
            "online, investimenti, cripto, finti recuperi. Gratuita e senza "
            "impegno: se il caso non ha senso, te lo diciamo qui."
        ),
        "scheda": [
            "**Cosa comprende**",
            "- Colloquio di circa 30 minuti, al telefono o in videoconferenza",
            "- Verifica dei documenti che hai (bonifici, ricevute, screenshot, chat)",
            "- Risposta chiara: il caso rientra o non rientra, e perché",
            "",
            "**Tempi** 1-2 giorni dalla prima segnalazione.",
            "**Costo** Nessuno.",
            "",
            "Prima di questa chiamata non serve nessun pagamento e nessuna password.",
        ],
    },
    {
        "id": "ricostruzione-flusso",
        "titolo": "Ricostruzione del flusso dei fondi",
        "prezzo": "0.00",
        "immagine": "network-nodes-1400.jpg",
        "pagina": "come-funziona.html#fasi",
        "descrizione": (
            "Seguiamo il denaro: catena dei conti di destinazione e intestazioni "
            "per i bonifici, transazioni on-chain per le cripto, con exchange e "
            "servizi di mixing identificati. Compresa nel contributo di avvio. "
            "Se qui non resta una traccia, ci fermiamo senza chiedere nulla."
        ),
        "scheda": [
            "**Cosa produciamo**",
            "- Diagramma dei flussi",
            "- Elenco degli indirizzi e degli istituti coinvolti",
            "- Cronologia delle operazioni",
            "",
            "**Tempi** 3-5 giorni lavorativi.",
            "**Costo** Compresa nel contributo di avvio: non è una voce a parte.",
            "",
            "Se in questa fase non emerge nulla su cui agire, ci fermiamo "
            "gratuitamente e il contributo non viene chiesto.",
        ],
    },
    {
        "id": "perizia-tecnica",
        "titolo": "Perizia tecnica firmata",
        "prezzo": "190.00",
        "immagine": "perizia-doc-1400.jpg",
        "pagina": "come-funziona.html#fasi",
        "descrizione": (
            "Un documento datato, firmato e numerato che descrive il percorso dei "
            "fondi con i dati raccolti. Cronologia, indirizzi e hash, istituti "
            "coinvolti, punti di aggancio, limiti dell'analisi. Serve a te per "
            "capire e al legale per costruire l'atto. Contributo di avvio 190 EUR "
            "IVA inclusa, una volta sola."
        ),
        "scheda": [
            "**Contenuto**",
            "- Cronologia delle operazioni",
            "- Indirizzi e hash delle transazioni",
            "- Istituti e exchange coinvolti",
            "- Punti di aggancio individuati",
            "- Limiti dell'analisi: cosa non è stato possibile verificare",
            "",
            "**Prezzo** 190 EUR IVA inclusa, una volta sola.",
            "**Tempi** 10 giorni lavorativi dalla consegna completa dei documenti.",
            "",
            "Il contributo si paga dopo la valutazione gratuita e solo se "
            "decidiamo insieme di procedere. Non è un anticipo sul recupero e non "
            "è rimborsabile una volta avviata l'analisi. Non garantiamo alcun "
            "recupero: nessun operatore può farlo.",
        ],
    },
    {
        "id": "denunce-segnalazioni",
        "titolo": "Denunce e segnalazioni",
        "prezzo": "0.00",
        "immagine": "process-desk-1400.jpg",
        "pagina": "supporto.html#segnalare",
        "descrizione": (
            "Ti assistiamo nella preparazione degli atti che puoi presentare da "
            "solo: denuncia, segnalazione alla Polizia Postale, all'AGCM, "
            "all'OCLAFP, e nelle richieste agli istituti di credito o agli "
            "exchange per la conservazione dei dati e il blocco delle somme. "
            "Incluso nel contributo di avvio."
        ),
        "scheda": [
            "**Cosa facciamo**",
            "- Prepariamo la bozza degli atti, tu li firmi e li presenti",
            "- Richieste di conservazione dei dati a banche ed exchange",
            "- Richieste di blocco delle somme",
            "",
            "**Chi firma** Tu, per gli atti che ti riguardano. Un avvocato, per "
            "quelli che lo richiedono.",
            "**Tempi** 2-4 settimane per la predisposizione.",
            "**Costo** Incluso nel contributo di avvio. Restano a parte gli "
            "eventuali onorari del legale.",
        ],
    },
    {
        "id": "coordinamento-legale",
        "titolo": "Coordinamento con il tuo legale",
        "prezzo": "0.00",
        "immagine": "team-room-1600.jpg",
        "pagina": "come-funziona.html#fasi",
        "descrizione": (
            "Se il caso regge, la perizia passa al tuo avvocato o a uno dei "
            "professionisti con cui collaboriamo. Restiamo a disposizione per "
            "chiarimenti tecnici, integrazioni e contraddittorio. Non siamo noi a "
            "difenderti in giudizio: il legale lo scegli e lo paghi tu, secondo "
            "il suo preventivo."
        ),
        "scheda": [
            "**Cosa comprende**",
            "- Passaggio della perizia al legale, con i dati tecnici citabili",
            "- Chiarimenti tecnici durante il giudizio",
            "- Integrazioni e allegati richiesti dal legale",
            "",
            "**Chi paga il legale** Tu, direttamente, secondo il suo preventivo. "
            "Non prendiamo percentuali sui suoi onorari.",
            "**Costo** Incluso nel contributo di avvio.",
        ],
    },
    {
        "id": "percentuale-recuperato",
        "titolo": "Percentuale sul recuperato",
        "prezzo": "0.00",
        "immagine": "hero-trace-1600.jpg",
        "pagina": "onorari.html",
        "descrizione": (
            "12 per cento sulle somme effettivamente rientrate, calcolata al netto "
            "delle spese bancarie e delle imposte pagate per il rientro. Solo su "
            "denaro realmente accreditato a te, entro 24 mesi dalla firma. Se non "
            "rientra nulla, non ci devi nulla."
        ),
        "scheda": [
            "**Come si calcola** 12 % sulle somme effettivamente rientrate a te, "
            "al netto delle spese bancarie e delle imposte pagate per il rientro.",
            "",
            "**Quando si applica** Solo su denaro realmente accreditato, entro 24 "
            "mesi dalla firma del contratto.",
            "**Quando non si applica** Sugli importi che ti vengono solo "
            "«riconosciuti», e sul contributo di avvio.",
            "**Se non rientra nulla** Non ci devi nulla.",
            "",
            "Esempio: su un caso da 20.000 EUR in cui rientrano 6.000 EUR, la "
            "percentuale è 720 EUR, oltre al contributo di 190 EUR.",
        ],
    },
    {
        "id": "guida-prime-48-ore",
        "titolo": "Guida: cosa fare nelle prime 48 ore",
        "prezzo": "0.00",
        "immagine": "guida-48h-1400.jpg",
        # `og-cover.jpg` sarebbe la scelta ovvia e sarebbe sbagliata: è la
        # copertina social, con il titolo della home inciso dentro i pixel. Su
        # una scheda del catalogo quel testo si legge due volte, e in due
        # lingue diverse quando la scheda è tedesca.
        "pagina": "supporto.html",
        "descrizione": (
            "Le prime sei cose da fare dopo una truffa, nell'ordine giusto: "
            "fermare i pagamenti senza chiudere il conto, mettere al sicuro il "
            "wallet, conservare le prove, presentare denuncia, chiedere la "
            "conservazione dei dati, segnalare alle autorità. Gratuita."
        ),
        "scheda": [
            "**L'ordine conta più della velocità**",
            "1. Ferma i pagamenti, ma non chiudere il conto: l'estratto conto è "
            "la prova principale.",
            "2. Se hai dato accesso a un wallet, consideralo compromesso: creane "
            "uno nuovo e sposta i token rimasti.",
            "3. Conserva tutto adesso: screenshot, email, chat, ricevute, hash "
            "delle transazioni.",
            "4. Denuncia: qualsiasi stazione dei Carabinieri o commissariato, "
            "oppure online alla Polizia di Stato.",
            "5. Chiedi a banca ed exchange la conservazione dei dati: i tempi "
            "sono limitati, ogni giorno conta.",
            "6. Segnala alle autorità di vigilanza: CONSOB, AGCM, OCLAFP.",
            "",
            "**Costo** Nessuno. La guida completa è sul sito, nella pagina "
            "Supporto.",
        ],
    },
]

LINGUE = ("it", "en", "de", "es")

# Le stesse schede nelle altre lingue. Sono tradotte a mano e non generate:
# il catalogo lo legge un cliente prima di scriverci, e una macchina che
# traduce «punto di aggancio» produce una frase che nessuno capisce.
TRADUZIONI = {
    "en": {
        "valutazione-iniziale": (
            "Initial assessment of the case",
            "A call of about thirty minutes and a check of your documents. We "
            "establish whether the case falls within our scope: online financial "
            "fraud, investments, crypto, fake recovery offers. Free and with no "
            "obligation: if the case makes no sense, we tell you here.",
        ),
        "ricostruzione-flusso": (
            "Reconstruction of the flow of funds",
            "We follow the money: the chain of destination accounts and their "
            "holders for transfers, on-chain transactions for crypto, with "
            "exchanges and mixing services identified. Included in the initial "
            "fee. If no trace remains, we stop without charging anything.",
        ),
        "perizia-tecnica": (
            "Signed technical expert report",
            "A dated, signed and numbered document describing the path of the "
            "funds using the data gathered: timeline, addresses and hashes, "
            "institutions involved, points of attachment, limits of the analysis. "
            "It serves you to understand and your lawyer to build the case. "
            "Initial fee 190 EUR incl. VAT, charged once.",
        ),
        "denunce-segnalazioni": (
            "Complaints and reports",
            "We help you prepare the documents you can file yourself: the criminal "
            "complaint, reports to the Postal Police, the AGCM and the OCLAFP, and "
            "requests to banks or exchanges to preserve data and block the sums. "
            "Included in the initial fee.",
        ),
        "coordinamento-legale": (
            "Coordination with your lawyer",
            "If the case holds, the report goes to your lawyer or to one of the "
            "professionals we work with. We stay available for technical "
            "clarifications, additions and cross-examination. We do not defend you "
            "in court: you choose and pay the lawyer, on their own quote.",
        ),
        "percentuale-recuperato": (
            "Percentage on what is recovered",
            "12 per cent on the sums actually recovered, calculated net of the "
            "bank charges and taxes paid to obtain the recovery. Only on money "
            "actually credited to you, within 24 months of signing. If nothing "
            "comes back, you owe us nothing.",
        ),
        "guida-prime-48-ore": (
            "Guide: what to do in the first 48 hours",
            "The first six things to do after a fraud, in the right order: stop "
            "the payments without closing the account, secure the wallet, keep the "
            "evidence, file the complaint, ask for data preservation, report to "
            "the authorities. Free.",
        ),
    },
    "de": {
        "valutazione-iniziale": (
            "Erste Einschätzung des Falls",
            "Ein Gespräch von etwa dreißig Minuten und die Prüfung Ihrer "
            "Unterlagen. Wir klären, ob der Fall in unseren Bereich fällt: "
            "Finanzbetrug im Internet, Anlagen, Krypto, gefälschte "
            "Rückholangebote. Kostenlos und unverbindlich: Ergibt der Fall keinen "
            "Sinn, sagen wir es Ihnen hier.",
        ),
        "ricostruzione-flusso": (
            "Rekonstruktion des Geldflusses",
            "Wir folgen dem Geld: bei Überweisungen die Kette der Zielkonten und "
            "deren Inhaber, bei Krypto die Transaktionen auf der Blockchain, mit "
            "identifizierten Börsen und Mixing-Diensten. Im Startbeitrag "
            "enthalten. Bleibt keine Spur, hören wir auf, ohne etwas zu "
            "verlangen.",
        ),
        "perizia-tecnica": (
            "Unterzeichnetes technisches Gutachten",
            "Ein datiertes, unterzeichnetes und nummeriertes Dokument, das den Weg "
            "der Gelder mit den erhobenen Daten beschreibt: Chronologie, Adressen "
            "und Hashes, beteiligte Institute, Anknüpfungspunkte, Grenzen der "
            "Analyse. Es dient Ihnen zum Verstehen und der Anwaltschaft zum "
            "Aufbau des Verfahrens. Startbeitrag 190 EUR inkl. USt., einmalig.",
        ),
        "denunce-segnalazioni": (
            "Anzeigen und Meldungen",
            "Wir unterstützen Sie bei den Schriftstücken, die Sie selbst "
            "einreichen können: Strafanzeige, Meldung an die Postpolizei, an die "
            "AGCM und an die OCLAFP, sowie bei Ersuchen an Banken oder Börsen um "
            "Datenaufbewahrung und Sperrung der Beträge. Im Startbeitrag "
            "enthalten.",
        ),
        "coordinamento-legale": (
            "Koordination mit Ihrer Anwältin",
            "Trägt der Fall, geht das Gutachten an Ihre Anwältin oder an eine der "
            "Kanzleien, mit denen wir zusammenarbeiten. Wir bleiben für "
            "technische Rückfragen, Ergänzungen und die Beweisaufnahme "
            "verfügbar. Wir verteidigen Sie nicht vor Gericht: Die Anwältin "
            "wählen und bezahlen Sie, nach deren Kostenvoranschlag.",
        ),
        "percentuale-recuperato": (
            "Beteiligung am Zurückgeflossenen",
            "12 Prozent auf die tatsächlich zurückgeflossenen Beträge, berechnet "
            "nach Abzug der Bankgebühren und Steuern, die für den Rückfluss "
            "gezahlt wurden. Nur auf Geld, das Ihnen tatsächlich gutgeschrieben "
            "wird, innerhalb von 24 Monaten ab Unterzeichnung. Fließt nichts "
            "zurück, schulden Sie uns nichts.",
        ),
        "guida-prime-48-ore": (
            "Leitfaden: was in den ersten 48 Stunden zu tun ist",
            "Die ersten sechs Schritte nach einem Betrug, in der richtigen "
            "Reihenfolge: Zahlungen stoppen, ohne das Konto zu schließen; das "
            "Wallet sichern; Beweise aufbewahren; Anzeige erstatten; "
            "Datenaufbewahrung verlangen; bei den Aufsichtsbehörden melden. "
            "Kostenlos.",
        ),
    },
    "es": {
        "valutazione-iniziale": (
            "Valoración inicial del caso",
            "Una conversación de unos treinta minutos y la revisión de tus "
            "documentos. Vemos si el caso entra en nuestro ámbito: fraude "
            "financiero online, inversiones, cripto, falsas ofertas de "
            "recuperación. Gratuita y sin compromiso: si el caso no tiene sentido, "
            "te lo decimos aquí.",
        ),
        "ricostruzione-flusso": (
            "Reconstrucción del flujo de los fondos",
            "Seguimos el dinero: la cadena de cuentas de destino y sus titulares "
            "en las transferencias, las transacciones on-chain en cripto, con "
            "exchanges y servicios de mezcla identificados. Incluida en el aporte "
            "inicial. Si aquí no queda rastro, paramos sin pedir nada.",
        ),
        "perizia-tecnica": (
            "Peritaje técnico firmado",
            "Un documento fechado, firmado y numerado que describe el recorrido "
            "de los fondos con los datos recogidos: cronología, direcciones y "
            "hashes, entidades implicadas, puntos de anclaje, límites del "
            "análisis. Te sirve para entender y al abogado para construir el "
            "escrito. Aporte inicial 190 EUR IVA incluido, una sola vez.",
        ),
        "denunce-segnalazioni": (
            "Denuncias y comunicaciones",
            "Te asistimos en la preparación de los escritos que puedes presentar "
            "tú mismo: denuncia, comunicación a la Policía Postal, a la AGCM y a "
            "la OCLAFP, y en las solicitudes a bancos o exchanges para conservar "
            "los datos y bloquear las sumas. Incluido en el aporte inicial.",
        ),
        "coordinamento-legale": (
            "Coordinación con tu abogado",
            "Si el caso se sostiene, el peritaje pasa a tu abogado o a uno de los "
            "profesionales con los que colaboramos. Seguimos disponibles para "
            "aclaraciones técnicas, ampliaciones y contradicción. No te "
            "defendemos en juicio: el abogado lo eliges y lo pagas tú, según su "
            "presupuesto.",
        ),
        "percentuale-recuperato": (
            "Porcentaje sobre lo recuperado",
            "12 por ciento sobre las sumas efectivamente recuperadas, calculado "
            "neto de los gastos bancarios y los impuestos pagados para la "
            "recuperación. Solo sobre dinero realmente abonado a ti, dentro de los "
            "24 meses siguientes a la firma. Si no vuelve nada, no nos debes nada.",
        ),
        "guida-prime-48-ore": (
            "Guía: qué hacer en las primeras 48 horas",
            "Las seis primeras cosas que hacer tras un fraude, en el orden "
            "correcto: detener los pagos sin cerrar la cuenta, poner a salvo la "
            "wallet, conservar las pruebas, presentar denuncia, pedir la "
            "conservación de los datos, comunicarlo a las autoridades. Gratis.",
        ),
    },
}

# Le schede lunghe, per chi le carica a mano: quelle italiane stanno negli
# articoli, queste sono le stesse nelle altre lingue.
SCHEDE = {
    "en": {
        "valutazione-iniziale": [
            "**What it includes**",
            "- A call of about 30 minutes, by phone or video",
            "- A check of the documents you have (transfers, receipts, screenshots, chats)",
            "- A clear answer: the case is in scope or it is not, and why",
            "",
            "**Timing** 1-2 days from first contact.",
            "**Cost** None.",
            "",
            "No payment and no password are needed before this call.",
        ],
        "ricostruzione-flusso": [
            "**What we produce**",
            "- A diagram of the flows",
            "- The list of addresses and institutions involved",
            "- A timeline of the transactions",
            "",
            "**Timing** 3-5 working days.",
            "**Cost** Included in the initial fee: it is not a separate item.",
            "",
            "If nothing actionable emerges at this stage, we stop free of charge "
            "and the fee is not requested.",
        ],
        "perizia-tecnica": [
            "**Contents**",
            "- Timeline of the transactions",
            "- Addresses and transaction hashes",
            "- Institutions and exchanges involved",
            "- The points of attachment identified",
            "- Limits of the analysis: what could not be verified",
            "",
            "**Price** 190 EUR incl. VAT, charged once.",
            "**Timing** 10 working days from complete delivery of the documents.",
            "",
            "The fee is paid after the free assessment and only if we decide "
            "together to proceed. It is not an advance on any recovery and is not "
            "refundable once the analysis has started. We do not guarantee any "
            "recovery: no operator can.",
        ],
        "denunce-segnalazioni": [
            "**What we do**",
            "- We draft the documents, you sign and file them",
            "- Requests to preserve data, to banks and exchanges",
            "- Requests to block the sums",
            "",
            "**Who signs** You, for the documents that concern you. A lawyer, for "
            "those that require one.",
            "**Timing** 2-4 weeks to prepare.",
            "**Cost** Included in the initial fee. Any lawyer's fees stay separate.",
        ],
        "coordinamento-legale": [
            "**What it includes**",
            "- Handover of the report to the lawyer, with citable technical data",
            "- Technical clarifications during the proceedings",
            "- Additions and annexes requested by the lawyer",
            "",
            "**Who pays the lawyer** You, directly, on their own quote. We take no "
            "percentage of their fees.",
            "**Cost** Included in the initial fee.",
        ],
        "percentuale-recuperato": [
            "**How it is calculated** 12 % on the sums actually recovered by you, "
            "net of the bank charges and taxes paid to obtain the recovery.",
            "",
            "**When it applies** Only on money actually credited, within 24 months "
            "of signing the contract.",
            "**When it does not** On amounts merely «recognised» in your favour, "
            "and on the initial fee.",
            "**If nothing comes back** You owe us nothing.",
            "",
            "Example: on a 20,000 EUR case where 6,000 EUR comes back, the "
            "percentage is 720 EUR, on top of the 190 EUR fee.",
        ],
        "guida-prime-48-ore": [
            "**The order matters more than the speed**",
            "1. Stop the payments, but do not close the account: the statement is "
            "the main evidence.",
            "2. If you gave access to a wallet, treat it as compromised: create a "
            "new one and move the remaining tokens.",
            "3. Keep everything now: screenshots, emails, chats, receipts, "
            "transaction hashes.",
            "4. File the complaint: any Carabinieri station or police station, or "
            "online with the State Police.",
            "5. Ask your bank and the exchange to preserve the data: retention "
            "periods are limited, every day counts.",
            "6. Report it to the supervisory authorities: CONSOB, AGCM, OCLAFP.",
            "",
            "**Cost** None. The full guide is on the site, on the Support page.",
        ],
    },
    "de": {
        "valutazione-iniziale": [
            "**Was enthalten ist**",
            "- Ein Gespräch von etwa 30 Minuten, telefonisch oder per Video",
            "- Prüfung der Unterlagen, die Sie haben (Überweisungen, Belege, Screenshots, Chats)",
            "- Eine klare Antwort: Der Fall liegt im Rahmen oder nicht, und warum",
            "",
            "**Dauer** 1-2 Tage ab der ersten Meldung.",
            "**Kosten** Keine.",
            "",
            "Vor diesem Gespräch sind weder eine Zahlung noch ein Passwort nötig.",
        ],
        "ricostruzione-flusso": [
            "**Was wir erstellen**",
            "- Ein Diagramm der Geldströme",
            "- Die Liste der Adressen und beteiligten Institute",
            "- Eine Chronologie der Transaktionen",
            "",
            "**Dauer** 3-5 Arbeitstage.",
            "**Kosten** Im Startbeitrag enthalten: keine separate Position.",
            "",
            "Zeigt sich in dieser Phase nichts, worauf sich aufbauen lässt, hören "
            "wir kostenlos auf und der Beitrag wird nicht verlangt.",
        ],
        "perizia-tecnica": [
            "**Inhalt**",
            "- Chronologie der Transaktionen",
            "- Adressen und Transaktions-Hashes",
            "- Beteiligte Institute und Börsen",
            "- Die festgestellten Anknüpfungspunkte",
            "- Grenzen der Analyse: was nicht geprüft werden konnte",
            "",
            "**Preis** 190 EUR inkl. USt., einmalig.",
            "**Dauer** 10 Arbeitstage ab vollständiger Übergabe der Unterlagen.",
            "",
            "Der Beitrag wird nach der kostenlosen Einschätzung gezahlt und nur, "
            "wenn wir gemeinsam weiter vorgehen. Er ist kein Vorschuss auf eine "
            "Rückholung und nach Beginn der Analyse nicht erstattbar. Wir "
            "garantieren keine Rückgewinnung: Das kann kein Anbieter.",
        ],
        "denunce-segnalazioni": [
            "**Was wir tun**",
            "- Wir entwerfen die Schriftstücke, Sie unterzeichnen und reichen sie ein",
            "- Ersuchen um Datenaufbewahrung an Banken und Börsen",
            "- Ersuchen um Sperrung der Beträge",
            "",
            "**Wer unterzeichnet** Sie, für die Schriftstücke, die Sie betreffen. "
            "Eine Anwältin, für die, die es erfordern.",
            "**Dauer** 2-4 Wochen für die Vorbereitung.",
            "**Kosten** Im Startbeitrag enthalten. Anwaltshonorare bleiben separat.",
        ],
        "coordinamento-legale": [
            "**Was enthalten ist**",
            "- Übergabe des Gutachtens an die Anwältin, mit zitierbaren technischen Daten",
            "- Technische Rückfragen im Verfahren",
            "- Ergänzungen und Anhänge, die die Anwältin anfordert",
            "",
            "**Wer die Anwältin bezahlt** Sie, direkt, nach deren "
            "Kostenvoranschlag. Wir nehmen keine Beteiligung an ihren Honoraren.",
            "**Kosten** Im Startbeitrag enthalten.",
        ],
        "percentuale-recuperato": [
            "**Wie sie berechnet wird** 12 % auf die tatsächlich an Sie "
            "zurückgeflossenen Beträge, nach Abzug der Bankgebühren und Steuern, "
            "die für den Rückfluss gezahlt wurden.",
            "",
            "**Wann sie gilt** Nur auf tatsächlich gutgeschriebenes Geld, "
            "innerhalb von 24 Monaten ab Unterzeichnung.",
            "**Wann nicht** Auf Beträge, die Ihnen nur «zuerkannt» werden, und auf "
            "den Startbeitrag.",
            "**Fließt nichts zurück** Dann schulden Sie uns nichts.",
            "",
            "Beispiel: Bei einem Fall von 20.000 EUR, bei dem 6.000 EUR "
            "zurückfließen, beträgt die Beteiligung 720 EUR, zusätzlich zum "
            "Beitrag von 190 EUR.",
        ],
        "guida-prime-48-ore": [
            "**Die Reihenfolge zählt mehr als die Schnelligkeit**",
            "1. Zahlungen stoppen, aber das Konto nicht schließen: Der Kontoauszug "
            "ist der Hauptbeweis.",
            "2. Wenn Sie Zugriff auf ein Wallet gegeben haben, gilt es als "
            "kompromittiert: Legen Sie ein neues an und verschieben Sie die "
            "verbliebenen Token.",
            "3. Alles sofort aufbewahren: Screenshots, E-Mails, Chats, Belege, "
            "Transaktions-Hashes.",
            "4. Anzeige erstatten: jede Carabinieri-Station oder jedes Polizeirevier, "
            "auch online bei der Staatspolizei.",
            "5. Bank und Börse um Datenaufbewahrung bitten: Die Fristen sind "
            "begrenzt, jeder Tag zählt.",
            "6. Bei den Aufsichtsbehörden melden: CONSOB, AGCM, OCLAFP.",
            "",
            "**Kosten** Keine. Der vollständige Leitfaden steht auf der Website, "
            "Seite Support.",
        ],
    },
    "es": {
        "valutazione-iniziale": [
            "**Qué incluye**",
            "- Una conversación de unos 30 minutos, por teléfono o vídeo",
            "- Revisión de los documentos que tengas (transferencias, recibos, capturas, chats)",
            "- Una respuesta clara: el caso entra en el ámbito o no, y por qué",
            "",
            "**Plazo** 1-2 días desde la primera comunicación.",
            "**Coste** Ninguno.",
            "",
            "Antes de esta llamada no hace falta ningún pago ni ninguna contraseña.",
        ],
        "ricostruzione-flusso": [
            "**Qué producimos**",
            "- Diagrama de los flujos",
            "- Lista de direcciones y entidades implicadas",
            "- Cronología de las operaciones",
            "",
            "**Plazo** 3-5 días laborables.",
            "**Coste** Incluida en el aporte inicial: no es una partida aparte.",
            "",
            "Si en esta fase no aparece nada sobre lo que actuar, paramos sin "
            "coste y no se pide el aporte.",
        ],
        "perizia-tecnica": [
            "**Contenido**",
            "- Cronología de las operaciones",
            "- Direcciones y hashes de las transacciones",
            "- Entidades y exchanges implicados",
            "- Los puntos de anclaje identificados",
            "- Límites del análisis: qué no se ha podido verificar",
            "",
            "**Precio** 190 EUR IVA incluido, una sola vez.",
            "**Plazo** 10 días laborables desde la entrega completa de los documentos.",
            "",
            "El aporte se paga después de la valoración gratuita y solo si "
            "decidimos juntos seguir adelante. No es un anticipo de la "
            "recuperación y no es reembolsable una vez iniciado el análisis. No "
            "garantizamos ninguna recuperación: no puede hacerlo ningún operador.",
        ],
        "denunce-segnalazioni": [
            "**Qué hacemos**",
            "- Preparamos los escritos, tú los firmas y los presentas",
            "- Solicitudes de conservación de datos a bancos y exchanges",
            "- Solicitudes de bloqueo de las sumas",
            "",
            "**Quién firma** Tú, los escritos que te afectan. Un abogado, los que "
            "lo requieren.",
            "**Plazo** 2-4 semanas para la preparación.",
            "**Coste** Incluido en el aporte inicial. Los honorarios del abogado "
            "quedan aparte.",
        ],
        "coordinamento-legale": [
            "**Qué incluye**",
            "- Entrega del peritaje al abogado, con datos técnicos citables",
            "- Aclaraciones técnicas durante el procedimiento",
            "- Ampliaciones y anexos que pida el abogado",
            "",
            "**Quién paga al abogado** Tú, directamente, según su presupuesto. No "
            "tomamos porcentaje de sus honorarios.",
            "**Coste** Incluido en el aporte inicial.",
        ],
        "percentuale-recuperato": [
            "**Cómo se calcula** 12 % sobre las sumas efectivamente recuperadas, "
            "neto de los gastos bancarios y los impuestos pagados para la "
            "recuperación.",
            "",
            "**Cuándo se aplica** Solo sobre dinero realmente abonado, dentro de "
            "los 24 meses siguientes a la firma del contrato.",
            "**Cuándo no** Sobre importes que solo se te «reconocen», y sobre el "
            "aporte inicial.",
            "**Si no vuelve nada** No nos debes nada.",
            "",
            "Ejemplo: en un caso de 20.000 EUR del que vuelven 6.000 EUR, el "
            "porcentaje es 720 EUR, además del aporte de 190 EUR.",
        ],
        "guida-prime-48-ore": [
            "**El orden importa más que la rapidez**",
            "1. Detén los pagos, pero no cierres la cuenta: el extracto es la "
            "prueba principal.",
            "2. Si diste acceso a una wallet, considérala comprometida: crea una "
            "nueva y mueve los tokens que queden.",
            "3. Consérvalo todo ya: capturas, correos, chats, recibos, hashes de "
            "las transacciones.",
            "4. Presenta denuncia: cualquier cuartel de los Carabinieri o "
            "comisaría, o en línea ante la Policía del Estado.",
            "5. Pide a banco y exchange la conservación de los datos: los plazos "
            "son limitados, cada día cuenta.",
            "6. Comunícalo a las autoridades de supervisión: CONSOB, AGCM, OCLAFP.",
            "",
            "**Coste** Ninguno. La guía completa está en el sitio, en la página "
            "Soporte.",
        ],
    },
}

# Il titolo del ritaglio: poche parole, leggibili a 500 px sul telefono.
# Come si paga ogni voce, in tre parole. Non è il prezzo del catalogo (quello
# sta in `price` ed è 0 dove la cifra dipende dal caso): è la frase che dice
# subito se una cosa è gratuita, compresa in un'altra, o a percentuale.
# Prima qui c'era solo «Gratuita» per tutto ciò che costava zero, e la scheda
# della percentuale finiva per dire «Prezzo nel catalogo: Gratuita» — falso, e
# nel modo più costoso: il cliente lo scopre alla firma.
COSTO = {
    "valutazione-iniziale": {
        "it": "Gratuita", "en": "Free", "de": "Kostenlos", "es": "Gratis"},
    "ricostruzione-flusso": {
        "it": "Compresa nel contributo", "en": "Included in the fee",
        "de": "Im Beitrag enthalten", "es": "Incluida en el aporte"},
    "perizia-tecnica": {
        "it": "190 € IVA inclusa", "en": "190 € incl. VAT",
        "de": "190 € inkl. USt.", "es": "190 € IVA incluido"},
    "denunce-segnalazioni": {
        "it": "Compreso nel contributo", "en": "Included in the fee",
        "de": "Im Beitrag enthalten", "es": "Incluido en el aporte"},
    "coordinamento-legale": {
        "it": "Compreso nel contributo", "en": "Included in the fee",
        "de": "Im Beitrag enthalten", "es": "Incluido en el aporte"},
    "percentuale-recuperato": {
        "it": "12 % sul recuperato", "en": "12 % of what is recovered",
        "de": "12 % des Zurückgeflossenen", "es": "12 % de lo recuperado"},
    "guida-prime-48-ore": {
        "it": "Gratuita", "en": "Free", "de": "Kostenlos", "es": "Gratis"},
}

# La stessa cosa, corta, per l'angolo dell'immagine: la banda è larga 1080 px e
# il testo sta a 44 px in grassetto.
COSTO_BREVE = {
    "valutazione-iniziale": {"it": "Gratuita", "en": "Free", "de": "Kostenlos", "es": "Gratis"},
    "ricostruzione-flusso": {"it": "Compresa", "en": "Included", "de": "Enthalten", "es": "Incluida"},
    "perizia-tecnica": {"it": "190 €", "en": "190 €", "de": "190 €", "es": "190 €"},
    "denunce-segnalazioni": {"it": "Compreso", "en": "Included", "de": "Enthalten", "es": "Incluido"},
    "coordinamento-legale": {"it": "Compreso", "en": "Included", "de": "Enthalten", "es": "Incluido"},
    "percentuale-recuperato": {"it": "12 %", "en": "12 %", "de": "12 %", "es": "12 %"},
    "guida-prime-48-ore": {"it": "Gratuita", "en": "Free", "de": "Kostenlos", "es": "Gratis"},
}

SOTTOTITOLI = {
    "it": {
        "valutazione-iniziale": "Gratuita, senza impegno",
        "ricostruzione-flusso": "Dove sono andati i soldi",
        "perizia-tecnica": "Il documento che serve al legale",
        "denunce-segnalazioni": "Gli atti che puoi presentare",
        "coordinamento-legale": "Restiamo a disposizione",
        "percentuale-recuperato": "Solo su ciò che rientra davvero",
        "guida-prime-48-ore": "La guida gratuita del sito",
    },
    "en": {
        "valutazione-iniziale": "Free, no obligation",
        "ricostruzione-flusso": "Where the money went",
        "perizia-tecnica": "The document your lawyer needs",
        "denunce-segnalazioni": "The documents you can file",
        "coordinamento-legale": "We stay available",
        "percentuale-recuperato": "Only on what actually comes back",
        "guida-prime-48-ore": "The free guide on our site",
    },
    "de": {
        "valutazione-iniziale": "Kostenlos, unverbindlich",
        "ricostruzione-flusso": "Wohin das Geld geflossen ist",
        "perizia-tecnica": "Das Dokument für die Anwältin",
        "denunce-segnalazioni": "Die Schriftstücke für Sie",
        "coordinamento-legale": "Wir bleiben erreichbar",
        "percentuale-recuperato": "Nur auf das Zurückgeflossene",
        "guida-prime-48-ore": "Der kostenlose Leitfaden",
    },
    "es": {
        "valutazione-iniziale": "Gratis y sin compromiso",
        "ricostruzione-flusso": "Adónde fue el dinero",
        "perizia-tecnica": "El documento para el abogado",
        "denunce-segnalazioni": "Los escritos que puedes presentar",
        "coordinamento-legale": "Seguimos disponibles",
        "percentuale-recuperato": "Solo sobre lo que vuelve",
        "guida-prime-48-ore": "La guía gratuita del sitio",
    },
}

SOVRATITOLI = {
    "it": {
        "valutazione-iniziale": ("01", "Valutazione iniziale"),
        "ricostruzione-flusso": ("02", "Ricostruzione del flusso"),
        "perizia-tecnica": ("03", "Perizia tecnica"),
        "denunce-segnalazioni": ("04", "Denunce e segnalazioni"),
        "coordinamento-legale": ("05", "Coordinamento legale"),
        "percentuale-recuperato": ("06", "Percentuale sul recuperato"),
        "guida-prime-48-ore": ("00", "Prime 48 ore"),
    },
    "en": {
        "valutazione-iniziale": ("01", "Free assessment"),
        "ricostruzione-flusso": ("02", "Tracing the funds"),
        "perizia-tecnica": ("03", "Expert report"),
        "denunce-segnalazioni": ("04", "Reports filed"),
        "coordinamento-legale": ("05", "Legal coordination"),
        "percentuale-recuperato": ("06", "On what is recovered"),
        "guida-prime-48-ore": ("00", "First 48 hours"),
    },
    "de": {
        "valutazione-iniziale": ("01", "Erste Einschätzung"),
        "ricostruzione-flusso": ("02", "Geldfluss verfolgen"),
        "perizia-tecnica": ("03", "Gutachten"),
        "denunce-segnalazioni": ("04", "Anzeigen"),
        "coordinamento-legale": ("05", "Mit der Anwältin"),
        "percentuale-recuperato": ("06", "Vom Zurückgeflossenen"),
        "guida-prime-48-ore": ("00", "Erste 48 Stunden"),
    },
    "es": {
        "valutazione-iniziale": ("01", "Valoración inicial"),
        "ricostruzione-flusso": ("02", "Rastrear los fondos"),
        "perizia-tecnica": ("03", "Peritaje técnico"),
        "denunce-segnalazioni": ("04", "Denuncias"),
        "coordinamento-legale": ("05", "Con el abogado"),
        "percentuale-recuperato": ("06", "Sobre lo recuperado"),
        "guida-prime-48-ore": ("00", "Primeras 48 horas"),
    },
}

NOMI_LINGUA = {"it": "italiano", "en": "English", "de": "Deutsch", "es": "Español"}


def nome_ritaglio(lingua: str, articolo_id: str) -> str:
    return f"{lingua}-{articolo_id}.jpg"


def testo_ritaglio(lingua: str, articolo: dict) -> tuple[str, str, str]:
    """Numero di fase, titolo breve, prezzo: le tre cose che stanno sull'immagine."""
    numero, titolo = SOVRATITOLI[lingua][articolo["id"]]
    return numero, titolo, prezzo_leggibile(articolo["prezzo"], lingua)


def prezzo_leggibile(prezzo: str, lingua: str) -> str:
    """«190.00» → «190 €» o «Free», nella lingua del catalogo."""
    valore = float(prezzo)
    if valore == 0:
        return {"it": "Gratuita", "en": "Free", "de": "Kostenlos", "es": "Gratis"}[lingua]
    intero = f"{valore:.2f}".rstrip("0").rstrip(".")
    return f"{intero} €"


def ritaglio(lingua: str, articolo: dict, destinazione: pathlib.Path) -> None:
    """Foto quadrata 1080×1080: la foto in alto, la scheda sotto.

    Non si ritaglia la foto a tutta tela: il catalogo WhatsApp mostra il
    quadrato piccolo, e un'immagine senza testo è indistinguibile dalle altre
    undici quando scorri. La banda in basso dice cosa si sta comprando.
    """
    lato = 1080
    banda = 372
    foto_h = lato - banda

    originale = Image.open(IMMAGINI / articolo["immagine"]).convert("RGB")
    larghezza, altezza = originale.size
    # riempimento: si scala sul lato corto e si taglia il resto. Il centro va
    # bene per una foto; per un'immagine che ha il testo inciso da un lato
    # (`ritaglio: "sinistra"`) il centro taglierebbe proprio la parte pulita.
    scala = max(lato / larghezza, foto_h / altezza)
    ridotta = originale.resize((round(larghezza * scala), round(altezza * scala)), Image.LANCZOS)
    if articolo.get("ritaglio") == "sinistra":
        sinistra = 0
    else:
        sinistra = (ridotta.width - lato) // 2
    sopra = (ridotta.height - foto_h) // 2
    foto = ridotta.crop((sinistra, sopra, sinistra + lato, sopra + foto_h))

    tela = Image.new("RGB", (lato, lato), INK)
    tela.paste(foto, (0, 0))
    disegno = ImageDraw.Draw(tela)

    # Velo scuro in fondo alla foto: il testo deve restare leggibile su
    # qualsiasi immagine, e le nostre foto hanno cieli chiari. Sfumatura
    # verticale costruita una volta sola in RGBA, poi incollata.
    velo = Image.new("RGBA", (lato, 140), (11, 11, 15, 0))
    pennello = ImageDraw.Draw(velo)
    for i in range(140):
        pennello.line([(0, i), (lato, i)], fill=(11, 11, 15, int(185 * (i / 140) ** 1.6)))
    tela.paste(velo, (0, foto_h - 140), velo)

    disegno.rectangle([0, foto_h, lato, lato], fill=INK)
    disegno.rectangle([0, foto_h, lato, foto_h + 3], fill=ACCENTO)

    numero, titolo, _ = testo_ritaglio(lingua, articolo)
    prezzo = COSTO_BREVE[articolo["id"]][lingua]
    sottotitolo = SOTTOTITOLI[lingua][articolo["id"]]
    font_numero = ImageFont.truetype(FONT_BOLD, 30)
    font_titolo = ImageFont.truetype(FONT_BOLD, 52)
    font_sotto = ImageFont.truetype(FONT_REG, 32)
    font_prezzo = ImageFont.truetype(FONT_BOLD, 44)
    font_marca = ImageFont.truetype(FONT_BOLD, 30)

    margine = 64
    # numero di fase, in accent
    disegno.text((margine, foto_h + 40), numero, font=font_numero, fill=ACCENTO)
    # titolo, su una riga se ci sta, poi il sottotitolo che dice cosa si riceve
    y = foto_h + 82
    righe = spezza(titolo, font_titolo, lato - margine * 2, disegno)
    for riga in righe[:2]:
        disegno.text((margine, y), riga, font=font_titolo, fill=(255, 255, 255))
        y += 60
    for riga in spezza(sottotitolo, font_sotto, lato - margine * 2, disegno)[:1]:
        disegno.text((margine, y + 6), riga, font=font_sotto, fill=(170, 170, 178))
    # prezzo e marchio sull'ultima riga della banda
    disegno.text((margine, lato - 92), prezzo, font=font_prezzo, fill=ACCENTO)
    marca = "Traccia"
    larghezza_marca = disegno.textlength(marca, font=font_marca)
    disegno.text((lato - margine - larghezza_marca, lato - 84), marca,
                 font=font_marca, fill=MUTO)

    destinazione.parent.mkdir(parents=True, exist_ok=True)
    tela.save(destinazione, "JPEG", quality=88, optimize=True, progressive=True)


def spezza(testo: str, font, larghezza: int, disegno) -> list[str]:
    parole = testo.split()
    righe, corrente = [], ""
    for parola in parole:
        prova = (corrente + " " + parola).strip()
        if disegno.textlength(prova, font=font) <= larghezza:
            corrente = prova
        else:
            if corrente:
                righe.append(corrente)
            corrente = parola
    if corrente:
        righe.append(corrente)
    return righe


def riga_csv(lingua: str, articolo: dict) -> dict[str, str]:
    if lingua == "it":
        titolo, descrizione = articolo["titolo"], articolo["descrizione"]
    else:
        titolo, descrizione = TRADUZIONI[lingua][articolo["id"]]
    # Il link porta alla pagina **nella lingua del catalogo**: chi legge il
    # catalogo tedesco e preme «Perizia» deve arrivare a `/de/come-funziona`,
    # non alla pagina italiana. Era l'unico posto del sito in cui la lingua
    # scelta si perdeva di nuovo.
    pagina = articolo["pagina"] if lingua == "it" else f"{lingua}/{articolo['pagina']}"
    return {
        "id": articolo["id"],
        "title": titolo,
        "description": descrizione,
        "availability": DISPONIBILE,
        "condition": NUOVO,
        "price": f"{articolo['prezzo']} {VALUTA}",
        "link": f"{SITO}/{pagina}",
        "image_link": f"{SITO}/catalogo-whatsapp/ritagli/{nome_ritaglio(lingua, articolo['id'])}",
        "brand": BRAND,
    }


COLONNE = ["id", "title", "description", "availability", "condition",
           "price", "link", "image_link", "brand"]


def scheda_markdown(lingua: str, articolo: dict) -> str:
    if lingua == "it":
        titolo, descrizione = articolo["titolo"], articolo["descrizione"]
        righe = articolo["scheda"]
    else:
        titolo, descrizione = TRADUZIONI[lingua][articolo["id"]]
        righe = SCHEDE[lingua][articolo["id"]]
    costo = COSTO[articolo["id"]][lingua]
    link = f"{SITO}/{lingua}/{articolo['pagina']}" if lingua != "it" else f"{SITO}/{articolo['pagina']}"
    blocco = "\n".join(righe)
    return (
        f"### {titolo}\n\n"
        f"**Come si paga:** {costo}\n\n"
        f"{descrizione}\n\n"
        f"{blocco}\n\n"
        f"Pagina: {link}\n\n"
        f"Immagine: `catalogo-whatsapp/ritagli/{nome_ritaglio(lingua, articolo['id'])}`\n"
    )


ISTRUZIONI = """# Catalogo WhatsApp Business

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
"""


def genera() -> list[pathlib.Path]:
    scritti: list[pathlib.Path] = []
    USCITA.mkdir(parents=True, exist_ok=True)

    for lingua in LINGUE:
        for articolo in ARTICOLI:
            percorso = RITAGLI / nome_ritaglio(lingua, articolo["id"])
            ritaglio(lingua, articolo, percorso)
            scritti.append(percorso)

        csv_path = USCITA / f"{lingua}.csv"
        # riga di fine riga `\n` e niente BOM: è quello che Meta si aspetta.
        # Il default di `csv` su Windows sarebbe `\r\n`, e un file con i ritorni
        # a capo sbagliati si importa a metà senza dire perché.
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            scrittore = csv.DictWriter(f, fieldnames=COLONNE, lineterminator="\n")
            scrittore.writeheader()
            for articolo in ARTICOLI:
                scrittore.writerow(riga_csv(lingua, articolo))
        scritti.append(csv_path)

        md_path = USCITA / f"schede-{lingua}.md"
        testi = [f"# Catalogo WhatsApp — {NOMI_LINGUA[lingua]}\n",
                 "Da caricare a mano dall'app WhatsApp Business se l'importazione\n"
                 "del CSV non passa. Stessi testi del file "
                 f"`{lingua}.csv`: se ne cambi uno, cambia anche l'altro, "
                 "altrimenti il catalogo e le schede dicono cose diverse.\n"]
        # il separatore va **fra gli articoli**, non fra il titolo del file e
        # il primo articolo: lì produceva una riga orizzontale subito sotto il
        # titolo, e la nota introduttiva finiva staccata dal suo documento
        articoli_md = [scheda_markdown(lingua, a) for a in ARTICOLI]
        md_path.write_text("\n".join(testi) + "\n---\n\n".join(articoli_md),
                           encoding="utf-8")
        scritti.append(md_path)

    return scritti


def main() -> int:
    controlla = "--check" in sys.argv
    if controlla:
        # Il controllo è grossolano di proposito: rifà il lavoro in memoria e
        # confronta il CSV. Le immagini si confrontano per data, non per pixel:
        # rigenerare un JPEG può cambiare qualche byte senza cambiare nulla.
        vecchi = []
        for lingua in LINGUE:
            percorso = USCITA / f"{lingua}.csv"
            if not percorso.exists():
                vecchi.append(str(percorso.relative_to(ROOT)))
                continue
            with percorso.open(encoding="utf-8", newline="") as f:
                attuale = list(csv.DictReader(f))
            atteso = [riga_csv(lingua, a) for a in ARTICOLI]
            if attuale != atteso:
                vecchi.append(str(percorso.relative_to(ROOT)))
        for lingua in LINGUE:
            for articolo in ARTICOLI:
                if not (RITAGLI / nome_ritaglio(lingua, articolo["id"])).exists():
                    vecchi.append(nome_ritaglio(lingua, articolo["id"]))
        if vecchi:
            print("catalogo WhatsApp disallineato: " + ", ".join(vecchi[:6]))
            return 1
        print("catalogo WhatsApp allineato.")
        return 0

    (USCITA / "README.md").write_text(ISTRUZIONI, encoding="utf-8")
    scritti = genera()
    print(f"Generati {len(scritti)} file in catalogo-whatsapp/")
    for lingua in LINGUE:
        print(f"  {lingua}.csv — {len(ARTICOLI)} articoli")
    return 0


if __name__ == "__main__":
    sys.exit(main())
