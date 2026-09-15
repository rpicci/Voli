import { getStore } from "@netlify/blobs";

export default async () => {
  const store = getStore({ name: "flight-watch-results", consistency: "strong" });
  const lastResults = await store.get("last-scheduled-results", { type: "json" });

  return new Response(JSON.stringify({ lastResults: lastResults || null }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
};
