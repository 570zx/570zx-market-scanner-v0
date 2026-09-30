# MEDS opening-range breakout test: 2026-08-03 to 2026-09-28 (40 trading days)

Each morning, after 09:45 ET, buy the (up to 3) gapping, heavily traded stocks the bot could already see that break above their first-15-minute high. Stop at the low of that range, take profit at a multiple of the risk, sell the rest at 15:50. Starts at $250, one third of the account per trade. Costs: 0.5% per side (the spread the earlier test measured on these stocks); the last column doubles it.

| Variant | Days | Trades | Win rate | Avg trade | Avg R | Final | Return | Max drawdown | Earlier days | Last 10 days | Return if costs ×2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **orb_1_5R** | 40 | 62 | 43.5% | -0.6% | -0.17 | $218.78 | -12.5% | 14.7% | -13.4% | 1.1% | -28.8% |
| **orb_2R** | 40 | 62 | 41.9% | -0.8% | -0.19 | $209.11 | -16.4% | 18.9% | -17.6% | 1.5% | -31.9% |
| **orb_3R** | 40 | 62 | 41.9% | -0.8% | -0.19 | $209.73 | -16.1% | 18.7% | -17.4% | 1.5% | -31.7% |
| **orb_2R_gap5** | 40 | 69 | 40.6% | -0.5% | -0.17 | $220.63 | -11.8% | 15.6% | -9.9% | -2.0% | -29.9% |

## Variants
- **orb_1_5R**: Take profit at 1.5x the risk
- **orb_2R**: Take profit at 2x the risk
- **orb_3R**: Take profit at 3x the risk
- **orb_2R_gap5**: As orb_2R, but only stocks gapping up 5% or more

<details><summary><b>orb_1_5R</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| close | 42 | -0.6% | −$18.58 |
| stop | 11 | -5.5% | −$46.26 |
| target | 9 | 5.1% | $33.62 |

</details>

<details><summary><b>orb_2R</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| close | 49 | 0.1% | $0.30 |
| stop | 11 | -5.5% | −$44.73 |
| target | 2 | 2.4% | $3.53 |

</details>

<details><summary><b>orb_3R</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| close | 50 | 0.1% | $0.83 |
| stop | 11 | -5.5% | −$44.69 |
| target | 1 | 5.1% | $3.59 |

</details>

<details><summary><b>orb_2R_gap5</b> exits</summary>

| Exit | Trades | Avg | P&L |
|---|---:|---:|---:|
| close | 54 | 0.2% | $7.65 |
| stop | 12 | -5.3% | −$49.39 |
| target | 3 | 5.5% | $12.37 |

</details>

## Limits
- Only about 40 days of one-minute data exist, so a few lucky or unlucky trades move the result a lot. Treat it as a first look, not proof.
- Entries fill at the range high (or the open if it gapped above) plus the cost; a fast breakout in a thin stock can fill worse than that.
- If the entry bar also reaches the stop, the stop is assumed to hit first. Halts, borrow and the day-trade limits for small accounts are not modeled.
- Stocks are limited to those the bot's screens showed by 09:45, using the same no-hindsight rules as the intraday backtest.
