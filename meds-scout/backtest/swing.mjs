#!/usr/bin/env node
// Swing-trading backtest on daily bars: downloads years of daily history for
// every US stock (including delisted ones Alpaca still serves), keeps the
// liquid ones, and replays three simple swing strategies plus a buy-and-hold
// benchmark from $250 with realistic costs.
//
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/swing.mjs --start 2021-01-04
//   node backtest/swing.mjs --synthetic            (offline plumbing check)
//
// Options: --start YYYY-MM-DD  --end YYYY-MM-DD (default yesterday)  --rpm N (default 45)
//          --batch N (symbols per request, default 100)  --data DIR  --out DIR
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Alpaca} from './lib/alpaca.mjs';
import {Store} from './lib/store.mjs';
import {loadAssets} from './lib/dataset.mjs';
import {etDate, addDays, realNow} from './lib/time.mjs';
import {STRATEGIES, simulate, statsFor, indicators, everLiquid, WARMUP} from './lib/swing-engine.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIELDS = ['o', 'h', 'l', 'c', 'v'];
const STRESS = 2.5; // cost multiple for the "if fills are worse than I think" column

export function parseArgs(argv) {
  const a = {start: '2021-01-04', rpm: 45, batch: 100, data: join(HERE, 'data'), out: join(HERE, 'out-swing')};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--start') a.start = v(); else if (k === '--end') a.end = v(); else if (k === '--rpm') a.rpm = Number(v());
    else if (k === '--batch') a.batch = Number(v()); else if (k === '--data') a.data = resolve(v()); else if (k === '--out') a.out = resolve(v());
    else if (k === '--synthetic') a.synthetic = true; else throw new Error('unknown option ' + k);
  }
  return a;
}

const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const rows2bars = (rows, dateIndex, n) => {
  const bar = Object.fromEntries(FIELDS.map(f => [f, new Float64Array(n).fill(NaN)]));
  let hits = 0;
  for (const r of rows) {
    const i = dateIndex.get(String(r.t).slice(0, 10));
    if (i == null || !(r.c > 0)) continue;
    bar.o[i] = r.o; bar.h[i] = r.h; bar.l[i] = r.l; bar.c[i] = r.c; bar.v[i] = r.v; hits++;
  }
  return hits ? bar : null;
};
const pack = bar => Object.fromEntries(FIELDS.map(f => [f, Array.from(bar[f], x => Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null)]));
const unpack = raw => Object.fromEntries(FIELDS.map(f => [f, Float64Array.from(raw[f], x => x == null ? NaN : x)]));

export async function loadUniverse(alpaca, store, {start, end, batch, log}) {
  const cal = await alpaca.calendar(start, end);
  const sessions = cal.map(c => c.date).filter(d => d >= start && d <= end);
  const dateIndex = new Map(sessions.map((d, i) => [d, i]));
  const assets = await loadAssets(alpaca, store, log);
  const symbols = assets.map(a => a.symbol).sort();
  const bars = {};
  const batches = Math.ceil(symbols.length / batch);
  for (let b = 0; b < batches; b++) {
    const list = symbols.slice(b * batch, (b + 1) * batch);
    const name = `swing-${start}-${end}-${b}-${hash(list.join(','))}.json.gz`;
    let kept;
    if (store.has(name)) kept = store.read(name);
    else {
      const got = await alpaca.bars(list, {timeframe: '1Day', start, end, adjustment: 'split', feed: 'sip'});
      kept = {};
      for (const [sym, rows] of Object.entries(got)) {
        const bar = rows2bars(rows, dateIndex, sessions.length);
        if (bar && everLiquid(bar)) kept[sym] = pack(bar);
      }
      store.write(name, kept);
    }
    for (const [sym, raw] of Object.entries(kept)) bars[sym] = unpack(raw);
    if ((b + 1) % 10 === 0 || b === batches - 1) log(`daily bars ${b + 1}/${batches} batches: ${Object.keys(bars).length} liquid symbols kept, ${alpaca.requests} requests`);
  }
  return {sessions, bars, listed: symbols.length};
}

