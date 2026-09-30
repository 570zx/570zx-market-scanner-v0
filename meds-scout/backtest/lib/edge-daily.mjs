// Daily allocation backtester for the "edge hunt": each strategy turns data
// through the close of day d into target weights, and the portfolio trades to
// them at that close ('close' strategies, which the bot can do at 15:55 with a
// live quote) or at the next open ('open'). Every change in weight pays a
// cost per side. Pure functions: no network, no clock.
//
// Data: sessions = ['YYYY-MM-DD', ...]; bars = {SYM: {o,h,l,c,v}} with one
// Float64Array per field (NaN where the symbol did not trade), total-return
// (dividend and split) adjusted for ETFs.

export const CASH = '$CASH';

// ---------------------------------------------------------------- indicators
export function sma(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  let sum = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i])) { sum += a[i]; cnt++; }
    if (i >= n && Number.isFinite(a[i - n])) { sum -= a[i - n]; cnt--; }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

export function rsiWilder(c, n) {
  const out = new Float64Array(c.length).fill(NaN);
  let gain = 0, loss = 0, count = 0, seeded = false;
  for (let i = 1; i < c.length; i++) {
    if (!Number.isFinite(c[i]) || !Number.isFinite(c[i - 1])) { seeded = false; count = 0; gain = loss = 0; continue; }
    const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (!seeded) { gain += g; loss += l; if (++count === n) { gain /= n; loss /= n; seeded = true; } else continue; }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// Internal bar strength: where the close sits in the day's range (0 = low, 1 = high).
export const ibs = (bar, d) => { const r = bar.h[d] - bar.l[d]; return r > 0 ? (bar.c[d] - bar.l[d]) / r : 0.5; };

// Annualized standard deviation of daily returns over the n days ending at d.
export function trailingVol(c, d, n) {
  const rets = [];
  for (let i = d - n + 1; i <= d; i++) { if (i < 1 || !(c[i] > 0 && c[i - 1] > 0)) return NaN; rets.push(c[i] / c[i - 1] - 1); }
  const m = rets.reduce((a, x) => a + x, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, x) => a + (x - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
}

export const ret = (c, d, n) => (c[d - n] > 0 && c[d] > 0 ? c[d] / c[d - n] - 1 : NaN);
export const lastOfMonth = (sessions, d) => d === sessions.length - 1 || sessions[d + 1].slice(0, 7) !== sessions[d].slice(0, 7);

// ---------------------------------------------------------------- engine
// strategy: {id, label, exec: 'close'|'open', cost (per side), band (min weight change to trade),
//            init(ctx) -> state, weights(ctx, d, state) -> {sym: w} | null (null = keep holdings)}
export function runAllocation({sessions, bars, strategy, from, to = sessions.length - 1, startEquity = 250, costScale = 1}) {
  const cost = sym => (strategy.costFor?.(sym) ?? strategy.cost ?? 0.0005) * costScale;
  const ctx = {sessions, bars, ind: {}, cache: new Map()};
  const state = strategy.init?.(ctx) ?? {};
  let cash = startEquity;
  const shares = new Map();
  const curve = [], trades = [];
  let pending = null, invested = 0, turnover = 0;
  const price = (sym, d, f) => bars[sym]?.[f]?.[d];
  const value = (d, f) => {
    let v = cash;
    for (const [s, q] of shares) { const p = price(s, d, f); v += q * (Number.isFinite(p) ? p : lastGood(bars[s].c, d)); }
    return v;
  };
  const rebalance = (target, d, f) => {
    const equity = value(d, f);
    if (!(equity > 0)) return;
    const syms = new Set([...shares.keys(), ...Object.keys(target)]);
    // Sells first so their proceeds fund the buys.
    const legs = [];
    for (const s of syms) {
      if (s === CASH) continue;
      const p = price(s, d, f);
      if (!(p > 0)) continue; // cannot trade a symbol with no price today
      const cur = (shares.get(s) ?? 0) * p, want = (target[s] ?? 0) * equity;
      if (Math.abs(want - cur) / equity < (strategy.band ?? 0) && want > 0 && cur > 0) continue;
      if (Math.abs(want - cur) < 0.01) continue;
      legs.push({s, p, delta: want - cur});
    }
    legs.sort((a, b) => a.delta - b.delta);
    for (const {s, p, delta} of legs) {
      let dv = delta;
      if (dv > 0) dv = Math.min(dv, cash / (1 + cost(s))); // cash account: no borrowing
      if (Math.abs(dv) < 0.01) continue;
      const fee = Math.abs(dv) * cost(s);
      cash -= dv + fee;
      shares.set(s, (shares.get(s) ?? 0) + dv / p);
      if (Math.abs(shares.get(s)) < 1e-9) shares.delete(s);
      turnover += Math.abs(dv) / equity;
      trades.push({date: sessions[d], sym: s, side: dv > 0 ? 'buy' : 'sell', value: Math.abs(dv), price: p, fee});
    }
  };
  for (let d = from; d <= to; d++) {
    if (strategy.exec === 'open' && pending) { rebalance(pending, d, 'o'); pending = null; }
    const target = strategy.weights(ctx, d, state);
    if (target) {
      if (strategy.exec === 'open') pending = d < to ? target : null;
      else rebalance(target, d, 'c');
    }
    const eq = value(d, 'c');
    curve.push(eq);
    let risky = 0;
    for (const [s, q] of shares) if (!strategy.cashLike?.includes(s)) risky += q * (price(s, d, 'c') || 0);
    if (eq > 0 && risky / eq > 0.05) invested++;
  }
  return {id: strategy.id, curve, trades, from, to, startEquity, invested: (to - from + 1) ? invested / (to - from + 1) : 0, turnover};
}

function lastGood(c, d) { for (let i = d; i >= 0 && i > d - 30; i--) if (Number.isFinite(c[i])) return c[i]; return 0; }

// ---------------------------------------------------------------- statistics
export function curveStats(run, sessions, {holdoutFrom = '2025-01-01'} = {}) {
  const c = run.curve, start = run.startEquity, from = run.from, n = c.length;
  const r = x => Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
  const final = c.at(-1) ?? start;
  let peak = start, maxDd = 0;
  const daily = [];
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, c[i]); maxDd = Math.max(maxDd, (peak - c[i]) / peak);
    daily.push(c[i] / (i ? c[i - 1] : start) - 1);
  }
  const mean = daily.reduce((a, x) => a + x, 0) / Math.max(1, daily.length);
  const sd = Math.sqrt(daily.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, daily.length - 1));
  const years = n / 252;
  const byYear = {};
  let prev = start;
  for (let i = 0; i < n; i++) {
    const y = sessions[from + i].slice(0, 4);
    (byYear[y] ??= [prev, c[i]])[1] = c[i]; prev = c[i];
  }
  const cut = sessions.findIndex((s, i) => i >= from && s >= holdoutFrom);
  const at = i => i < 0 ? start : c[i];
  const split = cut > from && cut <= from + n - 1 ? {before: at(cut - from - 1) / start - 1, after: final / at(cut - from - 1) - 1} : null;
  return {
    id: run.id, final: r(final), returnPct: r((final / start - 1) * 100), cagrPct: r(((final / start) ** (1 / years) - 1) * 100),
    maxDrawdownPct: r(maxDd * 100), sharpe: sd > 0 ? r(mean / sd * Math.sqrt(252)) : null,
    trades: run.trades.length, tradesPerYear: r(run.trades.length / years), investedPct: r(run.invested * 100),
    byYear: Object.fromEntries(Object.entries(byYear).map(([y, [a, b]]) => [y, r((b / a - 1) * 100)])),
    beforeHoldoutPct: split ? r(split.before * 100) : null, holdoutPct: split ? r(split.after * 100) : null,
    from: sessions[from], to: sessions[from + n - 1],
  };
}

