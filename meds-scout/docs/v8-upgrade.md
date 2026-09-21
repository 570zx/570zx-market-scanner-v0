# MEDS v8 engineering report

Engine: `meds-v8-autonomous-audit`. Leader: `leader-hunt-v8-autonomous-audit`. D1 schema: 10. Normal paper simulator: `paper-v2-resilient-valuation`; execution model: `observed-side-v2-liquidity`.

The release remains paused: `SCOUT_ENABLED=false`, `TRADING_MODE=shadow`, and `[triggers] crons=[]`. It contains no brokerage order integration. The historical positions, cash, trades, entry versions, and drawdown records are preserved. Historical simulator defects are not repaired by rewriting returns.

## Problems and corrections

| Observed problem or code defect | Correction |
| --- | --- |
| Removing cron configuration did not remove deployed triggers; disabled ticks continued | Explicit empty cron list removes the deployed schedule |
| Expired invocations could write after a replacement acquired the lock | Owner and expiry checks occur inside every runtime mutation transaction; pause also fences writes |
| A legacy equity manager wrote marks to an unrelated option row with the same ID | Removed the cross-table write; option managers retain provider quote timestamps |
| Freshness filtering happened after scarce entry slots were allocated | Preserve source reservations and filter actual execution quotes before allocating successful signals |
| A 150-second persistence window was shorter than a five-minute cycle | Persistence follows the configured session interval with recovery slack |
| Slippage could consume the intended cash reserve | Size against the slippage-inclusive budget; enforce reserve, quantity, cap, and concurrency invariants in D1 |
| Equity and option positions could independently consume a shared cap or underlying | Combined account capacity and underlying duplication checks |
| Stale/missing marks could be confused with a current portfolio value | Null live equity, known fresh subtotal, explicitly dated retained reporting values, and symbol-level quote state |
| Missing held data could obstruct unrelated management | Mandatory held universe, batched quote retry, independent stock/option retrieval, retained reporting cache |
| Audits reflected partial scoring or only successful shortlist rows | Persist final enriched research, missing/truncated symbols, exact account rejection reasons, and immutable first observations |
| Retry rejection could overwrite a committed entry audit | Preserve the ENTERED decision for its account/bucket |

## Discovery, lanes, and audit

Discovery combines gainers, fresh news, volume activity, trade activity, losers, and continuity. Held symbols are never removed by the optional research cap. The universe remains bounded for new discovery; its coverage is not the whole market.

Leader equity research retains the v7 asymmetric runner policy, including $0.10–$25 prices, early move limits, spread controls, and dilution rejection. Larger liquid names remain research controls and can qualify for the separate options momentum lane. Options require directional price movement with participation, acceptable underlying/contract quotes, displayed contract size, expiry/strike constraints, and delta checks when supplied. Declining volume alone does not create a put setup. All options remain indicative simulations.

`/status/hunt/gainers?limit=20` exposes first observed provider appearance, first research/shortlist/eligibility times, entry timing, before-5/10/20 capture flags, exact miss/rejection reasons, and sampled excursions. `/status/hunt/decisions?symbol=SYMBOL` exposes the underlying snapshots. Provider appearance means the first MEDS poll observing a symbol, not an upstream publication timestamp. Excursions are sampled research prices, not continuous-market maxima or ideal fills. Instrument metadata is unclassified when unavailable; warrants cannot honestly be diagnosed from ticker spelling alone.

`/status/hunt/performance` defaults to the current entry version; `version=previous`, `version=all`, `window=24h`, and `group=asset_type|version|account_id|opened_phase|source|price_bucket|score_bucket` support comparison. Reports include average/median/best/worst returns, win rate, MFE/MAE, holding duration, ladder and +200 events, and runner outcomes. Account tiers are correlated simulations, not independent signals. No improved catch rate or profitability is claimed before new observations exist.

Leader stop/time exits can partially fill within fresh minute-volume or whole-contract displayed-size limits. A durable exit intent survives a price rebound. Ladder/+200 sells defer when the whole rung cannot fit the available capacity. v7 open positions keep their original holding policy and entry version.

## Autonomy and usage

Cloudflare cron is the sole intended scheduler; GitHub is a read-only report renderer. Planned active intervals are regular 5 minutes, pre/postmarket 10 minutes, overnight 30 minutes, closed 0. They are not currently enabled. GitHub refresh remains manual, with no recurring report workflow added.

Market-data requests are bounded to 36 per engine cycle, memoized within the cycle, use five-second timeouts, and report failures, retry counts, cache hits, and latency. D1 telemetry records calls, statements, and available row counts; `first()` lacks row-count metadata, so reported reads are a lower bound.

The deterministic 260-symbol control fixture, with no holdings and no entries, measured **11 provider requests, 203 D1 calls, and at least 1,311 SQL statements**. This is a local adapter measurement, not a Cloudflare billing sample or CPU measurement. It already exceeds the documented **50 D1 queries per invocation on Workers Free**. The fixture does not prove worst-case capacity with full holdings or entries. No paid upgrade is authorized or performed. Database batching/partitioning, write retention, and plan-level CPU/row usage remain restart blockers.

Cloudflare references: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [cron configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1 transactions and batch](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## Validation and deployment gates

Run from `meds-scout`:

```sh
npm ci
npm test
npm run check
npx wrangler deploy --dry-run --outdir /tmp/meds-wrangler
```

The 44-test suite covers migrations/history preservation, concurrency/lease rollback, reserve/cash reconciliation, combined caps, held quote recovery, stale valuation, partial exits, gap-through-stop accounting, whole-contract options, ladder/+200 lifecycle, market windows/DST, final audit attribution, version-separated statistics, report failures, read-only endpoints, and paper-only execution. It also prints the capacity fixture result; passing functional tests does not imply the Free-plan capacity gate passes.

Merge only after CI validates the current PR head. Cloudflare native GitHub Builds deploys the production branch through the existing `scripts/deploy.mjs` path, with scanning disabled during migration. Verify the live `/health` engine version and `/status` schema 10, preserved historical state, disabled gate, and stopped tick count. A green Cloudflare Pages preview alone is not evidence that this Worker deployed.

## Remaining limitations and next experiment

1. Keep cron empty until the full cycle fits the deployment plan, including maximum held positions, independent option recovery, failures, and daily write/CPU limits. Reducing frequency alone cannot fix a per-invocation limit.
2. Ordinary paper equity/option exits still use their prior full-size side-quote fill model; the new partial-exit liquidity model applies to Leader accounts. It is not a full order-book simulator.
3. There is no holiday calendar or expired-option settlement model. Missing contracts remain explicitly unavailable rather than receiving fabricated settlement prices.
4. Metadata for warrants, upstream publication times, full-market coverage, borrow data, and optional Greeks is not guaranteed by the free feeds.
5. Audit/history retention and large all-time performance scans need a measured retention/aggregation policy before prolonged autonomous use.

Once capacity is validated, the next experiment is a bounded paper-only session measuring discovery-to-first-eligible latency, pre-10% top-mover capture, lane/source rejection distribution, quote coverage, and realized/slippage-adjusted outcomes against v7. Do not tune gates to a single day's winners or interpret correlated capital tiers as independent evidence.
