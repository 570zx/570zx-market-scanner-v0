#!/usr/bin/env node
// Improves and stress-tests the weak-close ("low IBS") ETF strategy as a real portfolio. Paper research only: no orders.
//   - Slots, best-setup-first ranking, stops and sell-on-strength exits (lib/portfolio.mjs).
//   - Walk-forward: each year trades the configuration that had the best Sharpe over EARLIER years only.
//   - Compared with the original idea (IBS <= 0.2, hold 3 days) and with simply holding SPY over the same dates.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {loadSymbol} from './fcr.mjs';
import {buildRecords} from './lib/candles.mjs';
import {align, configs, simulate, cfgLabel, BASELINE, metricsFromReturns, tradeStats, monthly, sliceRange, walkForward, yearOf} from './lib/portfolio.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLK', 'XLE', 'TLT', 'GLD'];
const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%', f2 = x => x == null ? '—' : x.toFixed(2);
const same = (a, b) => a.thr === b.thr && a.slots === b.slots && a.exit === b.exit && a.trend === b.trend;

export function analyse(recsBySym, {firstTestYear = '2019', cost = 0.01, stopSlip = 0.01, slotList = [3, 5], benchOnly = false, borrow = 0.06} = {}) {
  const tradable = benchOnly ? Object.fromEntries(Object.entries(recsBySym).filter(([k]) => k !== 'SPY')) : recsBySym;
  const al = align(tradable);
  const baseCfg = {...BASELINE, slots: slotList.includes(BASELINE.slots) ? BASELINE.slots : slotList.at(-1)};
  const sims = configs(slotList).map(cfg => ({cfg, ...simulate(al, cfg, {cost, stopSlip})}));
  sims.forEach(s => { s.cfg = s.cfg; });
  const wf = walkForward(sims, al.dates, {firstTestYear});
  const from = wf.dates[0], to = '9999';
  const base = sims.find(s => same(s.cfg, baseCfg));
  const baseOos = sliceRange(base, from, to);
  const spy = {rets: [], dates: []};
  const spyByDate = new Map(recsBySym.SPY.filter(r => r.ok).map(r => [r.date, r]));
  let prev = null;
  al.dates.forEach(d => { const r = spyByDate.get(d); if (!r) return; if (prev && d >= from) { spy.rets.push(r.e955 / prev - 1); spy.dates.push(d); } prev = r.e955; });
  const hard = sims.map(s => ({cfg: s.cfg, ...simulate(al, s.cfg, {cost: cost * 2, stopSlip: stopSlip * 2})}));
  const baseHard = sliceRange(hard.find(s => same(s.cfg, baseCfg)), from, to);
  const wfHard = walkForward(hard, al.dates, {firstTestYear});
  const summarise = (rets, dates, trades) => ({...metricsFromReturns(rets), ...monthly(dates, rets), trades: trades ? tradeStats(trades) : null});
  const yearTable = {};
  for (const [name, o] of [['walk-forward', wf], ['original', baseOos], ['SPY', spy]]) {
    const by = {};
    o.dates.forEach((d, i) => { const y = yearOf(d); by[y] = (by[y] ?? 1) * (1 + o.rets[i]); });
    yearTable[name] = Object.fromEntries(Object.entries(by).map(([y, v]) => [y, v - 1]));
  }
  const baseTrades = base.trades.filter(t => t.entry >= from);
  const perEtf = {};
  for (const t of wf.trades) (perEtf[t.sym] ??= []).push(t);
  const full = sims.map(s => ({cfg: s.cfg, m: metricsFromReturns(s.daily), t: tradeStats(s.trades), exposure: s.invested.reduce((a, b) => a + b, 0) / s.invested.length}))
    .sort((a, b) => b.m.sharpe - a.m.sharpe);
  return {
    from, nCfg: sims.length, picks: wf.picks, yearTable,
    wf: summarise(wf.rets, wf.dates, wf.trades), original: summarise(baseOos.rets, baseOos.dates, baseTrades), spy: summarise(spy.rets, spy.dates, null),
    wfHard: summarise(wfHard.rets, wfHard.dates, wfHard.trades), originalHard: summarise(baseHard.rets, baseHard.dates, null),
    perEtf: Object.fromEntries(Object.entries(perEtf).map(([s, t]) => [s, tradeStats(t)])), full,
    exposureWf: null,
    levTable: [1, 2, 3, 4, 5, 6, 8].map(L => { const r = wf.rets.map(x => Math.max(-0.99, L * x - (L > 1 ? (L - 1) * borrow / 252 : 0))); return {L, ...metricsFromReturns(r)}; }),
    goal: 0.89, baseSlots: baseCfg.slots,
    sixMonth: [1, 2, 3, 4, 5, 6, 8].map(L => { const r = wf.rets.map(x => Math.max(-0.99, L * x - (L > 1 ? (L - 1) * borrow / 252 : 0))); return {L, ...rolling(r, 126)}; }),
  };
}

