# MEDS backtest

Replays MEDS's **production** Leader code over past market days and compares
rule sets, so rule changes are decided by evidence instead of guesses.

Every 5 minutes of each past session (plus 09:00–09:20 premarket research), it
runs the real `runLeaderCycle()` — discovery, scoring, shortlist, sizing, the
daily risk governor, entries, exits, accounting and the live outbox — against
an in-memory copy of the MEDS database, with the clock set to that moment and
Alpaca's data API answered from history. Only the trade-shape settings differ
between rule sets (see `variants.mjs` and `ACTIVE_LEADER_RISK_POLICY`).

## Run it on GitHub (recommended)

1. Repository **Settings → Secrets and variables → Actions → New repository
   secret**: add `ALPACA_API_KEY` and `ALPACA_API_SECRET` (the same Alpaca keys
   the Worker uses; the free plan is enough). One time only.
2. **Actions → MEDS backtest → Run workflow** (defaults: last 40 trading days,
   every rule set).
3. When it finishes (about an hour the first time; market data is cached for
   later runs), open the run: the summary is on the run page, the full report
   is attached as an artifact and committed to the `backtest-results` branch
   (`LATEST.md`).

## Run it locally

```bash
cd meds-scout
ALPACA_API_KEY=… ALPACA_API_SECRET=… npm run backtest -- --days 20
npm run backtest -- --synthetic 2     # offline plumbing check, fake data
```

Options: `--days N`, `--end YYYY-MM-DD` (a completed day), `--variants all|a,b`,
`--workers N`, `--rpm N` (Alpaca requests per minute, default 150 of the free
plan's 200, since the Worker shares the key), `--calibration-samples N`,
`--no-costs`, `--data DIR`, `--out DIR`.

## What it measures

For each rule set, starting from $250:

- **Paper P&L**: the paper account (fractional shares, modeled spread), marked
  at the last trade.
- **Same trades at real quotes**: every buy re-priced at the real NBBO ask and
  every sale at the real bid, one minute after the decision (when the live
  mirror would place the order).
- **Live mirror P&L**: what the Robinhood mirror would have done with those
  decisions — whole shares, $12 orders, 3% spread and 2% chase limits, three
  orders a minute, requests expiring after 3 minutes, leftovers sold once paper
  no longer holds them (a minute-by-minute model of `runLiveStep`).

Plus win rate, trade size, holding time, overnight holds, exit reasons, results
by how far the stock was already up when bought, drawdown, and why candidates
were not bought. Trade lists are in `out/trades-<rule set>.csv`.

## How the data avoids hindsight

- A bar is visible only after it completes; premarket research sees the
  15-minute delayed feed, as production does.
- A stock can appear on a replayed screen (top gainers, losers, most active)
  only from the moment data up to then put it there: the whole market is
  scanned every 15 minutes from 08:00, and a stock is also allowed from its
  first news story, or all day if it was on the previous session's boards
  (which the screens show before the open). So a stock's later run can never
  make it appear earlier; a brand-new runner can show up to 15 minutes later
  than it would live. The report states how often the replayed screens
  provably matched the real ones.
- Reference closes are rescaled across splits, so reverse-split penny stocks
  keep their real price that morning. Delisted stocks are included where
  Alpaca still serves their history.
- Decision-time quotes are modeled from the bars with a spread model fitted
  to real NBBO quotes sampled from the same days; the cost pass then uses the
  real quotes.

## Limits

- Production decides from Alpaca's free IEX feed; the backtest uses the
  consolidated tape. IEX shows a small share of each stock's volume and wider
  quotes, so live MEDS sizes paper entries smaller, hits its per-minute exit
  limit more often and rejects more names for spread. Expect live paper
  decisions to be a subset of the backtest's.
- The spread model is fitted on quotes from the same days it is used on. It
  only decides which trades are attempted; every trade is then priced at real
  quotes.
- Not modeled: overnight (20:00–04:00) management, options (disabled in
  production), halts, fills beyond the displayed quote, settlement of sale
  proceeds. Tradable status and news text are as Alpaca reports them today.
- Past results do not guarantee future results. Compare rule sets with each
  other; do not treat the dollar figures as a forecast.

## Files

`run.mjs` orchestrates. `lib/dataset.mjs` downloads and caches data
(`data/`, git-ignored), `lib/market.mjs` emulates Alpaca's endpoints,
`lib/replay.mjs` runs the production cycle, `lib/calibrate.mjs` and
`lib/spread.mjs` fit the spread model, `lib/reprice.mjs` prices trades at real
quotes and models the live mirror, `lib/report.mjs` writes `out/`. Tests:
`tests/backtest.test.mjs`.
