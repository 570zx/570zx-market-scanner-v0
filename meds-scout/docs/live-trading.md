# MEDS live trading (Robinhood Agentic Trading)

MEDS can send real orders to a Robinhood **Agentic Trading** account through
Robinhood's official MCP server (`https://agent.robinhood.com/mcp/trading`).
The paper engine still makes every decision. The live layer copies each
committed H250 paper **equity** entry and exit into a real limit order, then
records what actually filled.

Live trading is **off** until the operator turns it on in the `/live` console.

## How it works

1. The paper cycle writes a *live outbox* into its own audit row: one request
   per new equity entry, full exit, or partial exit. It is committed in the
   same transaction as the paper accounting. A liquidity-limited paper stop
   (paper can only sell part of a thin position per cycle) is mirrored as a
   full exit: live sizes are small and whole-share.
2. The cron fires every minute. Minutes divisible by five run the paper cycle.
   Every other minute runs the **live step** in its own Worker invocation
   (Workers Free allows 50 D1 queries and 50 subrequests per invocation).
   Measured in tests: login uses 16 queries and 5 requests, and the busiest
   trading minute uses 27 queries and 11 requests. Outside the regular
   session the live step runs every ten minutes.
3. The live step:
   - reads buying power, positions, quotes and recent orders from Robinhood;
   - resolves in-flight orders and records fills into MEDS's own ledger
     (`live_positions`) from Robinhood's cumulative filled quantity, so the
     same shares can never be counted twice;
   - reconciles: Robinhood must hold at least what MEDS bought. Two
     consecutive shortfalls halt new buys until cleared;
   - turns new requests into **limit** orders (never market orders), exits
     first, at most 3 per minute;
   - writes each order as an intent before sending it. Robinhood's orders do
     not carry a client reference, so a lost submission is matched in the
     order history (looked up by symbol, a few pages back) by side, quantity,
     limit price and time, and only when exactly one order fits. It is never
     re-sent. If it is still unresolved after 3 minutes (15 for an order
     Robinhood acknowledged), MEDS never guesses in the direction that could
     sell shares it does not own: a sell is assumed to have happened (MEDS
     stops counting those shares), a buy is assumed not to have happened,
     and new buys halt until the operator checks the account;
   - writes everything in one batch that aborts if the run has lost its lease,
     so a slow run can never overwrite a newer one.
4. MEDS only ever sells shares **it bought**, and never more than Robinhood
   reports as *available for sale*. Anything else in the account (for
   example positions opened from ChatGPT) is reported as *unmanaged* and left
   alone, and MEDS will not buy a stock the account already holds another
   way (`SYMBOL_HELD_OUTSIDE_MEDS`), so the two never mix. If shares MEDS
   owns disappear, MEDS halts new buys and alerts.
5. Anything MEDS owns that the paper account no longer holds is sold
   (orphan convergence), so live always converges to paper's exits.
6. If a run fails partway, the next run still exits but places no new buys
   until a run completes cleanly.

## Limits (all editable in the console)

| Setting | Default | Meaning |
| --- | --- | --- |
| `max_capital` | 250 | Cost basis MEDS may hold plus pending buys |
| `max_order_notional` | 12 | Size of each buy (whole shares, so a buy is at most this) |
| `max_orders_per_day` | 40 | Buys stop after this many orders in a session |
| `daily_loss_limit` | 15 | Realized + unrealized loss on MEDS positions today. After it, no new buys (exits continue). Measured only when every MEDS position has a quote |
| `order_ttl_seconds` | 90 | Day orders not filled by then are cancelled (IOC is used when Robinhood offers it) |
| `buy_limit_buffer_pct` | 0.01 | Buy limit = ask × 1.01 |
| `sell_limit_buffer_pct` | 0.02 | Sell limit = bid × 0.98 |
| `max_chase_pct` | 0.02 | Skip a buy if Robinhood's ask is more than 2% above the paper price |
| `max_spread_pct` | 0.03 | Skip a buy if the spread is wider than 3% |
| `request_ttl_seconds` | 180 | Ignore paper decisions older than this |

Buys use **whole shares only**, so a stock priced above `max_order_notional`
is skipped (`PRICE_ABOVE_ORDER_CAP`). Raising the limit lets MEDS buy
higher-priced names and makes every buy larger.

## Setup

1. Deploy this branch (Cloudflare applies migrations `0012` and `0013`).
2. Open `https://<worker>/live`.
3. **Start login** with the admin token. Log in to Robinhood and approve on
   your phone. The browser lands on `http://localhost:8765/callback?...`,
   which does not load. That is expected.
4. Paste that full address into **Finish login** within 15 minutes.
5. Check `/status/broker/tools`: `capabilities.can_trade` must be `true`,
   and `time_in_force_options` should include `ioc`.
6. Adjust limits, then **Turn live ON**.

Kill switches: **Turn live OFF** (no new buys, exits continue), `POST
/control/halt` (everything stops, open orders are cancelled), or disconnect
MEDS in Robinhood's agent settings.

**Clear halt** also accepts Robinhood's share counts for the symbols the
latest sync found short: if shares MEDS bought were sold outside MEDS, MEDS
stops counting them. It needs a successful sync from the last ten minutes and
waits if a live step is running.

## Monitoring

- `/status/live`: public state, counts and limits (no balances; long numbers
  in errors are masked).
- `/live` → **Show account detail** (admin): balances, MEDS positions, recent
  orders and every mirrored or skipped paper decision with its reason.
- `ALERT_WEBHOOK_URL`: fills, rejects, halts, daily-loss stop, connection
  failures (one message per minute at most, identical text once per day).
- `/status/broker/shapes`: structure (keys and types only) of Robinhood's
  responses, to verify parsing without exposing values.

## Known unknowns

- Robinhood does not publish its tools' argument formats. The adapter maps
  arguments from each tool's JSON schema, captured at login, and refuses to
  send any order it cannot map exactly as a limit order. The response parsers
  follow the envelopes Robinhood returned on 2026-09-29. Watch the first real
  orders.
- Token lifetime is undocumented. A rejected refresh token (`invalid_grant`)
  stops all Robinhood calls and alerts once; log in again from `/live`.
  Rate limits, timeouts and outages are retried on the next run.
- Robinhood allows one Agentic account per user, shared with any other agent
  you connect.
- Workers Free allows 10 ms of CPU per invocation. The live step is light,
  but if Cloudflare reports CPU-limit errors, Workers Paid ($5/month) removes
  the limit.
- Live results will differ from paper: real spreads, partial fills, skipped
  whole-share sizes, and up to about a minute between the paper decision and
  the order.
