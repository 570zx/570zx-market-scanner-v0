#!/usr/bin/env node
// Does the weak-close edge found on ETFs also work on individual stocks? Paper research only: no orders.
// The rules were FROZEN from the ETF work, so this is a replication test on a new universe, not another round of tuning.
//   1) Signal quality: low-IBS trades versus the same trade taken on every stock that day, with statistics clustered by date
//      (stocks move together, so counting every trade as independent would overstate confidence).
//   2) Portfolio: the three frozen ETF candidates run on the stock universe with 5, 10 and 20 slots, versus SPY and the
//      equal-weight universe. Daily candles use 5-minute bars (the last bar before 15:55 closes at 15:55).
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Store} from './lib/store.mjs';
import {Alpaca} from './lib/alpaca.mjs';
import {loadSymbol} from './fcr.mjs';
import {buildRecords, trades as sigTrades} from './lib/candles.mjs';
import {align, simulate, metricsFromReturns, tradeStats, monthly, yearOf} from './lib/portfolio.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// Large US companies as of early 2016 (including names that later stumbled). Companies that were later delisted or
// acquired may have no data and are skipped, which leaves some survivorship bias; the report counts what loaded.
export const UNIVERSE = ('AAPL MSFT AMZN GOOGL META JNJ XOM JPM WFC PG GE T VZ CVX KO PFE PEP CSCO ORCL INTC MRK WMT DIS HD MCD CMCSA V MA BAC C UNH AMGN IBM MMM BA CAT GS HON MDT MO UNP UPS USB LLY ABBV GILD BMY QCOM TXN COST NKE SBUX LOW TGT CVS WBA F GM EMR LMT FDX DHR TMO ABT BIIB AMAT ADBE NVDA AXP SLB COP OXY KMI SPG AIG MET PRU BK MS SCHW BLK CL KHC MDLZ KMB GIS EBAY NFLX TSLA CRM INTU ACN AVGO DE NEE DUK SO D EXC PNC COF TJX ADP FCX NEM HPQ MAT XRX JCI MU STX WDC DAL UAL AAL MAR HAL APA DVN EOG MPC PSX VLO CHRW KSS M JWN GPS').split(' ');
const FROZEN = [
  {id: 'A', label: 'IBS ≤ 0.1, hold 5 days, only above 200-day average', cfg: {thr: 0.1, exit: 'hold5', trend: 'sma200up'}},
  {id: 'B', label: 'IBS ≤ 0.1, sell on strength (max 5 days), no trend filter', cfg: {thr: 0.1, exit: 'strength5', trend: 'none'}},
  {id: 'C', label: 'IBS ≤ 0.2, hold 3 days (original idea)', cfg: {thr: 0.2, exit: 'hold3', trend: 'none'}},
];
const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%', bp = x => x == null ? '—' : (10000 * x).toFixed(1), f2 = x => x == null ? '—' : x.toFixed(2);

// Date-clustered statistics for one low-IBS configuration. Excess = signal trades minus the same trade on every stock that day.
export function clustered(recsBySym, c, cost = 0.02, from = '0000', to = '9999') {
  const cfg = {sig: `ibs<=${c.thr}`, fam: 'daily', dir: 1, trend: c.trend, hold: c.hold};
  const base = new Map();
  for (const recs of Object.values(recsBySym)) for (const r of recs) {
    if (!r.ok || r.date < from || r.date >= to) continue;
    const f = r.fwd?.[c.hold]; if (!f) continue;
    const v = f.ret - cost / f.px, b = base.get(r.date) ?? [0, 0]; b[0] += v; b[1]++; base.set(r.date, b);
  }
  const cond = new Map(), all = [];
  for (const recs of Object.values(recsBySym)) for (const t of sigTrades(recs, cfg, cost, from, to)) { (cond.get(t.date) ?? cond.set(t.date, []).get(t.date)).push(t.r); all.push(t); }
  const ex = [], mc = [];
  for (const [d, rs] of cond) { const m = rs.reduce((a, b) => a + b, 0) / rs.length, b = base.get(d); if (!b) continue; mc.push(m); ex.push(m - b[0] / b[1]); }
  const D = ex.length, mean = D ? ex.reduce((a, b) => a + b, 0) / D : 0, sd = D > 1 ? Math.sqrt(ex.reduce((a, b) => a + (b - mean) ** 2, 0) / (D - 1)) : 0;
  return {dates: D, trades: all.length, winRate: all.length ? all.filter(t => t.r > 0).length / all.length : null,
    meanNet: all.length ? all.reduce((a, t) => a + t.r, 0) / all.length : null, excess: mean, excessT: sd ? mean / (sd / Math.sqrt(D)) : 0};
}

