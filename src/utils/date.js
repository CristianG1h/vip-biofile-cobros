const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partsInZone(date = new Date(), timeZone = "America/Bogota") {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return parts;
}

export function todayISO(timeZone = "America/Bogota") {
  const p = partsInZone(new Date(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function weekdayInZone(timeZone = "America/Bogota") {
  const p = partsInZone(new Date(), timeZone);
  return WEEKDAYS[p.weekday];
}

export function isoToBiofile(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Fecha ISO inválida: ${iso}`);
  const [, year, month, day] = match;
  return `${day}/${Number(month)}/${year}`;
}

export function biofileDateToISO(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcDate(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Fecha ISO inválida: ${iso}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function minusDaysISO(iso, days) {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() - Number(days || 0));
  return toISO(d);
}

export function monthRanges(startISO, endISO) {
  const start = utcDate(startISO);
  const end = utcDate(endISO);
  if (start > end) return [];

  const ranges = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const a = start > monthStart ? start : monthStart;
    const b = end < monthEnd ? end : monthEnd;
    ranges.push({ startISO: toISO(a), endISO: toISO(b) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return ranges;
}
