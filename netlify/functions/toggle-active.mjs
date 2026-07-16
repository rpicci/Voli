import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { active } = await req.json();
  const store = getStore("flight-watch-config");
  const config = (await store.get("config", { type: "json" })) || {};

  config.active = !!active;
  await store.setJSON("config", config);

  return new Response(JSON.stringify({ ok: true, active: config.active }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
