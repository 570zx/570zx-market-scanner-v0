// Builds the historical dataset the replay runs on, from Alpaca's free
// historical API (consolidated SIP tape, which the free plan allows for any
// period older than 15 minutes):
//   - every listed US stock's daily bars (raw and split-adjusted), so each
//     day's reference close is what the market saw that morning, even across
//     reverse splits;
//   - every stock's 15-minute bars for each test day (the whole market). At
//     each 15-minute mark the stocks then near the top of a screen (gainers,
//     losers, most active by volume and by trades) are noted, with the time.
//     A stock may appear on the replayed screens only from that moment (or
//     from its first news story, or all day if it was on the previous
//     session's boards), so what the replay shows never depends on how a
//     stock traded later;
//   - one-minute bars 04:00-16:00 ET for those stocks (names far above the $25
//     runner lane keep their 15-minute bars; they only occupy research slots)
//     and the day's full news feed.
import {etWall, etDate, addDays, realNow, RealDate} from './time.mjs';

export const DATASET_VERSION = 'meds-bt-data-v3';
const EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX', 'ARCA', 'BATS', 'NYSEARCA']);
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,14}$/;
// Screen scan: every 15 minutes from 08:00 ET, the top stocks per screen are
// noted (with a wide margin over the 50/100 the screens show).
export const SCAN = {stepMin: 15, firstMark: 16, gainers: 100, losers: 50, actives: 150, boundDepth: 200, fineMaxPrice: 40};
export const SLOTS = 48;            // 15-minute slots 04:00-16:00 ET
export const FIRST_SESSION_SLOT = 22; // 09:30-09:45
const BATCH = 400;

const round = (x, d = 4) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;

// The last `days` completed sessions ending at `end`, plus two earlier
// sessions that provide reference closes and the first morning's boards.
export async function sessionsFor(alpaca, {days, end}) {
  const today = etDate(realNow()), endDate = end || addDays(today, -1);
  // The free plan serves consolidated (SIP) history older than 15 minutes;
  // only completed days are replayed.
  if (endDate >= today) throw new Error(`--end ${endDate} is not a completed trading day (today is ${today} in New York)`);
  const cal = await alpaca.calendar(addDays(endDate, -Math.ceil(days * 1.6) - 20), endDate);
  const sessions = cal.map(c => ({date: c.date, open: c.open, close: c.close})).filter(c => c.date <= endDate);
  if (sessions.length < days + 2) throw new Error(`calendar returned ${sessions.length} sessions; need ${days + 2}`);
  return sessions.slice(-(days + 2));
}

export async function loadAssets(alpaca, store, log) {
  const name = `assets-${etDate(realNow())}.json.gz`;
  if (store.has(name)) return store.read(name);
  const rows = [];
  for (const status of ['active', 'inactive']) {
    const list = await alpaca.assets(status);
    for (const a of list) if (EXCHANGES.has(a.exchange) && SYMBOL_RE.test(a.symbol)) rows.push({symbol: a.symbol, exchange: a.exchange, status: a.status, tradable: !!a.tradable});
    log(`assets ${status}: ${list.length} listed, ${rows.length} kept so far`);
  }
  const bySymbol = {};
  for (const r of rows) if (!bySymbol[r.symbol] || r.status === 'active') bySymbol[r.symbol] = r;
  const assets = Object.values(bySymbol);
  store.write(name, assets);
  return assets;
}

// Daily bars for every asset over the sessions. A delisted company returns no
// data under today's symbol mapping, so inactive symbols without data are
// retried with the mapping as of the first session (reduces survivorship bias).
export async function loadDaily(alpaca, store, assets, sessions, log) {
  const first = sessions[0].date, last = sessions.at(-1).date, name = `daily-${first}-${last}.json.gz`;
  if (store.has(name)) { const d = store.read(name); if (d.version === DATASET_VERSION) return d; }
  const symbols = {}, asof = {};
  const fetchSet = async (list, mapping) => {
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const raw = await alpaca.bars(batch, {timeframe: '1Day', start: first, end: last, adjustment: 'raw', asof: mapping});
      const have = batch.filter(s => raw[s]?.length);
      const split = have.length ? await alpaca.bars(have, {timeframe: '1Day', start: first, end: last, adjustment: 'split', asof: mapping}) : {};
      for (const s of have) {
        const factor = new Map((split[s] ?? []).map(b => [b.t, b.c]));
        symbols[s] = raw[s].map(b => {
          const adj = factor.get(b.t);
          return [etDate(RealDate.parse(b.t)), b.o, b.h, b.l, b.c, b.v, b.n ?? 0, adj > 0 && b.c > 0 ? adj / b.c : 1];
        });
        if (mapping) asof[s] = mapping;
      }
      log(`daily bars ${Math.min(i + BATCH, list.length)}/${list.length}${mapping ? ' (mapped as of ' + mapping + ')' : ''}: ${Object.keys(symbols).length} symbols with data`);
    }
  };
  await fetchSet(assets.map(a => a.symbol));
  await fetchSet(assets.filter(a => a.status !== 'active' && !symbols[a.symbol]).map(a => a.symbol), first);
  const daily = {version: DATASET_VERSION, first, last, symbols, asof};
  store.write(name, daily);
  return daily;
}

