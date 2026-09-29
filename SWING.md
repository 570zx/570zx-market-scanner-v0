# MEDS swing-trading backtest: 2021-11-02 to 2026-09-28 (1230 sessions)

Daily bars for 5098 liquid US stocks and ETFs (of 15498 symbols Alpaca lists, active and delisted). Each strategy starts with $250, holds up to 3 positions, buys at the next open after a signal and pays a cost on every fill. Rules are textbook defaults chosen before looking at results; nothing was tuned.

| Strategy | Final | Return | Max drawdown | Trades | Win rate | Avg trade | Avg hold (days) | Time invested | Return if costs ×2.5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **pullback** | $76.91 | -69.2% | 80.6% | 1037 | 57.9% | -0.3% | 3.35 | 99.4% | -89.1% |
| **gap_drift** | $14.89 | -94.0% | 94.0% | 343 | 29.7% | -2.2% | 5.45 | 68.8% | -94.2% |
| **momentum** | $14.98 | -94.0% | 95.0% | 106 | 29.3% | -6.8% | 21.8 | 83.8% | -94.4% |
| **buy_and_hold_SPY** | $415.81 | 66.3% | 25.4% | 0 | — | — | — | 100.0% | — |

## Year by year (return %) and the held-back period
| Strategy | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 | Before 2025 | 2025 onward |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **pullback** | -10.3% | -50.3% | 1.0% | -24.9% | -13.3% | 4.8% | -66.1% | -9.2% |
| **gap_drift** | -15.1% | -41.6% | -41.8% | -35.8% | -67.8% | 0.0% | -81.5% | -67.8% |
| **momentum** | 13.6% | -44.5% | -31.2% | -43.9% | -71.0% | -15.1% | -75.7% | -75.4% |
| **buy_and_hold_SPY** | 3.2% | -19.5% | 24.3% | 23.3% | 16.4% | 12.3% | 27.3% | 30.6% |

## Strategies
- **pullback**: Trend pullback: above 50 and 200-day averages, RSI(2) under 10; sell on a close above the 5-day average or after 8 days; stop 2.5 ATR
- **gap_drift**: Gap and hold: up 8%+ at the open on 3x volume, closes near its high; hold 10 days; stop 8% or a close under the gap day's low
- **momentum**: Momentum: monthly, hold the 3 best 6-month performers (skipping the last week) that are above their 200-day average; 20% stop
- **buy_and_hold_SPY**: Buy and hold SPY (prices are split-adjusted; dividends not included)

<details><summary><b>pullback</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| bounce | 873 | 1.4% | $438.24 |
| stop | 145 | -9.7% | −$565.12 |
| time | 19 | -6.3% | −$44.35 |

</details>

<details><summary><b>gap_drift</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| stop | 193 | -8.7% | −$486.81 |
| time | 128 | 7.9% | $279.50 |
| lost_gap | 22 | -4.2% | −$27.80 |

</details>

<details><summary><b>momentum</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| stop | 62 | -20.8% | −$441.79 |
| rebalance | 44 | 13.0% | $206.77 |

</details>

## Method and limits
- Signals use bars through the close of day d only; orders fill at the open of day d+1. Stops fill at the stop price, or at the open if the stock gapped through it.
- Costs per side: 0.10% for pullback and momentum, 0.30% for gap_drift (wider spreads after a gap). The last column repeats the run with costs multiplied by 2.5.
- Stocks are chosen by what was liquid on the day (20-day average dollar volume), not by today's list, and delisted companies are included where Alpaca still serves their history. Companies whose history Alpaca no longer serves are missing, which flatters results a little.
- Fractional shares are assumed. Prices are split-adjusted, not dividend-adjusted. Taxes, borrow fees and overnight news gaps beyond the modeled stop fills are not included.
- Past results do not guarantee future results. Compare with the buy-and-hold row: a strategy that cannot beat holding the index is not worth the risk.