function benchmarks(al, symsUniverse) {
  const spy = new Array(al.dates.length).fill(0), ew = new Array(al.dates.length).fill(0);
  const lastS = {}; let lastSpy = null;
  al.dates.forEach((d, t) => {
    const s = al.by.SPY?.[t]; if (s) { if (lastSpy) spy[t] = s.e955 / lastSpy - 1; lastSpy = s.e955; }
    let n = 0, sum = 0;
    for (const sym of symsUniverse) { const r = al.by[sym][t]; if (!r) continue; if (lastS[sym]) { sum += r.e955 / lastS[sym] - 1; n++; } lastS[sym] = r.e955; }
    ew[t] = n ? sum / n : 0;
  });
  return {spy, ew};
}

export function analyse(recsBySym, {cost = 0.01} = {}) {
  const spyRecs = recsBySym.SPY, stocks = Object.fromEntries(Object.entries(recsBySym).filter(([s]) => s !== 'SPY'));
  const syms = Object.keys(stocks);
  const rows = [];
  for (const thr of [0.1, 0.2]) for (const trend of ['none', 'sma200up']) for (const hold of ['day1', 'day3', 'day5']) {
    const c = {thr, trend, hold};
    rows.push({c, all: clustered(stocks, c, cost * 2), early: clustered(stocks, c, cost * 2, '0000', '2023-01-01'), late: clustered(stocks, c, cost * 2, '2023-01-01')});
  }
  const primary = {thr: 0.1, trend: 'sma200up', hold: 'day5'};
  const yearly = {};
  for (let y = 2016; y <= 2026; y++) yearly[y] = clustered(stocks, primary, cost * 2, `${y}-01-01`, `${y + 1}-01-01`);
  const al = align({SPY: spyRecs, ...stocks});
  const bm = benchmarks(al, syms);
  const wrap = (rets, trades) => ({...metricsFromReturns(rets), ...monthly(al.dates, rets), trades: trades ? tradeStats(trades) : null});
  const sims = [];
  for (const f of FROZEN) for (const slots of [5, 10, 20]) for (const [costName, k] of [['cheap', 1], ['hard', 2]]) {
    const cfg = {...f.cfg, slots}, sim = simulate({...al, syms}, cfg, {cost: cost * k, stopSlip: cost * k});
    const byYear = {}; al.dates.forEach((d, i) => { const y = yearOf(d); byYear[y] = (byYear[y] ?? 1) * (1 + sim.daily[i]); });
    sims.push({id: f.id, label: f.label, slots, costName, m: wrap(sim.daily, sim.trades), exposure: sim.invested.reduce((a, b) => a + b, 0) / sim.invested.length, byYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, v - 1]))});
  }
  const byYearOf = rets => { const by = {}; al.dates.forEach((d, i) => { const y = yearOf(d); by[y] = (by[y] ?? 1) * (1 + rets[i]); }); return Object.fromEntries(Object.entries(by).map(([y, v]) => [y, v - 1])); };
  const spyM = wrap(bm.spy), ewM = wrap(bm.ew);
  const gate = r => r.all.excessT >= 2 && r.all.meanNet > 0 && r.all.winRate >= 0.5;
  const sigRep = ['0.1|sma200up|day5', '0.2|none|day3'].map(k => rows.find(r => `${r.c.thr}|${r.c.trend}|${r.c.hold}` === k)).filter(Boolean);
  const picks = sims.filter(s => s.slots === 10 && s.costName === 'hard');
  const portOk = picks.filter(s => s.m.sharpe > spyM.sharpe && s.m.sharpe > ewM.sharpe).map(s => s.id);
  return {nStocks: syms.length, syms, dates: [al.dates[0], al.dates.at(-1)], rows, yearly, sims, spy: spyM, ew: ewM, yearsSpy: byYearOf(bm.spy), yearsEw: byYearOf(bm.ew),
    signalReplicates: sigRep.length > 0 && sigRep.every(gate), signalAny: sigRep.some(gate), portOk, primary};
}

