# MEDS backtest: 2026-08-03 to 2026-09-28 (40 trading days)

Replays MEDS's production Leader code (meds-v8.1-leader250-capacity / leader-hunt-v8.6-exit-liquidity) minute by minute over real market history, starting from $250 each rule set. Market data: Alpaca historical consolidated tape. 

| Rule set | Trades | Win rate | Avg trade | Paper P&L | Same trades at real quotes | Live mirror P&L | Max drawdown | Held overnight |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **v86_baseline** | 715 | 26.1% | -2.5% | −$171.59 | −$160.68 | −$58.70 | 69.6% | 321 |
| **flat_close** | 778 | 27.3% | -2.2% | −$161.79 | −$138.96 | −$50.22 | 66.6% | 8 |
| **no_chase_10_flat** | 817 | 35.0% | -1.2% | −$95.04 | −$74.04 | −$23.44 | 39.6% | 10 |
| **no_chase_20_flat** | 817 | 34.3% | -1.1% | −$89.71 | −$65.17 | −$29.33 | 38.1% | 10 |
| **trail_flat** | 838 | 32.6% | -1.5% | −$118.61 | −$82.50 | −$34.17 | 48.4% | 8 |
| **tp15_flat** | 850 | 31.1% | -0.9% | −$75.56 | −$59.09 | −$24.66 | 31.4% | 9 |
| **hold60_flat** | 889 | 27.6% | -1.3% | −$110.79 | −$79.54 | −$51.49 | 45.7% | 0 |
| **stop3_flat** | 736 | 21.7% | -2.6% | −$180.54 | −$153.23 | −$66.55 | 73.2% | 6 |
| **stop8_flat** | 781 | 31.8% | -1.9% | −$141.62 | −$120.36 | −$51.26 | 61.3% | 12 |

**Paper P&L**: the paper account ($250, fractional shares) marked at the last trade, using the modeled spread. **Same trades at real quotes**: those exact trades re-priced at the real NBBO one minute after each decision (bought at the ask, sold at the bid). **Live mirror P&L**: what the Robinhood mirror would have done with those decisions — whole shares, $12 orders, its 3% spread and 2% chase limits, 3 orders a minute.

## Rule sets
- **v86_baseline**: Today's rules (v8.6): 5% stop, 12-hour time exit, ladder to +200%, holds overnight
- **flat_close**: v8.6, but no new buys in the last 30 minutes and everything sold 10 minutes before the close
- **no_chase_10_flat**: Flat by the close, and only buy stocks up 10% or less on the day
- **no_chase_20_flat**: Flat by the close, and only buy stocks up 20% or less on the day
- **trail_flat**: Flat by the close; once up 6%, sell if it falls 4% from its best price
- **tp15_flat**: Flat by the close; take the whole profit at +15%
- **hold60_flat**: Flat by the close; sell after 60 minutes at most
- **stop3_flat**: Flat by the close; 3% stop instead of 5%
- **stop8_flat**: Flat by the close; 8% stop instead of 5%

<details><summary><b>v86_baseline</b>: 715 trades, paper −$171.59, live −$58.70</summary>

- Entries 719 (17.98/day); closed 715, open at end 4; median hold 150 min; median trade -5.1%
- Equity $78.41 (-68.6%); best day $7.91, worst day −$14.99, losing days 32/40; risk governor stopped buys on 29 days
- Held overnight: 321 trades (44.9%), P&L $108.51
- Real-quote check: 718 trades priced, median spread paid 0.5% in / 0.7% out
- Live mirror: 419 buys, 423 sells, 418 round trips, win rate 28.9%; skipped SPREAD_TOO_WIDE 49, PRICE_ABOVE_ORDER_CAP 164, EXIT_NOT_HELD_LIVE 370, PRICE_MOVED_AWAY 57, LIVE_QUOTE_STALE 29, FRACTION_BELOW_ONE_SHARE 28, NO_LIVE_QUOTE 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| stop | 382 | 0.8% | -8.1% | −$298.16 |
| time | 298 | 61.1% | 4.7% | $132.73 |
| rotation_for_stronger_continuation | 35 | 5.7% | -1.7% | −$5.97 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 226 | 35.4% | -0.3% | −$6.77 |
| 5–10% | 206 | 33.0% | -1.4% | −$26.16 |
| 10–20% | 14 | 21.4% | -2.3% | −$3.28 |
| 20–50% | 106 | 24.5% | -2.1% | −$24.13 |
| over 50% | 163 | 6.1% | -7.2% | −$111.05 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (2532), CAPITAL_RESERVE_BLOCK (1097), DUPLICATE_POSITION (405), SIGNAL_CYCLE_CAP (332), BELOW_MIN_ENTRY_NOTIONAL (231), CONTINUATION_SIGNAL_WEAK (172), MOVE_TOO_NEGATIVE (134), REENTRY_COOLDOWN (121), EXECUTION_QUOTE_STALE (118), SPREAD_TOO_WIDE (76)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3422), DAILY_ENTRY_LIMIT (1303), DAILY_DRAWDOWN_LIMIT (372), DAILY_REALIZED_LOSS_LIMIT (294)
</details>

