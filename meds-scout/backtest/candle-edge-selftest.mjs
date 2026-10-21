// Checks for the candle-pattern search: no look-ahead, correct features, and a noise-only market finds nothing.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildRecords, trades, configs, px} from './lib/candles.mjs';
import {main, OPT} from './candle-edge.mjs';

let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const mkDay = (date, start, drift = 0) => { const bars = []; let p = start; for (let m = 570; m < 960; m++) { const o = p, c = o * (1 + drift + (rnd() - 0.5) * 0.0006); bars.push({m, o, h: Math.max(o, c) * 1.0001, l: Math.min(o, c) * 0.9999, c}); p = c; } return {date, bars}; };
const mkDays = (n, start = 100) => { const out = []; let p = start, d = Date.parse('2020-01-01'); while (out.length < n) { d += 86400_000; const wd = new Date(d).getUTCDay(); if (wd === 0 || wd === 6) continue; const day = mkDay(new Date(d).toISOString().slice(0, 10), p); p = day.bars.at(-1).c; out.push(day); } return out; };

// 1) Features of day i do not change when later days change (no look-ahead); forward returns do.
const days = mkDays(60), a = buildRecords(days);
const altered = days.map((d, i) => i >= 41 ? mkDay(d.date, 300) : d), b = buildRecords(altered);
for (let i = 0; i <= 40; i++) for (const k of ['ibs', 'ret1', 'down', 'up', 'rsi2', 'r30', 'ibs30', 'gap', 'sma50up', 'r930']) assert.deepEqual(a[i][k], b[i][k], `${k} changed on day ${i}`);
assert.notEqual(a[40].fwd.day1.ret, b[40].fwd.day1.ret);

// 2) Today's own 15:55-15:59 bars are not used by today's candle (the close is the 15:54 bar close).
const tweak = days.map((d, i) => i === 30 ? {...d, bars: d.bars.map(x => x.m >= 955 ? {...x, c: x.c * 1.05, h: x.h * 1.05} : x)} : d), c = buildRecords(tweak);
assert.equal(c[30].c, a[30].c); assert.equal(c[30].ibs, a[30].ibs);

// 3) Entry price is the open of the 15:55 bar.
assert.equal(a[10].e955, days[10].bars.find(x => x.m === 955).o);
assert.equal(px(days[0].bars, 600).m, 600);

// 4) Early-close sessions (no 15:55 bar) are skipped, not mis-timed.
const early = mkDays(5).map((d, i) => i === 2 ? {...d, bars: d.bars.filter(x => x.m < 780)} : d);
assert.equal(buildRecords(early)[2].ok, false);

// 5) End to end on pure noise: the search must not report a passing configuration.
function fake(drift) { return {requests: 0, async bars([sym], {start, end}) {
  const rows = []; let px = 100 + sym.length;
  for (let d = Date.parse(start.slice(0, 10)); d <= Date.parse(end.slice(0, 10)); d += 86400_000) {
    const day = new Date(d); if ([0, 6].includes(day.getUTCDay())) continue;
    const base = d + (14 * 60 + 30) * 60_000;
    for (let i = 0; i < 390; i++) { const o = px, c = o * (1 + drift + (rnd() - 0.5) * 0.0008); rows.push({t: new Date(base + i * 60_000).toISOString(), o, h: Math.max(o, c) * 1.0001, l: Math.min(o, c) * 0.9999, c, v: 1000}); px = c; }
  } return {[sym]: rows}; }}; }
const tmp = mkdtempSync(join(tmpdir(), 'ce-'));
const res = await main(['--start', '2019-01-02', '--end', '2024-06-28', '--out', join(tmp, 'o'), '--data', join(tmp, 'd'), '--symbols', 'AAA,BBB,CCC,DDD', '--nulls', '3'], {alpacaImpl: fake(0)});
assert.equal(res.tried, configs().length);
assert.ok(!res.top.some(t => t.pass), 'noise produced a passing configuration');
console.error('candle-edge selftest ok');
