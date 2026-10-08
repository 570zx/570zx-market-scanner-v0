// stock-chart-mcp Worker.
//   POST /mcp/<MCP_TOKEN>                       MCP endpoint (add to Claude as a custom connector)
//   POST /mcp  + Authorization: Bearer <MCP_TOKEN>   same, for clients that send headers
//   GET  /chart/<CHART_TOKEN>/<SYMBOL>?range=   live chart page (view-only token)
//   GET  /api/<CHART_TOKEN>/analysis/<SYMBOL>   JSON used by the live page
//   GET  /api/<CHART_TOKEN>/chart/<SYMBOL>.png  static chart image
//   GET  /health
// Anything without a valid token gets 404. Cron (every 5 min): the watcher.

import { Alpaca, UserError, defaultFetch, normalizeSymbol, rangeKey, type FetchLike } from './alpaca.ts';
import { brief, table } from './analyze.ts';
import { chartToken, chartTokenOk, mcpTokenOk, MIN_TOKEN_LENGTH } from './auth.ts';
import { renderChart } from './chart.ts';
import { buildAnalysis, handleMcp, SERVER_INFO, type McpEnv } from './mcp.ts';
import { livePage } from './page.ts';
import { runWatch } from './watch.ts';

export type Env = McpEnv;
const notFound = () => new Response('Not found', { status: 404 });

export async function handle(req: Request, env: Env, fetcher: FetchLike = defaultFetch, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  const [area, token, ...rest] = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/health') {
    return Response.json({
      ok: true, server: SERVER_INFO,
      configured: {
        alpaca: !!(env.ALPACA_API_KEY && env.ALPACA_API_SECRET), mcp_token: (env.MCP_TOKEN ?? '').length >= MIN_TOKEN_LENGTH, db: !!env.DB,
        feed: (env.ALPACA_FEED || 'sip').toLowerCase(), sip_delay_minutes: Number(env.ALPACA_SIP_DELAY_MINUTES ?? 15),
      },
    });
  }

  if (area === 'mcp') {
    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const given = rest.length === 0 && token ? token : !token ? bearer : undefined;
    if (!mcpTokenOk(env, given)) return notFound();
    return handleMcp(req, { env, origin: url.origin, fetcher, now, chartToken: await chartToken(env) });
  }

  if (area !== 'chart' && area !== 'api') return notFound();
  if (!(await chartTokenOk(env, token))) return notFound();
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const extended = url.searchParams.get('ext') !== '0';
  try {
    if (area === 'chart' && rest.length === 1) {
      const symbol = normalizeSymbol(rest[0]), range = rangeKey(url.searchParams.get('range') ?? '1d');
      return new Response(livePage(symbol, range, extended), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      });
    }
    if (area === 'api' && rest[0] === 'analysis' && rest.length === 2) {
      const symbol = normalizeSymbol(rest[1]), range = rangeKey(url.searchParams.get('range') ?? '1d');
      const { bars, analysis, feed } = await buildAnalysis(new Alpaca(env, fetcher), symbol, range, extended, now);
      const s = analysis.series;
      return Response.json({
        feed, analysis: brief(analysis), table: table(analysis, bars),
        bars: bars.map((b, i) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, session: analysis.sessions[i] })),
        series: { vwap: s.vwap, ema21: s.ema21, bb_upper: s.bb.upper, bb_lower: s.bb.lower, rsi: s.rsi },
      }, { headers: { 'cache-control': 'no-store' } });
    }
    if (area === 'api' && rest[0] === 'chart' && rest.length === 2 && rest[1].endsWith('.png')) {
      const symbol = normalizeSymbol(rest[1].slice(0, -4)), range = rangeKey(url.searchParams.get('range') ?? '1d');
      const { bars, analysis, feed } = await buildAnalysis(new Alpaca(env, fetcher), symbol, range, extended, now);
      return new Response(await renderChart(analysis, bars, feed.short), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    }
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: 'upstream failure' }, { status: 502 });
  }
  return notFound();
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWatch(env).then(r => console.log('watch', JSON.stringify(r))));
  },
};
