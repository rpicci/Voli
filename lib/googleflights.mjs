// Wrapper per l'API non ufficiale "Google Flights2" su RapidAPI (DataCrawler).
// NON è un prodotto Google — è un servizio di scraping di terze parti che
// replica i risultati di google.com/flights. Copre praticamente tutte le
// compagnie, incluse low-cost come Ryanair e Wizz Air, ma:
//   - può rompersi senza preavviso se Google cambia le proprie pagine
//   - piano gratuito limitato a 150 richieste/mese
//
// STATO NOTO: il parsing dell'andata funziona (testato). Il parsing dei
// dettagli del volo di RITORNO (orario, scali, compagnia) non è ancora
// affidabile: non è stato possibile vedere la struttura reale della
// risposta per una ricerca andata+ritorno. Per questo logghiamo un estratto
// della risposta grezza (via console.log, visibile nei log della funzione
// su Netlify — Site → Logs/Functions) ogni volta che c'è un ritorno, senza
// consumare chiamate aggiuntive: al prossimo test andata+ritorno, controlla
// i log e condividi cosa trovi per sistemare il parsing una volta per tutte.

const BASE_URL = "https://google-flights2.p.rapidapi.com/api/v1/searchFlights";

function inTimeWindow(isoTime, from, to) {
  if (!isoTime) return true; // se non abbiamo l'orario, non filtriamo (meglio includere che escludere per errore)
  if (!from && !to) return true;
  const hhmm = isoTime.slice(11, 16);
  if (from && hhmm < from) return false;
  if (to && hhmm > to) return false;
  return true;
}

export async function searchGoogleFlights({
  apiKey,
  origin,
  destination,
  departDateFrom,
  returnDateFrom,
  maxStopsOutbound,
  departTimeFrom,
  departTimeTo,
  arriveTimeFrom,
  arriveTimeTo,
  currency = "EUR",
}) {
  const url = new URL(BASE_URL);
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", destination);
  url.searchParams.set("outbound_date", departDateFrom);
  if (returnDateFrom) url.searchParams.set("return_date", returnDateFrom);
  url.searchParams.set("travel_class", "ECONOMY");
  url.searchParams.set("adults", "1");
  url.searchParams.set("show_hidden", "1");
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

  if (returnDateFrom) {
    // Log diagnostico gratuito (nessuna chiamata aggiuntiva): visibile nei
    // log della funzione su Netlify per capire come sono strutturati i dati
    // di ritorno la prossima volta che serve sistemare il parsing.
    console.log(
      `[googleflights DEBUG round-trip ${origin}->${destination}] ` +
        JSON.stringify(json).slice(0, 1500)
    );
  }

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
    const lastOutboundIdx = legs.length - 1;

    const price = it.price ?? it.total_price ?? null;
    if (price == null) continue;

    const stops = Math.max(0, legs.length - 1);
    if (maxStopsOutbound != null && stops > maxStopsOutbound) continue;

    const departTime = outboundLeg.departure_airport?.time || null;
    const arriveTime = legs[lastOutboundIdx]?.arrival_airport?.time || null;

    // Filtro fascia oraria di partenza: decollo dell'andata
    if (!inTimeWindow(departTime, departTimeFrom, departTimeTo)) continue;
    // Se non c'è ritorno, il filtro "arrivo" si applica all'andata stessa
    // (stessa convenzione usata per Duffel in caso di sola andata).
    if (!returnDateFrom && !inTimeWindow(arriveTime, arriveTimeFrom, arriveTimeTo)) continue;

    // Link di ricerca generico su Google (non un deep-link a un volo
    // specifico: il formato interno di Google Flights per quello richiede
    // una codifica protobuf che non è ricostruibile in modo affidabile).
    const searchQuery = returnDateFrom
      ? `voli da ${origin} a ${destination} il ${departDateFrom}, ritorno ${returnDateFrom}`
      : `voli da ${origin} a ${destination} il ${departDateFrom}`;
    const bookingUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

    results.push({
      origin,
      destination,
      price: typeof price === "string" ? parseFloat(price.replace(/[^\d.]/g, "")) : price,
      currency,
      departDate: departTime?.slice(0, 10) || departDateFrom,
      departTime: departTime?.slice(11, 16) || null,
      arriveTime: arriveTime?.slice(11, 16) || null,
      returnDate: returnDateFrom || null,
      stops,
      airline: outboundLeg.airline || null,
      flightNumber: outboundLeg.flight_number || null,
      bookingUrl,
      source: "googleflights",
      note: returnDateFrom
        ? "dati non ufficiali (scraping Google Flights); dettagli del ritorno non ancora affidabili, verificare a mano"
        : "dati non ufficiali (scraping Google Flights, quota gratuita limitata), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
