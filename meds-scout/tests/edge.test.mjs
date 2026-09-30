import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sma, rsiWilder, ibs, runAllocation, curveStats, trendSwitch, etfRotation, momentumBook, buyHold, ibsReversion, lastOfMonth} from '../backtest/lib/edge-daily.mjs';
import {at, CHECKS, CLOSE_BAR, noiseSigma, runIntraday, fade350, lastHalfHour, noiseArea} from '../backtest/lib/edge-intraday.mjs';
import {packSession, renderReport, runDaily, dailyStrategies, runIntradayAll, main} from '../backtest/edge.mjs';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const N = 400;
const sessions = Array.from({length: N}, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
const flat = (px = 100) => Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(f => [f, new Float64Array(N).fill(f === 'v' ? 1e8 : px)]));

test('indicators at day d do not change when later data changes', () => {
  const a = Float64Array.from({length: N}, (_, i) => 100 + Math.sin(i / 7) * 5), b = a.slice();
  for (let i = 300; i < N; i++) b[i] *= 5;
  for (const f of [x => sma(x, 200), x => sma(x, 5), x => rsiWilder(x, 2)]) assert.equal(f(a)[299], f(b)[299]);
  assert.equal(ibs({h: [10], l: [8], c: [8.4]}, 0).toFixed(2), '0.20');
});

test('at-close strategies trade at that close and pay the cost; no borrowing', () => {
  const bars = {SPY: flat(100)};
  bars.SPY.c[250] = 100; bars.SPY.c[251] = 110; bars.SPY.c.fill(110, 251);
  const run = runAllocation({sessions, bars, strategy: {...buyHold('SPY'), cost: 0.01}, from: 250});
  assert.equal(run.trades.length, 1);
  assert.equal(run.trades[0].price, 100);
  assert.ok(run.trades[0].value <= 250 / 1.01 + 1e-9);
  assert.ok(Math.abs(run.curve.at(-1) - (250 / 1.01) * 1.1) < 1e-6);
});

test('trend switch holds the fund above the 200-day average and T-bills below, with the band variant slower to flip', () => {
  const bars = {QQQ: flat(100), TQQQ: flat(50), BIL: flat(90)};
  for (let i = 0; i < N; i++) bars.QQQ.c[i] = i < 300 ? 100 : i < 340 ? 103 : 99;
  const plain = runAllocation({sessions, bars, strategy: trendSwitch('QQQ', 'TQQQ'), from: 250});
  const band = runAllocation({sessions, bars, strategy: trendSwitch('QQQ', 'TQQQ', {band: true}), from: 250});
  assert.deepEqual(plain.trades.map(t => `${t.sym}:${t.side}`).slice(0, 3), ['BIL:buy', 'BIL:sell', 'TQQQ:buy']);
  assert.ok(band.trades.every(t => t.sym === 'BIL')); // 3% above never reaches the 5% entry band
});

test('ETF rotation only trades at month-end and never holds more than 100%', () => {
  const universe = ['SPY', 'QQQ', 'TLT'];
  const bars = {BIL: flat(90)};
  universe.forEach((s, k) => { bars[s] = flat(100); for (let i = 0; i < N; i++) bars[s].c[i] = 100 * (1 + 0.001 * (k + 1)) ** i * (1 + 0.01 * Math.sin(i + k)); });
  for (let i = 0; i < N; i++) bars.BIL.c[i] = 90 * 1.0001 ** i;
  const run = runAllocation({sessions, bars, strategy: etfRotation({universe, top: 2}), from: 260});
  assert.ok(run.trades.length > 0);
  for (const t of run.trades) assert.ok(lastOfMonth(sessions, sessions.indexOf(t.date)));
  const w = etfRotation({universe, top: 2}).weights({sessions, bars, cache: new Map()}, sessions.findIndex((d, i) => i > 300 && lastOfMonth(sessions, i)));
  assert.ok(Math.abs(Object.values(w).reduce((a, x) => a + x, 0) - 1) < 1e-9);
});

test('stock momentum skips excluded funds and goes to T-bills when SPY is below a falling 200-day average', () => {
  const bars = {SPY: flat(100), BIL: flat(90), AAA: flat(50), FUND: flat(50)};
  for (let i = 0; i < N; i++) { bars.AAA.c[i] = 30 * 1.003 ** i; bars.FUND.c[i] = 30 * 1.006 ** i; bars.SPY.c[i] = 100 * 1.001 ** i; }
  const strat = momentumBook({names: 1, minAdv: 1e6, exclude: new Set(['FUND'])});
  const ctx = {sessions, bars, cache: new Map()}; strat.init(ctx);
  const d = sessions.findIndex((x, i) => i > 300 && lastOfMonth(sessions, i));
  const w = strat.weights(ctx, d);
  assert.ok(w.AAA > 0 && !w.FUND);
  for (let i = 0; i < N; i++) bars.SPY.c[i] = 200 * 0.998 ** i;
  const ctx2 = {sessions, bars, cache: new Map()}; strat.init(ctx2);
  assert.deepEqual(strat.weights(ctx2, d), {BIL: 1});
});

