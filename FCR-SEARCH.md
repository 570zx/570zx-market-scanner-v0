# First candle rule: searching for a version with an edge

**Win-rate gate:** only configurations with a 50% to 70% win rate (after costs) on both ETFs in the search period are eligible. "Win" means the trade closed above break-even, including trades that ran to the 15:55 exit in profit.

Paper research only. 1080 configurations were tried on sessions before 2023-01-01 (QQQ 1762, SPY 1762); 220 had enough trades (150+ on both ETFs). Results are net of the 2c round-trip cost scenario. Ranking uses the worse of the QQQ and SPY t-statistics, so a config must work on both.

## How good does luck look?
The same search on direction-flipped trades (which cannot have a real edge) still produced a best worse-of-two t of **-0.385**, and the median config scored -3.539. A real config has to clearly beat the best flipped result, and then survive the untouched later period.

## Best configurations on the search period (before 2023-01-01)

| # | Configuration | QQQ trades | QQQ avg R | QQQ t | SPY trades | SPY avg R | SPY t | Worse t |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | 833 | 0.007 | 0.222 | 836 | 0.004 | 0.137 | 0.137 |
| 2 | 0.5R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | 832 | 0.003 | 0.114 | 805 | 0.003 | 0.143 | 0.114 |
| 3 | 1R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | 833 | 0.007 | 0.222 | 837 | 0.003 | 0.092 | 0.092 |
| 4 | 0.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | 833 | 0.003 | 0.131 | 836 | 0.002 | 0.081 | 0.081 |
| 5 | 0.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | 833 | 0.003 | 0.131 | 837 | 0.000 | 0.020 | 0.020 |
| 6 | 1R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | 832 | 0.006 | 0.190 | 805 | -0.003 | -0.081 | -0.081 |
| 7 | 1R, stop orb, until 13:30, direction gap, min risk 0.10%, min range 0x ATR | 923 | -0.003 | -0.087 | 916 | -0.007 | -0.238 | -0.238 |
| 8 | 0.75R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | 833 | -0.008 | -0.282 | 837 | 0.022 | 0.763 | -0.282 |
| 9 | 0.75R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | 833 | -0.008 | -0.282 | 836 | 0.023 | 0.815 | -0.282 |
| 10 | 0.75R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | 832 | -0.008 | -0.307 | 805 | 0.021 | 0.720 | -0.307 |
| 11 | 0.75R, stop orb, until 13:30, direction gap, min risk 0.10%, min range 0x ATR | 923 | -0.003 | -0.129 | 916 | -0.008 | -0.310 | -0.310 |
| 12 | 1R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | 556 | -0.012 | -0.316 | 552 | 0.032 | 0.787 | -0.316 |
| 13 | 1R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | 556 | -0.012 | -0.316 | 551 | 0.034 | 0.842 | -0.316 |
| 14 | 1R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | 556 | -0.012 | -0.316 | 528 | 0.027 | 0.649 | -0.316 |
| 15 | 1R, stop orb, until 13:30, direction first, min risk 0.00%, min range 0x ATR | 1065 | -0.009 | -0.322 | 1074 | 0.008 | 0.280 | -0.322 |

## The untouched test: 2023-01-01 onward (QQQ 952 sessions, SPY 952 sessions)

Each of the top 8 configurations, run once on sessions the search never saw. Avg R is per trade; 2c and 4c are the cost scenarios.

| # | Configuration | Symbol | Trades | Win rate | Hit target | Hit stop | Avg R gross | Avg R 2c | t (2c) | Avg R 4c |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | QQQ | 405 | 53.8% | 36.5% | 31.4% | 0.069 | 0.058 | 1.364 | 0.048 |
| 1 | 1R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | SPY | 402 | 56.0% | 44.8% | 36.3% | 0.092 | 0.076 | 1.647 | 0.059 |
| 2 | 0.5R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | QQQ | 405 | 66.2% | 62.5% | 23.2% | 0.052 | 0.042 | 1.308 | 0.031 |
| 2 | 0.5R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | SPY | 395 | 67.3% | 64.1% | 28.1% | 0.026 | 0.011 | 0.319 | -0.004 |
| 3 | 1R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 405 | 53.8% | 36.5% | 31.4% | 0.069 | 0.058 | 1.364 | 0.048 |
| 3 | 1R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 402 | 56.0% | 44.8% | 36.3% | 0.092 | 0.076 | 1.647 | 0.059 |
| 4 | 0.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | QQQ | 405 | 66.2% | 62.5% | 23.2% | 0.052 | 0.042 | 1.308 | 0.031 |
| 4 | 0.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | SPY | 402 | 67.7% | 64.4% | 27.9% | 0.030 | 0.015 | 0.442 | -0.001 |
| 5 | 0.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 405 | 66.2% | 62.5% | 23.2% | 0.052 | 0.042 | 1.308 | 0.031 |
| 5 | 0.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 402 | 67.7% | 64.4% | 27.9% | 0.030 | 0.015 | 0.442 | -0.001 |
| 6 | 1R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | QQQ | 405 | 53.8% | 36.5% | 31.4% | 0.069 | 0.058 | 1.364 | 0.048 |
| 6 | 1R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | SPY | 395 | 56.2% | 44.8% | 35.9% | 0.096 | 0.080 | 1.739 | 0.065 |
| 7 | 1R, stop orb, until 13:30, direction gap, min risk 0.10%, min range 0x ATR | QQQ | 464 | 54.3% | 34.5% | 31.0% | 0.054 | 0.043 | 1.094 | 0.032 |
| 7 | 1R, stop orb, until 13:30, direction gap, min risk 0.10%, min range 0x ATR | SPY | 462 | 50.9% | 35.7% | 37.7% | -0.003 | -0.018 | -0.425 | -0.032 |
| 8 | 0.75R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 405 | 58.5% | 48.4% | 28.4% | 0.067 | 0.056 | 1.475 | 0.046 |
| 8 | 0.75R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 402 | 60.7% | 54.7% | 33.1% | 0.067 | 0.051 | 1.256 | 0.035 |

## Verdict
None of the top 8 configurations stayed profitable with t of 2 or more on both ETFs in the untouched period. The search found no version of this strategy with an edge that survives costs on QQQ or SPY shares.

## Limits
- Same cost assumptions and data as the main test; stops on a fast open can fill worse.
- 1080 configurations tried; the luck comparison above is the guide to how much a good-looking search result is worth.
- Only QQQ and SPY shares; futures (NQ, ES) have different costs relative to risk and are not tested.
