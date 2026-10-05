import { getStore } from "@netlify/blobs";
import { getRouteTrend } from "../../lib/priceHistory.mjs";

// Espone, per ogni tratta attualmente configurata, la serie storica di
// prezzi migliori rilevati alle esecuzioni schedulate (vedi
// appendRouteTrend in lib/priceHistory.mjs). Usata dalla pagina/sezione
// di andamento nel tempo in public/index.html.
export default async () => {
  try {
    const configStore = getStore({ name: "flight-watch-config", consistency: "strong" });
    const trendStore = getStore("flight-watch-route-trend");

    const storedConfig = (await configStore.get("config", { type: "json" })) || {};
    const routes = Array.isArray(storedConfig.routes) ? storedConfig.routes.slice(0, 5) : [];

    const routeHistories = await Promise.all(
      routes.map(async (route) => {
        const label = `${route.originAirports.join("/")} → ${route.destinationAirports.join("/")}`;
        const points = await getRouteTrend(trendStore, label);
        return { label, points };
      })
    );

    return new Response(JSON.stringify({ routes: routeHistories }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
