#!/usr/bin/env node
// The edge hunt: one backtest for every idea still standing, on ~10 years of
// real data, against buy-and-hold, with costs and a held-back 2025-26 period.
//   Daily (total-return ETF bars):  IBS and RSI(2) index mean reversion,
//     leveraged-ETF trend switch, ETF momentum rotation, diversified stock momentum.
//   Intraday (SPY/SH one-minute bars): noise-band breakout, last-half-hour
//     momentum, the "3:50 PM fade" claim, and where SPY's return comes from.
// All rules are fixed in code before the run (pre-registered); nothing is tuned.
//
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/edge.mjs --start 2016-01-04
//   node backtest/edge.mjs --synthetic      (offline plumbing check)
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Alpaca} from './lib/alpaca.mjs';
import {Store} from './lib/store.mjs';
import {etDate, etWall, addDays, realNow} from './lib/time.mjs';
import {loadUniverse} from './swing.mjs';
import {runAllocation, curveStats, buyHold, ibsReversion, rsi2Reversion, trendSwitch, etfRotation, momentumBook, ROTATION_UNIVERSE} from './lib/edge-daily.mjs';
import {runIntraday, runOvernight, noiseArea, lastHalfHour, fade350, intradayOnly, tradeStats, CLOSE_BAR} from './lib/edge-intraday.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ETFS = [...new Set(['SPY', 'QQQ', 'TQQQ', 'BIL', 'SH', ...ROTATION_UNIVERSE])];
const WARMUP = 260; // sessions of history before the first trade (12-month lookbacks)
const STRESS = 2;
// ETFs and other funds are left out of the stock-momentum universe.
export const FUND_RE = /\b(ETF|ETN|ETP|Fund|Trust|Index|Portfolio|ProShares|Direxion|iShares|SPDR|Invesco|Vanguard|GraniteShares|MicroSectors|Leverage[d]?|Ultra\w*|Bull|Bear|[1-4](\.\d)?[Xx])\b/;

export function parseArgs(argv) {
  const a = {start: '2016-01-04', rpm: 150, data: join(HERE, 'data'), out: join(HERE, 'out-edge'), stocks: true};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--start') a.start = v(); else if (k === '--end') a.end = v(); else if (k === '--rpm') a.rpm = Number(v());
    else if (k === '--data') a.data = resolve(v()); else if (k === '--out') a.out = resolve(v());
    else if (k === '--no-stocks') a.stocks = false; else if (k === '--synthetic') a.synthetic = true;
    else throw new Error('unknown option ' + k);
  }
  return a;
}

// ---------------------------------------------------------------- data
async function loadEtfDaily(alpaca, store, {start, end, sessions, log}) {
  const name = `edge-etf-${start}-${end}.json.gz`;
  let raw = store.has(name) ? store.read(name) : null;
  if (!raw) {
    raw = await alpaca.bars(ETFS, {timeframe: '1Day', start, end, adjustment: 'all', feed: 'sip'});
    store.write(name, raw);
  }
  const idx = new Map(sessions.map((d, i) => [d, i])), bars = {};
  for (const [sym, rows] of Object.entries(raw)) {
    const b = Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(f => [f, new Float64Array(sessions.length).fill(NaN)]));
    for (const r of rows) { const i = idx.get(String(r.t).slice(0, 10)); if (i == null) continue; b.o[i] = r.o; b.h[i] = r.h; b.l[i] = r.l; b.c[i] = r.c; b.v[i] = r.v; }
    bars[sym] = b;
  }
  const missing = ETFS.filter(s => !bars[s]);
  if (missing.length) throw new Error('no daily bars for ' + missing.join(', '));
  log(`ETF daily bars: ${Object.keys(bars).length} symbols`);
  return bars;
}

// One-minute SPY/SH sessions, cached per year.
export function packSession(rows, date, open0, early) {
  const t0 = etWall(date, '09:30');
  const px = new Array(390).fill(null), vwap = new Array(390).fill(null);
  let open = null, pv = 0, vol = 0;
  const byMinute = new Array(390).fill(null);
  for (const r of rows) { const m = Math.round((Date.parse(r.t) - t0) / 60000); if (m >= 0 && m < 390) byMinute[m] = r; }
  let last = null;
  for (let m = 0; m < 390; m++) {
    const r = byMinute[m];
    if (r) {
      if (open == null) open = r.o;
      last = r.c; pv += (r.vw ?? r.c) * r.v; vol += r.v;
    }
    px[m] = last; vwap[m] = vol > 0 ? Math.round(pv / vol * 1e4) / 1e4 : last;
  }
  if (open == null) return null;
  for (let m = 0; m < 390 && px[m] == null; m++) { px[m] = open; vwap[m] = open; }
  return {open, px, vwap, early};
}

