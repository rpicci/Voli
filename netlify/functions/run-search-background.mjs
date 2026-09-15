import { getStore } from "@netlify/blobs";
import { generateDatePairs } from "../../lib/dateGeneration.mjs";
import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { searchGoogleFlights } from "../../lib/googleflights.mjs";
import { searchSkyscannerFlights } from "../../lib/skyscanner.mjs";
import { searchBookingFlights } from "../../lib/booking.mjs";
import { getEurRates } from "../../lib/exchangeRates.mjs";
import { sendResultsEmail, sendStatusEmail } from "../../lib/email.mjs";
import { getPreviousPrice, savePrice } from "../../lib/priceHistory.mjs";
import { sendPushNotification } from "../../lib/webPush.mjs";

// Funzione BACKGROUND (fino a 15 minuti di esecuzione, contro i 30 secondi
// delle funzioni schedulate). Fa tutto il lavoro pesante: viene attivata da
// scheduled-search.mjs solo dopo che quest'ultima ha già verificato che è
// uno slot valido e ha "marcato" lo slot come in corso — qui non rifacciamo
// quei controlli, ci fidiamo del chiamante.
export const config = {
  background: true,
};

// Un errore transitorio (timeout, hiccup di rete) su una singola fonte
// non deve far perdere un intero risultato: un solo retry con una breve
// pausa risolve la maggior parte dei casi senza rallentare troppo.
async function withRetry(fn, retries = 1, delayMs = 1500) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}

// Per ogni tratta monitorata (non per singola combinazione aeroporto/data)
// individua il prezzo più basso trovato in questa esecuzione, insieme
// all'eventuale variazione rispetto all'ultima esecuzione schedulata
// (già calcolata più sopra e attaccata al singolo risultato).
// Formato compatto gg/mm per stare dentro lo spazio ristretto di una
// notifica push. Se il formato della data non è quello atteso (YYYY-MM-DD)
// restituiamo la stringa originale invece di rischiare di troncarla male.
function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [, month, day] = parts;
  return `${day}/${month}`;
}

function buildRouteSummaries(routes, allResults) {
  return routes
    .map((route, idx) => {
      const routeResults = allResults.filter((r) => r.routeIndex === idx);
      if (routeResults.length === 0) return null;
      const cheapest = routeResults.reduce((min, r) => (r.price < min.price ? r : min), routeResults[0]);
      return {
        label: `${route.originAirports.join("/")} → ${route.destinationAirports.join("/")}`,
        price: cheapest.price,
        currency: cheapest.currency,
        delta: cheapest.priceChangeVsLastRun,
        isNewRecordLow: cheapest.isNewRecordLow,
        departDate: cheapest.departDate,
        returnDate: cheapest.returnDate,
      };
    })
    .filter(Boolean);
}

// Una riga per tratta: prezzo migliore + variazione se disponibile.
// "Nuovo minimo" ha priorità sulla variazione numerica perché è
// l'informazione più utile in assoluto quando capita.
function formatRouteLine(summary) {
  const priceStr = summary.currency === "EUR" ? `${summary.price}€` : `${summary.price} ${summary.currency}`;
  let variation = "";
  if (summary.isNewRecordLow) {
    variation = " — nuovo minimo!";
  } else if (typeof summary.delta === "number") {
    if (summary.delta < 0) variation = ` (↓${Math.abs(summary.delta)}€)`;
    else if (summary.delta > 0) variation = ` (↑${summary.delta}€)`;
    else variation = " (=)";
  }
  const dateStr = formatDateShort(summary.departDate) + (summary.returnDate ? `–${formatDateShort(summary.returnDate)}` : "");
  return `${summary.label} ${dateStr}: ${priceStr}${variation}`;
}

