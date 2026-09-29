import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LeaderPlan, ACTIVE_LEADER_RISK_POLICY, minutesToClose} from '../src/leader-capacity.ts';
import {atMoment} from '../backtest/lib/replay.mjs';
import {DayMarket} from '../backtest/lib/market.mjs';
import {Alpaca} from '../backtest/lib/alpaca.mjs';
import {referenceFor, planScreens, packBars} from '../backtest/lib/dataset.mjs';
import {fitSpreadModel, spreadPct, features, PRIOR_SPREAD_MODEL} from '../backtest/lib/spread.mjs';
import {simulateLive, paperOpenLookup, repricePaper} from '../backtest/lib/reprice.mjs';
import {maxDrawdownPct, tradeStats} from '../backtest/lib/report.mjs';
import {syntheticDay, rng} from '../backtest/lib/synthetic.mjs';
import {etWall, cycleTimes} from '../backtest/lib/time.mjs';
import {VARIANTS, pickVariants} from '../backtest/variants.mjs';
import {main, markLookup} from '../backtest/run.mjs';
import {fakeAlpaca} from './backtest-fakes.mjs';

const DAY = '2026-09-18'; // a Friday
const et = hhmm => etWall(DAY, hhmm);
const account = () => ({account_id: 'H250', cash: 200, revision: 0, realized_pnl: 0, starting_equity: 250});
const quote = (bp, ap, now) => ({bp, ap, bs: 100, as: 100, t: new Date(now - 1000).toISOString()});
const snap = (bp, ap, now, v = 100000) => ({latestQuote: quote(bp, ap, now), minuteBar: {t: new Date(now - 60000).toISOString(), o: bp, h: ap, l: bp, c: bp, v}});
const held = (over = {}) => ({id: 1, kind: 'equity', account_id: 'H250', symbol: 'HELD', opened_at: new Date(et('10:00')).toISOString(), entry_price: 1, quantity: 10, remaining_qty: 10,
  entry_notional: 10, stop_price: 0.95, target_price: 3, highest_price: 1, lowest_price: 1, entry_score: 40, entry_day_change_pct: 5, opened_phase: 'regular',
  features: JSON.stringify({max_hold_minutes: 720}), status: 'open', version: 'leader-hunt-v8.6-exit-liquidity', locked_realized_pnl: 0, take200_done: 0, ...over});
const plan = (ms, positions, policy) => new LeaderPlan(account(), positions, [], [], [], new Date(ms), 'regular', new Map(), policy);
const policy = changes => Object.freeze({...ACTIVE_LEADER_RISK_POLICY, ...changes});
const candidate = (over = {}) => ({symbol: 'NEWX', price: 2, bid: 1.99, ask: 2.01, spreadPct: 1, dayChangePct: 25, score: 60, catalystScore: 22, catalystSummary: '',
  volumeAccel: 0.3, dayVolume: 3e6, previousDayVolume: 1e6, minuteVolume: 1e5, consecutiveHits: 3, executionFresh: true, executionAuthority: true, quoteAgeMs: 0,
  discoverySource: 'top_gainer', discoveryRank: 1, reasons: [], ...over});

// ---------------------------------------------------------------- trade-shape policy (production code)

test('default policy is v8.6: no trailing, take-profit or session-close exits', () => atMoment(et('15:55'), fetch, async () => {
  const now = Date.now(), p = plan(now, [held({highest_price: 1.3})]);
  p.manage({HELD: snap(1.2, 1.21, now)}, {});
  assert.equal(p.trades.length, 0, 'a winner is still held into the close under v8.6');
  assert.equal(minutesToClose(new Date(now)), 5);
  for (const k of ['max_entry_day_change_pct', 'entry_cutoff_minutes_before_close', 'flat_minutes_before_close', 'trail_activate_pct', 'trail_pct', 'take_profit_pct'])
    assert.equal(ACTIVE_LEADER_RISK_POLICY[k], null, k);
  assert.equal(ACTIVE_LEADER_RISK_POLICY.equity_max_hold_minutes, 720);
}));

