// All-day watcher: on each cron pass during the session it analyses every
// watchlist symbol, stores a snapshot and records alerts when something
// changes (VWAP/MACD flips, RSI extremes, volume spikes, price levels).
// A chat can then read the day back with get_intraday_log / get_alerts.

import { Alpaca, RANGES, trimToSessions, type AlpacaEnv, type Bar, type FetchLike } from './alpaca.ts';
import { analyze, priceDigits, type Analysis, type WatchState } from './analyze.ts';
import { etParts, inSession } from './time.ts';

export const MAX_WATCH = 20;
export type WatchEnv = AlpacaEnv & { DB: D1Database; ALERT_WEBHOOK_URL?: string; WATCH_EXTENDED_HOURS?: string };
export type WatchRow = { symbol: string; note: string | null; alert_above: number | null; alert_below: number | null; added_at: string };
type Prev = { symbol: string; price: number; session_date: string; signals: string; state: string };

export async function listWatch(db: D1Database) {
  return (await db.prepare('SELECT * FROM watchlist ORDER BY symbol').all<WatchRow>()).results ?? [];
}

export async function addWatch(db: D1Database, symbol: string, note: string | null, above: number | null, below: number | null) {
  const existing = await db.prepare('SELECT symbol FROM watchlist WHERE symbol=?').bind(symbol).first();
  if (!existing) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM watchlist').first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_WATCH) throw new Error(`WATCHLIST_FULL`);
  }
  await db.prepare(`INSERT INTO watchlist(symbol,note,alert_above,alert_below,added_at) VALUES(?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET note=COALESCE(excluded.note,watchlist.note),
      alert_above=excluded.alert_above, alert_below=excluded.alert_below`)
    .bind(symbol, note, above, below, new Date().toISOString()).run();
}

export async function removeWatch(db: D1Database, symbol: string) {
  const r = await db.prepare('DELETE FROM watchlist WHERE symbol=?').bind(symbol).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function intradayLog(db: D1Database, symbol: string, date: string) {
  const snaps = (await db.prepare(`SELECT at,price,change_pct,vwap,rsi,trend,signals FROM snapshots
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

// Changes between the previous snapshot and now that deserve an alert.
export function detectEvents(a: Analysis, watch: WatchRow, prev: { price: number; state: WatchState; signals: string[] } | null) {
  const out: { kind: string; message: string }[] = [];
  const price = a.price!, d = priceDigits(price), p = prev?.state;
  const crossedUp = (x: number) => (prev ? prev.price < x : true) && price >= x;
  const crossedDown = (x: number) => (prev ? prev.price > x : true) && price <= x;
  if (watch.alert_above != null && crossedUp(watch.alert_above))
    out.push({ kind: 'price_above', message: `${a.symbol} traded at/above ${watch.alert_above} (now ${price.toFixed(d)})` });
  if (watch.alert_below != null && crossedDown(watch.alert_below))
    out.push({ kind: 'price_below', message: `${a.symbol} traded at/below ${watch.alert_below} (now ${price.toFixed(d)})` });
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
  const extended = env.WATCH_EXTENDED_HOURS === 'true';
  if (!inSession(now, extended)) return { ran: false, reason: 'market closed' };
  const watch = await listWatch(env.DB);
  if (!watch.length) return { ran: false, reason: 'watchlist empty' };

  const client = new Alpaca(env, fetcher);
  const symbols = watch.map(w => w.symbol);
  const today = etParts(now).date;
  const [intraday, daily] = await Promise.all([
    client.bars(symbols, '5Min', new Date(now.getTime() - 86_400_000)),
    client.bars(symbols, '1Day', new Date(now.getTime() - 10 * 86_400_000)),
  ]);

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
    const prev = prevRow ? {
      price: prevRow.price,
      // Indicator states only compare within one session.
      state: prevRow.session_date === today ? JSON.parse(prevRow.state) as WatchState : ({} as WatchState),
      signals: prevRow.session_date === today ? (JSON.parse(prevRow.signals) as { key: string }[]).map(s => s.key) : [],
    } : null;
    for (const e of detectEvents(a, w, prev)) {
      statements.push(env.DB.prepare('INSERT INTO alerts(symbol,at,session_date,kind,message) VALUES(?,?,?,?,?)')
        .bind(w.symbol, at, today, e.kind, e.message));
      fired.push(e.message);
    }
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(
      w.symbol, at, today, a.price, a.change_pct, a.indicators.vwap, a.indicators.rsi14, a.trend,
      JSON.stringify(a.signals), JSON.stringify(a.state)));
  }
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  statements.push(env.DB.prepare('DELETE FROM snapshots WHERE at<?').bind(cutoff));
  statements.push(env.DB.prepare('DELETE FROM alerts WHERE at<?').bind(cutoff));
  await env.DB.batch(statements);

  if (fired.length && env.ALERT_WEBHOOK_URL) {
    // Discord-compatible body; most chat webhooks accept {content}.
    await fetcher(env.ALERT_WEBHOOK_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: fired.join('\n').slice(0, 1900) }),
    }).catch(() => undefined);
  }
  return { ran: true, symbols: symbols.length, alerts: fired.length, requests: client.requests };
}

export function prevClose(daily: Bar[], today: string) {
  const before = daily.filter(b => etParts(b.t).date < today);
  return before.length ? before[before.length - 1].c : null;
}
