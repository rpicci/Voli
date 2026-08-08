// Wrapper per l'API non ufficiale "Sky Scrapper" su RapidAPI — replica i
// dati di Skyscanner.com (non è un prodotto ufficiale Skyscanner). Copre
// bene le compagnie low-cost e le combinazioni "virtual interlining"
// (andata con una compagnia, ritorno con un'altra), che Duffel e spesso
// Google Flights non gestiscono.
//
// LIMITI:
//   - piano gratuito: 100 richieste/mese (ancora meno di Google Flights)
//   - richiede un passaggio preliminare per "risolvere" ogni aeroporto
//     (codice IATA -> skyId+entityId) prima di poter cercare voli, quindi
//     ogni ricerca consuma più di 1 richiesta. Le risoluzioni vengono
//     tenute in una cache condivisa per tutta la durata di un'esecuzione,
//     per non richiedere due volte lo stesso aeroporto.
//   - non è stato possibile testare con una chiamata reale (l'ambiente di
//     sviluppo non ha accesso a internet): la struttura della risposta di
//     ricerca voli è dedotta da un tutorial con codice funzionante, ma
//     potrebbe comunque richiedere aggiustamenti al primo test reale — in
//     tal caso il log diagnostico sotto mostra la risposta grezza.

const HOST = "sky-scrapper.p.rapidapi.com";

import { buildSkyscannerUrl } from "./skyscannerLink.mjs";

function headers(apiKey) {
  return {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": HOST,
  };
}

// Esegue una fetch con un tentativo di recupero automatico in caso di 429
// (limite di velocità, non di quota mensile): aspetta un attimo e riprova
// una sola volta, invece di fallire subito. Non riprova su altri errori.
async function fetchWithRetry(url, options, retries = 1, delayMs = 1200) {
  const res = await fetch(url, options);
  if (res.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetchWithRetry(url, options, retries - 1, delayMs * 2);
  }
  return res;
}

// Risolve un codice IATA (es. "FCO") nell'identificativo interno richiesto
// dall'API. Usa la cache condivisa passata dal chiamante per evitare
// richieste ripetute per lo stesso aeroporto nella stessa esecuzione.
export async function resolveSkyId({ apiKey, iataCode, cache }) {
  if (cache && cache.has(iataCode)) return cache.get(iataCode);

  const url = new URL(`https://${HOST}/api/v1/flights/searchAirport`);
  url.searchParams.set("query", iataCode);
  url.searchParams.set("locale", "en-US");

  const res = await fetchWithRetry(url.toString(), { headers: headers(apiKey) });
  if (!res.ok) {
    throw new Error(`Sky Scrapper searchAirport error ${res.status} per ${iataCode}: ${await res.text()}`);
  }

  const json = await res.json();
  const results = json?.data || [];

  // Preferiamo un risultato il cui skyId corrisponde esattamente al codice
  // IATA cercato (di solito è così per gli aeroporti); altrimenti prendiamo
  // il primo risultato utile.
  const match =
    results.find((r) => (r.skyId || "").toUpperCase() === iataCode.toUpperCase()) || results[0];

  if (!match) {
    throw new Error(`Sky Scrapper: nessun aeroporto risolto per ${iataCode}`);
  }

  const resolved = { skyId: match.skyId, entityId: match.entityId };
  if (cache) cache.set(iataCode, resolved);
  return resolved;
}

function inTimeWindow(rawTime, from, to) {
  if (!rawTime) return true;
  if (!from && !to) return true;
  // Formato atteso: ISO-like "YYYY-MM-DDTHH:MM:SS" o simile — prendiamo
  // solo la parte oraria dopo la "T" o dopo lo spazio, in modo tollerante.
  const timePart = rawTime.includes("T") ? rawTime.split("T")[1] : rawTime.split(" ")[1];
  if (!timePart) return true;
  const hhmm = timePart.slice(0, 5);
  if (from && hhmm < from) return false;
  if (to && hhmm > to) return false;
  return true;
}

