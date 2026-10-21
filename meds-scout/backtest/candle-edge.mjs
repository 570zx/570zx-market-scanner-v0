#!/usr/bin/env node
// Looks for a predictable edge in candle behaviour across liquid ETFs. Paper research only: places no orders.
//   Search period: sessions before SPLIT. A configuration is eligible only if it works on most ETFs and in most years,
//   with a win rate at or above the floor. Ranked by the MEDIAN excess t across ETFs (excess = better than doing
//   the same trade every day, which removes plain market drift). Luck baseline: same search on shuffled returns.
//   The best few are then tested once on SPLIT onward, which the search never saw.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {loadSymbol} from './fcr.mjs';
import {buildRecords, configs, trades, baseline, summarize, permuted} from './lib/candles.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const SPLIT = '2023-01-01';
export const OPT = {minWin: 0.5, minTrades: 100, share: 0.75, yearShare: 0.7, symbols: ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLK', 'XLE', 'TLT', 'GLD']};
const CHEAP = 0.02, HARD = 0.04;
const f3 = x => x == null ? '—' : x.toFixed(3), pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%', bp = x => x == null ? '—' : (10000 * x).toFixed(1);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const label = c => `${c.sig} (${c.dir > 0 ? 'long' : 'short'}), trend ${c.trend}, hold ${c.hold}`;

function yearsPositive(allTrades, minPerYear = 8) {
  const by = {};
  for (const t of allTrades) { const y = t.date.slice(0, 4); (by[y] ??= []).push(t.r); }
  const ys = Object.entries(by).filter(([, v]) => v.length >= minPerYear).map(([y, v]) => ({y, mean: v.reduce((a, b) => a + b, 0) / v.length, n: v.length, win: v.filter(r => r > 0).length / v.length}));
  return {years: ys, share: ys.length ? ys.filter(y => y.mean > 0).length / ys.length : 0};
}

// Search-period score for one configuration across all symbols.
export function scoreConfig(recsBySym, cfg, to = SPLIT, cost = CHEAP) {
  const per = {}, pooled = [];
  for (const [sym, recs] of Object.entries(recsBySym)) {
    const ts = trades(recs, cfg, cost, '0000', to), st = summarize(ts), b = baseline(recs, cfg, cost, '0000', to);
    per[sym] = {...st, excessT: st.n > 1 && st.sd ? (st.mean - b) / (st.sd / Math.sqrt(st.n)) : 0, base: b};
    pooled.push(...ts);
  }
  const syms = Object.keys(per), passing = syms.filter(s => per[s].n >= OPT.minTrades && per[s].winRate >= OPT.minWin && per[s].mean > 0 && per[s].excessT > 0);
  const yp = yearsPositive(pooled);
  const eligible = passing.length >= Math.ceil(OPT.share * syms.length) && yp.share >= OPT.yearShare;
  return {cfg, per, passing: passing.length, yearShare: yp.share, score: median(syms.map(s => per[s].excessT)), eligible, pooled: summarize(pooled)};
}

export function runSearch(recsBySym, {nulls = 20, seed = 11} = {}) {
  const cfgs = configs();
  const real = cfgs.map(c => scoreConfig(recsBySym, c)).filter(x => x.eligible).sort((a, b) => b.score - a.score);
  let s = seed; const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const nullBest = [];
  for (let k = 0; k < nulls; k++) {
    const shuffled = Object.fromEntries(Object.entries(recsBySym).map(([sym, r]) => [sym, permuted(r, rand)]));
    const best = cfgs.map(c => scoreConfig(shuffled, c)).filter(x => x.eligible).reduce((m, x) => Math.max(m, x.score), -Infinity);
    nullBest.push(Number.isFinite(best) ? best : null);
  }
  const top = real.slice(0, 10).map(r => {
    const hold = {};
    for (const [sym, recs] of Object.entries(recsBySym)) hold[sym] = {cheap: summarize(trades(recs, r.cfg, CHEAP, SPLIT)), hard: summarize(trades(recs, r.cfg, HARD, SPLIT)), base: baseline(recs, r.cfg, CHEAP, SPLIT)};
    const pooled = Object.keys(recsBySym).flatMap(sym => trades(recsBySym[sym], r.cfg, CHEAP, SPLIT));
    const yp = yearsPositive(pooled, 5);
    const syms = Object.keys(hold);
    const good = syms.filter(s => hold[s].cheap.n >= 30 && hold[s].cheap.mean > 0 && hold[s].cheap.winRate >= OPT.minWin);
    const medT = median(syms.map(s => hold[s].cheap.n > 1 ? hold[s].cheap.t : 0));
    const pass = good.length >= Math.ceil(OPT.share * syms.length) && medT >= 2 && yp.share >= OPT.yearShare;
    return {...r, hold, holdPooled: summarize(pooled), holdYears: yp, goodSyms: good.length, medT, pass};
  });
  return {tried: cfgs.length, eligible: real.length, real, top, nullBest, syms: Object.keys(recsBySym)};
}

export function report(r) {
  const L = ['# Candle-pattern edge search across liquid ETFs', ''];
  L.push(`Paper research only. ${r.tried} configurations (daily candle patterns, first-30-minute candle, late-day drift) on ${r.syms.length} ETFs (${r.syms.join(', ')}). ` +
    `Eligible only if, on sessions before ${SPLIT}: at least ${Math.round(OPT.share * 100)}% of ETFs have a win rate of ${Math.round(OPT.minWin * 100)}% or more, a positive average after costs and beat the same trade taken every day; and at least ${Math.round(OPT.yearShare * 100)}% of years are positive. ` +
    `${r.eligible} qualified. Costs: 2 cents per share round trip (4 cents shown as a stress).`, '');
  const nb = r.nullBest.filter(x => x != null).sort((a, b) => a - b);
  L.push('## What luck looks like', `The identical search on shuffled returns found an eligible configuration in ${nb.length} of ${r.nullBest.length} shuffles; their best median excess t: ${nb.length ? `median ${f3(median(nb))}, highest ${f3(nb.at(-1))}` : 'none'}. A real result should clearly exceed the highest shuffled value.`, '');
  L.push('## Best on the search period', '', '| # | Configuration | ETFs passing | Years positive | Pooled trades | Win rate | Avg trade (bp) | Median excess t |', '|---:|---|---:|---:|---:|---:|---:|---:|');
  r.real.slice(0, 15).forEach((x, i) => L.push(`| ${i + 1} | ${label(x.cfg)} | ${x.passing}/${r.syms.length} | ${pct(x.yearShare)} | ${x.pooled.n} | ${pct(x.pooled.winRate)} | ${bp(x.pooled.mean)} | ${f3(x.score)} |`));
  L.push('', `## Untouched test: ${SPLIT} onward`, '', 'Each of the top 10, run once. "ETFs good" = win rate at or above the floor with a positive average after 2c costs (30+ trades).', '',
    '| # | Configuration | ETFs good | Trades | Win rate | Avg trade (bp) | Avg at 4c (bp) | Median t | Years positive | Worst losing streak, summed trades (%) | Passes |', '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  r.top.forEach((x, i) => { const hp = x.holdPooled, hard = summarize(Object.keys(x.hold).flatMap(s => [])), h4 = Object.values(x.hold).reduce((a, h) => a + (h.hard.total ?? 0), 0) / Math.max(1, hp.n);
    L.push(`| ${i + 1} | ${label(x.cfg)} | ${x.goodSyms}/${r.syms.length} | ${hp.n} | ${pct(hp.winRate)} | ${bp(hp.mean)} | ${bp(h4)} | ${f3(x.medT)} | ${pct(x.holdYears.share)} | ${hp.maxDd == null ? '—' : (100 * hp.maxDd).toFixed(1)} | ${x.pass ? '**yes**' : 'no'} |`); });
  const winners = r.top.filter(x => x.pass);
  L.push('', '### Per-ETF detail for the best untouched-test result', '');
  const best = winners[0] ?? r.top[0];
  if (best) { L.push(`${label(best.cfg)}`, '', '| ETF | Trades | Win rate | Avg trade (bp) | t | Same trade every day (bp) |', '|---|---:|---:|---:|---:|---:|');
    for (const [s, h] of Object.entries(best.hold)) L.push(`| ${s} | ${h.cheap.n} | ${pct(h.cheap.winRate)} | ${bp(h.cheap.mean)} | ${f3(h.cheap.t)} | ${bp(h.base)} |`);
    L.push('', '| Year | Pooled trades | Win rate | Avg trade (bp) |', '|---|---:|---:|---:|'); for (const y of best.holdYears.years) L.push(`| ${y.y} | ${y.n} | ${pct(y.win)} | ${bp(y.mean)} |`); }
  L.push('', '## Verdict', winners.length ? `${winners.length} of the top ${r.top.length} configurations passed every test on data the search never saw: ${winners.map(w => label(w.cfg)).join('; ')}. With ${r.tried} tries and this being one holdout, they are candidates for a forward paper test, not proof.`
    : `No configuration passed every test on data the search never saw. The win-rate floor was met by many (market drift alone gives long trades a win rate above 50%), but none also beat the same trade taken every day, held up on most ETFs and years, and cleared t of 2.`, '',
    '## Limits', '- Costs are assumptions. Entries and exits use the open of a named minute bar (15:55, 09:30, 10:00, 11:30, 15:30), with no look-ahead; real fills can be worse.',
    '- Signals use only bars before the decision time; daily patterns are decided at 15:55 from bars up to 15:54.', '- ETFs only; single stocks, futures and options are not covered.', `- ${r.tried} tries: a good-looking row is expected by chance, which is why the luck comparison and the untouched test matter.`);
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  let start = '2016-01-04', end = '2026-10-19', out = join(HERE, 'out-candle-edge'), data = join(HERE, 'data'), nulls = 20;
  for (let i = 0; i < argv.length; i++) { const a = argv[i];
    if (a === '--start') start = argv[++i]; else if (a === '--end') end = argv[++i]; else if (a === '--out') out = resolve(argv[++i]); else if (a === '--data') data = resolve(argv[++i]);
    else if (a === '--symbols') OPT.symbols = argv[++i].split(','); else if (a === '--min-win') OPT.minWin = Number(argv[++i]); else if (a === '--nulls') nulls = Number(argv[++i]);
    else throw new Error('unknown option ' + a); }
  const log = m => console.error(m), store = new Store(data);
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: 150, log});
  const recsBySym = {};
  for (const s of OPT.symbols) recsBySym[s] = buildRecords(await loadSymbol(alpaca, store, s, start, end, log));
  const res = runSearch(recsBySym, {nulls});
  mkdirSync(out, {recursive: true});
  const text = report(res);
  writeFileSync(join(out, 'summary.md'), text);
  writeFileSync(join(out, 'results.json'), JSON.stringify({tried: res.tried, eligible: res.eligible, nullBest: res.nullBest, real: res.real.slice(0, 40), top: res.top}, null, 1));
  console.log(text);
  return res;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