// ---------------------------------------------------------------- strategies
const col = (ctx, key, make) => { if (!ctx.cache.has(key)) ctx.cache.set(key, make()); return ctx.cache.get(key); };
const smaOf = (ctx, sym, n) => col(ctx, `sma:${sym}:${n}`, () => sma(ctx.bars[sym].c, n));
const rsiOf = (ctx, sym, n) => col(ctx, `rsi:${sym}:${n}`, () => rsiWilder(ctx.bars[sym].c, n));

export const buyHold = sym => ({
  id: `hold_${sym}`, label: `Buy and hold ${sym} (benchmark)`, exec: 'close', cost: 0.0005,
  weights: (ctx, d, st) => { if (st.done || !(ctx.bars[sym].c[d] > 0)) return null; st.done = true; return {[sym]: 1}; },
});

// Buy a weak close, sell a strong one. No stop (stops hurt mean reversion).
export const ibsReversion = sym => ({
  id: `ibs_${sym}`, label: `IBS mean reversion on ${sym}: buy at the close when the close is in the bottom 20% of the day's range; sell at the close when it is in the top 20%. Cash when out.`,
  exec: 'close', cost: 0.0005,
  weights(ctx, d, st) {
    const b = ctx.bars[sym]; if (!(b.c[d] > 0)) return null;
    const x = ibs(b, d);
    if (!st.in && x < 0.2) { st.in = true; return {[sym]: 1}; }
    if (st.in && x > 0.8) { st.in = false; return {}; }
    return null;
  },
});