test('flat-before-close sells every position in the final minutes only', async () => {
  const flat = policy({flat_minutes_before_close: 10});
  await atMoment(et('15:45'), fetch, async () => {
    const now = Date.now(), p = plan(now, [held()], flat);
    p.manage({HELD: snap(1.01, 1.02, now)}, {});
    assert.equal(p.trades.length, 0);
  });
  await atMoment(et('15:51'), fetch, async () => {
    const now = Date.now(), p = plan(now, [held()], flat);
    p.manage({HELD: snap(1.01, 1.02, now)}, {});
    assert.equal(p.trades.length, 1);
    assert.equal(p.trades[0].exit_reason, 'session_close');
  });
});

test('kill switch (flatten_now) sells a position at any time of day and is off by default', async () => {
  assert.equal(ACTIVE_LEADER_RISK_POLICY.flatten_now, false);
  await atMoment(et('11:00'), fetch, async () => {
    const now = Date.now();
    const quiet = plan(now, [held()], policy({}));
    quiet.manage({HELD: snap(1.01, 1.02, now)}, {});
    assert.equal(quiet.trades.length, 0);
    const kill = plan(now, [held()], policy({flatten_now: true}));
    kill.manage({HELD: snap(1.01, 1.02, now)}, {});
    assert.equal(kill.trades.length, 1);
    assert.equal(kill.trades[0].exit_reason, 'kill_switch');
  });
});

test('trailing stop activates only after the gain threshold', () => atMoment(et('11:00'), fetch, async () => {
  const now = Date.now(), trail = policy({trail_activate_pct: 0.06, trail_pct: 0.04});
  const p = plan(now, [held({id: 1, symbol: 'UPUP', highest_price: 1.10}), held({id: 2, symbol: 'FLAT', highest_price: 1.04})], trail);
  p.manage({UPUP: snap(1.05, 1.06, now), FLAT: snap(0.99, 1.0, now)}, {});
  assert.deepEqual(p.trades.map(t => [t.symbol, t.exit_reason]), [['UPUP', 'trail']]);
}));

test('take-profit sells the whole position at the target', () => atMoment(et('11:00'), fetch, async () => {
  const now = Date.now(), p = plan(now, [held()], policy({take_profit_pct: 0.15}));
  p.manage({HELD: snap(1.16, 1.17, now)}, {});
  assert.equal(p.trades[0]?.exit_reason, 'take_profit');
  assert.equal(p.positions[0].status, 'closed');
}));

test('chase cap, entry cutoff and stop distance come from the policy', async () => {
  await atMoment(et('11:00'), fetch, async () => {
    const now = Date.now(), p = plan(now, [], policy({max_entry_day_change_pct: 20}));
    p.enterEquities([candidate({dayChangePct: 25})], {NEWX: snap(1.99, 2.01, now)}, c => ({}));
    assert.deepEqual(p.decisions.at(-1).reasons, ['ENTRY_CHASE_LIMIT']);
    const q = plan(now, [], policy({equity_stop_loss_pct: 0.08}));
    q.enterEquities([candidate({dayChangePct: 25})], {NEWX: snap(1.99, 2.01, now)}, c => ({}));
    assert.equal(q.newPositions.length, 1);
    assert.ok(Math.abs(q.newPositions[0].stop_price - q.newPositions[0].entry_price * 0.92) < 1e-12);
    const base = plan(now, []);
    base.enterEquities([candidate({dayChangePct: 25})], {NEWX: snap(1.99, 2.01, now)}, c => ({}));
    assert.equal(base.newPositions[0].stop_price, base.newPositions[0].entry_price * 0.95, 'v8.6 stop unchanged');
  });
  await atMoment(et('15:40'), fetch, async () => {
    const now = Date.now(), p = plan(now, [], policy({entry_cutoff_minutes_before_close: 30}));
    p.enterEquities([candidate({dayChangePct: 5})], {NEWX: snap(1.99, 2.01, now)}, c => ({}));
    assert.deepEqual(p.decisions.at(-1).reasons, ['ENTRY_CUTOFF_BEFORE_CLOSE']);
  });
});

test('variants only change trade-shape settings', () => {
  assert.equal(VARIANTS[0].id, 'v86_baseline');
  assert.deepEqual(VARIANTS[0].policy, ACTIVE_LEADER_RISK_POLICY);
  for (const v of VARIANTS) for (const k of Object.keys(ACTIVE_LEADER_RISK_POLICY))
    if (!(k in v.changes)) assert.equal(v.policy[k], ACTIVE_LEADER_RISK_POLICY[k], `${v.id}.${k}`);
  assert.throws(() => pickVariants('nope'), /unknown variant/);
});

