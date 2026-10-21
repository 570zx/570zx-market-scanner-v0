# First candle rule: QQQ and SPY, one-minute bars

Paper research only; no orders are placed. Rules are from a short promotional video, so every unstated detail is a choice made here (listed at the bottom). The headline configuration was fixed before any results were seen: 3:1 reward to risk, stop beyond the engulfing candle, entries until 11:30 ET, one trade a day, flat at 15:55. All other rows are sensitivity checks and count as extra tries, not as new evidence.

## QQQ: 2016-01-04 to 2026-10-19 (2714 sessions)

Break-even win rate at 3:1 is 25% before costs. R is one unit of risk per trade; t is the t-statistic of average R (about 2 or more is "unlikely to be luck", before allowing for the many variants tried).

| Costs | Trades | Win rate | Avg R | Total R | t | Profit factor | Max drawdown (R) | Hit stop | Hit target |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| no costs | 1929 | 25.7% | 0.029 | 55.000 | 0.716 | 1.038 | 56.000 | 74.3% | 25.7% |
| 2c round trip, +1c on stops | 1929 | 25.7% | -0.203 | -391.985 | -4.964 | 0.781 | 403.169 | 74.3% | 25.7% |
| 4c round trip, +2c on stops | 1929 | 25.7% | -0.435 | -838.969 | -10.181 | 0.610 | 846.339 | 74.3% | 25.7% |

Control, same entries traded the opposite way with the same geometry: gross avg R -0.014 (t -0.362), 2c costs -0.248. If the rule had real direction information, the real trades should beat this clearly.

Long trades (2c costs): 1028 trades, avg R -0.158. Short trades: 901 trades, avg R -0.255. First half of trades: avg R -0.347, second half: -0.060.

| Year | Trades | Win rate | Avg R (2c costs) | Total R |
|---|---:|---:|---:|---:|
| 2016 | 186 | 26.9% | -0.447 | -83.088 |
| 2017 | 187 | 21.4% | -0.694 | -129.700 |
| 2018 | 194 | 23.7% | -0.331 | -64.234 |
| 2019 | 180 | 32.8% | -0.007 | -1.309 |
| 2020 | 181 | 22.1% | -0.285 | -51.603 |
| 2021 | 178 | 30.3% | 0.069 | 12.254 |
| 2022 | 171 | 22.2% | -0.200 | -34.214 |
| 2023 | 169 | 24.9% | -0.142 | -23.973 |
| 2024 | 169 | 27.2% | -0.014 | -2.391 |
| 2025 | 168 | 28.6% | 0.060 | 10.007 |
| 2026 | 146 | 22.6% | -0.163 | -23.734 |

<details><summary>Sensitivity grid (avg R per trade)</summary>

| Target | Stop | Last entry | Trades | Gross | 2c costs | 4c costs | Win rate (gross) |
|---:|---|---|---:|---:|---:|---:|---:|
| 1R | engulf | 11:30 | 1929 | 0.010 | -0.202 | -0.414 | 50.5% |
| 1R | engulf | 15:30 | 2585 | 0.013 | -0.218 | -0.449 | 50.7% |
| 1R | fvg | 11:30 | 1949 | 0.012 | -0.150 | -0.312 | 50.6% |
| 1R | fvg | 15:30 | 2616 | 0.020 | -0.159 | -0.339 | 51.0% |
| 2R | engulf | 11:30 | 1929 | 0.033 | -0.192 | -0.417 | 34.4% |
| 2R | engulf | 15:30 | 2585 | 0.041 | -0.204 | -0.449 | 34.7% |
| 2R | fvg | 11:30 | 1949 | 0.026 | -0.147 | -0.319 | 34.2% |
| 2R | fvg | 15:30 | 2616 | 0.035 | -0.157 | -0.348 | 34.6% |
| 3R | engulf | 11:30 | 1929 | 0.029 | -0.203 | -0.435 | 25.7% |
| 3R | engulf | 15:30 | 2585 | 0.028 | -0.226 | -0.479 | 25.8% |
| 3R | fvg | 11:30 | 1949 | 0.026 | -0.152 | -0.330 | 25.7% |
| 3R | fvg | 15:30 | 2616 | 0.025 | -0.173 | -0.371 | 25.7% |

</details>

## SPY: 2016-01-04 to 2026-10-19 (2714 sessions)

Break-even win rate at 3:1 is 25% before costs. R is one unit of risk per trade; t is the t-statistic of average R (about 2 or more is "unlikely to be luck", before allowing for the many variants tried).