// Connors RSI(2): buy short dips in an uptrend, sell into the bounce.
export const rsi2Reversion = sym => ({
  id: `rsi2_${sym}`, label: `RSI(2) mean reversion on ${sym}: buy at the close when above its 200-day average and RSI(2) < 10; sell at the close above the 5-day average. Cash when out.`,
  exec: 'close', cost: 0.0005,
  weights(ctx, d, st) {
    const c = ctx.bars[sym].c; if (!(c[d] > 0)) return null;
    const s200 = smaOf(ctx, sym, 200)[d], s5 = smaOf(ctx, sym, 5)[d], r2 = rsiOf(ctx, sym, 2)[d];
    if (!st.in && c[d] > s200 && r2 < 10) { st.in = true; return {[sym]: 1}; }
    if (st.in && c[d] > s5) { st.in = false; return {}; }
    return null;
  },
});

// Hold `hold` while `signal` is above its 200-day average, otherwise T-bills.
// With a band: enter 5% above the average, leave 3% below it (fewer whipsaws).
export const trendSwitch = (signal, hold, {band = false} = {}) => ({
  id: `trend_${hold}${band ? '_band' : ''}`,
  label: `Hold ${hold} while ${signal} closes ${band ? 'more than 5% above its 200-day average (leave when it closes 3% below)' : 'above its 200-day average'}; otherwise BIL (T-bills). Decided and traded at the close.`,
  exec: 'close', cost: 0.0005, cashLike: ['BIL'],
  weights(ctx, d, st) {
    const c = ctx.bars[signal].c, m = smaOf(ctx, signal, 200)[d];
    if (!(c[d] > 0) || !Number.isFinite(m)) return null;
    const up = band ? (st.in ? c[d] > m * 0.97 : c[d] > m * 1.05) : c[d] > m;
    if (st.in === up) return null;
    st.in = up;
    return up ? {[hold]: 1} : {BIL: 1};
  },
});

