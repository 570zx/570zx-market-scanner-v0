# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-11-05 (12 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-11-05.


Equity since go-live: -4.42% (hold SPY: -4.27%). Max drawdown 4.93%. Closed trades 1, win rate 100.00%, average 2.69%, longest losing streak 0. Progress to the 100-trade review: 1/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| IWM | 2026-11-02 | $279.45 | $271.61 | -2.81% | 3 |
| XLE | 2026-11-02 | $67.39 | $61.95 | -8.07% | 3 |
| SPY | 2026-11-02 | $752.97 | $735.76 | -2.29% | 3 |
| QQQ | 2026-11-02 | $682.05 | $651.54 | -4.47% | 3 |
| XLK | 2026-11-04 | $176.10 | $163.73 | -7.02% | 1 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| XLF | 2026-10-26 | 2026-11-02 | 2.69% | time |

## Account B: IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)

Signals logged 2026-11-05: **DIA** (IBS 0.055, paper buy at $515.63), **SPY** (IBS 0.073, paper buy at $735.76), **IWM** (IBS 0.076, paper buy at $271.61).


Equity since go-live: -1.53% (hold SPY: -4.27%). Max drawdown 2.09%. Closed trades 6, win rate 100.00%, average 1.25%, longest losing streak 0. Progress to the 100-trade review: 6/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLE | 2026-11-02 | $67.39 | $61.95 | -8.07% | 3 |
| XLK | 2026-11-04 | $176.10 | $163.73 | -7.02% | 1 |
| DIA | 2026-11-05 | $515.63 | $515.63 | 0.00% | 0 |
| SPY | 2026-11-05 | $735.76 | $735.76 | 0.00% | 0 |
| IWM | 2026-11-05 | $271.61 | $271.61 | 0.00% | 0 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| QQQ | 2026-11-02 | 2026-11-04 | 1.33% | strength |
| SPY | 2026-11-02 | 2026-11-04 | 1.78% | strength |
| IWM | 2026-11-02 | 2026-11-04 | 1.53% | strength |
| TLT | 2026-10-23 | 2026-10-30 | 0.45% | time |
| XLF | 2026-10-26 | 2026-10-29 | 1.53% | strength |
| GLD | 2026-10-22 | 2026-10-27 | 0.89% | strength |

## What the backtests led us to expect
- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.
- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.
- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.
