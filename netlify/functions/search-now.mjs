import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";

// Ricerca immediata, scatenata dal bottone "Cerca subito" nel form.
// Non tocca la configurazione salvata né lo scheduler automatico.
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

  const required = ["originAirports", "destinationAirports", "departDateFrom", "departDateTo"];
  const missing = required.filter((k) => !params[k] || params[k].length === 0);
  if (missing.length) {
    return new Response(
      JSON.stringify({ error: `Campi mancanti: ${missing.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;

  const origins = params.originAirports;
  const destinations = params.destinationAirports;

  const allResults = [];
  const errors = [];

  for (const origin of origins) {
    for (const destination of destinations) {
      if (origin === destination) continue;

      try {
        if (DUFFEL_API_KEY) {
          const r = await searchFlightsDuffel({
            apiKey: DUFFEL_API_KEY,
            origin,
            destination,
            departDateFrom: params.departDateFrom,
            returnDateFrom: params.returnDateFrom,
            maxStopsOutbound: params.maxStopsOutbound,
            maxStopsReturn: params.maxStopsReturn,
            departTimeFrom: params.departTimeFrom,
            departTimeTo: params.departTimeTo,
            arriveTimeFrom: params.arriveTimeFrom,
            arriveTimeTo: params.arriveTimeTo,
          });
          allResults.push(...r);
        } else {
          const r = await searchCheapFlights({
            token: TRAVELPAYOUTS_TOKEN,
            origin,
            destination,
            departDateFrom: params.departDateFrom,
            departDateTo: params.departDateTo,
            returnDateFrom: params.returnDateFrom,
            returnDateTo: params.returnDateTo,
            maxStops: params.maxStopsOutbound,
          });
          allResults.push(...r);
        }
      } catch (err) {
        errors.push(`${origin}->${destination}: ${err.message}`);
      }
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  const criteria = {
    roundTrip: !!params.returnDateFrom,
    departDateFrom: params.departDateFrom,
    departDateTo: params.departDateTo,
    returnDateFrom: params.returnDateFrom || null,
    returnDateTo: params.returnDateTo || null,
    maxStopsOutbound: params.maxStopsOutbound,
    maxStopsReturn: params.maxStopsReturn,
    fonte: DUFFEL_API_KEY ? "duffel" : "travelpayouts",
  };

  return new Response(JSON.stringify({ results: allResults, errors, criteria }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
