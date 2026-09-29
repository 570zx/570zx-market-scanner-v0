// Time helpers for the backtester. Captures the real Date at import time:
// the replay swaps globalThis.Date for a fake clock while MEDS code runs.
export const RealDate = Date;
export const realNow = () => RealDate.now();
export const MIN = 60_000;

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
});

// Wall-clock parts in New York for a UTC millisecond timestamp.
export function etParts(ms) {
  const parts = ET_FORMAT.formatToParts(new RealDate(ms));
  const get = t => parts.find(p => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24, minute: Number(get('minute')), second: Number(get('second')),
    weekday: get('weekday'),
  };
}
export const etDate = ms => etParts(ms).date;
export const etMinuteOfDay = ms => { const p = etParts(ms); return p.hour * 60 + p.minute; };

// UTC milliseconds for a New York wall-clock time on a date ('YYYY-MM-DD', 'HH:MM').
export function etWall(date, hhmm) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = String(hhmm).replace(/^(\d\d)(\d\d)$/, '$1:$2').split(':').map(Number);
  for (const offset of [4, 5]) {
    const ms = RealDate.UTC(y, mo - 1, d, h + offset, m);
    const p = etParts(ms);
    if (p.date === date && p.hour === h && p.minute === m) return ms;
  }
  throw new Error(`No New York time ${date} ${hhmm}`);
}

export const iso = ms => new RealDate(ms).toISOString();
export const parseMs = s => RealDate.parse(s);

// Calendar-day arithmetic on 'YYYY-MM-DD' strings.
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new RealDate(RealDate.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The Leader cycle times for one trading day, mirroring production's
// ENGINE_CADENCE='session': premarket buckets every 10 minutes, regular every
// 5 minutes. The cron fires a few seconds after each boundary.
export function cycleTimes(day, {premarketFrom = '09:00', lagSeconds = 5} = {}) {
  const out = [];
  const open = etWall(day.date, day.open ?? '09:30');
  const close = etWall(day.date, '16:00');
  for (let t = etWall(day.date, premarketFrom); t < open; t += 10 * MIN) out.push(t + lagSeconds * 1000);
  for (let t = open; t < close; t += 5 * MIN) out.push(t + lagSeconds * 1000);
  return out;
}
