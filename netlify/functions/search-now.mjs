import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { searchGoogleFlights } from "../../lib/googleflights.mjs";
import { searchSkyscannerFlights } from "../../lib/skyscanner.mjs";
import { searchBookingFlights } from "../../lib/booking.mjs";

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
  // Sky Scrapper (Skyscanner) ha una quota ancora più bassa (100/mese) e
  // costa più chiamate per ricerca (risoluzione aeroporti + ricerca):
  // stesso principio di opt-in esplicito di Google Flights.
  const useSkyscanner = !!params.includeSkyscanner && !!RAPIDAPI_KEY;
  // Booking.com ha una quota molto più generosa (500/mese) delle altre due
  // fonti RapidAPI, ma resta comunque opt-in per coerenza con lo schema
  // già usato.
  const useBooking = !!params.includeBooking && !!RAPIDAPI_KEY;
  const skyscannerCache = new Map();

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
            maxStopsReturn: params.maxStopsReturn,
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

      if (useSkyscanner) {
        try {
          const r = await searchSkyscannerFlights({
            apiKey: RAPIDAPI_KEY,
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
            cache: skyscannerCache,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Skyscanner ${origin}->${destination}: ${err.message}`);
        }
      }

      if (useBooking) {
        try {
          const r = await searchBookingFlights({
            apiKey: RAPIDAPI_KEY,
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
          errors.push(`Booking.com ${origin}->${destination}: ${err.message}`);
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
      useSkyscanner ? "skyscanner" : null,
      useBooking ? "booking" : null,
    ].filter(Boolean),
  };

  return new Response(JSON.stringify({ results: allResults, errors, criteria }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
