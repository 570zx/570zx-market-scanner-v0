# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-11-11 (16 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-11-11.
Exits on 2026-11-11: XLK -1.06% (time).

Equity since go-live: -1.14% (hold SPY: -1.19%). Max drawdown 4.93%. Closed trades 6, win rate 50.00%, average -0.94%, longest losing streak 2. Progress to the 100-trade review: 6/100.

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| XLK | 2026-11-04 | 2026-11-11 | -1.06% | time |
| QQQ | 2026-11-02 | 2026-11-09 | -0.42% | time |
| SPY | 2026-11-02 | 2026-11-09 | 0.03% | time |
| XLE | 2026-11-02 | 2026-11-09 | -8.02% | time |
| IWM | 2026-11-02 | 2026-11-09 | 1.11% | time |
| XLF | 2026-10-26 | 2026-11-02 | 2.69% | time |

## Account B: IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)

No new signals on 2026-11-11.


Equity since go-live: 0.85% (hold SPY: -1.19%). Max drawdown 2.09%. Closed trades 11, win rate 81.82%, average 0.40%, longest losing streak 2. Progress to the 100-trade review: 11/100.

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| IWM | 2026-11-05 | 2026-11-09 | 4.03% | strength |
| SPY | 2026-11-05 | 2026-11-09 | 2.37% | strength |
| DIA | 2026-11-05 | 2026-11-09 | 1.54% | strength |
| XLK | 2026-11-04 | 2026-11-09 | -3.04% | strength |
| XLE | 2026-11-02 | 2026-11-09 | -8.02% | time |
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
