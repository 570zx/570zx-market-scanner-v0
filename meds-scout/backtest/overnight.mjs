#!/usr/bin/env node
// Overnight-drift test: does "buy at the close, sell premarket or at the open"
// beat holding? SPY, QQQ and TQQQ on ~10 years of one-minute bars, exits at
// 04:30, 07:00, 09:00 and the open, priced at measured bid/ask spreads; plus
// the stock version (the day's biggest movers held overnight).
//
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/overnight.mjs --start 2016-01-04
//   node backtest/overnight.mjs --synthetic
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Alpaca} from './lib/alpaca.mjs';
import {Store} from './lib/store.mjs';
import {etDate, etWall, addDays, realNow} from './lib/time.mjs';
import {loadUniverse} from './swing.mjs';
import {FUND_RE, loadFundNames} from './edge.mjs';
import {curveStats, sma} from './lib/edge-daily.mjs';
import {packDay, runNight, runDayOnly, runHold, runAttention, prepareAttention, attentionPicks, winRate, PRE_TIMES, EXITS} from './lib/edge-overnight.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SYMBOLS = ['SPY', 'QQQ', 'TQQQ'];
const SPREAD_TIMES = {close: '15:59', '04:30': '04:30', '07:00': '07:00', '09:00': '09:00', open: '09:31'};
const WARMUP = 260;

export function parseArgs(argv) {
  const a = {start: '2016-01-04', rpm: 150, data: join(HERE, 'data'), out: join(HERE, 'out-overnight'), samples: 60, stocks: true};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--start') a.start = v(); else if (k === '--end') a.end = v(); else if (k === '--rpm') a.rpm = Number(v());
    else if (k === '--data') a.data = resolve(v()); else if (k === '--out') a.out = resolve(v()); else if (k === '--samples') a.samples = Number(v());
    else if (k === '--no-stocks') a.stocks = false; else if (k === '--synthetic') a.synthetic = true; else throw new Error('unknown option ' + k);
  }
  return a;
}

async function loadNights(alpaca, store, {calendar, log}) {
  const out = {};
  for (const sym of SYMBOLS) {
    out[sym] = [];
    for (const y of [...new Set(calendar.map(c => c.date.slice(0, 4)))]) {
      const days = calendar.filter(c => c.date.startsWith(y));
      const name = `edge-night-${sym}-${days[0].date}-${days.at(-1).date}.json.gz`;
      let packed = store.has(name) ? store.read(name) : null;
      if (!packed) {
        const got = await alpaca.bars([sym], {timeframe: '1Min', start: new Date(etWall(days[0].date, '04:00')).toISOString(),
          end: new Date(etWall(days.at(-1).date, days.at(-1).close === '16:00' ? '16:00' : '13:00')).toISOString(), adjustment: 'split', feed: 'sip'});
        const byDate = new Map();
        // 04:00-16:00 ET is the same calendar date in UTC, so the UTC date groups them (fast).
        for (const r of got[sym] ?? []) { const d = String(r.t).slice(0, 10); (byDate.get(d) ?? byDate.set(d, []).get(d)).push(r); }
        packed = days.map(c => packDay(byDate.get(c.date) ?? [], c.date, c.close !== '16:00'));
        store.write(name, packed);
        log(`${sym} ${y}: ${packed.filter(p => p.close).length} days, ${alpaca.requests} requests so far`);
      }
      out[sym].push(...packed);
    }
  }
  return out;
}

// Median full bid/ask spread (as a fraction of the mid) at each time, from real quotes on sampled days.
async function measureSpreads(alpaca, store, {calendar, samples, log}) {
  const name = `edge-night-spreads-${calendar[0].date}-${calendar.at(-1).date}-${samples}.json.gz`;
  if (store.has(name)) return store.read(name);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pool = calendar.filter(c => c.close === '16:00'), picked = new Set();
  while (picked.size < Math.min(samples, pool.length)) picked.add(pool[Math.floor(rnd() * pool.length)].date);
  const out = {};
  for (const sym of SYMBOLS) {
    out[sym] = {};
    for (const [key, hhmm] of Object.entries(SPREAD_TIMES)) {
      const vals = [];
      for (const date of picked) {
        const q = await alpaca.quoteAt(sym, new Date(etWall(date, hhmm)).toISOString(), {lookbackMs: 30 * 60_000}).catch(() => null);
        if (q && q.ap > 0 && q.bp > 0 && q.ap >= q.bp) vals.push((q.ap - q.bp) / ((q.ap + q.bp) / 2));
      }
      vals.sort((a, b) => a - b);
      out[sym][key] = {median: vals.length ? vals[Math.floor(vals.length / 2)] : null, n: vals.length};
    }
    log(`spreads ${sym}: ${Object.entries(out[sym]).map(([k, v]) => `${k} ${v.median == null ? '—' : (v.median * 100).toFixed(3) + '%'}`).join(', ')}`);
  }
  store.write(name, out);
  return out;
}

