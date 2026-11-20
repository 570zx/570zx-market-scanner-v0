# Weak-close ETF strategy: forward paper test

**Paper only: no orders are placed and no broker account is touched.** Go-live 2026-10-21; last update 2026-11-19 (22 sessions so far). Costs assumed: 1 cent per share each way. Rules are frozen; do not change them while this runs.

## Account A: IBS ≤ 0.1, above 200-day average, hold 5 sessions

No new signals on 2026-11-19.
Exits on 2026-11-19: XLF -4.42% (time), DIA -5.91% (time).

Equity since go-live: -3.31% (hold SPY: -6.65%). Max drawdown 4.93%. Closed trades 8, win rate 37.50%, average -2.00%, longest losing streak 4. Progress to the 100-trade review: 8/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLE | 2026-11-18 | $61.35 | $60.98 | -0.61% | 1 |

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

Signals logged 2026-11-19: **GLD** (IBS 0.054, paper buy at $335.62), **SPY** (IBS 0.079, paper buy at $717.51), **DIA** (IBS 0.079, paper buy at $491.68), **XLK** (IBS 0.083, paper buy at $161.19).
Exits on 2026-11-19: XLF -4.42% (time), DIA -5.91% (time), IWM -4.85% (time).

Equity since go-live: -2.23% (hold SPY: -6.65%). Max drawdown 3.06%. Closed trades 15, win rate 66.67%, average -0.68%, longest losing streak 3. Progress to the 100-trade review: 15/100.

| Open position | Entered | Entry | Last | P&L | Sessions held |
|---|---|---:|---:|---:|---:|
| XLE | 2026-11-18 | $61.35 | $60.98 | -0.61% | 1 |
| GLD | 2026-11-19 | $335.62 | $335.62 | 0.00% | 0 |
| SPY | 2026-11-19 | $717.51 | $717.51 | 0.00% | 0 |
| DIA | 2026-11-19 | $491.68 | $491.68 | 0.00% | 0 |
| XLK | 2026-11-19 | $161.19 | $161.19 | 0.00% | 0 |

| Closed trade | Entered | Exited | Return | Exit reason |
|---|---|---|---:|---|
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
| IWM | 2026-11-02 | 2026-11-04 | 1.53% | strength |
| TLT | 2026-10-23 | 2026-10-30 | 0.45% | time |
| XLF | 2026-10-26 | 2026-10-29 | 1.53% | strength |
| GLD | 2026-10-22 | 2026-10-27 | 0.89% | strength |

## What the backtests led us to expect
- Walk-forward 2019–2026: win rate about 60%, about 64% of months positive, longest losing streak about 12 trades, worst month about −8%, max drawdown near 20%.
- A handful of trades says nothing. Judge after about 100 closed trades per account, and compare with the backtest, not with SPY alone: the strategy is invested only part of the time.
- Review gate (suggested): win rate at or above 50%, average trade positive after costs, and drawdown not far beyond the backtest. If it fails, stop and look at why before anything else.
