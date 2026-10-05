// Tiene traccia, per ogni combinazione tratta+date (indipendentemente da
// fonte/scali), del prezzo più economico trovato nell'ultima esecuzione
// SCHEDULATA (non le ricerche on-demand, per non sporcare lo storico con
// test manuali fuori ciclo). Usa un Blobs store dedicato, separato dalla
// config e dai risultati, così resta leggero e semplice da ispezionare.

function historyKey(origin, destination, departDate, returnDate) {
  return `${origin}-${destination}-${departDate}-${returnDate || "oneway"}`;
}

export async function getPreviousPrice(historyStore, origin, destination, departDate, returnDate) {
  const key = historyKey(origin, destination, departDate, returnDate);
  const entry = await historyStore.get(key, { type: "json" });
  return entry || null; // { price, recordedAt, minPrice, minRecordedAt }
}

export async function savePrice(historyStore, origin, destination, departDate, returnDate, price, previous) {
  const key = historyKey(origin, destination, departDate, returnDate);
  const isNewRecordLow = !previous || price < previous.minPrice;
  await historyStore.setJSON(key, {
    price,
    recordedAt: new Date().toISOString(),
    minPrice: isNewRecordLow ? price : previous.minPrice,
    minRecordedAt: isNewRecordLow ? new Date().toISOString() : previous.minRecordedAt,
  });
}

// Storico aggregato per tratta intera (non per singola combinazione
// aeroporto/data), usato per il grafico di andamento nel tempo. Tiene
// solo il prezzo migliore trovato a ogni esecuzione schedulata, con la
// relativa data, così il grafico resta leggibile anche su molti mesi.
const MAX_TREND_POINTS = 60;

function trendKey(routeLabel) {
  return `trend-${routeLabel}`;
}

export async function getRouteTrend(trendStore, routeLabel) {
  const points = await trendStore.get(trendKey(routeLabel), { type: "json" });
  return Array.isArray(points) ? points : [];
}

export async function appendRouteTrend(trendStore, routeLabel, price, currency) {
  const key = trendKey(routeLabel);
  const existing = await trendStore.get(key, { type: "json" });
  const points = Array.isArray(existing) ? existing : [];
  points.push({ date: new Date().toISOString(), price, currency });
  const trimmed = points.slice(-MAX_TREND_POINTS);
  await trendStore.setJSON(key, trimmed);
  return trimmed;
}
