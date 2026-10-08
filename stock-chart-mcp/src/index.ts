// stock-chart-mcp Worker.
//   POST /mcp/<MCP_TOKEN>                     MCP endpoint (add to Claude as a custom connector)
//   GET  /chart/<MCP_TOKEN>/<SYMBOL>?range=   live chart page, refreshes every minute
//   GET  /api/<MCP_TOKEN>/analysis/<SYMBOL>   JSON used by the live page
//   GET  /api/<MCP_TOKEN>/chart/<SYMBOL>.png  static chart image
//   GET  /health
// Cron (every 5 min): the watchlist watcher.

import { Alpaca, UserError, normalizeSymbol, rangeKey, type FetchLike } from './alpaca.ts';
import { brief } from './analyze.ts';
import { renderChart } from './chart.ts';
import { buildAnalysis, handleMcp, SERVER_INFO, type McpEnv } from './mcp.ts';
import { livePage } from './page.ts';
import { runWatch } from './watch.ts';

export type Env = McpEnv;

function tokenOk(env: Env, given: string) {
  const want = env.MCP_TOKEN ?? '';
  if (want.length < 24) return false;
  const a = new TextEncoder().encode(want), b = new TextEncoder().encode(given);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handle(req: Request, env: Env, fetcher: FetchLike = fetch, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/health') {
    return Response.json({
      ok: true, server: SERVER_INFO,
      configured: { alpaca: !!(env.ALPACA_API_KEY && env.ALPACA_API_SECRET), mcp_token: (env.MCP_TOKEN ?? '').length >= 24, db: !!env.DB },
    });
  }
  const [area, token, ...rest] = parts;
  if (!['mcp', 'chart', 'api'].includes(area ?? '')) return new Response('Not found', { status: 404 });
  if (!token || !tokenOk(env, token)) return new Response('Not found', { status: 404 });

  if (area === 'mcp' && rest.length === 0) return handleMcp(req, { env, origin: url.origin, fetcher, now });

  try {
    if (area === 'chart' && rest.length === 1 && req.method === 'GET') {
      const symbol = normalizeSymbol(rest[0]), range = rangeKey(url.searchParams.get('range') ?? '1d');
      return new Response(livePage(symbol, range, url.searchParams.get('ext') === '1'), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      });
    }
    if (area === 'api' && rest[0] === 'analysis' && rest.length === 2 && req.method === 'GET') {
      const symbol = normalizeSymbol(rest[1]), range = rangeKey(url.searchParams.get('range') ?? '1d');
      const { bars, analysis } = await buildAnalysis(new Alpaca(env, fetcher), symbol, range, url.searchParams.get('ext') === '1', now);
      const s = analysis.series;
      return Response.json({
        analysis: brief(analysis),
        bars: bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
        series: { vwap: s.vwap, ema21: s.ema21, bb_upper: s.bb.upper, bb_lower: s.bb.lower, rsi: s.rsi },
      }, { headers: { 'cache-control': 'no-store' } });
    }
    if (area === 'api' && rest[0] === 'chart' && rest.length === 2 && rest[1].endsWith('.png') && req.method === 'GET') {
      const symbol = normalizeSymbol(rest[1].slice(0, -4)), range = rangeKey(url.searchParams.get('range') ?? '1d');
      const { bars, analysis } = await buildAnalysis(new Alpaca(env, fetcher), symbol, range, url.searchParams.get('ext') === '1', now);
      return new Response(await renderChart(analysis, bars), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    }
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: 'upstream failure' }, { status: 502 });
  }
  return new Response('Not found', { status: 404 });
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWatch(env).then(r => console.log('watch', JSON.stringify(r))));
  },
};