// Multi-asset ETF momentum rotation (Faber / Antonacci style), monthly.
export const ROTATION_UNIVERSE = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ'];
export const etfRotation = ({universe = ROTATION_UNIVERSE, top = 4} = {}) => ({
  id: 'etf_rotation', label: `ETF rotation: at each month-end, of ${universe.join(', ')}, hold the ${top} with the best average 1/3/6/12-month return that are above their 210-day average and beat T-bills over 12 months; weight by inverse 60-day volatility; unused slots in BIL.`,
  exec: 'close', cost: 0.0005, band: 0.05, cashLike: ['BIL'],
  weights(ctx, d) {
    if (!lastOfMonth(ctx.sessions, d)) return null;
    const bilRet = ret(ctx.bars.BIL.c, d, 252);
    const picks = [];
    for (const s of universe) {
      const c = ctx.bars[s]?.c; if (!c || !(c[d] > 0)) continue;
      const rs = [21, 63, 126, 252].map(n => ret(c, d, n)); if (rs.some(x => !Number.isFinite(x))) continue;
      const m = smaOf(ctx, s, 210)[d];
      if (!(c[d] > m) || !(rs[3] > (Number.isFinite(bilRet) ? bilRet : 0))) continue;
      const vol = trailingVol(c, d, 60); if (!(vol > 0)) continue;
      picks.push({s, score: rs.reduce((a, x) => a + x, 0) / 4, inv: 1 / vol});
    }
    if (!Number.isFinite(ret(ctx.bars.BIL.c, d, 1)) && !picks.length) return null;
    picks.sort((a, b) => b.score - a.score);
    const chosen = picks.slice(0, top), w = {};
    const invSum = chosen.reduce((a, p) => a + p.inv, 0);
    for (const p of chosen) w[p.s] = (p.inv / invSum) * (chosen.length / top);
    const rest = 1 - Object.values(w).reduce((a, x) => a + x, 0);
    if (rest > 1e-9) w.BIL = rest;
    return w;
  },
});

// Diversified large-cap momentum with a market-regime switch and volatility scaling.
export const momentumBook = ({names = 15, minAdv = 300e6, minPrice = 20, targetVol = 0.15, exclude = new Set()} = {}) => ({
  id: `momentum_${names}`, label: `Stock momentum: at each month-end, the ${names} large US stocks (not ETFs; over $${minAdv / 1e6}M traded a day, price over $${minPrice}) with the best 12-month return skipping the last month, equal weight. SPY below its 200-day average: half size; also falling: all BIL. Scaled down when the book's 6-month volatility is above ${targetVol * 100}%.`,
  exec: 'close', cost: 0.001, band: 0.01, cashLike: ['BIL'],
  init(ctx) { ctx.universe = Object.keys(ctx.bars).filter(s => !exclude.has(s) && !['BIL', 'SPY'].includes(s)); return {}; },
  weights(ctx, d) {
    if (!lastOfMonth(ctx.sessions, d)) return null;
    const spy = ctx.bars.SPY.c, m200 = smaOf(ctx, 'SPY', 200);
    if (!(spy[d] > 0) || !Number.isFinite(m200[d])) return null;
    const regime = spy[d] > m200[d] ? 1 : m200[d] < m200[d - 21] ? 0 : 0.5;
    const ranked = [];
    for (const s of ctx.universe) {
      const b = ctx.bars[s], c = b.c;
      if (!(c[d] >= minPrice)) continue;
      let dollar = 0, days = 0;
      for (let i = d - 19; i <= d; i++) if (c[i] > 0 && b.v[i] > 0) { dollar += c[i] * b.v[i]; days++; }
      if (days < 18 || dollar / days < minAdv) continue;
      const mom = c[d - 21] > 0 && c[d - 252] > 0 ? c[d - 21] / c[d - 252] - 1 : NaN;
      if (Number.isFinite(mom)) ranked.push({s, mom});
    }
    ranked.sort((a, b) => b.mom - a.mom);
    const chosen = ranked.slice(0, names).map(x => x.s);
    if (!chosen.length || regime === 0) return {BIL: 1};
    // Ex-ante volatility of the equal-weight book over the last 126 days.
    const rets = [];
    for (let i = d - 125; i <= d; i++) {
      let sum = 0, k = 0;
      for (const s of chosen) { const c = ctx.bars[s].c; if (c[i] > 0 && c[i - 1] > 0) { sum += c[i] / c[i - 1] - 1; k++; } }
      if (k) rets.push(sum / k);
    }
    const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
    const vol = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
    const exposure = regime * Math.min(1, vol > 0 ? targetVol / vol : 1);
    const w = Object.fromEntries(chosen.map(s => [s, exposure / chosen.length]));
    if (exposure < 1) w.BIL = 1 - exposure;
    return w;
  },
});
