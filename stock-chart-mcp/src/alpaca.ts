// Alpaca market data, read-only.
//
// Feed: SIP (every US exchange) by default. Alpaca's free plan serves SIP
// history only up to 15 minutes ago, so requests are capped at
// now - ALPACA_SIP_DELAY_MINUTES (default 15; set 0 on a paid SIP plan).
// If SIP is refused, the client falls back to IEX and says so in feedInfo().
// Prices are always split-adjusted.

import { etParts, REGULAR_OPEN, REGULAR_CLOSE, EXTENDED_OPEN, EXTENDED_CLOSE } from './time.ts';

export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number };
export type AlpacaEnv = { ALPACA_API_KEY?: string; ALPACA_API_SECRET?: string; ALPACA_FEED?: string; ALPACA_SIP_DELAY_MINUTES?: string };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
// Workers throws "Illegal invocation" if the platform fetch is called with any
// `this` other than the global scope (e.g. as this.fetcher(...)), so the
// default always calls it as a plain function.
export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

// The only host this server talks to with the Alpaca keys. No trading API
// (api.alpaca.markets / paper-api.alpaca.markets) is ever called.
const DATA_HOST = 'https://data.alpaca.markets';
const MAX_PAGES = 6;

export const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
export function normalizeSymbol(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/^\$/, '');
  if (!SYMBOL_RE.test(s)) throw new UserError(`"${String(raw)}" is not a valid US stock ticker`);
  return s;
}

// Errors whose message is safe and useful to show the chat.
export class UserError extends Error {}
class FeedRefused extends Error {}

export type RangeKey = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y';
export type RangeSpec = { timeframe: string; barMinutes: number; lookbackDays: number; sessions?: number; intraday: boolean };
export const RANGES: Record<RangeKey, RangeSpec> = {
  '1d': { timeframe: '5Min', barMinutes: 5, lookbackDays: 6, sessions: 1, intraday: true },
  '5d': { timeframe: '15Min', barMinutes: 15, lookbackDays: 10, sessions: 5, intraday: true },
  '1mo': { timeframe: '1Hour', barMinutes: 60, lookbackDays: 31, intraday: true },
  '3mo': { timeframe: '1Day', barMinutes: 1440, lookbackDays: 92, intraday: false },
  '6mo': { timeframe: '1Day', barMinutes: 1440, lookbackDays: 183, intraday: false },
  '1y': { timeframe: '1Day', barMinutes: 1440, lookbackDays: 366, intraday: false },
  '5y': { timeframe: '1Week', barMinutes: 10080, lookbackDays: 1830, intraday: false },
};
export function rangeKey(raw: unknown): RangeKey {
  const k = String(raw ?? '1d').toLowerCase() as RangeKey;
  if (!(k in RANGES)) throw new UserError(`range must be one of ${Object.keys(RANGES).join(', ')}`);
  return k;
}

export type Session = 'pre' | 'regular' | 'post' | 'daily';
export function sessionOf(t: string, spec: RangeSpec): Session {
  if (!spec.intraday) return 'daily';
  const m = etParts(t).minutes;
  if (m + spec.barMinutes <= REGULAR_OPEN) return 'pre';
  if (m >= REGULAR_CLOSE) return 'post';
  return 'regular';
}

export type FeedInfo = { requested: string; used: string; delay_minutes: number; label: string; short: string; fallback_reason?: string };

