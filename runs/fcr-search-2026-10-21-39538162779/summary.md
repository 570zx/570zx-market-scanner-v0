# First candle rule: searching for a version with an edge

Paper research only. 864 configurations were tried on sessions before 2023-01-01 (QQQ 1762, SPY 1762); 376 had enough trades (150+ on both ETFs). Results are net of the 2c round-trip cost scenario. Ranking uses the worse of the QQQ and SPY t-statistics, so a config must work on both.

## How good does luck look?
The same search on direction-flipped trades (which cannot have a real edge) still produced a best worse-of-two t of **-0.144**, and the median config scored -2.442. A real config has to clearly beat the best flipped result, and then survive the untouched later period.

## Best configurations on the search period (before 2023-01-01)

| # | Configuration | QQQ trades | QQQ avg R | QQQ t | SPY trades | SPY avg R | SPY t | Worse t |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | 556 | 0.065 | 1.187 | 551 | 0.060 | 1.013 | 1.013 |
| 2 | 3R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | 556 | 0.065 | 1.187 | 552 | 0.058 | 0.976 | 0.976 |
| 3 | 2R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | 556 | 0.059 | 1.161 | 551 | 0.046 | 0.858 | 0.858 |
| 4 | 2R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | 556 | 0.059 | 1.161 | 552 | 0.043 | 0.816 | 0.816 |
| 5 | 3R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | 556 | 0.065 | 1.187 | 528 | 0.046 | 0.776 | 0.776 |
| 6 | 2R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | 556 | 0.059 | 1.161 | 528 | 0.039 | 0.729 | 0.729 |
| 7 | 1.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | 833 | 0.019 | 0.540 | 837 | 0.029 | 0.763 | 0.540 |
| 8 | 1.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | 833 | 0.019 | 0.540 | 836 | 0.030 | 0.802 | 0.540 |
| 9 | 1.5R, stop orb, until 11:30, direction first, min risk 0.10%, min range 0x ATR | 832 | 0.017 | 0.495 | 805 | 0.028 | 0.724 | 0.495 |
| 10 | 1.5R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | 556 | 0.022 | 0.482 | 552 | 0.075 | 1.546 | 0.482 |
| 11 | 1.5R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | 556 | 0.022 | 0.482 | 551 | 0.077 | 1.593 | 0.482 |
| 12 | 1.5R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | 556 | 0.022 | 0.482 | 528 | 0.072 | 1.463 | 0.482 |
| 13 | 2R, stop orb, until 13:30, direction first, min risk 0.05%, min range 0x ATR | 1065 | 0.020 | 0.592 | 1073 | 0.013 | 0.386 | 0.386 |
| 14 | 2R, stop orb, until 13:30, direction first, min risk 0.00%, min range 0x ATR | 1065 | 0.020 | 0.592 | 1074 | 0.012 | 0.354 | 0.354 |
| 15 | 2R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | 833 | 0.037 | 0.960 | 836 | 0.010 | 0.245 | 0.245 |

## The untouched test: 2023-01-01 onward (QQQ 952 sessions, SPY 952 sessions)

Each of the top 8 configurations, run once on sessions the search never saw. Avg R is per trade; 2c and 4c are the cost scenarios.

| # | Configuration | Symbol | Trades | Win rate | Avg R gross | Avg R 2c | t (2c) | Avg R 4c |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 3R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | QQQ | 264 | 47.0% | 0.125 | 0.114 | 1.483 | 0.102 |
| 1 | 3R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | SPY | 256 | 46.5% | 0.255 | 0.237 | 2.608 | 0.219 |
| 2 | 3R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 264 | 47.0% | 0.125 | 0.114 | 1.483 | 0.102 |
| 2 | 3R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 256 | 46.5% | 0.255 | 0.237 | 2.608 | 0.219 |
| 3 | 2R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | QQQ | 264 | 48.1% | 0.098 | 0.087 | 1.262 | 0.076 |
| 3 | 2R, stop orb, until 10:30, direction first, min risk 0.05%, min range 0x ATR | SPY | 256 | 48.8% | 0.222 | 0.204 | 2.562 | 0.186 |
| 4 | 2R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 264 | 48.1% | 0.098 | 0.087 | 1.262 | 0.076 |
| 4 | 2R, stop orb, until 10:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 256 | 48.8% | 0.222 | 0.204 | 2.562 | 0.186 |
| 5 | 3R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | QQQ | 264 | 47.0% | 0.125 | 0.114 | 1.483 | 0.102 |
| 5 | 3R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | SPY | 252 | 46.4% | 0.243 | 0.225 | 2.487 | 0.208 |
| 6 | 2R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | QQQ | 264 | 48.1% | 0.098 | 0.087 | 1.262 | 0.076 |
| 6 | 2R, stop orb, until 10:30, direction first, min risk 0.10%, min range 0x ATR | SPY | 252 | 48.8% | 0.218 | 0.200 | 2.502 | 0.183 |
| 7 | 1.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | QQQ | 405 | 49.9% | 0.082 | 0.072 | 1.456 | 0.061 |
| 7 | 1.5R, stop orb, until 11:30, direction first, min risk 0.00%, min range 0x ATR | SPY | 402 | 52.0% | 0.156 | 0.139 | 2.557 | 0.123 |
| 8 | 1.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | QQQ | 405 | 49.9% | 0.082 | 0.072 | 1.456 | 0.061 |
| 8 | 1.5R, stop orb, until 11:30, direction first, min risk 0.05%, min range 0x ATR | SPY | 402 | 52.0% | 0.156 | 0.139 | 2.557 | 0.123 |

## Verdict
None of the top 8 configurations stayed profitable with t of 2 or more on both ETFs in the untouched period. The search found no version of this strategy with an edge that survives costs on QQQ or SPY shares.

## Limits
- Same cost assumptions and data as the main test; stops on a fast open can fill worse.
- 864 configurations tried; the luck comparison above is the guide to how much a good-looking search result is worth.
- Only QQQ and SPY shares; futures (NQ, ES) have different costs relative to risk and are not tested.