async function loadMinuteSessions(alpaca, store, {calendar, log}) {
  const years = [...new Set(calendar.map(c => c.date.slice(0, 4)))];
  const out = [];
  for (const y of years) {
    const days = calendar.filter(c => c.date.startsWith(y));
    const name = `edge-min-${y}-${days[0].date}-${days.at(-1).date}.json.gz`;
    let packed = store.has(name) ? store.read(name) : null;
    if (!packed) {
      packed = [];
      const got = {};
      for (const sym of ['SPY', 'SH']) {
        const bars = await alpaca.bars([sym], {timeframe: '1Min', start: new Date(etWall(days[0].date, '09:30')).toISOString(),
          end: new Date(etWall(days.at(-1).date, '16:00')).toISOString(), adjustment: 'split', feed: 'sip'});
        const byDate = new Map();
        for (const r of bars[sym] ?? []) { const d = String(r.t).slice(0, 10); (byDate.get(d) ?? byDate.set(d, []).get(d)).push(r); }
        got[sym] = byDate;
      }
      for (const c of days) {
        const early = c.close !== '16:00';
        packed.push({date: c.date, early, spy: packSession(got.SPY.get(c.date) ?? [], c.date, null, early), sh: packSession(got.SH.get(c.date) ?? [], c.date, null, early)});
      }
      store.write(name, packed);
      log(`minute bars ${y}: ${packed.filter(p => p.spy).length} SPY sessions, ${alpaca.requests} requests so far`);
    }
    out.push(...packed);
  }
  return out;
}

export async function loadFundNames(alpaca, store) {
  const name = `asset-names-${etDate(realNow())}.json.gz`;
  if (store.has(name)) return store.read(name);
  const names = {};
  for (const status of ['active', 'inactive']) for (const a of await alpaca.assets(status)) names[a.symbol] = a.name ?? '';
  store.write(name, names);
  return names;
}

// ---------------------------------------------------------------- run
export function dailyStrategies({withStocks}) {
  const list = [
    buyHold('SPY'), buyHold('QQQ'), buyHold('TQQQ'),
    ibsReversion('SPY'), ibsReversion('QQQ'), rsi2Reversion('SPY'), rsi2Reversion('QQQ'),
    trendSwitch('QQQ', 'TQQQ'), trendSwitch('QQQ', 'TQQQ', {band: true}), trendSwitch('QQQ', 'QQQ'),
    etfRotation(),
  ];
  if (withStocks) list.push(withStocks);
  return list;
}
export const INTRADAY = [noiseArea({shortWithSH: false}), noiseArea({shortWithSH: true}), lastHalfHour({shortWithSH: false}), lastHalfHour({shortWithSH: true}),
  fade350({shortWithSH: false}), fade350({shortWithSH: true})];

export function runDaily({sessions, bars, strategies}) {
  const from = WARMUP;
  return strategies.map(strategy => {
    const base = runAllocation({sessions, bars, strategy, from});
    const stress = runAllocation({sessions, bars, strategy, from, costScale: STRESS});
    return {strategy, stats: curveStats(base, sessions), stress: curveStats(stress, sessions), trades: base.trades};
  });
}

export function runIntradayAll(sessions) {
  const dates = sessions.map(s => s.date);
  const rows = [intradayOnly, ...INTRADAY].map(strategy => {
    const base = runIntraday({sessions, strategy}), stress = runIntraday({sessions, strategy, costScale: STRESS});
    return {strategy, stats: curveStats(base, dates), stress: curveStats(stress, dates), trade: tradeStats(base.trades), trades: base.trades};
  });
  const on = runOvernight({sessions}), onStress = runOvernight({sessions, costScale: STRESS});
  rows.splice(1, 0, {strategy: {id: on.id, label: 'Reference: own SPY from 16:00 to 09:31 the next day (flat during the day).'}, stats: curveStats(on, dates), stress: curveStats(onStress, dates), trade: tradeStats(on.trades), trades: on.trades});
  return rows;
}

