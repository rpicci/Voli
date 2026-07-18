# Flight Watch

PWA + funzioni serverless per cercare voli automaticamente ogni giorno e ricevere un'email con i risultati. Guida pensata per essere seguita **solo da telefono Android**, senza computer.

## Perché serve GitHub e non basta Netlify Drop

Questo progetto contiene funzioni serverless con API key segrete: Netlify Drop pubblica solo file statici, quindi serve un repository Git collegato a Netlify.

## Come creare le sottocartelle su GitHub da telefono

Su GitHub (sia app che browser mobile), quando crei un nuovo file, nel campo del **nome file** puoi scrivere il percorso completo con le barre, es:

```
netlify/functions/scheduled-search.mjs
```

GitHub crea da solo le cartelle `netlify/` e `netlify/functions/` — non serve nessun altro passaggio.

## Passo 1 — Crea il repository

1. Apri **github.com** dal browser del telefono (o l'app GitHub) e fai login
2. Tocca **"+" → "New repository"**
3. Dagli un nome, es. `flight-watch`, spuntalo come privato se preferisci, crea

## Passo 2 — Crea i file uno per uno

Per ogni file: **"Add file" → "Create new file"**, incolla il percorso completo nel campo nome, incolla il contenuto nel corpo, poi **"Commit new file"** in basso.

Crea questi file, nell'ordine che preferisci:

- `netlify.toml`
- `package.json`
- `lib/scheduling.mjs`
- `lib/travelpayouts.mjs`
- `lib/duffel.mjs`
- `lib/email.mjs`
- `netlify/functions/save-config.mjs`
- `netlify/functions/get-config.mjs`
- `netlify/functions/toggle-active.mjs`
- `netlify/functions/scheduled-search.mjs`
- `public/manifest.json`
- `public/icon.svg`
- `public/sw.js`
- `public/index.html`
- `README.md` (questo file, opzionale)

Il contenuto di ciascun file te lo scrivo in chat subito dopo, pronto per copia-incolla.

## Passo 3 — Collega Netlify da telefono

1. Apri **app.netlify.com** dal browser del telefono, fai login (o registrati, è gratis)
2. **"Add new site" → "Import an existing project" → "Deploy with GitHub"**
3. Autorizza Netlify ad accedere ai tuoi repository, seleziona `flight-watch`
4. Build settings: lasciali com'è (già configurati in `netlify.toml`), tocca **"Deploy"**

## Passo 4 — Imposta le variabili d'ambiente

Sempre dal browser mobile, dentro il sito appena creato su Netlify:

**Site configuration → Environment variables → Add a variable**

| Variabile | Valore | Obbligatoria |
|---|---|---|
| `DUFFEL_API_KEY` | la live key da duffel.com — **fonte primaria**, dati reali con orari e compagnia | Consigliata |
| `TRAVELPAYOUTS_TOKEN` | il token da travelpayouts.com — usato solo come fallback se Duffel non è configurata (dati cache, meno affidabili) | No, opzionale |
| `RESEND_API_KEY` | la API key da resend.com | Sì |
| `EMAIL_FROM` | es. `Flight Watch <alert@tuodominio.it>` | Sì |

Dopo averle aggiunte: **Deploys → Trigger deploy → Deploy site**, perché le funzioni leggano le nuove variabili.

## Passo 5 — Usa l'app

1. Apri l'URL del sito (es. `flight-watch-xyz.netlify.app`) dal browser Android
2. Menu del browser → **"Aggiungi a schermata Home"**
3. Apri l'icona come faresti con Diario di Ferro, compila il form, salva

Da quel momento la ricerca gira da sola, indipendentemente dal telefono acceso o spento. Il tabellone in cima alla pagina mostra stato, prossimi slot e ultima esecuzione.

## Ricerca on-demand

Oltre allo scheduler automatico, la pagina ha un bottone **"Cerca subito"** sotto "Salva configurazione": usa i valori attuali del form (anche se non ancora salvati) e mostra i risultati subito in pagina, sotto il tabellone di stato. Non manda email, non modifica la configurazione salvata né lo scheduler automatico — è solo un modo per fare una verifica immediata senza aspettare il prossimo slot programmato.

## Cronologia correzioni

- **Bug corretto**: `lib/travelpayouts.mjs` usava nomi di campo sbagliati (`depart_date`, `number_of_changes`) rispetto a quelli reali restituiti dall'API (`departure_at`, `transfers`), causando zero risultati anche quando l'API trovava voli. Corretto.
- **Ricerca round-trip reale**: prima la ricerca (con Duffel) considerava solo l'andata, ignorando le date di rientro. Ora cerca sempre andata+ritorno insieme.
- **Fasce orarie chiarite**: "orario di partenza" = decollo dell'andata, "orario di arrivo" = atterraggio del volo di **ritorno** (quando rientri a casa), non dell'andata come prima.
- **Duffel come fonte primaria**: Travelpayouts (`v1/prices/cheap`) si è rivelata una cache di prezzi visti da altri utenti nelle ultime 48 ore, non una ricerca live — causa di risultati con orari o combinazioni non più reali. L'alternativa (l'API di ricerca live di Travelpayouts) richiede approvazione come partner con requisiti di conversione non adatti a un tool personale. Duffel resta quindi la fonte consigliata: dati reali, nessuna approvazione oltre alla verifica già fatta. Travelpayouts resta disponibile come fallback se Duffel non è configurata, con gli stessi limiti di prima.
- **Compagnia e numero di volo**: ora mostrati nei risultati (pagina ed email), quando la fonte li fornisce.

## Aggiornamenti futuri

Se in futuro vuoi modificare il codice, basta modificare il file corrispondente direttamente su GitHub (tocca la matita ✏️ su un file esistente, modifica, "Commit changes") — Netlify rifà il deploy automaticamente ad ogni commit.
