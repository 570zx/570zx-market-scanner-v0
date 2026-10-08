// US equity session clock in America/New_York (DST aware via Intl).
// Exchange holidays and early closes are not modelled: on those days the
// watcher simply finds no new bars.

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export type EtParts = { date: string; minutes: number; weekday: string; hhmm: string; mmdd: string };

// Intl formatting is the slowest step when charting hundreds of bars; bar
// timestamps repeat across analysis and drawing, so memoise them.
const cache = new Map<number, EtParts>();
export function etParts(at: Date | string | number): EtParts {
  const ms = new Date(at).getTime();
  const hit = cache.get(ms);
  if (hit) return hit;
  if (cache.size > 20_000) cache.clear();
  const value = computeEtParts(ms);
  cache.set(ms, value);
  return value;
}

function computeEtParts(at: number): EtParts {
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(at))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
    weekday: parts.weekday,
    hhmm: `${String(hour).padStart(2, '0')}:${parts.minute}`,
    mmdd: `${parts.month}/${parts.day}`,
  };
}

export const REGULAR_OPEN = 9 * 60 + 30;
export const REGULAR_CLOSE = 16 * 60;
export const EXTENDED_OPEN = 4 * 60;
export const EXTENDED_CLOSE = 20 * 60;

export function isWeekday(p: EtParts) { return p.weekday !== 'Sat' && p.weekday !== 'Sun'; }

export function inSession(at: Date, extended = false) {
  const p = etParts(at);
  if (!isWeekday(p)) return false;
  return extended
    ? p.minutes >= EXTENDED_OPEN && p.minutes < EXTENDED_CLOSE
    : p.minutes >= REGULAR_OPEN && p.minutes < REGULAR_CLOSE;
}
