// Genera le coppie {departDate, returnDate} per una "tratta monitorata",
// a partire da un range di date, un sottoinsieme di giorni della settimana
// (0=domenica...6=sabato, convenzione JS Date.getDay()) e una durata del
// soggiorno in notti (usata per calcolare il ritorno abbinato a ogni data
// di andata). Se la tratta è "solo andata", returnDate è sempre null.
export function generateDatePairs(route) {
  const { dateRangeFrom, dateRangeTo, weekdays, oneWay, nights } = route;
  const pairs = [];
  if (!dateRangeFrom || !dateRangeTo) return pairs;

  const start = new Date(dateRangeFrom + "T00:00:00Z");
  const end = new Date(dateRangeTo + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || start > end) return pairs;

  const selectedWeekdays = Array.isArray(weekdays) && weekdays.length > 0 ? weekdays : null;
  const nightsCount = parseInt(nights, 10) || 7;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (selectedWeekdays && !selectedWeekdays.includes(dow)) continue;

    const departDate = d.toISOString().slice(0, 10);
    let returnDate = null;
    if (!oneWay) {
      const r = new Date(d);
      r.setUTCDate(r.getUTCDate() + nightsCount);
      returnDate = r.toISOString().slice(0, 10);
    }
    pairs.push({ departDate, returnDate });
  }

  return pairs;
}

// Conta quante coppie genererebbe una tratta, senza costruirle tutte —
// usato lato pagina per la stima della quota API, dove basta il numero.
export function countDatePairs(route) {
  return generateDatePairs(route).length;
}