// ---------------------------------------------------------------- report
const money = x => x == null ? '—' : (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', {maximumFractionDigits: 0});
const pct = x => x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%';

export function renderReport({meta, daily, intraday}) {
  const L = [];
  L.push(`# MEDS edge hunt: ${meta.first} to ${meta.last}`, '');
  L.push(`Every idea still standing, on the same real data, against buy-and-hold. Each starts with $250, trades only with cash (no margin, no shorting: the short side uses SH, a 1x inverse S&P ETF), and pays a cost on every trade. ` +
    `All ${daily.length - 3 + intraday.length - 2} strategies below (plus buy-and-hold and reference rows) were written down before the run with textbook settings; nothing was tuned on these results. ` +
    `2025-01-01 onward is reported separately as the held-back period. With this many ideas tried, expect the best one to look better than it really is: prefer ideas that beat buy-and-hold in both periods and survive doubled costs.`, '');
  L.push('## Daily strategies');
  L.push('', `| Strategy | $250 became | Yearly (CAGR) | Worst drop | Sharpe | Trades/yr | Time invested | Before 2025 | 2025–26 (held back) | Yearly if costs ×${STRESS} |`);
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of daily) { const s = r.stats; L.push(`| **${s.id}** | ${money(s.final)} | ${pct(s.cagrPct)} | ${pct(-s.maxDrawdownPct)} | ${s.sharpe ?? '—'} | ${s.tradesPerYear} | ${s.investedPct}% | ${pct(s.beforeHoldoutPct)} | ${pct(s.holdoutPct)} | ${pct(r.stress.cagrPct)} |`); }
  const years = [...new Set(daily.flatMap(r => Object.keys(r.stats.byYear)))].sort();
  L.push('', '### Year by year (daily strategies)', '', `| Strategy | ${years.join(' | ')} |`, `|---|${years.map(() => '---:').join('|')}|`);
  for (const r of daily) L.push(`| ${r.stats.id} | ${years.map(y => pct(r.stats.byYear[y])).join(' | ')} |`);
  L.push('', '## Intraday SPY strategies');
  L.push('', `| Strategy | $250 became | Yearly (CAGR) | Worst drop | Sharpe | Trades | Win rate | Avg trade | Before 2025 | 2025–26 (held back) | Yearly if costs ×${STRESS} |`);
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of intraday) { const s = r.stats, t = r.trade; L.push(`| **${s.id}** | ${money(s.final)} | ${pct(s.cagrPct)} | ${pct(-s.maxDrawdownPct)} | ${s.sharpe ?? '—'} | ${t.n} | ${t.winRatePct ?? '—'}% | ${t.avgTradePct ?? '—'}% | ${pct(s.beforeHoldoutPct)} | ${pct(s.holdoutPct)} | ${pct(r.stress.cagrPct)} |`); }
  const iy = [...new Set(intraday.flatMap(r => Object.keys(r.stats.byYear)))].sort();
  L.push('', '### Year by year (intraday)', '', `| Strategy | ${iy.join(' | ')} |`, `|---|${iy.map(() => '---:').join('|')}|`);
  for (const r of intraday) L.push(`| ${r.stats.id} | ${iy.map(y => pct(r.stats.byYear[y])).join(' | ')} |`);
  L.push('', '## The rules', '');
  for (const r of [...daily, ...intraday]) L.push(`- **${r.stats.id}**: ${r.strategy.label}`);
  L.push('', '## Method and limits',
    `- Daily: ETF prices include dividends (Alpaca "all" adjustment). Stock-momentum prices are split-adjusted only (dividends left out, a small understatement). The first ${WARMUP} sessions are history only; trading starts ${meta.first}.`,
    '- "Close" strategies decide on the day\'s close and trade at it. Live, the bot decides at about 15:55 from a live quote, so the backtest is slightly optimistic for them; the doubled-cost column is the guard.',
    '- Costs per side: 0.05% for ETFs, 0.10% for single stocks, 0.02% for SPY intraday, 0.05% for SH. SPY\'s real spread is about 0.002%.',
    '- Intraday: SPY and SH one-minute bars (consolidated tape). Decisions use bars completed by the decision time and fill at the next minute\'s close. Early-close days are skipped.',
    '- Stock momentum uses every US stock Alpaca still serves, including delisted ones, with funds and leveraged products left out by name. Companies Alpaca no longer serves are missing (slightly flatters results).',
    '- Not modeled: taxes, T+1 settlement rules (strategies that sell and buy on the same day need the Agentic account\'s "limited margin" setting), fractional-share limits, halts.',
    '- Past results do not guarantee future results.');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- main
