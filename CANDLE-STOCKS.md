# Weak-close edge on individual stocks

Paper research only. 128 large US stocks loaded (2016-01-04 to 2026-10-19). The universe is today's survivors of an early-2016 large-cap list, so names that were later acquired or delisted are missing; that flatters any dip-buying result, which is why the signal is compared with the same trade on every stock that day. Rules are frozen from the ETF work. Costs: 2 cents per share each way unless stated.

## Signal quality: low-IBS trades versus the same trade on every stock that day

"Excess" is per trade after costs, averaged by day (so correlated stocks count once per day). t is across days.

| IBS | Trend filter | Hold | Trades | Win rate | Avg trade (bp) | Excess (bp) | Excess t | Excess t 2016–22 | Excess t 2023+ |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| ≤ 0.1 | none | day1 | 36472 | 52.9% | 7.9 | 4.2 | 1.71 | 1.09 | 1.48 |
| ≤ 0.1 | none | day3 | 36434 | 54.3% | 25.4 | 6.0 | 1.57 | 1.35 | 0.80 |
| ≤ 0.1 | none | day5 | 36410 | 54.7% | 42.9 | 5.0 | 1.00 | 1.21 | -0.11 |
| ≤ 0.1 | sma200up | day1 | 18305 | 53.0% | 6.7 | 3.5 | 1.32 | 0.90 | 1.01 |
| ≤ 0.1 | sma200up | day3 | 18286 | 54.7% | 25.7 | 7.0 | 1.55 | 1.45 | 0.64 |
| ≤ 0.1 | sma200up | day5 | 18271 | 55.3% | 44.2 | 4.7 | 0.80 | 1.01 | -0.06 |
| ≤ 0.2 | none | day1 | 70697 | 52.4% | 6.7 | 1.8 | 0.86 | 0.76 | 0.40 |
| ≤ 0.2 | none | day3 | 70626 | 53.5% | 20.8 | 0.5 | 0.16 | -0.18 | 0.72 |
| ≤ 0.2 | none | day5 | 70584 | 53.8% | 34.6 | 0.9 | 0.23 | 0.12 | 0.26 |
| ≤ 0.2 | sma200up | day1 | 36329 | 52.2% | 4.2 | 1.2 | 0.58 | 0.78 | -0.08 |
| ≤ 0.2 | sma200up | day3 | 36288 | 53.8% | 18.5 | 0.4 | 0.11 | 0.51 | -0.55 |
| ≤ 0.2 | sma200up | day5 | 36259 | 53.9% | 30.5 | 0.9 | 0.19 | 0.58 | -0.47 |

### By year (IBS ≤ 0.1, sma200up, day5)

| Year | Trades | Win rate | Avg trade (bp) | Excess (bp) |
|---|---:|---:|---:|---:|
| 2016 | 465 | 54.0% | 64.3 | -40.9 |
| 2017 | 2023 | 58.4% | 48.5 | 3.5 |
| 2018 | 1844 | 52.4% | 5.9 | 19.0 |
| 2019 | 1569 | 58.4% | 43.4 | 3.1 |
| 2020 | 1728 | 61.7% | 120.9 | 46.0 |
| 2021 | 2728 | 56.3% | 69.5 | -9.2 |
| 2022 | 1318 | 45.5% | -51.0 | 2.5 |
| 2023 | 1558 | 54.2% | 26.3 | -21.3 |
| 2024 | 2000 | 54.0% | 36.4 | 7.7 |
| 2025 | 1486 | 57.6% | 69.4 | 15.4 |
| 2026 | 1552 | 51.5% | 33.0 | -6.5 |

## Portfolio on the stock universe

