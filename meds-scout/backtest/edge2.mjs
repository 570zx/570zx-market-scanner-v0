#!/usr/bin/env node
// Edge hunt 2: calendar effects (turn of the month, pre-holiday), volatility-targeted TQQQ trend,
// trend + turn-of-month, the 50/50 trend + IBS split, a 2x-leveraged trend, and crypto trend
// following (BTC, ETH). Pre-registered rules, costs, a 2x cost stress test and 2025-26 held back.
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/edge2.mjs --start 2016-01-04
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Alpaca} from './lib/alpaca.mjs';
import {Store} from './lib/store.mjs';
import {etDate, addDays, realNow} from './lib/time.mjs';
import {runAllocation, curveStats, buyHold, ibsReversion, trendSwitch} from './lib/edge-daily.mjs';
import {calendarHold, turnOfMonthFlags, preHolidayFlags, volTargetTrend, splitTrendIbs, trendWithTom, cryptoTrend, cryptoHold} from './lib/edge2.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ETFS = ['SPY', 'QQQ', 'TQQQ', 'QLD', 'BIL'];
const COINS = ['BTC/USD', 'ETH/USD'];
const WARMUP = 260, CWARM = 200, STRESS = 2;

export const equityStrategies = () => [
  buyHold('SPY'), buyHold('QQQ'), buyHold('TQQQ'),
  trendSwitch('QQQ', 'TQQQ'), ibsReversion('QQQ'),
  calendarHold('tom_SPY', 'Turn of month: SPY from the last session of each month to the 3rd session of the next; cash otherwise.', 'SPY', turnOfMonthFlags),
  calendarHold('tom_QQQ', 'Turn of month on QQQ (same windows); cash otherwise.', 'QQQ', turnOfMonthFlags),
  calendarHold('tom_TQQQ', 'Turn of month on TQQQ (same windows); cash otherwise.', 'TQQQ', turnOfMonthFlags),
  calendarHold('preholiday_SPY', 'Pre-holiday: SPY only for the session before a market holiday; cash otherwise.', 'SPY', preHolidayFlags),
  volTargetTrend(), splitTrendIbs(), trendWithTom(), trendSwitch('QQQ', 'QLD'),
];
export const cryptoStrategies = () => [cryptoHold('BTC/USD'), cryptoHold('ETH/USD'), cryptoTrend('BTC/USD', 50), cryptoTrend('BTC/USD', 200), cryptoTrend('ETH/USD', 50), cryptoTrend('ETH/USD', 200)];

function toBars(raw, sessions, syms) {
  const idx = new Map(sessions.map((d, i) => [d, i])), bars = {};
  for (const sym of syms) {
    const b = Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(f => [f, new Float64Array(sessions.length).fill(NaN)]));
    for (const r of raw[sym] ?? []) { const i = idx.get(String(r.t).slice(0, 10)); if (i == null) continue; b.o[i] = r.o; b.h[i] = r.h; b.l[i] = r.l; b.c[i] = r.c; b.v[i] = r.v; }
    bars[sym] = b;
  }
  return bars;
}

async function cryptoBars(alpaca, symbols, start, end) {
  const out = {};
  await alpaca.pages('/v1beta3/crypto/us/bars', {symbols: symbols.join(','), timeframe: '1Day', start, end, limit: 10000, sort: 'asc'},
    page => { for (const [s, rows] of Object.entries(page.bars ?? {})) (out[s] ??= []).push(...(rows ?? [])); });
  return out;
}

export function evaluate({sessions, bars, strategies, from}) {
  return strategies.map(s => {
    const base = runAllocation({sessions, bars, strategy: s, from});
    const stress = runAllocation({sessions, bars, strategy: s, from, costScale: STRESS});
    return {label: s.label, stats: curveStats(base, sessions), stress: curveStats(stress, sessions)};
  });
}

const pct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
function table(rows) {
  const L = ['| Strategy | $250 became | Yearly | Yearly if costs ×2 | Worst drop | Sharpe | Trades/yr | Time invested | Before 2025 | 2025–26 (held back) |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const r of rows) {
    const s = r.stats;
    L.push(`| **${s.id}** | $${Math.round(s.final).toLocaleString('en-US')} | ${pct(s.cagrPct)} | ${pct(r.stress.cagrPct)} | -${s.maxDrawdownPct}% | ${s.sharpe ?? '—'} | ${s.tradesPerYear} | ${s.investedPct}% | ${pct(s.beforeHoldoutPct)} | ${pct(s.holdoutPct)} |`);
  }
  return L.join('\n');
}

