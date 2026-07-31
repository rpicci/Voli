import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";

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

  const allResults = [];
  const errors = [];

  for (const origin of params.originAirports) {
    for (const destination of params.destinationAirports) {
      if (origin === destination) continue;

      // Interroghiamo ENTRAMBE le fonti quando disponibili, non più una in
      // alternativa all'altra: Duffel per dati live affidabili, Travelpayouts
      // anche per Ryanair/Wizz Air che Duffel non copre (dati in cache).
      if (DUFFEL_API_KEY) {
        try {
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
            departDateFrom: params.departDateFrom,
            departDateTo: params.departDateTo,
            returnDateFrom: params.returnDateFrom,
            returnDateTo: params.returnDateTo,
            maxStops: params.maxStopsOutbound,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Travelpayouts ${origin}->${destination}: ${err.message}`);
        }
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
    fontiInterrogate: [DUFFEL_API_KEY ? "duffel" : null, TRAVELPAYOUTS_TOKEN ? "travelpayouts" : null].filter(Boolean),
  };

  return new Response(JSON.stringify({ results: allResults, errors, criteria }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