// ---------------------------------------------------------------- market emulation (no look-ahead)

function oneSymbolDay({spikeAt = 360}) {
  const cols = {t: [], o: [], h: [], l: [], c: [], v: [], n: []};
  for (let m = 300; m < 720; m++) { const px = m === spikeAt ? 9 : 2; cols.t.push(m); cols.o.push(px); cols.h.push(px); cols.l.push(px); cols.c.push(px); cols.v.push(1000); cols.n.push(10); }
  return {date: DAY, open: '09:30', t0: et('04:00'), prevDate: '2026-09-17', ref: {AAA: [2, 1e6]}, fine: {AAA: cols}, coarse: {}, news: [], stats: {synthetic: true},
    boards: {gainers: [{symbol: 'OLDGAIN', price: 1, change: 0.5, percent_change: 100}], losers: [], byVolume: [], byTrades: []}};
}

test('a bar is invisible until it has completed; premarket is 15 minutes delayed', () => {
  const m = new DayMarket(oneSymbolDay({spikeAt: 360})), spikeStart = et('04:00') + 360 * 60000; // 10:00
  assert.equal(m.snapshot('AAA', spikeStart + 59_000, 'iex').latestTrade.p, 2);
  assert.equal(m.snapshot('AAA', spikeStart + 60_000, 'iex').latestTrade.p, 9);
  assert.equal(m.snapshot('AAA', spikeStart + 60_000 + 15 * 60000 - 1000, 'delayed_sip').latestTrade.p, 2, 'delayed feed: not yet');
  assert.equal(m.snapshot('AAA', spikeStart + 60_000 + 15 * 60000, 'delayed_sip').minuteBar.c, 9, 'delayed feed: exactly 15 minutes later');
  assert.equal(m.snapshot('AAA', spikeStart + 60_000 + 16 * 60000, 'delayed_sip').latestTrade.p, 2);
  const q = m.snapshot('AAA', spikeStart + 30_000, 'iex').latestQuote;
  assert.ok(q.bp < 2 && q.ap > 2, 'quote brackets the last trade');
  assert.equal(Date.parse(q.t), spikeStart + 29_000, 'current quote is timestamped just before the moment asked');
});

test('movers show the previous session before the open and live changes after', () => {
  const m = new DayMarket(oneSymbolDay({spikeAt: 400}));
  assert.equal(m.movers(et('09:20')).gainers[0].symbol, 'OLDGAIN');
  const after = m.movers(et('10:41'));
  assert.equal(after.gainers[0].symbol, 'AAA');
  assert.equal(after.gainers[0].percent_change, 350);
  assert.equal(m.movers(et('10:39')).gainers.length, 0, 'unchanged price is not a gainer');
});

test('quotes go stale when a stock stops trading', () => {
  const day = oneSymbolDay({spikeAt: 0});
  for (const k of Object.keys(day.fine.AAA)) day.fine.AAA[k] = day.fine.AAA[k].slice(0, 60); // trades 09:00-09:59 only
  const m = new DayMarket(day);
  const fresh = m.snapshot('AAA', et('10:02'), 'iex').latestQuote, stale = m.snapshot('AAA', et('10:05'), 'iex').latestQuote;
  assert.ok(et('10:02') - Date.parse(fresh.t) < 90_000);
  assert.ok(et('10:05') - Date.parse(stale.t) > 90_000);
});

test('cycle schedule matches production cadence', () => {
  const times = cycleTimes({date: DAY, open: '09:30'});
  assert.equal(times.length, 3 + 78);
  assert.equal(times[0], et('09:00') + 5000);
  assert.equal(times[3], et('09:30') + 5000);
  assert.equal(times.at(-1), et('15:55') + 5000);
});

// ---------------------------------------------------------------- dataset

test('reference close is rescaled across a reverse split', () => {
  const sessions = [{date: '2026-09-16'}, {date: '2026-09-17'}, {date: '2026-09-18'}];
  // 1-for-10 reverse split effective 09-18: raw 0.30 -> 3.00; split-adjusted factor 10 before.
  const byDate = new Map([
    ['2026-09-17', new Map([['RVS', {o: .3, h: .31, l: .29, c: .30, v: 5e6, n: 1000, f: 10}]])],
    ['2026-09-18', new Map([['RVS', {o: 3.1, h: 3.3, l: 2.9, c: 3.2, v: 4e5, n: 900, f: 1}]])],
  ]);
  const ref = referenceFor(byDate, sessions, 2);
  assert.ok(Math.abs(ref.RVS[0] - 3.0) < 1e-9);
  assert.equal(ref.RVS[1], 500000);
});