<details><summary><b>flat_close</b>: 778 trades, paper −$161.79, live −$50.22</summary>

- Entries 778 (19.45/day); closed 778, open at end 0; median hold 102.5 min; median trade -5.1%
- Equity $88.21 (-64.7%); best day $17.72, worst day −$12.89, losing days 33/40; risk governor stopped buys on 33 days
- Held overnight: 8 trades (1.0%), P&L −$1.62
- Real-quote check: 774 trades priced, median spread paid 0.6% in / 0.5% out
- Live mirror: 467 buys, 475 sells, 467 round trips, win rate 30.0%; skipped SPREAD_TOO_WIDE 65, PRICE_ABOVE_ORDER_CAP 151, EXIT_NOT_HELD_LIVE 385, PRICE_MOVED_AWAY 72, LIVE_QUOTE_STALE 23, FRACTION_BELOW_ONE_SHARE 29, REQUEST_TOO_OLD 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| stop | 418 | 0.7% | -7.7% | −$311.17 |
| session_close | 324 | 63.0% | 4.2% | $133.79 |
| rotation_for_stronger_continuation | 29 | 10.3% | -2.2% | −$6.18 |
| time | 6 | 16.7% | -2.1% | −$1.17 |
| runner_peak_retrace | 1 | 100.0% | 229.4% | $22.94 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 224 | 38.4% | -0.7% | −$16.08 |
| 5–10% | 253 | 32.0% | -2.0% | −$45.75 |
| 10–20% | 16 | 18.8% | 1.2% | $2.08 |
| 20–50% | 136 | 18.4% | -2.8% | −$36.15 |
| over 50% | 149 | 11.4% | -4.6% | −$65.89 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (2082), EXECUTION_QUOTE_NOT_AUTHORITATIVE (658), CAPITAL_RESERVE_BLOCK (611), DUPLICATE_POSITION (378), SIGNAL_CYCLE_CAP (351), MOVE_TOO_NEGATIVE (237), CONTINUATION_SIGNAL_WEAK (221), BELOW_MIN_ENTRY_NOTIONAL (213), NO_IGNITION_SIGNAL (170), REENTRY_COOLDOWN (121)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3318), DAILY_ENTRY_LIMIT (1529), DAILY_REALIZED_LOSS_LIMIT (658), DAILY_DRAWDOWN_LIMIT (291), PENDING_EXIT_INTENT (22)
</details>

<details><summary><b>no_chase_10_flat</b>: 817 trades, paper −$95.04, live −$23.44</summary>

- Entries 817 (20.43/day); closed 817, open at end 0; median hold 330 min; median trade -1.4%
- Equity $154.96 (-38.0%); best day $9.86, worst day −$11.42, losing days 29/40; risk governor stopped buys on 36 days
- Held overnight: 10 trades (1.2%), P&L $0.04
- Real-quote check: 815 trades priced, median spread paid 0.6% in / 0.4% out
- Live mirror: 476 buys, 484 sells, 476 round trips, win rate 38.9%; skipped SPREAD_TOO_WIDE 75, PRICE_ABOVE_ORDER_CAP 213, EXIT_NOT_HELD_LIVE 382, LIVE_QUOTE_STALE 24, PRICE_MOVED_AWAY 29, FRACTION_BELOW_ONE_SHARE 10, REQUEST_TOO_OLD 33

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 520 | 54.6% | 1.9% | $97.37 |
| stop | 290 | 0.0% | -6.7% | −$191.81 |
| time | 7 | 28.6% | -0.8% | −$0.59 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 442 | 37.8% | -0.6% | −$26.55 |
| 5–10% | 375 | 31.7% | -1.8% | −$68.49 |
| 10–20% | 0 | — | — | $0.00 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1895), ENTRY_CHASE_LIMIT (684), EXECUTION_QUOTE_NOT_AUTHORITATIVE (538), DUPLICATE_POSITION (441), CONTINUATION_SIGNAL_WEAK (227), MOVE_TOO_NEGATIVE (226), NO_IGNITION_SIGNAL (171), SIGNAL_CYCLE_CAP (90), SPREAD_TOO_WIDE (63), EXECUTION_QUOTE_STALE (53)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3604), DAILY_ENTRY_LIMIT (2063), DAILY_REALIZED_LOSS_LIMIT (46), PENDING_EXIT_INTENT (39)
</details>

