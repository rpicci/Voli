// Wrapper opzionale per Duffel (dati reali con scali e orari precisi).
// Attivo solo se DUFFEL_API_KEY è impostata nelle env vars di Netlify.
// Doc: https://duffel.com/docs/api/offer-requests/create-offer-request

const BASE_URL = "https://api.duffel.com/air/offer_requests";

export async function searchFlights({
  apiKey,
  origin,
  destination,
  departDateFrom,
  departDateTo,
  maxStops,
  departTimeFrom,
  departTimeTo,
  arriveTimeFrom,
  arriveTimeTo,
}) {
  const body = {
    data: {
      slices: [
        {
          origin,
          destination,
          departure_date: departDateFrom, // Duffel richiede una data singola per slice
        },
      ],
      passengers: [{ type: "adult" }],
      cabin_class: "economy",
      max_connections: maxStops != null ? maxStops : undefined,
    },
  };

  const res = await fetch(`${BASE_URL}?return_offers=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Duffel-Version": "v2",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Duffel error ${res.status} per ${origin}->${destination}: ${await res.text()}`
    );
  }

  const json = await res.json();
  const offers = json.data?.offers || [];

  const inTimeWindow = (isoTime, from, to) => {
    if (!from && !to) return true;
    const hhmm = isoTime.slice(11, 16);
    if (from && hhmm < from) return false;
    if (to && hhmm > to) return false;
    return true;
  };

  const results = [];
  for (const offer of offers) {
    const slice = offer.slices?.[0];
    if (!slice) continue;
    const firstSeg = slice.segments?.[0];
    const lastSeg = slice.segments?.[slice.segments.length - 1];
    if (!firstSeg || !lastSeg) continue;

    if (!inTimeWindow(firstSeg.departing_at, departTimeFrom, departTimeTo)) continue;
    if (!inTimeWindow(lastSeg.arriving_at, arriveTimeFrom, arriveTimeTo)) continue;

    const stops = slice.segments.length - 1;
    if (maxStops != null && stops > maxStops) continue;

    results.push({
      origin,
      destination,
      price: parseFloat(offer.total_amount),
      currency: offer.total_currency,
      departDate: firstSeg.departing_at.slice(0, 10),
      departTime: firstSeg.departing_at.slice(11, 16),
      arriveTime: lastSeg.arriving_at.slice(11, 16),
      stops,
      airline: firstSeg.marketing_carrier?.name || null,
      bookingUrl: null, // Duffel non fornisce link OTA diretti: booking va fatto via API
      source: "duffel",
    });
  }

  return results;
}