// 15-minute bars (minutes after 04:00) for the screen scan.
const scanBars = rows => ({t: rows.map(r => r[0]), o: rows.map(r => r[1]), h: rows.map(r => r[1]), l: rows.map(r => r[1]), c: rows.map(r => r[1]), v: rows.map(r => r[2]), n: rows.map(r => Math.ceil(r[2] / 100))});
const noBoards = {gainers: [], losers: [], byVolume: [], byTrades: []};

test('a stock is showable only from when data up to then put it near a screen, its news, or yesterday\'s boards', () => {
  const today = new Map(), ref = {}, scan = {};
  const add = (s, rows, extra = {}) => { ref[s] = [1, 1e5]; today.set(s, {o: 1, h: 2, l: 0.5, c: 1, v: 1e6, n: 1e4, f: 1, ...extra}); scan[s] = scanBars(rows); };
  for (let i = 0; i < 200; i++) add('Q' + i, [[330, 1.2 + i / 1000, 1000]]);          // +20% from the open, all day (and busier than NEWSY)
  add('LATE', [[330, 1.01, 500], [540, 3.0, 5e6]]);                                      // flat until 13:00, then +200%
  add('NEWSY', [[330, 1.0, 100]]);
  add('OLD', [[330, 1.0, 100]]);
  add('HALTED', [[330, 5.0, 100]]);                                                      // +400% but not tradable
  const news = [{id: 'n1', t: et('11:07'), h: 'NEWSY wins contract', s: '', sy: ['NEWSY']}];
  const boards = {...noBoards, gainers: [{symbol: 'OLD', price: 1, change: 0.1, percent_change: 10}]};
  const plan = planScreens({today, ref, scan, t0: et('04:00'), boards, news, untradable: new Set(['HALTED'])});
  assert.equal(plan.showFrom.OLD, et('04:00'));
  assert.equal(plan.showFrom.NEWSY, et('11:07'));
  assert.equal(plan.showFrom.LATE, et('13:15'), 'LATE ranks only after its 13:00-13:15 bar completes');
  assert.equal(plan.showFrom.Q0, et('09:45'));
  assert.ok(!('HALTED' in plan.showFrom) || plan.showFrom.HALTED > et('09:45'), 'untradable stocks do not qualify as gainers');
  const w = plan.windows.find(x => x.slot === 36); // 13:00-13:15
  assert.equal(w.gain[0], 200, 'LATE is not yet showable during 13:00-13:15, so it bounds that window');
  // Data granularity is decided before the open: a $50 stock that crashes to
  // $28 later keeps 15-minute data, so its crash cannot change earlier screens.
  add('PRICY', [[330, 49, 9e6], [540, 28, 9e6]]); ref.PRICY = [50, 1e5];
  const again = planScreens({today, ref, scan, t0: et('04:00'), boards, news, untradable: new Set(['HALTED'])});
  assert.ok(again.coarse.includes('PRICY') && !again.fine.includes('PRICY'));
  assert.ok(again.fine.includes('LATE'));
});

test('a real day without a screen plan shows nothing on the screens', () => {
  const day = oneSymbolDay({spikeAt: 400});
  delete day.stats;
  assert.deepEqual(new DayMarket(day).movers(et('10:41')).gainers, []);
  assert.equal(new DayMarket(day).snapshot('AAA', et('10:41'), 'iex').latestTrade.p, 9, 'snapshots still work for held or news stocks');
});

