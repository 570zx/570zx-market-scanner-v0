# Weak-close ETF strategy: improvement and walk-forward test

Paper research only. 144 portfolio configurations (IBS threshold, number of slots, exit rule, trend filter). Out-of-sample period starts 2019-01-02: each year trades the configuration with the best Sharpe over all EARLIER years, so no result below was chosen with hindsight. Costs: 1 cent per share each way (2 cents round trip), stops add 1 cent of slippage. Sizing: equal share of equity per slot, up to the slot limit, most oversold first.

## Out-of-sample results

| Strategy | CAGR | Sharpe | Max drawdown | Win rate | Trades | Longest losing streak | Positive months | Worst month |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Walk-forward selected | 17.5% | 0.58 | 76.8% | 57.4% | 310 | 8 | 54.3% | -50.0% |
| Original idea (IBS ≤ 0.2, hold 3 days, 5 slots) | 41.5% | 0.97 | 47.6% | 59.0% | 1653 | 19 | 63.8% | -34.8% |
| Hold SPY | 15.6% | 0.86 | 33.6% | — | — | — | 67.0% | -11.7% |

Cost stress (2 cents each way): walk-forward CAGR 37.4%, Sharpe 0.83, drawdown 68.8%; original CAGR 37.9%, Sharpe 0.91.

## Calendar years

| Year | Walk-forward | Original | Hold SPY | Configuration used that year |
|---|---:|---:|---:|---|
| 2019 | 14.9% | 68.3% | 29.5% | IBS ≤ 0.3, 2 slots, exit hold5, trend sma200up |
| 2020 | 48.0% | 139.2% | 16.2% | IBS ≤ 0.3, 1 slots, exit strength5, trend none |
| 2021 | 77.3% | 56.4% | 27.0% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |
| 2022 | -49.1% | -8.2% | -19.5% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |
| 2023 | 29.6% | 53.7% | 24.2% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |
| 2024 | 24.6% | 12.2% | 23.3% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |
| 2025 | 38.6% | 28.0% | 16.5% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |
| 2026 | 1.8% | 16.2% | 12.4% | IBS ≤ 0.1, 1 slots, exit hold5, trend none |

The selected configuration changed 2 times in 7 year-ends. Frequent changes mean the choice is mostly noise; a stable choice means the improvement is a consistent feature.

## By ETF (walk-forward trades)

| ETF | Trades | Win rate | Avg trade |
|---|---:|---:|---:|
| SOXL | 63 | 54.0% | -1.0% |
| UDOW | 37 | 48.6% | -0.4% |
| FAS | 67 | 61.2% | 0.8% |
| TQQQ | 33 | 57.6% | 1.1% |
| TECL | 41 | 63.4% | 2.8% |
| SPXL | 11 | 81.8% | 5.0% |
| UPRO | 7 | 57.1% | -1.6% |
| TNA | 51 | 52.9% | 2.6% |

## All configurations, full period (hindsight, for reference only)

| # | Configuration | CAGR | Sharpe | Max drawdown | Win rate | Trades | Time invested |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | IBS ≤ 0.1, 1 slots, exit hold5, trend none | 53.4% | 1.04 | 68.1% | 58.1% | 327 | 60.5% |
| 2 | IBS ≤ 0.1, 2 slots, exit hold5, trend none | 45.1% | 1.03 | 67.2% | 57.5% | 593 | 54.8% |
| 3 | IBS ≤ 0.1, 2 slots, exit hold5, trend sma200up | 33.1% | 1.03 | 43.2% | 59.2% | 436 | 40.2% |
| 4 | IBS ≤ 0.1, 3 slots, exit strength5, trend none | 34.4% | 0.98 | 48.4% | 65.7% | 909 | 35.3% |
| 5 | IBS ≤ 0.1, 5 slots, exit strength5, trend none | 31.1% | 0.97 | 43.8% | 66.7% | 1296 | 29.9% |
| 6 | IBS ≤ 0.3, 1 slots, exit hold3, trend sma200up | 38.4% | 0.95 | 53.6% | 54.3% | 512 | 57.0% |
| 7 | IBS ≤ 0.1, 2 slots, exit strength5, trend none | 35.3% | 0.94 | 59.1% | 64.9% | 664 | 38.9% |
| 8 | IBS ≤ 0.1, 3 slots, exit hold5, trend sma200up | 26.9% | 0.94 | 45.7% | 59.1% | 589 | 36.3% |
| 9 | IBS ≤ 0.1, 3 slots, exit hold5, trend none | 36.4% | 0.94 | 65.8% | 57.3% | 825 | 51.0% |
| 10 | IBS ≤ 0.1, 1 slots, exit hold5, trend sma200up | 33.7% | 0.92 | 49.6% | 59.0% | 244 | 45.1% |
| 11 | IBS ≤ 0.3, 1 slots, exit strength5, trend sma200up | 36.1% | 0.92 | 48.1% | 64.4% | 469 | 54.8% |
| 12 | IBS ≤ 0.3, 2 slots, exit hold5, trend sma200up | 34.4% | 0.91 | 49.7% | 58.0% | 674 | 62.2% |

## What leverage would the walk-forward series need for 89.0% a year?

Scales the walk-forward daily returns by a leverage multiple L, charging 6% a year on the borrowed part. Illustrative: it assumes returns scale linearly and that you are never forced out, which real margin does not guarantee.

| Leverage | CAGR | Max drawdown | Sharpe |
|---:|---:|---:|---:|
| 1× | 17.5% | 76.8% | 0.58 |
| 2× | -20.0% | 98.0% | 0.53 |
| 3× | -83.8% | 100.0% | 0.52 |
| 4× | -96.4% | 100.0% | 0.57 |
| 5× | -99.7% | 100.0% | 0.61 |
| 6× | -100.0% | 100.0% | 0.65 |
| 8× | -100.0% | 100.0% | 0.79 |

No leverage level up to 8× reaches 89.0% a year.

## Doubling every 6 months?

Every rolling 126-trading-day window of the walk-forward series at each leverage. "Doubled" means the account at least doubled over the window (the goal: +100% every 6 months).

| Leverage | Windows | Doubled | Lost 30%+ | Median | Best | Worst |
|---:|---:|---:|---:|---:|---:|---:|
| 1× | 1833 | 4.5% | 8.5% | 12.2% | 196.6% | -66.5% |
| 2× | 1833 | 12.4% | 27.8% | 6.2% | 533.9% | -96.2% |
| 3× | 1833 | 14.1% | 42.1% | -15.7% | 1142.1% | -100.0% |
| 4× | 1833 | 13.7% | 60.1% | -48.6% | 1978.3% | -100.0% |
| 5× | 1833 | 11.7% | 70.2% | -76.4% | 2843.8% | -100.0% |
| 6× | 1833 | 8.6% | 77.0% | -93.9% | 3366.3% | -100.0% |
| 8× | 1833 | 3.4% | 91.1% | -99.3% | 2242.8% | -100.0% |


## Verdict
Walk-forward Sharpe 0.58 and drawdown 76.8%, against 0.97 and 47.6% for the original idea and 0.86 and 33.6% for holding SPY. The improvements did not clearly beat the original idea out of sample, so the extra rules are not adding reliable value.

## Limits
- Costs are assumptions; stops fill at the stop price less 1 cent (or the open if the day gaps through it), which is optimistic in fast markets.
- Marks and exits use the 15:55 bar open; daily lows are used only to test stops.
- 144 configurations; selection each year uses only earlier data, but the grid itself was designed after seeing the earlier results, so treat the whole as one more candidate, not proof.
- ETFs only; 2016 to 2018 is used only as the first selection window.
