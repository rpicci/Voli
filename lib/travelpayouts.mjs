// Wrapper per la Travelpayouts Data API (prezzi aggregati/cache, gratuita).
// LIMITE: prezzo più basso trovato in cache per la coppia origine-destinazione,
// NON una ricerca live con orari e scali esatti. Filtro scali "best effort".
//
// Formato reale della risposta (verificato sulla documentazione ufficiale):
// { success: true, data: { "<DEST>": { "0": { price, transfers, airline,
//   flight_number, departure_at: "2026-08-01T06:35:00Z", return_at, expires_at } } } }

const BASE_URL = "https://api.travelpayouts.com/v1/prices/cheap";

export async function searchCheapFlights({
  token,
  origin,
  destination,
  departDateFrom,
  departDateTo,
  maxStops,
  currency = "EUR",
}) {
  const monthParam = (departDateFrom || "").slice(0, 7);

  const url = new URL(BASE_URL);
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  if (monthParam) url.searchParams.set("depart_date", monthParam);
  url.searchParams.set("currency", currency);
  url.searchParams.set("token", token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Travelpayouts error ${res.status} per ${origin}->${destination}: ${await res.text()}`
    );
  }

  const json = await res.json();
  if (!json.success || !json.data) return [];

  const routeData = json.data[destination];
  if (!routeData) return [];

  const results = [];
  for (const [, offer] of Object.entries(routeData)) {
    if (!offer || !offer.departure_at) continue;

    const departDate = offer.departure_at.slice(0, 10);
    const returnDate = offer.return_at ? offer.return_at.slice(0, 10) : null;

    // Filtro range date (confronto stringhe YYYY-MM-DD funziona correttamente)
    if (departDateFrom && departDate < departDateFrom) continue;
    if (departDateTo && departDate > departDateTo) continue;

    // Filtro scali (campo corretto: "transfers")
    if (
      typeof offer.transfers === "number" &&
      maxStops != null &&
      offer.transfers > maxStops
    ) {
      continue;
    }

    results.push({
      origin,
      destination,
      price: offer.price,
      currency,
      departDate,
      departTime: offer.departure_at.slice(11, 16),
      returnDate,
      stops: offer.transfers ?? null,
      airline: offer.airline || null,
      bookingUrl: offer.link
        ? `https://www.aviasales.com${offer.link}`
        : `https://www.aviasales.com/search/${origin}${departDate.replace(/-/g, "")}${destination}`,
      source: "travelpayouts",
    });
  }

  return results;
}
