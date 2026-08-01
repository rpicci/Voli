import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { searchGoogleFlights } from "../../lib/googleflights.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let params;
  try {
    params = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON non valido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const required = ["originAirports", "destinationAirports", "departDate"];
  const missing = required.filter((k) => !params[k] || params[k].length === 0);
  if (missing.length) {
    return new Response(
      JSON.stringify({ error: `Campi mancanti: ${missing.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  // Google Flights (RapidAPI) ha una quota gratuita di sole 150 richieste/mese:
  // va interrogata solo su richiesta esplicita dell'utente per questa singola
  // ricerca, mai automaticamente, per non esaurirla in fretta.
  const useGoogleFlights = !!params.includeGoogleFlights && !!RAPIDAPI_KEY;

  const allResults = [];
  const errors = [];

  for (const origin of params.originAirports) {
    for (const destination of params.destinationAirports) {
      if (origin === destination) continue;

      // Interroghiamo tutte le fonti disponibili e abilitate, non più una in
      // alternativa all'altra: Duffel per dati live affidabili, Travelpayouts
      // e Google Flights anche per Ryanair/Wizz Air che Duffel non copre.
      if (DUFFEL_API_KEY) {
        try {
          const r = await searchFlightsDuffel({
            apiKey: DUFFEL_API_KEY,
            origin,
            destination,
            departDateFrom: params.departDate,
            returnDateFrom: params.returnDate,
            maxStopsOutbound: params.maxStopsOutbound,
            maxStopsReturn: params.maxStopsReturn,
            departTimeFrom: params.departTimeFrom,
            departTimeTo: params.departTimeTo,
            arriveTimeFrom: params.arriveTimeFrom,
            arriveTimeTo: params.arriveTimeTo,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Duffel ${origin}->${destination}: ${err.message}`);
        }
      }

      if (TRAVELPAYOUTS_TOKEN) {
        try {
          const r = await searchCheapFlights({
            token: TRAVELPAYOUTS_TOKEN,
            origin,
            destination,
            departDateFrom: params.departDate,
            departDateTo: params.departDate,
            returnDateFrom: params.returnDate,
            returnDateTo: params.returnDate,
            maxStops: params.maxStopsOutbound,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Travelpayouts ${origin}->${destination}: ${err.message}`);
        }
      }

      if (useGoogleFlights) {
        try {
          const r = await searchGoogleFlights({
            apiKey: RAPIDAPI_KEY,
            origin,
            destination,
            departDateFrom: params.departDate,
            returnDateFrom: params.returnDate,
            maxStopsOutbound: params.maxStopsOutbound,
            departTimeFrom: params.departTimeFrom,
            departTimeTo: params.departTimeTo,
            arriveTimeFrom: params.arriveTimeFrom,
            arriveTimeTo: params.arriveTimeTo,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Google Flights ${origin}->${destination}: ${err.message}`);
        }
      }
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  const criteria = {
    roundTrip: !!params.returnDate,
    departDate: params.departDate,
    returnDate: params.returnDate || null,
    maxStopsOutbound: params.maxStopsOutbound,
    maxStopsReturn: params.maxStopsReturn,
    fontiInterrogate: [
      DUFFEL_API_KEY ? "duffel" : null,
      TRAVELPAYOUTS_TOKEN ? "travelpayouts" : null,
      useGoogleFlights ? "googleflights" : null,
    ].filter(Boolean),
  };

  return new Response(JSON.stringify({ results: allResults, errors, criteria }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