export async function main(argv, {alpacaImpl} = {}) {
  const args = parseArgs(argv);
  const log = m => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
  mkdirSync(args.out, {recursive: true});
  let sessions, bars, minute, stockBook = null;
  if (args.synthetic) ({sessions, bars, minute} = synthetic());
  else {
    const today = etDate(realNow()), end = args.end || addDays(today, -1);
    if (end >= today) throw new Error(`--end ${end} is not a completed trading day`);
    const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: args.rpm, log});
    const store = new Store(args.data);
    const calendar = (await alpaca.calendar(args.start, end)).filter(c => c.date >= args.start && c.date <= end);
    sessions = calendar.map(c => c.date);
    bars = await loadEtfDaily(alpaca, store, {start: args.start, end, sessions, log});
    if (args.stocks) {
      const uni = await loadUniverse(alpaca, store, {start: args.start, end, batch: 100, log});
      if (uni.sessions.join() !== sessions.join()) throw new Error('stock and ETF calendars differ');
      const names = await loadFundNames(alpaca, store);
      const exclude = new Set(Object.keys(uni.bars).filter(s => FUND_RE.test(names[s] ?? '') || ETFS.includes(s)));
      log(`stock universe: ${Object.keys(uni.bars).length} liquid symbols, ${exclude.size} funds excluded`);
      for (const [s, b] of Object.entries(uni.bars)) if (!bars[s]) bars[s] = b;
      stockBook = momentumBook({exclude});
    }
    minute = await loadMinuteSessions(alpaca, store, {calendar, log});
  }
  const daily = runDaily({sessions, bars, strategies: dailyStrategies({withStocks: stockBook})});
  const intraday = runIntradayAll(minute);
  const meta = {first: sessions[WARMUP], last: sessions.at(-1), synthetic: !!args.synthetic};
  const text = renderReport({meta, daily, intraday});
  writeFileSync(join(args.out, 'summary.md'), (args.synthetic ? '**SYNTHETIC TEST DATA — not market results.**\n\n' : '') + text);
  writeFileSync(join(args.out, 'results.json'), JSON.stringify({meta, daily: daily.map(r => ({stats: r.stats, stress: r.stress})), intraday: intraday.map(r => ({stats: r.stats, stress: r.stress, trade: r.trade}))}, null, 1));
  for (const r of [...daily, ...intraday]) if (r.trades?.length)
    writeFileSync(join(args.out, `trades-${r.stats.id}.csv`), Object.keys(r.trades[0]).join(',') + '\n' + r.trades.map(t => Object.values(t).map(v => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v).join(',')).join('\n') + '\n');
  log('wrote ' + join(args.out, 'summary.md'));
  return {meta, daily, intraday};
}

// Offline plumbing check: random walks with a slight drift.
function synthetic() {
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const sessions = [];
  for (let d = new Date(Date.UTC(2021, 0, 4)); sessions.length < 700; d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() % 6) sessions.push(d.toISOString().slice(0, 10));
  const bars = {};
  for (const sym of [...ETFS, 'AAA', 'BBB', 'CCC']) {
    const n = sessions.length, b = Object.fromEntries(['o', 'h', 'l', 'c', 'v'].map(f => [f, new Float64Array(n)]));
    let px = sym === 'BIL' ? 90 : 50 + rnd() * 100;
    for (let i = 0; i < n; i++) {
      const drift = sym === 'BIL' ? 0.0001 : 0.0003, vol = sym === 'BIL' ? 0.0002 : sym === 'TQQQ' ? 0.03 : 0.012;
      const o = px * (1 + (rnd() - 0.5) * vol * 0.3), c = o * (1 + drift + (rnd() - 0.5) * vol * 2);
      b.o[i] = o; b.c[i] = c; b.h[i] = Math.max(o, c) * (1 + rnd() * vol * 0.5); b.l[i] = Math.min(o, c) * (1 - rnd() * vol * 0.5); b.v[i] = 5e7; px = c;
    }
    bars[sym] = b;
  }
  const minute = sessions.slice(-300).map((date, k) => {
    const mk = base => { const px = [], vwap = []; let p = base; for (let m = 0; m < 390; m++) { p *= 1 + (rnd() - 0.5) * 0.001; px.push(p); vwap.push(p); } return {open: base, px, vwap, early: false}; };
    const spy = mk(400 + k * 0.1), sh = {open: 40, px: spy.px.map(p => 40 * (2 - p / spy.open)), vwap: spy.px.map(p => 40 * (2 - p / spy.open)), early: false};
    return {date, early: false, spy, sh};
  });
  return {sessions, bars, minute};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
