import { getStore } from "@netlify/blobs";
import { generateDatePairs } from "../../lib/dateGeneration.mjs";
import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { searchGoogleFlights } from "../../lib/googleflights.mjs";
import { searchSkyscannerFlights } from "../../lib/skyscanner.mjs";
import { searchBookingFlights } from "../../lib/booking.mjs";
import { getEurRates } from "../../lib/exchangeRates.mjs";
import { sendResultsEmail, sendStatusEmail } from "../../lib/email.mjs";

// Funzione BACKGROUND (fino a 15 minuti di esecuzione, contro i 30 secondi
// delle funzioni schedulate). Fa tutto il lavoro pesante: viene attivata da
// scheduled-search.mjs solo dopo che quest'ultima ha già verificato che è
// uno slot valido e ha "marcato" lo slot come in corso — qui non rifacciamo
// quei controlli, ci fidiamo del chiamante.
export const config = {
  background: true,
};

export default async () => {
  const configStore = getStore("flight-watch-config");
  const resultsStore = getStore("flight-watch-results");

  const storedConfig = await configStore.get("config", { type: "json" });
  if (!storedConfig) return new Response("Nessuna configurazione", { status: 200 });

  const currentSlotKey = storedConfig.lastRunSlotKey;

  // Le Background Functions di Netlify girano su AWS Lambda in modalità
  // asincrona: se l'esecuzione va in errore o in timeout, Lambda la
  // ritenta automaticamente (senza avvisare l'app) rilanciando l'intera
  // funzione da capo per la stessa invocazione. Senza questo lucchetto,
  // un retry rifarebbe tutte le ricerche e manderebbe una seconda email.
  // Marchiamo subito lo slot come "in corso" e usciamo se troviamo che
  // qualcun altro l'ha già preso in carico.
  const lockKey = `lock-${currentSlotKey || "unknown"}`;
  const existingLock = await resultsStore.get(lockKey, { type: "json" });
  if (existingLock) {
    console.log(
      `[run-search-background] Slot ${currentSlotKey} già in corso/completato (lock trovato, avviato alle ${existingLock.startedAt}) — esco senza rifare il lavoro.`
    );
    return new Response("Slot già in esecuzione, invocazione duplicata ignorata", { status: 200 });
  }
  await resultsStore.setJSON(lockKey, { startedAt: new Date().toISOString() });

  const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM;
  const useGoogleFlights = !!storedConfig.includeGoogleFlightsScheduled && !!RAPIDAPI_KEY;
  const useSkyscanner = !!storedConfig.includeSkyscannerScheduled && !!RAPIDAPI_KEY;
  const useBooking = !!storedConfig.includeBookingScheduled && !!RAPIDAPI_KEY;
  const skyscannerCache = new Map();

  const routes = Array.isArray(storedConfig.routes) ? storedConfig.routes.slice(0, 3) : [];

  const allResults = [];
  const errors = [];

  let eurRates = null;
  if (useBooking) {
    try {
      eurRates = await getEurRates(RAPIDAPI_KEY);
    } catch (err) {
      errors.push(`Booking.com exchange-rates: ${err.message}`);
    }
  }

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
                maxStopsOutbound: storedConfig.maxStopsOutbound,
                maxStopsReturn: storedConfig.maxStopsReturn,
                departTimeFrom: storedConfig.departTimeFrom,
                departTimeTo: storedConfig.departTimeTo,
                arriveTimeFrom: storedConfig.arriveTimeFrom,
                arriveTimeTo: storedConfig.arriveTimeTo,
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
                maxStops: storedConfig.maxStopsOutbound,
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
                maxStopsOutbound: storedConfig.maxStopsOutbound,
                maxStopsReturn: storedConfig.maxStopsReturn,
                departTimeFrom: storedConfig.departTimeFrom,
                departTimeTo: storedConfig.departTimeTo,
                arriveTimeFrom: storedConfig.arriveTimeFrom,
                arriveTimeTo: storedConfig.arriveTimeTo,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Google Flights ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useSkyscanner) {
            try {
              const r = await searchSkyscannerFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: storedConfig.maxStopsOutbound,
                maxStopsReturn: storedConfig.maxStopsReturn,
                departTimeFrom: storedConfig.departTimeFrom,
                departTimeTo: storedConfig.departTimeTo,
                arriveTimeFrom: storedConfig.arriveTimeFrom,
                arriveTimeTo: storedConfig.arriveTimeTo,
                cache: skyscannerCache,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Skyscanner ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useBooking) {
            try {
              const r = await searchBookingFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: storedConfig.maxStopsOutbound,
                maxStopsReturn: storedConfig.maxStopsReturn,
                departTimeFrom: storedConfig.departTimeFrom,
                departTimeTo: storedConfig.departTimeTo,
                arriveTimeFrom: storedConfig.arriveTimeFrom,
                arriveTimeTo: storedConfig.arriveTimeTo,
                eurRates,
              });
              allResults.push(...r);
            } catch (err) {
              errors.push(`Booking.com ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  let emailError = null;

  if (RESEND_API_KEY && EMAIL_FROM && storedConfig.email) {
    try {
      if (allResults.length > 0) {
        const routeLabels = routes
          .map((r) => `${r.originAirports.join("/")} → ${r.destinationAirports.join("/")}`)
          .join(" · ");
        await sendResultsEmail({
          apiKey: RESEND_API_KEY,
          from: EMAIL_FROM,
          to: storedConfig.email,
          results: allResults,
          searchLabel: routeLabels,
        });
      } else if (errors.length > 0) {
        await sendStatusEmail({
          apiKey: RESEND_API_KEY,
          from: EMAIL_FROM,
          to: storedConfig.email,
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
};