const minuteDay = (date, path, {open = 100, early = false} = {}) => {
  const px = Array.from({length: 390}, (_, m) => path(m));
  const sh = px.map(p => 20 * (2 - p / open));
  return {date, early, spy: {open, px, vwap: px.slice()}, sh: {open: 20, px: sh, vwap: sh.slice()}};
};

test('intraday times: decisions use the bar that just completed, fills come one minute later, flat at the close', () => {
  assert.equal(at('09:30'), 0); assert.equal(at('10:00'), 30); assert.equal(CLOSE_BAR, 389); assert.equal(CHECKS.at(-1), at('15:30'));
  // Falls 15:40 -> 15:50, then rises into the close: the fade buys SPY at the 15:50 bar's close.
  const day = minuteDay('2024-01-03', m => m < at('15:40') ? 100 : m < at('15:50') ? 99 : 99 + (m - at('15:50')) * 0.01);
  const run = runIntraday({sessions: [minuteDay('2024-01-02', () => 100), day], strategy: fade350({shortWithSH: false}), costScale: 0});
  assert.equal(run.trades.length, 1);
  assert.equal(run.trades[0].entry, at('15:50'));
  assert.ok(Math.abs(run.trades[0].retPct - ((99 + (389 - 380) * 0.01) / 99 - 1) * 100) < 1e-9);
});

test('noise band uses only earlier sessions, and early-close days are skipped', () => {
  const days = Array.from({length: 20}, (_, k) => minuteDay(`2024-02-${String(k + 1).padStart(2, '0')}`, m => 100 + (k === 19 ? m * 0.02 : 0)));
  const sig = noiseSigma(days, 14);
  const changed = days.map(d => ({...d})); changed[19] = minuteDay('2024-02-20', m => 100 + m * 5);
  assert.deepEqual(noiseSigma(changed, 14)[19], sig[19]);
  const run = runIntraday({sessions: days, strategy: noiseArea({shortWithSH: false}), costScale: 0});
  assert.ok(run.trades.some(t => t.date === '2024-02-20' && t.side === 'spy'));
  const early = days.map((d, k) => k === 19 ? {...d, early: true} : d);
  assert.equal(runIntraday({sessions: early, strategy: noiseArea({shortWithSH: false})}).trades.filter(t => t.date === '2024-02-20').length, 0);
});

test('last-half-hour momentum needs both signals to agree', () => {
  const prev = minuteDay('2024-03-01', () => 100);
  const up = minuteDay('2024-03-04', m => m < at('15:00') ? 101 : m < at('15:30') ? 101.5 : 102);
  const mixed = minuteDay('2024-03-05', m => m < at('15:00') ? 101 : 100.5);
  const s = lastHalfHour({shortWithSH: false});
  assert.equal(runIntraday({sessions: [prev, up], strategy: s}).trades.length, 1);
  assert.equal(runIntraday({sessions: [prev, mixed], strategy: s}).trades.length, 0);
});

test('packSession maps UTC bars to minutes after 09:30 ET and fills gaps forward', () => {
  const rows = [{t: '2024-07-01T13:30:00Z', o: 10, h: 10, l: 10, c: 10.1, v: 100, vw: 10.05}, {t: '2024-07-01T13:35:00Z', o: 10.2, h: 10.3, l: 10.2, c: 10.3, v: 300, vw: 10.25}];
  const s = packSession(rows, '2024-07-01', null, false);
  assert.equal(s.open, 10); assert.equal(s.px[0], 10.1); assert.equal(s.px[4], 10.1); assert.equal(s.px[5], 10.3); assert.equal(s.px[389], 10.3);
  assert.equal(s.vwap[5], Math.round((10.05 * 100 + 10.25 * 300) / 400 * 1e4) / 1e4);
});

test('synthetic end-to-end run writes a report with every strategy and a held-back column', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-'));
  try {
    const {daily, intraday} = await main(['--synthetic', '--out', dir]);
    const text = readFileSync(join(dir, 'summary.md'), 'utf8');
    assert.ok(text.includes('SYNTHETIC'));
    for (const r of [...daily, ...intraday]) assert.ok(text.includes(r.stats.id), r.stats.id);
    assert.ok(text.includes('2025–26 (held back)'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
