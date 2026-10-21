// Portfolio simulation for the weak-close ("low IBS") ETF strategy: slots, ranking, stops, strength exits.
// Pure functions. Money is a fraction of starting equity (start = 1). Entries at the open of the 15:55 bar;
// exits at the open of the 15:55 bar, except stops, which fill at the stop level (or the open, if the day gaps through it).
//
// Information used at 15:55 on day t: that day's bars up to 15:54 (c, h, l, ibs) and earlier days. Nothing later.
import {TRENDS} from './candles.mjs';

export function align(recsBySym) {
  const dateSet = new Set();
  for (const recs of Object.values(recsBySym)) for (const r of recs) if (r.ok) dateSet.add(r.date);
  const dates = [...dateSet].sort();
  const idx = new Map(dates.map((d, i) => [d, i]));
  const by = {}, prevH = {};
  for (const [sym, recs] of Object.entries(recsBySym)) {
    by[sym] = new Array(dates.length).fill(null); prevH[sym] = new Array(dates.length).fill(null);
    let last = null;
    for (const r of recs) { if (!r.ok) continue; const i = idx.get(r.date); by[sym][i] = r; prevH[sym][i] = last ? last.h : null; last = r; }
  }
  return {dates, by, prevH, syms: Object.keys(recsBySym)};
}

export const EXITS = {
  hold2: {maxHold: 2}, hold3: {maxHold: 3}, hold5: {maxHold: 5},
  strength5: {maxHold: 5, strength: true},
  'strength5+stop4': {maxHold: 5, strength: true, stop: 0.04},
  'hold3+stop4': {maxHold: 3, stop: 0.04},
};
export function configs(slotList = [3, 5]) {
  const out = [];
  for (const thr of [0.1, 0.2, 0.3]) for (const slots of slotList) for (const exit of Object.keys(EXITS)) for (const trend of ['none', 'sma200up']) out.push({thr, slots, exit, trend});
  return out;
}
export const cfgLabel = c => `IBS ≤ ${c.thr}, ${c.slots} slots, exit ${c.exit}, trend ${c.trend}`;
export const BASELINE = {thr: 0.2, slots: 5, exit: 'hold3', trend: 'none'};

export function simulate(al, cfg, {cost = 0.01, stopSlip = 0.01, from = '0000'} = {}) {
  const ex = EXITS[cfg.exit], trend = TRENDS[cfg.trend], N = al.dates.length;
  let cash = 1, positions = [];
  const daily = new Array(N).fill(0), equity = new Array(N).fill(1), invested = new Array(N).fill(0), trades = [], entries = [];
  let prevEq = 1;
  const value = t => cash + positions.reduce((a, p) => { const r = al.by[p.sym][t]; if (r) p.mark = r.e955; return a + p.shares * p.mark; }, 0);
  for (let t = 0; t < N; t++) {
    // 1) exits
    for (const p of [...positions]) {
      const r = al.by[p.sym][t];
      if (!r || t <= p.entryIdx) continue;
      const k = t - p.entryIdx, level = ex.stop ? p.entry * (1 - ex.stop) : null, ph = al.prevH[p.sym][t];
      let px = null, why = null;
      if (level && r.open570 <= level) { px = r.open570 - stopSlip; why = 'gap-stop'; }
      else if (level && r.l <= level) { px = level - stopSlip; why = 'stop'; }
      else if (k >= ex.maxHold) { px = r.e955; why = 'time'; }
      else if (ex.strength && ph != null && r.c > ph) { px = r.e955; why = 'strength'; }
      if (px == null) continue;
      cash += p.shares * (px - cost);
      trades.push({sym: p.sym, entry: al.dates[p.entryIdx], exit: al.dates[t], days: k, why, ret: (px - p.entry - 2 * cost) / p.entry});
      positions = positions.filter(q => q !== p);
    }
    // 2) entries, best (lowest IBS) first, sized as an equal share of today's equity
    const pre = value(t);
    if (positions.length < cfg.slots && al.dates[t] >= from) {
      const held = new Set(positions.map(p => p.sym));
      const cands = al.syms.map(s => ({s, r: al.by[s][t]})).filter(x => x.r && !held.has(x.s) && x.r.ibs != null && x.r.ibs <= cfg.thr && trend(x.r)).sort((a, b) => (a.r.ibs - b.r.ibs) || ((a.r.ret1 ?? 0) - (b.r.ret1 ?? 0)));
      for (const c of cands) {
        if (positions.length >= cfg.slots) break;
        const size = Math.min(pre / cfg.slots, cash);
        if (size < 1e-6) break;
        const shares = size / (c.r.e955 + cost);
        cash -= shares * (c.r.e955 + cost);
        positions.push({sym: c.s, shares, entry: c.r.e955, entryIdx: t, mark: c.r.e955});
        entries.push({date: al.dates[t], sym: c.s, ibs: c.r.ibs, px: c.r.e955, rank: positions.length});
      }
    }
    // 3) mark to market
    const v = value(t);
    equity[t] = v; daily[t] = v / prevEq - 1; invested[t] = v > 0 ? (v - cash) / v : 0; prevEq = v;
  }
  return {daily, equity, invested, trades, entries, open: positions.map(p => ({sym: p.sym, entry: p.entry, mark: p.mark, shares: p.shares, entryDate: al.dates[p.entryIdx], days: N - 1 - p.entryIdx})), dates: al.dates};
}