test('a later runner is never shown early (the review scenario)', () => {
  // At 09:35 the real gainers are A +40%, Y +25%, X +20%. X runs to +200% at
  // 13:00; Y fades. Whether X is on the 09:35 screen must not depend on that.
  const cols = rows => ({t: rows.map(r => r[0]), o: rows.map(r => r[1]), h: rows.map(r => r[1]), l: rows.map(r => r[1]), c: rows.map(r => r[1]), v: rows.map(() => 1000), n: rows.map(() => 10)});
  const base = {date: DAY, open: '09:30', t0: et('04:00'), prevDate: '2026-09-17', ref: {A: [1, 1e6], X: [1, 1e6], Y: [1, 1e6]}, coarse: {}, news: [], boards: noBoards, windows: [],
    fine: {A: cols([[330, 1.4]]), Y: cols([[330, 1.25], [360, 1.0]]), X: cols([[330, 1.2], [540, 3.0]])}};
  const screenAt935 = showFrom => new DayMarket({...base, showFrom}).movers(et('09:35')).gainers.map(g => g.symbol);
  const early = et('09:30');
  assert.deepEqual(screenAt935({A: early, Y: early, X: early}), ['A', 'Y', 'X']);
  assert.deepEqual(screenAt935({A: early, Y: early, X: et('13:15')}), ['A', 'Y'], 'X only becomes showable once its run is visible');
  assert.deepEqual(screenAt935({A: early, X: early}), ['A', 'X'], 'a stock not yet showable is simply absent');
  const m = new DayMarket({...base, showFrom: {A: early}});
  assert.deepEqual(m.mostActives(et('09:35')).most_actives.map(x => x.symbol), ['A']);
});

test('screen coverage is counted against stocks not yet showable', () => {
  const day = oneSymbolDay({spikeAt: 400});
  day.showFrom = {AAA: et('04:00')};
  day.windows = [{slot: 26, gain: [500], loss: [], volume: [], trades: []}]; // 10:30-10:45: a hidden stock may be at +500%
  const m = new DayMarket(day);
  m.movers(et('10:41'), 1);
  assert.deepEqual(m.coverage.gainers, [1, 0]);
  day.windows = [{slot: 26, gain: [100], loss: [], volume: [], trades: []}];
  const n = new DayMarket(day);
  assert.deepEqual(n.movers(et('10:41'), 1).gainers.map(g => g.symbol), ['AAA']);
  assert.deepEqual(n.coverage.gainers, [1, 1], '+350% beats every hidden stock');
});

test('bars are packed relative to 04:00 and anything from 16:00 on is dropped', () => {
  const cols = packBars([{t: new Date(et('04:00') + 5 * 60000).toISOString(), o: 1, h: 1, l: 1, c: 1, v: 1, n: 1}, {t: new Date(et('16:00')).toISOString(), o: 1, h: 1, l: 1, c: 1, v: 1, n: 1}], et('04:00'));
  assert.deepEqual(cols.t, [5]);
});

// ---------------------------------------------------------------- Alpaca client

test('Alpaca client paginates, retries rate limits and falls back to the live trading host', async () => {
  const seen = [];
  let limited = false;
  const fetchImpl = async url => {
    const u = new URL(url); seen.push(u.hostname + u.pathname + (u.searchParams.get('page_token') ?? ''));
    if (u.hostname === 'paper-api.alpaca.markets') return new Response('{"message":"unauthorized"}', {status: 401});
    if (u.hostname === 'api.alpaca.markets') return Response.json([{date: DAY}]);
    if (!limited) { limited = true; return new Response('{}', {status: 429, headers: {'x-ratelimit-reset': '0'}}); }
    const token = u.searchParams.get('page_token');
    return Response.json(token ? {bars: {AAA: [{t: 2}], BBB: [{t: 1}]}, next_page_token: null} : {bars: {AAA: [{t: 1}]}, next_page_token: 'p2'});
  };
  const waits = [];
  const a = new Alpaca({key: 'k', secret: 's', rpm: 6000, fetchImpl, sleep: async ms => { waits.push(ms); }});
  const bars = await a.bars(['AAA', 'BBB'], {timeframe: '1Min', start: DAY, end: DAY});
  assert.deepEqual(bars, {AAA: [{t: 1}, {t: 2}], BBB: [{t: 1}]});
  assert.equal(a.retries, 1);
  assert.deepEqual(await a.calendar(DAY, DAY), [{date: DAY}]);
  assert.equal(a.tradingBase, 'https://api.alpaca.markets');
  assert.throws(() => new Alpaca({key: '', secret: ''}), /required/);
});

// ---------------------------------------------------------------- spread model

