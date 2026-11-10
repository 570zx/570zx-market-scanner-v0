# APEX

Research-first trading engine: test an idea honestly, then (only if it survives) trade it on paper,
then (only with explicit approval) trade it for real.

**Status after round two (2026-11-10): no strategy is proven, live trading is off.**

* Round one (crypto at Robinhood's fees): 0 of 15 ideas passed.
* Round two (stocks and ETFs, commission-free): 29 families and 414 settings, each with its kill rule committed
  before the 2023+ holdout was run. 0 of 29 beat holding SPY or QQQ.
* One pattern held on every sample, including 1999-2015 data that no other test touched: the weak-close bounce
  in index ETFs. It is real, it is small, and it did not beat holding in 2023-2026.

* A forward paper test of that one rule is written and frozen (`scripts/forward_test.py`, go-live 2026-11-11).
  It is **not switched on**: its workflow only runs from the default branch, and merging is the owner's decision.

The findings are in the report "APEX — Feasibility and First-Round Research". The numbers behind it are in
`results/summary.json` (round one), `results/equity_summary.json` (round two), `results/older_sample.json`,
`results/equity_deep_dive.json`, `results/early_close_check.json` and the append-only `results/ledger.jsonl`.
(`results/paper_replay_equity.json` is produced locally and not committed: it holds trade prices.)

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
| `src/apex/monitor.py` | Forward-versus-backtest checks: resampling, win count, average trade |
| `src/apex/equities.py` | Stock and ETF research: session panel with two tradable moments a day (open, 15:55), early closes, weight and slot engines, family evaluation, lookahead test, exact one-account replay |
| `src/apex/intraday.py` | 5-minute grid, noise-area and opening-range rules, next-bar-open fills |
| `src/apex/execution/` | Broker interface, paper broker, execution engine, SQLite store, Robinhood crypto adapter |
| `scripts/ingest_data.py` | Build the bar files from the raw downloads |
| `scripts/run_experiments.py` | Round one: 16 hypotheses, 145 settings, verdicts, ledger |
| `scripts/paper_replay.py` | Replay a rule through the paper engine and compare with the backtest |
| `scripts/run_equity_experiments.py` | Round two: 29 families, 414 settings, verdicts, ledger |
| `scripts/older_sample_test.py` | The two leading rules on 1999-2015 daily bars, rules and failure conditions fixed first |
| `scripts/equity_deep_dive.py` | After the holdout: stress tests, sizing, the entry-versus-exit control (descriptive only) |
| `scripts/paper_replay_equity.py` | The weak-close rule through the paper engine, with and without the risk limits |
| `scripts/early_close_check.py` | Measures what the handling of the 21 early-close days does to the results |
| `scripts/forward_test.py` | Forward paper test of the frozen weak-close rule: a stateless replay from the go-live date, with alarms |
| `tools/export_alpaca.py` | Read-only export of Alpaca bars, run in GitHub Actions and encrypted before it leaves the runner |
| `scripts/build_dashboard_data.py` | Flatten results into the dashboard's CSV files |
| `dashboard/` | The dashboard page and its data-source documents |
| `tests/` | 55 tests |
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

### Round two (stocks and ETFs)

Market data is not in this repository: Alpaca's terms do not allow republishing it, and the repository is public.

```bash
# 1. data. The workflow .github/workflows/apex-data-export.yml downloads the bars with the repository's Alpaca keys,
#    encrypts them for the key in tools/pub.pem and publishes them to the apex-data branch. Whoever holds the matching
#    private key decrypts into data/equities/. To use your own key pair, replace tools/pub.pem and re-run the workflow.
# 2. older, public-domain daily bars (1999-2017) for the older-sample test
git clone --depth 1 --filter=blob:none --sparse https://github.com/neo-zhao/CMSC320_Final_Tutorial_Huge_Stock_Market_Dataset raw/older
#    then copy the ETFs/*.us.txt and Stocks/*.us.txt files named in scripts/older_sample_test.py into data/older/
# 3. run
python3 scripts/run_equity_experiments.py          # about 90 seconds; --discovery-only cuts the data at 2022-12-31
python3 scripts/older_sample_test.py
python3 scripts/equity_deep_dive.py
python3 scripts/paper_replay_equity.py
python3 scripts/early_close_check.py               # needs the 5-minute files; add --record to append to the ledger
python3 scripts/build_dashboard_data.py
```

The private key that reads the `apex-data` branch exists only in the research session that made it. A new session
makes a new key pair, replaces `tools/pub.pem` and asks for a fresh export by changing `tools/export_request.txt`
(the export takes about two hours and is the only thing that file is for).

### Forward paper test of the weak-close rule

```bash
python3 scripts/forward_test.py --data data/equities --go-live 2026-09-01 --out /tmp/rehearsal   # rehearsal on local data
python3 scripts/forward_test.py --fetch --out forward-state --previous forward-state/ledger.json  # what the scheduled job runs
```

* **Paper only.** It reads prices and writes a report; there is no order code in it.
* The rule, the go-live date (2026-11-11) and the expectations are constants at the top of the script, committed
  before the first session they are judged on. A changed rule is a new test with a new go-live date.
* Every run replays the rule from the go-live date with the backtest's own code, so there is no state to drift.
  The previous report is read only to check that no published trade has changed.
* Account C trades QQQ; account D trades TQQQ on the same QQQ signal. They sit beside MEDS's accounts A and B,
  which test a different weak-close variant (nine ETFs, a 10% threshold, other exits).
* `.github/workflows/apex-forward.yml` runs it after each close and commits the report to the `apex-forward`
  branch. Scheduled and manual runs only start from the default branch, so the job does nothing until this
  branch is merged.
* What to expect: about 30 trades a year. The alarms can catch a breakdown within a year. Confirming an edge from
  the forward record alone takes several years; the script's `REVIEW_RULE` says so in numbers.

## Rules the engine enforces

1. **A hypothesis has a kill rule before it runs.** `HYP` in `scripts/run_experiments.py` is the registry.
2. **Nothing dated 2023-01-01 or later picks a rule or a setting.** Settings are chosen year by year from
   earlier data only (walk-forward); the holdout is only ever scored.
3. **A signal at the close of a bar fills at the next bar's open.** In the bracket simulator a minute that
   touches both target and stop counts as a stop, and a gap through the stop fills at the worse price.
4. **Costs are Robinhood's own.** For crypto the default is the Tier 1 market-order fee, 0.95% a side plus 0.02%
   slippage. Stocks and ETFs pay no commission; the cost is the spread, set per symbol in `equities.COST_TIERS`
   (1 basis point a side for SPY and QQQ, 2.5 for TQQQ), and every family is re-run at three times that.
5. **Every signal function must pass the lookahead test** (`validation.prefix_invariance`, and for round two
   `equities.truncation_test`): recomputed on data cut off at a date, the decisions up to that date must not change.
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

* Stock and ETF data start in 2016 (Alpaca's free history) and come from 5-minute bars: there is no official
  closing-auction price, so rules trade at 15:55 or at the last print. Alpaca's daily bars were found to carry
  wrong closes on some volatile days and are not used for trading rules.
* Options were not tested (no data). Shorting was not tested (the account cannot short); inverse ETFs stand in.
* Ten large stocks in the round-two universe were picked in 2026, which flatters any rule that is long them.
* Early-close days (21 sessions in 11 years). The round-two data has no 12:55 sample, so on those days the panel
  used the 13:00 print as its price and a day's range that runs to 15:30. The range therefore included
  after-hours trades that had not happened yet: on 14 of the 21 days for QQQ. `scripts/early_close_check.py`
  measured it: rebuilt exactly from 5-minute bars, the weak-close rule in QQQ takes the same 306 trades and its
  return moves from 15.07% to 15.04% a year (2016-2026); made blind on those days, all 8 families that read the
  day's range keep their verdicts (the machine-learning family's holdout Sharpe moves from 1.30 to 1.23, further
  below holding). The exporter now samples 12:55 and the panel uses it when present, so new exports and the
  forward test are exact.
* Coin tests use coins listed today (survivorship flatters them) and daily reference prices.
* The coin panel assumes weights are held constant between rebalances; the small daily drift is not costed.
* The paper broker fills market orders at the quote with a fixed half-spread. Real fills in fast markets are worse.
* `self_check()` has never been run against the real Robinhood API.
