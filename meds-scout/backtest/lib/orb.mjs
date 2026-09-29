// Opening-range breakout simulator on the cached one-minute days.
//
// Rule: after the first 15 minutes (09:30-09:45 ET) pick the few gapping,
// heavily traded stocks the bot could already see; buy a break above the
// opening range's high, stop at the range's low, take profit at a multiple of
// that risk, and sell whatever is left at 15:50. Everything used to pick and
// to trigger comes from bars that had completed by then; every fill pays a
// cost. `day` is a cached day file (see dataset.mjs).
import {etWall} from './time.mjs';

export const OR_START = 330, OR_END = 345, LAST_ENTRY = 660, FLAT_AT = 710; // minutes after 04:00 ET

export const DEFAULTS = {minGap: 0.02, minOrDollar: 400_000, minRelVol: 0.03, maxRisk: 0.08, minRisk: 0.01, minPrice: 1, maxPrice: 40, maxTrades: 3, rr: 2, cost: 0.005};

export function pickCandidates(day, p) {
  const decideAt = etWall(day.date, '09:45');
  const out = [];
  for (const [sym, b] of Object.entries(day.fine ?? {})) {
    const idx = []; for (let i = 0; i < b.t.length; i++) if (b.t[i] >= OR_START && b.t[i] < OR_END) idx.push(i);
    if (idx.length < 8) continue;
    // Only stocks the bot could already see at 09:45 (its screens showed them).
    if (day.showFrom && !day.stats?.synthetic) { const at = day.showFrom[sym]; if (!(at != null && at <= decideAt)) continue; }
    let hi = -Infinity, lo = Infinity, vol = 0, dollar = 0;
    for (const i of idx) { hi = Math.max(hi, b.h[i]); lo = Math.min(lo, b.l[i]); vol += b.v[i]; dollar += b.c[i] * b.v[i]; }
    const open = b.o[idx[0]], close = b.c[idx.at(-1)], ref = day.ref?.[sym];
    if (!ref || !(ref[0] > 0)) continue;
    const gap = open / ref[0] - 1, risk = (hi - lo) / hi;
    if (gap < p.minGap || close < p.minPrice || close > p.maxPrice || dollar < p.minOrDollar) continue;
    if (ref[1] > 0 && vol / ref[1] < p.minRelVol) continue;
    if (risk < p.minRisk || risk > p.maxRisk) continue;
    out.push({sym, hi, lo, dollar, gap, risk});
  }
  return out.sort((a, c) => c.dollar - a.dollar || (a.sym < c.sym ? -1 : 1)).slice(0, p.maxTrades);
}

// One candidate's day: returns null if it never broke out.
export function tradeOne(day, cand, p) {
  const b = day.fine[cand.sym];
  let entered = null;
  const buy = raw => raw * (1 + p.cost), sell = raw => raw * (1 - p.cost);
  const done = (raw, reason, t) => ({sym: cand.sym, date: day.date, entry: entered.px, exit: sell(raw), retPct: (sell(raw) / entered.px - 1) * 100,
    riskPct: (entered.raw - cand.lo) / entered.raw * 100, reason, minutes: t - entered.t});
  for (let i = 0; i < b.t.length; i++) {
    const t = b.t[i];
    if (t < OR_END) continue;
    if (!entered) {
      if (t > LAST_ENTRY) return null;
      if (b.h[i] > cand.hi) {
        const raw = Math.max(b.o[i], cand.hi);
        entered = {raw, px: buy(raw), t, target: raw + p.rr * (raw - cand.lo)};
        // The entry bar can also hit the stop; assume the worse outcome happens first.
        if (b.l[i] <= cand.lo) return done(cand.lo, 'stop', t);
        if (b.h[i] >= entered.target) return done(entered.target, 'target', t);
        if (t >= FLAT_AT) return done(b.c[i], 'close', t);
      }
      continue;
    }
    if (b.o[i] <= cand.lo) return done(b.o[i], 'stop', t);
    if (b.l[i] <= cand.lo) return done(cand.lo, 'stop', t);
    if (b.h[i] >= entered.target) return done(b.o[i] > entered.target ? b.o[i] : entered.target, 'target', t);
    if (t >= FLAT_AT) return done(b.c[i], 'close', t);
  }
  return entered ? done(b.c.at(-1), 'close', b.t.at(-1)) : null;
}

export function runOrb(days, params = {}, startEquity = 250) {
  const p = {...DEFAULTS, ...params};
  let equity = startEquity, peak = equity, maxDd = 0;
  const trades = [], curve = [];
  for (const day of days) {
    const cands = pickCandidates(day, p);
    let pnl = 0;
    for (const c of cands) {
      const t = tradeOne(day, c, p);
      if (!t) continue;
      const budget = equity / p.maxTrades;
      if (budget < 5) continue;
      t.pnl = budget * t.retPct / 100; pnl += t.pnl;
      trades.push(t);
    }
    equity += pnl; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak);
    curve.push({date: day.date, equity: Math.round(equity * 100) / 100, pnl: Math.round(pnl * 100) / 100, candidates: cands.length});
  }
  return {params: p, trades, curve, final: equity, maxDrawdownPct: maxDd * 100, startEquity};
}

export function summarize(run) {
  const r = x => Math.round(x * 100) / 100, t = run.trades, wins = t.filter(x => x.pnl > 0);
  const byReason = {};
  for (const x of t) (byReason[x.reason] ??= []).push(x);
  const n = run.curve.length, cut = Math.max(0, n - 10), at = i => i < 0 ? run.startEquity : run.curve[i].equity;
  return {
    days: n, trades: t.length, tradesPerDay: r(n ? t.length / n : 0), winRatePct: t.length ? r(wins.length / t.length * 100) : null,
    avgTradePct: t.length ? r(t.reduce((a, x) => a + x.retPct, 0) / t.length) : null,
    avgR: t.length ? r(t.reduce((a, x) => a + x.retPct / x.riskPct, 0) / t.length) : null,
    final: r(run.final), returnPct: r((run.final / run.startEquity - 1) * 100), maxDrawdownPct: r(run.maxDrawdownPct),
    earlyReturnPct: n > 20 ? r((at(cut - 1) / run.startEquity - 1) * 100) : null, lastTenReturnPct: n > 20 ? r((at(n - 1) / at(cut - 1) - 1) * 100) : null,
    byReason: Object.fromEntries(Object.entries(byReason).map(([k, xs]) => [k, {n: xs.length, avgPct: r(xs.reduce((a, x) => a + x.retPct, 0) / xs.length), pnl: r(xs.reduce((a, x) => a + x.pnl, 0))}])),
  };
}
