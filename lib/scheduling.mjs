// Calcola gli "slot orari" della giornata in base al numero di tentativi,
// a partire da un'ora di inizio scelta (invece di partire sempre da 00:00).
export function computeDailySlots(attemptsPerDay, startHour = 0) {
  const n = Math.max(1, Math.min(24, Math.round(attemptsPerDay || 1)));
  const start = Math.max(0, Math.min(23, Math.round(startHour || 0)));
  const stepHours = 24 / n;
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push(Math.round(start + i * stepHours) % 24);
  }
  return [...new Set(slots)].sort((a, b) => a - b);
}

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

export function isDueNow(attemptsPerDay, lastRunSlotKey, startHour = 0) {
  const slots = computeDailySlots(attemptsPerDay, startHour);
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
