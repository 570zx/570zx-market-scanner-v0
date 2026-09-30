import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packDay, runNight, runDayOnly, runHold, prepareAttention, attentionPicks, runAttention} from '../backtest/lib/edge-overnight.mjs';
import {main} from '../backtest/overnight.mjs';

const bar = (iso, c, o = c) => ({t: iso, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000});

test('packDay picks the last premarket trade by each time, the first regular minute and the close', () => {
  // 2024-07-01 is EDT: 04:00 ET = 08:00Z, 09:30 = 13:30Z, 16:00 = 20:00Z.
  const rows = [bar('2024-06-30T23:30:00Z', 1), bar('2024-07-01T08:10:00Z', 100), bar('2024-07-01T10:59:00Z', 101), bar('2024-07-01T12:30:00Z', 102),
    bar('2024-07-01T13:30:00Z', 103), bar('2024-07-01T19:59:00Z', 105), bar('2024-07-01T21:00:00Z', 106)];
  const d = packDay(rows, '2024-07-01', false);
  assert.deepEqual(d.pre, {'04:30': 100, '07:00': 101, '09:00': 102});
  assert.equal(d.open1, 103); assert.equal(d.close, 105);
});

test('overnight: buy at the close, sell at the chosen exit next morning, paying half the spread each way', () => {
  const days = [{date: 'd1', early: false, close: 100, open1: 99, pre: {'04:30': 100, '07:00': 100, '09:00': 101}},
    {date: 'd2', early: false, close: 105, open1: 102, pre: {'04:30': 101, '07:00': 101.5, '09:00': 102.5}}];
  const open = runNight({days, exit: 'open', spread: {close: 0, open: 0}, slip: 0});
  assert.ok(Math.abs(open.curve.at(-1) - 250 * 1.02) < 1e-9);
  const pre = runNight({days, exit: '09:00', spread: {close: 0.002, '09:00': 0.004}, slip: 0});
  assert.ok(Math.abs(pre.curve.at(-1) - 250 * (102.5 * (1 - 0.002)) / (100 * (1 + 0.001))) < 1e-9);
  const filtered = runNight({days, exit: 'open', filter: () => false});
  assert.equal(filtered.trades.length, 0);
  assert.ok(Math.abs(runDayOnly({days, slip: 0}).curve.at(-1) - 250 * (100 / 99) * (105 / 102)) < 1e-9);
  assert.ok(Math.abs(runHold({days}).curve.at(-1) - 250 * 1.05) < 1e-9);
});

test('attention picks use the day\'s close and past volume only, and sell at the next open', () => {
  const N = 40, sessions = Array.from({length: N}, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
  const mk = f => { const b = {o: new Float64Array(N), c: new Float64Array(N), v: new Float64Array(N).fill(1e7)}; for (let i = 0; i < N; i++) { b.c[i] = f(i); b.o[i] = f(i); } return b; };
  const bars = {UP: mk(i => i === 30 ? 60 : 50), FLAT: mk(() => 50), THIN: mk(i => i === 30 ? 80 : 50)};
  bars.THIN.v.fill(1); bars.UP.o[31] = 61;
  const universe = Object.keys(bars), prep = prepareAttention({sessions, bars, universe});
  const picks = attentionPicks({sessions, bars, universe, prep, from: 25, pick: 'gainers', n: 1, minAdv: 1e8});
  assert.deepEqual(picks[30], ['UP']); // THIN has the bigger gain but trades too little
  const run = runAttention({sessions, bars, picks, from: 30, pick: 'gainers', cost: 0});
  assert.ok(Math.abs(run.trades[0].retPct - (61 / 60 - 1) * 100) < 1e-9);
  // Changing tomorrow's volume cannot change today's liquidity filter.
  const bars2 = {...bars, UP: {...bars.UP, v: Float64Array.from(bars.UP.v, (x, i) => i > 30 ? 0 : x)}};
  assert.equal(prepareAttention({sessions, bars: bars2, universe}).UP.adv[30], prep.UP.adv[30]);
});

test('synthetic end-to-end run writes the report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'night-'));
  try {
    const {rows} = await main(['--synthetic', '--out', dir]);
    const text = readFileSync(join(dir, 'summary.md'), 'utf8');
    for (const r of rows) assert.ok(text.includes(r.id), r.id);
    assert.ok(text.includes('Measured bid/ask spreads'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
