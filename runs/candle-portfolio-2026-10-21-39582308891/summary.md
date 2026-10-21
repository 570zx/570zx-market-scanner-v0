# Weak-close ETF strategy: improvement and walk-forward test

Paper research only. 72 portfolio configurations (IBS threshold, number of slots, exit rule, trend filter) on 9 ETFs. Out-of-sample period starts 2019-01-02: each year trades the configuration with the best Sharpe over all EARLIER years, so no result below was chosen with hindsight. Costs: 1 cent per share each way (2 cents round trip), stops add 1 cent of slippage. Sizing: equal share of equity per slot, up to the slot limit, most oversold first.

## Out-of-sample results

| Strategy | CAGR | Sharpe | Max drawdown | Win rate | Trades | Longest losing streak | Positive months | Worst month |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Walk-forward selected | 12.4% | 1.09 | 19.9% | 60.4% | 763 | 12 | 63.8% | -7.9% |
| Original idea (IBS ≤ 0.2, hold 3 days, 5 slots) | 12.4% | 0.97 | 16.6% | 56.7% | 1918 | 23 | 64.9% | -11.1% |
| Hold SPY | 15.6% | 0.86 | 33.6% | — | — | — | 67.0% | -11.7% |

Cost stress (2 cents each way): walk-forward CAGR 11.8%, Sharpe 1.03, drawdown 20.0%; original CAGR 11.2%, Sharpe 0.88.

## Calendar years

| Year | Walk-forward | Original | Hold SPY | Configuration used that year |
|---|---:|---:|---:|---|
| 2019 | 14.8% | 11.3% | 29.5% | IBS ≤ 0.1, 3 slots, exit strength5, trend none |
| 2020 | 22.1% | 20.6% | 16.2% | IBS ≤ 0.1, 3 slots, exit hold5, trend none |
| 2021 | 15.1% | 13.5% | 27.0% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |
| 2022 | -2.5% | 5.0% | -19.5% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |
| 2023 | 21.3% | 16.3% | 24.2% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |
| 2024 | 9.7% | 7.4% | 23.3% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |
| 2025 | 8.0% | 11.8% | 16.5% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |
| 2026 | 9.9% | 11.4% | 12.4% | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up |

The selected configuration changed 2 times in 7 year-ends. Frequent changes mean the choice is mostly noise; a stable choice means the improvement is a consistent feature.

## By ETF (walk-forward trades)

| ETF | Trades | Win rate | Avg trade |
|---|---:|---:|---:|
| XLK | 97 | 61.9% | 0.5% |
| QQQ | 93 | 63.4% | 1.0% |
| GLD | 77 | 62.3% | 0.6% |
| TLT | 51 | 52.9% | 0.2% |
| XLE | 98 | 57.1% | 0.3% |
| XLF | 91 | 60.4% | 0.3% |
| DIA | 88 | 62.5% | 0.3% |
| IWM | 80 | 62.5% | 0.8% |
| SPY | 88 | 58.0% | 0.6% |

## All configurations, full period (hindsight, for reference only)

| # | Configuration | CAGR | Sharpe | Max drawdown | Win rate | Trades | Time invested |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | IBS ≤ 0.1, 5 slots, exit hold5, trend sma200up | 11.6% | 1.48 | 7.5% | 61.4% | 951 | 35.1% |
| 2 | IBS ≤ 0.1, 3 slots, exit hold5, trend sma200up | 13.5% | 1.36 | 12.6% | 60.1% | 719 | 44.2% |
| 3 | IBS ≤ 0.2, 3 slots, exit hold5, trend sma200up | 13.8% | 1.20 | 15.4% | 58.8% | 997 | 61.3% |
| 4 | IBS ≤ 0.1, 5 slots, exit strength5, trend none | 12.1% | 1.20 | 13.8% | 68.4% | 1581 | 36.3% |
| 5 | IBS ≤ 0.2, 5 slots, exit hold5, trend sma200up | 11.4% | 1.20 | 11.4% | 59.8% | 1411 | 52.2% |
| 6 | IBS ≤ 0.1, 3 slots, exit strength5, trend none | 14.5% | 1.18 | 17.4% | 67.2% | 1205 | 46.3% |
| 7 | IBS ≤ 0.1, 3 slots, exit strength5, trend sma200up | 10.1% | 1.17 | 13.2% | 68.0% | 806 | 31.0% |
| 8 | IBS ≤ 0.1, 5 slots, exit strength5, trend sma200up | 7.4% | 1.11 | 7.8% | 68.4% | 1026 | 23.5% |
| 9 | IBS ≤ 0.3, 5 slots, exit hold5, trend sma200up | 10.9% | 1.09 | 10.6% | 58.2% | 1679 | 62.0% |
| 10 | IBS ≤ 0.2, 5 slots, exit strength5, trend none | 13.4% | 1.09 | 17.3% | 65.6% | 2429 | 55.7% |
| 11 | IBS ≤ 0.1, 5 slots, exit hold5, trend none | 12.4% | 1.09 | 16.2% | 58.8% | 1405 | 51.9% |
| 12 | IBS ≤ 0.2, 3 slots, exit strength5, trend sma200up | 11.3% | 1.08 | 19.5% | 65.8% | 1259 | 47.9% |

## Verdict
Walk-forward Sharpe 1.09 and drawdown 19.9%, against 0.97 and 16.6% for the original idea and 0.86 and 33.6% for holding SPY. The improvements did not clearly beat the original idea out of sample, so the extra rules are not adding reliable value.

## Limits
- Costs are assumptions; stops fill at the stop price less 1 cent (or the open if the day gaps through it), which is optimistic in fast markets.
- Marks and exits use the 15:55 bar open; daily lows are used only to test stops.
- 72 configurations; selection each year uses only earlier data, but the grid itself was designed after seeing the earlier results, so treat the whole as one more candidate, not proof.
- ETFs only; 2016 to 2018 is used only as the first selection window.