// Per-date lookup: date -> Map(symbol -> {o,h,l,c,v,n,f}).
export function indexDaily(daily) {
  const byDate = new Map();
  for (const [s, rows] of Object.entries(daily.symbols)) {
    for (const [date, o, h, l, c, v, n, f] of rows) {
      let m = byDate.get(date); if (!m) byDate.set(date, m = new Map());
      m.set(s, {o, h, l, c, v, n, f});
    }
  }
  return byDate;
}

// Reference (previous) close and volume for `date`, expressed in that day's
// share terms: a split effective at that open rescales the prior day.
export function referenceFor(byDate, sessions, i) {
  const today = byDate.get(sessions[i].date) ?? new Map(), ref = {};
  for (const [s, bar] of today) {
    for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
      const prev = byDate.get(sessions[k].date)?.get(s);
      if (prev && prev.c > 0) { ref[s] = [round(prev.c * prev.f / bar.f, 6), Math.round(prev.v * bar.f / prev.f)]; break; }
    }
  }
  return ref;
}

// The screeners reset at the open; before it they still show the previous
// session's final boards (Alpaca's documented movers behaviour).
export function closingBoards(byDate, sessions, i, ref, untradable = new Set()) {
  const today = byDate.get(sessions[i].date) ?? new Map(), movers = [];
  // Alpaca's movers list only tradable symbols.
  for (const [s, b] of today) if (ref[s]?.[0] > 0 && b.c > 0 && !untradable.has(s)) movers.push({symbol: s, price: b.c, change: round(b.c - ref[s][0]), percent_change: round((b.c / ref[s][0] - 1) * 100, 2)});
  const all = [...today].map(([symbol, b]) => ({symbol, volume: b.v, trade_count: b.n}));
  return {
    gainers: movers.filter(m => m.percent_change > 0).sort((a, b) => b.percent_change - a.percent_change).slice(0, 50),
    losers: movers.filter(m => m.percent_change < 0).sort((a, b) => a.percent_change - b.percent_change).slice(0, 50),
    byVolume: [...all].sort((a, b) => b.volume - a.volume).slice(0, 100),
    byTrades: [...all].sort((a, b) => b.trade_count - a.trade_count).slice(0, 100),
  };
}

// Per 15-minute slot of one stock: the last trade price by the slot's end, the
// highest and lowest price the last trade could show during the slot (the
// previous close counts until the slot's first trade), and cumulative volume
// and trades by the slot's end.
export function slotStates(cols) {
  const out = [];
  let i = 0, last = null, cumV = 0, cumN = 0;
  for (let k = 0; k < SLOTS; k++) {
    let hi = last, lo = last;
    while (i < cols.t.length && Math.floor(cols.t[i] / SCAN.stepMin) === k) {
      hi = Math.max(hi ?? -Infinity, cols.h[i]); lo = Math.min(lo ?? Infinity, cols.l[i]);
      cumV += cols.v[i]; cumN += cols.n[i]; last = cols.c[i]; i++;
    }
    out.push({close: last, hi, lo, cumV, cumN});
  }
  return out;
}

