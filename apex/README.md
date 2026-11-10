# APEX

Research-first trading engine: test an idea honestly, then (only if it survives) trade it on paper,
then (only with explicit approval) trade it for real.

**Status after round one (2026-11-09): no strategy is proven, live trading is off.**
The findings are in the report "APEX — Feasibility and First-Round Research"; the numbers behind it
are in `results/summary.json` and `results/ledger.jsonl`.

## What is here

| Path | What it is |
| --- | --- |
| `src/apex/data.py` | Ingest and validate public market data; fixed-interval bar files |
| `src/apex/costs.py` | Robinhood's published crypto fee tiers and cost models |
| `src/apex/backtest.py` | Causal bar backtester (fills at the next open) and a 1-minute bracket simulator |
| `src/apex/strategies.py` | Signal functions (trend, momentum, breakout, reversal, seasonality, dislocation, coin rotation) |
| `src/apex/regime.py` | Seven-state market-regime classifier, causal |
| `src/apex/research.py` | Hypothesis registry and the single evaluation pipeline with its verdict rule |
| `src/apex/validation.py` | Lookahead test, walk-forward, bootstrap, random-entry control, circuit-breaker simulation |
| `src/apex/metrics.py` | Trade and equity statistics, Wilson intervals, deflated Sharpe |
| `src/apex/feasibility.py` | Arithmetic of the win-rate, annual-doubling and monthly-doubling targets |
| `src/apex/risk.py` | Sizing rules and the risk governor (0.5% per position, 2% daily, 12% drawdown by default) |
| `src/apex/monitor.py` | Forward-versus-backtest degradation check |
| `src/apex/execution/` | Broker interface, paper broker, execution engine, SQLite store, Robinhood crypto adapter |
| `scripts/ingest_data.py` | Build the bar files from the raw downloads |
| `scripts/run_experiments.py` | Round one: 16 hypotheses, 145 settings, verdicts, ledger |
| `scripts/paper_replay.py` | Replay a rule through the paper engine and compare with the backtest |
| `scripts/build_dashboard_data.py` | Flatten results into the dashboard's CSV files |
| `dashboard/` | The dashboard page and its data-source documents |
| `tests/` | 33 tests |
| `results/` | Outputs of the last run, including the append-only experiment ledger |

## Reproduce

```bash
# 1. data (public, fetched with git; about 150 MB)
git clone --depth 1 https://github.com/ff137/bitstamp-btcusd-minute-data raw/bitstamp
git clone --depth 1 --filter=blob:none --sparse https://github.com/coinmetrics/data raw/coinmetrics
git -C raw/coinmetrics sparse-checkout set --no-cone /csv/btc.csv /csv/eth.csv /csv/doge.csv /csv/xrp.csv /csv/ada.csv \
    /csv/link.csv /csv/ltc.csv /csv/bch.csv /csv/xlm.csv /csv/etc.csv /csv/uni.csv /csv/aave.csv /csv/xtz.csv /csv/comp.csv /csv/dot.csv
python3 -I scripts/ingest_data.py raw/bitstamp raw/coinmetrics      # -I: never put downloaded folders on the import path

# 2. tests
python3 -m pytest -q

# 3. experiments (under a minute) and the paper-engine replay (about a minute)
python3 scripts/run_experiments.py --prior ../prior_results   # --prior: a checkout of MEDS's backtest-results branch (optional)
python3 scripts/paper_replay.py
python3 scripts/build_dashboard_data.py
```

Needs Python 3.11+, numpy, pandas, scipy, scikit-learn, cryptography. `requests` is only used by the
Robinhood adapter's default transport.

## Rules the engine enforces

1. **A hypothesis has a kill rule before it runs.** `HYP` in `scripts/run_experiments.py` is the registry.
2. **Nothing dated 2023-01-01 or later picks a rule or a setting.** Settings are chosen year by year from
   earlier data only (walk-forward); the holdout is only ever scored.
3. **A signal at the close of a bar fills at the next bar's open.** In the bracket simulator a minute that
   touches both target and stop counts as a stop, and a gap through the stop fills at the worse price.
4. **Costs are Robinhood's own.** The default is the Tier 1 market-order fee, 0.95% a side plus 0.02% slippage.
5. **Every signal function must pass the lookahead test** (`validation.prefix_invariance`): recomputed on
   truncated data, its last values must not change.
6. **The verdict is computed, not judged.** `research.verdict`: make money after costs on the holdout, beat
   holding for the risk taken, work across most settings; "proven" also needs a deflated-Sharpe probability
   and a probability of beating holding of 95% each.
7. **The ledger is append-only.** Failed experiments stay. Smoke-test runs are kept in
   `results/ledger_smoke_tests.jsonl`.

## Execution safety

* `PaperBroker` has no network code. It cannot send a real order.
* `RobinhoodCryptoBroker` uses only the official Crypto Trading API. Read-only calls work with credentials
  from the environment (`APEX_RH_API_KEY`, `APEX_RH_PRIVATE_KEY_B64`). **Sending an order requires all three:**
  `live_enabled=True` in code, `APEX_LIVE_TRADING=I_ACCEPT_REAL_MONEY_ORDERS` in the environment, and an arming
  file `LIVE_ARMED.json` (`{"armed": true, "account_number": "...", "max_order_notional": 25}`).
  Run `self_check()` (read-only) against the real API before ever arming: the endpoint paths and field names
  were cross-checked against open-source clients, not against a live account.
* The engine journals an order before sending it, uses deterministic order ids (a retry or restart cannot
  duplicate an order), never re-sends an order whose response was lost (it looks it up), reconciles its own
  ledger against the broker before taking new risk, and lets exits through every halt.
* Kill switch: create a file named `KILL` in the working directory, set `APEX_KILL=1`, or call
  `Engine.emergency_stop(now, flatten=True)`.
* A drawdown halt stays until a person clears it (`RiskGovernor.clear_halt`).

## Known limits

* Equity, ETF and options data are not in this repository's pipeline yet. ETF results in the report are
  re-scored from MEDS's stored backtests (`exp_prior`).
* Coin tests use coins listed today (survivorship flatters them) and daily reference prices.
* The coin panel assumes weights are held constant between rebalances; the small daily drift is not costed.
* The paper broker fills market orders at the quote with a fixed half-spread. Real fills in fast markets are worse.
* `self_check()` has never been run against the real Robinhood API.
