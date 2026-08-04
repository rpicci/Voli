import { getStore } from "@netlify/blobs";
import { isDueNow } from "../../lib/scheduling.mjs";
import { generateDatePairs } from "../../lib/dateGeneration.mjs";
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

  const { due, currentSlotKey, slots } = isDueNow(config.attemptsPerDay, config.lastRunSlotKey, config.startHour);

  if (!due) {
    return new Response(
      `Non è uno slot programmato ora. Slot odierni (ora Italia): ${slots.join(", ")}`,
      { status: 200 }
    );
  }

  // Segniamo subito lo slot come "in corso" prima di fare qualunque ricerca,
  // per evitare doppie esecuzioni se Netlify attiva la funzione due volte
  // quasi in contemporanea (vedi commento storico nel repo).
  config.lastRunSlotKey = currentSlotKey;
  await configStore.setJSON("config", config);

  const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM;
  const useGoogleFlights = !!config.includeGoogleFlightsScheduled && !!RAPIDAPI_KEY;

  const routes = Array.isArray(config.routes) ? config.routes.slice(0, 3) : [];

  const allResults = [];
  const errors = [];

  for (const route of routes) {
    const datePairs = generateDatePairs(route);

    for (const { departDate, returnDate } of datePairs) {
      for (const origin of route.originAirports) {
        for (const destination of route.destinationAirports) {
          if (origin === destination) continue;

          if (DUFFEL_API_KEY) {
            try {
              const r = await searchFlightsDuffel({
                apiKey: DUFFEL_API_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: config.maxStopsOutbound,
                maxStopsReturn: config.maxStopsReturn,
                departTimeFrom: config.departTimeFrom,
                departTimeTo: config.departTimeTo,
                arriveTimeFrom: config.arriveTimeFrom,
                arriveTimeTo: config.arriveTimeTo,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Duffel ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (TRAVELPAYOUTS_TOKEN) {
            try {
              const r = await searchCheapFlights({
                token: TRAVELPAYOUTS_TOKEN,
                origin,
                destination,
                departDateFrom: departDate,
                departDateTo: departDate,
                returnDateFrom: returnDate,
                returnDateTo: returnDate,
                maxStops: config.maxStopsOutbound,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Travelpayouts ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useGoogleFlights) {
            try {
              const r = await searchGoogleFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: config.maxStopsOutbound,
                maxStopsReturn: config.maxStopsReturn,
                departTimeFrom: config.departTimeFrom,
                departTimeTo: config.departTimeTo,
                arriveTimeFrom: config.arriveTimeFrom,
                arriveTimeTo: config.arriveTimeTo,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Google Flights ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  let emailError = null;

  if (RESEND_API_KEY && EMAIL_FROM && config.email) {
    try {
      if (allResults.length > 0) {
        const routeLabels = routes
          .map((r) => `${r.originAirports.join("/")} → ${r.destinationAirports.join("/")}`)
          .join(" · ");
        await sendResultsEmail({
          apiKey: RESEND_API_KEY,
          from: EMAIL_FROM,
          to: config.email,
          results: allResults,
          searchLabel: routeLabels,
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
    } catch (err) {
      emailError = err.message;
    }
  }

  await resultsStore.setJSON("last-run", {
    ranAt: new Date().toISOString(),
    slotKey: currentSlotKey,
    resultsCount: allResults.length,
    errors,
    emailError,
  });

  return new Response(
    JSON.stringify({ ok: true, found: allResults.length, errors, emailError }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = {
  schedule: "0 * * * *",
};
