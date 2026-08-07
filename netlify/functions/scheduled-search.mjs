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
  if (!config) {
    console.log("[scheduled-search] Nessuna configurazione salvata.");
    return new Response("Nessuna configurazione", { status: 200 });
  }

  if (!config.active) {
    console.log("[scheduled-search] Ricerche disattivate (flag stop).");
    return new Response("Ricerche disattivate (flag stop)", { status: 200 });
  }

  const { due, currentSlotKey, slots } = isDueNow(config.attemptsPerDay, config.lastRunSlotKey, config.startHour);
  console.log(`[scheduled-search] due=${due} currentSlotKey=${currentSlotKey} slots=[${slots.join(",")}] lastRunSlotKey=${config.lastRunSlotKey}`);

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
  console.log(`[scheduled-search] Slot ${currentSlotKey} marcato come in corso.`);

  // Attiviamo la funzione background e non aspettiamo che finisca (può
  // richiedere diversi minuti con più tratte/date/fonti) — le basta
  // ricevere la richiesta per continuare a girare per conto suo.
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const targetUrl = `${siteUrl}/.netlify/functions/run-search-background`;
  console.log(`[scheduled-search] siteUrl=${siteUrl || "(VUOTO! process.env.URL non impostata)"} targetUrl=${targetUrl}`);

  try {
    const res = await fetch(targetUrl, { method: "POST" });
    console.log(`[scheduled-search] Chiamata a run-search-background completata, status=${res.status}`);
  } catch (err) {
    console.log(`[scheduled-search] ERRORE nell'attivare run-search-background: ${err.message}`);
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