export function runAll({sessions, bars, benchmark = 'SPY'}) {
  const ind = Object.fromEntries(Object.keys(bars).map(s => [s, indicators(bars[s])]));
  const results = [];
  for (const strategy of STRATEGIES) {
    const base = simulate({sessions, bars, ind, strategy});
    const stress = simulate({sessions, bars, ind, strategy, costPct: (strategy.cost ?? 0.001) * STRESS});
    results.push({strategy, base, stress, stats: statsFor(base, sessions), stressStats: statsFor(stress, sessions)});
  }
  if (bars[benchmark]) {
    const run = simulate({sessions, bars, ind, strategy: {maxPositions: 1}, benchmark, costPct: 0.0002});
    results.push({strategy: {id: run.strategy, label: 'Buy and hold ' + benchmark + ' (prices are split-adjusted; dividends not included)'}, base: run, stats: statsFor(run, sessions)});
  }
  return results;
}

const money = x => (x < 0 ? '−$' : '$') + Math.abs(x).toFixed(2);
const pctText = x => x == null ? '—' : x.toFixed(1) + '%';

export function renderReport({meta, results}) {
  const L = [];
  L.push(`# MEDS swing-trading backtest: ${meta.first} to ${meta.last} (${meta.sessions} sessions)`);
  L.push('');
  L.push(`Daily bars for ${meta.liquid} liquid US stocks and ETFs (of ${meta.listed} symbols Alpaca lists, active and delisted). Each strategy starts with $250, ` +
    'holds up to 3 positions, buys at the next open after a signal and pays a cost on every fill. Rules are textbook defaults chosen before looking at results; nothing was tuned.');
  L.push('');
  L.push(`| Strategy | Final | Return | Max drawdown | Trades | Win rate | Avg trade | Avg hold (days) | Time invested | Return if costs ×${STRESS} |`);
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const s = r.stats;
    L.push(`| **${s.id}** | ${money(s.final)} | ${pctText(s.returnPct)} | ${pctText(s.maxDrawdownPct)} | ${s.trades} | ${pctText(s.winRatePct)} | ${pctText(s.avgTradePct)} | ${s.avgHoldDays ?? '—'} | ${pctText(s.exposurePct)} | ${r.stressStats ? pctText(r.stressStats.returnPct) : '—'} |`);
  }
  L.push('');
  L.push('## Year by year (return %) and the held-back period');
  const years = [...new Set(results.flatMap(r => Object.keys(r.stats.byYear)))].sort();
  L.push(`| Strategy | ${years.join(' | ')} | Before 2025 | 2025 onward |`);
  L.push(`|---|${years.map(() => '---:').join('|')}|---:|---:|`);
  for (const r of results) {
    const s = r.stats;
    L.push(`| **${s.id}** | ${years.map(y => pctText(s.byYear[y])).join(' | ')} | ${pctText(s.beforeAfter2025?.before2025Pct)} | ${pctText(s.beforeAfter2025?.from2025Pct)} |`);
  }
  L.push('');
  L.push('## Strategies');
  for (const r of results) L.push(`- **${r.stats.id}**: ${r.strategy.label}`);
  L.push('');
  for (const r of results.filter(r => r.stats.trades)) {
    L.push(`<details><summary><b>${r.stats.id}</b> exits</summary>\n`);
    L.push('| Exit | Trades | Avg | P&L |', '|---|---:|---:|---:|');
    for (const [k, e] of Object.entries(r.stats.byExit)) L.push(`| ${k} | ${e.n} | ${pctText(e.avgPct)} | ${money(e.pnl)} |`);
    L.push('\n</details>\n');
  }
  L.push('## Method and limits');
  L.push('- Signals use bars through the close of day d only; orders fill at the open of day d+1. Stops fill at the stop price, or at the open if the stock gapped through it.');
  L.push('- Costs per side: 0.10% for pullback and momentum, 0.30% for gap_drift (wider spreads after a gap). The last column repeats the run with costs multiplied by ' + STRESS + '.');
  L.push('- Stocks are chosen by what was liquid on the day (20-day average dollar volume), not by today\'s list, and delisted companies are included where Alpaca still serves their history. Companies whose history Alpaca no longer serves are missing, which flatters results a little.');
  L.push('- Fractional shares are assumed. Prices are split-adjusted, not dividend-adjusted. Taxes, borrow fees and overnight news gaps beyond the modeled stop fills are not included.');
  L.push('- Past results do not guarantee future results. Compare with the buy-and-hold row: a strategy that cannot beat holding the index is not worth the risk.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  const args = parseArgs(argv);
  const log = m => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
  mkdirSync(args.out, {recursive: true});
  let universe;
  if (args.synthetic) universe = syntheticUniverse();
  else {
    const today = etDate(realNow()), end = args.end || addDays(today, -1);
    if (end >= today) throw new Error(`--end ${end} is not a completed trading day`);
    const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: args.rpm, log});
    universe = await loadUniverse(alpaca, new Store(args.data), {start: args.start, end, batch: args.batch, log});
    log(`${universe.sessions.length} sessions, ${Object.keys(universe.bars).length} liquid symbols`);
  }
  if (universe.sessions.length < WARMUP + 20) throw new Error(`need at least ${WARMUP + 20} sessions; got ${universe.sessions.length}`);
  const results = runAll(universe);
  const meta = {first: universe.sessions[WARMUP], last: universe.sessions.at(-1), sessions: universe.sessions.length - WARMUP, liquid: Object.keys(universe.bars).length, listed: universe.listed};
  const report = renderReport({meta, results});
  writeFileSync(join(args.out, 'summary.md'), report);
  writeFileSync(join(args.out, 'results.json'), JSON.stringify({meta, results: results.map(r => ({id: r.stats.id, stats: r.stats, stress: r.stressStats ?? null}))}, null, 1));
  for (const r of results) if (r.base.trades.length)
    writeFileSync(join(args.out, `trades-${r.stats.id}.csv`), 'symbol,entry,exit,entry_price,exit_price,qty,pnl,return_pct,days,reason\n' +
      r.base.trades.map(t => [t.sym, t.entry, t.exit, t.entryPx.toFixed(4), t.exitPx.toFixed(4), t.qty.toFixed(4), t.pnl.toFixed(2), t.retPct.toFixed(2), t.days, t.reason].join(',')).join('\n') + '\n');
  log(`wrote ${join(args.out, 'summary.md')}`);
  return {meta, results};
}

// Offline plumbing check: random-walk stocks with a few gappers.
function syntheticUniverse() {
  const n = 520, sessions = [];
  for (let d = new Date(Date.UTC(2023, 0, 2)); sessions.length < n; d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() % 6) sessions.push(d.toISOString().slice(0, 10));
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const bars = {};
  for (const sym of ['SPY', ...Array.from({length: 30}, (_, i) => 'S' + i)]) {
    const bar = Object.fromEntries(FIELDS.map(f => [f, new Float64Array(n)]));
    let px = 50 + rnd() * 100;
    for (let i = 0; i < n; i++) {
      const gap = rnd() < 0.01 ? 0.1 : 0, o = px * (1 + gap + (rnd() - 0.5) * 0.01), c = o * (1 + (rnd() - 0.48) * 0.03);
      bar.o[i] = o; bar.c[i] = c; bar.h[i] = Math.max(o, c) * 1.005; bar.l[i] = Math.min(o, c) * 0.995; bar.v[i] = 2e6 * (1 + (gap ? 4 : rnd()));
      px = c;
    }
    bars[sym] = bar;
  }
  return {sessions, bars, listed: Object.keys(bars).length};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