<details><summary><b>no_chase_20_flat</b>: 817 trades, paper −$89.71, live −$29.33</summary>

- Entries 817 (20.43/day); closed 817, open at end 0; median hold 330 min; median trade -1.6%
- Equity $160.29 (-35.9%); best day $9.86, worst day −$10.04, losing days 30/40; risk governor stopped buys on 36 days
- Held overnight: 10 trades (1.2%), P&L $0.04
- Real-quote check: 815 trades priced, median spread paid 0.6% in / 0.5% out
- Live mirror: 496 buys, 504 sells, 496 round trips, win rate 37.5%; skipped SPREAD_TOO_WIDE 71, PRICE_ABOVE_ORDER_CAP 193, EXIT_NOT_HELD_LIVE 369, LIVE_QUOTE_STALE 23, PRICE_MOVED_AWAY 34, FRACTION_BELOW_ONE_SHARE 18, REQUEST_TOO_OLD 37

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 497 | 55.9% | 2.5% | $121.88 |
| stop | 311 | 0.0% | -6.8% | −$210.33 |
| time | 7 | 28.6% | -0.8% | −$0.59 |
| rotation_for_stronger_continuation | 2 | 0.0% | -3.4% | −$0.68 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 408 | 38.0% | -0.6% | −$22.93 |
| 5–10% | 341 | 30.2% | -2.0% | −$67.38 |
| 10–20% | 68 | 32.4% | 0.1% | $0.59 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1727), EXECUTION_QUOTE_NOT_AUTHORITATIVE (591), ENTRY_CHASE_LIMIT (499), DUPLICATE_POSITION (422), CONTINUATION_SIGNAL_WEAK (219), MOVE_TOO_NEGATIVE (216), NO_IGNITION_SIGNAL (171), SIGNAL_CYCLE_CAP (114), SPREAD_TOO_WIDE (56), EXECUTION_QUOTE_STALE (52)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3601), DAILY_ENTRY_LIMIT (2151), DAILY_REALIZED_LOSS_LIMIT (46), PENDING_EXIT_INTENT (39)
</details>

<details><summary><b>trail_flat</b>: 838 trades, paper −$118.61, live −$34.17</summary>

- Entries 838 (20.95/day); closed 838, open at end 0; median hold 50 min; median trade -4.1%
- Equity $131.39 (-47.4%); best day $9.02, worst day −$12.44, losing days 28/40; risk governor stopped buys on 37 days
- Held overnight: 8 trades (0.9%), P&L −$1.31
- Real-quote check: 835 trades priced, median spread paid 0.6% in / 0.5% out
- Live mirror: 504 buys, 508 sells, 504 round trips, win rate 35.3%; skipped SPREAD_TOO_WIDE 72, PRICE_ABOVE_ORDER_CAP 161, EXIT_NOT_HELD_LIVE 397, PRICE_MOVED_AWAY 77, LIVE_QUOTE_STALE 24, FRACTION_BELOW_ONE_SHARE 18, REQUEST_TOO_OLD 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| stop | 413 | 0.0% | -7.8% | −$311.19 |
| session_close | 252 | 52.0% | 0.7% | $16.62 |
| trail | 156 | 90.4% | 11.6% | $179.88 |
| rotation_for_stronger_continuation | 10 | 0.0% | -2.5% | −$2.49 |
| time | 7 | 14.3% | -2.2% | −$1.43 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 219 | 39.3% | -0.6% | −$13.75 |
| 5–10% | 277 | 33.2% | -1.7% | −$44.07 |
| 10–20% | 18 | 27.8% | -1.8% | −$3.23 |
| 20–50% | 155 | 30.3% | -2.1% | −$28.05 |
| over 50% | 169 | 25.4% | -1.8% | −$29.51 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1271), EXECUTION_QUOTE_NOT_AUTHORITATIVE (660), SIGNAL_CYCLE_CAP (387), DUPLICATE_POSITION (337), MOVE_TOO_NEGATIVE (196), CONTINUATION_SIGNAL_WEAK (195), NO_IGNITION_SIGNAL (171), CAPITAL_RESERVE_BLOCK (146), REENTRY_COOLDOWN (124), BELOW_MIN_ENTRY_NOTIONAL (83)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3300), DAILY_ENTRY_LIMIT (2432), DAILY_REALIZED_LOSS_LIMIT (106), DAILY_DRAWDOWN_LIMIT (36), PENDING_EXIT_INTENT (11)
</details>

