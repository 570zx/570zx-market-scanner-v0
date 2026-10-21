# Candle-pattern edge search across liquid ETFs

Paper research only. 287 configurations (daily candle patterns, first-30-minute candle, late-day drift) on 9 ETFs (SPY, QQQ, IWM, DIA, XLF, XLK, XLE, TLT, GLD). Eligible only if, on sessions before 2023-01-01: at least 75% of ETFs have a win rate of 50% or more, a positive average after costs and beat the same trade taken every day; and at least 70% of years are positive. 39 qualified. Costs: 2 cents per share round trip (4 cents shown as a stress).

## What luck looks like
The identical search on shuffled returns found an eligible configuration in 16 of 20 shuffles; their best median excess t: median 0.611, highest 0.970. A real result should clearly exceed the highest shuffled value.

## Best on the search period

| # | Configuration | ETFs passing | Years positive | Pooled trades | Win rate | Avg trade (bp) | Median excess t |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | ibs<=0.2 (long), trend none, hold day2 | 8/9 | 85.7% | 2945 | 56.3% | 18.7 | 1.761 |
| 2 | ibs<=0.3 (long), trend sma200up, hold day5 | 8/9 | 85.7% | 2298 | 59.7% | 42.5 | 1.681 |
| 3 | ibs<=0.2 (long), trend sma200up, hold day5 | 9/9 | 85.7% | 1570 | 61.3% | 52.0 | 1.523 |
| 4 | ibs<=0.2 (long), trend none, hold day1 | 8/9 | 85.7% | 2945 | 54.6% | 11.5 | 1.497 |
| 5 | ibs<=0.2 (long), trend none, hold day3 | 7/9 | 85.7% | 2945 | 55.2% | 22.4 | 1.486 |
| 6 | ibs<=0.1 (long), trend none, hold day1 | 7/9 | 71.4% | 1506 | 55.4% | 12.7 | 1.479 |
| 7 | ibs<=0.2 (long), trend none, hold day5 | 7/9 | 85.7% | 2945 | 57.9% | 36.9 | 1.444 |
| 8 | ibs<=0.1 (long), trend none, hold day3 | 9/9 | 85.7% | 1506 | 57.8% | 28.6 | 1.431 |
| 9 | ibs<=0.3 (long), trend sma50up, hold day5 | 7/9 | 71.4% | 2223 | 58.7% | 31.3 | 1.328 |
| 10 | ibs<=0.1 (long), trend none, hold day2 | 8/9 | 85.7% | 1506 | 57.2% | 21.0 | 1.264 |
| 11 | ibs<=0.1 (long), trend none, hold day5 | 9/9 | 85.7% | 1506 | 58.6% | 45.8 | 1.261 |
| 12 | ibs<=0.2 (long), trend sma50up, hold day3 | 8/9 | 100.0% | 1474 | 56.2% | 23.8 | 1.238 |
| 13 | ibs<=0.2 (long), trend sma50up, hold day2 | 8/9 | 85.7% | 1474 | 56.9% | 16.1 | 1.206 |
| 14 | ibs<=0.3 (long), trend none, hold day1 | 7/9 | 85.7% | 4319 | 54.5% | 9.3 | 1.154 |
| 15 | ibs<=0.3 (long), trend none, hold day2 | 9/9 | 85.7% | 4319 | 56.2% | 16.0 | 1.102 |

## Untouched test: 2023-01-01 onward

Each of the top 10, run once. "ETFs good" = win rate at or above the floor with a positive average after 2c costs (30+ trades).

| # | Configuration | ETFs good | Trades | Win rate | Avg trade (bp) | Avg at 4c (bp) | Median t | Years positive | Max drawdown (%) | Passes |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | ibs<=0.2 (long), trend none, hold day2 | 8/9 | 1616 | 56.1% | 15.9 | 14.1 | 1.578 | 100.0% | 47.2 | no |
| 2 | ibs<=0.3 (long), trend sma200up, hold day5 | 8/9 | 1728 | 56.0% | 33.9 | 32.4 | 1.425 | 100.0% | 46.8 | no |
| 3 | ibs<=0.2 (long), trend sma200up, hold day5 | 8/9 | 1169 | 56.8% | 36.4 | 34.8 | 1.535 | 100.0% | 39.1 | no |
| 4 | ibs<=0.2 (long), trend none, hold day1 | 7/9 | 1621 | 55.7% | 12.1 | 10.2 | 1.350 | 100.0% | 23.1 | no |
| 5 | ibs<=0.2 (long), trend none, hold day3 | 8/9 | 1615 | 56.4% | 30.3 | 28.4 | 2.201 | 100.0% | 59.4 | **yes** |
| 6 | ibs<=0.1 (long), trend none, hold day1 | 8/9 | 781 | 56.7% | 11.2 | 9.4 | 1.334 | 100.0% | 34.1 | no |
| 7 | ibs<=0.2 (long), trend none, hold day5 | 8/9 | 1611 | 55.8% | 37.2 | 35.4 | 1.966 | 100.0% | 79.6 | no |
| 8 | ibs<=0.1 (long), trend none, hold day3 | 8/9 | 779 | 58.2% | 44.0 | 42.2 | 1.968 | 100.0% | 21.4 | no |
| 9 | ibs<=0.3 (long), trend sma50up, hold day5 | 8/9 | 1346 | 56.5% | 32.3 | 30.7 | 1.554 | 100.0% | 61.7 | no |
| 10 | ibs<=0.1 (long), trend none, hold day2 | 7/9 | 780 | 57.6% | 18.6 | 16.8 | 1.507 | 100.0% | 46.6 | no |

### Per-ETF detail for the best untouched-test result

ibs<=0.2 (long), trend none, hold day3

| ETF | Trades | Win rate | Avg trade (bp) | t | Same trade every day (bp) |
|---|---:|---:|---:|---:|---:|
| SPY | 167 | 61.1% | 47.3 | 3.367 | 23.0 |
| QQQ | 173 | 62.4% | 63.7 | 3.511 | 33.6 |
| IWM | 195 | 52.8% | 36.6 | 2.201 | 15.6 |
| DIA | 176 | 61.9% | 23.0 | 1.907 | 15.0 |
| XLF | 178 | 58.4% | 24.5 | 1.625 | 12.0 |
| XLK | 174 | 59.2% | 55.4 | 2.603 | 37.1 |
| XLE | 180 | 57.2% | 20.3 | 1.115 | 13.6 |
| TLT | 220 | 43.2% | -24.5 | -2.551 | -9.1 |
| GLD | 152 | 55.3% | 42.9 | 2.429 | 26.9 |

| Year | Pooled trades | Win rate | Avg trade (bp) |
|---|---:|---:|---:|
| 2023 | 479 | 54.3% | 29.1 |
| 2024 | 416 | 57.0% | 17.7 |
| 2025 | 374 | 60.7% | 37.8 |
| 2026 | 346 | 54.0% | 38.9 |

## Verdict
1 of the top 10 configurations passed every test on data the search never saw: undefined (short), trend undefined, hold [object Object]. With 287 tries and this being one holdout, they are candidates for a forward paper test, not proof.

## Limits
- Costs are assumptions. Entries and exits use the open of a named minute bar (15:55, 09:30, 10:00, 11:30, 15:30), with no look-ahead; real fills can be worse.
- Signals use only bars before the decision time; daily patterns are decided at 15:55 from bars up to 15:54.
- ETFs only; single stocks, futures and options are not covered.
- 287 tries: a good-looking row is expected by chance, which is why the luck comparison and the untouched test matter.
