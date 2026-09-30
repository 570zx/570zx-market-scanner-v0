// Overnight-drift tests. Pure functions: no network, no clock.
//
// A day record for one symbol is {date, early, close, open1, pre: {'04:30': p, '07:00': p, '09:00': p}}:
//   close  = close of the 15:59 bar (the regular close; the bot buys at ~15:59)
//   open1  = close of the 09:30 bar (the first regular minute)
//   pre[T] = last premarket trade (04:00 onward) that completed by time T, or null
// A position bought at day D's close is sold at an exit on day D+1 and pays the
// measured half-spread (plus slippage) on each side.
import {etWall} from './time.mjs';

export const PRE_TIMES = ['04:30', '07:00', '09:00'];
export const EXITS = [...PRE_TIMES, 'open'];

// Compress one day's one-minute bars (04:00-20:00 ET) into the prices we need.
export function packDay(rows, date, early) {
  const t4 = etWall(date, '04:00'), t930 = etWall(date, '09:30'), tClose = etWall(date, early ? '13:00' : '16:00');
  const cut = Object.fromEntries(PRE_TIMES.map(t => [t, etWall(date, t)]));
  const pre = Object.fromEntries(PRE_TIMES.map(t => [t, null]));
  let close = null, open1 = null;
  for (const r of rows) {
    const start = Date.parse(r.t), end = start + 60_000;
    if (start >= t4 && end <= t930) for (const t of PRE_TIMES) if (end <= cut[t]) pre[t] = r.c; // rows are in time order
    if (start === t930) open1 = r.c;
    if (start >= t930 && end <= tClose) close = r.c; // rows are in time order: ends on the last regular bar
  }
  return {date, early, close, open1, pre};
}

const exitPrice = (day, exit) => exit === 'open' ? day.open1 : day.pre[exit];

// Buy at each close, sell at `exit` the next morning. spread: {close, open, '04:30', ...} = full relative spread.
export function runNight({days, exit, spread = {}, slip = 0.00005, costScale = 1, filter = null, id}) {
  let equity = 250; const curve = [], trades = [];
  let invested = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i], p = days[i - 1];
    if (i > 0 && p.close > 0 && !p.early && (!filter || filter(i - 1))) {
      const out = exitPrice(d, exit);
      if (out > 0) {
        const cIn = ((spread.close ?? 0) / 2 + slip) * costScale, cOut = ((spread[exit] ?? 0) / 2 + slip) * costScale;
        const r = (out * (1 - cOut)) / (p.close * (1 + cIn)) - 1;
        equity *= 1 + r; invested++;
        trades.push({date: d.date, retPct: r * 100});
      }
    }
    curve.push(equity);
  }
  return {id, curve, trades, from: 0, startEquity: 250, invested: days.length ? invested / days.length : 0};
}

// Own the stock only during regular hours (first minute to the close).
export function runDayOnly({days, spread = {}, slip = 0.00005, costScale = 1, id}) {
  let equity = 250; const curve = [], trades = [];
  for (const d of days) {
    if (!d.early && d.open1 > 0 && d.close > 0) {
      const cIn = ((spread.open ?? 0) / 2 + slip) * costScale, cOut = ((spread.close ?? 0) / 2 + slip) * costScale;
      const r = (d.close * (1 - cOut)) / (d.open1 * (1 + cIn)) - 1;
      equity *= 1 + r; trades.push({date: d.date, retPct: r * 100});
    }
    curve.push(equity);
  }
  return {id, curve, trades, from: 0, startEquity: 250, invested: 1};
}

// Buy and hold (close to close, no costs): the benchmark, price only.
export function runHold({days, id}) {
  let equity = 250, first = null; const curve = [];
  for (const d of days) {
    if (d.close > 0) { if (first == null) first = d.close; equity = 250 * d.close / first; }
    curve.push(equity);
  }
  return {id, curve, trades: [], from: 0, startEquity: 250, invested: 1};
}

// Stock version (Berkman, Koch, Tuttle & Zhang 2012): attention-grabbing stocks
// rise overnight and give it back during the day. At each close buy the n most
// extreme movers (liquid names only) and sell them at the next open.
// Rolling 20-day averages use the 20 sessions before day d (not day d itself).
export function prepareAttention({sessions, bars, universe}) {
  const n = sessions.length, prep = {};
  for (const s of universe) {
    const b = bars[s], adv = new Float32Array(n).fill(NaN), avgVol = new Float32Array(n).fill(NaN);
    let sd = 0, sv = 0, k = 0;
    for (let d = 1; d < n; d++) {
      const add = d - 1, drop = d - 21;
      if (b.c[add] > 0 && b.v[add] > 0) { sd += b.c[add] * b.v[add]; sv += b.v[add]; k++; }
      if (drop >= 0 && b.c[drop] > 0 && b.v[drop] > 0) { sd -= b.c[drop] * b.v[drop]; sv -= b.v[drop]; k--; }
      if (k >= 15) { adv[d] = sd / k; avgVol[d] = sv / k; }
    }
    prep[s] = {adv, avgVol};
  }
  return prep;
}

export function attentionPicks({sessions, bars, universe, prep, from, pick, n = 5, minPrice = 10, minAdv = 50e6}) {
  const out = new Array(sessions.length).fill(null);
  for (let d = from; d < sessions.length - 1; d++) {
    const cands = [];
    for (const s of universe) {
      const b = bars[s], c = b.c, p = prep[s];
      if (!(c[d] >= minPrice && c[d - 1] > 0 && b.o[d + 1] > 0 && p.adv[d] >= minAdv)) continue;
      const score = pick === 'gainers' ? c[d] / c[d - 1] - 1 : pick === 'losers' ? 1 - c[d] / c[d - 1] : b.v[d] / p.avgVol[d];
      if (Number.isFinite(score)) cands.push({s, score});
    }
    cands.sort((a, b) => b.score - a.score || (a.s < b.s ? -1 : 1));
    out[d] = cands.slice(0, n).map(x => x.s);
  }
  return out;
}

export function runAttention({sessions, bars, picks, from, pick, cost = 0.001, costScale = 1}) {
  let equity = 250; const curve = [], trades = [];
  const c = cost * costScale;
  for (let d = from; d < sessions.length; d++) {
    const chosen = picks[d];
    if (chosen?.length) {
      let sum = 0;
      for (const s of chosen) sum += (bars[s].o[d + 1] * (1 - c)) / (bars[s].c[d] * (1 + c)) - 1;
      const r = sum / chosen.length;
      equity *= 1 + r;
      trades.push({date: sessions[d + 1], picks: chosen.join(' '), retPct: r * 100});
    }
    curve.push(equity);
  }
  return {id: `attention_${pick}`, curve, trades, from, startEquity: 250, invested: 1};
}

export function winRate(trades) {
  const n = trades.length;
  return {n, winRatePct: n ? Math.round(trades.filter(t => t.retPct > 0).length / n * 1000) / 10 : null,
    avgPct: n ? Math.round(trades.reduce((a, t) => a + t.retPct, 0) / n * 10000) / 10000 : null};
}
