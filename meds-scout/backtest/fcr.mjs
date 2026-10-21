#!/usr/bin/env node
// First-candle-rule test on QQQ and SPY one-minute bars (see lib/fcr.mjs for the rules).
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/fcr.mjs [--start 2016-01-04] [--end YYYY-MM-DD] [--out DIR] [--data DIR]
// Paper research only: this script never places an order.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {etParts, etWall} from './lib/time.mjs';
import {runDays, stats, byYear, DEFAULTS} from './lib/fcr.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SYMBOLS = ['QQQ', 'SPY'];
// Dollars per share. A liquid ETF trades about 1 cent wide: half a cent each way for the spread,
// a little commission/fee, plus slippage. "Cheap" is a best case; "Hard" is a retail-realistic one.
export const COSTS = [
  {id: 'gross', label: 'no costs', rt: 0, stopSlip: 0},
  {id: 'cheap', label: '2c round trip, +1c on stops', rt: 0.02, stopSlip: 0.01},
  {id: 'hard', label: '4c round trip, +2c on stops', rt: 0.04, stopSlip: 0.02},
];
// The configuration fixed before looking at any result: the video's rules read the most literal way.
export const HEADLINE = {rr: 3, stop: 'engulf', cutoff: 11 * 60 + 30};
export const GRID = [];
for (const rr of [1, 2, 3]) for (const stop of ['engulf', 'fvg']) for (const cutoff of [11 * 60 + 30, 15 * 60 + 30]) GRID.push({rr, stop, cutoff});

const f2 = x => x == null ? '—' : x.toFixed(3);
const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function loadSymbol(alpaca, store, sym, start, end, log, timeframe = '1Min') {
  const days = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    const a = y === Number(start.slice(0, 4)) ? start : `${y}-01-01`, b = y === Number(end.slice(0, 4)) ? end : `${y}-12-31`;
    const name = timeframe === '1Min' ? `fcr-${sym}-${a}-${b}.json.gz` : `fcr-${timeframe}-${sym}-${a}-${b}.json.gz`;
    let packed = store.has(name) ? store.read(name) : null;
    if (!packed) {
      const got = await alpaca.bars([sym], {timeframe, start: new Date(etWall(a, '09:30')).toISOString(), end: new Date(etWall(b, '16:00')).toISOString(), adjustment: 'split', feed: 'sip'});
      const byDate = new Map();
      for (const r of got[sym] ?? []) {
        const ms = Date.parse(r.t), p = etParts(ms), m = p.hour * 60 + p.minute;
        if (m < 570 || m >= 960 || p.weekday === 'Sat' || p.weekday === 'Sun') continue;
        (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)).push([m, r.o, r.h, r.l, r.c]);
      }
      packed = [...byDate.entries()].sort().map(([date, bars]) => ({date, bars}));
      store.write(name, packed);
      log(`${sym} ${y}: ${packed.length} sessions (${alpaca.requests} requests so far)`);
    }
    days.push(...packed);
  }
  return days.map(d => ({date: d.date, bars: d.bars.map(([m, o, h, l, c]) => ({m, o, h, l, c}))}));
}

export function analyse(daysBySym) {
  const out = {};
  for (const [sym, days] of Object.entries(daysBySym)) {
    const res = {sessions: days.length, first: days[0]?.date, last: days.at(-1)?.date, headline: {}, grid: [], control: {}, years: {}, halves: {}};
    for (const c of COSTS) {
      const t = runDays(days, HEADLINE, c);
      res.headline[c.id] = stats(t);
      res.control[c.id] = stats(runDays(days, {...HEADLINE, mirror: true}, c));
    }
    const main = runDays(days, HEADLINE, COSTS[1]);
    res.years = byYear(main);
    const mid = Math.floor(main.length / 2);
    res.halves = {first: stats(main.slice(0, mid)), second: stats(main.slice(mid))};
    res.trades = main;
    res.tradesHard = runDays(days, HEADLINE, COSTS[2]);
    res.longShort = {long: stats(main.filter(t => t.dir === 'long')), short: stats(main.filter(t => t.dir === 'short'))};
    for (const g of GRID) res.grid.push({...g, gross: stats(runDays(days, g, COSTS[0])), cheap: stats(runDays(days, g, COSTS[1])), hard: stats(runDays(days, g, COSTS[2]))});
    out[sym] = res;
  }
  return out;
}

