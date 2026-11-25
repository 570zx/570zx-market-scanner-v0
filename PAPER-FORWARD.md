# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-11-24 (25 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-11-24.


Equity since go-live: -2.98% (hold SPY: -6.55%). Max drawdown 4.93%. Closed trades 8, win rate 37.50%, average -2.00%, longest losing streak 4. Progress to the 100-trade review: 8/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLE | 2026-11-18 | $61.35 | $60.37 | -1.61% | 4 |
| XLF | 2026-11-20 | $54.58 | $56.05 | 2.70% | 2 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| DIA | 2026-11-12 | 2026-11-19 | -5.91% | time |
| XLF | 2026-11-12 | 2026-11-19 | -4.42% | time |
| XLK | 2026-11-04 | 2026-11-11 | -1.06% | time |
| QQQ | 2026-11-02 | 2026-11-09 | -0.42% | time |
| SPY | 2026-11-02 | 2026-11-09 | 0.03% | time |
| XLE | 2026-11-02 | 2026-11-09 | -8.02% | time |
| IWM | 2026-11-02 | 2026-11-09 | 1.11% | time |
| XLF | 2026-10-26 | 2026-11-02 | 2.69% | time |

## Account B: IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)

Signals logged 2026-11-24: **TLT** (IBS 0.020, paper buy at $81.53).


Equity since go-live: -2.66% (hold SPY: -6.55%). Max drawdown 6.55%. Closed trades 19, win rate 68.42%, average -0.49%, longest losing streak 4. Progress to the 100-trade review: 19/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLE | 2026-11-18 | $61.35 | $60.37 | -1.61% | 4 |
| GLD | 2026-11-23 | $332.74 | $325.48 | -2.18% | 1 |
| TLT | 2026-11-24 | $81.53 | $81.53 | 0.00% | 0 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
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
| QQQ | 2026-11-02 | 2026-11-04 | 1.33% | strength |
| SPY | 2026-11-02 | 2026-11-04 | 1.78% | strength |

## What the backtests led us to expect
- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.
- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.
- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.
