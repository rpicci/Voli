// Costruisce un link di ricerca Skyscanner con dati reali (nessuna API,
// nessun costo di quota) — condiviso da tutte le fonti (Duffel,
// Travelpayouts, Google Flights) come link "Vedi prenotazione".
//
// Formato: skyscanner.it/trasporti/voli/<origine>/<destinazione>/<YYMMDD>[/<YYMMDD>]/
//   ?adultsv2=1&preferdirects=true|false

function toYYMMDD(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return null;
  return y.slice(2) + m.padStart(2, "0") + d.padStart(2, "0");
}

export function buildSkyscannerUrl({ origin, destination, departDate, returnDate, maxStopsOutbound }) {
  const dep = toYYMMDD(departDate);
  if (!dep) return null;

  const ret = returnDate ? toYYMMDD(returnDate) : null;
  const datePath = ret ? `${dep}/${ret}` : dep;
  const preferDirects = maxStopsOutbound === 0 ? "true" : "false";

  return `https://www.skyscanner.it/trasporti/voli/${origin.toLowerCase()}/${destination.toLowerCase()}/${datePath}/?adultsv2=1&preferdirects=${preferDirects}`;
}