export function runNightTable({nights, spreads}) {
  const rows = [];
  for (const sym of SYMBOLS) {
    const days = nights[sym], dates = days.map(d => d.date);
    const sp = Object.fromEntries(Object.entries(spreads[sym] ?? {}).map(([k, v]) => [k, v?.median ?? (k === 'close' || k === 'open' ? 0.0005 : 0.002)]));
    const mk = (id, label, run, extra = {}) => {
      const net = run(1), gross = run(0), stress = run(2);
      return {id, label, symbol: sym, stats: curveStats(net, dates), gross: curveStats(gross, dates), stress: curveStats(stress, dates), trade: winRate(net.trades), ...extra};
    };
    rows.push(mk(`hold_${sym}`, `Hold ${sym} (price only, no costs)`, () => runHold({days, id: `hold_${sym}`})));
    rows.push(mk(`day_${sym}`, `Own ${sym} only from 09:31 to the close`, s => runDayOnly({days, spread: sp, costScale: s, id: `day_${sym}`})));
    for (const exit of EXITS) {
      const id = `night_${sym}_${exit === 'open' ? 'open' : exit.replace(':', '')}`;
      rows.push(mk(id, `Buy ${sym} at the close, sell at ${exit === 'open' ? 'the 09:30 open' : exit + ' premarket'}`, s => runNight({days, exit, spread: sp, costScale: s, id})));
    }
  }
  // The trend-filter combination: TQQQ overnight only while QQQ is above its 200-day average.
  const q = nights.QQQ, m = sma(Float64Array.from(q.map(d => d.close ?? NaN)), 200);
  const byDate = new Map(q.map((d, i) => [d.date, i]));
  const t = nights.TQQQ, tDates = t.map(d => d.date);
  const tsp = Object.fromEntries(Object.entries(spreads.TQQQ ?? {}).map(([k, v]) => [k, v?.median ?? 0.0005]));
  const filter = i => { const k = byDate.get(t[i].date); return k != null && q[k].close > m[k]; };
  const run = s => runNight({days: t, exit: 'open', spread: tsp, costScale: s, filter, id: 'night_TQQQ_open_trend'});
  rows.push({id: 'night_TQQQ_open_trend', label: 'Buy TQQQ at the close and sell at the open, only while QQQ is above its 200-day average', symbol: 'TQQQ',
    stats: curveStats(run(1), tDates), gross: curveStats(run(0), tDates), stress: curveStats(run(2), tDates), trade: winRate(run(1).trades)});
  return rows;
}

export function runAttentionTable({sessions, bars, universe}) {
  const prep = prepareAttention({sessions, bars, universe});
  return ['gainers', 'losers', 'volume'].map(pick => {
    const picks = attentionPicks({sessions, bars, universe, prep, from: WARMUP, pick});
    const r = s => runAttention({sessions, bars, picks, from: WARMUP, pick, costScale: s});
    const net = r(1);
    return {id: net.id, label: `At each close buy the 5 liquid stocks (price ≥ $10, ≥ $50M traded a day, no funds) with the ${pick === 'gainers' ? 'biggest gain' : pick === 'losers' ? 'biggest loss' : 'biggest volume surge'} that day; sell at the next open. 0.10% cost per side.`,
      stats: curveStats(net, sessions), gross: curveStats(r(0), sessions), stress: curveStats(r(2), sessions), trade: winRate(net.trades)};
  });
}

const pct = x => x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%';
const money = x => x == null ? '—' : '$' + Math.round(x).toLocaleString('en-US');

