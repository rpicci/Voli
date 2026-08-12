import { getStore } from "@netlify/blobs";

// Recupera i tassi di cambio EUR->altre valute da Booking.com, con cache
// di un giorno (usiamo lo stesso storage di Netlify Blobs già usato per
// la configurazione). La prima chiamata Booking.com della giornata (sia
// on-demand che schedulata) li recupera e li salva; le successive
// riusano quelli già in cache, senza consumare altre chiamate API.

const HOST = "booking-com18.p.rapidapi.com";

export async function getEurRates(apiKey) {
  const store = getStore("flight-watch-fxrates");
  const today = new Date().toISOString().slice(0, 10);

  const cached = await store.get("rates", { type: "json" });
  if (cached && cached.date === today && cached.rates) {
    return cached.rates;
  }

  const url = new URL(`https://${HOST}/exchange-rates`);
  url.searchParams.set("baseCurrency", "EUR");

  const res = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": HOST,
    },
  });

  if (!res.ok) {
    throw new Error(`Booking.com exchange-rates error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const list = json?.data?.exchange_rates || [];

  const rates = { EUR: 1 };
  for (const r of list) {
    const value = parseFloat(r.exchange_rate_buy);
    if (r.currency && !isNaN(value)) rates[r.currency] = value;
  }

  await store.setJSON("rates", { date: today, rates });
  return rates;
}

// Converte un prezzo nella valuta indicata in EUR, usando i tassi già
// recuperati. Se manca il tasso per quella valuta, restituisce il prezzo
// originale senza conversione (meglio un prezzo nella valuta sbagliata,
// ma visibile, che un errore che blocca tutto).
export function convertToEur(amount, fromCurrency, rates) {
  if (!fromCurrency || fromCurrency === "EUR") return { amount, converted: false };
  const rate = rates?.[fromCurrency];
  if (!rate) return { amount, converted: false };
  return { amount: amount / rate, converted: true };
}