export default async () => {
  const configStore = getStore({ name: "flight-watch-config", consistency: "strong" });
  const resultsStore = getStore("flight-watch-results");
  const historyStore = getStore("flight-watch-price-history");

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
  const useSkyscanner = false; // box rimosso dal form, fonte non più esposta all'utente
  const skyscannerCache = new Map();

  const routes = Array.isArray(storedConfig.routes) ? storedConfig.routes.slice(0, 5) : [];

  const allResults = [];
  const errors = [];

  // includeGoogleFlights/includeBooking sono ora selezionabili per singola
  // tratta (non più un flag unico globale) — recuperiamo comunque il tasso
  // di cambio una sola volta in anticipo se ALMENO una tratta usa Booking.
  const anyRouteUsesBooking = routes.some((r) => r.includeBooking) && !!RAPIDAPI_KEY;
  let eurRates = null;
  if (anyRouteUsesBooking) {
    try {
      eurRates = await getEurRates(RAPIDAPI_KEY);
    } catch (err) {
      errors.push(`Booking.com exchange-rates: ${err.message}`);
    }
  }

  for (const [routeIdx, route] of routes.entries()) {
    const useGoogleFlights = !!route.includeGoogleFlights && !!RAPIDAPI_KEY;
    const useBooking = !!route.includeBooking && !!RAPIDAPI_KEY;
    const datePairs = generateDatePairs(route);

    for (const { departDate, returnDate } of datePairs) {
      for (const origin of route.originAirports) {
        for (const destination of route.destinationAirports) {
          if (origin === destination) continue;

          const countBefore = allResults.length;

          if (DUFFEL_API_KEY) {
            try {
              const r = await withRetry(() => searchFlightsDuffel({
                apiKey: DUFFEL_API_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: route.maxStopsOutbound,
                maxStopsReturn: route.maxStopsReturn,
                departTimeFrom: route.departTimeFrom,
                departTimeTo: route.departTimeTo,
                arriveTimeFrom: route.arriveTimeFrom,
                arriveTimeTo: route.arriveTimeTo,
              }));
              console.log(`[DEBUG conteggio] Duffel ${origin}->${destination} ${departDate}: ${r.length} voli`);
              allResults.push(...r);
            } catch (err) {
              errors.push(`Duffel ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (TRAVELPAYOUTS_TOKEN) {
            try {
              const r = await withRetry(() => searchCheapFlights({
                token: TRAVELPAYOUTS_TOKEN,
                origin,
                destination,
                departDateFrom: departDate,
                departDateTo: departDate,
                returnDateFrom: returnDate,
                returnDateTo: returnDate,
                maxStops: route.maxStopsOutbound,
              }));
              console.log(`[DEBUG conteggio] Travelpayouts ${origin}->${destination} ${departDate}: ${r.length} voli`);
              allResults.push(...r);
            } catch (err) {
              errors.push(`Travelpayouts ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useGoogleFlights) {
            try {
              const r = await withRetry(() => searchGoogleFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: route.maxStopsOutbound,
                maxStopsReturn: route.maxStopsReturn,
                departTimeFrom: route.departTimeFrom,
                departTimeTo: route.departTimeTo,
                arriveTimeFrom: route.arriveTimeFrom,
                arriveTimeTo: route.arriveTimeTo,
              }));
              console.log(`[DEBUG conteggio] Google Flights ${origin}->${destination} ${departDate}: ${r.length} voli`);
              allResults.push(...r);
            } catch (err) {
              errors.push(`Google Flights ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useSkyscanner) {
            try {
              const r = await withRetry(() => searchSkyscannerFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: route.maxStopsOutbound,
                maxStopsReturn: route.maxStopsReturn,
                departTimeFrom: route.departTimeFrom,
                departTimeTo: route.departTimeTo,
                arriveTimeFrom: route.arriveTimeFrom,
                arriveTimeTo: route.arriveTimeTo,
                cache: skyscannerCache,
              }));
              console.log(`[DEBUG conteggio] Skyscanner ${origin}->${destination} ${departDate}: ${r.length} voli`);
              allResults.push(...r);
            } catch (err) {
              errors.push(`Skyscanner ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          if (useBooking) {
            try {
              const r = await withRetry(() => searchBookingFlights({
                apiKey: RAPIDAPI_KEY,
                origin,
                destination,
                departDateFrom: departDate,
                returnDateFrom: returnDate,
                maxStopsOutbound: route.maxStopsOutbound,
                maxStopsReturn: route.maxStopsReturn,
                departTimeFrom: route.departTimeFrom,
                departTimeTo: route.departTimeTo,
                arriveTimeFrom: route.arriveTimeFrom,
                arriveTimeTo: route.arriveTimeTo,
                eurRates,
              }));
              console.log(`[DEBUG conteggio] Booking.com ${origin}->${destination} ${departDate}: ${r.length} voli`);
              allResults.push(...r);
            } catch (err) {
              errors.push(`Booking.com ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
          console.log(`[DEBUG conteggio] TOTALE per ${origin}->${destination} ${departDate}: ${allResults.length - countBefore} voli trovati in questa combinazione (da tutte le fonti insieme)`);

          // Confronto col prezzo più economico registrato nell'ultima
          // esecuzione schedulata per questa stessa tratta+date, a
          // prescindere da fonte/scali. Solo prezzi in EUR affidabili
          // (non quelli con conversione fallita) entrano nel confronto,
          // altrimenti un cambio di valuta sembrerebbe un'oscillazione
          // di prezzo.
          const comboAll = allResults.slice(countBefore);
          comboAll.forEach((r) => {
            r.routeIndex = routeIdx;
            r.departDate = departDate;
            r.returnDate = returnDate;
          });

          const comboResults = comboAll.filter((r) => r.currency === "EUR" && !r.conversionFailed);

          if (comboResults.length > 0) {
            const cheapestNow = Math.min(...comboResults.map((r) => r.price));
            try {
              const previous = await getPreviousPrice(historyStore, origin, destination, departDate, returnDate);
              if (previous) {
                const delta = Math.round((cheapestNow - previous.price) * 100) / 100;
                const vsRecordLow = Math.round((cheapestNow - previous.minPrice) * 100) / 100;
                for (const r of comboResults) {
                  r.priceChangeVsLastRun = delta;
                  r.previousPrice = previous.price;
                  r.recordLowPrice = previous.minPrice;
                  r.recordLowDate = previous.minRecordedAt;
                  r.isNewRecordLow = vsRecordLow <= 0;
                }
              }
              await savePrice(historyStore, origin, destination, departDate, returnDate, cheapestNow, previous);
            } catch (err) {
              console.log(`[price-history] Errore confronto/salvataggio per ${origin}->${destination} ${departDate}: ${err.message}`);
            }
          }
        }
      }
    }
  }

  allResults.sort((a, b) => a.price - b.price);

  const routeLabels = routes
    .map((r) => `${r.originAirports.join("/")} → ${r.destinationAirports.join("/")}`)
    .join(" · ");

  let emailError = null;

  if (RESEND_API_KEY && EMAIL_FROM && storedConfig.email) {
    try {
      if (allResults.length > 0) {
        await sendResultsEmail({
          apiKey: RESEND_API_KEY,
          from: EMAIL_FROM,
          to: storedConfig.email,
          results: allResults,
          searchLabel: routeLabels,
          errors,
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

  // Salviamo sempre l'ultimo batch di risultati completo (indipendentemente
  // dall'email), così la PWA può mostrarlo per intero quando l'utente apre
  // l'app dopo aver ricevuto la notifica push — che può contenere solo un
  // riassunto breve, non l'elenco completo con link e storico prezzi.
  if (allResults.length > 0) {
    await resultsStore.setJSON("last-scheduled-results", {
      generatedAt: new Date().toISOString(),
      searchLabel: routeLabels,
      results: allResults,
      errors,
    });
  }

  const pushSubscriptionStore = getStore({ name: "flight-watch-push-subscription", consistency: "strong" });
  let pushResult = { sent: false, reason: "Nessun risultato da notificare" };
  if (allResults.length > 0) {
    const routeSummaries = buildRouteSummaries(routes, allResults);
    const body = routeSummaries.length > 0
      ? routeSummaries.map(formatRouteLine).join("\n")
      : `Il più economico: ${allResults[0].price} ${allResults[0].currency} (${allResults[0].origin} → ${allResults[0].destination})`;
    pushResult = await sendPushNotification(pushSubscriptionStore, {
      title: `✈️ Flight Watch — ${routeSummaries.length || 1} tratt${(routeSummaries.length || 1) === 1 ? "a" : "e"} aggiornat${(routeSummaries.length || 1) === 1 ? "a" : "e"}`,
      body,
      url: "/",
    });
  } else if (errors.length > 0) {
    pushResult = await sendPushNotification(pushSubscriptionStore, {
      title: "⚠️ Flight Watch — errore nella ricerca",
      body: `La ricerca di oggi ha incontrato ${errors.length} errore/i.`,
      url: "/",
    });
  }

  await resultsStore.setJSON("last-run", {
    ranAt: new Date().toISOString(),
    slotKey: currentSlotKey,
    resultsCount: allResults.length,
    errors,
    emailError,
    pushResult,
  });
};
