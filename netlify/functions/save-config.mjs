import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let config;
  try {
    config = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON non valido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const required = ["routes", "email", "attemptsPerDay"];
  const missing = required.filter((k) => !config[k] || config[k].length === 0);
  if (missing.length) {
    return new Response(
      JSON.stringify({ error: `Campi mancanti: ${missing.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!Array.isArray(config.routes) || config.routes.length === 0 || config.routes.length > 3) {
    return new Response(
      JSON.stringify({ error: "Serve almeno 1 e al massimo 3 tratte monitorate" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  for (const [i, route] of config.routes.entries()) {
    const routeRequired = ["originAirports", "destinationAirports", "dateRangeFrom", "dateRangeTo"];
    const routeMissing = routeRequired.filter((k) => !route[k] || route[k].length === 0);
    if (routeMissing.length) {
      return new Response(
        JSON.stringify({ error: `Tratta ${i + 1}: campi mancanti ${routeMissing.join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const store = getStore("flight-watch-config");

  // Il flag attivo/fermo è di competenza esclusiva del bottone dedicato
  // (toggle-active): "Salva configurazione" non deve mai poterlo
  // sovrascrivere per sbaglio. Se esiste già una configurazione salvata,
  // ne preserviamo l'"active" attuale; solo al primissimo salvataggio (nessuna
  // configurazione precedente) partiamo attivi di default.
  const existing = await store.get("config", { type: "json" });
  config.active = existing && typeof existing.active === "boolean" ? existing.active : true;

  // lastRunSlotKey non arriva dal form (non è un campo che l'utente
  // compila): va preservato esplicitamente, altrimenti ogni salvataggio
  // lo cancella e lo scheduler perde traccia dell'ultimo slot già eseguito.
  if (existing && existing.lastRunSlotKey) {
    config.lastRunSlotKey = existing.lastRunSlotKey;
  }

  await store.setJSON("config", config);

  return new Response(JSON.stringify({ ok: true, active: config.active }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
};
