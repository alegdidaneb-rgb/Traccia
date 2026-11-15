# -*- coding: utf-8 -*-
"""
Il testo dei video: quattro lingue, dodici scene ciascuna.

Le parole del modulo sono copiate da `login.html` / `en|de|es/login.html`:
il video e la pagina devono dire la stessa cosa, altrimenti chi guarda il video
e poi apre il sito non ritrova i campi che gli abbiamo nominato.

Ogni scena ha:
  titolo     la riga grande
  corpo      una o due righe, brevi
  scheda     cosa mostra il riquadro a destra (o in basso nel verticale)
  voce       il pezzo di narrazione che copre questa scena.
             La durata della scena è proporzionale ai caratteri di `voce`,
             quindi questi pezzi devono essere, insieme, esattamente il testo
             registrato in `audio/voce-xx.mp3` (il test lo verifica).
"""

import re

LINGUE = ["it", "en", "de", "es"]

SITO = "traccia.it.com"

CAMPI = {
    "it": ["Nome", "Cognome", "Email", "Telefono", "Importo perso", "Che cosa ti è successo"],
    "en": ["First name", "Last name", "Email", "Phone", "Amount lost", "What happened"],
    "de": ["Vorname", "Nachname", "E-Mail", "Telefon", "Betrag", "Was passiert ist"],
    "es": ["Nombre", "Apellidos", "Correo", "Teléfono", "Importe", "Qué pasó"],
}

# Il percorso del denaro, che è il cuore della parte «recupero»: quattro
# tappe, ognuna con la prova che la sostiene. Non sono promesse, sono i
# documenti che chiediamo davvero.
PROVE = {
    "it": [("Bonifico o pagamento", "la ricevuta, la data, il beneficiario"),
           ("Dove è arrivato", "la banca o l'exchange che lo ha ricevuto"),
           ("Dove è finito", "gli indirizzi dei wallet, le transazioni"),
           ("Che cosa resta", "chat, email, schermate dell'area riservata")],
    "en": [("Transfer or payment", "the receipt, the date, the beneficiary"),
           ("Where it arrived", "the bank or exchange that received it"),
           ("Where it went", "wallet addresses, the transactions"),
           ("What is left", "chats, emails, screenshots of the account area")],
    "de": [("Überweisung oder Zahlung", "der Beleg, das Datum, der Empfänger"),
           ("Wo sie ankam", "die Bank oder Börse, die sie erhalten hat"),
           ("Wohin sie ging", "die Wallet-Adressen, die Transaktionen"),
           ("Was bleibt", "Chats, E-Mails, Screenshots des Kundenbereichs")],
    "es": [("Transferencia o pago", "el recibo, la fecha, el beneficiario"),
           ("Dónde llegó", "el banco o el exchange que lo recibió"),
           ("Dónde acabó", "las direcciones de wallet, las transacciones"),
           ("Qué queda", "chats, correos, capturas del área privada")],
}

# Le due risposte possibili, con lo stesso spazio: il «a volte no» non è una
# nota a piè di pagina, è metà della risposta. È questo che rende il video
# credibile invece di uno dei tanti che promettono tutto.
ESITI = {
    "it": [("A volte si può", ["Il denaro è ancora tracciabile, oppure c'è un intermediario identificabile."]),
           ("A volte no", ["E in quel caso te lo diciamo subito, senza farti aspettare."])],
    "en": [("Sometimes it can", ["The money is still traceable, or there is an intermediary we can identify."]),
           ("Sometimes it cannot", ["And in that case we say so at once, instead of letting you wait."])],
    "de": [("Manchmal geht es", ["Das Geld ist noch nachvollziehbar, oder es gibt einen identifizierbaren Vermittler."]),
           ("Manchmal nicht", ["Und dann sagen wir es sofort, statt Sie warten zu lassen."])],
    "es": [("A veces se puede", ["El dinero todavía se puede rastrear, o hay un intermediario identificable."]),
           ("A veces no", ["Y en ese caso te lo decimos enseguida, sin hacerte esperar."])],
}

