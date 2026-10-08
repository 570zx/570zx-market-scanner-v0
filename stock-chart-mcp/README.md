# Stock chart MCP

A Cloudflare Worker that gives a Claude chat stock analysis and charts, on
demand and all day long. It is a remote **MCP server**: add its URL to Claude
as a custom connector, then ask things like:

- "Chart SRXH for today, including premarket and after-hours."
- "Show me TSLA over 6 months."
- "Watch SRXH today: levels 0.96, 1.44, 1.58–1.65, 1.85–1.95, 2.18."
- "How did SRXH trade since this morning? Did it hold the 1.58 zone?"

The analysis is descriptive, not trading advice.

## Data you can trust (and how it's labelled)

- **Feed:** SIP, the consolidated tape from every US exchange. On a thin
  stock, the IEX-only feed misses most trades and understates volume and
  VWAP. Alpaca's free plan serves SIP history up to 15 minutes ago, so by
  default every request stops 16 minutes before now
  (`ALPACA_SIP_DELAY_MINUTES=15`; set `0` on a paid real-time SIP plan). Quotes use
  Alpaca's `delayed_sip` snapshot. If Alpaca refuses SIP, the server falls
  back to IEX and says so.
- **Every response states:** the feed used, the delay, the time of the latest
  bar in ET, and that prices are split-adjusted. The chart image prints the
  feed too.
- **Split adjustment:** all bars are requested with `adjustment=split`. The
  previous close for "% change" comes from adjusted daily bars, not from the
  unadjusted snapshot.
- **Sessions:** intraday bars include premarket (4:00) and after-hours (to
  20:00) by default. Every bar is labelled `pre`, `regular` or `post`, and
  extended-hours stretches are shaded on charts. VWAP uses the regular
  session only. Relative volume compares a bar with earlier bars of the same
  session type, so a quiet after-hours bar isn't measured against the open.
  The read-out lists the latest day's volume by session.

## Tools

| Tool | What it does |
| --- | --- |
| `analyze_stock` | Ranges `1d` (5-min), `5d` (15-min), `1mo` (hourly), `3mo`/`6mo`/`1y` (daily), `5y` (weekly). Returns:<br>• a read-out: trend, EMA 9/21, SMA 20/50, VWAP, RSI 14, MACD, Bollinger 20,2, ATR, relative volume, volume by session, support/resistance, signals<br>• a **PNG chart**<br>• a **JSON block** with every candle (UTC and ET time, session label, OHLCV) and each bar's indicator values<br>• a view-only **live chart link** |
| `get_quote` | Last price with its as-of time and session, bid/ask, day range and change vs the adjusted previous close. Includes JSON. |
| `watch_stock` | Add or update a watched symbol with `levels`: single prices (`"1.44"`) and zones (`"1.58-1.65"`). Max 20 symbols, 20 levels each. |
| `unwatch_stock` / `list_watchlist` | Manage and review the watchlist. |
| `get_intraday_log` | The watcher's 5-minute timeline for a symbol and day, plus alerts. Each row has price, change, VWAP, RSI, trend, session, signals, and the price's position vs each level. Includes JSON. |
| `get_alerts` | Recent watcher alerts. Includes JSON. |

### The scheduled watcher

Every 5 minutes, a cron job analyses each watched symbol, stores a snapshot
and records alerts. It runs from 4:00 to 20:00 ET (`WATCH_EXTENDED_HOURS=false`
limits it to 9:30–16:00). Times are measured on the data clock, so with a
15-minute delay the last after-hours pass is at about 20:15 wall time.

Alerts are recorded for:

- **Levels:** crossing a level; entering a zone, breaking out above it or
  breaking down below it; jumping or falling through a zone between
  snapshots. Also *tests*: an intrabar high or low that reached a level or
  zone while price ended back on the same side. Each alert is tagged
  `[premarket]` or `[after-hours]` when that is when it happened.
- **Indicators:** VWAP reclaim/loss, MACD crossing its signal line, RSI
  entering overbought/oversold, volume spikes, Bollinger squeezes.

Alerts also go to `ALERT_WEBHOOK_URL` when it is set (Discord-style
`{content}`, with a delayed-data note). History is kept for 30 days.

