// Sanity checks for the first-candle-rule engine and runner (no network).
import assert from 'node:assert/strict';
import {findSetup, resolveExit, tradeR, runDays, stats, openingLevels} from './lib/fcr.mjs';
import {main, analyse} from './fcr.mjs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const B = (m, o, h, l, c) => ({m, o, h, l, c});
const orb = [B(570, 100, 100.5, 99.8, 100.2), B(571, 100.2, 100.4, 99.6, 99.9), B(572, 99.9, 100.1, 99.5, 99.7), B(573, 99.7, 100.0, 99.6, 99.9), B(574, 99.9, 100.2, 99.7, 100.0)];
assert.deepEqual(openingLevels(orb), {high: 100.5, low: 99.5});

const shortDay = [...orb,
  B(575, 99.9, 100.0, 99.7, 99.8),   // candle before the breakout
  B(576, 99.7, 99.7, 99.1, 99.2),    // closes below 99.5
  B(577, 99.2, 99.3, 98.9, 99.0),    // leaves a gap: 99.3 .. 99.7
  B(578, 99.0, 99.5, 98.95, 99.4),   // pulls back into the gap (bullish)
  B(579, 99.5, 99.55, 98.8, 98.9),   // bearish engulfing
  B(580, 98.9, 99.0, 96.9, 97.0)];   // runs to the 3R target
const s = findSetup(shortDay);
assert.equal(s.dir, 'short'); assert.equal(s.entry, 98.9); assert.equal(s.stop, 99.55);
assert.ok(Math.abs(s.target - (98.9 - 3 * 0.65)) < 1e-9);
let x = resolveExit(shortDay, s); assert.equal(x.reason, 'target');
assert.ok(Math.abs(tradeR(s, x).gross - 3) < 1e-9);
assert.ok(Math.abs(tradeR(s, x, {rt: 0.065}).net - 2.9) < 1e-9);

// A bar that touches both stop and target counts as a stop.
const both = [...shortDay.slice(0, -1), B(580, 98.9, 99.6, 96.9, 97.0)];
x = resolveExit(both, findSetup(both)); assert.equal(x.reason, 'stop');

// No gap, no trade: overlapping bars around the breakout.
const noGap = shortDay.map(b => b.m === 577 ? B(577, 99.2, 99.75, 98.9, 99.0) : b);
assert.equal(findSetup(noGap), null);
// A wick through the level without a close beyond it is not a breakout.
const wick = shortDay.map(b => b.m === 576 ? B(576, 99.7, 99.7, 99.1, 99.6) : b);
assert.equal(findSetup(wick), null);
// Too late: entry after the cutoff is skipped.
assert.equal(findSetup(shortDay, {cutoff: 578}), null);
// Mirror control flips direction and keeps the risk distance.
const mir = findSetup(shortDay, {mirror: true}); assert.equal(mir.dir, 'long'); assert.ok(Math.abs(mir.risk - 0.65) < 1e-9);
// A closed move back through the whole gap kills the setup before an engulf.
const dead = shortDay.map(b => b.m === 578 ? B(578, 99.0, 99.9, 98.95, 99.8) : b);
assert.equal(findSetup(dead), null);

// Mirror image: the long side behaves symmetrically.
const flip = shortDay.map(b => B(b.m, 200 - b.o, 200 - b.l, 200 - b.h, 200 - b.c));
const ls = findSetup(flip); assert.equal(ls.dir, 'long'); assert.ok(Math.abs(ls.risk - 0.65) < 1e-9);

// Whole pipeline on random walks with a fake data feed.
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function fakeAlpaca() {
  return {requests: 0, async bars([sym], {start, end}) {
    const rows = []; let px = 100;
    for (let d = Date.parse(start.slice(0, 10)); d <= Date.parse(end.slice(0, 10)); d += 86400_000) {
      const day = new Date(d); if ([0, 6].includes(day.getUTCDay())) continue;
      const base = d + (14 * 60 + 30) * 60_000; // 09:30 EDT/10:30 EST approximation is fine for plumbing
      for (let i = 0; i < 390; i++) { const o = px, c = o + (rnd() - 0.5) * 0.3; rows.push({t: new Date(base + i * 60_000).toISOString(), o, h: Math.max(o, c) + rnd() * 0.1, l: Math.min(o, c) - rnd() * 0.1, c, v: 1000}); px = c; }
    }
    return {[sym]: rows};
  }};
}
const tmp = mkdtempSync(join(tmpdir(), 'fcr-'));
const res = await main(['--start', '2023-01-03', '--end', '2023-06-30', '--out', join(tmp, 'o'), '--data', join(tmp, 'd')], {alpacaImpl: fakeAlpaca()});
assert.ok(res.QQQ.sessions > 100);
const g = stats(runDays([], {}, {})); assert.equal(g.n, 0);
console.error('fcr selftest ok');