export function report(res) {
  const L = ['# First candle rule: QQQ and SPY, one-minute bars', ''];
  L.push('Paper research only; no orders are placed. Rules are from a short promotional video, so every unstated detail is a choice made here (listed at the bottom). ' +
    'The headline configuration was fixed before any results were seen: 3:1 reward to risk, stop beyond the engulfing candle, entries until 11:30 ET, one trade a day, flat at 15:55. ' +
    'All other rows are sensitivity checks and count as extra tries, not as new evidence.', '');
  for (const [sym, r] of Object.entries(res)) {
    L.push(`## ${sym}: ${r.first} to ${r.last} (${r.sessions} sessions)`, '');
    L.push('Break-even win rate at 3:1 is 25% before costs. R is one unit of risk per trade; t is the t-statistic of average R (about 2 or more is "unlikely to be luck", before allowing for the many variants tried).', '');
    L.push('| Costs | Trades | Win rate | Avg R | Total R | t | Profit factor | Max drawdown (R) | Hit stop | Hit target |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of COSTS) { const s = r.headline[c.id]; L.push(`| ${c.label} | ${s.n} | ${pct(s.winRate)} | ${f2(s.avgR)} | ${f2(s.totalR)} | ${f2(s.t)} | ${f2(s.profitFactor)} | ${f2(s.maxDdR)} | ${pct(s.stopPct)} | ${pct(s.targetPct)} |`); }
    L.push('', `Control, same entries traded the opposite way with the same geometry: gross avg R ${f2(r.control.gross.avgR)} (t ${f2(r.control.gross.t)}), 2c costs ${f2(r.control.cheap.avgR)}. If the rule had real direction information, the real trades should beat this clearly.`, '');
    L.push(`Long trades (2c costs): ${r.longShort.long.n} trades, avg R ${f2(r.longShort.long.avgR)}. Short trades: ${r.longShort.short.n} trades, avg R ${f2(r.longShort.short.avgR)}. First half of trades: avg R ${f2(r.halves.first.avgR)}, second half: ${f2(r.halves.second.avgR)}.`, '');
    L.push('| Year | Trades | Win rate | Avg R (2c costs) | Total R |', '|---|---:|---:|---:|---:|');
    for (const [y, s] of Object.entries(r.years)) L.push(`| ${y} | ${s.n} | ${pct(s.winRate)} | ${f2(s.avgR)} | ${f2(s.totalR)} |`);
    L.push('', '<details><summary>Sensitivity grid (avg R per trade)</summary>\n', '| Target | Stop | Last entry | Trades | Gross | 2c costs | 4c costs | Win rate (gross) |', '|---:|---|---|---:|---:|---:|---:|---:|');
    for (const g of r.grid) L.push(`| ${g.rr}R | ${g.stop} | ${hhmm(g.cutoff)} | ${g.gross.n} | ${f2(g.gross.avgR)} | ${f2(g.cheap.avgR)} | ${f2(g.hard.avgR)} | ${pct(g.gross.winRate)} |`);
    L.push('\n</details>', '');
  }
  L.push('## Choices the video does not settle',
    '- Instrument: the video does not say. QQQ and SPY shares stand in for NQ and ES futures; futures have different costs and tick sizes, so a futures result could differ.',
    '- "Break through the level and create a gap": read as a 1-minute bar that CLOSES beyond the first-candle high or low, with a fair value gap (the bar before and the bar after do not overlap).',
    '- "Candle engulfing": the candle body engulfs the previous candle body, in the breakout direction, after price trades back into the gap. Entry at that candle\'s close.',
    '- Stop: beyond the engulfing candle (the video\'s risk box looks about that size). A stop beyond the gap is in the grid.',
    '- One trade a day, no break-even or partials, flat at 15:55. The video gives no time cutoff, so 11:30 is a choice; a 15:30 cutoff is in the grid.',
    '- If one bar touches both stop and target, the stop is assumed to hit first.',
    '', '## Limits',
    '- Costs are assumptions, not measurements; stops on a fast open can fill much worse than 1 to 2 cents.',
    '- Many variants were tried; only the headline row was fixed in advance.',
    '- Data is Alpaca SIP one-minute bars, split-adjusted. Minutes with no trades have no bar, which slightly changes how gaps look on quiet days.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  let start = '2016-01-04', end = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10), out = join(HERE, 'out-fcr'), data = join(HERE, 'data');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start') start = argv[++i]; else if (a === '--end') end = argv[++i];
    else if (a === '--out') out = resolve(argv[++i]); else if (a === '--data') data = resolve(argv[++i]);
    else throw new Error('unknown option ' + a);
  }
  const log = m => console.error(m);
  const store = new Store(data);
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, log});
  const daysBySym = {};
  for (const s of SYMBOLS) daysBySym[s] = await loadSymbol(alpaca, store, s, start, end, log);
  const res = analyse(daysBySym);
  mkdirSync(out, {recursive: true});
  const text = report(res);
  writeFileSync(join(out, 'summary.md'), text);
  const slim = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, {...v, trades: undefined, tradesHard: undefined}]));
  writeFileSync(join(out, 'results.json'), JSON.stringify(slim, null, 1));
  for (const [sym, r] of Object.entries(res)) writeFileSync(join(out, `trades-${sym}.csv`), 'date,dir,entry,stop,exit,risk,reason,entry_min,exit_min,r_net_2c,r_gross\n' +
    r.trades.map(t => [t.date, t.dir, t.entry.toFixed(2), t.stop.toFixed(2), t.exit.toFixed(2), t.risk.toFixed(2), t.reason, t.entryMin, t.exitMin, t.r.toFixed(3), t.rGross.toFixed(3)].join(',')).join('\n') + '\n');
  console.log(text);
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
