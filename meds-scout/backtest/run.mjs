#!/usr/bin/env node
// MEDS backtest: download history, replay rule sets through the production
// Leader code, re-price at real quotes, write a report.
//
//   ALPACA_API_KEY=… ALPACA_API_SECRET=… node backtest/run.mjs --days 40
//   node backtest/run.mjs --synthetic 3          (offline smoke test, fake data)
//
// Options: --days N (default 40)  --end YYYY-MM-DD (default: yesterday)
//          --variants all|id,id   --workers N (default 2)   --rpm N (default 150)
//          --calibration-samples N (default 300)  --no-costs  --data DIR  --out DIR
import {Worker} from 'node:worker_threads';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {Alpaca} from './lib/alpaca.mjs';
import {Store} from './lib/store.mjs';
import {buildDataset, ensureSymbols, DATASET_VERSION, SCAN} from './lib/dataset.mjs';
import {calibrateSpreads} from './lib/calibrate.mjs';
import {PRIOR_SPREAD_MODEL} from './lib/spread.mjs';
import {replayVariant} from './lib/replay.mjs';
import {QuoteBook, repricePaper, simulateLive, paperOpenLookup, LIVE_DEFAULTS, LIVE_LATENCY_MS} from './lib/reprice.mjs';
import {summarizeVariant, renderSummary, tradesCsv} from './lib/report.mjs';
import {syntheticDays} from './lib/synthetic.mjs';
import {RealDate, realNow} from './lib/time.mjs';
import {pickVariants} from './variants.mjs';
import {CAPACITY_ENGINE, CAPACITY_VERSION} from '../src/leader-capacity.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

export function parseArgs(argv) {
  const a = {days: 40, variants: 'all', workers: 2, rpm: 150, calibrationSamples: 300, costs: true, data: join(HERE, 'data'), out: join(HERE, 'out')};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === '--days') a.days = Number(v()); else if (k === '--end') a.end = v(); else if (k === '--variants') a.variants = v();
    else if (k === '--workers') a.workers = Number(v()); else if (k === '--rpm') a.rpm = Number(v());
    else if (k === '--calibration-samples') a.calibrationSamples = Number(v()); else if (k === '--no-costs') a.costs = false;
    else if (k === '--synthetic') a.synthetic = Number(v()); else if (k === '--data') a.data = resolve(v()); else if (k === '--out') a.out = resolve(v());
    else throw new Error('unknown option ' + k);
  }
  if (!(a.days >= 1 && a.days <= 500)) throw new Error('--days must be 1..500');
  if (a.end && !/^\d{4}-\d\d-\d\d$/.test(a.end)) throw new Error('--end must be YYYY-MM-DD');
  return a;
}

const stamp = () => new RealDate(realNow()).toISOString().slice(11, 19);
const log = (...m) => console.log(stamp(), ...m);

// Replays each rule set, in worker threads when more than one is allowed.
async function replayAll(variants, {workers, dates, dataDir, synthetic, spreadModel, rpm, asof, loadDay, ensureHeld}) {
  const results = {};
  if (workers <= 1) {
    for (const v of variants) results[v.id] = await replayVariant({variant: v, dates, loadDay, ensureHeld, spreadModel, log});
    return results;
  }
  const queue = [...variants];
  const runOne = v => new Promise(done => {
    const w = new Worker(new URL('./lib/worker.mjs', import.meta.url), {workerData: {variantId: v.id, dates, dataDir, synthetic, spreadModel, rpm: Math.max(10, Math.floor(rpm / workers)), asof}});
    w.on('message', m => { if (m.log) log(m.log); if (m.done) results[v.id] = m.done; if (m.error) { results[v.id] = {error: m.error}; log(`${v.id} FAILED: ${m.error}`); } });
    w.on('error', e => { results[v.id] = {error: String(e?.stack ?? e)}; log(`${v.id} worker error: ${e}`); });
    w.on('exit', () => done());
  });
  await Promise.all(Array.from({length: Math.min(workers, queue.length)}, async () => { while (queue.length) await runOne(queue.shift()); }));
  return results;
}