<details><summary><b>tp15_flat</b>: 850 trades, paper −$75.56, live −$24.66</summary>

- Entries 850 (21.25/day); closed 850, open at end 0; median hold 60 min; median trade -5.1%
- Equity $174.44 (-30.2%); best day $10.35, worst day −$12.89, losing days 29/40; risk governor stopped buys on 38 days
- Held overnight: 9 trades (1.1%), P&L −$1.08
- Real-quote check: 845 trades priced, median spread paid 0.6% in / 0.5% out
- Live mirror: 512 buys, 512 sells, 512 round trips, win rate 32.6%; skipped SPREAD_TOO_WIDE 73, PRICE_ABOVE_ORDER_CAP 153, EXIT_NOT_HELD_LIVE 388, PRICE_MOVED_AWAY 81, LIVE_QUOTE_STALE 31, REQUEST_TOO_OLD 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| stop | 443 | 0.0% | -7.7% | −$337.51 |
| session_close | 293 | 53.2% | 0.8% | $24.40 |
| take_profit | 104 | 100.0% | 23.1% | $238.02 |
| time | 6 | 33.3% | -0.6% | −$0.25 |
| rotation_for_stronger_continuation | 4 | 50.0% | -0.5% | −$0.21 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 233 | 38.6% | -0.3% | −$8.21 |
| 5–10% | 270 | 33.0% | -1.6% | −$42.69 |
| 10–20% | 16 | 18.8% | -4.6% | −$7.31 |
| 20–50% | 168 | 24.4% | -0.3% | −$2.33 |
| over 50% | 163 | 25.1% | -0.9% | −$15.03 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1161), EXECUTION_QUOTE_NOT_AUTHORITATIVE (635), SIGNAL_CYCLE_CAP (401), DUPLICATE_POSITION (369), MOVE_TOO_NEGATIVE (198), CONTINUATION_SIGNAL_WEAK (187), NO_IGNITION_SIGNAL (163), REENTRY_COOLDOWN (117), EXECUTION_QUOTE_STALE (69), SPREAD_TOO_WIDE (43)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3388), DAILY_ENTRY_LIMIT (2471), DAILY_REALIZED_LOSS_LIMIT (163), PENDING_EXIT_INTENT (11)
</details>

<details><summary><b>hold60_flat</b>: 889 trades, paper −$110.79, live −$51.49</summary>

- Entries 889 (22.23/day); closed 889, open at end 0; median hold 60 min; median trade -2.9%
- Equity $139.21 (-44.3%); best day $20.61, worst day −$11.44, losing days 30/40; risk governor stopped buys on 40 days
- Held overnight: 0 trades (0.0%), P&L $0.00
- Real-quote check: 886 trades priced, median spread paid 0.6% in / 0.6% out
- Live mirror: 528 buys, 531 sells, 528 round trips, win rate 32.8%; skipped SPREAD_TOO_WIDE 78, PRICE_ABOVE_ORDER_CAP 171, EXIT_NOT_HELD_LIVE 443, PRICE_MOVED_AWAY 84, LIVE_QUOTE_STALE 28, FRACTION_BELOW_ONE_SHARE 18, NO_LIVE_QUOTE 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| time | 481 | 50.5% | 4.3% | $204.82 |
| stop | 395 | 0.0% | -8.1% | −$312.92 |
| rotation_for_stronger_continuation | 13 | 15.4% | -2.1% | −$2.69 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 252 | 33.3% | -0.7% | −$19.28 |
| 5–10% | 281 | 28.1% | -1.7% | −$44.37 |
| 10–20% | 23 | 26.1% | 1.5% | $3.80 |
| 20–50% | 158 | 27.9% | -0.9% | −$11.72 |
| over 50% | 175 | 18.3% | -2.3% | −$39.22 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1441), EXECUTION_QUOTE_NOT_AUTHORITATIVE (856), SIGNAL_CYCLE_CAP (408), DUPLICATE_POSITION (385), MOVE_TOO_NEGATIVE (252), NO_IGNITION_SIGNAL (229), CONTINUATION_SIGNAL_WEAK (214), CAPITAL_RESERVE_BLOCK (153), REENTRY_COOLDOWN (131), BELOW_MIN_ENTRY_NOTIONAL (118)