export function render({eq, cr, meta}) {
  return [
    `# MEDS edge hunt 2: ${meta.eqFrom} to ${meta.eqTo} (crypto ${meta.crFrom ?? '—'} to ${meta.crTo ?? '—'})`, '',
    'New ideas, every rule fixed in code before the run. Each starts at $250, trades with cash only, pays costs on every buy and sell (0.05% per side for ETFs, 0.30% for crypto, doubled in the stress column). ETF prices include dividends. 2025-01-01 onward is shown separately as a held-back check.', '',
    '## Stocks and ETFs', '', table(eq), '',
    '## Crypto (trades every day of the year)', '', cr.length ? table(cr) : '_No crypto data returned._', '',
    '## The rules', '', ...[...eq, ...cr].map(r => `- **${r.stats.id}**: ${r.label}`), '',
    '## How to read this',
    '- Thirteen equity and six crypto variants were tested. With that many tries, one looks good by luck alone; trust only results that also hold in 2025–26, survive doubled costs, and make sense.',
    '- "Sharpe" is return per unit of risk (above 1 is good for a single strategy). "Worst drop" is the largest fall from a peak.',
    '- Crypto data from Alpaca starts later than stock data, so the crypto rows cover fewer years.',
    '- Not modeled: taxes, fractional-share limits, T+1 settlement (daily switching needs the Agentic account\'s limited-margin setting).',
    '- Past results do not guarantee future results.'
  ].join('\n') + '\n';
}

export async function main(argv) {
  const a = {start: '2016-01-04', cryptoStart: '2015-01-01', rpm: 150, data: join(HERE, 'data'), out: join(HERE, 'out-edge2')};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--start') a.start = v(); else if (k === '--crypto-start') a.cryptoStart = v(); else if (k === '--rpm') a.rpm = Number(v());
    else if (k === '--data') a.data = resolve(v()); else if (k === '--out') a.out = resolve(v()); else throw new Error('unknown option ' + k);
  }
  const log = m => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
  mkdirSync(a.out, {recursive: true});
  const end = addDays(etDate(realNow()), -1);
  const alpaca = new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: a.rpm, log});
  const store = new Store(a.data);
  const calendar = (await alpaca.calendar(a.start, end)).filter(c => c.date >= a.start && c.date <= end);
  const sessions = calendar.map(c => c.date);
  const name = `edge2-etf-${a.start}-${end}.json.gz`;
  let raw = store.has(name) ? store.read(name) : null;
  if (!raw) { raw = await alpaca.bars(ETFS, {timeframe: '1Day', start: a.start, end, adjustment: 'all', feed: 'sip'}); store.write(name, raw); }
  const missing = ETFS.filter(s => !raw[s]?.length);
  if (missing.length) throw new Error('no daily bars for ' + missing.join(', '));
  const bars = toBars(raw, sessions, ETFS);
  log(`ETF bars: ${sessions.length} sessions`);
  const eq = evaluate({sessions, bars, strategies: equityStrategies(), from: WARMUP});

  let cr = [], crFrom = null, crTo = null;
  try {
    const craw = await cryptoBars(alpaca, COINS, a.cryptoStart + 'T00:00:00Z', end + 'T00:00:00Z');
    const days = [...new Set(Object.values(craw).flat().map(r => String(r.t).slice(0, 10)))].sort();
    const cbars = toBars(craw, days, COINS);
    const first = Math.max(...COINS.map(s => cbars[s].c.findIndex(Number.isFinite)));
    log(`crypto bars: ${days.length} days, first complete ${days[first]}`);
    if (days.length - first > CWARM + 200) {
      const from = first + CWARM;
      cr = evaluate({sessions: days, bars: cbars, strategies: cryptoStrategies(), from});
      crFrom = days[from]; crTo = days.at(-1);
    }
  } catch (e) { log('crypto data failed: ' + e.message); }

  const text = render({eq, cr, meta: {eqFrom: sessions[WARMUP], eqTo: sessions.at(-1), crFrom, crTo}});
  writeFileSync(join(a.out, 'summary.md'), text);
  writeFileSync(join(a.out, 'results.json'), JSON.stringify({eq: eq.map(r => ({stats: r.stats, stress: r.stress})), cr: cr.map(r => ({stats: r.stats, stress: r.stress}))}, null, 1));
  log('wrote ' + join(a.out, 'summary.md'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
