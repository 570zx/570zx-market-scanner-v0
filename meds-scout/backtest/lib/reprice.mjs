// Cost pass: every simulated trade is re-priced at the real consolidated
// NBBO (Alpaca historical quotes), one minute after MEDS decided (the live
// mirror places its order on the next minute). Two views:
//   repricePaper(): the same paper trades and sizes, bought at the real ask
//                   and sold at the real bid;
//   simulateLive(): what the live Robinhood mirror would have done with those
//                   decisions: whole shares, $12 orders, its spread/chase
//                   gates, 3 orders a minute, requests expire after 3 minutes,
//                   leftovers sold once paper no longer holds them.
import {RealDate, etWall, etDate as etDateOf} from './time.mjs';

const iso = ms => new RealDate(ms).toISOString();
export const LIVE_LATENCY_MS = 60_000;
export const LIVE_DEFAULTS = Object.freeze({max_capital: 250, max_order_notional: 12, max_orders_per_day: 40, daily_loss_limit: 15,
  buy_limit_buffer_pct: 0.01, max_chase_pct: 0.02, max_spread_pct: 0.03, per_minute: 3, request_ttl_ms: 180_000, quote_max_age_ms: 120_000});
const tick = p => p >= 1 ? 0.01 : 0.0001;
const roundUpTick = p => Number((Math.ceil(p / tick(p) - 1e-9) * tick(p)).toFixed(p >= 1 ? 2 : 4));

// NBBO lookups with a persistent cache (quotes are fetched once per symbol and moment).
export class QuoteBook {
  constructor({alpaca = null, store = null, asofFor = () => undefined, log = () => {}} = {}) {
    this.alpaca = alpaca; this.store = store; this.asofFor = asofFor; this.log = log;
    this.cache = store ? store.read('quotes.json.gz', {}) : {}; this.fetched = 0; this.misses = 0;
  }
  async at(symbol, ms) {
    const key = symbol + '|' + iso(ms);
    if (key in this.cache) return this.cache[key];
    if (!this.alpaca) { this.misses++; return null; }
    let q = null;
    try { q = await this.alpaca.quoteAt(symbol, iso(ms), {asof: this.asofFor(symbol)}); }
    catch (error) { this.log(`quote ${symbol} ${iso(ms)}: ${error.message}`); return null; }
    this.cache[key] = q ? {bp: Number(q.bp), ap: Number(q.ap), bs: Number(q.bs ?? 0), as: Number(q.as ?? 0), t: q.t} : null;
    if (++this.fetched % 250 === 0) { this.save(); this.log(`${this.fetched} quotes fetched`); }
    return this.cache[key];
  }
  save() { if (this.store) this.store.write('quotes.json.gz', this.cache); }
}

// Fill list per paper position: the entry, every recorded partial sale, and
// the final sale (a plain full exit has no event row, only the trade row).
export function paperFills(run) {
  const byId = new Map(run.entries.map(e => [e.id, {...e, sells: []}]));
  for (const ev of run.events) byId.get(ev.position_id)?.sells.push({t: RealDate.parse(ev.created_at), qty: ev.quantity, price: ev.price, type: ev.event_type});
  const byKey = new Map([...byId.values()].map(p => [p.symbol + '|' + p.opened_at, p]));
  for (const tr of run.trades) {
    const p = byKey.get(tr.symbol + '|' + tr.opened_at);
    if (!p) continue;
    p.trade = tr;
    const sold = p.sells.reduce((n, s) => n + s.qty, 0), rest = p.quantity - sold;
    if (rest > 1e-9) p.sells.push({t: RealDate.parse(tr.closed_at), qty: rest, price: tr.exit_price, type: 'EXIT:' + tr.exit_reason});
  }
  return [...byId.values()];
}

export async function repricePaper(run, book, {latencyMs = LIVE_LATENCY_MS, markFor = () => null} = {}) {
  const out = {positions: 0, priced: 0, unpriced: 0, pnl_model: 0, pnl_nbbo: 0, entry_spread_pct: [], exit_spread_pct: [], rows: []};
  for (const p of paperFills(run)) {
    out.positions++;
    const buy = await book.at(p.symbol, RealDate.parse(p.opened_at) + latencyMs);
    let proceedsModel = 0, proceedsNbbo = 0, ok = !!buy, soldQty = 0;
    for (const s of p.sells) {
      proceedsModel += s.qty * s.price; soldQty += s.qty;
      const q = await book.at(p.symbol, s.t + latencyMs);
      if (!q) { ok = false; continue; }
      proceedsNbbo += s.qty * q.bp;
      out.exit_spread_pct.push((q.ap - q.bp) / ((q.ap + q.bp) / 2) * 100);
    }
    const open = p.quantity - soldQty;
    if (open > 1e-9) { const m = markFor(p.symbol); proceedsModel += open * (m ?? p.entry_price); proceedsNbbo += open * (m ?? p.entry_price); }
    const modelPnl = proceedsModel - p.entry_notional;
    out.pnl_model += modelPnl;
    if (buy) out.entry_spread_pct.push((buy.ap - buy.bp) / ((buy.ap + buy.bp) / 2) * 100);
    if (!ok) { out.unpriced++; out.rows.push({symbol: p.symbol, opened_at: p.opened_at, model_pnl: modelPnl, nbbo_pnl: null, still_open: open > 1e-9}); continue; }
    const nbboPnl = proceedsNbbo - p.quantity * buy.ap;
    out.priced++; out.pnl_nbbo += nbboPnl;
    out.rows.push({symbol: p.symbol, opened_at: p.opened_at, model_pnl: modelPnl, nbbo_pnl: nbboPnl, entry_ask: buy.ap, model_entry: p.entry_price, still_open: open > 1e-9, exit: p.trade?.exit_reason ?? null});
  }
  return out;
}

