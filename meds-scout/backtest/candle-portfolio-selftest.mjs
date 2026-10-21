// Checks for the portfolio simulation: accounting, exit rules, ranking, no look-ahead, and a noise market.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRecords} from './lib/candles.mjs';
import {align, simulate, EXITS, configs, metricsFromReturns, walkForward} from './lib/portfolio.mjs';
import {main, SYMBOLS} from './candle-portfolio.mjs';

// A hand-built ETF whose every session is flat except where we say otherwise.
function day(date, o, c, {lo, hi} = {}) {
  const bars = [], n = 390; // 09:30 .. 15:59
  for (let i = 0; i < n; i++) { const m = 570 + i, p = o + (c - o) * (i / (n - 1)); bars.push({m, o: p, h: p + 0.01, l: p - 0.01, c: p}); }
  if (lo != null) bars[100].l = lo; if (hi != null) bars[100].h = hi;
  return {date, bars};
}
const dates = []; { let d = Date.parse('2022-01-03'); while (dates.length < 40) { const w = new Date(d).getUTCDay(); if (w && w !== 6) dates.push(new Date(d).toISOString().slice(0, 10)); d += 86400_000; } }
// Weak close on day 5 (closes near its low), then a quiet drift up of $0.50 a day.
function series(extra = {}) {
  const out = []; let p = 100;
  dates.forEach((d, i) => {
    if (i === 5) { const x = day(d, p, p - 1); x.bars.forEach(b => { b.h = p + 0.05; }); x.bars.at(-1).c = p - 1; out.push(x); p -= 1; }
    else { const c = p + 0.5; out.push(extra[i] ? extra[i](d, p) : day(d, p, c)); p = extra[i] ? out.at(-1).bars.at(-1).c : c; }
  });
  return out;
}
const cfg = {thr: 0.2, slots: 3, exit: 'hold3', trend: 'none'};

// 1) One trade: buy at the 15:55 open of day 5, sell 3 sessions later; accounting is exact.
let recs = {AAA: buildRecords(series())}; let al = align(recs);
let sim = simulate(al, cfg, {cost: 0, stopSlip: 0});
assert.equal(sim.trades.length, 1);
const t = sim.trades[0], entryPx = recs.AAA[5].e955, exitPx = recs.AAA[8].e955;
assert.equal(t.entry, dates[5]); assert.equal(t.exit, dates[8]);
assert.ok(Math.abs(t.ret - (exitPx / entryPx - 1)) < 1e-12);
const prod = sim.daily.reduce((a, r) => a * (1 + r), 1);
assert.ok(Math.abs(prod - sim.equity.at(-1)) < 1e-12, 'daily returns compound to equity');
assert.ok(Math.abs(sim.equity.at(-1) - (1 + (1 / cfg.slots) * (exitPx / entryPx - 1))) < 1e-9, 'one slot of three earns its share');

// 2) Costs reduce the result by exactly cost per share each way.
const paid = simulate(al, cfg, {cost: 0.01, stopSlip: 0});
assert.ok(Math.abs(paid.trades[0].ret - (exitPx - entryPx - 0.02) / entryPx) < 1e-12);

// 3) Stop: a crash day after entry exits at the stop (gap or intraday), never better than the stop level.
const crash = series({6: (d, p) => day(d, p * 0.99, p * 0.99, {lo: p * 0.9})});
recs = {AAA: buildRecords(crash)}; al = align(recs);
sim = simulate(al, {...cfg, exit: 'hold3+stop4'}, {cost: 0, stopSlip: 0});
assert.equal(sim.trades[0].why, 'stop'); assert.ok(Math.abs(sim.trades[0].ret + 0.04) < 1e-9);
sim = simulate(al, cfg, {cost: 0, stopSlip: 0}); assert.equal(sim.trades[0].why, 'time');

// 4) Sell-on-strength exits the first day the close is above the prior day's high (day 6 jumps $2).
recs = {AAA: buildRecords(series({6: (d, p) => day(d, p, p + 2)}))}; al = align(recs);
sim = simulate(al, {...cfg, exit: 'strength5'}, {cost: 0, stopSlip: 0});
assert.equal(sim.trades[0].exit, dates[6]); assert.equal(sim.trades[0].why, 'strength');

// 5) Ranking: with one slot the most oversold ETF is chosen, not the first listed.
const weak = series(), weaker = series().map((d, i) => i === 5 ? (() => { const x = day(d.date, 100, 98.5); x.bars.forEach(b => { b.h = 100.05; }); return x; })() : d);
recs = {AAA: buildRecords(weak), BBB: buildRecords(weaker)}; al = align(recs);
assert.ok(recs.BBB[5].ibs < recs.AAA[5].ibs);
sim = simulate(al, {...cfg, slots: 1}, {cost: 0, stopSlip: 0}); assert.equal(sim.trades[0].sym, 'BBB');

// 6) No look-ahead: changing sessions after day 5 does not change the entry made on day 5.
const alt = series().map((d, i) => i > 5 ? day(d.date, 50, 20) : d);
const altSim = simulate(align({AAA: buildRecords(alt)}), cfg, {cost: 0, stopSlip: 0});
assert.equal(altSim.trades[0].entry, dates[5]);
assert.equal(simulate(align({AAA: buildRecords(alt)}), cfg, {cost: 0, stopSlip: 0}).daily[5], 0);

// 7) Pipeline on pure noise: walk-forward must not look good, and every grid configuration runs.
let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const fake = {requests: 0, async bars([sym], {start, end}) {
  const rows = []; let px = 100 + sym.length;
  for (let d = Date.parse(start.slice(0, 10)); d <= Date.parse(end.slice(0, 10)); d += 86400_000) {
    const day = new Date(d); if ([0, 6].includes(day.getUTCDay())) continue;
    const base = d + (14 * 60 + 30) * 60_000;
    for (let i = 0; i < 390; i++) { const o = px, c = o * (1 + (rnd() - 0.5) * 0.0008); rows.push({t: new Date(base + i * 60_000).toISOString(), o, h: Math.max(o, c) * 1.0001, l: Math.min(o, c) * 0.9999, c, v: 1000}); px = c; }
  } return {[sym]: rows}; }};
const tmp = mkdtempSync(join(tmpdir(), 'cp-'));
const res = await main(['--start', '2019-01-02', '--end', '2024-12-30', '--out', join(tmp, 'o'), '--data', join(tmp, 'd'), '--symbols', 'AAA,BBB,CCC,SPY', '--first-test-year', '2021'], {alpacaImpl: fake});
assert.equal(res.nCfg, configs().length);
assert.ok(res.wf.sharpe < 1.5, 'noise should not give a high walk-forward Sharpe: ' + res.wf.sharpe);
console.error('candle-portfolio selftest ok');
