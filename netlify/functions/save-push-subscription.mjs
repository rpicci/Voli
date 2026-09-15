import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const subscription = await req.json();

  if (!subscription || !subscription.endpoint) {
    return new Response(JSON.stringify({ error: "Sottoscrizione non valida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Un solo dispositivo alla volta: ogni nuova sottoscrizione sovrascrive
  // la precedente (nessuno storico, nessuna lista di dispositivi multipli).
  const store = getStore({ name: "flight-watch-push-subscription", consistency: "strong" });
  await store.setJSON("subscription", subscription);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
};
