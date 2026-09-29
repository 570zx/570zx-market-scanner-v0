import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pickCandidates, tradeOne, runOrb, DEFAULTS} from '../backtest/lib/orb.mjs';

// One-minute bars from minute 330 (09:30 ET) onward: a flat opening range of 10.00-10.20,
// then whatever `after` says (list of [o,h,l,c] per minute starting at minute 345).
function day(after, {gapRef = 9.5, opening = {vol: 100_000}} = {}) {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (let m = 330; m < 345; m++) { t.push(m); o.push(10.1); h.push(10.2); l.push(10.0); c.push(10.1); v.push(opening.vol); }
  after.forEach((b, i) => { t.push(345 + i); [o, h, l, c].forEach((arr, k) => arr.push(b[k])); v.push(50_000); });
  return {date: '2026-09-01', ref: {AAA: [gapRef, 1_000_000]}, fine: {AAA: {t, o, h, l, c, v, n: t.map(() => 10)}}, showFrom: null, stats: {synthetic: true}};
}
const p = {...DEFAULTS, cost: 0};

test('picks only gapping, liquid stocks with a sensible range', () => {
  assert.equal(pickCandidates(day([]), p).length, 1);
  assert.equal(pickCandidates(day([], {gapRef: 10.1}), p).length, 0);       // no gap
  assert.equal(pickCandidates(day([], {opening: {vol: 1000}}), p).length, 0); // too thin
});

test('a break above the range high buys at the high, and the target is a multiple of the risk', () => {
  const d = day([[10.15, 10.25, 10.1, 10.24], [10.24, 10.7, 10.2, 10.6]]); // breakout, then a run to the target
  const [cand] = pickCandidates(d, p);
  const t = tradeOne(d, cand, {...p, rr: 2});
  assert.equal(t.entry, 10.2);
  assert.equal(t.reason, 'target');
  assert.ok(Math.abs(t.exit - (10.2 + 2 * (10.2 - 10.0))) < 1e-9);
});

test('falling back through the range low stops the trade out, and no breakout means no trade', () => {
  const d = day([[10.15, 10.25, 10.1, 10.24], [10.2, 10.22, 9.9, 9.95]]);
  const t = tradeOne(d, pickCandidates(d, p)[0], p);
  assert.equal(t.reason, 'stop'); assert.equal(t.exit, 10.0);
  assert.equal(tradeOne(day([[10.1, 10.15, 10.05, 10.1]]), pickCandidates(day([]), p)[0], p), null);
});

test('costs are charged on both sides and a signal never fills before it happens', () => {
  const d = day([[10.15, 10.25, 10.1, 10.24], [10.24, 10.7, 10.2, 10.6]]);
  const c = pickCandidates(d, p)[0];
  const t = tradeOne(d, c, {...p, cost: 0.01, rr: 2});
  assert.ok(Math.abs(t.entry - 10.2 * 1.01) < 1e-9);
  assert.ok(t.exit < 10.6);
  const run = runOrb([d], {cost: 0.01, rr: 2});
  assert.equal(run.trades.length, 1);
  assert.ok(run.final > 250);
});

test('unexited trades are sold at the last close', () => {
  const d = day([[10.15, 10.25, 10.1, 10.24], [10.24, 10.3, 10.2, 10.28]]);
  const t = tradeOne(d, pickCandidates(d, p)[0], {...p, rr: 5});
  assert.equal(t.reason, 'close'); assert.equal(t.exit, 10.28);
});
