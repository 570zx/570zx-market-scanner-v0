import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulate, indicators, statsFor, WARMUP, pullback} from '../backtest/lib/swing-engine.mjs';

const N = WARMUP + 30;
const sessions = Array.from({length: N}, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
const flatBar = (px = 100) => ({o: new Float64Array(N).fill(px), h: new Float64Array(N).fill(px), l: new Float64Array(N).fill(px), c: new Float64Array(N).fill(px), v: new Float64Array(N).fill(1e6)});
const buyOnce = (day, stopPct = 0.1, maxHold = 5) => ({maxPositions: 1, maxHold, cost: 0, entries: (ctx, d) => d === day ? [{sym: 'A', score: 1, stopPct}] : [], exitReason: () => null});
const run = (bar, strategy, extra = {}) => simulate({sessions, bars: {A: bar}, ind: {A: indicators(bar)}, strategy, ...extra});

test('a signal on day d fills at the OPEN of day d+1, never at day d\'s close', () => {
  const bar = flatBar(100);
  bar.c[WARMUP] = 90; bar.o[WARMUP + 1] = 95; bar.h[WARMUP + 1] = 95; bar.l[WARMUP + 1] = 95; bar.c[WARMUP + 1] = 95;
  const r = run(bar, buyOnce(WARMUP), {costPct: 0});
  assert.equal(r.trades[0].entryPx, 95);
  assert.equal(r.trades[0].entry, sessions[WARMUP + 1]);
});

test('each fill pays the cost: buys above the open, sells below', () => {
  const r = run(flatBar(100), buyOnce(WARMUP, 0.5, 3), {costPct: 0.01});
  assert.ok(Math.abs(r.trades[0].entryPx - 101) < 1e-9);
  assert.ok(Math.abs(r.trades[0].exitPx - 99) < 1e-9);
  assert.ok(r.trades[0].pnl < 0);
});

test('a stop fills at the stop price, or at the open if the stock gapped through it', () => {
  const dip = flatBar(100); dip.l[WARMUP + 2] = 85; dip.c[WARMUP + 2] = 90;
  assert.equal(run(dip, buyOnce(WARMUP, 0.1), {costPct: 0}).trades[0].exitPx, 90);   // stop = 100 * 0.9
  const gap = flatBar(100); for (const f of ['o', 'h', 'l', 'c']) gap[f][WARMUP + 2] = 80;
  const t = run(gap, buyOnce(WARMUP, 0.1), {costPct: 0}).trades[0];
  assert.equal(t.exitPx, 80); assert.equal(t.reason, 'stop');
});

test('time exit sells at the next open after maxHold days', () => {
  const r = run(flatBar(100), buyOnce(WARMUP, 0.5, 3), {costPct: 0});
  assert.equal(r.trades[0].reason, 'time');
  assert.equal(r.trades[0].days, 4); // signal at close d, held 3 sessions, sold at the next open
});

test('indicators at day d do not change when later bars change', () => {
  const a = flatBar(100); for (let i = 0; i < N; i++) { a.c[i] = 100 + Math.sin(i / 5) * 5; a.o[i] = a.c[i]; a.h[i] = a.c[i] + 1; a.l[i] = a.c[i] - 1; }
  const b = {o: a.o.slice(), h: a.h.slice(), l: a.l.slice(), c: a.c.slice(), v: a.v.slice()};
  const d = WARMUP + 5;
  for (let i = d + 1; i < N; i++) { b.c[i] *= 3; b.o[i] *= 3; b.h[i] *= 3; b.l[i] *= 3; b.v[i] *= 9; }
  const x = indicators(a), y = indicators(b);
  for (const k of Object.keys(x)) assert.equal(x[k][d], y[k][d], k);
});

test('the pullback strategy only looks at data up to the signal day', () => {
  const a = flatBar(100); for (let i = 0; i < N; i++) { a.c[i] = 100 + i * 0.2; a.o[i] = a.c[i]; a.h[i] = a.c[i] + 1; a.l[i] = a.c[i] - 1; a.v[i] = 5e6; }
  const d = WARMUP + 10; a.c[d] = a.c[d] * 0.9; // sharp one-day dip in an uptrend
  const b = {o: a.o.slice(), h: a.h.slice(), l: a.l.slice(), c: a.c.slice(), v: a.v.slice()};
  for (let i = d + 1; i < N; i++) { b.c[i] = 1; b.o[i] = 1; b.h[i] = 1; b.l[i] = 1; }
  const ctxA = {sessions, bars: {A: a}, ind: {A: indicators(a)}, symbols: ['A'], firstOfMonth: () => false};
  const ctxB = {sessions, bars: {A: b}, ind: {A: indicators(b)}, symbols: ['A'], firstOfMonth: () => false};
  assert.deepEqual(pullback.entries(ctxA, d), pullback.entries(ctxB, d));
});

test('statistics: equity curve, drawdown and win rate', () => {
  const bar = flatBar(100); for (let i = WARMUP + 2; i < N; i++) for (const f of ['o', 'h', 'l', 'c']) bar[f][i] = 110;
  const r = run(bar, buyOnce(WARMUP, 0.5, 5), {costPct: 0});
  const s = statsFor(r, sessions);
  assert.equal(s.trades, 1); assert.equal(s.winRatePct, 100); assert.ok(s.returnPct > 9 && s.returnPct < 10.1);
  assert.equal(s.maxDrawdownPct, 0);
});

test('a universe filter can only tighten the liquidity floor', () => {
  const a = flatBar(100); for (let i = 0; i < N; i++) { a.c[i] = 100 + i * 0.2; a.o[i] = a.c[i]; a.h[i] = a.c[i] + 1; a.l[i] = a.c[i] - 1; a.v[i] = 5e6; }
  const d = WARMUP + 10; a.c[d] = a.c[d] * 0.9;
  const base = {sessions, bars: {A: a}, ind: {A: indicators(a)}, symbols: ['A'], firstOfMonth: () => false};
  assert.equal(pullback.entries(base, d).length, 1);
  assert.equal(pullback.entries({...base, universe: {minAdv: 5e9, minPrice: 0}}, d).length, 0);
  assert.equal(pullback.entries({...base, universe: {minAdv: 0, minPrice: 1e6}}, d).length, 0);
  assert.equal(pullback.entries({...base, universe: {minAdv: 0, minPrice: 0}}, d).length, 1);
});