SCELTE = {
    "it": ["Finto broker o piattaforma di trading",
           "Truffa con criptovalute",
           "Mi hanno chiesto soldi per sbloccare il prelievo",
           "Sono stato contattato da un finto recupero fondi",
           "Non lo so ancora"],
    "en": ["Fake broker or trading platform",
           "Cryptocurrency fraud",
           "They asked for money to unlock my withdrawal",
           "I was contacted by a fake fund recovery service",
           "I don't know yet"],
    "de": ["Falscher Broker oder Handelsplattform",
           "Betrug mit Kryptowährungen",
           "Es wurde Geld verlangt, um die Auszahlung freizugeben",
           "Ich wurde von einer falschen Rückholfirma kontaktiert",
           "Ich weiß es noch nicht"],
    "es": ["Falso bróker o plataforma de trading",
           "Fraude con criptomonedas",
           "Me pidieron dinero para desbloquear el retiro",
           "Me contactó un falso servicio de recuperación de fondos",
           "Todavía no lo sé"],
}

PULSANTE = {"it": "Segnala un caso", "en": "Report a case",
            "de": "Fall melden", "es": "Denunciar un caso"}
INVIA = {"it": "Invia richiesta", "en": "Send request",
         "de": "Anfrage senden", "es": "Enviar solicitud"}

TITOLI = {"it": "Come segnalare un caso", "en": "How to report a case",
          "de": "Einen Fall melden", "es": "Cómo denunciar un caso"}
SOTTOTITOLI = {"it": "Passo per passo", "en": "Step by step",
               "de": "Schritt für Schritt", "es": "Paso a paso"}