test('Alpaca client skips a symbol the data API calls invalid and keeps the rest', async () => {
  const seen = [];
  const fetchImpl = async url => {
    const u = new URL(url), list = (u.searchParams.get('symbols') ?? '').split(',');
    seen.push(list.length);
    if (list.includes('BAD1')) return new Response(JSON.stringify({message: 'invalid symbol: BAD1'}), {status: 400});
    return Response.json({bars: Object.fromEntries(list.map(s => [s, [{t: '2026-01-02T05:00:00Z', o: 1, h: 1, l: 1, c: 1, v: 1}]])), next_page_token: null});
  };
  const a = new Alpaca({key: 'k', secret: 's', rpm: 6000, fetchImpl, sleep: async () => {}});
  const out = await a.bars(['AAA', 'BAD1', 'CCC'], {timeframe: '1Day', start: '2026-01-01', end: '2026-01-05'});
  assert.deepEqual(Object.keys(out).sort(), ['AAA', 'CCC']);
  assert.deepEqual([...a.skipped], ['BAD1']);
});

test('spread model fit recovers known coefficients and respects the tick floor', () => {
  const rand = rng(11), truth = [0.8, -0.4, -0.25, -0.05, 0.3], samples = [];
  for (let i = 0; i < 400; i++) {
    const s = {price: 0.2 + rand() * 20, dollarVolume5: rand() * 5e5, trades5: rand() * 2000, range5Pct: rand() * 6};
    s.spread_pct = Math.exp(features(s).reduce((n, x, k) => n + x * truth[k], 0) + (rand() - 0.5) * 0.1);
    samples.push(s);
  }
  const m = fitSpreadModel(samples);
  truth.forEach((b, k) => assert.ok(Math.abs(m.coef[k] - b) < 0.05, `coef ${k}: ${m.coef[k]} vs ${b}`));
  assert.ok(m.r2 > 0.95);
  assert.equal(fitSpreadModel(samples.slice(0, 10)).version, PRIOR_SPREAD_MODEL.version);
  assert.ok(spreadPct(PRIOR_SPREAD_MODEL, {price: 0.2, dollarVolume5: 1e9, trades5: 1e6, range5Pct: 0}) >= 0.05, 'never tighter than one $0.0001 tick at $0.20');
});

// ---------------------------------------------------------------- live mirror model

test('live mirror model: whole shares, spread and chase gates, three orders a minute, orphans sold', async () => {
  const at = hhmm => new Date(et(hhmm) + 5000).toISOString();
  const quotes = {'CHEAP': [1.00, 1.01], 'WIDE': [1.00, 1.10], 'RAN': [1.10, 1.11], 'PRICY': [15, 15.02], 'A': [2, 2.01], 'B': [2, 2.01], 'C': [2, 2.01], 'D': [2, 2.01]};
  const book = {at: async (s, ms) => quotes[s] ? {bp: quotes[s][0], ap: quotes[s][1], t: new Date(ms - 1000).toISOString()} : null};
  const entry = (symbol, hhmm, paper_price = 1.01) => ({bucket: at(hhmm), decided_at: at(hhmm), symbol, action: 'ENTRY', paper_price, reason: 'paper_entry'});
  const mirror = [entry('CHEAP', '10:00'), entry('WIDE', '10:00'), entry('RAN', '10:00', 1.01), entry('PRICY', '10:00', 15.02),
    entry('A', '10:05', 2.01), entry('B', '10:05', 2.01), entry('C', '10:05', 2.01), entry('D', '10:05', 2.01),
    {bucket: at('11:00'), decided_at: at('11:00'), symbol: 'CHEAP', action: 'EXIT_ALL', fraction: 1, reason: 'stop'}];
  const r = await simulateLive(mirror, book, {sessions: [{date: DAY}], paperOpen: (s, ms) => ms < et('12:00'), markFor: () => 2});
  assert.equal(r.skipped.SPREAD_TOO_WIDE, 1);
  assert.equal(r.skipped.PRICE_MOVED_AWAY, 1);
  assert.equal(r.skipped.PRICE_ABOVE_ORDER_CAP, 1);
  const buys = r.log.filter(x => x.side === 'BUY');
  assert.deepEqual(buys.map(x => [x.symbol, x.qty]), [['CHEAP', 11], ['A', 5], ['B', 5], ['C', 5], ['D', 5]]);
  assert.equal(buys.find(x => x.symbol === 'D').at, new Date(et('10:07') + 5000).toISOString(), 'fourth request waits for the next minute');
  const sells = r.log.filter(x => x.side === 'SELL');
  assert.equal(sells[0].symbol, 'CHEAP'); assert.equal(sells[0].at, new Date(et('11:01') + 5000).toISOString());
  assert.deepEqual(sells.slice(1).map(x => x.symbol).sort(), ['A', 'B', 'C', 'D'], 'positions paper no longer holds are sold as orphans');
  assert.equal(r.open_positions, 0);
  assert.equal(r.round_trips.length, 5);
});

