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
import { convertToEur } from "./exchangeRates.mjs";

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
  eurRates = null,
}) {
  const isRoundTrip = !!returnDateFrom;
  const endpoint = isRoundTrip ? "search-roundtrip" : "search-oneway";

  const url = new URL(`https://${HOST}/flights/v2/${endpoint}`);
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

  // Log dedicato ai soli campi di prezzo/valuta del primo volo (non
  // troncato): il dump generale sopra si tronca prima di arrivarci.
  if (offers[0]) {
    console.log(
      `[booking DEBUG prezzo/valuta ${origin}->${destination}] ` +
        JSON.stringify({
          price: offers[0].price,
          priceBreakdown: offers[0].priceBreakdown,
          totalPrice: offers[0].totalPrice,
          currencyCode: offers[0].currencyCode,
          currency: offers[0].currency,
        })
    );
  }

  const results = [];
  for (const offer of offers) {
    const segmentsOut = offer.segments?.[0] || offer.legs?.[0] || offer.itineraries?.[0] || offer;
    const legsOut = segmentsOut.legs || segmentsOut.segments || [segmentsOut];

    const segmentsRet = isRoundTrip ? offer.segments?.[1] || offer.legs?.[1] || offer.itineraries?.[1] : null;
    const legsRet = segmentsRet ? segmentsRet.legs || segmentsRet.segments || [segmentsRet] : null;

    // Il prezzo è diviso in units (parte intera) e nanos (decimali, es.
    // 540000000 = ,54): vanno combinati. La valuta reale restituita
    // dall'API va usata così com'è, non assunta a priori (non esiste un
    // parametro "currency" su questo endpoint per richiederne una specifica).
    const priceTotal = offer.priceBreakdown?.total;
    const price =
      priceTotal != null
        ? priceTotal.units + (priceTotal.nanos || 0) / 1e9
        : offer.price?.total ?? offer.price?.amount ?? offer.totalPrice ?? offer.price ?? null;
    if (price == null) continue;
    const actualCurrency = priceTotal?.currencyCode || currency;

    // Se abbiamo i tassi di cambio, convertiamo in EUR. I prezzi
    // dell'API sono probabilmente già una conversione automatica dalla
    // valuta reale della compagnia (spesso USD/CAD anche per rotte
    // europee) — questa è quindi una seconda conversione approssimata,
    // non un valore esatto al centesimo, ma molto più aderente alla
    // realtà che lasciarlo in una valuta non EUR senza avviso.
    const { amount: priceInEur, converted } = convertToEur(price, actualCurrency, eurRates);
    const finalPrice = converted ? priceInEur : price;
    const finalCurrency = converted ? "EUR" : actualCurrency;

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
      price: Math.round(finalPrice * 100) / 100,
      currency: finalCurrency,
      originalPrice: converted ? Math.round(price * 100) / 100 : null,
      originalCurrency: converted ? actualCurrency : null,
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
      note: converted
        ? "dati non ufficiali (Booking.com via RapidAPI); prezzo convertito in EUR dal cambio del giorno, approssimato (possibile doppia conversione), non esatto al centesimo"
        : actualCurrency !== "EUR"
          ? `dati non ufficiali (Booking.com via RapidAPI); prezzo in ${actualCurrency}, non EUR — conversione non riuscita, converti a mano prima di confrontare`
          : "dati non ufficiali (Booking.com via RapidAPI), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
