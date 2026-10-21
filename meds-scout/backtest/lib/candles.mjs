// Candle-pattern discovery on QQQ/SPY one-minute bars (pure functions, no network).
//
// Every signal uses only information available at its decision time:
//   daily patterns  decided at 15:55 ET from bars up to 15:54 (so the day's close is the 15:54 bar close)
//   intraday        decided at 10:00 from the first 30 minutes
//   late-day        decided at 15:30
// Entries and exits happen at the OPEN of a named minute bar, never at a price that was used to decide.
// A bar is {m: minute of day in ET, o, h, l, c}.

export const T = {open: 570, d30: 600, mid: 690, late: 930, entry: 955};

// First bar at or after minute m, only if it is within tol minutes (no bar in a quiet minute is possible).
export function px(bars, m, tol = 3) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].m < m) lo = mid + 1; else hi = mid; }
  const b = bars[lo];
  return b && b.m - m <= tol ? b : null;
}

function rsi2(closes) { // Wilder RSI(2) on the last close, null until there is enough history
  if (closes.length < 4) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 2; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= 2; l /= 2;
  for (let i = 3; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g + (d > 0 ? d : 0)) / 2; l = (l + (d < 0 ? -d : 0)) / 2; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

// One record per session. rec.ok is false for sessions without a usable open and 15:55 bar (early closes, gaps in data).
export function buildRecords(days, {minBars = 300} = {}) {
  const recs = [], closes = [], okList = [];
  for (const d of days) {
    const bars = d.bars, first = px(bars, T.open), ent = px(bars, T.entry);
    const rec = {date: d.date, ok: false};
    recs.push(rec);
    if (!first || !ent) continue;
    const upto = bars.filter(b => b.m < T.entry);
    if (upto.length < minBars) continue;
    const h = Math.max(...upto.map(b => b.h)), l = Math.min(...upto.map(b => b.l)), c = upto.at(-1).c, o = first.o;
    const prevRec = okList.at(-1) ?? null;
    const sma = n => closes.length >= n - 1 ? (closes.slice(-(n - 1)).reduce((a, b) => a + b, 0) + c) / n : null;
    const s200 = sma(200), s50 = sma(50);
    const first30 = bars.filter(b => b.m >= T.open && b.m < T.d30);
    const f30 = first30.length >= Math.round(minBars / 12) ? {h: Math.max(...first30.map(b => b.h)), l: Math.min(...first30.map(b => b.l)), c: first30.at(-1).c} : null;
    const e600 = px(bars, T.d30), e690 = px(bars, T.mid), e930 = px(bars, T.late);
    let down = 0, up = 0; // consecutive lower / higher closes ending today
    { let cur = c; for (let k = okList.length - 1; k >= 0; k--) { if (cur < okList[k].c) { down++; cur = okList[k].c; } else break; } }
    { let cur = c; for (let k = okList.length - 1; k >= 0; k--) { if (cur > okList[k].c) { up++; cur = okList[k].c; } else break; } }
    Object.assign(rec, {
      ok: true, o, h, l, c, open570: o, e955: ent.o, e600: e600?.o ?? null, e690: e690?.o ?? null, e930: e930?.o ?? null,
      ibs: h > l ? (c - l) / (h - l) : null,
      ret1: prevRec ? c / prevRec.c - 1 : null,
      down, up,
      lowerLow: prevRec ? l < prevRec.l : null, higherHigh: prevRec ? h > prevRec.h : null,
      gap: prevRec ? o / prevRec.c - 1 : null,
      sma200up: s200 == null ? null : c > s200, sma50up: s50 == null ? null : c > s50,
      rsi2: rsi2([...closes.slice(-30), c]),
      r30: f30 ? f30.c / o - 1 : null, ibs30: f30 && f30.h > f30.l ? (f30.c - f30.l) / (f30.h - f30.l) : null,
      r930: e930 ? e930.o / o - 1 : null,
    });
    closes.push(c); okList.push(rec);
  }
  // Forward returns (long, as decimals) and the entry price used for costs.
  const okIdx = recs.map((r, i) => r.ok ? i : -1).filter(i => i >= 0);
  const pos = new Map(okIdx.map((i, k) => [i, k]));
  for (const i of okIdx) {
    const r = recs[i], k = pos.get(i), at = n => { const j = okIdx[k + n]; return j == null ? null : recs[j]; };
    const n1 = at(1);
    r.fwd = {
      ovn: n1 ? {ret: n1.open570 / r.e955 - 1, px: r.e955} : null,
      day1: n1 ? {ret: n1.e955 / r.e955 - 1, px: r.e955} : null,
      day2: at(2) ? {ret: at(2).e955 / r.e955 - 1, px: r.e955} : null,
      day3: at(3) ? {ret: at(3).e955 / r.e955 - 1, px: r.e955} : null,
      day5: at(5) ? {ret: at(5).e955 / r.e955 - 1, px: r.e955} : null,
      id1130: r.e600 && r.e690 ? {ret: r.e690 / r.e600 - 1, px: r.e600} : null,
      idClose: r.e600 ? {ret: r.e955 / r.e600 - 1, px: r.e600} : null,
      late: r.e930 ? {ret: r.e955 / r.e930 - 1, px: r.e930} : null,
    };
  }
  return recs;
}

// ---- signals --------------------------------------------------------------------------------
const num = v => v != null;
export const SIGNALS = [
  // daily weak-candle patterns (the classic "buy the dip" family), long
  {id: 'ibs<=0.1', fam: 'daily', dir: 1, test: r => num(r.ibs) && r.ibs <= 0.1},
  {id: 'ibs<=0.2', fam: 'daily', dir: 1, test: r => num(r.ibs) && r.ibs <= 0.2},
  {id: 'ibs<=0.3', fam: 'daily', dir: 1, test: r => num(r.ibs) && r.ibs <= 0.3},
  {id: 'down2', fam: 'daily', dir: 1, test: r => r.down >= 2},
  {id: 'down3', fam: 'daily', dir: 1, test: r => r.down >= 3},
  {id: 'lowerLow', fam: 'daily', dir: 1, test: r => r.lowerLow === true},
  {id: 'ret<=-0.5%', fam: 'daily', dir: 1, test: r => num(r.ret1) && r.ret1 <= -0.005},
  {id: 'ret<=-1%', fam: 'daily', dir: 1, test: r => num(r.ret1) && r.ret1 <= -0.01},
  {id: 'ibs<=0.2&down2', fam: 'daily', dir: 1, test: r => num(r.ibs) && r.ibs <= 0.2 && r.down >= 2},
  {id: 'ibs<=0.2&lowerLow', fam: 'daily', dir: 1, test: r => num(r.ibs) && r.ibs <= 0.2 && r.lowerLow === true},
  {id: 'rsi2<=10', fam: 'daily', dir: 1, test: r => num(r.rsi2) && r.rsi2 <= 10},
  // daily strong-candle patterns, short
  {id: 'ibs>=0.8', fam: 'daily', dir: -1, test: r => num(r.ibs) && r.ibs >= 0.8},
  {id: 'ibs>=0.9', fam: 'daily', dir: -1, test: r => num(r.ibs) && r.ibs >= 0.9},
  {id: 'up3', fam: 'daily', dir: -1, test: r => r.up >= 3},
  {id: 'higherHigh', fam: 'daily', dir: -1, test: r => r.higherHigh === true},
  {id: 'ret>=1%', fam: 'daily', dir: -1, test: r => num(r.ret1) && r.ret1 >= 0.01},
  // first 30 minutes (decided 10:00), both directions
  ...[['r30<=-0.3%', r => num(r.r30) && r.r30 <= -0.003], ['r30<=-0.6%', r => num(r.r30) && r.r30 <= -0.006], ['r30>=0.3%', r => num(r.r30) && r.r30 >= 0.003], ['r30>=0.6%', r => num(r.r30) && r.r30 >= 0.006],
      ['ibs30<=0.15', r => num(r.ibs30) && r.ibs30 <= 0.15], ['ibs30>=0.85', r => num(r.ibs30) && r.ibs30 >= 0.85],
      ['gap<=-0.4%&r30>0', r => num(r.gap) && r.gap <= -0.004 && num(r.r30) && r.r30 > 0]].flatMap(([id, test]) => [{id, fam: 'intra', dir: 1, test}, {id, fam: 'intra', dir: -1, test}]),
  // late day (decided 15:30): drift since the open
  ...[['since-open>=0.2%', r => num(r.r930) && r.r930 >= 0.002], ['since-open<=-0.2%', r => num(r.r930) && r.r930 <= -0.002], ['since-open>=0.5%', r => num(r.r930) && r.r930 >= 0.005], ['since-open<=-0.5%', r => num(r.r930) && r.r930 <= -0.005]]
    .flatMap(([id, test]) => [{id, fam: 'late', dir: 1, test}, {id, fam: 'late', dir: -1, test}]),
];
export const TRENDS = {
  none: () => true,
  sma200up: r => r.sma200up === true,
  sma50up: r => r.sma50up === true,
  sma200dn: r => r.sma200up === false,
};
const HOLDS = {daily: ['ovn', 'day1', 'day2', 'day3', 'day5'], intra: ['id1130', 'idClose'], late: ['late']};

export function configs() {
  const out = [];
  for (const s of SIGNALS) {
    const trends = s.fam === 'daily' ? (s.dir === 1 ? ['none', 'sma200up', 'sma50up'] : ['none', 'sma200dn']) : ['none', 'sma200up'];
    for (const trend of trends) for (const hold of HOLDS[s.fam]) out.push({sig: s.id, fam: s.fam, dir: s.dir, trend, hold});
  }
  return out;
}
const SIG = new Map(SIGNALS.map(s => [`${s.id}|${s.dir}`, s]));

// Net return per trade as a decimal. rtCost is dollars per share, round trip.
export function trades(recs, cfg, rtCost = 0.02, from = '0000', to = '9999') {
  const s = SIG.get(`${cfg.sig}|${cfg.dir}`), tr = TRENDS[cfg.trend], out = [];
  for (const r of recs) {
    if (!r.ok || !r.fwd || r.date < from || r.date >= to) continue;
    const f = r.fwd[cfg.hold];
    if (!f || !tr(r) || !s.test(r)) continue;
    out.push({date: r.date, r: cfg.dir * f.ret - rtCost / f.px});
  }
  return out;
}
export function baseline(recs, cfg, rtCost = 0.02, from = '0000', to = '9999') { // same direction and hold, every valid day
  let n = 0, sum = 0;
  for (const r of recs) { if (r.date < from || r.date >= to) continue; const f = r.ok && r.fwd?.[cfg.hold]; if (!f) continue; n++; sum += cfg.dir * f.ret - rtCost / f.px; }
  return n ? sum / n : 0;
}

export function summarize(ts) {
  const n = ts.length;
  if (!n) return {n: 0};
  const rs = ts.map(t => t.r), mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const gw = rs.filter(r => r > 0).reduce((a, b) => a + b, 0), gl = -rs.filter(r => r <= 0).reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {n, winRate: rs.filter(r => r > 0).length / n, mean, sd, t: sd ? mean / (sd / Math.sqrt(n)) : 0, pf: gl ? gw / gl : null, maxDd: dd, total: mean * n};
}

// Shuffle the forward returns across sessions (same shuffle for every hold) to see what a search finds in noise.
export function permuted(recs, rand) {
  const idx = recs.map((r, i) => r.ok && r.fwd ? i : -1).filter(i => i >= 0);
  const src = idx.slice();
  for (let i = src.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [src[i], src[j]] = [src[j], src[i]]; }
  const out = recs.map(r => r);
  idx.forEach((i, k) => { out[i] = {...recs[i], fwd: recs[src[k]].fwd}; });
  return out;
}