// Decides which stocks the replay may show on its screens and from when:
//   - the previous session's boards (the screens show them before the open);
//   - a stock in the news, from its first story of the day;
//   - a stock that was near the top of a screen at a 15-minute mark, from
//     that mark (ranked on data up to the mark only).
// Everything else never appears on a replayed screen. For each session slot
// it also records the extremes the stocks not yet showable could reach, to
// report how often the replayed screen equals the real one.
export function planScreens({today, ref, scan, t0, boards, news, untradable = new Set()}) {
  const showFrom = new Map();
  const allow = (s, at) => { if (today.has(s) && !(showFrom.get(s) <= at)) showFrom.set(s, at); };
  for (const r of [...boards.gainers, ...boards.losers, ...boards.byVolume, ...boards.byTrades]) allow(r.symbol, t0);
  for (const n of news) for (const s of n.sy) allow(s, n.t);
  const states = [];
  for (const [s, cols] of Object.entries(scan)) if (today.has(s)) states.push([s, slotStates(cols), ref[s]?.[0] > 0 ? ref[s][0] : null]);
  const gain = (st, r) => st.close == null || r == null ? null : (st.close / r - 1) * 100;
  const top = (rows, key, dir, k) => rows.filter(x => x[key] != null).sort((a, b) => dir * (b[key] - a[key]) || a.s.localeCompare(b.s)).slice(0, k);
  for (let k = SCAN.firstMark - 1; k < SLOTS - 1; k++) {
    const at = t0 + (k + 1) * SCAN.stepMin * 60_000;
    const rows = states.map(([s, st, r]) => ({s, gain: untradable.has(s) ? null : gain(st[k], r), v: st[k].cumV, n: st[k].cumN}));
    for (const x of [...top(rows.filter(x => x.gain > 0), 'gain', 1, SCAN.gainers), ...top(rows.filter(x => x.gain < 0), 'gain', -1, SCAN.losers),
      ...top(rows.filter(x => x.v > 0), 'v', 1, SCAN.actives), ...top(rows.filter(x => x.n > 0), 'n', 1, SCAN.actives)]) allow(x.s, at);
  }
  const r4 = x => Math.round(x * 1e4) / 1e4, depth = SCAN.boundDepth, windows = [];
  for (let k = FIRST_SESSION_SLOT; k < SLOTS; k++) {
    const start = t0 + k * SCAN.stepMin * 60_000;
    const hidden = states.filter(([s]) => !(showFrom.get(s) <= start));
    const vals = f => hidden.map(f).filter(x => x != null && Number.isFinite(x));
    windows.push({slot: k,
      gain: vals(([s, st, r]) => untradable.has(s) || r == null || st[k].hi == null ? null : (st[k].hi / r - 1) * 100).filter(x => x > 0).sort((a, b) => b - a).slice(0, depth).map(r4),
      loss: vals(([s, st, r]) => untradable.has(s) || r == null || st[k].lo == null ? null : (st[k].lo / r - 1) * 100).filter(x => x < 0).sort((a, b) => a - b).slice(0, depth).map(r4),
      volume: vals(([, st]) => st[k].cumV).sort((a, b) => b - a).slice(0, depth), trades: vals(([, st]) => st[k].cumN).sort((a, b) => b - a).slice(0, depth)});
  }
  // One-minute data unless the stock closed above $40 the day before (decided
  // before the open). Such a stock would have to be down over 37% to reach
  // the $25 runner lane, which MEDS rejects as too negative, so it only ever
  // occupies research slots and 15-minute data is enough.
  const fine = [], coarse = [];
  for (const s of showFrom.keys()) (ref[s]?.[0] > SCAN.fineMaxPrice ? coarse : fine).push(s);
  return {fine: fine.sort(), coarse: coarse.sort(), showFrom: Object.fromEntries(showFrom), windows, stats: {market_symbols: states.length, showable: showFrom.size}};
}

// Columnar bars relative to 04:00 ET: t = minutes after 04:00.
export function packBars(rows, t0) {
  const cols = {t: [], o: [], h: [], l: [], c: [], v: [], n: []};
  for (const b of rows) {
    const t = Math.round((RealDate.parse(b.t) - t0) / 60_000);
    if (t < 0 || t >= 12 * 60) continue;
    cols.t.push(t); cols.o.push(b.o); cols.h.push(b.h); cols.l.push(b.l); cols.c.push(b.c); cols.v.push(b.v); cols.n.push(b.n ?? 0);
  }
  return cols;
}

async function minuteBarsFor(alpaca, symbols, date, daily, timeframe, batch = 200) {
  const t0 = etWall(date, '04:00'), start = new RealDate(t0).toISOString(), end = new RealDate(etWall(date, '16:00') - 1000).toISOString();
  const groups = new Map();
  for (const s of symbols) { const a = daily.asof[s] ?? ''; if (!groups.has(a)) groups.set(a, []); groups.get(a).push(s); }
  const out = {};
  for (const [asof, list] of groups) {
    for (let i = 0; i < list.length; i += batch) {
      const bars = await alpaca.bars(list.slice(i, i + batch), {timeframe, start, end, adjustment: 'raw', asof: asof || undefined});
      for (const [s, rows] of Object.entries(bars)) if (rows.length) out[s] = packBars(rows, t0);
    }
  }
  return out;
}

