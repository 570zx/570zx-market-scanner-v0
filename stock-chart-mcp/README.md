# Stock chart MCP

A Cloudflare Worker that gives a Claude chat live stock analysis and charts,
on demand and all day long. It is a remote **MCP server**: add its URL to
Claude as a custom connector, then ask things like:

- "Chart NVDA for today and tell me what the indicators say."
- "Show me TSLA over 6 months."
- "Watch AMD today and alert me above 180 or below 165."
- "How did AMD trade since this morning? Anything notable?"

Data comes from Alpaca's free market-data plan (IEX feed by default). Times are
US/Eastern. The analysis is descriptive, not trading advice.

## What Claude gets

| Tool | What it does |
| --- | --- |
| `analyze_stock` | Bars for `1d` (5-min), `5d` (15-min), `1mo` (hourly), `3mo`/`6mo`/`1y` (daily) or `5y` (weekly), plus trend, EMA 9/21, SMA 20/50, VWAP, RSI 14, MACD, Bollinger 20,2, ATR, relative volume, support/resistance and notable signals. Returns a **PNG chart** and a **live chart link**. `include_bars: true` also returns OHLCV as CSV, for example so Claude can build an interactive artifact. |
| `get_quote` | Last price, bid/ask, day range, volume, change vs previous close. |
| `watch_stock` / `unwatch_stock` / `list_watchlist` | Manage the all-day watchlist (max 20), with optional `alert_above` / `alert_below` levels. |
| `get_intraday_log` | The watcher's 5-minute timeline for a symbol and day, plus alerts. Use it for "what happened today". |
| `get_alerts` | Recent watcher alerts across the watchlist. |

### Continuous monitoring

A Claude chat only runs when someone sends it a message, so the "all day" part
runs on the server. Every 5 minutes during the regular session (9:30–16:00 ET;
4:00–20:00 with `WATCH_EXTENDED_HOURS=true`) a cron job analyses each watched
symbol, stores a snapshot in D1 and records alerts when something changes:

- price crossed an `alert_above` / `alert_below` level
- price reclaimed or lost VWAP
- RSI entered overbought (≥70) or oversold (≤30)
- MACD crossed its signal line
- volume spike (≥2× recent average) or Bollinger squeeze started

Alerts are also posted to `ALERT_WEBHOOK_URL` when it is set (Discord-style
`{content}` body), so you are notified without opening the chat. Afterwards,
ask Claude for a recap and it reads the log back. History is kept for 30 days.

### Live chart page

Every `analyze_stock` result links to
`/chart/<MCP_TOKEN>/<SYMBOL>?range=1d`. The page shows candles, VWAP, EMA 21,
Bollinger bands, support/resistance lines, volume and RSI. It refreshes every
minute, follows light/dark mode, and works on a phone.

## Set up

1. **Alpaca keys.** Create a free Alpaca account (paper trading is enough) and
   generate API keys.
2. **Deploy.** Either run **Actions → Stock chart MCP deploy** (it uses the
   same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets as
   MEDS deploy), or deploy locally:
   ```bash
   cd stock-chart-mcp && npm ci && npm run deploy
   ```
   The first deploy creates the `stock-chart-mcp` D1 database and applies the
   schema.
3. **Runtime secrets.** Set these in Cloudflare (Worker → Settings → Variables
   and Secrets) or with `npx wrangler secret put NAME`:
   - `ALPACA_API_KEY`, `ALPACA_API_SECRET`
   - `MCP_TOKEN`: at least 24 random characters, e.g. `openssl rand -hex 24`.
     It is part of the connector URL; anyone with the URL can use the tools.
   - `ALERT_WEBHOOK_URL` (optional)

   The deploy workflow copies `ALPACA_API_KEY`, `ALPACA_API_SECRET`,
   `STOCK_MCP_TOKEN` and `STOCK_ALERT_WEBHOOK_URL` from repository secrets
   when they exist.
4. **Check.** `GET https://stock-chart-mcp.<your-subdomain>.workers.dev/health`
   should report `alpaca`, `mcp_token` and `db` as `true`.
5. **Connect Claude.** In claude.ai go to **Settings → Connectors → Add custom
   connector** and paste:
   ```
   https://stock-chart-mcp.<your-subdomain>.workers.dev/mcp/<MCP_TOKEN>
   ```
   Then enable it in a chat (the tools menu) and ask away.

## Develop

```bash
npm ci
npm run check         # TypeScript
npm test              # indicators, chart PNG, MCP protocol, watcher (fake Alpaca + SQLite D1)
npm run sample-chart  # writes sample-1d.png / sample-5d.png from synthetic data
npm run dev           # wrangler dev; put secrets in .dev.vars
```

The chart PNG is drawn by a small built-in raster and PNG encoder
(`src/png.ts`), so the Worker has no runtime dependencies. The live page loads
Lightweight Charts 4.2.0 from unpkg.

## Limits

- The IEX feed covers a few percent of consolidated volume, so volume and
  VWAP are IEX-only. Prices track the market closely. Set `ALPACA_FEED=sip`
  if your Alpaca plan includes SIP.
- Exchange holidays and early closes are not modelled. On those days the
  watcher finds no new bars.
- Rendering a chart takes about 6–7 ms of CPU (measured locally with
  78–252 bars), which fits the Free plan's 10 ms per-request limit with
  little room to spare. If `analyze_stock` calls start failing with CPU-limit
  errors, pass `chart: false` (the live link still works) or move to Workers Paid.
- On the Cloudflare Free plan, each watcher pass uses two Alpaca requests in
  total, whatever the watchlist size. Watchlist size is capped at 20.
