// Calcola gli "slot orari" della giornata in base al numero di tentativi.
// Esempio: tentativi = 4 -> [0, 6, 12, 18] (ore, fuso orario Europe/Rome)
// tentativi = 1 -> [0]
export function computeDailySlots(attemptsPerDay) {
  const n = Math.max(1, Math.min(24, Math.round(attemptsPerDay || 1)));
  const stepHours = 24 / n;
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push(Math.round(i * stepHours) % 24);
  }
  return [...new Set(slots)].sort((a, b) => a - b);
}

// Ora corrente in Europe/Rome, come { hour, dateKey } dove dateKey serve
// per evitare doppie esecuzioni nello stesso slot nello stesso giorno.
export function romeNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = parseInt(get("hour"), 10) % 24;
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { hour, dateKey };
}

// Verifica se l'ora corrente coincide con uno slot programmato, e se
// quello slot non è già stato eseguito oggi (usando lastRunSlotKey salvato).
export function isDueNow(attemptsPerDay, lastRunSlotKey) {
  const slots = computeDailySlots(attemptsPerDay);
  const { hour, dateKey } = romeNow();
  const isSlotHour = slots.includes(hour);
  const currentSlotKey = `${dateKey}-${hour}`;
  const alreadyRun = currentSlotKey === lastRunSlotKey;
  return {
    due: isSlotHour && !alreadyRun,
    currentSlotKey,
    slots,
  };
}
