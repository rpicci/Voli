// Wrapper per l'API non ufficiale "Booking.com" (booking-com18, RapidAPI) —
// sezione Flights v2. A differenza di Skyscanner, accetta direttamente i
// codici IATA per departId/arrivalId, senza passaggio di risoluzione
// aeroporto separato: una ricerca costa quindi una sola chiamata.
//
// LIMITI:
//   - quota gratuita 500 richieste/mese (molto più generosa delle altre)
//   - le fasce orarie della API usano bucket fissi (es. "00-05"), non
//     orari liberi: il filtro preciso sulle fasce orarie configurate viene
//     quindi applicato DOPO aver ricevuto i risultati, non nella richiesta
//   - non è stato possibile testare con una chiamata reale: la struttura
//     della risposta (nomi dei campi per prezzo, voli, orari) è dedotta
//     dai parametri di richiesta documentati, non da un esempio di risposta
//     reale — il log diagnostico sotto mostra la struttura vera se il
//     parsing risulta vuoto o sbagliato al primo test.

const HOST = "booking-com18.p.rapidapi.com";

import { buildSkyscannerUrl } from "./skyscannerLink.mjs";

function headers(apiKey) {
  return {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": HOST,
  };
}

function inTimeWindow(rawTime, from, to) {
  if (!rawTime) return true;
  if (!from && !to) return true;
  const timePart = rawTime.includes("T") ? rawTime.split("T")[1] : rawTime.split(" ")[1];
  if (!timePart) return true;
  const hhmm = timePart.slice(0, 5);
  if (from && hhmm < from) return false;
  if (to && hhmm > to) return false;
  return true;
}

