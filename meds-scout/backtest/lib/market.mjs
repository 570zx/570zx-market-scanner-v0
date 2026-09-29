// Emulates the Alpaca market-data endpoints MEDS calls, from one day of
// historical bars, as they would have answered at a given moment:
//   /v2/stocks/snapshots, /v2/stocks/quotes/latest, /v1beta1/news,
//   /v1beta1/screener/stocks/movers and /most-actives.
// No look-ahead: a bar is visible only once it has completed (start + width
// <= the moment asked about); delayed_sip (premarket) sees 15 minutes less;
// a stock appears on a screen only once the data up to that moment put it
// there (see planScreens in dataset.mjs).
// Quotes are modeled around the last trade with the spread model; a quote is
// current only if the stock traded within the last few minutes.
import {etWall, MIN, RealDate} from './time.mjs';
import {spreadPct, PRIOR_SPREAD_MODEL} from './spread.mjs';

const iso = ms => new RealDate(ms).toISOString();
const DELAY = 15 * MIN;

class Series {
  constructor(cols, t0, widthMin, tier) {
    const n = cols.t.length;
    this.tier = tier; this.width = widthMin * MIN; this.length = n;
    this.t = new Float64Array(n); this.o = Float64Array.from(cols.o); this.h = Float64Array.from(cols.h);
    this.l = Float64Array.from(cols.l); this.c = Float64Array.from(cols.c); this.v = Float64Array.from(cols.v); this.n = Float64Array.from(cols.n);
    this.cumV = new Float64Array(n); this.cumN = new Float64Array(n); this.hi = new Float64Array(n); this.lo = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.t[i] = t0 + cols.t[i] * MIN;
      this.cumV[i] = (i ? this.cumV[i - 1] : 0) + this.v[i]; this.cumN[i] = (i ? this.cumN[i - 1] : 0) + this.n[i];
      this.hi[i] = Math.max(i ? this.hi[i - 1] : -Infinity, this.h[i]); this.lo[i] = Math.min(i ? this.lo[i - 1] : Infinity, this.l[i]);
    }
  }
  // Index of the last bar completed at `cutoff`, or -1.
  last(cutoff) {
    let lo = 0, hi = this.length - 1, ans = -1;
    const latestStart = cutoff - this.width;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.t[mid] <= latestStart) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
}

const floorTick = (x, tick) => Number((Math.floor(x / tick + 1e-9) * tick).toFixed(tick < 0.01 ? 4 : 2));
const ceilTick = (x, tick) => Number((Math.ceil(x / tick - 1e-9) * tick).toFixed(tick < 0.01 ? 4 : 2));

export class DayMarket {
  constructor(day, {extra = null, spreadModel = PRIOR_SPREAD_MODEL} = {}) {
    this.date = day.date; this.t0 = day.t0; this.prevDate = day.prevDate;
    this.open = etWall(day.date, day.open ?? '09:30');
    this.ref = day.ref ?? {}; this.boards = day.boards ?? {gainers: [], losers: [], byVolume: [], byTrades: []};
    this.news = day.news ?? []; this.model = spreadModel;
    // Which stocks may appear on the screens, and from when (dataset.mjs
    // planScreens): decided from data up to that moment only. Without a plan
    // (synthetic days) every stock in the data may appear.
    this.showFrom = day.showFrom ? new Map(Object.entries(day.showFrom)) : day.stats?.synthetic ? null : new Map();
    this.untradable = new Set(day.untradable ?? []);
    // Per 15-minute session slot, the extremes the stocks not yet showable
    // could reach: used only to report how often a replayed screen provably
    // equals the real one.
    this.windows = new Map((day.windows ?? []).map(w => [w.slot, w]));
    this.coverage = {gainers: [0, 0], losers: [0, 0], volume: [0, 0], trades: [0, 0]}; // [screens, provably complete]
    this.series = new Map();
    for (const [s, cols] of Object.entries(day.fine ?? {})) if (cols.t.length) this.series.set(s, new Series(cols, day.t0, 1, 'fine'));
    for (const [s, cols] of Object.entries(day.coarse ?? {})) if (cols.t.length && !this.series.has(s)) this.series.set(s, new Series(cols, day.t0, 15, 'coarse'));
    // Screens rank the day's own data only; extra one-minute data fetched for
    // a held stock never changes what a screen shows.
    this.screenSeries = new Map(this.series);
    if (extra) this.addExtra(extra);
    this.stats = {snapshots: 0, quotes_fresh: 0, quotes_stale: 0};
  }
  // One-minute data for held stocks (replaces 15-minute data). Extra stocks
  // never become showable on the screens.
  addExtra(extra) { for (const [s, cols] of Object.entries(extra.fine ?? {})) if (cols.t.length && this.series.get(s)?.tier !== 'fine') this.series.set(s, new Series(cols, this.t0, 1, 'fine')); }
  has(symbol) { return this.series.has(symbol); }
  hasMinuteData(symbol) { return this.series.get(symbol)?.tier === 'fine'; }
  showable(symbol, now) { if (!this.showFrom) return true; const at = this.showFrom.get(symbol); return at != null && at <= now; }

