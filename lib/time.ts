/**
 * IST time helpers. India has no DST, so IST = UTC+05:30 always. Business logic works in
 * "minutes since local midnight" + an ISO local date string; timestamps are stored in UTC.
 */
export const IST_OFFSET_MIN = 330;

export type LocalNow = { date: string; minutes: number; hour: number; dow: number };

export function toIst(d: Date = new Date()): LocalNow {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  const date = t.toISOString().slice(0, 10);
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return { date, minutes, hour: t.getUTCHours(), dow: t.getUTCDay() };
}

/** "HH:MM" -> minutes. */
export function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** minutes -> "HH:MM" (wraps within a day). */
export function fmtHm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** minutes -> "12:30 PM" style for display. */
export function fmt12(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** IST local date + minutes -> UTC Date. */
export function istToUtc(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - IST_OFFSET_MIN) * 60_000);
}

export function timeOfDay(minutes: number): "morning" | "midday" | "afternoon" | "evening" | "night" {
  if (minutes < 5 * 60) return "night";
  if (minutes < 11 * 60) return "morning";
  if (minutes < 14 * 60) return "midday";
  if (minutes < 18 * 60) return "afternoon";
  if (minutes < 21 * 60 + 30) return "evening";
  return "night";
}
