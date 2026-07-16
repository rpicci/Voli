# Flight Watch

PWA + funzioni serverless per cercare voli automaticamente ogni giorno e ricevere un'email con i risultati.

## ⚠️ Limite importante da capire prima di iniziare

Questo progetto **non può essere deployato con Netlify Drop** (trascinamento cartella) come i tuoi PWA precedenti, perché contiene funzioni serverless con variabili d'ambiente segrete (le API key). Serve un deploy da **Git** (GitHub) collegato a Netlify, oppure dalla **Netlify CLI**. Il resto del flusso di lavoro (interfaccia, stile) resta identico a quello a cui sei abituato.

Non ho potuto testare le chiamate API reali in questo ambiente (nessun accesso a internet in sandbox): il codice segue la documentazione ufficiale delle API, ma alla prima esecuzione vera ti consiglio di controllare i log della funzione (Netlify → Functions → scheduled-search → Logs) per eventuali aggiustamenti.

## Struttura

```
flight-watch/
├── netlify.toml
├── package.json
├── public/              → il PWA (index.html, manifest, service worker)
├── netlify/functions/   → funzioni serverless
│   ├── save-config.mjs      (salva i parametri dal form)
│   ├── get-config.mjs       (legge config + ultimo esito)
│   ├── toggle-active.mjs    (flag di stop/riattivazione)
│   └── scheduled-search.mjs (gira ogni ora, cerca voli se è uno slot giusto)
└── lib/
    ├── scheduling.mjs   (calcolo slot orari giornalieri)
    ├── travelpayouts.mjs
    ├── duffel.mjs       (opzionale)
    └── email.mjs
```

## Come funziona la schedulazione

Netlify permette di schedulare una funzione con un **cron fisso**, deciso al momento del deploy — non può cambiare dinamicamente ogni volta che modifichi "numero tentativi" dal form, altrimenti servirebbe un redeploy ogni volta.

Per questo `scheduled-search` gira **ogni ora, in punto** (`0 * * * *`), ma appena parte controlla da sola: "in base al numero di tentativi salvato, questa è una delle ore in cui devo cercare?" Se sì, e non l'ha già fatto in quell'ora oggi, esegue la ricerca. Altrimenti esce subito senza consumare chiamate API.

Esempio con 4 tentativi: 00:00, 06:00, 12:00, 18:00 (ora Italia, gestisce automaticamente ora legale/solare).

## Deploy — passo passo

1. **Crea un repository GitHub** con questi file (oppure scaricali e fai `git init` in locale, poi push)
2. Su **app.netlify.com** → "Add new site" → "Import an existing project" → collega il repository
3. Build settings: build command vuoto, publish directory `public` (già configurato in `netlify.toml`, Netlify dovrebbe rilevarlo da solo)
4. Dopo il primo deploy, vai su **Site settings → Environment variables** e aggiungi:

| Variabile | Valore | Obbligatoria |
|---|---|---|
| `TRAVELPAYOUTS_TOKEN` | il token ottenuto da travelpayouts.com | Sì (a meno che tu usi solo Duffel) |
| `RESEND_API_KEY` | la API key da resend.com | Sì |
| `EMAIL_FROM` | es. `Flight Watch <alert@tuodominio.it>` (deve essere un dominio verificato su Resend, oppure il dominio di test che ti forniscono) | Sì |
| `DUFFEL_API_KEY` | la live key da duffel.com | No, opzionale (dati più precisi su scali/orari) |

5. Fai un redeploy (Deploys → Trigger deploy) perché le funzioni leggano le nuove variabili
6. Apri il sito da telefono → "Aggiungi a schermata Home" per installarlo come PWA
7. Compila il form e salva: **da quel momento la ricerca è attiva**. Verifica lo stato nel tabellone in cima alla pagina

## Il flag di stop

Il pulsante rosso in fondo alla pagina imposta `active: false` nella configurazione salvata. La funzione schedulata controlla questo flag **prima di ogni cosa** e se è `false` esce immediatamente: nessuna chiamata API, nessuna email, finché non lo riattivi dallo stesso pulsante.

## Note su precisione dei dati

- **Solo Travelpayouts** (senza Duffel): prezzi aggregati/cache, buoni per un alert "c'è un'offerta interessante su questa rotta", ma il filtro su scali è "best effort" e quello su fascia oraria viene ignorato (l'API non fornisce quel dato). Verifica sempre il prezzo sul sito di prenotazione prima di comprare.
- **Con Duffel** aggiunto: dati reali con orari e scali precisi, ma la ricerca funziona solo per una data singola per slice (non un range), quindi il codice attuale usa `departDateFrom` come data di ricerca; se vuoi scandagliare tutto il range di date andrà esteso con un ciclo sulle date (dimmi se vuoi che lo implementi).

## Prossimi miglioramenti possibili (dimmi se li vuoi)

- Ciclare su più date nel range invece che una sola con Duffel
- Filtro giorni della settimana (es. solo weekend) oltre al range di date
- Cronologia dei prezzi trovati nel tempo (grafico andamento)
- Soglia di prezzo minima sotto cui inviare l'email, per non essere sommerso da notifiche
