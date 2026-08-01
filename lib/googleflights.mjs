// Wrapper per l'API non ufficiale "Google Flights2" su RapidAPI (DataCrawler).
// NON è un prodotto Google — è un servizio di scraping di terze parti che
// replica i risultati di google.com/flights. Copre praticamente tutte le
// compagnie, incluse low-cost come Ryanair e Wizz Air, ma:
//   - può rompersi senza preavviso se Google cambia le proprie pagine
//   - piano gratuito limitato a 150 richieste/mese
// Per questo motivo va usata con parsimonia (vedi note nei file chiamanti).
//
// NOTA IMPORTANTE: non è stato possibile testare questa integrazione con una
// chiamata reale (l'ambiente di sviluppo non ha accesso a internet). La
// struttura della risposta è dedotta dal formato usato da API simili
// (SerpAPI Google Flights, che questo servizio sembra imitare). Se il
// parsing risulta vuoto o sbagliato al primo test reale, condividi la
// risposta JSON grezza e sistemiamo i nomi dei campi.

const BASE_URL = "https://google-flights2.p.rapidapi.com/api/v1/searchFlights";

export async function searchGoogleFlights({
  apiKey,
  origin,
  destination,
  departDateFrom,
  returnDateFrom,
  maxStopsOutbound,
  currency = "EUR",
}) {
  const url = new URL(BASE_URL);
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", departDateFrom);
  if (returnDateFrom) url.searchParams.set("return_date", returnDateFrom);
  url.searchParams.set("travel_class", "ECONOMY");
  url.searchParams.set("adults", "1");
  url.searchParams.set("show_hidden", "1"); // include tariffe/voli meno "ovvi", utile per le low-cost
  url.searchParams.set("currency", currency);
  url.searchParams.set("language_code", "it");
  url.searchParams.set("country_code", "IT");
  url.searchParams.set("search_type", "best");

  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-host": "google-flights2.p.rapidapi.com",
      "x-rapidapi-key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Google Flights (RapidAPI) error ${res.status} per ${origin}->${destination}: ${await res.text()}`
    );
  }

  const json = await res.json();

  // La risposta è deducibile da formati simili (SerpAPI-style): un elenco
  // di itinerari sotto "best_flights"/"other_flights" oppure direttamente
  // sotto "data"/"itineraries" a seconda della versione dell'API. Proviamo
  // i percorsi più plausibili in ordine.
  const itineraries =
    json?.data?.itineraries ||
    json?.itineraries ||
    [...(json?.best_flights || []), ...(json?.other_flights || [])] ||
    [];

  if (itineraries.length === 0) {
    // La chiamata è andata a buon fine (200 OK, quota consumata) ma il
    // parsing non ha trovato nulla nella struttura attesa: quasi certamente
    // i nomi dei campi reali sono diversi da quelli ipotizzati. Invece di
    // restituire silenziosamente zero risultati, esponiamo le chiavi di
    // primo livello e un estratto della risposta, visibili direttamente
    // nella riga "Errori" della pagina — copiameli e sistemo il parsing.
    const topLevelKeys = Object.keys(json || {}).join(", ") || "(nessuna chiave, corpo vuoto)";
    const snippet = JSON.stringify(json).slice(0, 600);
    throw new Error(
      `Nessun itinerario riconosciuto nella risposta. Chiavi di primo livello: [${topLevelKeys}]. ` +
        `Estratto risposta: ${snippet}`
    );
  }

  const results = [];
  for (const it of itineraries) {
    const legs = it.flights || it.legs || [];
    if (!legs.length) continue;

    const outboundLeg = legs[0];
    const lastOutboundIdx = legs.length - 1; // se non c'è ritorno separato, semplificazione

    const price = it.price ?? it.total_price ?? null;
    if (price == null) continue;

    const stops = Math.max(0, legs.length - 1);
    if (maxStopsOutbound != null && stops > maxStopsOutbound) continue;

    results.push({
      origin,
      destination,
      price: typeof price === "string" ? parseFloat(price.replace(/[^\d.]/g, "")) : price,
      currency,
      departDate: outboundLeg.departure_airport?.time?.slice(0, 10) || departDateFrom,
      departTime: outboundLeg.departure_airport?.time?.slice(11, 16) || null,
      arriveTime: legs[lastOutboundIdx]?.arrival_airport?.time?.slice(11, 16) || null,
      returnDate: returnDateFrom || null,
      stops,
      airline: outboundLeg.airline || null,
      flightNumber: outboundLeg.flight_number || null,
      bookingUrl: it.booking_token
        ? `https://www.google.com/flights?tfs=${encodeURIComponent(it.booking_token)}`
        : null,
      source: "googleflights",
      note: "dati non ufficiali (scraping Google Flights, quota gratuita limitata), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