export function report(r) {
  const L = ['# Weak-close edge on individual stocks', ''];
  L.push(`Paper research only. ${r.nStocks} large US stocks loaded (${r.dates[0]} to ${r.dates[1]}). The universe is today's survivors of an early-2016 large-cap list, so names that were later acquired or delisted are missing; that flatters any dip-buying result, which is why the signal is compared with the same trade on every stock that day. ` +
    `Rules are frozen from the ETF work. Costs: 2 cents per share each way unless stated.`, '');
  L.push('## Signal quality: low-IBS trades versus the same trade on every stock that day', '', '"Excess" is per trade after costs, averaged by day (so correlated stocks count once per day). t is across days.', '',
    '| IBS | Trend filter | Hold | Trades | Win rate | Avg trade (bp) | Excess (bp) | Excess t | Excess t 2016–22 | Excess t 2023+ |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of r.rows) L.push(`| ≤ ${x.c.thr} | ${x.c.trend} | ${x.c.hold} | ${x.all.trades} | ${pct(x.all.winRate)} | ${bp(x.all.meanNet)} | ${bp(x.all.excess)} | ${f2(x.all.excessT)} | ${f2(x.early.excessT)} | ${f2(x.late.excessT)} |`);
  L.push('', `### By year (IBS ≤ ${r.primary.thr}, ${r.primary.trend}, ${r.primary.hold})`, '', '| Year | Trades | Win rate | Avg trade (bp) | Excess (bp) |', '|---|---:|---:|---:|---:|');
  for (const [y, x] of Object.entries(r.yearly)) if (x.trades) L.push(`| ${y} | ${x.trades} | ${pct(x.winRate)} | ${bp(x.meanNet)} | ${bp(x.excess)} |`);
  L.push('', '## Portfolio on the stock universe', '', '| Candidate | Slots | Costs | CAGR | Sharpe | Max drawdown | Win rate | Trades | Longest losing streak | Positive months | Time invested |', '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of r.sims) L.push(`| ${s.id}: ${s.label} | ${s.slots} | ${s.costName === 'hard' ? '2c' : '1c'}/side | ${pct(s.m.cagr)} | ${f2(s.m.sharpe)} | ${pct(s.m.maxDd)} | ${pct(s.m.trades.winRate)} | ${s.m.trades.n} | ${s.m.trades.losingStreak} | ${pct(s.m.positive)} | ${pct(s.exposure)} |`);
  L.push(`| Hold SPY | — | — | ${pct(r.spy.cagr)} | ${f2(r.spy.sharpe)} | ${pct(r.spy.maxDd)} | — | — | — | ${pct(r.spy.positive)} | 100% |`, `| Equal-weight hold of these stocks | — | — | ${pct(r.ew.cagr)} | ${f2(r.ew.sharpe)} | ${pct(r.ew.maxDd)} | — | — | — | ${pct(r.ew.positive)} | 100% |`);
  const years = Object.keys(r.yearsSpy);
  const pick = r.sims.find(s => s.id === 'A' && s.slots === 10 && s.costName === 'hard');
  L.push('', '### Calendar years (candidate A, 10 slots, 2c/side)', '', '| Year | Candidate A | Hold SPY | Equal-weight stocks |', '|---|---:|---:|---:|');
  for (const y of years) L.push(`| ${y} | ${pct(pick.byYear[y])} | ${pct(r.yearsSpy[y])} | ${pct(r.yearsEw[y])} |`);
  L.push('', '## Verdict',
    r.signalReplicates ? 'The signal replicates on stocks: both frozen signals beat the same trade on every stock after costs, with a win rate of 50% or more and a day-clustered excess t of 2 or more.'
      : r.signalAny ? 'The signal partly replicates: one of the two frozen signals clears the bar (excess t of 2 or more, positive after costs, win rate 50%+) and the other does not.'
      : 'The signal does not replicate on stocks: neither frozen signal clears excess t of 2 with a positive average after costs and a 50%+ win rate.',
    r.portOk.length ? ` As portfolios (10 slots, 2c/side), candidate(s) ${r.portOk.join(', ')} had a higher Sharpe than both SPY and the equal-weight stock universe.` : ' As portfolios (10 slots, 2c/side), no frozen candidate had a higher Sharpe than both SPY and the equal-weight stock universe.',
    '', '## Limits', '- Survivorship bias remains: companies that were delisted or acquired after 2016 are mostly absent, and stocks that crashed and disappeared are exactly where dip-buying loses.',
    '- Daily candles come from 5-minute bars; entries and exits use the open of the 15:55 bar. Costs are flat per-share assumptions; real stock spreads vary and are wider for smaller or busier-news names.',
    '- Stops and earnings gaps matter more for single stocks than for ETFs; candidate B and C have no stop, A has none either.', '- No tuning was done on stocks.');
  return L.join('\n') + '\n';
}

export async function main(argv, {alpacaImpl} = {}) {
  let start = '2016-01-04', end = '2026-10-19', out = join(HERE, 'out-candle-stocks'), data = join(HERE, 'data'), symbols = UNIVERSE, minSessions = 500;
  for (let i = 0; i < argv.length; i++) { const a = argv[i];
    if (a === '--start') start = argv[++i]; else if (a === '--end') end = argv[++i]; else if (a === '--out') out = resolve(argv[++i]); else if (a === '--data') data = resolve(argv[++i]);
    else if (a === '--symbols') symbols = argv[++i].split(','); else if (a === '--min-sessions') minSessions = Number(argv[++i]); else throw new Error('unknown option ' + a); }
  const log = m => console.error(m), store = new Store(data);
  const alpaca = alpacaImpl ?? new Alpaca({key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET, rpm: 150, log});
  const recs = {}; let missing = 0;
  for (const s of ['SPY', ...symbols]) {
    const name = `fcr-recs5-${s}-${start}-${end}.json.gz`;
    let r = store.has(name) ? store.read(name) : null;
    if (!r) {
      const days = await loadSymbol(alpaca, store, s, start, end, log, '5Min');
      r = buildRecords(days, {minBars: 60}).map(x => ({...x}));
      if (r.filter(x => x.ok).length < minSessions) { missing++; log(`skipping ${s}: only ${r.filter(x => x.ok).length} usable sessions`); continue; }
      store.write(name, r);
    }
    if (r.filter(x => x.ok).length >= minSessions) recs[s] = r; else missing++;
  }
  if (!recs.SPY) throw new Error('SPY data missing');
  log(`${Object.keys(recs).length - 1} stocks loaded, ${missing} skipped`);
  const res = analyse(recs);
  mkdirSync(out, {recursive: true});
  const text = report(res);
  writeFileSync(join(out, 'summary.md'), text);
  writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 1));
  console.log(text);
  return res;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