export async function searchBookingFlights({
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
  currency = "EUR",
}) {
  const isRoundTrip = !!returnDateFrom;
  const endpoint = isRoundTrip ? "search-roundtrip" : "search-oneway";

  const url = new URL(`https://${HOST}/api/v1/flights/v2/${endpoint}`);
  url.searchParams.set("departId", origin);
  url.searchParams.set("arrivalId", destination);
  url.searchParams.set("departDate", departDateFrom);
  if (isRoundTrip) url.searchParams.set("returnDate", returnDateFrom);
  url.searchParams.set("adults", "1");
  url.searchParams.set("cabinClass", "ECONOMY");
  url.searchParams.set("sort", "CHEAPEST");
  url.searchParams.set("languageCode", "en-us");
  url.searchParams.set("currency", currency);

  // Voli diretti: parametro booleano dedicato, più affidabile del filtro
  // "stops" generico.
  if (maxStopsOutbound === 0) {
    url.searchParams.set("directFlightsOnly", "true");
  } else if (maxStopsOutbound != null) {
    url.searchParams.set("stops", String(maxStopsOutbound));
  }

  const res = await fetch(url.toString(), { headers: headers(apiKey) });
  if (!res.ok) {
    throw new Error(`Booking.com ${endpoint} error ${res.status} per ${origin}->${destination}: ${await res.text()}`);
  }

  const json = await res.json();

  // Percorsi plausibili per l'elenco voli, in ordine di probabilità.
  const offers =
    json?.data?.flightOffers ||
    json?.data?.flights ||
    json?.data?.results ||
    (Array.isArray(json?.data) ? json.data : null) ||
    [];

  if (!Array.isArray(offers) || offers.length === 0) {
    const topLevelKeys = Object.keys(json || {}).join(", ") || "(nessuna chiave)";
    const dataKeys = json?.data && typeof json.data === "object" ? Object.keys(json.data).join(", ") : "(assente)";
    const snippet = JSON.stringify(json).slice(0, 800);
    console.log(
      `[booking DEBUG nessun volo ${origin}->${destination}] chiavi json: [${topLevelKeys}] ` +
        `chiavi json.data: [${dataKeys}] estratto: ${snippet}`
    );
    return [];
  }

  console.log(
    `[booking DEBUG ${origin}->${destination}] primi 3 voli grezzi: ` +
      JSON.stringify(offers.slice(0, 3)).slice(0, 1200)
  );

  const results = [];
  for (const offer of offers) {
    const segmentsOut = offer.segments?.[0] || offer.legs?.[0] || offer.itineraries?.[0] || offer;
    const legsOut = segmentsOut.legs || segmentsOut.segments || [segmentsOut];

    const segmentsRet = isRoundTrip ? offer.segments?.[1] || offer.legs?.[1] || offer.itineraries?.[1] : null;
    const legsRet = segmentsRet ? segmentsRet.legs || segmentsRet.segments || [segmentsRet] : null;

    const price =
      offer.priceBreakdown?.total?.units ??
      offer.price?.total ??
      offer.price?.amount ??
      offer.totalPrice ??
      offer.price ??
      null;
    if (price == null) continue;

    const firstLegOut = legsOut[0] || {};
    const lastLegOut = legsOut[legsOut.length - 1] || {};
    const departTime = firstLegOut.departureTime || firstLegOut.departure || offer.departureTime || null;
    const arriveTime = lastLegOut.arrivalTime || lastLegOut.arrival || offer.arrivalTime || null;

    const outStops = Math.max(0, legsOut.length - 1);
    if (maxStopsOutbound != null && outStops > maxStopsOutbound) continue;
    if (!inTimeWindow(departTime, departTimeFrom, departTimeTo)) continue;

    let returnStops = null;
    let returnDepartTime = null;
    let returnArriveTime = null;
    if (legsRet) {
      const firstLegRet = legsRet[0] || {};
      const lastLegRet = legsRet[legsRet.length - 1] || {};
      returnDepartTime = firstLegRet.departureTime || firstLegRet.departure || null;
      returnArriveTime = lastLegRet.arrivalTime || lastLegRet.arrival || null;
      returnStops = Math.max(0, legsRet.length - 1);
      if (maxStopsReturn != null && returnStops > maxStopsReturn) continue;
      if (!inTimeWindow(returnDepartTime, arriveTimeFrom, arriveTimeTo)) continue;
    } else if (!isRoundTrip && !inTimeWindow(arriveTime, arriveTimeFrom, arriveTimeTo)) {
      continue;
    }

    const airlineOut = firstLegOut.carrierName || firstLegOut.airline || offer.airline?.name || null;
    const flightNumOut = firstLegOut.flightNumber || firstLegOut.flightNo || null;
    const airlineRet = legsRet ? legsRet[0]?.carrierName || legsRet[0]?.airline || null : null;
    const flightNumRet = legsRet ? legsRet[0]?.flightNumber || legsRet[0]?.flightNo || null : null;

    results.push({
      origin,
      destination,
      price: typeof price === "string" ? parseFloat(price.replace(/[^\d.]/g, "")) : price,
      currency,
      departDate: departTime ? departTime.slice(0, 10) : departDateFrom,
      departTime: departTime ? departTime.slice(11, 16) : null,
      arriveTime: arriveTime ? arriveTime.slice(11, 16) : null,
      returnDate: legsRet ? (returnDepartTime ? returnDepartTime.slice(0, 10) : returnDateFrom) : null,
      returnDepartTime: returnDepartTime ? returnDepartTime.slice(11, 16) : null,
      returnArriveTime: returnArriveTime ? returnArriveTime.slice(11, 16) : null,
      stops: outStops,
      returnStops,
      airline: airlineOut,
      flightNumber: flightNumOut,
      returnAirline: airlineRet,
      returnFlightNumber: flightNumRet,
      bookingUrl: buildSkyscannerUrl({
        origin,
        destination,
        departDate: departDateFrom,
        returnDate: returnDateFrom,
        maxStopsOutbound,
      }),
      source: "booking",
      note: "dati non ufficiali (Booking.com via RapidAPI), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
