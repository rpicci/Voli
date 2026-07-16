import { getStore } from "@netlify/blobs";

export default async () => {
  const configStore = getStore("flight-watch-config");
  const resultsStore = getStore("flight-watch-results");

  const config = (await configStore.get("config", { type: "json" })) || null;
  const lastRun = (await resultsStore.get("last-run", { type: "json" })) || null;

  return new Response(JSON.stringify({ config, lastRun }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