const compactNews = rows => rows.map(n => ({id: n.id, t: RealDate.parse(n.created_at), h: String(n.headline ?? '').slice(0, 300), s: String(n.summary ?? '').slice(0, 2000), sy: (n.symbols ?? []).map(x => String(x).toUpperCase())}))
  .filter(n => Number.isFinite(n.t)).sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));

export async function buildDay(alpaca, store, {sessions, i, byDate, daily, untradable, log}) {
  const session = sessions[i], name = `days/${session.date}.json.gz`;
  if (store.has(name)) { const d = store.read(name); if (d.version === DATASET_VERSION) return {cached: true, stats: d.stats}; }
  const before = alpaca.requests, t0 = etWall(session.date, '04:00');
  const ref = referenceFor(byDate, sessions, i);
  const prevRef = referenceFor(byDate, sessions, i - 1);
  const boards = closingBoards(byDate, sessions, i - 1, prevRef, untradable);
  const news = compactNews(await alpaca.news({start: new RealDate(etWall(sessions[i - 1].date, '16:00')).toISOString(), end: new RealDate(etWall(session.date, '16:00')).toISOString()}));
  const today = byDate.get(session.date) ?? new Map();
  const scan = await minuteBarsFor(alpaca, [...today.keys()], session.date, daily, '15Min', BATCH);
  const plan = planScreens({today, ref, scan, t0, boards, news, untradable});
  const fine = await minuteBarsFor(alpaca, plan.fine, session.date, daily, '1Min');
  const coarse = Object.fromEntries(plan.coarse.filter(s => scan[s]).map(s => [s, scan[s]]));
  const stats = {...plan.stats, fine: Object.keys(fine).length, coarse: Object.keys(coarse).length, news: news.length, requests: alpaca.requests - before};
  store.write(name, {version: DATASET_VERSION, date: session.date, open: session.open, close: session.close, t0, prevDate: sessions[i - 1].date,
    ref, boards, showFrom: plan.showFrom, windows: plan.windows, untradable: [...untradable].filter(s => s in plan.showFrom), fine, coarse, news, stats});
  log(`${session.date}: ${stats.fine} one-minute + ${stats.coarse} fifteen-minute symbols of ${stats.market_symbols}, ${stats.news} news, ${stats.requests} requests`);
  return {cached: false, stats};
}

// Symbols the replay holds but that were not in a day's universe (a position
// carried into a quiet day). Fetched once and kept beside the day file.
export async function ensureSymbols(alpaca, store, daily, date, symbols) {
  const name = `days/${date}.extra.json.gz`, extra = store.read(name, {version: DATASET_VERSION, fine: {}, missing: []});
  const want = symbols.filter(s => !(s in extra.fine) && !extra.missing.includes(s));
  if (!want.length) return extra;
  if (!alpaca) throw new Error(`no market data for held ${want.join(',')} on ${date} and no Alpaca client to fetch it`);
  const got = await minuteBarsFor(alpaca, want, date, daily, '1Min');
  for (const s of want) { if (got[s]) extra.fine[s] = got[s]; else extra.missing.push(s); }
  store.write(name, extra);
  return extra;
}

export async function buildDataset({alpaca, store, days, end, log = () => {}}) {
  const sessions = await sessionsFor(alpaca, {days, end});
  log(`sessions ${sessions[2].date} .. ${sessions.at(-1).date} (${days} trading days)`);
  const assets = await loadAssets(alpaca, store, log);
  const daily = await loadDaily(alpaca, store, assets, sessions, log);
  const byDate = indexDaily(daily);
  // Listed today but not tradable (Alpaca leaves these off its movers screen).
  const untradable = new Set(assets.filter(a => a.status === 'active' && !a.tradable).map(a => a.symbol));
  const built = [];
  for (let i = 2; i < sessions.length; i++) built.push({date: sessions[i].date, ...(await buildDay(alpaca, store, {sessions, i, byDate, daily, untradable, log}))});
  const manifest = {version: DATASET_VERSION, created_at: new RealDate(realNow()).toISOString(), sessions, test_days: sessions.slice(2).map(s => s.date),
    daily_file: `daily-${sessions[0].date}-${sessions.at(-1).date}.json.gz`, assets: assets.length, symbols_with_daily_data: Object.keys(daily.symbols).length,
    mapped_as_of_first_session: Object.keys(daily.asof).length, days: built, requests: alpaca.requests, retries: alpaca.retries};
  store.write('manifest.json', manifest);
  return {manifest, daily};
}
