# MEDS Scout Agent — v0.1

A low-cost / free-first market surveillance agent built specifically around the pattern we identified from MEDS-style moves:

**pressure building → catalyst → abnormal volume → tight execution → persistence → breakout/squeeze acceleration**

It is intentionally **pre-move first**. Top gainers are used as context, not as the core signal.

## What v0.1 does

- Runs every **1 minute** on Cloudflare Workers Cron.
- Uses Alpaca's market-data screeners for broad discovery, then IEX snapshots for the shortlist.
- Remembers the previous scan in Cloudflare D1.
- Scores **change**, not just absolute values: minute-volume acceleration, persistence across scans, spread quality, early-vs-extended state, prior-day volume comparison, fresh catalyst.
- Pulls recent news and optionally asks Cloudflare Workers AI to classify catalyst strength, dilution risk and squeeze relevance.
- Has an optional `BORROW_PROVIDER_URL` adapter. If no provider is connected, borrow fee / availability are left blank rather than fabricated.
- Sends high-score alerts to a webhook (Discord works out of the box).
- Includes a shadow position manager with the rule learned from FRGT: **start de-risking at +20%; keep a runner**.
- Defaults to `TRADING_MODE=shadow`. It does not place real trades.

## Free-first stack

1. **Cloudflare Workers Free** — one-minute cron is supported.
2. **Cloudflare D1 Free** — state/history storage.
3. **Cloudflare Workers AI free daily allocation** — only used on already-qualified candidates.
4. **Alpaca Basic market data** — free account/API keys. Free equities data is IEX rather than full SIP for latest snapshots, while Alpaca's screener endpoints provide broad discovery.
5. **FINRA / SEC public data** can be added as secondary inputs in the next version.
6. **Discord webhook** — free alerts.

## Cost governor / self-funding rule

Do **not** turn on a paid data source just because it exists.

Suggested unlock rule:

- Cloudflare Paid ($5/mo): unlock only after trailing-30-day realized strategy P&L > **$15**.
- Full-market Alpaca Algo Trader Plus ($99/mo): unlock only after trailing-30-day realized strategy P&L > **$300** *and* the shadow/paper log shows the paid feed would have improved entries/exits.
- Any paid borrow/short-data provider: require trailing-30-day realized P&L > **3× its monthly fee** before enabling it.

The agent should therefore earn the right to increase its own operating cost.

## Important limitation

A reliable, real-time **borrow fee + shares-available** feed is the hardest part to get free. v0.1 exposes a provider adapter instead of scraping random websites or mislabeling daily short-sale volume as short interest. FINRA itself warns that daily short-sale volume is not the same thing as short interest.

The right path is:

- use free official short-interest / short-sale information as supporting context;
- use market/catalyst behavior as the main live ignition signal;
- add a real borrow provider only when the strategy has proven it can pay for it.

## Deploy from Cloudflare

### 1) Create free accounts

- Cloudflare
- Alpaca (paper trading is enough to obtain API keys)

Never paste API keys into a chat. Store them as Cloudflare secrets.

### 2) Create the D1 database

```bash
npx wrangler d1 create meds-scout
```

Copy the returned database id into `wrangler.toml`.

### 3) Install + apply migration

```bash
npm install
npx wrangler d1 migrations apply MEDS_DB --remote
```

### 4) Add secrets

```bash
npx wrangler secret put ALPACA_API_KEY
npx wrangler secret put ALPACA_API_SECRET
npx wrangler secret put ALERT_WEBHOOK_URL
```

Optional later:

```bash
npx wrangler secret put BORROW_PROVIDER_URL
npx wrangler secret put BORROW_PROVIDER_TOKEN
```

### 5) Deploy

```bash
npm run deploy
```

The Worker runs every minute automatically.

## Endpoints

- `GET /health` — agent health + current ET market context
- `POST /scan` — force a scan immediately
- `GET /signals` — latest 50 signal records
- `GET /positions` — shadow positions
- `POST /shadow/open` — tell the position manager about an entry

Example shadow entry:

```json
{
  "symbol": "FRGT",
  "entry_price": 1.02,
  "quantity": 100,
  "notes": "tiny-float ignition test"
}
```

## Signal states

- `WATCH` — interesting but not enough evidence.
- `IGNITION_WATCH` — enough factors aligned to demand attention.
- `A_PLUS_ARMED` — unusually strong combination; still not an automatic buy.

The alert deliberately says **VERIFY BEFORE ENTRY**. v0.1 is a scout and position manager, not an unsupervised live-money execution bot.

## v0.2 roadmap

- SEC filing/dilution parser (ATM, warrants, shelf registrations, reverse splits, going-concern language).
- FINRA daily short-sale-volume and twice-monthly short-interest context.
- Better float / shares-outstanding metadata cache.
- Borrow-provider adapter implementation once we choose a legitimate source.
- Options repricing module for the `3× Hunt` bucket.
- Paper-trade execution and full trade journal (MFE/MAE, entry quality, exit quality).
- Opportunity-cost engine: compare current positions against new signals.
- Profit-funded upgrade governor.
- Web dashboard with PRE-MOVE / IGNITED / LATE / FAILED labels.
