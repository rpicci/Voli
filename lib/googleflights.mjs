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

  // La risposta è deducibile da formati simili (SerpAPI-style), ma la
  // struttura esatta di "itineraries" può essere un array oppure un oggetto
  // con sotto-liste (es. topFlights/otherFlights). Gestiamo entrambi i casi.
  const rawItineraries = json?.data?.itineraries ?? json?.itineraries ?? null;

  let itineraries = [];
  if (Array.isArray(rawItineraries)) {
    itineraries = rawItineraries;
  } else if (rawItineraries && typeof rawItineraries === "object") {
    itineraries = [
      ...(rawItineraries.topFlights || rawItineraries.best || rawItineraries.bestFlights || []),
      ...(rawItineraries.otherFlights || rawItineraries.other || []),
    ];
  } else if (Array.isArray(json?.best_flights) || Array.isArray(json?.other_flights)) {
    itineraries = [...(json?.best_flights || []), ...(json?.other_flights || [])];
  }

  if (!Array.isArray(itineraries) || itineraries.length === 0) {
    // La chiamata è andata a buon fine (200 OK, quota consumata) ma il
    // parsing non ha trovato nulla di riconoscibile. Invece di restituire
    // silenziosamente zero risultati o rompersi, esponiamo la struttura
    // reale — visibile direttamente nella riga "Errori" della pagina —
    // copiamela e sistemo il parsing sui nomi di campo corretti.
    const topLevelKeys = Object.keys(json || {}).join(", ") || "(nessuna chiave)";
    const dataKeys = json?.data && typeof json.data === "object" ? Object.keys(json.data).join(", ") : "(assente)";
    const itinerariesKeys =
      rawItineraries && typeof rawItineraries === "object" && !Array.isArray(rawItineraries)
        ? Object.keys(rawItineraries).join(", ")
        : "(assente o già array)";
    const snippet = JSON.stringify(json).slice(0, 700);
    throw new Error(
      `Nessun itinerario riconosciuto. Chiavi json: [${topLevelKeys}] · chiavi json.data: [${dataKeys}] · ` +
        `chiavi json.data.itineraries: [${itinerariesKeys}] · estratto: ${snippet}`
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
