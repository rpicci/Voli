// Wrapper Duffel (dati reali con scali, orari precisi, compagnia e numero
// di volo). Fonte primaria del progetto — Travelpayouts resta come
// eventuale fallback se DUFFEL_API_KEY non è impostata.
//
// Cerca sempre andata+ritorno insieme (round-trip). Per limitare il numero
// di chiamate, usa una data rappresentativa per ciascuna tratta (la prima
// della finestra scelta), non l'intero range: se in futuro serve scandagliare
// più date, va aggiunto un ciclo esplicito sulle combinazioni.
//
// Fasce orarie: "partenza" si applica al decollo dell'andata, "arrivo" si
// applica all'atterraggio del ritorno (quando rientri a casa) — non ai voli
// intermedi.

const BASE_URL = "https://api.duffel.com/air/offer_requests";

export async function searchFlights({
  apiKey,
  origin,
  destination,
  departDateFrom,
  returnDateFrom,
  maxStopsOutbound,
  maxStopsReturn,
  departTimeFrom,
  departTimeTo,
  arriveTimeFrom,
  arriveTimeTo,
}) {
  const slices = [{ origin, destination, departure_date: departDateFrom }];
  if (returnDateFrom) {
    slices.push({ origin: destination, destination: origin, departure_date: returnDateFrom });
  }

  const body = {
    data: {
      slices,
      passengers: [{ type: "adult" }],
      cabin_class: "economy",
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
    const outboundSlice = offer.slices?.[0];
    const returnSlice = offer.slices?.[1] || null;
    if (!outboundSlice) continue;

    const outFirstSeg = outboundSlice.segments?.[0];
    const outLastSeg = outboundSlice.segments?.[outboundSlice.segments.length - 1];
    if (!outFirstSeg || !outLastSeg) continue;

    // Filtro orario di partenza: decollo dell'andata
    if (!inTimeWindow(outFirstSeg.departing_at, departTimeFrom, departTimeTo)) continue;

    const outStops = outboundSlice.segments.length - 1;
    if (maxStopsOutbound != null && outStops > maxStopsOutbound) continue;

    let returnFirstSeg = null;
    let returnLastSeg = null;
    let returnStops = null;

    if (returnSlice) {
      returnFirstSeg = returnSlice.segments?.[0];
      returnLastSeg = returnSlice.segments?.[returnSlice.segments.length - 1];
      if (!returnFirstSeg || !returnLastSeg) continue;

      // Filtro orario di arrivo: atterraggio del ritorno (rientro a casa)
      if (!inTimeWindow(returnLastSeg.arriving_at, arriveTimeFrom, arriveTimeTo)) continue;

      returnStops = returnSlice.segments.length - 1;
      if (maxStopsReturn != null && returnStops > maxStopsReturn) continue;
    }

    results.push({
      origin,
      destination,
      price: parseFloat(offer.total_amount),
      currency: offer.total_currency,
      departDate: outFirstSeg.departing_at.slice(0, 10),
      departTime: outFirstSeg.departing_at.slice(11, 16),
      arriveTime: outLastSeg.arriving_at.slice(11, 16),
      returnDate: returnFirstSeg ? returnFirstSeg.departing_at.slice(0, 10) : null,
      returnArriveTime: returnLastSeg ? returnLastSeg.arriving_at.slice(11, 16) : null,
      stops: outStops,
      returnStops,
      airline: outFirstSeg.marketing_carrier?.name || outFirstSeg.marketing_carrier?.iata_code || null,
      flightNumber: outFirstSeg.marketing_carrier_flight_number
        ? `${outFirstSeg.marketing_carrier?.iata_code || ""}${outFirstSeg.marketing_carrier_flight_number}`
        : null,
      returnAirline: returnFirstSeg
        ? returnFirstSeg.marketing_carrier?.name || returnFirstSeg.marketing_carrier?.iata_code || null
        : null,
      returnFlightNumber: returnFirstSeg?.marketing_carrier_flight_number
        ? `${returnFirstSeg.marketing_carrier?.iata_code || ""}${returnFirstSeg.marketing_carrier_flight_number}`
        : null,
      bookingUrl: null,
      source: "duffel",
    });
  }

  return results;
}