# Le scene. Le dodici `voce` si concatenano nel testo registrato: la giunzione
# deve dare `NARRAZIONE`, che si costruisce dalle scene.
SCENE = {
    "it": [
        dict(tipo="titolo", titolo=TITOLI["it"], corpo=SOTTOTITOLI["it"],
             voce="Come segnalare un caso, passo per passo."),
        dict(tipo="passo", titolo="Apri il sito",
             corpo="Vai su traccia.it.com e scegli «Segnala un caso».\nNon serve creare un account.",
             scheda=dict(tipo="pulsante"),
             voce="Apri traccia punto i t punto com, e scegli «Segnala un caso». Non serve creare un account."),
        dict(tipo="passo", titolo="Sei informazioni",
             corpo="Tutto quello che il modulo ti chiede.\nNiente di più, e nessuna password.",
             scheda=dict(tipo="elenco"),
             voce="Il modulo chiede sei informazioni."),
        dict(tipo="passo", titolo="Nome e cognome",
             corpo="Separati, come sul documento: servono per il contratto di incarico.",
             scheda=dict(tipo="campi", attivo=[0, 1]),
             voce="Le prime due sono il tuo nome e il tuo cognome: servono per il contratto di incarico, e per questo sono separati."),
        dict(tipo="passo", titolo="Email",
             corpo="È l'indirizzo su cui riceverai le risposte.\nRicontrollala prima di inviare.",
             scheda=dict(tipo="campi", attivo=[2]),
             voce="Poi l'email: è l'indirizzo su cui riceverai le risposte. Controlla di averla scritta bene."),
        dict(tipo="passo", titolo="Telefono",
             corpo="Con il prefisso internazionale: ti chiamiamo noi, anche dall'estero.",
             scheda=dict(tipo="campi", attivo=[3]),
             voce="Il telefono, con il prefisso internazionale: chi ha appena perso dei soldi non aspetta un'email, e così possiamo chiamarti anche dall'estero."),
        dict(tipo="passo", titolo="Importo perso",
             corpo="In euro, anche approssimativo:\ndice subito di che ordine di grandezza si parla.",
             scheda=dict(tipo="campi", attivo=[4]),
             voce="L'importo approssimativo perso, in euro. Anche approssimativo: serve a capire di che ordine di grandezza si parla."),
        dict(tipo="metodo", titolo="Come lavoriamo sul recupero",
             corpo="Ricostruiamo il percorso del denaro con prove tecniche:\nbonifici, wallet, transazioni, chat.",
             scheda=dict(tipo="prove"),
             voce="Sul recupero: ricostruiamo il percorso del denaro con prove tecniche. Da lì diciamo dove è finito e se esiste una strada."),
        dict(tipo="metodo", titolo="Quando si può, e quando no",
             corpo="A volte sì: il denaro è ancora tracciabile, o c'è un intermediario identificabile.\nA volte no, e te lo diciamo subito.",
             scheda=dict(tipo="esito"),
             voce="A volte si può: il denaro è ancora tracciabile. A volte no, e te lo diciamo subito. Nessuno può prometterti il risultato: possiamo prometterti il metodo."),
        dict(tipo="passo", titolo="Che cosa ti è successo",
             corpo="Scegli quello che ti somiglia di più.\nSe non lo sai, c'è «Non lo so ancora».",
             scheda=dict(tipo="scelte"),
             voce="Poi scegli che cosa ti è successo: finto broker, truffa con criptovalute, soldi chiesti per sbloccare il prelievo, un finto recupero fondi, oppure «non lo so ancora»."),
        dict(tipo="passo", titolo="Nessuna password",
             corpo="Mandi una richiesta, non apri un conto.\nUn analista ti ricontatta entro 48 ore lavorative.",
             scheda=dict(tipo="invia"),
             voce="Nessuna password. Mandi una richiesta, non apri un conto: non c'è niente da ricordare. Un analista legge quello che hai scritto e ti ricontatta entro quarantotto ore lavorative, al numero che ci hai indicato."),
        dict(tipo="avviso", titolo="Attenzione",
             corpo="Se ti chiedono altri soldi per recuperare i tuoi, fermati:\nè la seconda truffa.\n\nTraccia non chiede mai un anticipo.",
             scheda=dict(tipo="vuota"),
             voce="E se ti chiedono altri soldi per recuperare i tuoi, fermati: è la seconda truffa. Traccia non chiede mai un anticipo."),
    ],

    "en": [
        dict(tipo="titolo", titolo=TITOLI["en"], corpo=SOTTOTITOLI["en"],
             voce="How to report a case, step by step."),
        dict(tipo="passo", titolo="Open the site",
             corpo="Go to traccia.it.com and choose «Report a case».\nYou don't need an account.",
             scheda=dict(tipo="pulsante"),
             voce="Open traccia dot it dot com, and choose «Report a case». You don't need to create an account."),
        dict(tipo="passo", titolo="Six things",
             corpo="Everything the form asks for.\nNothing more, and no password.",
             scheda=dict(tipo="elenco"),
             voce="The form asks for six things, and nothing more."),
        dict(tipo="passo", titolo="First and last name",
             corpo="Separately, as on your ID:\nthe engagement contract needs them apart.",
             scheda=dict(tipo="campi", attivo=[0, 1]),
             voce="The first two are your first name and your last name: the engagement contract needs them separately."),
        dict(tipo="passo", titolo="Email",
             corpo="This is where the reply goes.\nCheck it before you send.",
             scheda=dict(tipo="campi", attivo=[2]),
             voce="Then your email: it's the address we'll reply to. Check you've written it correctly."),
        dict(tipo="passo", titolo="Phone",
             corpo="With the country code: we call you,\nfrom abroad too.",
             scheda=dict(tipo="campi", attivo=[3]),
             voce="Your phone, with the country code: someone who has just lost money shouldn't wait for an email, and this way we can call you from abroad too."),
        dict(tipo="passo", titolo="Amount lost",
             corpo="In euro, even roughly:\nit tells us the size of the case.",
             scheda=dict(tipo="campi", attivo=[4]),
             voce="The approximate amount lost, in euro. Rough is fine: it tells us what kind of case this is."),
        dict(tipo="metodo", titolo="How we work on recovery",
             corpo="We trace where the money went, with technical proof:\nbank transfers, wallets, transactions, chats.",
             scheda=dict(tipo="prove"),
             voce="On recovery: we trace where the money went, with technical proof. From there we say where it ended up and whether a route exists."),
        dict(tipo="metodo", titolo="When it can be done, and when it cannot",
             corpo="Sometimes yes: the money is still traceable, or there is an intermediary we can identify.\nSometimes no, and we say so at once.",
             scheda=dict(tipo="esito"),
             voce="Sometimes it can be done: the money is still traceable. Sometimes it cannot, and we say so at once. Nobody can promise the result: we can promise the method."),
        dict(tipo="passo", titolo="What happened",
             corpo="Choose what fits closest.\nIf you don't know, there's «I don't know yet».",
             scheda=dict(tipo="scelte"),
             voce="Then choose what happened to you: a fake broker, cryptocurrency fraud, money asked to unlock a withdrawal, a fake fund recovery service, or «I don't know yet»."),
        dict(tipo="passo", titolo="No password",
             corpo="You send a request, not open an account.\nAn analyst calls you back within 48 working hours.",
             scheda=dict(tipo="invia"),
             voce="No password. You are sending a request, not opening an account: nothing to remember. An analyst reads what you wrote and calls you back within forty-eight working hours, on the number you gave us."),
        dict(tipo="avviso", titolo="Careful",
             corpo="If someone asks for more money to recover yours, stop:\nthat's the second scam.\n\nTraccia never asks for an advance.",
             scheda=dict(tipo="vuota"),
             voce="And if someone asks for more money to recover yours, stop: that's the second scam. Traccia never asks for an advance."),
    ],

    "de": [
        dict(tipo="titolo", titolo=TITOLI["de"], corpo=SOTTOTITOLI["de"],
             voce="Einen Fall melden, Schritt für Schritt."),
        dict(tipo="passo", titolo="Website öffnen",
             corpo="Gehen Sie auf traccia.it.com und wählen Sie «Fall melden».\nEin Konto brauchen Sie nicht.",
             scheda=dict(tipo="pulsante"),
             voce="Öffnen Sie traccia punkt it punkt com und wählen Sie «Fall melden». Ein Konto brauchen Sie dafür nicht."),
        dict(tipo="passo", titolo="Sechs Angaben",
             corpo="Alles, was das Formular fragt.\nNichts darüber hinaus, und kein Passwort.",
             scheda=dict(tipo="elenco"),
             voce="Das Formular fragt nach sechs Angaben."),
        dict(tipo="passo", titolo="Vor- und Nachname",
             corpo="Getrennt, wie im Ausweis:\nder Mandatsvertrag braucht beide.",
             scheda=dict(tipo="campi", attivo=[0, 1]),
             voce="Die ersten beiden sind Vor- und Nachname: der Mandatsvertrag braucht sie getrennt."),
        dict(tipo="passo", titolo="E-Mail-Adresse",
             corpo="Dorthin geht die Antwort.\nPrüfen Sie sie vor dem Senden.",
             scheda=dict(tipo="campi", attivo=[2]),
             voce="Dann Ihre E-Mail-Adresse: dorthin senden wir die Antwort. Prüfen Sie, ob sie richtig geschrieben ist."),
        dict(tipo="passo", titolo="Telefonnummer",
             corpo="Mit Ländervorwahl: wir rufen an,\nauch aus dem Ausland.",
             scheda=dict(tipo="campi", attivo=[3]),
             voce="Ihre Telefonnummer mit Ländervorwahl: wer gerade Geld verloren hat, soll nicht auf eine E-Mail warten, und so können wir Sie auch aus dem Ausland anrufen."),
        dict(tipo="passo", titolo="Verlorener Betrag",
             corpo="In Euro, auch grob geschätzt:\ner zeigt die Größenordnung.",
             scheda=dict(tipo="campi", attivo=[4]),
             voce="Der ungefähr verlorene Betrag in Euro. Auch grob geschätzt: er zeigt, um welche Größenordnung es geht."),
        dict(tipo="metodo", titolo="Wie wir an der Rückholung arbeiten",
             corpo="Wir verfolgen den Weg des Geldes mit technischen Belegen:\nÜberweisungen, Wallets, Transaktionen, Chats.",
             scheda=dict(tipo="prove"),
             voce="Zur Rückholung: wir verfolgen den Weg des Geldes mit technischen Belegen. Dann sagen wir, wo es hingegangen ist und ob ein Weg besteht."),
        dict(tipo="metodo", titolo="Wann es geht, und wann nicht",
             corpo="Manchmal ja: das Geld ist noch nachvollziehbar, oder es gibt einen identifizierbaren Vermittler.\nManchmal nicht, und das sagen wir sofort.",
             scheda=dict(tipo="esito"),
             voce="Manchmal geht es: das Geld ist noch nachvollziehbar. Manchmal nicht, und dann sagen wir es sofort. Niemand kann Ihnen das Ergebnis versprechen, nur die Methode."),
        dict(tipo="passo", titolo="Was ist passiert",
             corpo="Wählen Sie, was am ehesten zutrifft.\nWenn Sie es nicht wissen: «Ich weiß es noch nicht».",
             scheda=dict(tipo="scelte"),
             voce="Dann wählen Sie, was Ihnen passiert ist: falscher Broker, Betrug mit Kryptowährungen, Geld für die Freigabe der Auszahlung, eine falsche Rückholfirma, oder «Ich weiß es noch nicht»."),
        dict(tipo="passo", titolo="Kein Passwort",
             corpo="Sie senden eine Anfrage, eröffnen kein Konto.\nWir melden uns innerhalb von 48 Arbeitsstunden.",
             scheda=dict(tipo="invia"),
             voce="Kein Passwort. Sie senden eine Anfrage, Sie eröffnen kein Konto: nichts zu merken. Eine Analystin oder ein Analyst liest Ihre Angaben und ruft Sie innerhalb von achtundvierzig Arbeitsstunden unter der angegebenen Nummer zurück."),
        dict(tipo="avviso", titolo="Vorsicht",
             corpo="Wenn jemand Geld für Ihre Rückholung verlangt, hören Sie auf:\ndas ist der zweite Betrug.\n\nTraccia verlangt nie einen Vorschuss.",
             scheda=dict(tipo="vuota"),
             voce="Und wenn jemand Geld verlangt, um Ihr Geld zurückzuholen, hören Sie auf: das ist der zweite Betrug. Traccia verlangt nie einen Vorschuss."),
    ],

    "es": [
        dict(tipo="titolo", titolo=TITOLI["es"], corpo=SOTTOTITOLI["es"],
             voce="Cómo denunciar un caso, paso a paso."),
        dict(tipo="passo", titolo="Abre la web",
             corpo="Entra en traccia.it.com y elige «Denunciar un caso».\nNo hace falta una cuenta.",
             scheda=dict(tipo="pulsante"),
             voce="Abre traccia punto i t punto com y elige «Denunciar un caso». No hace falta crear una cuenta."),
        dict(tipo="passo", titolo="Seis datos",
             corpo="Todo lo que pide el formulario.\nNada más, y ninguna contraseña.",
             scheda=dict(tipo="elenco"),
             voce="El formulario pide seis datos, y nada más."),
        dict(tipo="passo", titolo="Nombre y apellidos",
             corpo="Separados, como en el documento:\nel contrato de encargo los necesita.",
             scheda=dict(tipo="campi", attivo=[0, 1]),
             voce="Los dos primeros son tu nombre y tus apellidos: el contrato de encargo los necesita separados."),
        dict(tipo="passo", titolo="Correo electrónico",
             corpo="Ahí recibirás las respuestas.\nRevísalo antes de enviar.",
             scheda=dict(tipo="campi", attivo=[2]),
             voce="Después tu correo electrónico: es la dirección en la que recibirás las respuestas. Comprueba que está bien escrito."),
        dict(tipo="passo", titolo="Teléfono",
             corpo="Con el prefijo internacional:\nte llamamos nosotros, también desde el extranjero.",
             scheda=dict(tipo="campi", attivo=[3]),
             voce="Tu teléfono, con el prefijo internacional: quien acaba de perder dinero no debería esperar un correo, y así podemos llamarte también desde el extranjero."),
        dict(tipo="passo", titolo="Importe perdido",
             corpo="En euros, aunque sea aproximado:\ndice de qué tamaño es el caso.",
             scheda=dict(tipo="campi", attivo=[4]),
             voce="El importe aproximado perdido, en euros. Aunque sea aproximado: sirve para saber de qué orden de magnitud hablamos."),
        dict(tipo="metodo", titolo="Cómo trabajamos la recuperación",
             corpo="Seguimos el rastro del dinero con pruebas técnicas:\ntransferencias, wallets, transacciones, chats.",
             scheda=dict(tipo="prove"),
             voce="Sobre la recuperación: seguimos el rastro del dinero con pruebas técnicas. Después decimos dónde acabó y si existe un camino."),
        dict(tipo="metodo", titolo="Cuándo se puede, y cuándo no",
             corpo="A veces sí: el dinero todavía se puede rastrear, o hay un intermediario identificable.\nA veces no, y te lo decimos enseguida.",
             scheda=dict(tipo="esito"),
             voce="A veces se puede: el dinero todavía se puede rastrear. A veces no, y te lo decimos enseguida. Nadie puede prometerte el resultado: podemos prometerte el método."),
        dict(tipo="passo", titolo="Qué te ha pasado",
             corpo="Elige lo que más se parezca.\nSi no lo sabes, está «Todavía no lo sé».",
             scheda=dict(tipo="scelte"),
             voce="Luego elige qué te ha pasado: falso bróker, fraude con criptomonedas, dinero pedido para desbloquear el retiro, un falso servicio de recuperación, o «todavía no lo sé»."),
        dict(tipo="passo", titolo="Ninguna contraseña",
             corpo="Envías una solicitud, no abres una cuenta.\nUn analista te llama en 48 horas laborables.",
             scheda=dict(tipo="invia"),
             voce="Ninguna contraseña. Envías una solicitud, no abres una cuenta: no hay nada que recordar. Un analista lee lo que has escrito y te llama en un plazo de cuarenta y ocho horas laborables, al número que nos has dado."),
        dict(tipo="avviso", titolo="Atención",
             corpo="Si te piden más dinero para recuperar el tuyo, para:\nes la segunda estafa.\n\nTraccia nunca pide un anticipo.",
             scheda=dict(tipo="vuota"),
             voce="Y si alguien te pide más dinero para recuperar el tuyo, para: es la segunda estafa. Traccia nunca pide un anticipo."),
    ],
}

