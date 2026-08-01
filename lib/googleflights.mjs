// Wrapper per l'API non ufficiale "Google Flights2" su RapidAPI (DataCrawler).
// NON è un prodotto Google — è un servizio di scraping di terze parti che
// replica i risultati di google.com/flights. Copre praticamente tutte le
// compagnie, incluse low-cost come Ryanair e Wizz Air, ma:
//   - può rompersi senza preavviso se Google cambia le proprie pagine
//   - piano gratuito limitato a 150 richieste/mese
//
// STATO NOTO (confermato con dati reali): il parsing dell'andata funziona
// (topFlights[].flights[], price, stops, airline, flight_number, orari).
//
// ROUND-TRIP: l'API segue lo stesso schema in due passi di Google Flights
// stesso — la prima chiamata restituisce solo opzioni di ANDATA, ciascuna
// con un "next_token"; per vedere il ritorno abbinato (con orario, scali,
// compagnia e prezzo combinato reale) serve una SECONDA chiamata con quel
// token. Per non moltiplicare il consumo di quota, la facciamo SOLO per il
// volo di andata più economico (+1 chiamata per ricerca round-trip), non
// per ogni opzione. Gli altri risultati restano andata-only con la data di
// ritorno come placeholder.
//
// Il nome del parametro per il secondo passaggio ("next_token") è dedotto
// per coerenza con il campo restituito dalla API — non confermato dalla
// documentazione ufficiale (introvabile). Se il secondo passaggio fallisce,
// l'errore viene esposto in modo diagnostico invece di fallire silenziosamente.

const BASE_URL = "https://google-flights2.p.rapidapi.com/api/v1/searchFlights";

function inTimeWindow(isoTime, from, to) {
  if (!isoTime) return true;
  if (!from && !to) return true;
  const hhmm = isoTime.slice(11, 16);
  if (from && hhmm < from) return false;
  if (to && hhmm > to) return false;
  return true;
}

function buildSearchUrl({ origin, destination, departDateFrom, returnDateFrom, currency }) {
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
  return url;
}

function extractItineraries(json) {
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
  return { itineraries, rawItineraries };
}

