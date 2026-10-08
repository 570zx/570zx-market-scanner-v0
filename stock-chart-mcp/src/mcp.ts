// Remote MCP server (Streamable HTTP, stateless JSON responses) exposing the
// stock tools to Claude. Add the /mcp/<token> URL as a custom connector.

import { Alpaca, UserError, loadBars, normalizeSymbol, rangeKey, RANGES, type Bar, type FetchLike, type RangeKey } from './alpaca.ts';
import { analyze, summarize, priceDigits } from './analyze.ts';
import { renderChart } from './chart.ts';
import { base64 } from './png.ts';
import { etParts } from './time.ts';
import { addWatch, intradayLog, listWatch, recentAlerts, removeWatch, MAX_WATCH, type WatchEnv } from './watch.ts';

export const SERVER_INFO = { name: 'stock-chart', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Stock analysis and charting for US equities (Alpaca data, times in US/Eastern).
- analyze_stock returns indicators, support/resistance, signals and a chart image. Show the user the chart and explain the read-out in plain language; it is descriptive, not advice.
- For "keep an eye on X today", call watch_stock. A server-side watcher snapshots every watched symbol every 5 minutes during market hours and records alerts. Later, call get_intraday_log or get_alerts to recap what happened.
- Each analyze_stock result includes a live chart link that refreshes every minute; share it when the user wants to follow along.`;

const RANGE_ENUM = Object.keys(RANGES);
const symbolProp = { type: 'string', description: 'US stock ticker, e.g. AAPL' };
export const TOOLS = [
  {
    name: 'get_quote',
    title: 'Get quote',
    description: 'Latest price, bid/ask, day range, volume and change vs previous close for a US stock.',
    inputSchema: { type: 'object', properties: { symbol: symbolProp }, required: ['symbol'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'analyze_stock',
    title: 'Analyze and chart a stock',
    description: 'Technical analysis of a US stock with a chart image: trend, EMA 9/21, SMA 20/50, VWAP (intraday), RSI 14, MACD, Bollinger bands, ATR, relative volume, support/resistance and notable signals. Ranges: 1d (5-min bars), 5d (15-min), 1mo (hourly), 3mo/6mo/1y (daily), 5y (weekly).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: symbolProp,
        range: { type: 'string', enum: RANGE_ENUM, default: '1d' },
        extended_hours: { type: 'boolean', default: false, description: 'Include pre/after-market bars for intraday ranges' },
        chart: { type: 'boolean', default: true, description: 'Attach a PNG chart' },
        include_bars: { type: 'boolean', default: false, description: 'Also return the OHLCV bars as CSV (e.g. to build an interactive chart)' },
      },
      required: ['symbol'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'watch_stock',
    title: 'Watch a stock through the day',
    description: `Add (or update) a symbol on the watchlist. During market hours the server analyses it every 5 minutes, logs snapshots and records alerts (VWAP reclaim/loss, MACD flips, RSI overbought/oversold, volume spikes, Bollinger squeezes, and optional price levels). Max ${MAX_WATCH} symbols.`,
    inputSchema: {
      type: 'object',
      properties: {
        symbol: symbolProp,
        note: { type: 'string', description: 'Why it is being watched' },
        alert_above: { type: 'number', description: 'Alert when price trades at or above this' },
        alert_below: { type: 'number', description: 'Alert when price trades at or below this' },
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
    description: 'Symbols being watched, with notes, price alert levels and their latest snapshot.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_intraday_log',
    title: 'Intraday log',
    description: 'The watcher’s timeline for one symbol on one day: price, change, VWAP, RSI, trend and signals at each 5-minute snapshot, plus alerts. Use it to recap how a watched stock behaved through the day.',
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
    description: 'Alerts recorded by the watcher, newest first.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'number', default: 24, description: 'Look back this many hours' }, symbol: symbolProp },
    },
    annotations: { readOnlyHint: true },
  },
];

export type McpEnv = WatchEnv & { MCP_TOKEN?: string };
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Ctx = { env: McpEnv; origin: string; fetcher: FetchLike; now: Date };

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
  const isNotification = !('id' in msg);
  if (isNotification) return null;
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

const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : (() => { throw new UserError(`"${v}" is not a number`); })());

export async function callTool(name: string, args: any, ctx: Ctx): Promise<Content[]> {
  const { env } = ctx;
  switch (name) {
    case 'get_quote': return [{ type: 'text', text: await quoteText(new Alpaca(env, ctx.fetcher), normalizeSymbol(args.symbol)) }];
    case 'analyze_stock': return analyzeTool(args, ctx);
    case 'watch_stock': {
      const symbol = normalizeSymbol(args.symbol);
      const above = num(args.alert_above), below = num(args.alert_below);
      await addWatch(env.DB, symbol, args.note ? String(args.note).slice(0, 300) : null, above, below);
      const levels = [above != null && `above ${above}`, below != null && `below ${below}`].filter(Boolean).join(' / ');
      return [{ type: 'text', text: `Watching ${symbol}. The server checks it every 5 minutes during market hours (9:30–16:00 ET)${levels ? ` and will alert ${levels}` : ''}. Ask for get_intraday_log or get_alerts any time for a recap.` }];
    }
    case 'unwatch_stock': {
      const symbol = normalizeSymbol(args.symbol);
      return [{ type: 'text', text: (await removeWatch(env.DB, symbol)) ? `Stopped watching ${symbol}.` : `${symbol} was not on the watchlist.` }];
    }
    case 'list_watchlist': {
      const rows = await listWatch(env.DB);
      if (!rows.length) return [{ type: 'text', text: 'The watchlist is empty. Use watch_stock to add a symbol.' }];
      const latest = (await env.DB.prepare(`SELECT s.symbol,s.at,s.price,s.change_pct,s.rsi,s.trend FROM snapshots s
        JOIN (SELECT symbol, MAX(at) AS at FROM snapshots GROUP BY symbol) m ON m.symbol=s.symbol AND m.at=s.at`).all<any>()).results ?? [];
      const by = new Map(latest.map(r => [r.symbol, r]));
      const lines = rows.map(w => {
        const s = by.get(w.symbol);
        const lv = [w.alert_above != null && `alert ≥ ${w.alert_above}`, w.alert_below != null && `alert ≤ ${w.alert_below}`].filter(Boolean).join(', ');
        const snap = s ? `last ${s.price} (${s.change_pct >= 0 ? '+' : ''}${s.change_pct}%) RSI ${s.rsi ?? 'n/a'}, ${s.trend} @ ${etParts(s.at).hhmm} ET ${etParts(s.at).date}` : 'no snapshot yet';
        return `• ${w.symbol}${w.note ? ` — ${w.note}` : ''}${lv ? ` [${lv}]` : ''}\n    ${snap}`;
      });
      return [{ type: 'text', text: lines.join('\n') }];
    }
    case 'get_intraday_log': {
      const symbol = normalizeSymbol(args.symbol);
      const date = args.date ? String(args.date) : etParts(ctx.now).date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('date must be YYYY-MM-DD');
      const { snaps, alerts } = await intradayLog(env.DB, symbol, date);
      if (!snaps.length) return [{ type: 'text', text: `No snapshots for ${symbol} on ${date}. Is it on the watchlist (watch_stock), and was the market open?` }];
      const first = snaps[0], lastS = snaps[snaps.length - 1];
      const lines = [
        `${symbol} watcher log for ${date} (${snaps.length} snapshots, ${etParts(first.at).hhmm}–${etParts(lastS.at).hhmm} ET)`,
        `Range of snapshot prices: ${Math.min(...snaps.map((s: any) => s.price))} – ${Math.max(...snaps.map((s: any) => s.price))}; latest ${lastS.price} (${lastS.change_pct}% vs prev close)`,
        '',
        'time   price      chg%    vwap      rsi   trend              signals',
        ...thin(snaps, 80).map((s: any) => [
          etParts(s.at).hhmm, String(s.price).padEnd(10), String(s.change_pct ?? '').padEnd(7), String(s.vwap ?? '').padEnd(9),
          String(s.rsi ?? '').padEnd(5), String(s.trend ?? '').padEnd(18), (JSON.parse(s.signals) as { key: string }[]).map(x => x.key).join(','),
        ].join(' ')),
        '',
        `Alerts (${alerts.length})`,
        ...(alerts.length ? alerts.map((a: any) => `  ${etParts(a.at).hhmm} ${a.message}`) : ['  none']),
      ];
      return [{ type: 'text', text: lines.join('\n') }];
    }
    case 'get_alerts': {
      const hours = Math.min(Math.max(num(args.hours) ?? 24, 1), 24 * 30);
      const symbol = args.symbol ? normalizeSymbol(args.symbol) : undefined;
      const rows = await recentAlerts(env.DB, new Date(ctx.now.getTime() - hours * 3_600_000).toISOString(), symbol);
      if (!rows.length) return [{ type: 'text', text: `No alerts in the last ${hours}h${symbol ? ` for ${symbol}` : ''}.` }];
      return [{ type: 'text', text: rows.map((a: any) => `${etParts(a.at).date} ${etParts(a.at).hhmm} ET  ${a.message}`).join('\n') }];
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

async function quoteText(client: Alpaca, symbol: string) {
  const s = await client.snapshot(symbol);
  const price = s.latestTrade?.p ?? s.dailyBar?.c;
  if (price == null) throw new UserError(`No recent trades for ${symbol}`);
  const d = priceDigits(price), prev = s.prevDailyBar?.c;
  const chg = prev ? price - prev : null;
  return [
    `${symbol} ${price.toFixed(d)}${chg != null ? `  ${chg >= 0 ? '+' : ''}${chg.toFixed(d)} (${((chg / prev!) * 100).toFixed(2)}%) vs prev close ${prev!.toFixed(d)}` : ''}`,
    s.latestQuote ? `Bid ${s.latestQuote.bp} / Ask ${s.latestQuote.ap}` : '',
    s.dailyBar ? `Day: open ${s.dailyBar.o}, high ${s.dailyBar.h}, low ${s.dailyBar.l}, volume ${s.dailyBar.v.toLocaleString('en-US')} (${client.feed.toUpperCase()} feed)` : '',
    s.latestTrade ? `Last trade ${etParts(s.latestTrade.t).date} ${etParts(s.latestTrade.t).hhmm} ET` : '',
  ].filter(Boolean).join('\n');
}

export async function buildAnalysis(client: Alpaca, symbol: string, range: RangeKey, extended: boolean, now: Date) {
  const bars = await loadBars(client, symbol, range, extended, now);
  if (bars.length < 2) throw new UserError(`No ${range} price data for ${symbol} (unknown ticker, or not traded on the ${client.feed.toUpperCase()} feed).`);
  let prevClose: number | null = null;
  if (range === '1d') {
    const snap = await client.snapshot(symbol).catch(() => null);
    const sessionDate = etParts(bars[bars.length - 1].t).date;
    if (snap?.dailyBar && snap.prevDailyBar && etParts(snap.dailyBar.t).date === sessionDate) prevClose = snap.prevDailyBar.c;
  }
  return { bars, analysis: analyze(symbol, range, bars, { prevClose }) };
}

async function analyzeTool(args: any, ctx: Ctx): Promise<Content[]> {
  const symbol = normalizeSymbol(args.symbol), range = rangeKey(args.range), extended = args.extended_hours === true;
  const client = new Alpaca(ctx.env, ctx.fetcher);
  const { bars, analysis } = await buildAnalysis(client, symbol, range, extended, ctx.now);
  const live = `${ctx.origin}/chart/${ctx.env.MCP_TOKEN}/${symbol}?range=${range}${extended ? '&ext=1' : ''}`;
  const out: Content[] = [{ type: 'text', text: `${summarize(analysis)}\n\nLive chart (auto-refreshes every minute): ${live}` }];
  if (args.chart !== false) out.push({ type: 'image', mimeType: 'image/png', data: base64(await renderChart(analysis, bars)) });
  if (args.include_bars === true) out.push({ type: 'text', text: toCsv(bars) });
  return out;
}

function toCsv(bars: Bar[]) {
  return ['time_utc,open,high,low,close,volume', ...bars.map(b => `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}`)].join('\n');
}
