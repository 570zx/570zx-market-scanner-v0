# MEDS Scout real-capital readiness

Status: **NOT AUTHORIZED FOR LIVE CAPITAL**

This document describes the engineering gates for the active Leader-only H250 runtime. It is not an authorization mechanism. The production broker boundary deliberately has no LIVE mode and constrains `live_execution=0`.

## Current architecture

- Strategy runtime: `leader-hunt-v8.5-account-risk-governor`
- Capacity engine: `meds-v8.1-leader250-capacity`
- Active account: H250, approximately $250 starting scale
- Runtime: Cloudflare Workers + D1
- Execution mode: shadow only
- Normal MEDS: historical/inactive
- Broker boundary: disabled by default; only `DISABLED`, `OBSERVE`, and `PAPER` are representable

## Hardened controls already present

1. D1 lease/fencing and revision guards prevent stale/concurrent paper-runtime mutations.
2. Execution-authoritative quote state is separate from research freshness.
3. Delayed SIP, overnight indicative stock data, and indicative options cannot authorize paper fills.
4. Held-position valuation failures block new risk while management remains fail-closed.
5. Capital rotation preflights both legs, shares one per-symbol minute-liquidity budget, has session caps/cooldowns, and cannot reuse partial-exit liquidity.
6. Pending exits force reduce-only.
7. Extreme held-price discontinuities are quarantined instead of producing synthetic P&L.
8. Entry friction is modeled; a candidate already beyond the equity stop budget is rejected.
9. Quote expiry is fenced at the final accounting transaction.
10. Manual reduce-only leaves position management/exits running; hard halt remains separate.
11. Account-level v8.5 governor tracks session realized loss, drawdown, entries, and deployed entry notional and can force reduce-only.
12. Raw research retention is bounded and compacted while preserving symbol/session evidence.
13. Market-data concurrency is capped and an external GitHub watchdog checks the Worker heartbeat.
14. Broker-facing monetary values use exact decimal strings/scaled integers.
15. Broker order intents use deterministic client order IDs, durable lifecycle state, atomic transition audit, idempotent fills, and explicit UNKNOWN recovery.
16. Broker reconciliation compares exact cash, positions, and open client-order IDs.
17. Asset/session eligibility models active/tradable/fractionable/extended-hours/overnight/halt state.
18. No production Leader code submits brokerage orders.

## Objective remaining gates

The read-only endpoint `/status/broker-readiness` exposes these gates without account identifiers or secrets.

- Broker OBSERVE/PAPER adapter connected and tested.
- Latest broker reconciliation is MATCH and fresh.
- Zero UNKNOWN broker intents.
- Zero unresolved pending broker intents at the live-capital decision point.
- At least 200 independent closed trades under the unchanged current strategy cohort.
- At least 60 completed evidence sessions under the unchanged current strategy cohort.
- Production Cloudflare CPU behavior explicitly measured and accepted.
- Production GitHub branch protection independently verified.
- Broker-paper chaos/recovery suite completed against the selected broker.
- Corporate-action, split/reverse-split, symbol-change, manual-trade, forced-liquidation, and settlement reconciliation exercised against broker-paper/observe data.

Any material strategy change creates a new performance cohort and restarts the relevant strategy-evidence clock.

## Required progression

### 1. SHADOW

Current production mode. Strategy decisions, simulated execution, risk management, and evidence collection continue without broker connectivity.

Exit criteria:
- current engineering tests green;
- runtime health/retention/capacity stable;
- sufficient unchanged-policy strategy evidence.

### 2. OBSERVE

A future separately configured read-only broker adapter may read:

- account state;
- clock/calendar;
- asset capabilities;
- execution quotes;
- positions;
- open orders;
- fills.

OBSERVE may persist snapshots and reconciliation evidence. It must never call submit or cancel.

Exit criteria:
- prolonged zero-difference reconciliation except explained/handled events;
- manual trade, split, symbol-change and unknown-order cases correctly force mismatch/reduce-only;
- asset/session capability checks proven on actual broker metadata.

### 3. PAPER

Broker-provided paper execution may exercise the durable intent state machine.

Required chaos cases:
- timeout after submit;
- accepted order with lost response;
- duplicate retry;
- partial fill across restarts;
- cancel/fill race;
- replace/reject behavior;
- broker 429/5xx;
- unknown order;
- manual trade;
- reconciliation mismatch;
- deployment while an order is pending.

No transition beyond PAPER is implied by passing this stage.

### 4. Future live canary

Not implemented.

A future live-capital PR must be separately designed, reviewed, and explicitly authorized. It must not be enabled by deployment alone. At minimum it should require independent runtime arming, account allowlisting, strict notional limits, recent successful reconciliation, current risk-governor health, and a rapid reduce-only/kill path.

## Evidence rule

Engineering readiness and strategy profitability are separate gates. Passing the broker and infrastructure tests does not prove the strategy has positive expectancy, and strategy paper performance does not prove broker execution safety.

MEDS is considered ready for a *live-capital decision* only after both sets of evidence are satisfied. Even then, live execution remains disabled until separately implemented and explicitly authorized.