export async function searchGoogleFlights({
  apiKey,
  origin,
  destination,
  departDateFrom,
  returnDateFrom,
  maxStopsOutbound,
  maxStopsReturn,
  departTimeFrom,
  departTimeTo,
  arriveTimeFrom,
  arriveTimeTo,
  currency = "EUR",
}) {
  const url = buildSearchUrl({ origin, destination, departDateFrom, returnDateFrom, currency });

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
  const { itineraries, rawItineraries } = extractItineraries(json);

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

  // Log diagnostico gratuito sui campi relativi agli scali (stessa risposta
  // già ricevuta, nessuna chiamata aggiuntiva) — utile per capire se un
  // eventuale scalo mancante è un problema di parsing o un dato impreciso
  // della fonte stessa.
  console.log(
    `[googleflights DEBUG stops ${origin}->${destination}] ` +
      JSON.stringify(
        itineraries.slice(0, 5).map((it) => ({
          it_stops_field: it.stops,
          legs_count: (it.flights || it.legs || []).length,
          flight_numbers: (it.flights || it.legs || []).map((l) => l.flight_number),
          price: it.price,
        }))
      )
  );

  const results = [];
  for (const it of itineraries) {
    const legs = it.flights || it.legs || [];
    if (!legs.length) continue;

    const outboundLeg = legs[0];
    const lastOutboundIdx = legs.length - 1;

    const price = it.price ?? it.total_price ?? null;
    if (price == null) continue;

    // Il campo "stops" dell'API si è dimostrato inaffidabile (dichiara 0
    // anche per itinerari con 2 voli distinti/scalo reale). Il numero di
    // voli elencati in "flights"/"legs" è la fonte corretta.
    const stops = Math.max(0, legs.length - 1);
    if (maxStopsOutbound != null && stops > maxStopsOutbound) continue;

    const departTime = outboundLeg.departure_airport?.time || null;
    const arriveTime = legs[lastOutboundIdx]?.arrival_airport?.time || null;

    if (!inTimeWindow(departTime, departTimeFrom, departTimeTo)) continue;
    if (!returnDateFrom && !inTimeWindow(arriveTime, arriveTimeFrom, arriveTimeTo)) continue;

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
      flightNumber: legs.map((l) => l.flight_number).filter(Boolean).join(" + ") || null,
      bookingUrl,
      source: "googleflights",
      note: returnDateFrom
        ? "dati non ufficiali (scraping Google Flights); dettagli del ritorno solo per il volo più economico, verificare a mano gli altri"
        : "dati non ufficiali (scraping Google Flights, quota gratuita limitata), verificare disponibilità reale prima di prenotare",
      _nextToken: it.next_token || null, // interno, rimosso prima di restituire
    });
  }

  // Round-trip: recuperiamo il ritorno abbinato SOLO per il volo di andata
  // più economico, con una singola chiamata aggiuntiva.
  if (returnDateFrom && results.length > 0) {
    const cheapest = results.reduce((min, r) => (r.price < min.price ? r : min), results[0]);

    if (cheapest._nextToken) {
      try {
        const returnUrl = buildSearchUrl({ origin, destination, departDateFrom, returnDateFrom, currency });
        returnUrl.searchParams.set("next_token", cheapest._nextToken);

        const returnRes = await fetch(returnUrl.toString(), {
          headers: {
            "x-rapidapi-host": "google-flights2.p.rapidapi.com",
            "x-rapidapi-key": apiKey,
          },
        });

        if (!returnRes.ok) {
          throw new Error(`status ${returnRes.status}: ${await returnRes.text()}`);
        }

        const returnJson = await returnRes.json();
        console.log(
          `[googleflights DEBUG second-step ${origin}->${destination}] ` +
            JSON.stringify(returnJson).slice(0, 1500)
        );

        const { itineraries: returnItineraries } = extractItineraries(returnJson);
        if (Array.isArray(returnItineraries) && returnItineraries.length > 0) {
          // Prendiamo il ritorno più economico proposto per questa andata,
          // tra le opzioni già ricevute (nessuna chiamata in più) che
          // rispettano SIA la fascia oraria SIA gli scali massimi richiesti
          // per il ritorno — non la più economica in assoluto, altrimenti
          // quei filtri vengono ignorati sul ritorno.
          const stopsOf = (r) => Math.max(0, (r.flights || r.legs || []).length - 1);
          const matchesFilters = (r) => {
            const rLegs = r.flights || r.legs || [];
            const lastLeg = rLegs[rLegs.length - 1];
            const arriveTime = lastLeg?.arrival_airport?.time || null;
            const timeOk = inTimeWindow(arriveTime, arriveTimeFrom, arriveTimeTo);
            const stopsOk = maxStopsReturn == null || stopsOf(r) <= maxStopsReturn;
            return timeOk && stopsOk;
          };
          const withinFilters = returnItineraries.filter(matchesFilters);
          const candidatePool = withinFilters.length > 0 ? withinFilters : returnItineraries;
          const noneMatchedFilters = withinFilters.length === 0;

          const cheapestReturn = candidatePool.reduce(
            (min, r) => ((r.price ?? Infinity) < (min.price ?? Infinity) ? r : min),
            candidatePool[0]
          );
          const returnLegs = cheapestReturn.flights || cheapestReturn.legs || [];
          if (returnLegs.length > 0) {
            const retFirstLeg = returnLegs[0];
            const retLastLeg = returnLegs[returnLegs.length - 1];
            cheapest.returnArriveTime = retLastLeg.arrival_airport?.time?.slice(11, 16) || null;
            cheapest.returnStops = Math.max(0, returnLegs.length - 1);
            cheapest.returnAirline = retFirstLeg.airline || null;
            cheapest.returnFlightNumber = returnLegs.map((l) => l.flight_number).filter(Boolean).join(" + ") || null;
            if (typeof cheapestReturn.combined_price === "number") {
              cheapest.price = cheapestReturn.combined_price;
            }
            cheapest.note = noneMatchedFilters
              ? "⚠️ nessun ritorno trovato con fascia oraria/scali richiesti: mostrato il più economico disponibile, fuori da quei criteri"
              : "dati non ufficiali (scraping Google Flights, quota gratuita limitata), verificare disponibilità reale prima di prenotare";
          }
        }
      } catch (err) {
        // Non fatale: il resto dei risultati resta valido, segnaliamo solo
        // che il secondo passaggio (dettagli ritorno) non è riuscito.
        console.log(`[googleflights DEBUG second-step FAILED ${origin}->${destination}] ${err.message}`);
        cheapest.note = `dettagli ritorno non recuperati (${err.message.slice(0, 120)})`;
      }
    }
  }

  return results.map(({ _nextToken, ...r }) => r);
}
