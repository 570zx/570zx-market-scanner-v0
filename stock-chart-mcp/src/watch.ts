// All-day watcher: on each cron pass it analyses every watchlist symbol,
// stores a snapshot and records alerts when something changes: price
// levels/zones crossed or tested, VWAP/MACD flips, RSI extremes, volume
// spikes. A chat reads the day back with get_intraday_log / get_alerts.
//
// With delayed SIP data the watcher runs on the data's clock (now minus the
// delay), so it keeps going until the delayed after-hours session ends.

import { Alpaca, RANGES, UserError, prevClose, trimToSessions, type AlpacaEnv, type Bar, type FetchLike } from './alpaca.ts';
import { analyze, priceDigits, type Analysis, type WatchState } from './analyze.ts';
import { etParts, inSession } from './time.ts';

export const MAX_WATCH = 20;
export const MAX_LEVELS = 20;
export type WatchEnv = AlpacaEnv & { DB: D1Database; ALERT_WEBHOOK_URL?: string; WATCH_EXTENDED_HOURS?: string };
export type Level = { low: number; high: number; label: string };
export type WatchRow = { symbol: string; note: string | null; alert_above: number | null; alert_below: number | null; added_at: string; levels: string | null };
export type StoredState = WatchState & { last_bar_t?: string; level_positions?: Record<string, Position> };
type Position = 'below' | 'inside' | 'above';
type Prev = { symbol: string; price: number; session_date: string; signals: string; state: string };

// "0.96", 1.44, "1.58-1.65", "$1.85 – $1.95", or a comma-separated string.
export function parseLevels(input: unknown): Level[] {
  if (input == null || input === '') return [];
  const items = Array.isArray(input) ? input : String(input).split(/[,;]/);
  const out: Level[] = [];
  for (const raw of items) {
    const text = String(raw).trim();
    if (!text) continue;
    const nums = text.replace(/\$/g, '').split(/\s*(?:-|–|—|to)\s*/).map(Number);
    if (nums.length > 2 || nums.some(n => !Number.isFinite(n) || n <= 0)) throw new UserError(`Can't read level "${text}"; use 1.44 or 1.58-1.65`);
    const [low, high] = nums.length === 2 ? [Math.min(...nums), Math.max(...nums)] : [nums[0], nums[0]];
    out.push({ low, high, label: low === high ? `$${low}` : `$${low}–$${high}` });
  }
  if (out.length > MAX_LEVELS) throw new UserError(`At most ${MAX_LEVELS} levels per symbol`);
  return out.sort((a, b) => a.low - b.low);
}

export function watchLevels(w: WatchRow): Level[] {
  const levels: Level[] = w.levels ? JSON.parse(w.levels) : [];
  if (w.alert_above != null) levels.push({ low: w.alert_above, high: w.alert_above, label: `$${w.alert_above}` });
  if (w.alert_below != null) levels.push({ low: w.alert_below, high: w.alert_below, label: `$${w.alert_below}` });
  const seen = new Set<string>();
  return levels.filter(l => !seen.has(l.label) && seen.add(l.label)).sort((a, b) => a.low - b.low);
}

export function positionOf(l: Level, price: number): Position {
  if (l.low === l.high) return price >= l.low ? 'above' : 'below';
  return price < l.low ? 'below' : price > l.high ? 'above' : 'inside';
}

// Crossings since the previous snapshot (close to close), plus tests seen
// only in intrabar highs/lows of the new bars.
export function levelEvents(symbol: string, levels: Level[], prevPrice: number | null, price: number, newBars: Bar[], sessionTag: string) {
  const out: { kind: string; message: string }[] = [];
  if (prevPrice == null) return out;
  const d = priceDigits(price), now = price.toFixed(d), tag = sessionTag ? ` [${sessionTag}]` : '';
  const hi = newBars.length ? Math.max(...newBars.map(b => b.h)) : price;
  const lo = newBars.length ? Math.min(...newBars.map(b => b.l)) : price;
  for (const l of levels) {
    const before = positionOf(l, prevPrice), after = positionOf(l, price), zone = l.low !== l.high;
    const name = zone ? `the ${l.label} zone` : l.label;
    if (before !== after) {
      const what = !zone ? `crossed ${after} ${name}`
        : before === 'below' && after === 'inside' ? `entered ${name} from below`
        : before === 'above' && after === 'inside' ? `dropped into ${name} from above`
        : after === 'above' ? (before === 'inside' ? `broke out above ${name}` : `jumped through ${name}, now above`)
        : (before === 'inside' ? `broke down below ${name}` : `fell through ${name}, now below`);
      out.push({ kind: after === 'above' || (after === 'inside' && before === 'below') ? 'level_cross_up' : 'level_cross_down',
        message: `${symbol} ${what} at ${now}${tag}` });
    } else if (before === 'below' && hi >= l.low) {
      out.push({ kind: 'level_test', message: `${symbol} tested ${name} (high ${hi.toFixed(d)}) but is back below at ${now}${tag}` });
    } else if (before === 'above' && (zone ? lo <= l.high : lo < l.low)) {
      out.push({ kind: 'level_test', message: `${symbol} dipped to ${name} (low ${lo.toFixed(d)}) but is back above at ${now}${tag}` });
    }
  }
  return out;
}

