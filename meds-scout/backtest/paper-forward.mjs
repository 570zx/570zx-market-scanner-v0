#!/usr/bin/env node
// Forward PAPER test of the frozen weak-close ETF rules. It places no orders and touches no broker account:
// it reads market data (GET requests only), recomputes the simulated portfolio from the go-live date, and writes a
// dated signal record plus a progress report into a state folder that the workflow commits to its own branch.
//
// Frozen rules (from the ETF research; do not tune while the test runs):
//   Universe  SPY QQQ IWM DIA XLF XLK XLE TLT GLD
//   Signal    at 15:55 ET, a daily candle (bars up to 15:54) that closes in the bottom IBS fraction of its range
//   Entry     open of the 15:55 bar, most oversold first, equal share of equity per slot, up to 5 slots
//   Account A IBS <= 0.1, only above the 200-day average, hold 5 sessions
//   Account B IBS <= 0.1, no trend filter, sell on a close above the prior day's high (max 5 sessions)
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {etParts} from './lib/time.mjs';
import {loadSymbol} from './fcr.mjs';
import {buildRecords} from './lib/candles.mjs';
import {align, simulate, metricsFromReturns, tradeStats} from './lib/portfolio.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const GO_LIVE = '2026-10-21';
export const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLK', 'XLE', 'TLT', 'GLD'];
export const ACCOUNTS = [
  {id: 'A', label: 'IBS ≤ 0.1, above 200-day average, hold 5 sessions', cfg: {thr: 0.1, slots: 5, exit: 'hold5', trend: 'sma200up'}},
  {id: 'B', label: 'IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)', cfg: {thr: 0.1, slots: 5, exit: 'strength5', trend: 'none'}},
];
const COST = 0.01; // dollars per share each way
const pct = x => x == null ? '—' : (100 * x).toFixed(2) + '%', usd = x => '$' + x.toFixed(2);
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

export function buildReport({asOf, byAccount, spy, nSessions}) {
  const L = ['# Weak-close ETF strategy: forward paper test', '',
    `**Paper only: no orders are placed and no broker account is touched.** Go-live ${GO_LIVE}; last update ${asOf} (${nSessions} sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.`, ''];
  for (const a of byAccount) {
    const ts = tradeStats(a.trades), m = metricsFromReturns(a.rets);
    L.push(`## Account ${a.id}: ${a.label}`, '');
    L.push(a.todayEntries.length ? `Signals logged ${asOf}: ${a.todayEntries.map(e => `**${e.sym}** (IBS ${e.ibs.toFixed(3)}, paper buy at ${usd(e.px)})`).join(', ')}.` : `No new signals on ${asOf}.`);
    L.push(a.todayExits.length ? `Exits on ${asOf}: ${a.todayExits.map(t => `${t.sym} ${pct(t.ret)} (${t.why})`).join(', ')}.` : '', '');
    L.push(`Equity since go-live: ${pct(m.total ?? 0)} (hold SPY: ${pct(spy.total ?? 0)}). Max drawdown ${pct(m.maxDd ?? 0)}. Closed trades ${ts.n ?? 0}${ts.n ? `, win rate ${pct(ts.winRate)}, average ${pct(ts.avg)}, longest losing streak ${ts.losingStreak}` : ''}. Progress to the 100-trade review: ${Math.min(100, ts.n ?? 0)}/100.`, '');
    if (a.open.length) { L.push('| Open position | Entered | Entry | Last | P&L | Sessions held |', '|---|---|---:|---:|---:|---:|'); for (const p of a.open) L.push(`| ${p.sym} | ${p.entryDate} | ${usd(p.entry)} | ${usd(p.mark)} | ${pct(p.mark / p.entry - 1)} | ${p.days} |`); L.push(''); }
    if (a.trades.length) { L.push('| Closed trade | Entered | Exited | Return | Exit reason |', '|---|---|---|---:|---|'); for (const t of a.trades.slice(-15).reverse()) L.push(`| ${t.sym} | ${t.entry} | ${t.exit} | ${pct(t.ret)} | ${t.why} |`); L.push(''); }
  }
  L.push('## What the backtests led us to expect', '- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.',
    '- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.',
    '- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl, now = Date.now()} = {}) {
  let state = join(HERE, 'paper-state'), today = null, force = false;
  for (let i = 0; i < argv.length; i++) { const a = argv[i];
    if (a === '--state') state = resolve(argv[++i]); else if (a === '--today') today = argv[++i]; else if (a === '--force') force = true; else throw new Error('unknown option ' + a); }
  const log = m => console.error(m);
  const et = etParts(now), day = today ?? et.date;
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: 150, log});
  const cal = (await alpaca.calendar(day, day)).filter(c => c.date === day);
  if (!cal.length) { log(`${day} is not a trading session; nothing to do.`); return {skipped: 'no session'}; }
  if (!force && !today && et.hour * 60 + et.minute < 16 * 60 + 5) { log(`It is ${et.hour}:${String(et.minute).padStart(2, '0')} ET; waiting for the close (16:05 ET) before computing.`); return {skipped: 'too early'}; }
  if (day < GO_LIVE) { log(`Before go-live (${GO_LIVE}).`); return {skipped: 'before go-live'}; }
  const store = new Store(join(state, '.cache')), recs = {};
  const start = addDays(day, -520);
  for (const s of SYMBOLS) recs[s] = buildRecords(await loadSymbol(alpaca, store, s, start, day, log, '5Min'), {minBars: 60});
  const al = align(recs);
  if (al.dates.at(-1) !== day) log(`Warning: last usable session is ${al.dates.at(-1)}, not ${day} (early close or missing data); no signals can be logged for ${day}.`);
  const spyRets = []; let prev = null;
  al.dates.forEach(d => { const r = al.by.SPY[al.dates.indexOf(d)]; if (!r) return; if (prev && d >= GO_LIVE) spyRets.push(r.e955 / prev - 1); prev = r.e955; });
  const byAccount = ACCOUNTS.map(a => {
    const sim = simulate(al, a.cfg, {cost: COST, stopSlip: COST, from: GO_LIVE});
    const rets = sim.daily.filter((_, i) => al.dates[i] >= GO_LIVE);
    return {id: a.id, label: a.label, trades: sim.trades.filter(t => t.entry >= GO_LIVE), open: sim.open, rets, todayEntries: sim.entries.filter(e => e.date === day), todayExits: sim.trades.filter(t => t.exit === day), entries: sim.entries};
  });
  mkdirSync(join(state, 'signals'), {recursive: true});
  const file = join(state, 'signals', `${day}.json`);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({date: day, loggedAt: new Date(now).toISOString(), accounts: Object.fromEntries(byAccount.map(a => [a.id, {entries: a.todayEntries, exits: a.todayExits}]))}, null, 1)); // first record of the day is kept
  const report = buildReport({asOf: day, byAccount, spy: metricsFromReturns(spyRets), nSessions: spyRets.length});
  writeFileSync(join(state, 'PAPER-FORWARD.md'), report);
  writeFileSync(join(state, 'ledger.json'), JSON.stringify(Object.fromEntries(byAccount.map(a => [a.id, {trades: a.trades, open: a.open, entries: a.entries.filter(e => e.date >= GO_LIVE)}])), null, 1));
  console.log(report);
  return {byAccount, file};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