Blocked while the daily risk governor had stopped buying: DAILY_ENTRY_LIMIT (3220), PORTFOLIO_VALUATION_INCOMPLETE (1569), DAILY_REALIZED_LOSS_LIMIT (404), DAILY_DRAWDOWN_LIMIT (81), PENDING_EXIT_INTENT (11)
</details>

<details><summary><b>stop3_flat</b>: 736 trades, paper −$180.54, live −$66.55</summary>

- Entries 736 (18.4/day); closed 736, open at end 0; median hold 40 min; median trade -3.5%
- Equity $69.46 (-72.2%); best day $2.47, worst day −$12.29, losing days 34/40; risk governor stopped buys on 32 days
- Held overnight: 6 trades (0.8%), P&L −$3.96
- Real-quote check: 732 trades priced, median spread paid 0.6% in / 0.4% out
- Live mirror: 447 buys, 455 sells, 447 round trips, win rate 27.7%; skipped SPREAD_TOO_WIDE 50, PRICE_ABOVE_ORDER_CAP 152, EXIT_NOT_HELD_LIVE 342, PRICE_MOVED_AWAY 65, LIVE_QUOTE_STALE 22, FRACTION_BELOW_ONE_SHARE 19, NO_LIVE_QUOTE 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| stop | 484 | 0.6% | -6.0% | −$279.40 |
| session_close | 224 | 67.9% | 4.7% | $101.30 |
| rotation_for_stronger_continuation | 25 | 20.0% | -1.0% | −$2.12 |
| time | 3 | 0.0% | -1.5% | −$0.33 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 236 | 31.4% | -0.8% | −$17.97 |
| 5–10% | 222 | 24.3% | -2.0% | −$42.70 |
| 10–20% | 17 | 5.9% | 0.4% | $0.69 |
| 20–50% | 121 | 16.5% | -3.0% | −$35.38 |
| over 50% | 140 | 7.9% | -6.4% | −$85.19 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (2175), EXECUTION_QUOTE_NOT_AUTHORITATIVE (712), CAPITAL_RESERVE_BLOCK (552), BELOW_MIN_ENTRY_NOTIONAL (410), DUPLICATE_POSITION (344), SIGNAL_CYCLE_CAP (295), MOVE_TOO_NEGATIVE (258), CONTINUATION_SIGNAL_WEAK (221), NO_IGNITION_SIGNAL (189), REENTRY_COOLDOWN (143)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (2757), DAILY_ENTRY_LIMIT (1866), DAILY_REALIZED_LOSS_LIMIT (489), DAILY_DRAWDOWN_LIMIT (265), PENDING_EXIT_INTENT (11)
</details>

<details><summary><b>stop8_flat</b>: 781 trades, paper −$141.62, live −$51.26</summary>