export async function listWatch(db: D1Database) {
  return (await db.prepare('SELECT * FROM watchlist ORDER BY symbol').all<WatchRow>()).results ?? [];
}

export async function addWatch(db: D1Database, symbol: string, note: string | null, levels: Level[] | null) {
  const existing = await db.prepare('SELECT symbol FROM watchlist WHERE symbol=?').bind(symbol).first();
  if (!existing) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM watchlist').first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_WATCH) throw new Error(`WATCHLIST_FULL`);
  }
  // levels === null keeps the stored levels; [] clears them.
  await db.prepare(`INSERT INTO watchlist(symbol,note,alert_above,alert_below,added_at,levels) VALUES(?,?,NULL,NULL,?,?)
    ON CONFLICT(symbol) DO UPDATE SET note=COALESCE(excluded.note,watchlist.note),
      levels=COALESCE(excluded.levels,watchlist.levels), alert_above=NULL, alert_below=NULL`)
    .bind(symbol, note, new Date().toISOString(), levels ? JSON.stringify(levels) : null).run();
}

export async function removeWatch(db: D1Database, symbol: string) {
  const r = await db.prepare('DELETE FROM watchlist WHERE symbol=?').bind(symbol).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function intradayLog(db: D1Database, symbol: string, date: string) {
  const snaps = (await db.prepare(`SELECT at,price,change_pct,vwap,rsi,trend,session,feed,signals,state FROM snapshots
    WHERE symbol=? AND session_date=? ORDER BY at`).bind(symbol, date).all<any>()).results ?? [];
  const alerts = (await db.prepare(`SELECT at,kind,message FROM alerts WHERE symbol=? AND session_date=? ORDER BY at`)
    .bind(symbol, date).all<any>()).results ?? [];
  return { snaps, alerts };
}

export async function recentAlerts(db: D1Database, sinceIso: string, symbol?: string) {
  const q = symbol
    ? db.prepare('SELECT symbol,at,kind,message FROM alerts WHERE at>=? AND symbol=? ORDER BY at DESC LIMIT 200').bind(sinceIso, symbol)
    : db.prepare('SELECT symbol,at,kind,message FROM alerts WHERE at>=? ORDER BY at DESC LIMIT 200').bind(sinceIso);
  return (await q.all<any>()).results ?? [];
}

// Indicator state changes between the previous snapshot and now.
export function detectEvents(a: Analysis, prev: { state: WatchState; signals: string[] } | null) {
  const out: { kind: string; message: string }[] = [];
  const price = a.price!, d = priceDigits(price), p = prev?.state;
  const s = a.state;
  if (p && p.above_vwap != null && s.above_vwap != null && p.above_vwap !== s.above_vwap)
    out.push({ kind: s.above_vwap ? 'vwap_reclaim' : 'vwap_loss', message: `${a.symbol} moved ${s.above_vwap ? 'above' : 'below'} VWAP ${a.indicators.vwap} at ${price.toFixed(d)}` });
  if (s.rsi_zone && s.rsi_zone !== 'neutral' && p?.rsi_zone !== s.rsi_zone)
    out.push({ kind: `rsi_${s.rsi_zone}`, message: `${a.symbol} RSI ${a.indicators.rsi14} is ${s.rsi_zone}` });
  if (p && p.macd_side && s.macd_side && p.macd_side !== s.macd_side)
    out.push({ kind: `macd_${s.macd_side}`, message: `${a.symbol} MACD turned ${s.macd_side === 'bull' ? 'bullish (above signal)' : 'bearish (below signal)'}` });
  const keys = new Set(prev?.signals ?? []);
  for (const sig of a.signals)
    if ((sig.key === 'volume_spike' || sig.key === 'bb_squeeze') && !keys.has(sig.key))
      out.push({ kind: sig.key, message: `${a.symbol}: ${sig.text}` });
  return out;
}

export async function runWatch(env: WatchEnv, now = new Date(), fetcher: FetchLike = fetch) {
  const extended = env.WATCH_EXTENDED_HOURS !== 'false';
  const client = new Alpaca(env, fetcher);
  const dataNow = client.dataEnd(now);
  if (!inSession(dataNow, extended)) return { ran: false, reason: 'market closed' };
  const watch = await listWatch(env.DB);
  if (!watch.length) return { ran: false, reason: 'watchlist empty' };

  const symbols = watch.map(w => w.symbol);
  const today = etParts(dataNow).date;
  const intraday = await client.bars(symbols, '5Min', new Date(now.getTime() - 86_400_000), now);
  const daily = await client.bars(symbols, '1Day', new Date(now.getTime() - 10 * 86_400_000), now);
  const feed = client.feedInfo();

  const prevRows = (await env.DB.prepare(`SELECT s.symbol,s.price,s.session_date,s.signals,s.state FROM snapshots s
    JOIN (SELECT symbol, MAX(at) AS at FROM snapshots GROUP BY symbol) m ON m.symbol=s.symbol AND m.at=s.at`).all<Prev>()).results ?? [];
  const prevBy = new Map(prevRows.map(r => [r.symbol, r]));

  const statements: D1PreparedStatement[] = [], fired: string[] = [], at = now.toISOString();
  for (const w of watch) {
    const bars = trimToSessions(intraday[w.symbol] ?? [], RANGES['1d'], extended)
      .filter(b => etParts(b.t).date === today);
    if (bars.length < 2) continue;
    const a = analyze(w.symbol, '1d', bars, { prevClose: prevClose(daily[w.symbol] ?? [], today) });
    const prevRow = prevBy.get(w.symbol);
    const prevState: StoredState | null = prevRow ? JSON.parse(prevRow.state) : null;
    const sameDay = prevRow?.session_date === today;
    const prev = prevRow ? {
      // Indicator states only compare within one session.
      state: sameDay ? prevState! : ({} as WatchState),
      signals: sameDay ? (JSON.parse(prevRow.signals) as { key: string }[]).map(s => s.key) : [],
    } : null;
    const lastT = sameDay ? prevState?.last_bar_t : undefined;
    const newBars = bars.filter(b => !lastT || b.t > lastT);
    const sessionTag = a.last_bar_session === 'regular' ? '' : a.last_bar_session === 'pre' ? 'premarket' : 'after-hours';
    const levels = watchLevels(w);
    const events = [
      ...levelEvents(w.symbol, levels, prevRow?.price ?? null, a.price!, newBars, sessionTag),
      ...detectEvents(a, prev),
    ];
    for (const e of events) {
      statements.push(env.DB.prepare('INSERT INTO alerts(symbol,at,session_date,kind,message) VALUES(?,?,?,?,?)')
        .bind(w.symbol, at, today, e.kind, e.message));
      fired.push(e.message);
    }
    const state: StoredState = {
      ...a.state, last_bar_t: bars[bars.length - 1].t,
      level_positions: Object.fromEntries(levels.map(l => [l.label, positionOf(l, a.price!)])),
    };
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO snapshots(symbol,at,session_date,price,change_pct,vwap,rsi,trend,signals,state,session,feed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      w.symbol, at, today, a.price, a.change_pct, a.indicators.vwap, a.indicators.rsi14, a.trend,
      JSON.stringify(a.signals), JSON.stringify(state), a.last_bar_session, feed.label));
  }
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  statements.push(env.DB.prepare('DELETE FROM snapshots WHERE at<?').bind(cutoff));
  statements.push(env.DB.prepare('DELETE FROM alerts WHERE at<?').bind(cutoff));
  await env.DB.batch(statements);

  if (fired.length && env.ALERT_WEBHOOK_URL) {
    // Discord-compatible body; most chat webhooks accept {content}.
    const note = feed.delay_minutes ? `\n(data delayed ${feed.delay_minutes} min, ${feed.used.toUpperCase()})` : '';
    await fetcher(env.ALERT_WEBHOOK_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: (fired.join('\n').slice(0, 1800) + note) }),
    }).catch(() => undefined);
  }
  return { ran: true, symbols: symbols.length, alerts: fired.length, requests: client.requests, feed: feed.used };
}