export class Alpaca {
  requests = 0;
  readonly requested: string;
  readonly delayMinutes: number;
  used: string;
  fallbackReason?: string;
  private env: AlpacaEnv;
  private fetcher: FetchLike;
  constructor(env: AlpacaEnv, fetcher: FetchLike = defaultFetch) {
    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw new UserError('Server is missing ALPACA_API_KEY / ALPACA_API_SECRET');
    // Call through a closure so `this` is never this client, even for an
    // injected platform fetch.
    this.env = env; this.fetcher = (input, init) => fetcher(input, init);
    this.requested = (env.ALPACA_FEED || 'sip').toLowerCase();
    this.used = this.requested;
    const delay = Number(env.ALPACA_SIP_DELAY_MINUTES ?? 15);
    this.delayMinutes = Number.isFinite(delay) && delay > 0 ? delay : 0;
  }
  get feed() { return this.used; }
  // Data is complete up to this moment.
  dataEnd(now: Date) {
    return this.used === 'sip' && this.delayMinutes ? new Date(now.getTime() - (this.delayMinutes + 1) * 60_000) : now;
  }
  feedInfo(): FeedInfo {
    const delay = this.used === 'sip' ? this.delayMinutes : 0;
    const label = this.used === 'sip'
      ? `SIP (all US exchanges, full volume)${delay ? `, delayed ${delay} min` : ', real time'}`
      : `${this.used.toUpperCase()} only (one exchange: volume and VWAP understated, thin stocks show gaps), real time`;
    const short = `${this.used.toUpperCase()}${delay ? ` DELAYED ${delay} MIN` : ''}`;
    return { requested: this.requested, used: this.used, delay_minutes: delay, label, short, ...(this.fallbackReason ? { fallback_reason: this.fallbackReason } : {}) };
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    if (!path.startsWith('/v2/stocks/')) throw new Error('ALPACA_PATH_NOT_ALLOWED');
    this.requests++;
    const res = await this.fetcher(`${DATA_HOST}${path}?${new URLSearchParams(params)}`, {
      method: 'GET',
      headers: { 'APCA-API-KEY-ID': this.env.ALPACA_API_KEY!, 'APCA-API-SECRET-KEY': this.env.ALPACA_API_SECRET! },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403 && params.feed && params.feed !== 'iex') throw new FeedRefused(`${params.feed.toUpperCase()} refused (HTTP 403)`);
    if (res.status === 404 || res.status === 422) throw new UserError(`Alpaca rejected the request (${res.status}); check the ticker`);
    if (!res.ok) throw new Error(`ALPACA_HTTP_${res.status}`);
    return res.json();
  }

  // Bars for several symbols, split-adjusted, paged.
  async bars(symbols: string[], timeframe: string, start: Date, now = new Date()): Promise<Record<string, Bar[]>> {
    try {
      return await this.pagedBars(symbols, timeframe, start, now);
    } catch (e) {
      if (!(e instanceof FeedRefused) || this.used === 'iex') throw e;
      this.fallbackReason = `${e.message}; fell back to IEX. Check the Alpaca plan or ALPACA_SIP_DELAY_MINUTES.`;
      this.used = 'iex';
      return this.pagedBars(symbols, timeframe, start, now);
    }
  }

  private async pagedBars(symbols: string[], timeframe: string, start: Date, now: Date) {
    const out: Record<string, Bar[]> = {};
    let page: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const params: Record<string, string> = {
        symbols: symbols.join(','), timeframe, start: start.toISOString(), end: this.dataEnd(now).toISOString(),
        limit: '10000', feed: this.used, adjustment: 'split', sort: 'asc',
      };
      if (page) params.page_token = page;
      const data = await this.get('/v2/stocks/bars', params);
      for (const [sym, list] of Object.entries<Bar[]>(data.bars ?? {})) (out[sym] ??= []).push(...list);
      page = data.next_page_token || undefined;
      if (!page) break;
    }
    return out;
  }

  // Latest trade/quote. On delayed SIP this asks for Alpaca's delayed_sip feed.
  async snapshot(symbol: string): Promise<Snapshot> {
    const feed = this.used === 'sip' && this.delayMinutes ? 'delayed_sip' : this.used;
    return this.get(`/v2/stocks/${encodeURIComponent(symbol)}/snapshot`, { feed });
  }
}

export type Snapshot = {
  latestTrade?: { t: string; p: number };
  latestQuote?: { t: string; bp: number; ap: number };
  minuteBar?: Bar; dailyBar?: Bar; prevDailyBar?: Bar;
};

// Keep only bars inside the session window, then only the last N sessions.
export function trimToSessions(bars: Bar[], spec: RangeSpec, extended: boolean): Bar[] {
  if (!spec.intraday) return bars;
  const open = extended ? EXTENDED_OPEN : REGULAR_OPEN, close = extended ? EXTENDED_CLOSE : REGULAR_CLOSE;
  const kept = bars.filter(b => {
    const m = etParts(b.t).minutes;
    return m + spec.barMinutes > open && m < close;
  });
  if (!spec.sessions) return kept;
  const dates = [...new Set(kept.map(b => etParts(b.t).date))].slice(-spec.sessions);
  const allowed = new Set(dates);
  return kept.filter(b => allowed.has(etParts(b.t).date));
}

// Split-adjusted close of the last daily bar before `date` (YYYY-MM-DD ET).
export function prevClose(daily: Bar[], date: string) {
  const before = daily.filter(b => etParts(b.t).date < date);
  return before.length ? before[before.length - 1].c : null;
}

export async function loadBars(client: Alpaca, symbol: string, range: RangeKey, extended = false, now = new Date()) {
  const spec = RANGES[range];
  const start = new Date(now.getTime() - spec.lookbackDays * 86_400_000);
  const raw = (await client.bars([symbol], spec.timeframe, start, now))[symbol] ?? [];
  return trimToSessions(raw, spec, extended);
}