export async function searchSkyscannerFlights({
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
  cache,
}) {
  const sharedCache = cache || new Map();

  // Sequenziali (non in parallelo): il piano gratuito di RapidAPI applica
  // un limite di velocità piuttosto stretto, e due chiamate simultanee lo
  // facevano scattare quasi sempre.
  const originIds = await resolveSkyId({ apiKey, iataCode: origin, cache: sharedCache });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const destinationIds = await resolveSkyId({ apiKey, iataCode: destination, cache: sharedCache });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const url = new URL(`https://${HOST}/api/v1/flights/searchFlights`);
  url.searchParams.set("originSkyId", originIds.skyId);
  url.searchParams.set("destinationSkyId", destinationIds.skyId);
  url.searchParams.set("originEntityId", originIds.entityId);
  url.searchParams.set("destinationEntityId", destinationIds.entityId);
  url.searchParams.set("date", departDateFrom);
  if (returnDateFrom) url.searchParams.set("returnDate", returnDateFrom);
  url.searchParams.set("adults", "1");
  url.searchParams.set("currency", currency);
  url.searchParams.set("market", "it-IT");

  const res = await fetchWithRetry(url.toString(), { headers: headers(apiKey) });
  if (!res.ok) {
    throw new Error(`Sky Scrapper searchFlights error ${res.status} per ${origin}->${destination}: ${await res.text()}`);
  }

  const json = await res.json();
  const itineraries = json?.data?.itineraries || json?.itineraries || [];

  if (!Array.isArray(itineraries) || itineraries.length === 0) {
    const topLevelKeys = Object.keys(json || {}).join(", ") || "(nessuna chiave)";
    const dataKeys = json?.data && typeof json.data === "object" ? Object.keys(json.data).join(", ") : "(assente)";
    const snippet = JSON.stringify(json).slice(0, 700);
    console.log(
      `[skyscanner DEBUG nessun itinerario ${origin}->${destination}] chiavi json: [${topLevelKeys}] ` +
        `chiavi json.data: [${dataKeys}] estratto: ${snippet}`
    );
    return [];
  }

  console.log(
    `[skyscanner DEBUG ${origin}->${destination}] primi 3 itinerari grezzi: ` +
      JSON.stringify(itineraries.slice(0, 3)).slice(0, 1200)
  );

  const results = [];
  for (const it of itineraries) {
    const legs = it.legs || [];
    if (!legs.length) continue;

    const outboundLeg = legs[0];
    const returnLeg = legs[1] || null;

    const price = it.price?.raw ?? it.price?.formatted ?? it.price ?? null;
    if (price == null) continue;

    const outSegments = outboundLeg.segments || outboundLeg.carriers?.marketing || [];
    const outStops = typeof outboundLeg.stopCount === "number" ? outboundLeg.stopCount : Math.max(0, outSegments.length - 1);
    if (maxStopsOutbound != null && outStops > maxStopsOutbound) continue;

    const departTime = outboundLeg.departure || null;
    const arriveTime = outboundLeg.arrival || null;
    if (!inTimeWindow(departTime, departTimeFrom, departTimeTo)) continue;

    let returnStops = null;
    let returnDepartTime = null;
    let returnArriveTime = null;
    if (returnLeg) {
      const retSegments = returnLeg.segments || returnLeg.carriers?.marketing || [];
      returnStops = typeof returnLeg.stopCount === "number" ? returnLeg.stopCount : Math.max(0, retSegments.length - 1);
      if (maxStopsReturn != null && returnStops > maxStopsReturn) continue;
      returnDepartTime = returnLeg.departure || null;
      returnArriveTime = returnLeg.arrival || null;
      if (!inTimeWindow(returnDepartTime, arriveTimeFrom, arriveTimeTo)) continue;
    } else if (!inTimeWindow(arriveTime, arriveTimeFrom, arriveTimeTo)) {
      continue;
    }

    const airlineOut = outboundLeg.carriers?.marketing?.[0]?.name || null;
    const airlineRet = returnLeg?.carriers?.marketing?.[0]?.name || null;

    results.push({
      origin,
      destination,
      price: typeof price === "string" ? parseFloat(price.replace(/[^\d.]/g, "")) : price,
      currency,
      departDate: departTime ? departTime.slice(0, 10) : departDateFrom,
      departTime: departTime ? departTime.slice(11, 16) : null,
      arriveTime: arriveTime ? arriveTime.slice(11, 16) : null,
      returnDate: returnLeg ? (returnDepartTime ? returnDepartTime.slice(0, 10) : returnDateFrom) : null,
      returnDepartTime: returnDepartTime ? returnDepartTime.slice(11, 16) : null,
      returnArriveTime: returnArriveTime ? returnArriveTime.slice(11, 16) : null,
      stops: outStops,
      returnStops,
      airline: airlineOut,
      returnAirline: airlineRet,
      bookingUrl: buildSkyscannerUrl({
        origin,
        destination,
        departDate: departDateFrom,
        returnDate: returnDateFrom,
        maxStopsOutbound,
      }),
      source: "skyscanner",
      note: "dati non ufficiali (Sky Scrapper via RapidAPI, quota gratuita 100/mese), verificare disponibilità reale prima di prenotare",
    });
  }

  return results;
}
