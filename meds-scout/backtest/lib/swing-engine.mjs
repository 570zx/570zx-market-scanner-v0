// Daily-bar swing-trading simulator. Pure functions: no network, no clock.
//
// Timing (no look-ahead): a signal is computed from bars up to and including
// day d (the close). The order fills at the OPEN of day d+1. Stops are checked
// against the day's low and fill at the stop, or at the open if the stock
// gapped through it. Every fill pays a cost per side (half-spread + slippage).
//
// Data: sessions = ['YYYY-MM-DD', ...]; bars = {SYM: {o,h,l,c,v}} with one
// Float64Array per field, length = sessions.length, NaN where the stock did
// not trade that day.

export const WARMUP = 210; // sessions needed for the 200-day average

function rollingMean(a, n) {
  const out = new Float64Array(a.length).fill(NaN);
  let sum = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i])) { sum += a[i]; cnt++; }
    const j = i - n;
    if (j >= 0 && Number.isFinite(a[j])) { sum -= a[j]; cnt--; }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

// Wilder RSI over `n` closes.
function rsi(c, n) {
  const out = new Float64Array(c.length).fill(NaN);
  let gain = 0, loss = 0, seeded = false, seedGain = 0, seedLoss = 0, count = 0;
  for (let i = 1; i < c.length; i++) {
    if (!Number.isFinite(c[i]) || !Number.isFinite(c[i - 1])) { seeded = false; count = 0; seedGain = seedLoss = 0; continue; }
    const ch = c[i] - c[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (!seeded) {
      seedGain += g; seedLoss += l; count++;
      if (count === n) { gain = seedGain / n; loss = seedLoss / n; seeded = true; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

function atr(h, l, c, n) {
  const tr = new Float64Array(c.length).fill(NaN);
  for (let i = 1; i < c.length; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  return rollingMean(tr, n);
}

export function indicators(bar) {
  const dollar = new Float64Array(bar.c.length);
  for (let i = 0; i < dollar.length; i++) dollar[i] = bar.c[i] * bar.v[i];
  return {
    sma5: rollingMean(bar.c, 5), sma50: rollingMean(bar.c, 50), sma200: rollingMean(bar.c, 200),
    rsi2: rsi(bar.c, 2), atr14: atr(bar.h, bar.l, bar.c, 14),
    adv20: rollingMean(dollar, 20), vol20: rollingMean(bar.v, 20),
  };
}

// ---------------------------------------------------------------- strategies
// A strategy says which stocks to buy after a close and when to sell.
//   entries(ctx, d) -> [{sym, score, stopPct}]   (higher score first)
//   exitReason(ctx, pos, d) -> string | null      (decided at close d, sells at open d+1)
// ctx = {sessions, bars, ind}

const liquid = (ctx, s, d, minAdv, minPrice) => {
  const c = ctx.bars[s].c[d], adv = ctx.ind[s].adv20[d];
  return Number.isFinite(c) && c >= minPrice && Number.isFinite(adv) && adv >= minAdv;
};

// Buy strong uptrends after a sharp short-term dip; sell when they bounce.
export const pullback = {
  cost: 0.001,
  id: 'pullback', label: 'Trend pullback: above 50 and 200-day averages, RSI(2) under 10; sell on a close above the 5-day average or after 8 days; stop 2.5 ATR',
  maxPositions: 3, maxHold: 8,
  entries(ctx, d) {
    const out = [];
    for (const s of ctx.symbols) {
      if (!liquid(ctx, s, d, 30e6, 10)) continue;
      const b = ctx.bars[s], I = ctx.ind[s], c = b.c[d];
      if (!(c > I.sma200[d] && c > I.sma50[d] && I.rsi2[d] < 10 && c < I.sma5[d])) continue;
      const a = I.atr14[d]; if (!(a > 0)) continue;
      out.push({sym: s, score: 100 - I.rsi2[d], stopPct: Math.min(0.2, 2.5 * a / c)});
    }
    return out;
  },
  exitReason(ctx, pos, d) {
    if (ctx.bars[pos.sym].c[d] > ctx.ind[pos.sym].sma5[d]) return 'bounce';
    return null;
  },
};

// A stock gaps up hard on heavy volume and holds its gains: buy it, hold ~2 weeks.
export const gapDrift = {
  cost: 0.003, // buying the open after a gap: wider spreads
  id: 'gap_drift', label: 'Gap and hold: up 8%+ at the open on 3x volume, closes near its high; hold 10 days; stop 8% or a close under the gap day\'s low',
  maxPositions: 3, maxHold: 10,
  entries(ctx, d) {
    const out = [];
    for (const s of ctx.symbols) {
      if (!liquid(ctx, s, d, 20e6, 8)) continue;
      const b = ctx.bars[s], I = ctx.ind[s];
      const prev = b.c[d - 1], v20 = I.vol20[d - 1];
      if (!(prev > 0 && v20 > 0)) continue;
      const gap = b.o[d] / prev - 1, range = b.h[d] - b.l[d];
      if (gap >= 0.08 && b.v[d] >= 3 * v20 && b.c[d] >= b.o[d] && range > 0 && (b.c[d] - b.l[d]) / range >= 0.7)
        out.push({sym: s, score: b.v[d] / v20, stopPct: 0.08, gapLow: b.l[d]});
    }
    return out;
  },
  exitReason(ctx, pos, d) {
    if (pos.gapLow != null && ctx.bars[pos.sym].c[d] < pos.gapLow) return 'lost_gap';
    return null;
  },
};

// Hold the three strongest 6-month performers in uptrends; re-pick monthly.
export const momentum = {
  cost: 0.001,
  id: 'momentum', label: 'Momentum: monthly, hold the 3 best 6-month performers (skipping the last week) that are above their 200-day average; 20% stop',
  maxPositions: 3, maxHold: 400,
  entries(ctx, d) {
    if (!ctx.firstOfMonth(d)) return [];
    const out = [];
    for (const s of ctx.symbols) {
      if (!liquid(ctx, s, d, 30e6, 10)) continue;
      const c = ctx.bars[s].c, I = ctx.ind[s];
      if (!(c[d] > I.sma200[d])) continue;
      const a = c[d - 5], b = c[d - 126];
      if (!(a > 0 && b > 0)) continue;
      out.push({sym: s, score: a / b - 1, stopPct: 0.2});
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 3);
  },
  exitReason(ctx, pos, d) {
    if (!ctx.firstOfMonth(d)) return null;
    return ctx.topNow?.has(pos.sym) ? null : 'rebalance';
  },
  rebalances: true,
};

// Keep only stocks that were ever liquid enough to matter (saves memory).
export function everLiquid(bar, minAdv = 20e6, minPrice = 8) {
  const dollar = new Float64Array(bar.c.length);
  for (let i = 0; i < dollar.length; i++) dollar[i] = bar.c[i] * bar.v[i];
  const adv = rollingMean(dollar, 20);
  for (let i = 0; i < adv.length; i++) if (adv[i] >= minAdv && bar.c[i] >= minPrice) return true;
  return false;
}

export const STRATEGIES = [pullback, gapDrift, momentum];

// ---------------------------------------------------------------- simulator
export function simulate({sessions, bars, ind, strategy, startEquity = 250, costPct = strategy?.cost ?? 0.001, from = WARMUP, to = sessions.length - 1, benchmark = null}) {
  const symbols = Object.keys(bars);
  const monthOf = d => sessions[d].slice(0, 7);
  const ctx = {sessions, bars, ind, symbols, firstOfMonth: d => d > 0 && monthOf(d) !== monthOf(d - 1)};
  let cash = startEquity;
  const open = [], trades = [], curve = [];
  let pendingEntries = [], pendingExits = new Map(); // sym -> reason
  let exposureDays = 0;

  const fillBuy = px => px * (1 + costPct), fillSell = px => px * (1 - costPct);
  const close = (pos, px, d, reason) => {
    const proceeds = pos.qty * fillSell(px);
    cash += proceeds;
    trades.push({sym: pos.sym, entry: sessions[pos.entryDay], exit: sessions[d], entryPx: pos.entryPx, exitPx: fillSell(px), qty: pos.qty,
      pnl: proceeds - pos.cost, retPct: (fillSell(px) / pos.entryPx - 1) * 100, days: d - pos.entryDay, reason});
    open.splice(open.indexOf(pos), 1);
  };

  for (let d = from; d <= to; d++) {
    // 1. Orders decided at yesterday's close fill at today's open.
    for (const pos of [...open]) {
      const reason = pendingExits.get(pos.sym);
      if (reason && Number.isFinite(bars[pos.sym].o[d])) close(pos, bars[pos.sym].o[d], d, reason);
    }
    pendingExits = new Map();
    if (benchmark) {
      if (d === from && !open.length) { const o = bars[benchmark].o[d]; const qty = cash / fillBuy(o); open.push({sym: benchmark, qty, entryPx: fillBuy(o), cost: qty * fillBuy(o), entryDay: d, stopPx: 0}); cash = 0; }
    } else {
      const slots = strategy.maxPositions - open.length;
      let bought = 0;
      for (const cand of pendingEntries) {
        if (bought >= slots) break;
        if (open.some(p => p.sym === cand.sym)) continue;
        const o = bars[cand.sym].o[d];
        if (!(o > 0)) continue;
        const budget = Math.min(cash, (cash + open.reduce((a, p) => a + p.qty * (bars[p.sym].c[d - 1] || p.entryPx), 0)) / strategy.maxPositions);
        if (budget < 5) continue;
        const px = fillBuy(o), qty = budget / px;
        cash -= qty * px;
        open.push({sym: cand.sym, qty, entryPx: px, cost: qty * px, entryDay: d, stopPx: o * (1 - cand.stopPct), gapLow: cand.gapLow});
        bought++;
      }
    }
    pendingEntries = [];
    // 2. Intraday stops.
    for (const pos of [...open]) {
      const b = bars[pos.sym];
      if (!Number.isFinite(b.l[d])) {
        // No bar (halt or delisting): after 5 missing sessions assume it was closed out at 80% of the last close.
        pos.missing = (pos.missing ?? 0) + 1;
        if (pos.missing >= 5) close(pos, 0.8 * lastClose(b.c, d), d, 'no_data');
        continue;
      }
      pos.missing = 0;
      if (pos.stopPx > 0 && b.l[d] <= pos.stopPx) close(pos, Math.min(pos.stopPx, b.o[d]), d, 'stop');
    }
    // 3. Close: mark to market, then decide tomorrow's orders from today's data.
    let value = cash;
    for (const pos of open) value += pos.qty * lastClose(bars[pos.sym].c, d);
    curve.push(value);
    if (open.length) exposureDays++;
    if (benchmark || d >= to) continue;
    if (strategy.rebalances && ctx.firstOfMonth(d)) ctx.topNow = new Set(strategy.entries(ctx, d).map(c => c.sym));
    for (const pos of open) {
      const reason = strategy.exitReason(ctx, pos, d) ?? (d - pos.entryDay >= strategy.maxHold ? 'time' : null);
      if (reason) pendingExits.set(pos.sym, reason);
    }
    pendingEntries = strategy.entries(ctx, d).sort((a, b) => b.score - a.score || (a.sym < b.sym ? -1 : 1));
  }
  // Mark anything still open at the last close (not sold).
  return {strategy: benchmark ? 'buy_and_hold_' + benchmark : strategy.id, trades, curve, from, to, exposure: (to - from + 1) ? exposureDays / (to - from + 1) : 0,
    open: open.map(p => ({sym: p.sym, entry: sessions[p.entryDay]})), startEquity};
}

function lastClose(c, d) {
  for (let i = d; i >= 0 && i > d - 30; i--) if (Number.isFinite(c[i])) return c[i];
  return NaN;
}

// ---------------------------------------------------------------- statistics
export function statsFor(run, sessions) {
  const c = run.curve, start = run.startEquity, from = run.from;
  const final = c.at(-1) ?? start;
  let peak = start, maxDd = 0;
  for (const v of c) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, (peak - v) / peak); }
  const wins = run.trades.filter(t => t.pnl > 0);
  const yearEnd = new Map(); // year -> [firstEquity, lastEquity]
  let prev = start;
  c.forEach((v, i) => {
    const y = sessions[from + i].slice(0, 4);
    const e = yearEnd.get(y) ?? [prev, v]; e[1] = v; yearEnd.set(y, e); prev = v;
  });
  const cut = sessions.findIndex(s => s >= '2025-01-01');
  const split = cut > from && cut <= from + c.length - 1 ? {before: c[cut - from - 1] / start - 1, after: final / c[cut - from - 1] - 1} : null;
  const r = x => Math.round(x * 100) / 100;
  return {
    id: run.strategy, final: r(final), returnPct: r((final / start - 1) * 100), maxDrawdownPct: r(maxDd * 100),
    trades: run.trades.length, winRatePct: run.trades.length ? r(wins.length / run.trades.length * 100) : null,
    avgTradePct: run.trades.length ? r(run.trades.reduce((a, t) => a + t.retPct, 0) / run.trades.length) : null,
    avgHoldDays: run.trades.length ? r(run.trades.reduce((a, t) => a + t.days, 0) / run.trades.length) : null,
    exposurePct: r(run.exposure * 100),
    byYear: Object.fromEntries([...yearEnd].map(([y, [a, b]]) => [y, r((b / a - 1) * 100)])),
    beforeAfter2025: split ? {before2025Pct: r(split.before * 100), from2025Pct: r(split.after * 100)} : null,
    byExit: Object.fromEntries(Object.entries(groupBy(run.trades, t => t.reason)).map(([k, ts]) => [k,
      {n: ts.length, avgPct: r(ts.reduce((a, t) => a + t.retPct, 0) / ts.length), pnl: r(ts.reduce((a, t) => a + t.pnl, 0))}])),
  };
}

function groupBy(list, f) { const o = {}; for (const x of list) (o[f(x)] ??= []).push(x); return o; }