export function renderReport({meta, rows, attention, spreads}) {
  const L = [`# MEDS overnight test: ${meta.first} to ${meta.last}`, ''];
  L.push('Does buying at the close and selling the next morning (premarket or at the open) beat simply holding? Each row starts at $250 and trades every night with cash only. ' +
    '"Before costs" ignores the bid/ask spread; "after costs" pays half the measured spread plus 0.005% on every buy and sell. Prices are split-adjusted, not dividend-adjusted (holding also collects dividends; overnight holders do too on ex-dates). 2025-01-01 onward is shown separately.', '');
  L.push('| Strategy | $250 became (after costs) | Yearly before costs | Yearly after costs | Yearly if costs ×2 | Worst drop | Sharpe | Nights | Win rate | Before 2025 | 2025–26 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of [...rows, ...attention]) {
    const s = r.stats;
    L.push(`| **${r.id}** | ${money(s.final)} | ${pct(r.gross.cagrPct)} | ${pct(s.cagrPct)} | ${pct(r.stress.cagrPct)} | ${pct(-s.maxDrawdownPct)} | ${s.sharpe ?? '—'} | ${r.trade.n || '—'} | ${r.trade.n ? r.trade.winRatePct + '%' : '—'} | ${pct(s.beforeHoldoutPct)} | ${pct(s.holdoutPct)} |`);
  }
  L.push('', '## Measured bid/ask spreads (median, full spread as % of price)', '', '| Symbol | 15:59 close | 04:30 | 07:00 | 09:00 | 09:31 open |', '|---|---:|---:|---:|---:|---:|');
  for (const sym of SYMBOLS) L.push(`| ${sym} | ${['close', '04:30', '07:00', '09:00', 'open'].map(k => spreads[sym]?.[k]?.median == null ? '—' : (spreads[sym][k].median * 100).toFixed(3) + '% (' + spreads[sym][k].n + ')').join(' | ')} |`);
  L.push('', '## The rules', '');
  for (const r of [...rows, ...attention]) L.push(`- **${r.id}**: ${r.label}`);
  L.push('', '## Limits',
    '- Entry is the 15:59 bar\'s close; exits are the last trade completed by each time (premarket) or the first regular minute. Real fills can differ, most of all in thin premarket trading.',
    '- Robinhood\'s agentic tools allow premarket selling only as whole-share limit orders (fractional shares trade 09:30–16:00 only), and a trade every night needs the "limited margin" setting (unsettled funds).',
    '- The stock rows use daily bars (close to next open) and a flat 0.10% cost per side; small, volatile names cost more.',
    '- Several variants are shown; treat the pattern (where returns accrue) as the result, not the single best row.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  const args = parseArgs(argv);
  const log = m => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
  mkdirSync(args.out, {recursive: true});
  let nights, spreads, attention = [], meta;
  if (args.synthetic) {
    ({nights, spreads} = synthetic());
    meta = {first: nights.SPY[0].date, last: nights.SPY.at(-1).date};
  } else {
    const today = etDate(realNow()), end = args.end || addDays(today, -1);
    const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: args.rpm, log});
    const store = new Store(args.data);
    const calendar = (await alpaca.calendar(args.start, end)).filter(c => c.date >= args.start && c.date <= end);
    nights = await loadNights(alpaca, store, {calendar, log});
    spreads = await measureSpreads(alpaca, store, {calendar, samples: args.samples, log});
    meta = {first: calendar[0].date, last: calendar.at(-1).date};
    if (args.stocks) {
      const uni = await loadUniverse(alpaca, store, {start: args.start, end, batch: 100, log});
      const names = await loadFundNames(alpaca, store);
      const universe = Object.keys(uni.bars).filter(s => !FUND_RE.test(names[s] ?? '') && !['SPY', 'QQQ', 'TQQQ', 'SH', 'BIL'].includes(s));
      log(`attention universe: ${universe.length} stocks`);
      attention = runAttentionTable({sessions: uni.sessions, bars: uni.bars, universe});
    }
  }
  const rows = runNightTable({nights, spreads});
  const text = (args.synthetic ? '**SYNTHETIC TEST DATA — not market results.**\n\n' : '') + renderReport({meta, rows, attention, spreads});
  writeFileSync(join(args.out, 'summary.md'), text);
  writeFileSync(join(args.out, 'results.json'), JSON.stringify({meta, spreads, rows: [...rows, ...attention].map(r => ({id: r.id, stats: r.stats, gross: r.gross, stress: r.stress, trade: r.trade}))}, null, 1));
  log('wrote ' + join(args.out, 'summary.md'));
  return {rows, attention, spreads};
}

function synthetic() {
  let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const nights = {}, spreads = {};
  for (const sym of SYMBOLS) {
    const k = sym === 'TQQQ' ? 3 : 1; let px = 100; const days = [];
    for (let i = 0; i < 600; i++) {
      const date = new Date(Date.UTC(2023, 0, 2 + Math.floor(i * 7 / 5))).toISOString().slice(0, 10);
      const night = 1 + k * (0.0004 + (rnd() - 0.5) * 0.006), dayMove = 1 + k * ((rnd() - 0.5) * 0.01);
      const open1 = px * night, pre = {'04:30': px * (1 + (night - 1) * 0.3), '07:00': px * (1 + (night - 1) * 0.6), '09:00': px * (1 + (night - 1) * 0.9)};
      const close = open1 * dayMove;
      days.push({date, early: false, close, open1, pre}); px = close;
    }
    nights[sym] = days;
    spreads[sym] = {close: {median: 0.0002, n: 10}, '04:30': {median: 0.002, n: 10}, '07:00': {median: 0.001, n: 10}, '09:00': {median: 0.0005, n: 10}, open: {median: 0.0002, n: 10}};
  }
  return {nights, spreads};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
