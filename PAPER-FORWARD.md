# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-10-27 (5 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-10-27.


Equity since go-live: -0.03% (hold SPY: 0.20%). Max drawdown 0.03%. Closed trades 0. Progress to the 100-trade review: 0/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLF | 2026-10-26 | $56.02 | $55.94 | -0.13% | 1 |

## Account B: IBS ≤ 0.1, no trend filter, sell on strength (max 5 sessions)

No new signals on 2026-10-27.
Exits on 2026-10-27: GLD 0.89% (strength).

Equity since go-live: 0.23% (hold SPY: 0.20%). Max drawdown 0.12%. Closed trades 1, win rate 100.00%, average 0.89%, longest losing streak 0. Progress to the 100-trade review: 1/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| TLT | 2026-10-23 | $81.31 | $81.68 | 0.45% | 2 |
| XLF | 2026-10-26 | $56.02 | $55.94 | -0.13% | 1 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
| GLD | 2026-10-22 | 2026-10-27 | 0.89% | strength |

## What the backtests led us to expect
- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.
- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.
- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.
