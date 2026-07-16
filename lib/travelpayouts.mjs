// Wrapper per la Travelpayouts Data API (prezzi aggregati/cache, gratuita).
// Doc: https://travelpayouts.github.io/slate/#flight_data
//
// LIMITE IMPORTANTE: questa API restituisce il prezzo più basso trovato in
// cache per la coppia origine-destinazione (eventualmente per mese), NON una
// ricerca live con orari e scali esatti. Il filtro su scali/orari qui sotto
// è quindi "best effort": scartiamo solo se l'API dichiara esplicitamente
// più scali di quelli ammessi; se il dato manca, il volo viene comunque
// incluso (va verificato a mano dal link di prenotazione).

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
  // L'endpoint v1/prices/cheap accetta un singolo mese come depart_date
  // (formato YYYY-MM). Interroghiamo il mese di inizio del range richiesto.
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
    if (!offer || !offer.depart_date) continue;

    // Filtro range date
    if (departDateFrom && offer.depart_date < departDateFrom) continue;
    if (departDateTo && offer.depart_date > departDateTo) continue;

    // Filtro scali (se il dato è presente)
    if (
      typeof offer.number_of_changes === "number" &&
      maxStops != null &&
      offer.number_of_changes > maxStops
    ) {
      continue;
    }

    results.push({
      origin,
      destination,
      price: offer.price,
      currency,
      departDate: offer.depart_date,
      returnDate: offer.return_date || null,
      stops: offer.number_of_changes ?? null,
      airline: offer.airline || null,
      bookingUrl: `https://www.aviasales.com/search/${origin}${(offer.depart_date || "").replace(
        /-/g,
        ""
      )}${destination}`,
      source: "travelpayouts",
    });
  }

  return results;
}
