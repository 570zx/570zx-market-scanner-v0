#!/usr/bin/env node
// Looks for a version of the first candle rule that works after costs, without fooling itself.
//   - Search only on sessions before SPLIT. Rank by the WORSE of the QQQ and SPY t-statistics.
//   - Show what pure luck looks like: the same search on direction-flipped trades.
//   - Test the top configurations once on SPLIT and later, which the search never saw.
// Paper research only: no orders are placed.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {runDays, stats, enrich} from './lib/fcr.mjs';
import {loadSymbol, COSTS} from './fcr.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const SPLIT = '2023-01-01';
const MIN_TRADES = 150;
const cheap = COSTS[1], hard = COSTS[2], gross = COSTS[0];

export function grid() {
  const out = [];
  for (const stop of ['engulf', 'fvg', 'orb']) for (const rr of [1, 1.5, 2, 3]) for (const cutoff of [10 * 60 + 30, 11 * 60 + 30, 13 * 60 + 30])
    for (const dirFilter of ['none', 'first', 'gap', 'trend']) for (const minRiskPct of [0, 0.0005, 0.001]) for (const minOrbAtr of [0, 0.3])
      out.push({stop, rr, cutoff, dirFilter, minRiskPct, minOrbAtr});
  return out;
}
const label = c => `${c.rr}R, stop ${c.stop}, until ${String(Math.floor(c.cutoff / 60))}:${String(c.cutoff % 60).padStart(2, '0')}, direction ${c.dirFilter}, min risk ${(c.minRiskPct * 100).toFixed(2)}%, min range ${c.minOrbAtr}x ATR`;
const f2 = x => x == null ? '—' : x.toFixed(3), pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';

export function search(daysBySym) {
  const train = {}, hold = {};
  for (const [s, days] of Object.entries(daysBySym)) { train[s] = days.filter(d => d.date < SPLIT); hold[s] = days.filter(d => d.date >= SPLIT); }
  const syms = Object.keys(daysBySym);
  const score = (cfg, mirror) => {
    const per = syms.map(s => stats(runDays(train[s], {...cfg, mirror}, cheap)));
    if (per.some(p => p.n < MIN_TRADES)) return null;
    return {cfg, per, score: Math.min(...per.map(p => p.t))};
  };
  const real = grid().map(c => score(c, false)).filter(Boolean).sort((a, b) => b.score - a.score);
  const luck = grid().map(c => score(c, true)).filter(Boolean).sort((a, b) => b.score - a.score);
  const top = real.slice(0, 8).map(r => ({...r,
    hold: Object.fromEntries(syms.map(s => [s, {gross: stats(runDays(hold[s], r.cfg, gross)), cheap: stats(runDays(hold[s], r.cfg, cheap)), hard: stats(runDays(hold[s], r.cfg, hard))}]))}));
  return {syms, tried: grid().length, eligible: real.length, real, luck, top, trainN: Object.fromEntries(syms.map(s => [s, train[s].length])), holdN: Object.fromEntries(syms.map(s => [s, hold[s].length]))};
}

export function report(r) {
  const L = ['# First candle rule: searching for a version with an edge', ''];
  L.push(`Paper research only. ${r.tried} configurations were tried on sessions before ${SPLIT} (${Object.entries(r.trainN).map(([s, n]) => `${s} ${n}`).join(', ')}); ${r.eligible} had enough trades (${MIN_TRADES}+ on both ETFs). ` +
    `Results are net of the 2c round-trip cost scenario. Ranking uses the worse of the QQQ and SPY t-statistics, so a config must work on both.`, '');
  const bestLuck = r.luck[0];
  L.push('## How good does luck look?', `The same search on direction-flipped trades (which cannot have a real edge) still produced a best worse-of-two t of **${f2(bestLuck?.score)}**, and the median config scored ${f2(r.luck[Math.floor(r.luck.length / 2)]?.score)}. A real config has to clearly beat the best flipped result, and then survive the untouched later period.`, '');
  L.push('## Best configurations on the search period (before ' + SPLIT + ')', '', '| # | Configuration | ' + r.syms.map(s => `${s} trades | ${s} avg R | ${s} t`).join(' | ') + ' | Worse t |', '|---:|---|' + r.syms.map(() => '---:|---:|---:|').join('') + '---:|');
  r.real.slice(0, 15).forEach((x, i) => L.push(`| ${i + 1} | ${label(x.cfg)} | ${x.per.map(p => `${p.n} | ${f2(p.avgR)} | ${f2(p.t)}`).join(' | ')} | ${f2(x.score)} |`));
  L.push('', `## The untouched test: ${SPLIT} onward (${Object.entries(r.holdN).map(([s, n]) => `${s} ${n} sessions`).join(', ')})`, '',
    'Each of the top 8 configurations, run once on sessions the search never saw. Avg R is per trade; 2c and 4c are the cost scenarios.', '',
    '| # | Configuration | Symbol | Trades | Win rate | Avg R gross | Avg R 2c | t (2c) | Avg R 4c |', '|---:|---|---|---:|---:|---:|---:|---:|---:|');
  r.top.forEach((x, i) => { for (const s of r.syms) { const h = x.hold[s]; L.push(`| ${i + 1} | ${label(x.cfg)} | ${s} | ${h.cheap.n} | ${pct(h.cheap.winRate)} | ${f2(h.gross.avgR)} | ${f2(h.cheap.avgR)} | ${f2(h.cheap.t)} | ${f2(h.hard.avgR)} |`); } });
  const pass = r.top.filter(x => r.syms.every(s => x.hold[s].cheap.avgR > 0 && x.hold[s].cheap.t >= 2));
  L.push('', '## Verdict', pass.length ? `${pass.length} of the top ${r.top.length} configurations stayed profitable after 2c costs with t of 2 or more on BOTH ETFs in the untouched period: ${pass.map(x => label(x.cfg)).join('; ')}. With ${r.tried} tries, treat even these as candidates for paper trading, not proof.`
    : `None of the top ${r.top.length} configurations stayed profitable with t of 2 or more on both ETFs in the untouched period. The search found no version of this strategy with an edge that survives costs on QQQ or SPY shares.`, '',
    '## Limits', '- Same cost assumptions and data as the main test; stops on a fast open can fill worse.', `- ${r.tried} configurations tried; the luck comparison above is the guide to how much a good-looking search result is worth.`,
    '- Only QQQ and SPY shares; futures (NQ, ES) have different costs relative to risk and are not tested.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  let start = '2016-01-04', end = '2026-10-19', out = join(HERE, 'out-fcr-search'), data = join(HERE, 'data');
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--start') start = argv[++i]; else if (a === '--end') end = argv[++i]; else if (a === '--out') out = resolve(argv[++i]); else if (a === '--data') data = resolve(argv[++i]); else throw new Error('unknown option ' + a); }
  const log = m => console.error(m), store = new Store(data);
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, log});
  const daysBySym = {};
  for (const s of ['QQQ', 'SPY']) daysBySym[s] = enrich(await loadSymbol(alpaca, store, s, start, end, log));
  const res = search(daysBySym);
  mkdirSync(out, {recursive: true});
  const text = report(res);
  writeFileSync(join(out, 'summary.md'), text);
  writeFileSync(join(out, 'results.json'), JSON.stringify({tried: res.tried, eligible: res.eligible, real: res.real.slice(0, 50), luck: res.luck.slice(0, 20), top: res.top}, null, 1));
  console.log(text);
  return res;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
