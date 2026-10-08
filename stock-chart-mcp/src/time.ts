// US equity session clock in America/New_York (DST aware via Intl).
// Exchange holidays and early closes are not modelled: on those days the
// watcher simply finds no new bars.

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export type EtParts = { date: string; minutes: number; weekday: string; hhmm: string; mmdd: string };

// Intl formatting is the slowest step when charting hundreds of bars (about
// 10 microseconds a call). New York's UTC offset is always a whole number of
// hours and changes on the hour, so Intl runs once per UTC hour and the
// minutes within the hour are added arithmetically.
const HOUR = 3_600_000;
const hourCache = new Map<number, EtParts>();
// Bar timestamps arrive as ISO strings and are converted several times per
// bar; parsing the string costs more than the lookup, so memoise by string.
const stringCache = new Map<string, EtParts>();
export function etParts(at: Date | string | number): EtParts {
  if (typeof at === 'string') {
    let hit = stringCache.get(at);
    if (!hit) {
      if (stringCache.size > 50_000) stringCache.clear();
      hit = etPartsMs(Date.parse(at));
      stringCache.set(at, hit);
    }
    return hit;
  }
  return etPartsMs(new Date(at).getTime());
}

function etPartsMs(ms: number): EtParts {
  const hourStart = ms - (((ms % HOUR) + HOUR) % HOUR);
  let base = hourCache.get(hourStart);
  if (!base) {
    if (hourCache.size > 50_000) hourCache.clear();
    base = computeEtParts(hourStart);
    hourCache.set(hourStart, base);
  }
  const extra = Math.floor((ms - hourStart) / 60_000);
  if (!extra) return base;
  const minutes = base.minutes + extra;
  return { ...base, minutes, hhmm: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
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