| Candidate | Slots | Costs | CAGR | Sharpe | Max drawdown | Win rate | Trades | Longest losing streak | Positive months | Time invested |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 5 | 1c/side | 7.0% | 0.47 | 32.9% | 53.8% | 2264 | 10 | 51.5% | 85.3% |
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 5 | 2c/side | 5.6% | 0.40 | 35.9% | 53.3% | 2264 | 12 | 50.8% | 85.4% |
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 10 | 1c/side | 10.7% | 0.73 | 30.4% | 53.6% | 4367 | 17 | 56.2% | 81.4% |
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 10 | 2c/side | 9.3% | 0.65 | 30.8% | 53.1% | 4367 | 17 | 54.6% | 81.4% |
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 20 | 1c/side | 12.6% | 0.98 | 21.7% | 54.0% | 7918 | 24 | 61.5% | 73.5% |
| A: IBS ≤ 0.1, hold 5 days, only above 200-day average | 20 | 2c/side | 11.4% | 0.89 | 22.2% | 53.6% | 7918 | 24 | 60.8% | 73.5% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 5 | 1c/side | 14.4% | 0.71 | 41.4% | 60.8% | 3568 | 12 | 57.7% | 93.3% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 5 | 2c/side | 11.3% | 0.59 | 45.1% | 60.2% | 3568 | 12 | 57.7% | 93.4% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 10 | 1c/side | 11.4% | 0.64 | 45.8% | 60.8% | 6961 | 16 | 59.2% | 89.8% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 10 | 2c/side | 8.4% | 0.50 | 49.1% | 60.4% | 6961 | 16 | 56.9% | 89.8% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 20 | 1c/side | 12.1% | 0.74 | 36.0% | 61.2% | 12976 | 22 | 58.5% | 82.9% |
| B: IBS ≤ 0.1, sell on strength (max 5 days), no trend filter | 20 | 2c/side | 9.5% | 0.60 | 38.4% | 60.7% | 12976 | 22 | 56.9% | 82.9% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 5 | 1c/side | 9.0% | 0.47 | 58.1% | 52.4% | 4431 | 14 | 53.8% | 98.0% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 5 | 2c/side | 5.3% | 0.33 | 64.0% | 51.9% | 4431 | 14 | 51.5% | 98.0% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 10 | 1c/side | 8.9% | 0.49 | 60.1% | 52.5% | 8758 | 22 | 59.2% | 96.9% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 10 | 2c/side | 5.4% | 0.35 | 63.1% | 51.8% | 8758 | 22 | 57.7% | 96.9% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 20 | 1c/side | 10.7% | 0.61 | 45.4% | 52.8% | 17021 | 34 | 61.5% | 94.2% |
| C: IBS ≤ 0.2, hold 3 days (original idea) | 20 | 2c/side | 7.2% | 0.45 | 49.3% | 52.1% | 17021 | 34 | 56.2% | 94.2% |
| Hold SPY | — | — | 13.3% | 0.80 | 33.6% | — | — | — | 69.2% | 100% |
| Equal-weight hold of these stocks | — | — | 12.3% | 0.73 | 41.0% | — | — | — | 68.5% | 100% |

### Calendar years (candidate A, 10 slots, 2c/side)

| Year | Candidate A | Hold SPY | Equal-weight stocks |
|---|---:|---:|---:|
| 2016 | 8.6% | 11.1% | 16.9% |
| 2017 | 18.6% | 19.8% | 19.1% |
| 2018 | -7.8% | -6.9% | -15.4% |
| 2019 | 5.1% | 29.5% | 24.1% |
| 2020 | 29.0% | 16.2% | 9.3% |
| 2021 | 37.0% | 27.0% | 27.0% |
| 2022 | -21.5% | -19.5% | -9.3% |
| 2023 | 9.7% | 24.2% | 15.4% |
| 2024 | 6.5% | 23.3% | 15.5% |
| 2025 | 11.6% | 16.5% | 21.6% |
| 2026 | 15.1% | 12.4% | 17.6% |

## Verdict
The signal does not replicate on stocks: neither frozen signal clears excess t of 2 with a positive average after costs and a 50%+ win rate.
 As portfolios (10 slots, 2c/side), no frozen candidate had a higher Sharpe than both SPY and the equal-weight stock universe.

## Limits
- Survivorship bias remains: companies that were delisted or acquired after 2016 are mostly absent, and stocks that crashed and disappeared are exactly where dip-buying loses.
- Daily candles come from 5-minute bars; entries and exits use the open of the 15:55 bar. Costs are flat per-share assumptions; real stock spreads vary and are wider for smaller or busier-news names.
- Stops and earnings gaps matter more for single stocks than for ETFs; candidate B and C have no stop, A has none either.
- No tuning was done on stocks.
