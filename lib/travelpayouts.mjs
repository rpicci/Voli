// Wrapper per la Travelpayouts Data API (Aviasales), gratuita.
// LIMITE: prezzo più basso trovato in cache nelle ultime 48h di ricerche di
// altri utenti Aviasales/Jetradar, NON una ricerca live con orari esatti.
// VANTAGGIO rispetto a Duffel: copre anche compagnie low-cost come Ryanair
// e Wizz Air, che Duffel non ha nel proprio inventario.

import { buildSkyscannerUrl } from "./skyscannerLink.mjs";
//
// Formato reale della risposta:
// { success: true, data: { "<DEST>": { "0": { price, transfers, airline,
//   flight_number, departure_at: "2026-08-01T06:35:00Z", return_at, link } } } }

const BASE_URL = "https://api.travelpayouts.com/v1/prices/cheap";

export async function searchCheapFlights({
  token,
  origin,
  destination,
  departDateFrom,
  departDateTo,
  returnDateFrom,
  returnDateTo,
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

    if (departDateFrom && departDate < departDateFrom) continue;
    if (departDateTo && departDate > departDateTo) continue;

    if (returnDate) {
      if (returnDateFrom && returnDate < returnDateFrom) continue;
      if (returnDateTo && returnDate > returnDateTo) continue;
    }

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
      flightNumber: offer.flight_number ? `${offer.airline || ""}${offer.flight_number}` : null,
      bookingUrl: buildSkyscannerUrl({
        origin,
        destination,
        departDate,
        returnDate,
        maxStopsOutbound: maxStops,
      }),
      source: "travelpayouts",
      note: "dati in cache (fino a 48h), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