  // Last trade price visible at `now` (for marks and reports).
  lastPrice(symbol, now) { const x = this.series.get(symbol); if (!x) return null; const i = x.last(now); return i >= 0 ? x.c[i] : null; }

  quoteAt(x, i, cutoff) {
    const p = x.c[i];
    if (!(p > 0)) return undefined;
    let dv = 0, trades = 0, hi = -Infinity, lo = Infinity;
    for (let k = i; k >= 0 && x.t[k] + x.width > cutoff - 5 * MIN; k--) { dv += x.v[k] * x.c[k]; trades += x.n[k]; hi = Math.max(hi, x.h[k]); lo = Math.min(lo, x.l[k]); }
    const range = hi > 0 && lo > 0 && hi >= lo ? (hi - lo) / p * 100 : 0;
    const pct = spreadPct(this.model, {price: p, dollarVolume5: dv, trades5: trades, range5Pct: range});
    const tick = p >= 1 ? 0.01 : 0.0001, half = Math.max(tick / 2, p * pct / 200);
    const bp = floorTick(p - half, tick);
    let ap = ceilTick(p + half, tick);
    if (!(bp > 0)) return undefined;
    if (ap <= bp) ap = Number((bp + tick).toFixed(tick < 0.01 ? 4 : 2));
    const lastEnd = x.t[i] + x.width, current = cutoff - lastEnd <= x.width + 2 * MIN;
    current ? this.stats.quotes_fresh++ : this.stats.quotes_stale++;
    return {t: iso(current ? cutoff - 1000 : lastEnd - 1000), bp, ap, bs: 100, as: 100};
  }

  snapshot(symbol, now, feed) {
    const ref = this.ref[symbol], x = this.series.get(symbol);
    const snap = {};
    if (ref) snap.prevDailyBar = {t: this.prevDate + 'T04:00:00Z', o: ref[0], h: ref[0], l: ref[0], c: ref[0], v: ref[1]};
    if (!x) return ref ? snap : undefined;
    const cutoff = feed === 'delayed_sip' ? now - DELAY : now, i = x.last(cutoff);
    if (i < 0) return snap;
    this.stats.snapshots++;
    const p = x.c[i];
    snap.latestTrade = {t: iso(x.t[i] + x.width - 1000), p, s: 100};
    if (x.tier === 'fine') snap.minuteBar = {t: iso(x.t[i]), o: x.o[i], h: x.h[i], l: x.l[i], c: p, v: x.v[i], n: x.n[i]};
    snap.dailyBar = {t: iso(this.t0), o: x.o[0], h: x.hi[i], l: x.lo[i], c: p, v: x.cumV[i], n: x.cumN[i]};
    const q = this.quoteAt(x, i, cutoff);
    if (q) snap.latestQuote = q;
    return snap;
  }

  windowAt(now) { return this.windows.get(Math.floor((now - this.t0) / (15 * MIN))) ?? null; }
  // A replayed screen is provably the real one when no stock that was not yet
  // showable could have beaten its last entry (or, for a short list, joined it).
  complete(screen, list, top, value, bounds, beats) {
    let ok = false;
    if (bounds) ok = list.length >= top ? !bounds.length || !beats(bounds[0], value(list[top - 1])) : bounds.length === 0;
    this.coverage[screen][0]++; if (ok) this.coverage[screen][1]++;
  }