// Rolling windows of `w` trading days (about 6 months at 126): how often did the account double, and how often did it lose 30% or more?
export function rolling(rets, w) {
  const out = [];
  let eq = [1]; for (const r of rets) eq.push(eq.at(-1) * (1 + r));
  for (let i = w; i < eq.length; i++) out.push(eq[i] / eq[i - w] - 1);
  if (!out.length) return {windows: 0};
  const s = out.slice().sort((a, b) => a - b);
  return {windows: out.length, doubled: out.filter(x => x >= 1).length / out.length, lost30: out.filter(x => x <= -0.3).length / out.length, median: s[Math.floor(s.length / 2)], best: s.at(-1), worst: s[0]};
}

export function report(r) {
  const row = (name, m) => `| ${name} | ${pct(m.cagr)} | ${f2(m.sharpe)} | ${pct(m.maxDd)} | ${m.trades ? pct(m.trades.winRate) : '—'} | ${m.trades ? m.trades.n : '—'} | ${m.trades ? m.trades.losingStreak : '—'} | ${pct(m.positive)} | ${pct(m.worst)} |`;
  const L = ['# Weak-close ETF strategy: improvement and walk-forward test', ''];
  L.push(`Paper research only. ${r.nCfg} portfolio configurations (IBS threshold, number of slots, exit rule, trend filter). ` +
    `Out-of-sample period starts ${r.from}: each year trades the configuration with the best Sharpe over all EARLIER years, so no result below was chosen with hindsight. ` +
    `Costs: 1 cent per share each way (2 cents round trip), stops add 1 cent of slippage. Sizing: equal share of equity per slot, up to the slot limit, most oversold first.`, '');
  L.push('## Out-of-sample results', '', '| Strategy | CAGR | Sharpe | Max drawdown | Win rate | Trades | Longest losing streak | Positive months | Worst month |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  L.push(row('Walk-forward selected', r.wf), row(`Original idea (IBS ≤ 0.2, hold 3 days, ${r.baseSlots} slots)`, r.original), row('Hold SPY', r.spy), '');
  L.push(`Cost stress (2 cents each way): walk-forward CAGR ${pct(r.wfHard.cagr)}, Sharpe ${f2(r.wfHard.sharpe)}, drawdown ${pct(r.wfHard.maxDd)}; original CAGR ${pct(r.originalHard.cagr)}, Sharpe ${f2(r.originalHard.sharpe)}.`, '');
  const years = Object.keys(r.yearTable['walk-forward']);
  L.push('## Calendar years', '', '| Year | Walk-forward | Original | Hold SPY | Configuration used that year |', '|---|---:|---:|---:|---|');
  for (const y of years) { const p = r.picks.find(p => p.year === y); L.push(`| ${y} | ${pct(r.yearTable['walk-forward'][y])} | ${pct(r.yearTable.original[y])} | ${pct(r.yearTable.SPY[y])} | ${p ? cfgLabel(p.cfg) : '—'} |`); }
  const flips = r.picks.filter((p, i) => i && cfgLabel(p.cfg) !== cfgLabel(r.picks[i - 1].cfg)).length;
  L.push('', `The selected configuration changed ${flips} times in ${r.picks.length - 1} year-ends. Frequent changes mean the choice is mostly noise; a stable choice means the improvement is a consistent feature.`, '');
  L.push('## By ETF (walk-forward trades)', '', '| ETF | Trades | Win rate | Avg trade |', '|---|---:|---:|---:|');
  for (const [s, t] of Object.entries(r.perEtf)) L.push(`| ${s} | ${t.n} | ${pct(t.winRate)} | ${pct(t.avg)} |`);
  L.push('', '## All configurations, full period (hindsight, for reference only)', '', '| # | Configuration | CAGR | Sharpe | Max drawdown | Win rate | Trades | Time invested |', '|---:|---|---:|---:|---:|---:|---:|---:|');
  r.full.slice(0, 12).forEach((x, i) => L.push(`| ${i + 1} | ${cfgLabel(x.cfg)} | ${pct(x.m.cagr)} | ${f2(x.m.sharpe)} | ${pct(x.m.maxDd)} | ${pct(x.t.winRate)} | ${x.t.n} | ${pct(x.exposure)} |`));
  const better = r.wf.sharpe > r.original.sharpe && r.wf.maxDd < r.original.maxDd;
  const reach = r.levTable.find(x => x.cagr >= r.goal);
  L.push('', `## What leverage would the walk-forward series need for ${pct(r.goal)} a year?`, '', 'Scales the walk-forward daily returns by a leverage multiple L, charging 6% a year on the borrowed part. Illustrative: it assumes returns scale linearly and that you are never forced out, which real margin does not guarantee.', '', '| Leverage | CAGR | Max drawdown | Sharpe |', '|---:|---:|---:|---:|');
  for (const x of r.levTable) L.push(`| ${x.L}× | ${pct(x.cagr)} | ${pct(x.maxDd)} | ${f2(x.sharpe)} |`);
  L.push('', reach ? `The first row at or above ${pct(r.goal)} is ${reach.L}× leverage, with a drawdown of ${pct(reach.maxDd)}.` : `No leverage level up to ${r.levTable.at(-1).L}× reaches ${pct(r.goal)} a year.`, '');
  L.push('## Doubling every 6 months?', '', 'Every rolling 126-trading-day window of the walk-forward series at each leverage. "Doubled" means the account at least doubled over the window (the goal: +100% every 6 months).', '', '| Leverage | Windows | Doubled | Lost 30%+ | Median | Best | Worst |', '|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of r.sixMonth) L.push(`| ${x.L}× | ${x.windows} | ${pct(x.doubled)} | ${pct(x.lost30)} | ${pct(x.median)} | ${pct(x.best)} | ${pct(x.worst)} |`);
  L.push('');
  L.push('', '## Verdict', `Walk-forward Sharpe ${f2(r.wf.sharpe)} and drawdown ${pct(r.wf.maxDd)}, against ${f2(r.original.sharpe)} and ${pct(r.original.maxDd)} for the original idea and ${f2(r.spy.sharpe)} and ${pct(r.spy.maxDd)} for holding SPY. ` +
    (better ? 'The improvements held up out of sample: higher risk-adjusted return and a shallower drawdown than the original.' : 'The improvements did not clearly beat the original idea out of sample, so the extra rules are not adding reliable value.'),
    '', '## Limits', '- Costs are assumptions; stops fill at the stop price less 1 cent (or the open if the day gaps through it), which is optimistic in fast markets.', '- Marks and exits use the 15:55 bar open; daily lows are used only to test stops.',
    `- ${r.nCfg} configurations; selection each year uses only earlier data, but the grid itself was designed after seeing the earlier results, so treat the whole as one more candidate, not proof.`, '- ETFs only; 2016 to 2018 is used only as the first selection window.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  let start = '2016-01-04', end = '2026-10-19', out = join(HERE, 'out-candle-portfolio'), data = join(HERE, 'data'), first = '2019', symbols = SYMBOLS, slotList = [3, 5], benchOnly = false, tf = '1Min';
  for (let i = 0; i < argv.length; i++) { const a = argv[i];
    if (a === '--start') start = argv[++i]; else if (a === '--end') end = argv[++i]; else if (a === '--out') out = resolve(argv[++i]); else if (a === '--data') data = resolve(argv[++i]);
    else if (a === '--first-test-year') first = argv[++i]; else if (a === '--slots') slotList = argv[++i].split(',').map(Number); else if (a === '--bench-only') benchOnly = argv[++i] === 'SPY'; else if (a === '--timeframe') tf = argv[++i]; else if (a === '--symbols') symbols = argv[++i].split(','); else throw new Error('unknown option ' + a); }
  const log = m => console.error(m), store = new Store(data);
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: 150, log});
  const recs = {};
  const loadList = benchOnly && !symbols.includes('SPY') ? ['SPY', ...symbols] : symbols;
  for (const s of loadList) recs[s] = buildRecords(await loadSymbol(alpaca, store, s, start, end, log, tf), {minBars: tf === '5Min' ? 60 : 300});
  const res = analyse(recs, {firstTestYear: first, slotList, benchOnly});
  mkdirSync(out, {recursive: true});
  const text = report(res);
  writeFileSync(join(out, 'summary.md'), text);
  writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 1));
  console.log(text);
  return res;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
