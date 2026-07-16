import { getStore } from "@netlify/blobs";
import { isDueNow } from "../../lib/scheduling.mjs";
import { searchCheapFlights } from "../../lib/travelpayouts.mjs";
import { searchFlights as searchFlightsDuffel } from "../../lib/duffel.mjs";
import { sendResultsEmail, sendStatusEmail } from "../../lib/email.mjs";

export default async () => {
  const configStore = getStore("flight-watch-config");
  const resultsStore = getStore("flight-watch-results");

  const config = await configStore.get("config", { type: "json" });

  // Nessuna configurazione salvata ancora: non fare nulla
  if (!config) return new Response("Nessuna configurazione", { status: 200 });

  // FLAG DI STOP: se disattivato, la funzione esce subito senza cercare
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
  const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY; // opzionale
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM; // es. "Flight Watch <alert@tuodominio.it>"

  const origins = config.originAirports;
  const destinations = config.destinationAirports;

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
            departDateFrom: config.departDateFrom,
            departDateTo: config.departDateTo,
            maxStops: config.maxStopsOutbound,
            departTimeFrom: config.departTimeFrom,
            departTimeTo: config.departTimeTo,
            arriveTimeFrom: config.arriveTimeFrom,
            arriveTimeTo: config.arriveTimeTo,
          });
          allResults.push(...r);
        } else {
          const r = await searchCheapFlights({
            token: TRAVELPAYOUTS_TOKEN,
            origin,
            destination,
            departDateFrom: config.departDateFrom,
            departDateTo: config.departDateTo,
            maxStops: config.maxStopsOutbound,
          });
          allResults.push(...r);
        }
      } catch (err) {
        errors.push(`${origin}->${destination}: ${err.message}`);
      }

      // Piccola pausa per non superare i rate limit delle API gratuite
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Salva sempre l'esito dell'esecuzione (anche se zero risultati), utile
  // per il pannello di stato nella pagina.
  await resultsStore.setJSON("last-run", {
    ranAt: new Date().toISOString(),
    slotKey: currentSlotKey,
    resultsCount: allResults.length,
    errors,
  });

  // Aggiorna lo slot eseguito per evitare doppie esecuzioni nella stessa ora
  config.lastRunSlotKey = currentSlotKey;
  await configStore.setJSON("config", config);

  if (RESEND_API_KEY && EMAIL_FROM && config.email) {
    if (allResults.length > 0) {
      await sendResultsEmail({
        apiKey: RESEND_API_KEY,
        from: EMAIL_FROM,
        to: config.email,
        results: allResults,
        searchLabel: `${origins.join("/")} → ${destinations.join("/")}`,
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
    // Se zero risultati e zero errori: nessuna email, per non essere invadenti
  }

  return new Response(
    JSON.stringify({ ok: true, found: allResults.length, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

// Gira ogni ora in punto; la funzione stessa decide, in base al numero di
// tentativi configurato, se questa è una delle ore "giuste" per cercare.
export const config = {
  schedule: "0 * * * *",
};