test('live model: daily loss is the change since the previous close; stale quotes and a second sell in one run are skipped', async () => {
  const DAY2 = '2026-09-21';
  const at = (date, hhmm) => new Date(etWall(date, hhmm) + 5000).toISOString();
  const quotes = {OLDX: [1.0, 1.01], Z: [1.0, 1.01], NEXT: [1.0, 1.01], STALE: [1.0, 1.01], P: [4, 4.01]};
  const book = {at: async (s, ms) => quotes[s] ? {bp: s === 'Z' && ms > etWall(DAY2, '10:30') ? 0.55 : quotes[s][0], ap: quotes[s][1], t: new Date(s === 'STALE' ? ms - 5 * 60000 : ms - 1000).toISOString()} : null};
  const entry = (symbol, date, hhmm, paper_price = 1.01) => ({bucket: at(date, hhmm), decided_at: at(date, hhmm), symbol, action: 'ENTRY', paper_price, reason: 'paper_entry'});
  const mirror = [entry('OLDX', DAY, '10:00'), entry('Z', DAY2, '10:00'), entry('NEXT', DAY2, '11:00'), entry('STALE', DAY2, '11:00'), entry('P', DAY2, '12:00', 4.01),
    {bucket: at(DAY2, '12:30'), decided_at: at(DAY2, '12:30'), symbol: 'P', action: 'EXIT_FRACTION', fraction: 0.5, reason: 'LADDER_25'},
    {bucket: at(DAY2, '12:30'), decided_at: at(DAY2, '12:30'), symbol: 'P', action: 'EXIT_FRACTION', fraction: 0.5, reason: 'LADDER_50'}];
  // OLDX (11 shares) falls to $0.05, costing $10.45; Z loses $4.95 on day 2.
  const run = dropAt => simulateLive(mirror, book, {sessions: [{date: DAY}, {date: DAY2}], paperOpen: () => true,
    markFor: (s, ms) => s === 'OLDX' ? (ms > dropAt ? 0.05 : 1.0) : s === 'Z' ? (ms > etWall(DAY2, '10:30') ? 0.55 : 1.0) : 1.0});
  const before = await run(etWall(DAY, '14:00'));   // fell before yesterday's close: not today's loss
  const bought = before.log.filter(x => x.side === 'BUY').map(x => x.symbol);
  assert.ok(bought.includes('NEXT'), 'yesterday\'s loss plus -$4.95 today stays under the $15 daily limit');
  assert.ok(!bought.includes('STALE')); assert.equal(before.skipped.LIVE_QUOTE_STALE, 1);
  assert.equal(before.log.filter(x => x.side === 'SELL' && x.symbol === 'P').length, 1); assert.equal(before.skipped.SELL_ALREADY_PENDING, 1);
  const gap = await run(etWall(DAY, '18:00'));      // gapped down overnight: counts today, as in production
  assert.ok(!gap.log.some(x => x.side === 'BUY' && x.symbol === 'NEXT'));
  assert.ok(gap.skipped.DAILY_LOSS_LIMIT >= 1);
});

test('paper re-pricing uses the real ask to buy and the real bid to sell', async () => {
  const run = {entries: [{id: 1, symbol: 'X', opened_at: new Date(et('10:00')).toISOString(), entry_price: 1.0, quantity: 10, entry_notional: 10}],
    events: [{position_id: 1, created_at: new Date(et('10:30')).toISOString(), quantity: 2.5, price: 1.3, event_type: 'LADDER_25'}],
    trades: [{symbol: 'X', opened_at: new Date(et('10:00')).toISOString(), closed_at: new Date(et('11:00')).toISOString(), exit_price: 1.2, exit_reason: 'time'}]};
  const book = {at: async (s, ms) => ({bp: ms < et('10:10') ? 0.99 : ms < et('10:40') ? 1.28 : 1.18, ap: ms < et('10:10') ? 1.01 : 1.3, t: new Date(ms).toISOString()})};
  const r = await repricePaper(run, book);
  assert.equal(r.priced, 1);
  assert.ok(Math.abs(r.pnl_nbbo - (2.5 * 1.28 + 7.5 * 1.18 - 10 * 1.01)) < 1e-9);
  assert.ok(Math.abs(r.pnl_model - (2.5 * 1.3 + 7.5 * 1.2 - 10)) < 1e-9);
  const open = paperOpenLookup(run);
  assert.equal(open('X', et('10:30')), true); assert.equal(open('X', et('11:00')), false);
  assert.equal(markLookup({marks: {X: [[1, 5], [3, 7]]}})('X', 2), 5);
});

