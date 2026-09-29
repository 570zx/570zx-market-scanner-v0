#!/usr/bin/env node
// Opening-range breakout test on the cached one-minute days (run MEDS backtest
// first so the cache exists, or restore it in CI).
//   node backtest/orb.mjs [--data DIR] [--out DIR]
import {readdirSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {runOrb, summarize} from './lib/orb.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const money = x => (x < 0 ? '−$' : '$') + Math.abs(x).toFixed(2);
const pct = x => x == null ? '—' : x.toFixed(1) + '%';

export const VARIANTS = [
  {id: 'orb_1_5R', label: 'Take profit at 1.5x the risk', params: {rr: 1.5}},
  {id: 'orb_2R', label: 'Take profit at 2x the risk', params: {rr: 2}},
  {id: 'orb_3R', label: 'Take profit at 3x the risk', params: {rr: 3}},
  {id: 'orb_2R_gap5', label: 'As orb_2R, but only stocks gapping up 5% or more', params: {rr: 2, minGap: 0.05}},
];

export function report(days, results) {
  const L = [];
  L.push(`# MEDS opening-range breakout test: ${days[0].date} to ${days.at(-1).date} (${days.length} trading days)`, '');
  L.push('Each morning, after 09:45 ET, buy the (up to 3) gapping, heavily traded stocks the bot could already see that break above their first-15-minute high. ' +
    'Stop at the low of that range, take profit at a multiple of the risk, sell the rest at 15:50. Starts at $250, one third of the account per trade. ' +
    'Costs: 0.5% per side (the spread the earlier test measured on these stocks); the last column doubles it.', '');
  L.push('| Variant | Days | Trades | Win rate | Avg trade | Avg R | Final | Return | Max drawdown | Earlier days | Last 10 days | Return if costs ×2 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const s = r.stats;
    L.push(`| **${r.id}** | ${s.days} | ${s.trades} | ${pct(s.winRatePct)} | ${pct(s.avgTradePct)} | ${s.avgR ?? '—'} | ${money(s.final)} | ${pct(s.returnPct)} | ${pct(s.maxDrawdownPct)} | ${pct(s.earlyReturnPct)} | ${pct(s.lastTenReturnPct)} | ${pct(r.stress.returnPct)} |`);
  }
  L.push('', '## Variants');
  for (const r of results) L.push(`- **${r.id}**: ${r.label}`);
  L.push('');
  for (const r of results) {
    L.push(`<details><summary><b>${r.id}</b> exits</summary>\n`, '| Exit | Trades | Avg | P&L |', '|---|---:|---:|---:|');
    for (const [k, e] of Object.entries(r.stats.byReason)) L.push(`| ${k} | ${e.n} | ${pct(e.avgPct)} | ${money(e.pnl)} |`);
    L.push('\n</details>\n');
  }
  L.push('## Limits',
    '- Only about 40 days of one-minute data exist, so a few lucky or unlucky trades move the result a lot. Treat it as a first look, not proof.',
    '- Entries fill at the range high (or the open if it gapped above) plus the cost; a fast breakout in a thin stock can fill worse than that.',
    '- If the entry bar also reaches the stop, the stop is assumed to hit first. Halts, borrow and the day-trade limits for small accounts are not modeled.',
    '- Stocks are limited to those the bot\'s screens showed by 09:45, using the same no-hindsight rules as the intraday backtest.');
  return L.join('\n') + '\n';
}

export function main(argv) {
  let data = join(HERE, 'data'), out = join(HERE, 'out-orb');
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--data') data = resolve(argv[++i]); else if (argv[i] === '--out') out = resolve(argv[++i]); else throw new Error('unknown option ' + argv[i]); }
  const dir = join(data, 'days');
  if (!existsSync(dir)) throw new Error(`no cached days in ${dir}; run MEDS backtest first`);
  const store = new Store(data);
  const names = readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort();
  const days = names.map(n => store.read('days/' + n));
  if (days.length < 5) throw new Error(`only ${days.length} cached days`);
  const results = VARIANTS.map(v => {
    const run = runOrb(days, v.params), stress = runOrb(days, {...v.params, cost: 0.01});
    return {...v, run, stats: summarize(run), stress: summarize(stress)};
  });
  mkdirSync(out, {recursive: true});
  const text = report(days, results);
  writeFileSync(join(out, 'summary.md'), text);
  writeFileSync(join(out, 'results.json'), JSON.stringify(results.map(r => ({id: r.id, stats: r.stats, stress: r.stress, curve: r.run.curve})), null, 1));
  for (const r of results) writeFileSync(join(out, `trades-${r.id}.csv`), 'date,symbol,entry,exit,return_pct,risk_pct,reason,minutes,pnl\n' +
    r.run.trades.map(t => [t.date, t.sym, t.entry.toFixed(4), t.exit.toFixed(4), t.retPct.toFixed(2), t.riskPct.toFixed(2), t.reason, t.minutes, t.pnl.toFixed(2)].join(',')).join('\n') + '\n');
  console.log(text);
  return {days, results};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
