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

  const required = [
    "originAirports",
    "destinationAirports",
    "departDateFrom",
    "departDateTo",
    "email",
    "attemptsPerDay",
  ];
  const missing = required.filter((k) => !config[k] || config[k].length === 0);
  if (missing.length) {
    return new Response(
      JSON.stringify({ error: `Campi mancanti: ${missing.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Date di rientro obbligatorie solo se non è una ricerca "sola andata"
  if (config.returnDateFrom && !config.returnDateTo) {
    return new Response(
      JSON.stringify({ error: "Manca la fine della finestra data di rientro" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (typeof config.active !== "boolean") config.active = true;

  const store = getStore("flight-watch-config");
  await store.setJSON("config", config);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