  // Top movers: previous session's final boards until the open (Alpaca's
  // documented reset), then change of the last trade versus the reference close.
  movers(now, top = 50) {
    if (now < this.open) return {gainers: this.boards.gainers.slice(0, top), losers: this.boards.losers.slice(0, top), market_type: 'stocks', last_updated: iso(now)};
    const rows = [];
    for (const [symbol, x] of this.screenSeries) {
      const ref = this.ref[symbol]?.[0];
      if (!(ref > 0) || this.untradable.has(symbol) || !this.showable(symbol, now)) continue;
      const i = x.last(now);
      if (i < 0) continue;
      const price = x.c[i], pct = (price / ref - 1) * 100;
      rows.push({symbol, price, change: Number((price - ref).toFixed(4)), percent_change: Number(pct.toFixed(2)), _pct: pct});
    }
    const w = this.windowAt(now);
    const gainers = rows.filter(r => r._pct > 0).sort((a, c) => c._pct - a._pct || a.symbol.localeCompare(c.symbol)).slice(0, top);
    const losers = rows.filter(r => r._pct < 0).sort((a, c) => a._pct - c._pct || a.symbol.localeCompare(c.symbol)).slice(0, top);
    this.complete('gainers', gainers, top, r => r._pct, w?.gain, (bound, v) => bound >= v);
    this.complete('losers', losers, top, r => r._pct, w?.loss, (bound, v) => bound <= v);
    const clean = r => ({symbol: r.symbol, price: r.price, change: r.change, percent_change: r.percent_change});
    return {gainers: gainers.map(clean), losers: losers.map(clean), market_type: 'stocks', last_updated: iso(now)};
  }

  mostActives(now, by = 'volume', top = 100) {
    if (now < this.open) return {most_actives: (by === 'trades' ? this.boards.byTrades : this.boards.byVolume).slice(0, top), last_updated: iso(now)};
    const rows = [];
    for (const [symbol, x] of this.screenSeries) {
      if (!this.showable(symbol, now)) continue;
      const i = x.last(now);
      if (i >= 0) rows.push({symbol, volume: x.cumV[i], trade_count: x.cumN[i]});
    }
    const key = by === 'trades' ? 'trade_count' : 'volume', w = this.windowAt(now);
    const list = rows.sort((a, c) => c[key] - a[key] || a.symbol.localeCompare(c.symbol)).slice(0, top);
    this.complete(by === 'trades' ? 'trades' : 'volume', list, top, r => r[key], w ? (by === 'trades' ? w.trades : w.volume) : null, (bound, v) => bound >= v);
    return {most_actives: list, last_updated: iso(now)};
  }

  // News published at or before `now`, newest first.
  newsAt(now, {symbols = null, start = null, limit = 50} = {}) {
    let hi = this.news.length - 1;
    while (hi >= 0 && this.news[hi].t > now) hi--;
    const want = symbols ? new Set(symbols) : null, out = [];
    for (let k = hi; k >= 0 && out.length < limit; k--) {
      const n = this.news[k];
      if (start != null && n.t < start) break;
      if (want && !n.sy.some(s => want.has(s))) continue;
      out.push({id: n.id, headline: n.h, summary: n.s, symbols: n.sy, created_at: iso(n.t), updated_at: iso(n.t), source: 'benzinga'});
    }
    return {news: out, next_page_token: null};
  }

  // A fetch() that answers MEDS's Alpaca data calls at the clock's moment.
  fetchHandler(clock) {
    return async url => {
      const u = new URL(String(url)), now = clock(), q = u.searchParams, path = u.pathname;
      const symbols = () => (q.get('symbols') ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (u.hostname !== 'data.alpaca.markets') throw new Error('backtest: unexpected host ' + u.hostname);
      if (path === '/v1beta1/screener/stocks/movers') return Response.json(this.movers(now, Number(q.get('top') ?? 10)));
      if (path === '/v1beta1/screener/stocks/most-actives') return Response.json(this.mostActives(now, q.get('by') ?? 'volume', Number(q.get('top') ?? 10)));
      if (path === '/v1beta1/news') return Response.json(this.newsAt(now, {symbols: q.get('symbols') ? symbols() : null, start: q.get('start') ? RealDate.parse(q.get('start')) : null, limit: Number(q.get('limit') ?? 10)}));
      if (path === '/v2/stocks/snapshots') {
        const out = {}, feed = q.get('feed') ?? 'iex';
        for (const s of symbols()) { const snap = this.snapshot(s, now, feed); if (snap) out[s] = snap; }
        return Response.json(out);
      }
      if (path === '/v2/stocks/quotes/latest') {
        const quotes = {}, feed = q.get('feed') ?? 'iex';
        for (const s of symbols()) { const snap = this.snapshot(s, now, feed); if (snap?.latestQuote) quotes[s] = snap.latestQuote; }
        return Response.json({quotes});
      }
      if (path.startsWith('/v1beta1/options/')) return Response.json({snapshots: {}, next_page_token: null});
      throw new Error('backtest: no emulation for ' + path);
    };
  }
}