test('report metrics', () => {
  assert.equal(maxDrawdownPct([[0, 250], [1, 300], [2, 240], [3, 310]]), 20);
  const s = tradeStats([{return_pct: 10, realized_pnl: 1, minutes_held: 30}, {return_pct: -5, realized_pnl: -0.5, minutes_held: 90}]);
  assert.equal(s.win_rate_pct, 50); assert.equal(s.avg_return_pct, 2.5); assert.equal(s.pnl, 0.5); assert.equal(s.median_minutes_held, 60);
});

// ---------------------------------------------------------------- end to end

test('end to end: download, calibrate, replay two rule sets, price at quotes, report', async t => {
  const fake = fakeAlpaca({days: 5, symbols: 20});
  const dir = mkdtempSync(join(tmpdir(), 'meds-bt-'));
  const saved = [process.env.ALPACA_API_KEY, process.env.ALPACA_API_SECRET];
  process.env.ALPACA_API_KEY = 'fake-key'; process.env.ALPACA_API_SECRET = 'fake-secret';
  const logs = [], origLog = console.log;
  console.log = (...m) => logs.push(m.join(' '));
  try {
    const {meta, results} = await main(['--days', '3', '--end', fake.dates.at(-1), '--data', join(dir, 'data'), '--out', join(dir, 'out'), '--workers', '1', '--rpm', '1000000',
      '--calibration-samples', '20', '--variants', 'v86_baseline,flat_close'], {fetchImpl: fake.handler, sleep: async () => {}});
    assert.equal(meta.days, 3); assert.equal(meta.failures.length, 0); assert.equal(meta.synthetic, false);
    assert.ok(meta.alpaca_retries >= 1, 'the fake rate-limits once');
    assert.ok(meta.quotes_fetched > 0);
    assert.deepEqual(results.map(r => r.id), ['v86_baseline', 'flat_close']);
    for (const r of results) { assert.equal(r.failed_cycles, 0, JSON.stringify(r.errors)); assert.ok(r.entries > 0, r.id + ' traded'); assert.ok(r.live_mirror.orders > 0); }
    const flat = results[1];
    assert.equal(flat.open_at_end, 0, 'flat rule set ends every day with no positions');
    assert.equal(flat.overnight.n, 0);
    assert.ok(results[0].overnight.n + results[0].open_at_end > 0, 'v8.6 carries positions overnight');
    const summary = readFileSync(join(dir, 'out', 'summary.md'), 'utf8');
    assert.match(summary, /\| \*\*v86_baseline\*\* \|/);
    assert.match(readFileSync(join(dir, 'out', 'trades-flat_close.csv'), 'utf8'), /^symbol,opened_at/);
    assert.ok(!summary.includes('fake-key') && !logs.join('\n').includes('fake-secret'), 'no secrets in outputs');
    t.diagnostic(JSON.stringify(results.map(r => ({id: r.id, trades: r.closed.n, paper: r.final_equity, nbbo: r.paper_at_real_quotes.pnl_nbbo, live: r.live_mirror.total_pnl}))));
  } finally {
    console.log = origLog;
    [process.env.ALPACA_API_KEY, process.env.ALPACA_API_SECRET] = saved;
    if (saved[0] === undefined) delete process.env.ALPACA_API_KEY;
    if (saved[1] === undefined) delete process.env.ALPACA_API_SECRET;
    rmSync(dir, {recursive: true, force: true});
  }
});

test('synthetic smoke run needs no network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meds-bt-'));
  const origLog = console.log; console.log = () => {};
  try {
    const {meta, results} = await main(['--synthetic', '1', '--workers', '1', '--variants', 'v86_baseline', '--out', dir]);
    assert.equal(meta.synthetic, true); assert.equal(results.length, 1);
    assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /SYNTHETIC TEST DATA/);
  } finally { console.log = origLog; rmSync(dir, {recursive: true, force: true}); }
});
