import { getStore } from "@netlify/blobs";
import { isDueNow } from "../../lib/scheduling.mjs";

// Funzione SCHEDULATA (limite fisso di 30 secondi su Netlify, non
// aumentabile). Fa solo il controllo "è uno slot valido?" e, se sì,
// attiva la funzione background run-search-background.mjs che fa tutto
// il lavoro pesante con un budget di 15 minuti — molto più di quanto
// serva anche con più tratte, più date e più fonti.
export default async () => {
  const configStore = getStore("flight-watch-config");

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

  // Segniamo subito lo slot come "in corso", prima di passare il lavoro
  // alla funzione background — stessa protezione anti-doppia-esecuzione
  // di prima, solo spostata qui perché questa è la parte veloce.
  config.lastRunSlotKey = currentSlotKey;
  await configStore.setJSON("config", config);

  // Attiviamo la funzione background e non aspettiamo che finisca (può
  // richiedere diversi minuti con più tratte/date/fonti) — le basta
  // ricevere la richiesta per continuare a girare per conto suo.
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  try {
    await fetch(`${siteUrl}/.netlify/functions/run-search-background`, { method: "POST" });
  } catch (err) {
    return new Response(`Errore nell'attivare la ricerca in background: ${err.message}`, { status: 200 });
  }

  return new Response(
    `Slot ${currentSlotKey} confermato, ricerca avviata in background.`,
    { status: 200 }
  );
};

export const config = {
  schedule: "0 * * * *",
};
