// Alpaca market data (free "Basic" plan works; feed defaults to IEX).

import { etParts, REGULAR_OPEN, REGULAR_CLOSE, EXTENDED_OPEN, EXTENDED_CLOSE } from './time.ts';

export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number };
export type AlpacaEnv = { ALPACA_API_KEY?: string; ALPACA_API_SECRET?: string; ALPACA_FEED?: string };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE = 'https://data.alpaca.markets';
const MAX_PAGES = 6;

export const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
export function normalizeSymbol(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/^\$/, '');
  if (!SYMBOL_RE.test(s)) throw new UserError(`"${String(raw)}" is not a valid US stock ticker`);
  return s;
}

// Errors whose message is safe and useful to show the chat.
export class UserError extends Error {}

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

export class Alpaca {
  requests = 0;
  private env: AlpacaEnv;
  private fetcher: FetchLike;
  constructor(env: AlpacaEnv, fetcher: FetchLike = fetch) {
    this.env = env; this.fetcher = fetcher;
    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw new UserError('Server is missing ALPACA_API_KEY / ALPACA_API_SECRET');
  }
  get feed() { return this.env.ALPACA_FEED || 'iex'; }

  async json(path: string, params: Record<string, string>): Promise<any> {
    this.requests++;
    const res = await this.fetcher(`${BASE}${path}?${new URLSearchParams(params)}`, {
      headers: { 'APCA-API-KEY-ID': this.env.ALPACA_API_KEY!, 'APCA-API-SECRET-KEY': this.env.ALPACA_API_SECRET! },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 422) throw new UserError(`Alpaca rejected the request (${res.status}); check the ticker`);
    if (!res.ok) throw new Error(`ALPACA_HTTP_${res.status}`);
    return res.json();
  }

  // Bars for several symbols in one paged request stream.
  async bars(symbols: string[], timeframe: string, start: Date): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = {};
    let page: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const params: Record<string, string> = {
        symbols: symbols.join(','), timeframe, start: start.toISOString(),
        limit: '10000', feed: this.feed, adjustment: 'split', sort: 'asc',
      };
      if (page) params.page_token = page;
      const data = await this.json('/v2/stocks/bars', params);
      for (const [sym, list] of Object.entries<Bar[]>(data.bars ?? {})) (out[sym] ??= []).push(...list);
      page = data.next_page_token || undefined;
      if (!page) break;
    }
    return out;
  }

  async snapshot(symbol: string): Promise<Snapshot> {
    return this.json(`/v2/stocks/${encodeURIComponent(symbol)}/snapshot`, { feed: this.feed });
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

export async function loadBars(client: Alpaca, symbol: string, range: RangeKey, extended = false, now = new Date()) {
  const spec = RANGES[range];
  const start = new Date(now.getTime() - spec.lookbackDays * 86_400_000);
  const raw = (await client.bars([symbol], spec.timeframe, start))[symbol] ?? [];
  return trimToSessions(raw, spec, extended);
}
