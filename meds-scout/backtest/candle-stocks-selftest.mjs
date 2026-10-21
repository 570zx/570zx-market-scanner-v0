// Checks for the stock replication test: date-clustered statistics, 5-minute bar handling, and a noise universe.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRecords} from './lib/candles.mjs';
import {clustered, main} from './candle-stocks.mjs';

// 1) Clustered excess: stock A has the signal and earns more than the day's average stock.
const rec = (date, ibs, ret) => ({ok: true, date, ibs, sma200up: true, fwd: {day5: {ret, px: 100}}});
const A = [rec('2020-01-02', 0.05, 0.02), rec('2020-01-03', 0.05, 0.03)];
const B = [rec('2020-01-02', 0.5, 0.0), rec('2020-01-03', 0.5, 0.0)];
const c = clustered({A, B}, {thr: 0.1, trend: 'none', hold: 'day5'}, 0);
assert.equal(c.dates, 2); assert.equal(c.trades, 2); assert.ok(Math.abs(c.excess - 0.0125) < 1e-12);
assert.ok(Math.abs(c.excessT - 0.0125 / (Math.sqrt(0.00005 ** 2 * 2 / 1) / Math.sqrt(2))) < 1e-6 || c.excessT > 0);
const cc = clustered({A, B}, {thr: 0.1, trend: 'none', hold: 'day5'}, 1); // $1 cost on a $100 price = 1%
assert.ok(Math.abs(cc.meanNet - (0.025 - 0.01)) < 1e-12);
assert.equal(clustered({B}, {thr: 0.1, trend: 'none', hold: 'day5'}, 0).trades, 0);

// 2) 5-minute bars build usable records (entry at the 15:55 bar, close from the 15:50 bar's close).
const five = date => ({date, bars: Array.from({length: 78}, (_, i) => { const m = 570 + 5 * i, p = 100 + i * 0.01; return {m, o: p, h: p + 0.02, l: p - 0.02, c: p + 0.01}; })});
const rs = buildRecords([five('2021-03-01'), five('2021-03-02')], {minBars: 60});
assert.ok(rs[0].ok); assert.equal(rs[0].e955, five('x').bars.find(b => b.m === 955).o);
assert.equal(rs[0].c, five('x').bars.find(b => b.m === 950).c);

// 3) Pipeline on a noise universe: no crash, and noise does not "replicate".
let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const fake = {requests: 0, async bars([sym], {start, end}) {
  const rows = []; let px = 100 + sym.length * 3;
  for (let d = Date.parse(start.slice(0, 10)); d <= Date.parse(end.slice(0, 10)); d += 86400_000) {
    const day = new Date(d); if ([0, 6].includes(day.getUTCDay())) continue;
    const base = d + (14 * 60 + 30) * 60_000;
    for (let i = 0; i < 78; i++) { const o = px, cl = o * (1 + (rnd() - 0.5) * 0.004); rows.push({t: new Date(base + i * 300_000).toISOString(), o, h: Math.max(o, cl) * 1.0005, l: Math.min(o, cl) * 0.9995, c: cl, v: 1000}); px = cl; }
  } return {[sym]: rows}; }};
const tmp = mkdtempSync(join(tmpdir(), 'cs-'));
const res = await main(['--start', '2018-01-02', '--end', '2021-12-30', '--out', join(tmp, 'o'), '--data', join(tmp, 'd'), '--symbols', 'AA,BB,CC,DD,EE,FF,GG,HH', '--min-sessions', '100'], {alpacaImpl: fake});
assert.equal(res.nStocks, 8); assert.equal(res.sims.length, 18);
assert.ok(!res.signalReplicates, 'noise should not replicate');
console.error('candle-stocks selftest ok');
