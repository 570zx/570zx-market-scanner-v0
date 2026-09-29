// A fake Alpaca (trading calendar/assets + historical bars, news and quotes)
// serving synthetic days, with Alpaca's response shapes and pagination.
// Used by the backtest tests; not a test file itself.
import {syntheticDays} from '../backtest/lib/synthetic.mjs';
import {etWall} from '../backtest/lib/time.mjs';

const MIN = 60_000;
const encode = n => Buffer.from(String(n)).toString('base64');
const decode = t => t ? Number(Buffer.from(t, 'base64').toString()) : 0;

export function fakeAlpaca({first = '2026-09-09', days = 5, symbols = 30, seed = 3, throttleOnce = true, key = 'fake-key'} = {}) {
  const syn = syntheticDays(first, days, {symbols, seed});
  const byDate = new Map(syn.map(d => [d.date, d])), dates = syn.map(d => d.date);
  const universe = [...new Set(syn.flatMap(d => [...Object.keys(d.fine), ...Object.keys(d.coarse)]))].sort();
  const cache = new Map();
  // Alpaca-shaped one-minute bars for a symbol on a date (15-minute bars are aggregated).
  function bars(date, symbol, timeframe) {
    const k = date + symbol + timeframe;
    if (cache.has(k)) return cache.get(k);
    const d = byDate.get(date), fine = d?.fine[symbol], coarse = d?.coarse[symbol], out = [];
    const cols = fine ?? coarse;
    if (cols) {
      const width = fine ? 1 : 15;
      for (let i = 0; i < cols.t.length; i++) out.push({t: new Date(d.t0 + cols.t[i] * MIN).toISOString(), o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i], n: cols.n[i], vw: cols.c[i], _m: cols.t[i], _w: width});
    }
    let result = out;
    const width = {'15Min': 15, '1Hour': 60}[timeframe];
    if (width && (fine || width > 15)) {
      const groups = new Map();
      for (const b of out) { const g = Math.floor(b._m / width); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); }
      result = [...groups].map(([g, xs]) => ({t: new Date(d.t0 + g * width * MIN).toISOString(), o: xs[0].o, h: Math.max(...xs.map(x => x.h)), l: Math.min(...xs.map(x => x.l)), c: xs.at(-1).c, v: xs.reduce((n, x) => n + x.v, 0), n: xs.reduce((n, x) => n + x.n, 0), vw: xs.at(-1).c, _m: g * width, _w: width}));
    }
    cache.set(k, result);
    return result;
  }
  function daily(date, symbol) {
    const xs = bars(date, symbol, '1Min');
    if (!xs.length) return null;
    return {t: date + 'T04:00:00Z', o: xs[0].o, h: Math.max(...xs.map(x => x.h)), l: Math.min(...xs.map(x => x.l)), c: xs.at(-1).c, v: xs.reduce((n, x) => n + x.v, 0), n: xs.reduce((n, x) => n + x.n, 0), vw: xs.at(-1).c};
  }
  const clean = b => { const {_m, _w, ...rest} = b; return rest; };
  const calls = [];
  let throttled = !throttleOnce;
  const handler = async (url, init = {}) => {
    const u = new URL(String(url)), q = u.searchParams;
    calls.push(u.hostname + u.pathname);
    if (init.headers?.['APCA-API-KEY-ID'] !== key) return new Response('{"message":"forbidden"}', {status: 403});
    if (!throttled && u.hostname === 'data.alpaca.markets') { throttled = true; return new Response('{"message":"too many requests"}', {status: 429}); }
    if (u.hostname === 'paper-api.alpaca.markets') {
      if (u.pathname === '/v2/calendar') return Response.json(dates.filter(d => d >= q.get('start') && d <= q.get('end')).map(date => ({date, open: '09:30', close: '16:00', session_open: '0400', session_close: '2000'})));
      if (u.pathname === '/v2/assets') return Response.json(q.get('status') === 'active' ? universe.map(symbol => ({id: symbol, class: 'us_equity', exchange: 'NASDAQ', symbol, status: 'active', tradable: true})) :
        [{id: 'GONE', class: 'us_equity', exchange: 'NASDAQ', symbol: 'GONE', status: 'inactive', tradable: false}, {id: 'OTCX', class: 'us_equity', exchange: 'OTC', symbol: 'OTCX', status: 'inactive', tradable: false}]);
    }
    if (u.hostname !== 'data.alpaca.markets') return new Response('not found', {status: 404});
    const limit = Number(q.get('limit') ?? 1000), offset = decode(q.get('page_token'));
    if (u.pathname === '/v2/stocks/bars') {
      const tf = q.get('timeframe'), start = Date.parse(q.get('start')), end = Date.parse(q.get('end').length === 10 ? q.get('end') + 'T23:59:59Z' : q.get('end'));
      const flat = [];
      for (const s of q.get('symbols').split(',').sort()) {
        if (tf === '1Day') { for (const date of dates) { const b = daily(date, s); if (b && Date.parse(b.t) >= start && Date.parse(b.t) <= end) flat.push([s, b]); } }
        else for (const date of dates) for (const b of bars(date, s, tf)) { const t = Date.parse(b.t); if (t >= start && t <= end) flat.push([s, clean(b)]); }
      }
      const page = flat.slice(offset, offset + limit), out = {};
      for (const [s, b] of page) (out[s] ??= []).push(b);
      return Response.json({bars: out, next_page_token: offset + limit < flat.length ? encode(offset + limit) : null});
    }
    if (u.pathname === '/v1beta1/news') {
      const start = Date.parse(q.get('start')), end = Date.parse(q.get('end'));
      const all = syn.flatMap(d => d.news).filter(n => n.t >= start && n.t <= end).sort((a, b) => a.t - b.t)
        .map(n => ({id: n.id, headline: n.h, summary: n.s, symbols: n.sy, created_at: new Date(n.t).toISOString(), updated_at: new Date(n.t).toISOString(), source: 'benzinga'}));
      return Response.json({news: all.slice(offset, offset + Math.min(limit, 50)), next_page_token: offset + Math.min(limit, 50) < all.length ? encode(offset + 50) : null});
    }
    if (u.pathname === '/v2/stocks/quotes') {
      const s = q.get('symbols'), end = Date.parse(q.get('end')), date = new Date(end - 4 * 3600_000).toISOString().slice(0, 10);
      const xs = bars(date, s, '1Min').filter(b => Date.parse(b.t) + MIN <= end);
      if (!xs.length) return Response.json({quotes: {}, next_page_token: null});
      const mid = xs.at(-1).c, tick = mid >= 1 ? 0.01 : 0.0001, half = Math.max(tick, mid * 0.005);
      const bp = Number((Math.floor((mid - half) / tick) * tick).toFixed(4)), ap = Number((Math.ceil((mid + half) / tick) * tick).toFixed(4));
      return Response.json({quotes: {[s]: [{t: new Date(end - 1500).toISOString(), bp, ap, bs: 3, as: 2, bx: 'Q', ax: 'Q', c: ['R'], z: 'C'}]}, next_page_token: null});
    }
    return new Response('not found', {status: 404});
  };
  return {handler, calls, dates, syn, universe, open: date => etWall(date, '09:30')};
}