export function metricsFromReturns(rets) {
  const n = rets.length;
  if (n < 2) return {n};
  let eq = 1, peak = 1, dd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  const mean = rets.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return {n, total: eq - 1, cagr: eq ** (252 / n) - 1, sharpe: sd ? mean / sd * Math.sqrt(252) : 0, maxDd: dd};
}
export function tradeStats(trades) {
  const n = trades.length;
  if (!n) return {n: 0};
  let streak = 0, worst = 0;
  for (const t of trades.slice().sort((a, b) => a.exit < b.exit ? -1 : 1)) { if (t.ret <= 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; }
  return {n, winRate: trades.filter(t => t.ret > 0).length / n, avg: trades.reduce((a, t) => a + t.ret, 0) / n, losingStreak: worst};
}
export function monthly(dates, rets) {
  const by = {};
  dates.forEach((d, i) => { const m = d.slice(0, 7); by[m] = (by[m] ?? 1) * (1 + rets[i]); });
  const v = Object.values(by).map(x => x - 1);
  return {months: v.length, positive: v.filter(x => x > 0).length / Math.max(1, v.length), worst: v.length ? Math.min(...v) : null};
}
export const yearOf = d => d.slice(0, 4);
export function sliceRange(sim, from, to) { // daily returns and dates with from <= date < to
  const out = {rets: [], dates: []};
  sim.dates.forEach((d, i) => { if (d >= from && d < to) { out.rets.push(sim.daily[i]); out.dates.push(d); } });
  return out;
}

// Walk-forward: each year trades the configuration with the best Sharpe over all EARLIER years only.
export function walkForward(sims, dates, {firstTestYear, minTrades = 40} = {}) {
  const years = [...new Set(dates.map(yearOf))].filter(y => y >= firstTestYear).sort();
  const picks = [], rets = [], outDates = [], trades = [];
  for (const y of years) {
    let best = null;
    for (const s of sims) {
      const past = sliceRange(s, '0000', `${y}-01-01`), nT = s.trades.filter(t => t.exit < `${y}-01-01`).length;
      if (nT < minTrades) continue;
      const sh = metricsFromReturns(past.rets).sharpe;
      if (!best || sh > best.sharpe) best = {s, sharpe: sh};
    }
    if (!best) continue;
    const oos = sliceRange(best.s, `${y}-01-01`, `${Number(y) + 1}-01-01`);
    picks.push({year: y, cfg: best.s.cfg, pastSharpe: best.sharpe, oos: metricsFromReturns(oos.rets)});
    rets.push(...oos.rets); outDates.push(...oos.dates);
    trades.push(...best.s.trades.filter(t => t.entry >= `${y}-01-01` && t.entry < `${Number(y) + 1}-01-01`));
  }
  return {picks, rets, dates: outDates, trades};
}