- Entries 781 (19.52/day); closed 781, open at end 0; median hold 310 min; median trade -3.2%
- Equity $108.38 (-56.6%); best day $17.95, worst day −$12.80, losing days 29/40; risk governor stopped buys on 34 days
- Held overnight: 12 trades (1.5%), P&L −$1.30
- Real-quote check: 778 trades priced, median spread paid 0.6% in / 0.5% out
- Live mirror: 459 buys, 472 sells, 459 round trips, win rate 36.2%; skipped SPREAD_TOO_WIDE 74, PRICE_ABOVE_ORDER_CAP 161, EXIT_NOT_HELD_LIVE 392, LIVE_QUOTE_STALE 22, FRACTION_BELOW_ONE_SHARE 45, PRICE_MOVED_AWAY 65, REQUEST_TOO_OLD 8, NO_LIVE_QUOTE 2

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 427 | 56.2% | 3.7% | $154.45 |
| stop | 319 | 0.3% | -10.8% | −$330.22 |
| rotation_for_stronger_continuation | 23 | 8.7% | -3.6% | −$7.95 |
| time | 10 | 30.0% | -0.7% | −$0.63 |
| runner_peak_retrace | 2 | 100.0% | 213.7% | $42.73 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 227 | 37.9% | -0.6% | −$13.61 |
| 5–10% | 250 | 36.0% | -2.2% | −$52.21 |
| 10–20% | 14 | 50.0% | 6.7% | $9.33 |
| 20–50% | 129 | 28.7% | -3.1% | −$36.35 |
| over 50% | 161 | 17.4% | -3.2% | −$48.78 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1602), EXECUTION_QUOTE_NOT_AUTHORITATIVE (570), CAPITAL_RESERVE_BLOCK (440), DUPLICATE_POSITION (393), SIGNAL_CYCLE_CAP (358), MOVE_TOO_NEGATIVE (196), CONTINUATION_SIGNAL_WEAK (194), NO_IGNITION_SIGNAL (155), BELOW_MIN_ENTRY_NOTIONAL (89), EXECUTION_QUOTE_STALE (77)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3680), DAILY_ENTRY_LIMIT (1527), DAILY_REALIZED_LOSS_LIMIT (541), DAILY_DRAWDOWN_LIMIT (153), PENDING_EXIT_INTENT (11)
</details>

## Data and method
- Discovery, scoring, shortlist, sizing, risk governor, entries, exits and accounting are MEDS's own production code (runLeaderCycle); only the trade-shape settings differ between rule sets.
- Each cycle sees only one-minute bars that had completed by that moment (premarket: 15 minutes delayed, as production). Cycles every 5 minutes 09:30–16:00 ET plus 09:00–09:20 premarket research.
- Screens (top gainers/losers, most active by volume and by trades) are rebuilt every cycle from one-minute bars. A stock can appear on them only from the moment data up to then put it near the top of a screen (the whole market is scanned every 15 minutes from 08:00: top 100 gainers, 50 losers, 150 most active by volume and by trades), from its first news story, or all day if it was on the previous session's boards (shown before the open, as Alpaca does). So nothing a stock did later can make it appear earlier; a fresh runner can appear up to 15 minutes later than live. Untradable symbols are left off the movers screen, as Alpaca does. Delisted stocks are included where Alpaca still serves their history.
- Quotes at decision time are modeled from the bars with a spread model fitted to 317 real NBBO quotes (median 0.35%). Every trade is then re-priced at the real NBBO 60s after the decision.
- Production decides from Alpaca's free IEX feed; the backtest uses the consolidated tape. IEX shows a small share of each stock's volume and wider quotes, so live MEDS sizes paper entries smaller, hits its per-minute exit limit (5% of minute volume) more often and rejects more names for spread. Expect live paper decisions to be a subset of these.
- Not modeled: overnight (20:00–04:00) position management, options (disabled in production), halts, borrow, fills beyond the displayed quote, and settlement of sale proceeds. Tradable status and news text are as Alpaca reports them today. Live mirror limits: {"max_capital":250,"max_order_notional":12,"max_orders_per_day":40,"daily_loss_limit":15,"buy_limit_buffer_pct":0.01,"max_chase_pct":0.02,"max_spread_pct":0.03,"per_minute":3,"request_ttl_ms":180000,"quote_max_age_ms":120000}.
- The spread model is fitted on quotes from the same days it is used on; it only decides which trades are attempted, and every trade is then priced at real quotes.
- Past results do not guarantee future results. Treat differences between rule sets as the signal, not the absolute dollar numbers.
- Screen coverage (share of regular-session cycles where the replayed screen provably equals the real one): gainers 28.0%, losers 14.8%, most active by volume 87.6%, by trades 93.0%. Where it is lower, a stock that had only just started moving may be missing from the replayed screen (it appears at the next 15-minute mark); nothing is ever shown early.
- Spread model: fitted to sampled NBBO quotes, 317 samples, R² 0.65, median error 44%. Real quotes older than 2 minutes at sampling: 4.1%.
- Run: 125 min, 16962 Alpaca requests (1 retried), 7191 quotes fetched.