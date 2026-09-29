// Replays MEDS's production Leader cycle over historical days. Each cycle runs
// the real runLeaderCycle() (discovery, scoring, shortlist, risk governor,
// entries, exits, accounting and the live outbox) against an in-memory copy of
// the MEDS database, with the clock set to that moment and Alpaca's data API
// answered from history by DayMarket. Only the trade rules (policy) differ
// between variants.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ensurePaperSchema, LEADER_DEPENDENCIES} from '../../src/index.ts';
import {ensureCapacitySchema, ACTIVE_ACCOUNT} from '../../src/leader-capacity.ts';
import {runLeaderCycle} from '../../src/leader-runtime.ts';
import {RealDate, cycleTimes, etWall} from './time.mjs';
import {DayMarket} from './market.mjs';

const iso = ms => new RealDate(ms).toISOString();

// Cloudflare D1's API over node:sqlite (one connection, batches atomic).
export class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.statements = 0; }
  prepare(sql) {
    const owner = this, db = this.db;
    return {sql, args: [],
      bind(...a) { const s = owner.prepare(sql); s.args = a.map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v); return s; },
      _run() { const r = db.prepare(sql).run(...this.args); return {success: true, meta: {changes: Number(r.changes), rows_read: 0, rows_written: Number(r.changes)}}; },
      async run() { owner.statements++; return this._run(); },
      async all() { owner.statements++; return {success: true, meta: {rows_read: 0, rows_written: 0}, results: db.prepare(sql).all(...this.args).map(r => ({...r}))}; },
      async first() { owner.statements++; const r = db.prepare(sql).get(...this.args); return r ? {...r} : null; },
      async raw() { owner.statements++; return db.prepare(sql).all(...this.args).map(r => Object.values(r)); }};
  }
  async batch(list) {
    this.statements += list.length;
    this.db.exec('BEGIN');
    try { const r = list.map(s => s._run()); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async exec(sql) { this.db.exec(sql); return {count: 1}; }
}

// A fresh MEDS database with the production schema and the $250 H250 account.
export async function createEngine() {
  const MEDS_DB = new D1();
  for (const m of ['0001_init.sql', '0002_operations.sql', '0003_tick_counter.sql', '0004_autonomous.sql'])
    MEDS_DB.db.exec(readFileSync(new URL('../../migrations/' + m, import.meta.url), 'utf8'));
  const env = {MEDS_DB, TRADING_MODE: 'shadow', SCOUT_ENABLED: 'true', LEADER_ONLY: 'true', PAPER_ENABLED: 'false', ENGINE_CADENCE: 'session',
    ALPACA_API_KEY: 'backtest', ALPACA_API_SECRET: 'backtest'};
  await ensurePaperSchema(env);
  await ensureCapacitySchema(MEDS_DB);
  return env;
}

// Run `fn` with the global clock frozen at `ms` and fetch routed to `fetchImpl`.
export async function atMoment(ms, fetchImpl, fn) {
  const clock = ms;
  class ReplayDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const oldDate = globalThis.Date, oldFetch = globalThis.fetch;
  globalThis.Date = ReplayDate; globalThis.fetch = fetchImpl;
  try { return await fn(); }
  finally { globalThis.Date = oldDate; globalThis.fetch = oldFetch; }
}

const q = (env, sql, ...args) => env.MEDS_DB.db.prepare(sql).all(...args).map(r => ({...r}));
const parse = s => { try { return JSON.parse(s); } catch { return {}; } };

export async function replayVariant({variant, dates, loadDay, ensureHeld = async () => ({fine: {}}), spreadModel, log = () => {}, onDay}) {
  const env = await createEngine();
  const deps = {...LEADER_DEPENDENCIES, chain: async () => [], policy: variant.policy};
  const out = {variant: variant.id, entries: [], events: [], trades: [], mirror: [], days: [], errors: [], rejections: {}, risk_gate: {}, cycles: 0, failed_cycles: 0, open_at_end: [], curve: [], marks: {},
    coverage: {gainers: [0, 0], losers: [0, 0], volume: [0, 0], trades: [0, 0]}};
  const last = {position: 0, event: 0, trade: 0};
  const marks = new Map(); // last known price per symbol, for end-of-day equity
  for (const date of dates) {
    const started = performance.now();
    const {day, extra} = loadDay(date);
    const market = new DayMarket(day, {extra, spreadModel});
    const held = q(env, "SELECT DISTINCT symbol FROM hunt_account_positions WHERE account_id=? AND status='open'", ACTIVE_ACCOUNT).map(r => r.symbol);
    const missing = held.filter(s => !market.hasMinuteData(s));
    if (missing.length) market.addExtra(await ensureHeld(date, missing));
    let scanned = 0, shortlisted = 0, fresh = 0, cycles = 0;
    for (const t of cycleTimes(day)) {
      const result = await atMoment(t, market.fetchHandler(() => t), () => runLeaderCycle(env, 'backtest', deps));
      cycles++;
      if (!result.ok) { out.failed_cycles++; if (out.errors.length < 50) out.errors.push({at: iso(t), error: String(result.error ?? result.skipped)}); }
      else if (!result.skipped) { scanned += result.scanned ?? 0; shortlisted += result.research_shortlist ?? 0; fresh += result.research_execution_fresh ?? 0; }
      // Mark the book at the last trade after every cycle (equity curve, and
      // the prices the live simulation uses for its daily loss check).
      const cash = q(env, 'SELECT cash FROM hunt_accounts WHERE account_id=?', ACTIVE_ACCOUNT)[0].cash;
      let equity = cash;
      for (const p of q(env, "SELECT symbol,remaining_qty,quantity,entry_price FROM hunt_account_positions WHERE account_id=? AND status='open'", ACTIVE_ACCOUNT)) {
        const px = market.lastPrice(p.symbol, t);
        if (px > 0) { marks.set(p.symbol, px); (out.marks[p.symbol] ??= []).push([t, px]); }
        equity += Number(p.remaining_qty ?? p.quantity) * (marks.get(p.symbol) ?? p.entry_price);
      }
      out.curve.push([t, Math.round(equity * 100) / 100]);
    }
    out.cycles += cycles;
    // Harvest what the engine committed today, then trim audit tables.
    for (const r of q(env, 'SELECT * FROM hunt_account_positions WHERE account_id=? AND id>? ORDER BY id', ACTIVE_ACCOUNT, last.position)) {
      last.position = r.id; const f = parse(r.features);
      out.entries.push({id: r.id, symbol: r.symbol, opened_at: r.opened_at, entry_price: r.entry_price, quantity: r.quantity, entry_notional: r.entry_notional,
        entry_day_change_pct: r.entry_day_change_pct, entry_score: r.entry_score, spread_pct: f.spread_pct ?? null, source: f.discovery_source ?? null,
        catalyst: f.catalyst_score ?? null, volume_accel: f.volume_accel ?? null, day_volume_ratio: f.day_volume_ratio ?? null, rotated_out: f.rotated_out ?? null});
    }
    for (const r of q(env, 'SELECT id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details FROM hunt_account_events WHERE account_id=? AND id>? ORDER BY id', ACTIVE_ACCOUNT, last.event)) {
      last.event = r.id; out.events.push({...r, details: parse(r.details)});
    }
    for (const r of q(env, `SELECT id,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,
        minutes_held,exit_reason,entry_score,entry_day_change_pct,take200_hit FROM hunt_account_trades WHERE account_id=? AND id>? ORDER BY id`, ACTIVE_ACCOUNT, last.trade)) {
      last.trade = r.id; out.trades.push(r);
    }
    // Rejections are counted once per stock, day and reason (a stock blocked
    // for twenty cycles in a row is one blocked stock).
    const seen = new Set();
    for (const r of q(env, "SELECT bucket,json_extract(payload,'$.live_mirror') AS m,json_extract(payload,'$.decisions') AS d FROM leader_cycle_audit ORDER BY bucket")) {
      for (const m of parse(r.m) ?? []) out.mirror.push(m);
      for (const d of parse(r.d) ?? []) {
        if (d.stage !== 'ENTRY' && d.stage !== 'ENTRY_RISK_GATE') continue;
        const table = d.stage === 'ENTRY' ? out.rejections : out.risk_gate;
        const key = d.outcome === 'ENTERED' ? 'ENTERED' : (d.reasons?.[0] ?? 'UNKNOWN'), id = d.stage + '|' + d.symbol + '|' + key;
        if (key !== 'ENTERED' && seen.has(id)) continue;
        seen.add(id); table[key] = (table[key] ?? 0) + 1;
      }
    }
    for (const [k, [n, exact]] of Object.entries(market.coverage)) { out.coverage[k][0] += n; out.coverage[k][1] += exact; }
    env.MEDS_DB.db.exec(`DELETE FROM leader_cycle_audit; DELETE FROM leader_research_archive; DELETE FROM engine_cycles WHERE bucket<'${iso(etWall(date, '04:00'))}'`);
    // End-of-day mark: cash plus open positions at the day's last trade.
    const close = etWall(date, '16:00');
    const account = q(env, 'SELECT cash,current_equity,realized_pnl FROM hunt_accounts WHERE account_id=?', ACTIVE_ACCOUNT)[0];
    const open = q(env, "SELECT symbol,remaining_qty,quantity,entry_price,opened_at FROM hunt_account_positions WHERE account_id=? AND status='open'", ACTIVE_ACCOUNT);
    let value = 0, unmarked = 0;
    for (const p of open) {
      const px = market.lastPrice(p.symbol, close);
      if (px > 0) marks.set(p.symbol, px); else unmarked++;
      value += Number(p.remaining_qty ?? p.quantity) * (marks.get(p.symbol) ?? p.entry_price);
    }
    const risk = q(env, 'SELECT risk_state,breach_reason,entries FROM leader_daily_risk WHERE account_id=? AND session_date=?', ACTIVE_ACCOUNT, date)[0] ?? {};
    const summary = {date, cash: account.cash, equity_marked: account.cash + value, engine_equity: account.current_equity, realized_pnl: account.realized_pnl,
      open_positions: open.length, unmarked_positions: unmarked, cycles, scanned_avg: cycles ? scanned / cycles : 0, shortlist_avg: cycles ? shortlisted / cycles : 0,
      execution_fresh_avg: cycles ? fresh / cycles : 0, risk_state: risk.risk_state ?? null, risk_breach: risk.breach_reason ?? null,
      quotes_fresh: market.stats.quotes_fresh, quotes_stale: market.stats.quotes_stale, seconds: (performance.now() - started) / 1000};
    out.days.push(summary);
    log(`${variant.id} ${date}: equity ${summary.equity_marked.toFixed(2)}, ${open.length} open, ${out.trades.length} trades so far (${summary.seconds.toFixed(1)}s)`);
    onDay?.(summary);
  }
  out.open_at_end = q(env, "SELECT symbol,opened_at,entry_price,remaining_qty,quantity FROM hunt_account_positions WHERE account_id=? AND status='open'", ACTIVE_ACCOUNT)
    .map(p => ({...p, last_price: marks.get(p.symbol) ?? null}));
  env.MEDS_DB.db.close();
  return out;
}
