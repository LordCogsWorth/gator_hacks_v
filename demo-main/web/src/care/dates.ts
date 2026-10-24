// Date helpers for the care pages. Plan dates are local calendar days ("YYYY-MM-DD").

const DAY_MS = 86_400_000;

/** set_next_checkin accepts today … today + 180 days. */
export const MAX_CHECKIN_DAYS = 180;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of `d` as YYYY-MM-DD. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local noon of the day, so DST shifts never move it to another day. */
function noon(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(iso: string, n: number): string {
  const d = noon(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / DAY_MS);
}

/** Check-in dates the data layer accepts. */
export function isValidCheckin(iso: string, today: string): boolean {
  if (!isISODate(iso)) return false;
  const n = daysBetween(today, iso);
  return n >= 0 && n <= MAX_CHECKIN_DAYS;
}

/** Move a check-in by `delta` days, kept within today … today + 180. */
export function shiftCheckin(current: string, delta: number, today: string): string {
  const base = isISODate(current) ? current : today;
  const moved = addDays(base, delta);
  if (daysBetween(today, moved) < 0) return today;
  const max = addDays(today, MAX_CHECKIN_DAYS);
  return daysBetween(max, moved) > 0 ? max : moved;
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "Tue, Oct 27" for a YYYY-MM-DD day. */
export function formatDay(iso: string): string {
  if (!isISODate(iso)) return iso;
  return noon(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Oct 27" for a timestamp or a YYYY-MM-DD day (chart axes, tables). */
export function shortDate(value: string): string {
  const d = isISODate(value) ? noon(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Oct 27, 3:05 PM" for a timestamp. */
export function shortDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