// Last recorded price for `symbol` at or before `at` from the replay's marks.
export function markLookup(run) {
  return (symbol, at = Infinity) => {
    const xs = run.marks?.[symbol];
    if (!xs?.length) return null;
    let lo = 0, hi = xs.length - 1, ans = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid][0] <= at) { ans = xs[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
}

export async function main(argv = process.argv.slice(2), {fetchImpl, sleep} = {}) {
  const args = parseArgs(argv);
  const started = realNow();
  mkdirSync(args.out, {recursive: true});
  const variants = pickVariants(args.variants);
  let alpaca = null, store = null, dates, loadDay, ensureHeld, asof = {}, manifest = null, synthetic = null;
  if (args.synthetic) {
    synthetic = {first: '2026-09-14', days: args.synthetic, options: {symbols: 60}};
    const days = new Map(syntheticDays(synthetic.first, synthetic.days, synthetic.options).map(d => [d.date, d]));
    dates = [...days.keys()]; loadDay = date => ({day: days.get(date), extra: null});
    log(`SYNTHETIC data (${dates.length} days) — plumbing check only, not market results`);
  } else {
    const key = process.env.ALPACA_API_KEY, secret = process.env.ALPACA_API_SECRET;
    if (!key || !secret) throw new Error('Set ALPACA_API_KEY and ALPACA_API_SECRET (GitHub: repository secrets).');
    alpaca = new Alpaca({key, secret, rpm: args.rpm, log, ...(fetchImpl ? {fetchImpl} : {}), ...(sleep ? {sleep} : {})});
    store = new Store(args.data);
    const built = await buildDataset({alpaca, store, days: args.days, end: args.end, log});
    manifest = built.manifest; asof = built.daily.asof; dates = manifest.test_days;
    loadDay = date => ({day: store.read(`days/${date}.json.gz`), extra: store.read(`days/${date}.extra.json.gz`, null)});
    ensureHeld = (date, symbols) => ensureSymbols(alpaca, store, {asof}, date, symbols);
    log(`dataset ready: ${dates.length} days, ${alpaca.requests} requests so far`);
  }
  const book = new QuoteBook({alpaca, store, asofFor: s => asof[s], log});
  let spreadModel = PRIOR_SPREAD_MODEL, calibration = null;
  if (!synthetic) {
    const name = `calibration-${DATASET_VERSION}-${dates[0]}-${dates.at(-1)}-${args.calibrationSamples}.json`;
    calibration = store.has(name) ? store.read(name) : await calibrateSpreads({dates, loadDay, book, samples: args.calibrationSamples, log});
    store.write(name, calibration);
    spreadModel = calibration.summary.model;
  }
  log(`replaying ${variants.length} rule sets over ${dates.length} days`);
  const runs = await replayAll(variants, {workers: args.workers, dates, dataDir: args.data, synthetic, spreadModel, rpm: args.rpm, asof, loadDay, ensureHeld});
  const results = [], failures = [];
  for (const v of variants) {
    const run = runs[v.id];
    if (!run || run.error) { failures.push({id: v.id, error: run?.error ?? 'no result'}); continue; }
    let costs = {};
    if (args.costs && !synthetic) {
      const mark = markLookup(run);
      log(`${v.id}: pricing ${run.entries.length} entries at real quotes`);
      costs = {paper: await repricePaper(run, book, {markFor: s => mark(s)}),
        live: await simulateLive(run.mirror, book, {sessions: dates.map(date => ({date})), markFor: mark, paperOpen: paperOpenLookup(run)})};
      book.save();
    }
    results.push(summarizeVariant(v, run, costs));
    writeFileSync(join(args.out, `trades-${v.id}.csv`), tradesCsv(run, costs.paper));
    writeFileSync(join(args.out, `days-${v.id}.json`), JSON.stringify(run.days));
    if (costs.live) writeFileSync(join(args.out, `live-orders-${v.id}.json`), JSON.stringify(costs.live.log));
  }
  const meta = {
    engine: `${CAPACITY_ENGINE} / ${CAPACITY_VERSION}`, synthetic: !!synthetic, first_day: dates[0], last_day: dates.at(-1), days: dates.length,
    minutes: Math.round((realNow() - started) / 60000), alpaca_requests: alpaca?.requests ?? 0, alpaca_retries: alpaca?.retries ?? 0,
    quotes_fetched: book.fetched, spread_model: spreadModel, calibration: calibration?.summary ?? null, failures,
    notes: [
      `Discovery, scoring, shortlist, sizing, risk governor, entries, exits and accounting are MEDS's own production code (runLeaderCycle); only the trade-shape settings differ between rule sets.`,
      `Each cycle sees only one-minute bars that had completed by that moment (premarket: 15 minutes delayed, as production). Cycles every 5 minutes 09:30–16:00 ET plus 09:00–09:20 premarket research.`,
      `Screens (top gainers/losers, most active by volume and by trades) are rebuilt every cycle from one-minute bars. A stock can appear on them only from the moment data up to then put it near the top of a screen (the whole market is scanned every ${SCAN.stepMin} minutes from 08:00: top ${SCAN.gainers} gainers, ${SCAN.losers} losers, ${SCAN.actives} most active by volume and by trades), from its first news story, or all day if it was on the previous session's boards (shown before the open, as Alpaca does). So nothing a stock did later can make it appear earlier; a fresh runner can appear up to ${SCAN.stepMin} minutes later than live. Untradable symbols are left off the movers screen, as Alpaca does. Delisted stocks are included where Alpaca still serves their history.`,
      `Quotes at decision time are modeled from the bars with a spread model ${calibration ? `fitted to ${calibration.summary.quotes_found} real NBBO quotes (median ${calibration.summary.median_spread_pct?.toFixed(2)}%)` : '(prior, uncalibrated)'}. Every trade is then re-priced at the real NBBO ${LIVE_LATENCY_MS / 1000}s after the decision.`,
      `Production decides from Alpaca's free IEX feed; the backtest uses the consolidated tape. IEX shows a small share of each stock's volume and wider quotes, so live MEDS sizes paper entries smaller, hits its per-minute exit limit (5% of minute volume) more often and rejects more names for spread. Expect live paper decisions to be a subset of these.`,
      `Not modeled: overnight (20:00–04:00) position management, options (disabled in production), halts, borrow, fills beyond the displayed quote, and settlement of sale proceeds. Tradable status and news text are as Alpaca reports them today. Live mirror limits: ${JSON.stringify(LIVE_DEFAULTS)}.`,
      `The spread model is fitted on quotes from the same days it is used on; it only decides which trades are attempted, and every trade is then priced at real quotes.`,
      `Past results do not guarantee future results. Treat differences between rule sets as the signal, not the absolute dollar numbers.`,
    ],
  };
  writeFileSync(join(args.out, 'results.json'), JSON.stringify({meta, manifest, results}, null, 1));
  writeFileSync(join(args.out, 'summary.md'), renderSummary({meta, results}));
  log(`done in ${meta.minutes} min: ${join(args.out, 'summary.md')}`);
  if (failures.length) { log(`${failures.length} rule set(s) failed`); process.exitCode = 1; }
  return {meta, results};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error?.stack ?? error); process.exit(1); });
}
