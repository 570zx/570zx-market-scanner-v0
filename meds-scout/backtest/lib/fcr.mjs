// "First candle rule" strategy engine (pure functions, no network).
//
// Rules, as the promoter's short video states them (the video leaves several
// details open; each choice made here is listed in DEFAULTS and in the report):
//   1. The 09:30-09:35 ET candle (five 1-minute bars) gives two levels: high, low.
//   2. On 1-minute bars, price must break a level with force: a bar CLOSES beyond
//      it and leaves a fair value gap (bar i-1 and bar i+1 do not overlap).
//   3. Wait for price to come back into the gap, then for an engulfing candle
//      in the breakout direction. Enter at that candle's close.
//   4. Fixed reward:risk (default 3:1). Stop beyond the engulfing candle
//      (default) or beyond the far edge of the gap.
//   5. One trade per day. Flat at 15:55 if neither stop nor target was hit.
//
// A bar is {m: minute of day in ET (570 = 09:30), o, h, l, c}.

export const DEFAULTS = {
  rr: 3,
  stop: 'engulf',        // 'engulf' = beyond engulfing candle, 'fvg' = beyond far edge of the gap
  cutoff: 11 * 60 + 30,  // no new entries after this minute of day
  flat: 15 * 60 + 55,    // exit at this bar's close
  minRisk: 0.02,         // skip setups whose stop is closer than this ($)
  mirror: false,         // control: same entry, trade the opposite side with the same geometry
};

const ORB_START = 570, ORB_END = 575; // bars with 570 <= m < 575

export function openingLevels(bars) {
  const c = bars.filter(b => b.m >= ORB_START && b.m < ORB_END);
  if (c.length < 4) return null; // a broken or half-missing opening candle is not traded
  return {high: Math.max(...c.map(b => b.h)), low: Math.min(...c.map(b => b.l))};
}

const bullEngulf = (p, b) => p.c < p.o && b.c > b.o && b.o <= p.c && b.c >= p.o;
const bearEngulf = (p, b) => p.c > p.o && b.c < b.o && b.o >= p.c && b.c <= p.o;

// Find the day's first trade (or null). Returns the entry, stop, target and the
// index of the entry bar; the exit is resolved separately by resolveExit().
export function findSetup(bars, opts = {}) {
  const P = {...DEFAULTS, ...opts};
  const lv = openingLevels(bars);
  if (!lv) return null;
  const idx = bars.findIndex(b => b.m >= ORB_END);
  if (idx < 1) return null;
  let armedShort = null, armedLong = null; // {zoneLo, zoneHi, since}
  for (let j = idx; j < bars.length; j++) {
    const b = bars[j];
    if (b.m > P.cutoff) break;
    // 1) A gap forms when bar j-1 was the breakout bar: bars j-2, j-1, j.
    if (j >= 2 && bars[j - 1].m >= ORB_END) {
      const a = bars[j - 2], k = bars[j - 1];
      if (k.c < lv.low && a.l > b.h) armedShort = {zoneLo: b.h, zoneHi: a.l, since: j};
      if (k.c > lv.high && a.h < b.l) armedLong = {zoneLo: a.h, zoneHi: b.l, since: j};
    }
    // 2) Engulfing candle after price returns into an armed gap (never on the bar that formed it).
    const p = bars[j - 1];
    if (armedShort && j > armedShort.since) {
      if (b.c > armedShort.zoneHi) armedShort = null; // closed back through the whole gap: setup is dead
      else if (b.h >= armedShort.zoneLo && bearEngulf(p, b)) return build('short', b, j, armedShort, P);
    }
    if (armedLong && j > armedLong.since) {
      if (b.c < armedLong.zoneLo) armedLong = null;
      else if (b.l <= armedLong.zoneHi && bullEngulf(p, b)) return build('long', b, j, armedLong, P);
    }
  }
  return null;
}

function build(dir, b, j, zone, P) {
  const entry = b.c;
  let stop = dir === 'short' ? (P.stop === 'fvg' ? Math.max(zone.zoneHi, b.h) : b.h)
                             : (P.stop === 'fvg' ? Math.min(zone.zoneLo, b.l) : b.l);
  let risk = Math.abs(stop - entry);
  if (risk < P.minRisk) return null;
  let side = dir;
  if (P.mirror) { side = dir === 'short' ? 'long' : 'short'; stop = side === 'long' ? entry - risk : entry + risk; }
  const target = side === 'long' ? entry + P.rr * risk : entry - P.rr * risk;
  return {dir: side, signal: dir, entry, stop, target, risk, j, m: b.m};
}

// Walk forward from the bar after entry. If a bar touches both stop and target,
// the stop is assumed to hit first (the conservative reading).
export function resolveExit(bars, s, opts = {}) {
  const P = {...DEFAULTS, ...opts};
  for (let k = s.j + 1; k < bars.length; k++) {
    const b = bars[k];
    const stopHit = s.dir === 'long' ? b.l <= s.stop : b.h >= s.stop;
    const tgtHit = s.dir === 'long' ? b.h >= s.target : b.l <= s.target;
    if (stopHit) return {exit: s.stop, reason: 'stop', m: b.m};
    if (tgtHit) return {exit: s.target, reason: 'target', m: b.m};
    if (b.m >= P.flat) return {exit: b.c, reason: 'flat', m: b.m};
  }
  const last = bars.at(-1);
  return {exit: last.c, reason: 'flat', m: last.m};
}

// costs: {rt} dollars per share round trip (spread + commission + slippage),
// {stopSlip} extra dollars per share when the stop is the exit.
export function tradeR(s, x, costs = {}) {
  const gross = (s.dir === 'long' ? x.exit - s.entry : s.entry - x.exit) / s.risk;
  const cost = ((costs.rt ?? 0) + (x.reason === 'stop' ? (costs.stopSlip ?? 0) : 0)) / s.risk;
  return {gross, net: gross - cost};
}

export function runDays(days, opts = {}, costs = {}) {
  const trades = [];
  for (const d of days) {
    const s = findSetup(d.bars, opts);
    if (!s) continue;
    const x = resolveExit(d.bars, s, opts);
    const r = tradeR(s, x, costs);
    trades.push({date: d.date, dir: s.dir, signal: s.signal, entry: s.entry, stop: s.stop, exit: x.exit, risk: s.risk, reason: x.reason, entryMin: s.m, exitMin: x.m, r: r.net, rGross: r.gross});
  }
  return trades;
}

export function stats(trades, key = 'r') {
  const n = trades.length;
  if (!n) return {n: 0};
  const rs = trades.map(t => t[key]);
  const sum = rs.reduce((a, b) => a + b, 0), mean = sum / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0);
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {n, winRate: wins.length / n, avgR: mean, totalR: sum, t: sd ? mean / (sd / Math.sqrt(n)) : 0,
          profitFactor: gl ? gw / gl : null, maxDdR: dd, stopPct: trades.filter(t => t.reason === 'stop').length / n,
          targetPct: trades.filter(t => t.reason === 'target').length / n};
}

export function byYear(trades, key = 'r') {
  const out = {};
  for (const t of trades) (out[t.date.slice(0, 4)] ??= []).push(t);
  return Object.fromEntries(Object.entries(out).map(([y, ts]) => [y, stats(ts, key)]));
}
