// Remote MCP server (Streamable HTTP, stateless JSON responses) exposing the
// stock tools to Claude. Add the /mcp/<token> URL as a custom connector.
// Every tool is read-only towards the broker: only Alpaca market data is
// read. The watchlist tools write to this server's own database.

import { Alpaca, UserError, loadBars, normalizeSymbol, prevClose, rangeKey, RANGES, sessionOf, type FetchLike, type RangeKey } from './alpaca.ts';
import { analyze, summarize, priceDigits, brief, table } from './analyze.ts';
import { renderChart } from './chart.ts';
import { base64 } from './png.ts';
import { etParts } from './time.ts';
import { addWatch, intradayLog, listWatch, parseLevels, recentAlerts, removeWatch, watchLevels, MAX_WATCH, type WatchEnv } from './watch.ts';

export const SERVER_INFO = { name: 'stock-chart', version: '0.2.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Read-only stock analysis and charting for US equities (Alpaca market data, split-adjusted, times US/Eastern).
- Every result states the data feed (SIP = all exchanges; IEX = one exchange, volume/VWAP understated), any delay, and the as-of time. Repeat these when you report numbers.
- analyze_stock returns a text read-out, a PNG chart, and a JSON block with candles and per-bar indicators (each bar labelled pre / regular / post). Use the JSON for exact numbers; the read-out is descriptive, not advice.
- For "keep an eye on X", call watch_stock with the price levels/zones that matter. A server-side job snapshots each watched symbol every 5 minutes (premarket through after-hours) and logs level crossings, level tests, VWAP/MACD flips, RSI extremes and volume spikes. Recap with get_intraday_log or get_alerts.
- Chart links in results are view-only and safe to share.`;

const RANGE_ENUM = Object.keys(RANGES);
const symbolProp = { type: 'string', description: 'US stock ticker, e.g. AAPL' };
export const TOOLS = [
  {
    name: 'get_quote',
    title: 'Get quote',
    description: 'Latest price, bid/ask, day range, volume and change vs the previous (split-adjusted) close, with feed and as-of time. Includes a JSON block.',
    inputSchema: { type: 'object', properties: { symbol: symbolProp }, required: ['symbol'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'analyze_stock',
    title: 'Analyze and chart a stock',
    description: 'Technical analysis of a US stock: trend, EMA 9/21, SMA 20/50, regular-session VWAP, RSI 14, MACD, Bollinger bands, ATR, relative volume, volume by session, support/resistance and notable signals. Returns a read-out, a PNG chart (premarket/after-hours shaded) and JSON with every candle, its session label and indicator values. Ranges: 1d (5-min bars), 5d (15-min), 1mo (hourly), 3mo/6mo/1y (daily), 5y (weekly).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: symbolProp,
        range: { type: 'string', enum: RANGE_ENUM, default: '1d' },
        extended_hours: { type: 'boolean', default: true, description: 'Include premarket (4:00) and after-hours (to 20:00) bars for intraday ranges' },
        chart: { type: 'boolean', default: true, description: 'Attach a PNG chart' },
        include_data: { type: 'boolean', default: true, description: 'Attach the JSON block with candles and per-bar indicators' },
      },
      required: ['symbol'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'watch_stock',
    title: 'Watch a stock through the day',
    description: `Add or update a watchlist symbol. Every 5 minutes from premarket to the end of after-hours, the server analyses it, logs a snapshot and records alerts: crossings and tests of your price levels and zones, VWAP reclaim/loss, MACD flips, RSI overbought/oversold, volume spikes and Bollinger squeezes. Passing levels replaces the stored ones; omit to keep them. Max ${MAX_WATCH} symbols.`,
    inputSchema: {
      type: 'object',
      properties: {
        symbol: symbolProp,
        note: { type: 'string', description: 'Why it is being watched' },
        levels: {
          type: 'array', items: { type: 'string' },
          description: 'Price levels ("1.44") and zones ("1.58-1.65") to alert on, e.g. ["0.96","1.44","1.58-1.65","1.85-1.95","2.18"]',
        },
      },
      required: ['symbol'],
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: 'unwatch_stock',
    title: 'Stop watching a stock',
    description: 'Remove a symbol from the watchlist. Its history stays available for 30 days.',
    inputSchema: { type: 'object', properties: { symbol: symbolProp }, required: ['symbol'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'list_watchlist',
    title: 'List watchlist',
    description: 'Symbols being watched, with notes, levels and their latest snapshot.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_intraday_log',
    title: 'Intraday log',
    description: 'The watcher’s timeline for one symbol on one day: price, change, VWAP, RSI, trend, session (pre/regular/post), position vs each level, and signals at each 5-minute snapshot, plus alerts. Includes a JSON block.',
    inputSchema: {
      type: 'object',
      properties: { symbol: symbolProp, date: { type: 'string', description: 'YYYY-MM-DD (US/Eastern). Defaults to today.' } },
      required: ['symbol'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_alerts',
    title: 'Recent alerts',
    description: 'Alerts recorded by the watcher, newest first. Includes a JSON block.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'number', default: 24, description: 'Look back this many hours' }, symbol: symbolProp },
    },
    annotations: { readOnlyHint: true },
  },
];

export type McpEnv = WatchEnv & { MCP_TOKEN?: string };
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type Ctx = { env: McpEnv; origin: string; fetcher: FetchLike; now: Date; chartToken: string };

export async function handleMcp(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  let body: any;
  try { body = await req.json(); } catch { return rpcResponse(rpcError(null, -32700, 'Parse error')); }
  const batch = Array.isArray(body), messages: any[] = batch ? body : [body];
  const replies = (await Promise.all(messages.map(m => dispatch(m, ctx)))).filter(r => r !== null);
  if (!replies.length) return new Response(null, { status: 202 });
  return rpcResponse(batch ? replies : replies[0]);
}

function rpcResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function dispatch(msg: any, ctx: Ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
  if (!('id' in msg)) return null; // notification
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name, args = msg.params?.arguments ?? {};
      if (!TOOLS.some(t => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        return ok({ content: await callTool(name, args, ctx) });
      } catch (e) {
        const text = e instanceof UserError ? e.message
          : e instanceof Error && e.message === 'WATCHLIST_FULL' ? `Watchlist is full (${MAX_WATCH}); remove a symbol first.`
          : `Tool failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'}`;
        return ok({ content: [{ type: 'text', text }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const etStamp = (t: string) => { const p = etParts(t); return `${p.date} ${p.hhmm} ET`; };
const json = (label: string, data: unknown): Content => ({ type: 'text', text: `${label} (JSON):\n${JSON.stringify(data)}` });

export async function callTool(name: string, args: any, ctx: Ctx): Promise<Content[]> {
  const { env } = ctx;
  switch (name) {
    case 'get_quote': return quoteTool(new Alpaca(env, ctx.fetcher), normalizeSymbol(args.symbol), ctx.now);
    case 'analyze_stock': return analyzeTool(args, ctx);
    case 'watch_stock': {
      const symbol = normalizeSymbol(args.symbol);
      const legacy = [args.alert_above, args.alert_below].filter(v => v != null && v !== '');
      const levels = args.levels != null || legacy.length ? parseLevels([...(args.levels == null ? [] : Array.isArray(args.levels) ? args.levels : [args.levels]), ...legacy]) : null;
      await addWatch(env.DB, symbol, args.note ? String(args.note).slice(0, 300) : null, levels);
      const row = (await listWatch(env.DB)).find(w => w.symbol === symbol)!;
      const stored = watchLevels(row);
      const lv = stored.map(l => l.label).join(', ');
      return [
        { type: 'text', text: `Watching ${symbol}. The server checks it every 5 minutes from premarket (4:00 ET) to the end of after-hours (20:00 ET), on the data feed's clock${stored.length ? `, and logs crossings and tests of ${lv}` : ''}. Ask for get_intraday_log or get_alerts any time.` },
        json('watch', { symbol, note: row.note, levels: stored }),
      ];
    }
    case 'unwatch_stock': {
      const symbol = normalizeSymbol(args.symbol);
      const removed = await removeWatch(env.DB, symbol);
      return [{ type: 'text', text: removed ? `Stopped watching ${symbol}.` : `${symbol} was not on the watchlist.` }];
    }
    case 'list_watchlist': {
      const rows = await listWatch(env.DB);
      if (!rows.length) return [{ type: 'text', text: 'The watchlist is empty. Use watch_stock to add a symbol.' }, json('watchlist', [])];
      const latest = (await env.DB.prepare(`SELECT s.symbol,s.at,s.price,s.change_pct,s.rsi,s.trend,s.session,s.feed FROM snapshots s
        JOIN (SELECT symbol, MAX(at) AS at FROM snapshots GROUP BY symbol) m ON m.symbol=s.symbol AND m.at=s.at`).all<any>()).results ?? [];
      const by = new Map(latest.map(r => [r.symbol, r]));
      const data = rows.map(w => ({ symbol: w.symbol, note: w.note, levels: watchLevels(w).map(l => l.label), latest: by.get(w.symbol) ?? null }));
      const lines = data.map(w => {
        const s = w.latest;
        const snap = s ? `last ${s.price} (${s.change_pct >= 0 ? '+' : ''}${s.change_pct}%) RSI ${s.rsi ?? 'n/a'}, ${s.trend}, ${s.session} session, snapshot ${etStamp(s.at)} · ${s.feed ?? 'feed n/a'}` : 'no snapshot yet';
        return `• ${w.symbol}${w.note ? ` — ${w.note}` : ''}${w.levels.length ? ` [levels ${w.levels.join(', ')}]` : ''}\n    ${snap}`;
      });
      return [{ type: 'text', text: lines.join('\n') }, json('watchlist', data)];
    }
    case 'get_intraday_log': {
      const symbol = normalizeSymbol(args.symbol);
      const date = args.date ? String(args.date) : etParts(new Alpaca(env, ctx.fetcher).dataEnd(ctx.now)).date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('date must be YYYY-MM-DD');
      const { snaps, alerts } = await intradayLog(env.DB, symbol, date);
      if (!snaps.length) return [{ type: 'text', text: `No snapshots for ${symbol} on ${date}. Is it on the watchlist (watch_stock), and was the market open?` }];
      const rows = snaps.map((s: any) => {
        const st = JSON.parse(s.state ?? '{}');
        return { at_et: etStamp(s.at), last_bar_et: st.last_bar_t ? etStamp(st.last_bar_t) : null, session: s.session, price: s.price, change_pct: s.change_pct,
          vwap: s.vwap, rsi: s.rsi, trend: s.trend, levels: st.level_positions ?? {}, signals: (JSON.parse(s.signals) as { key: string }[]).map(x => x.key) };
      });
      const first = rows[0], lastS = rows[rows.length - 1];
      const lines = [
        `${symbol} watcher log for ${date}: ${rows.length} snapshots, ${first.at_et} to ${lastS.at_et}`,
        `Data: ${snaps[snaps.length - 1].feed ?? 'feed not recorded'}. "bar" is the time of the latest bar seen.`,
        `Latest ${lastS.price} (${lastS.change_pct}% vs prev close), ${lastS.session} session`,
        '',
        'bar    sess  price     chg%    vwap      rsi   trend              levels / signals',
        ...thin(rows, 80).map(r => [
          (r.last_bar_et ?? r.at_et).slice(11, 16), String(r.session ?? '').padEnd(5), String(r.price).padEnd(9), String(r.change_pct ?? '').padEnd(7),
          String(r.vwap ?? '').padEnd(9), String(r.rsi ?? '').padEnd(5), String(r.trend ?? '').padEnd(18),
          [Object.entries(r.levels).map(([k, v]) => `${k}:${v}`).join(' '), r.signals.join(',')].filter(Boolean).join(' | '),
        ].join(' ')),
        '',
        `Alerts (${alerts.length})`,
        ...(alerts.length ? alerts.map((a: any) => `  ${etParts(a.at).hhmm} ${a.message}`) : ['  none']),
      ];
      return [{ type: 'text', text: lines.join('\n') }, json('log', { symbol, date, feed: snaps[snaps.length - 1].feed, snapshots: rows, alerts })];
    }
    case 'get_alerts': {
      const hours = Math.min(Math.max(Number(args.hours) || 24, 1), 24 * 30);
      const symbol = args.symbol ? normalizeSymbol(args.symbol) : undefined;
      const rows = await recentAlerts(env.DB, new Date(ctx.now.getTime() - hours * 3_600_000).toISOString(), symbol);
      const text = rows.length ? rows.map((a: any) => `${etStamp(a.at)}  ${a.message}`).join('\n') : `No alerts in the last ${hours}h${symbol ? ` for ${symbol}` : ''}.`;
      return [{ type: 'text', text }, json('alerts', rows.map((a: any) => ({ ...a, at_et: etStamp(a.at) })))];
    }
  }
  throw new UserError(`Unknown tool ${name}`);
}

// Keep long logs readable: at most `max` evenly spaced rows, always the last.
function thin<T>(rows: T[], max: number) {
  if (rows.length <= max) return rows;
  const every = Math.ceil(rows.length / max);
  return rows.filter((_, i) => i % every === 0 || i === rows.length - 1);
}

async function quoteTool(client: Alpaca, symbol: string, now: Date): Promise<Content[]> {
  // Previous close always comes from split-adjusted daily bars.
  const daily = (await client.bars([symbol], '1Day', new Date(now.getTime() - 12 * 86_400_000), now))[symbol] ?? [];
  let snap = await client.snapshot(symbol).catch(() => null);
  let price: number | null = null, at: string | null = null, source = '';
  if (snap?.latestTrade) { price = snap.latestTrade.p; at = snap.latestTrade.t; source = 'latest trade'; }
  if (price == null) {
    // No snapshot on this plan/feed: use the last one-minute bar instead.
    const mins = (await client.bars([symbol], '1Min', new Date(now.getTime() - 4 * 86_400_000), now))[symbol] ?? [];
    const last = mins[mins.length - 1];
    if (last) { price = last.c; at = last.t; source = 'last 1-minute bar close'; }
    snap = null;
  }
  if (price == null || at == null) throw new UserError(`No recent trades for ${symbol}`);
  const date = etParts(at).date, prev = prevClose(daily, date);
  const today = daily.filter(b => etParts(b.t).date === date).pop() ?? null;
  const d = priceDigits(price), chg = prev != null ? price - prev : null;
  const feed = client.feedInfo();
  const session = sessionOf(at, RANGES['1d']);
  const data = {
    symbol, price, as_of_utc: at, as_of_et: etStamp(at), session, source, feed,
    prev_close: prev, change: chg != null ? Number(chg.toFixed(d)) : null, change_pct: chg != null && prev ? Number(((chg / prev) * 100).toFixed(2)) : null,
    bid: snap?.latestQuote?.bp ?? null, ask: snap?.latestQuote?.ap ?? null,
    day: today ? { open: today.o, high: today.h, low: today.l, volume: today.v } : null,
  };
  const text = [
    `${symbol} ${price.toFixed(d)}${chg != null ? `  ${chg >= 0 ? '+' : ''}${chg.toFixed(d)} (${data.change_pct}%) vs prev close ${prev!.toFixed(d)}` : ''}`,
    `As of ${data.as_of_et} (${session === 'regular' ? 'regular session' : session === 'pre' ? 'premarket' : 'after-hours'}), ${source}`,
    data.bid != null ? `Bid ${data.bid} / Ask ${data.ask}` : '',
    data.day ? `Day: open ${data.day.open}, high ${data.day.high}, low ${data.day.low}, volume ${data.day.volume.toLocaleString('en-US')}` : '',
    `Data: ${feed.label}${feed.fallback_reason ? ` (${feed.fallback_reason})` : ''}`,
  ].filter(Boolean).join('\n');
  return [{ type: 'text', text }, json('quote', data)];
}

export async function buildAnalysis(client: Alpaca, symbol: string, range: RangeKey, extended: boolean, now: Date) {
  const bars = await loadBars(client, symbol, range, extended, now);
  if (bars.length < 2) throw new UserError(`No ${range} price data for ${symbol} (unknown ticker, or no trades on the ${client.feed.toUpperCase()} feed).`);
  let prev: number | null = null;
  if (range === '1d') {
    const daily = (await client.bars([symbol], '1Day', new Date(now.getTime() - 12 * 86_400_000), now))[symbol] ?? [];
    prev = prevClose(daily, etParts(bars[bars.length - 1].t).date);
  }
  return { bars, analysis: analyze(symbol, range, bars, { prevClose: prev }), feed: client.feedInfo() };
}

async function analyzeTool(args: any, ctx: Ctx): Promise<Content[]> {
  const symbol = normalizeSymbol(args.symbol), range = rangeKey(args.range), extended = args.extended_hours !== false;
  const client = new Alpaca(ctx.env, ctx.fetcher);
  const { bars, analysis, feed } = await buildAnalysis(client, symbol, range, extended, ctx.now);
  const live = `${ctx.origin}/chart/${ctx.chartToken}/${symbol}?range=${range}${extended ? '' : '&ext=0'}`;
  const asOf = etStamp(bars[bars.length - 1].t);
  const header = `Data: ${feed.label}${feed.fallback_reason ? ` (${feed.fallback_reason})` : ''}. Prices split-adjusted. Latest bar ${asOf} (${analysis.last_bar_session}).`;
  const out: Content[] = [{ type: 'text', text: `${header}\n\n${summarize(analysis)}\n\nLive chart (view-only link, refreshes every minute): ${live}` }];
  if (args.chart !== false) out.push({ type: 'image', mimeType: 'image/png', data: base64(await renderChart(analysis, bars, feed.short)) });
  if (args.include_data !== false && args.include_bars !== false)
    out.push(json('analysis', { feed, adjustment: 'split', as_of_et: asOf, extended_hours: extended, ...brief(analysis), bars: table(analysis, bars) }));
  return out;
}