// Minute-by-minute model of the live step (live-execution.ts runLiveStep):
// it runs every minute of the regular session except the paper-cycle minutes
// (multiples of five), reads the paper outbox, handles exits before entries,
// submits at most 3 orders a run, expires requests older than 3 minutes, and
// sells anything it owns that paper no longer holds (orphan convergence).
// Orders are marketable limits: a buy fills at the ask, a sell at the bid.
export async function simulateLive(mirror, book, {limits = LIVE_DEFAULTS, sessions, markFor = () => null, paperOpen = () => true, lagMs = 5000} = {}) {
  const L = {...LIVE_DEFAULTS, ...limits};
  const owned = new Map(), skipped = {}, roundTrips = [], log = [];
  let realized = 0, orders = 0, buys = 0, sells = 0;
  const skip = r => { skipped[r] = (skipped[r] ?? 0) + 1; };
  const exposure = () => [...owned.values()].reduce((n, o) => n + o.cost, 0);
  // Lifetime P&L of the positions MEDS owns, measured only when every one has a price.
  const totalPnl = at => { let u = 0; for (const o of owned.values()) { const m = markFor(o.symbol, at); if (!(m > 0)) return null; u += o.qty * m - o.cost; } return realized + u; };
  const requests = mirror.map(r => ({...r, decided: RealDate.parse(r.decided_at)})).sort((a, b) => a.decided - b.decided);
  const days = sessions ?? [...new Set(requests.map(r => etDateOf(r.decided)))].map(date => ({date}));
  let next = 0, prevClose = null;
  for (const {date} of days) {
    // Production takes the day's starting P&L at its first off-hours run after
    // midnight, i.e. about the previous close: an overnight gap counts today.
    let ordersToday = 0, blocked = null, dayStart = prevClose == null ? null : totalPnl(prevClose), lastTotal = dayStart;
    prevClose = etWall(date, '16:00');
    const open = etWall(date, '09:30'), close = etWall(date, '16:00'), pending = [];
    for (let minute = open + 60_000; minute < close; minute += 60_000) {
      const at = minute + lagMs;
      while (next < requests.length && requests[next].decided < at) { if (requests[next].decided >= open - 3 * 60_000) pending.push(requests[next]); else skip('REQUEST_TOO_OLD'); next++; }
      if (new RealDate(minute).getUTCMinutes() % 5 === 0) continue; // the paper cycle's minute
      // Daily loss: change in P&L since the day's first measured run; once hit, no buys until tomorrow.
      const total = totalPnl(at);
      if (total != null) { lastTotal = total; if (dayStart == null) dayStart = total; }
      if (!blocked && L.daily_loss_limit > 0 && dayStart != null && lastTotal - dayStart <= -L.daily_loss_limit) blocked = 'DAILY_LOSS_LIMIT';
      for (let i = pending.length - 1; i >= 0; i--) if (at - pending[i].decided > L.request_ttl_ms) { skip('REQUEST_TOO_OLD'); pending.splice(i, 1); }
      for (const o of owned.values())
        if (!paperOpen(o.symbol, at) && !pending.some(r => r.symbol === o.symbol && r.action !== 'ENTRY'))
          pending.push({symbol: o.symbol, action: 'EXIT_ALL', fraction: 1, reason: 'orphan_no_paper_position', decided: at, orphan: true});
      pending.sort((a, b) => (a.action === 'ENTRY' ? 1 : 0) - (b.action === 'ENTRY' ? 1 : 0) || a.decided - b.decided);
      let submitted = 0;
      const selling = new Set();
      for (let i = 0; i < pending.length && submitted < L.per_minute;) {
        const r = pending[i], done = () => pending.splice(i, 1);
        if (r.action === 'ENTRY') {
          if (blocked) { skip(blocked); done(); continue; }
          if (ordersToday >= L.max_orders_per_day) { skip('MAX_ORDERS_PER_DAY'); done(); continue; }
          if (owned.has(r.symbol)) { skip('ALREADY_HELD_OR_PENDING'); done(); continue; }
          const q = await book.at(r.symbol, at);
          if (!q) { skip('NO_LIVE_QUOTE'); done(); continue; }
          if (at - RealDate.parse(q.t) > L.quote_max_age_ms) { skip('LIVE_QUOTE_STALE'); done(); continue; }
          if ((q.ap - q.bp) / q.ap > L.max_spread_pct) { skip('SPREAD_TOO_WIDE'); done(); continue; }
          if (Number(r.paper_price) > 0 && q.ap > Number(r.paper_price) * (1 + L.max_chase_pct)) { skip('PRICE_MOVED_AWAY'); done(); continue; }
          const limit = roundUpTick(q.ap * (1 + L.buy_limit_buffer_pct));
          // Buying power: the $max_capital the account started with, plus realized P&L, less what is held.
          const budget = Math.min(L.max_order_notional, L.max_capital - exposure(), (L.max_capital + realized - exposure()) * 0.98);
          const qty = Math.floor(budget / limit);
          if (qty < 1) { skip(L.max_capital - exposure() < limit ? 'MAX_CAPITAL_REACHED' : 'PRICE_ABOVE_ORDER_CAP'); done(); continue; }
          owned.set(r.symbol, {symbol: r.symbol, qty, cost: qty * q.ap, entryCost: qty * q.ap, realized: 0, opened: at, entry: q.ap, spread: (q.ap - q.bp) / q.ap});
          orders++; buys++; ordersToday++; submitted++; done();
          log.push({at: iso(at), symbol: r.symbol, side: 'BUY', qty, price: q.ap, request: r.reason});
        } else {
          const o = owned.get(r.symbol);
          if (!o) { if (!r.orphan) skip('EXIT_NOT_HELD_LIVE'); done(); continue; } // the mirror never bought it
          if (selling.has(r.symbol)) { skip('SELL_ALREADY_PENDING'); done(); continue; }
          const q = await book.at(r.symbol, at);
          if (!q) {
            if (r.orphan) { done(); continue; }
            if (at - r.decided > L.request_ttl_ms / 2) { skip('NO_LIVE_QUOTE'); done(); continue; }
            i++; continue; // wait for the next run
          }
          const qty = r.action === 'EXIT_ALL' ? o.qty : Math.min(o.qty, Math.floor(o.qty * Number(r.fraction) + 1e-9));
          if (qty < 1) { skip('FRACTION_BELOW_ONE_SHARE'); done(); continue; }
          const costPart = o.cost * qty / o.qty, pnl = qty * q.bp - costPart;
          realized += pnl; orders++; sells++; ordersToday++; submitted++; selling.add(r.symbol); done();
          log.push({at: iso(at), symbol: r.symbol, side: 'SELL', qty, price: q.bp, pnl, request: r.reason});
          o.qty -= qty; o.cost -= costPart; o.realized += pnl;
          if (o.qty <= 0) {
            owned.delete(r.symbol);
            roundTrips.push({symbol: r.symbol, opened: iso(o.opened), closed: iso(at), pnl: o.realized, return_pct: o.realized / o.entryCost * 100,
              minutes: (at - o.opened) / 60_000, entry_spread_pct: o.spread * 100, reason: r.reason});
          }
        }
      }
    }
    for (const r of pending) if (!r.orphan) skip('REQUEST_TOO_OLD');
  }
  for (; next < requests.length; next++) skip('REQUEST_TOO_OLD');
  let openValue = 0, openCost = 0;
  for (const o of owned.values()) { const m = markFor(o.symbol, Infinity); openCost += o.cost; openValue += o.qty * (m ?? o.entry); }
  return {orders, buys, sells, skipped, realized, open_positions: owned.size, open_unrealized: openValue - openCost, total_pnl: realized + openValue - openCost,
    round_trips: roundTrips, wins: roundTrips.filter(t => t.pnl > 0).length, log};
}

// When paper held each symbol: [opened_at, closed_at) intervals from the replay.
export function paperOpenLookup(run) {
  const spans = new Map(), closes = new Map(run.trades.map(t => [t.symbol + '|' + t.opened_at, RealDate.parse(t.closed_at)]));
  for (const e of run.entries) {
    const from = RealDate.parse(e.opened_at), to = closes.get(e.symbol + '|' + e.opened_at) ?? Infinity;
    if (!spans.has(e.symbol)) spans.set(e.symbol, []);
    spans.get(e.symbol).push([from, to]);
  }
  return (symbol, at) => (spans.get(symbol) ?? []).some(([a, b]) => at >= a && at < b);
}
