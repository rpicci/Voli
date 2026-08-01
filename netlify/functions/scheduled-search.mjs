import { getStore } from "@netlify/blobs";
import { isDueNow } from "../../lib/scheduling.mjs";
import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { searchGoogleFlights } from "../../lib/googleflights.mjs";
import { sendResultsEmail, sendStatusEmail } from "../../lib/email.mjs";

export default async () => {
  const configStore = getStore("flight-watch-config");
  const resultsStore = getStore("flight-watch-results");

  const config = await configStore.get("config", { type: "json" });
  if (!config) return new Response("Nessuna configurazione", { status: 200 });

  if (!config.active) {
    return new Response("Ricerche disattivate (flag stop)", { status: 200 });
  }

  const { due, currentSlotKey, slots } = isDueNow(config.attemptsPerDay, config.lastRunSlotKey);

  if (!due) {
    return new Response(
      `Non è uno slot programmato ora. Slot odierni (ora Italia): ${slots.join(", ")}`,
      { status: 200 }
    );
  }

  const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM;
  // A differenza della ricerca on-demand, qui Google Flights va abilitata
  // esplicitamente nella configurazione salvata (flag persistente), non
  // ricerca per ricerca — perché lo scheduler gira da solo senza che tu
  // possa spuntare una checkbox ogni volta.
  const useGoogleFlights = !!config.includeGoogleFlightsScheduled && !!RAPIDAPI_KEY;

  const allResults = [];
  const errors = [];

  for (const origin of config.originAirports) {
    for (const destination of config.destinationAirports) {
      if (origin === destination) continue;

      // Interroghiamo entrambe le fonti quando disponibili: Duffel per dati
      // live affidabili, Travelpayouts anche per Ryanair/Wizz Air (cache).
      if (DUFFEL_API_KEY) {
        try {
          const r = await searchFlightsDuffel({
            apiKey: DUFFEL_API_KEY,
            origin,
            destination,
            departDateFrom: config.departDate,
            returnDateFrom: config.returnDate,
            maxStopsOutbound: config.maxStopsOutbound,
            maxStopsReturn: config.maxStopsReturn,
            departTimeFrom: config.departTimeFrom,
            departTimeTo: config.departTimeTo,
            arriveTimeFrom: config.arriveTimeFrom,
            arriveTimeTo: config.arriveTimeTo,
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
            departDateFrom: config.departDate,
            departDateTo: config.departDate,
            returnDateFrom: config.returnDate,
            returnDateTo: config.returnDate,
            maxStops: config.maxStopsOutbound,
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
            departDateFrom: config.departDate,
            returnDateFrom: config.returnDate,
            maxStopsOutbound: config.maxStopsOutbound,
            departTimeFrom: config.departTimeFrom,
            departTimeTo: config.departTimeTo,
            arriveTimeFrom: config.arriveTimeFrom,
            arriveTimeTo: config.arriveTimeTo,
          });
          allResults.push(...r);
        } catch (err) {
          errors.push(`Google Flights ${origin}->${destination}: ${err.message}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  await resultsStore.setJSON("last-run", {
    ranAt: new Date().toISOString(),
    slotKey: currentSlotKey,
    resultsCount: allResults.length,
    errors,
  });

  config.lastRunSlotKey = currentSlotKey;
  await configStore.setJSON("config", config);

  if (RESEND_API_KEY && EMAIL_FROM && config.email) {
    if (allResults.length > 0) {
      await sendResultsEmail({
        apiKey: RESEND_API_KEY,
        from: EMAIL_FROM,
        to: config.email,
        results: allResults,
        searchLabel: `${config.originAirports.join("/")} → ${config.destinationAirports.join("/")}`,
      });
    } else if (errors.length > 0) {
      await sendStatusEmail({
        apiKey: RESEND_API_KEY,
        from: EMAIL_FROM,
        to: config.email,
        subject: "⚠️ Flight Watch — errore nella ricerca",
        message: `La ricerca di oggi ha incontrato errori: ${errors.join("; ")}`,
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, found: allResults.length, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  schedule: "0 * * * *",
};