| Costs | Trades | Win rate | Avg R | Total R | t | Profit factor | Max drawdown (R) | Hit stop | Hit target |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| no costs | 1956 | 26.0% | 0.038 | 74.291 | 0.958 | 1.051 | 60.000 | 74.0% | 25.9% |
| 2c round trip, +1c on stops | 1956 | 26.0% | -0.195 | -381.459 | -4.777 | 0.790 | 455.730 | 74.0% | 25.9% |
| 4c round trip, +2c on stops | 1956 | 26.0% | -0.428 | -837.208 | -10.069 | 0.618 | 881.207 | 74.0% | 25.9% |

Control, same entries traded the opposite way with the same geometry: gross avg R -0.026 (t -0.661), 2c costs -0.258. If the rule had real direction information, the real trades should beat this clearly.

Long trades (2c costs): 1051 trades, avg R -0.245. Short trades: 905 trades, avg R -0.137. First half of trades: avg R -0.355, second half: -0.035.

| Year | Trades | Win rate | Avg R (2c costs) | Total R |
|---|---:|---:|---:|---:|
| 2016 | 195 | 23.1% | -0.459 | -89.470 |
| 2017 | 192 | 21.9% | -0.626 | -120.169 |
| 2018 | 200 | 26.0% | -0.234 | -46.808 |
| 2019 | 198 | 25.3% | -0.286 | -56.673 |
| 2020 | 173 | 25.4% | -0.175 | -30.329 |
| 2021 | 185 | 25.4% | -0.184 | -34.023 |
| 2022 | 164 | 27.4% | 0.010 | 1.606 |
| 2023 | 169 | 21.9% | -0.298 | -50.378 |
| 2024 | 175 | 26.3% | -0.114 | -19.895 |
| 2025 | 167 | 36.5% | 0.359 | 60.027 |
| 2026 | 138 | 28.3% | 0.034 | 4.652 |

<details><summary>Sensitivity grid (avg R per trade)</summary>

| Target | Stop | Last entry | Trades | Gross | 2c costs | 4c costs | Win rate (gross) |
|---:|---|---|---:|---:|---:|---:|---:|
| 1R | engulf | 11:30 | 1956 | -0.025 | -0.239 | -0.454 | 48.8% |
| 1R | engulf | 15:30 | 2606 | -0.030 | -0.259 | -0.488 | 48.5% |
| 1R | fvg | 11:30 | 1969 | -0.014 | -0.176 | -0.338 | 49.3% |
| 1R | fvg | 15:30 | 2623 | -0.017 | -0.193 | -0.368 | 49.1% |
| 2R | engulf | 11:30 | 1956 | -0.008 | -0.235 | -0.463 | 33.1% |
| 2R | engulf | 15:30 | 2606 | -0.014 | -0.257 | -0.499 | 32.9% |
| 2R | fvg | 11:30 | 1969 | 0.017 | -0.155 | -0.326 | 33.9% |
| 2R | fvg | 15:30 | 2623 | 0.004 | -0.182 | -0.368 | 33.5% |
| 3R | engulf | 11:30 | 1956 | 0.038 | -0.195 | -0.428 | 26.0% |
| 3R | engulf | 15:30 | 2606 | 0.031 | -0.217 | -0.465 | 25.8% |
| 3R | fvg | 11:30 | 1969 | 0.018 | -0.159 | -0.336 | 25.5% |
| 3R | fvg | 15:30 | 2623 | 0.017 | -0.174 | -0.366 | 25.5% |

</details>

## Choices the video does not settle
- Instrument: the video does not say. QQQ and SPY shares stand in for NQ and ES futures; futures have different costs and tick sizes, so a futures result could differ.
- "Break through the level and create a gap": read as a 1-minute bar that CLOSES beyond the first-candle high or low, with a fair value gap (the bar before and the bar after do not overlap).
- "Candle engulfing": the candle body engulfs the previous candle body, in the breakout direction, after price trades back into the gap. Entry at that candle's close.
- Stop: beyond the engulfing candle (the video's risk box looks about that size). A stop beyond the gap is in the grid.
- One trade a day, no break-even or partials, flat at 15:55. The video gives no time cutoff, so 11:30 is a choice; a 15:30 cutoff is in the grid.
- If one bar touches both stop and target, the stop is assumed to hit first.

## Limits
- Costs are assumptions, not measurements; stops on a fast open can fill much worse than 1 to 2 cents.
- Many variants were tried; only the headline row was fixed in advance.
- Data is Alpaca SIP one-minute bars, split-adjusted. Minutes with no trades have no bar, which slightly changes how gaps look on quiet days.
