// Minimal Alpaca REST client for the backtester: historical market data and
// the trading calendar/asset list. Paces requests below the free plan's
// 200/minute (the live Worker shares the same key), retries rate limits and
// server errors, and follows next_page_token pagination.
import {realNow,RealDate} from './time.mjs';

const REAL_FETCH = globalThis.fetch;
export const DATA_BASE = 'https://data.alpaca.markets';
export const TRADING_BASES = ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];

export class AlpacaError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export class Alpaca {
  constructor({key, secret, rpm = 150, fetchImpl = REAL_FETCH, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {}, maxRetries = 6}) {
    if (!key || !secret) throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET are required');
    this.headers = {'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, accept: 'application/json'};
    this.interval = 60_000 / rpm; this.fetch = fetchImpl; this.sleep = sleep; this.log = log; this.maxRetries = maxRetries;
    this.skipped = new Set(); this.nextSlot = 0; this.requests = 0; this.retries = 0; this.tradingBase = null;
  }
  // Reserve evenly spaced start times so concurrent callers share one budget.
  async slot() {
    const now = realNow(), at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.interval;
    if (at > now) await this.sleep(at - now);
  }
  async get(url) {
    for (let attempt = 0; ; attempt++) {
      await this.slot();
      this.requests++;
      let response;
      try { response = await this.fetch(url, {headers: this.headers, signal: AbortSignal.timeout(60_000)}); }
      catch (error) {
        if (attempt >= this.maxRetries) throw new AlpacaError(`network error on ${redact(url)}: ${error.message}`, 0);
        this.retries++; await this.sleep(backoff(attempt)); continue;
      }
      if (response.ok) return response.json();
      const body = (await response.text().catch(() => '')).slice(0, 300);
      if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
        this.retries++;
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const wait = response.status === 429 && reset > 0 ? Math.max(1000, reset * 1000 - realNow() + 1000) : backoff(attempt);
        this.log(`HTTP ${response.status} on ${redact(url)}; retrying in ${Math.round(wait / 1000)}s`);
        await this.sleep(Math.min(wait, 120_000)); continue;
      }
      throw new AlpacaError(`HTTP ${response.status} on ${redact(url)}: ${body}`, response.status);
    }
  }
  data(path, params = {}) { return this.get(DATA_BASE + path + query(params)); }
  // Calendar and assets live on the trading API. Paper keys use paper-api,
  // live keys use api; try paper first and remember whichever answers.
  async trading(path, params = {}) {
    const bases = this.tradingBase ? [this.tradingBase] : TRADING_BASES;
    let last;
    for (const base of bases) {
      try { const r = await this.get(base + path + query(params)); this.tradingBase = base; return r; }
      catch (error) { last = error; if (![401, 403].includes(error.status)) throw error; }
    }
    throw last;
  }
  // Follow next_page_token until exhausted; `each` receives every page.
  async pages(path, params, each, maxPages = 100_000) {
    let token = null, n = 0;
    do {
      const page = await this.data(path, {...params, ...(token ? {page_token: token} : {})});
      each(page); n++;
      token = page.next_page_token || null;
    } while (token && n < maxPages);
    return n;
  }
  // Bars for many symbols: returns {SYM: [bar...]}, merging pages. A request
  // rejected for its size (URL too long) is split in half and retried.
  async bars(symbols, {timeframe, start, end, adjustment = 'raw', feed = 'sip', asof} = {}) {
    const out = {};
    try {
      await this.pages('/v2/stocks/bars', {symbols: symbols.join(','), timeframe, start, end, adjustment, feed, limit: 10000, sort: 'asc', ...(asof ? {asof} : {})},
        page => { for (const [s, rows] of Object.entries(page.bars ?? {})) (out[s] ??= []).push(...(rows ?? [])); });
    } catch (error) {
      // Alpaca's asset list holds a few symbols its data API rejects
      // ("invalid symbol: X"); skip that one and carry on with the rest.
      const bad = error.status === 400 ? /invalid symbol: ?([A-Za-z0-9.\-\/]+)/.exec(error.message)?.[1] : null;
      if (bad && symbols.includes(bad)) {
        this.skipped.add(bad);
        return this.bars(symbols.filter(s => s !== bad), {timeframe, start, end, adjustment, feed, asof});
      }
      if (!([400, 413, 414, 431].includes(error.status) && symbols.length > 25)) throw error;
      this.log(`splitting a ${symbols.length}-symbol request after HTTP ${error.status}`);
      const half = Math.ceil(symbols.length / 2), options = {timeframe, start, end, adjustment, feed, asof};
      return {...await this.bars(symbols.slice(0, half), options), ...await this.bars(symbols.slice(half), options)};
    }
    return out;
  }
  async news({start, end, symbols}) {
    const out = [];
    await this.pages('/v1beta1/news', {start, end, sort: 'asc', limit: 50, ...(symbols ? {symbols: symbols.join(',')} : {})},
      page => out.push(...(page.news ?? [])));
    return out;
  }
  // The prevailing NBBO at `at` (ISO): the last two-sided quote at or before it.
  async quoteAt(symbol, at, {lookbackMs = 10 * 60_000, feed = 'sip', asof} = {}) {
    const ms = RealDate.parse(at), end = new RealDate(ms).toISOString(), start = new RealDate(ms - lookbackMs).toISOString();
    const page = await this.data('/v2/stocks/quotes', {symbols: symbol, start, end, limit: 10, sort: 'desc', feed, ...(asof ? {asof} : {})});
    const rows = page.quotes?.[symbol] ?? [];
    return rows.find(q => Number(q.bp) > 0 && Number(q.ap) >= Number(q.bp)) ?? null;
  }
  calendar(start, end) { return this.trading('/v2/calendar', {start, end}); }
  assets(status) { return this.trading('/v2/assets', {status, asset_class: 'us_equity'}); }
}

const backoff = attempt => Math.min(60_000, 2000 * 2 ** attempt);
function query(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
}
// Never print long symbol lists or tokens in logs.
const redact = url => String(url).replace(/symbols=[^&]{40,}/, 'symbols=…').replace(/page_token=[^&]+/, 'page_token=…');
