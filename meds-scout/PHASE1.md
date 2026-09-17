# Phase 1: paper simulator repair

Baseline: c07ba47f650d31311aaf36647e1845c6ccccf92a, preserved on
`meds-prefx-baseline-c07ba47`. Simulator `phase1-v1`; execution `observed-side-v1`.
No brokerage order execution. Momentum proposals, stop percentages, catalyst
classification, score thresholds and regime rules are unchanged.

## Additive schema version 3

`ensurePaperSchema` checks column existence before adding simulator_version and
execution_version to paper_trades/paper_cycles. Historical rows default to
`legacy-untrusted`. New-row triggers stamp current versions. Incomplete legacy
cycles reclaimed by new code receive current versions. Original trade P&L and
ledger cash are never reconciled retroactively.

New tables: paper_valuations (timestamped completeness, equity, warnings and
exposure), paper_metric_epochs (post-fix peak/drawdown), paper_account_revisions
and paper_risk_guards (transactional entry concurrency protection). Additional
triggers prevent duplicate new equity/option structures and double exits.
Existing duplicate holdings are preserved; no forced liquidation or balance reset.
Complete prepared statements are used; no multiline D1 exec dependency.

## Valuation and execution

Every open paper stock/option underlying is included in snapshot retrieval.
Quotes require finite positive bid, ask >= bid, no future timestamp and age <=90s.
Option legs additionally require timestamps within 15s, a valid debit below width,
and a nonnegative executable liquidation credit. Missing marks mean unavailable
equity, block new entries and do not update drawdown. Legacy max_equity and
max_drawdown_pct remain frozen, explicitly untrusted. The new drawdown series
starts at the first complete post-fix valuation, not the original account deposit.

Stock exits sell at observed bid or cover at observed ask, with adverse 2bp
slippage. Options liquidate at long bid minus short ask, with adverse 2bp on net
credit. This is a deterministic simulation assumption, not an execution guarantee.
Exit notes contain JSON with trigger price, observed quote(s), quote timestamps,
modeled fill, slippage and execution version. Cash and P&L use the same fill.
Missing option legs never default to zero. No fallback to the stop price.
New position notes identify entry simulator version; old positions remain flagged.

## Shared ledger risk policy

Across both lanes and all assets: 5% total reserved-risk cap, 1% per underlying,
25% allocation per underlying, 100% aggregate allocation. Reserved stock risk is
at least original planned stop risk and current distance to stop; options reserve
their full premium. Existing unrealized losses further consume risk capacity.
Sizing uses complete marked equity and accounts for immediate bid/ask loss and
equity reduction from the proposed entry. These are conservative engineering
limits, not fitted strategy parameters or guaranteed maximum losses.

Both lanes evaluate proposals and log rejected signals, but cannot create duplicate
stock exposure in one ledger; the exact option structure cannot be duplicated.
Different equity/options structures may coexist only within shared risk capacity.
Transaction revision guards abort entries if cash/positions changed since valuation.
Short signals are recorded as rejected until a borrow/collateral model exists.

Options retain original direction/strike/expiry selection, but require a matching
underlying proposal, valid fresh leg quotes, displayed entry size, and combined
round-trip bid/ask friction <=20% of entry debit. Debit spreads require debit <
strike width. Indicative results remain research-only and not OPRA execution evidence.
Allocation for options denotes premium, not delta-adjusted economic exposure.

## Observability and limitations

GET /status retains its contract and adds diagnostics: versions, valuation warnings,
marked equity, reserved risk, per-underlying exposure, post-fix drawdown and top 20
rejection reasons in the last 24h. /status/trades adds versions and execution_audit.
GitHub report diagnostics do not expose credentials or control routes.

Old losses/drawdowns are not repaired. A portfolio with old excessive exposure
may reject all new entries until it falls below limits. Options held outside regular
hours can make current valuation incomplete because fresh quotes are unavailable;
this is reported rather than assigning stale prices or zero. Fixed slippage does
not model full market depth, assignment, fees, or guaranteed stop execution.
Any prospective comparison must exclude legacy entries/metrics and respect those
limitations. Phase 1 makes no claim of improved trading expectancy.

Validation: npm run check; npm test; npx --no-install wrangler deploy --dry-run.
