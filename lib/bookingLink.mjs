// Genera un link diretto alla pagina di ricerca voli di Booking.com
// (flights.booking.com), sul modello:
// https://flights.booking.com/flights/FCO.AIRPORT-CAG.AIRPORT/?type=ROUNDTRIP&adults=1&cabinClass=ECONOMY&from=FCO.AIRPORT&to=CAG.AIRPORT&stops=0&depart=2026-08-20&return=2026-08-30&sort=BEST
// Nessuna chiamata API, nessun costo — solo un link di prenotazione,
// come già fa skyscannerLink.mjs per le altre fonti.

export function buildBookingUrl({ origin, destination, departDate, returnDate, maxStopsOutbound }) {
  const isRoundTrip = !!returnDate;
  const url = new URL(`https://flights.booking.com/flights/${origin}.AIRPORT-${destination}.AIRPORT/`);
  url.searchParams.set("type", isRoundTrip ? "ROUNDTRIP" : "ONEWAY");
  url.searchParams.set("adults", "1");
  url.searchParams.set("cabinClass", "ECONOMY");
  url.searchParams.set("from", `${origin}.AIRPORT`);
  url.searchParams.set("to", `${destination}.AIRPORT`);
  if (maxStopsOutbound === 0) {
    url.searchParams.set("stops", "0");
  }
  url.searchParams.set("depart", departDate);
  if (isRoundTrip) {
    url.searchParams.set("return", returnDate);
  }
  url.searchParams.set("sort", "BEST");
  return url.toString();
}
