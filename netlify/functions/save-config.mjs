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

  if (typeof config.active !== "boolean") config.active = true;

  const store = getStore("flight-watch-config");
  await store.setJSON("config", config);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