# Il testo esatto registrato in `audio/voce-<lingua>.mp3`. Non è un doppione
# delle scene: è la prova che le scene coprono la narrazione intera, senza
# saltare una frase e senza inventarne una che nessuno dice.
# La narrazione è la giunzione delle `voce`, non un testo ricopiato a mano:
# dopo l'aggiunta delle due scene sul recupero, tenerne una copia a mano
# significava riscriverla a ogni modifica e sbagliarla una volta su due.
NARRAZIONE = {
    lang: " ".join(scena["voce"] for scena in SCENE[lang]) for lang in LINGUE
}

# Come si scrive il dominio quando lo si legge, non quando lo si pronuncia.
# La voce dice «traccia punto it punto com», che è la forma giusta per essere
# capita ad alta voce; scritta in un sottotitolo diventa «traccia punkt it
# punkt com», cioè una parola tedesca in mezzo a una frase tedesca. Chi legge
# deve vedere l'indirizzo da digitare.
SITO_SCRITTO = "traccia.it.com"


def per_iscritto(testo):
    """Il testo della voce nella forma in cui va letto: il dominio scritto.

    Tocca solo il nome del sito. Il resto della frase è quello registrato,
    parola per parola, perché il sottotitolo deve dire ciò che si sente.
    """
    return re.sub(r"traccia\s+(?:punto|punkt|dot)\s+i\s*t?\s*"
                  r"(?:punto|punkt|dot)\s*com", SITO_SCRITTO, testo, flags=re.I)


# I sottotitoli: una riga per scena, con il tempo calcolato dai confini veri.
SOTTOTITOLI_VTT = {
    lang: [per_iscritto(s["voce"]) for s in SCENE[lang]] for lang in LINGUE
}

# La narrazione intera nella stessa forma, per i test: quello che si legge sotto
# il video e quello che si sente devono essere la stessa cosa.
NARRAZIONE_SCRITTA = {lang: per_iscritto(t) for lang, t in NARRAZIONE.items()}