To watch SRXH with the levels from the briefing, ask Claude, or call:

```json
{"name": "watch_stock", "arguments": {"symbol": "SRXH", "note": "briefing levels",
 "levels": ["0.96", "1.44", "1.58-1.65", "1.85-1.95", "2.18"]}}
```

## Security: read-only, authenticated

- **Market data only.** The server only sends `GET` requests to
  `https://data.alpaca.markets/v2/stocks/...`. There is no code for
  Alpaca's trading API (accounts, orders, positions), and the client refuses
  any other path. Tests check every outgoing request. Use API keys from an
  Alpaca **paper** account so that, even if the keys leaked, they could not
  touch real money.
- **Connector authentication.** Every route except `/health` returns 404
  without a valid token.
  - `MCP_TOKEN` (24+ characters) grants the tools. Claude's custom-connector
    dialog has no field for headers, so for claude.ai the token goes in the
    URL path: `/mcp/<MCP_TOKEN>`. Other MCP clients can send
    `Authorization: Bearer <MCP_TOKEN>` to `/mcp` instead.
  - Chart links in tool results use a separate **view-only** token, derived
    from `MCP_TOKEN` with HMAC. A shared chart link can only show charts; it
    cannot call tools or change the watchlist. The connector token never
    appears in tool output.
  - Treat the connector URL like a password. To revoke access, change
    `MCP_TOKEN`; that also invalidates old chart links.

## Set up

1. **Alpaca keys.** Create keys on a paper-trading account (free).
2. **Deploy.** Either run **Actions → Stock chart MCP deploy** (it uses the
   same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets as
   MEDS deploy), or deploy locally:
   ```bash
   cd stock-chart-mcp && npm ci && npm run deploy
   ```
   The deploy creates the `stock-chart-mcp` D1 database if needed and applies
   all migrations.
3. **Runtime secrets.** Set these in Cloudflare (Worker → Settings → Variables
   and Secrets) or with `npx wrangler secret put NAME`:
   - `ALPACA_API_KEY`, `ALPACA_API_SECRET`
   - `MCP_TOKEN`: e.g. `openssl rand -hex 24`
   - `ALERT_WEBHOOK_URL` (optional)

   The deploy workflow copies `ALPACA_API_KEY`, `ALPACA_API_SECRET`,
   `STOCK_MCP_TOKEN` (as `MCP_TOKEN`) and `STOCK_ALERT_WEBHOOK_URL` from
   repository secrets when they exist.
4. **Check.** `GET https://stock-chart-mcp.<subdomain>.workers.dev/health`
   should show `alpaca`, `mcp_token` and `db` as `true`, with `feed: "sip"`.
5. **Connect Claude.** In claude.ai, go to **Settings → Connectors → Add
   custom connector** and paste
   `https://stock-chart-mcp.<subdomain>.workers.dev/mcp/<MCP_TOKEN>`. Enable it
   in a chat from the tools menu.

## Develop

```bash
npm ci
npm run check         # TypeScript
npm test              # indicators, sessions, feed/delay, levels, auth, MCP, watcher
npm run sample-chart  # writes sample-1d.png / sample-5d.png from synthetic data
npm run dev           # wrangler dev; put secrets in .dev.vars
```

Tests run against a fake Alpaca (`tests/fakes.mjs`) and SQLite standing in
for D1. The chart PNG comes from a small built-in raster and a 4-bit PNG
encoder (`src/png.ts`), so the Worker has no runtime dependencies. The live
page loads Lightweight Charts 4.2.0 from unpkg.

## Limits

- On the free plan, "now" is 15 minutes ago. Alerts arrive 15–20 minutes
  after the move.
- Exchange holidays and early closes are not modelled. On those days the
  watcher just finds no new bars.
- Charting takes about 6–7 ms of CPU (measured locally with 78–320 bars,
  including extended hours). That fits the Free plan's 10 ms per-request
  limit with little room to spare. If `analyze_stock` hits CPU-limit errors,
  pass `chart: false` (the JSON and live link still work) or use Workers Paid.
- Each watcher pass makes two Alpaca requests, whatever the watchlist size.
