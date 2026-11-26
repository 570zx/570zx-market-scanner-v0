# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-11-25 (26 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-11-25.
Exits on 2026-11-25: XLE -0.54% (time).

Equity since go-live: -2.59% (hold SPY: -6.75%). Max drawdown 4.93%. Closed trades 9, win rate 33.33%, average -1.84%, longest losing streak 5. Progress to the 100-trade review: 9/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLF | 2026-11-20 | $54.58 | $56.58 | 3.66% | 3 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| XLE | 2026-11-18 | 2026-11-25 | -0.54% | time |
| DIA | 2026-11-12 | 2026-11-19 | -5.91% | time |
| XLF | 2026-11-12 | 2026-11-19 | -4.42% | time |
| XLK | 2026-11-04 | 2026-11-11 | -1.06% | time |
| QQQ | 2026-11-02 | 2026-11-09 | -0.42% | time |
| SPY | 2026-11-02 | 2026-11-09 | 0.03% | time |
| XLE | 2026-11-02 | 2026-11-09 | -8.02% | time |
| IWM | 2026-11-02 | 2026-11-09 | 1.11% | time |
| XLF | 2026-10-26 | 2026-11-02 | 2.69% | time |

## Account B: IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)

Signals logged 2026-11-25: **TLT** (IBS 0.042, paper buy at $82.24).
Exits on 2026-11-25: XLE -0.54% (time), TLT 0.85% (strength).

Equity since go-live: -2.16% (hold SPY: -6.75%). Max drawdown 6.55%. Closed trades 21, win rate 66.67%, average -0.43%, longest losing streak 4. Progress to the 100-trade review: 21/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| GLD | 2026-11-23 | $332.74 | $327.54 | -1.56% | 2 |
| TLT | 2026-11-25 | $82.24 | $82.24 | 0.00% | 0 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| TLT | 2026-11-24 | 2026-11-25 | 0.85% | strength |
| XLE | 2026-11-18 | 2026-11-25 | -0.54% | time |
| XLK | 2026-11-19 | 2026-11-23 | 0.48% | strength |
| DIA | 2026-11-19 | 2026-11-23 | 0.76% | strength |
| SPY | 2026-11-19 | 2026-11-23 | 0.64% | strength |
| GLD | 2026-11-19 | 2026-11-23 | -0.86% | strength |
| IWM | 2026-11-12 | 2026-11-19 | -4.85% | time |
| DIA | 2026-11-12 | 2026-11-19 | -5.91% | time |
| XLF | 2026-11-12 | 2026-11-19 | -4.42% | time |
| TLT | 2026-11-12 | 2026-11-18 | 0.55% | strength |
| IWM | 2026-11-05 | 2026-11-09 | 4.03% | strength |
| SPY | 2026-11-05 | 2026-11-09 | 2.37% | strength |
| DIA | 2026-11-05 | 2026-11-09 | 1.54% | strength |
| XLK | 2026-11-04 | 2026-11-09 | -3.04% | strength |
| XLE | 2026-11-02 | 2026-11-09 | -8.02% | time |

## What the backtests led us to expect
- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.
- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.
- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.
