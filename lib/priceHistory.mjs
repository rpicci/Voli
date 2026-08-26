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
