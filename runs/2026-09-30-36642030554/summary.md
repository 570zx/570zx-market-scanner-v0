# MEDS backtest: 2026-08-03 to 2026-09-28 (40 trading days)

Replays MEDS's production Leader code (meds-v8.1-leader250-capacity / leader-hunt-v8.6-exit-liquidity) minute by minute over real market history, starting from $250 each rule set. Market data: Alpaca historical consolidated tape. 

| Rule set | Trades | Win rate | Avg trade | Paper P&L | Same trades at real quotes | Live mirror P&L | Max drawdown | Held overnight |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **v87_a_stop5** | 829 | 35.0% | -1.0% | −$86.06 | −$57.81 | −$15.17 | 36.8% | 12 |
| **v87_b_stop8** | 820 | 39.1% | -0.7% | −$57.61 | −$33.20 | −$5.31 | 26.1% | 18 |
| **v87_c_stop12** | 763 | 40.4% | -0.7% | −$54.94 | −$37.04 | −$1.26 | 24.4% | 24 |
| **v87_d_stop8_few** | 419 | 35.1% | -1.3% | −$56.03 | −$36.09 | −$13.31 | 24.2% | 10 |
| **v87_e_stop8_tp10** | 816 | 39.8% | -0.8% | −$68.85 | −$50.20 | −$19.39 | 29.9% | 18 |
| **v87_f_stop8_tp25** | 822 | 38.1% | -0.5% | −$43.19 | −$27.90 | −$16.42 | 23.8% | 19 |
| **v87_g_stop12_few** | 422 | 37.4% | -1.2% | −$50.39 | −$38.46 | −$17.42 | 21.6% | 18 |

| Rule set | Earlier days: paper P&L | Last 10 days (held back): paper P&L |
|---|---:|---:|
| **v87_a_stop5** | −$61.27 (30 days) | −$24.79 |
| **v87_b_stop8** | −$35.26 (30 days) | −$22.35 |
| **v87_c_stop12** | −$24.69 (30 days) | −$30.25 |
| **v87_d_stop8_few** | −$35.97 (30 days) | −$20.06 |
| **v87_e_stop8_tp10** | −$45.17 (30 days) | −$23.68 |
| **v87_f_stop8_tp25** | −$30.58 (30 days) | −$12.61 |
| **v87_g_stop12_few** | −$23.98 (30 days) | −$26.41 |

**Paper P&L**: the paper account ($250, fractional shares) marked at the last trade, using the modeled spread. **Same trades at real quotes**: those exact trades re-priced at the real NBBO one minute after each decision (bought at the ask, sold at the bid). **Live mirror P&L**: what the Robinhood mirror would have done with those decisions — whole shares, $12 orders, its 3% spread and 2% chase limits, 3 orders a minute.

## Rule sets
- **v87_a_stop5**: Round 2: flat by the close, no buys already up over 20%, take profit at +15%, 5% stop
- **v87_b_stop8**: Round 2: as v87_a with an 8% stop
- **v87_c_stop12**: Round 2: as v87_a with a 12% stop
- **v87_d_stop8_few**: Round 2: as v87_b, at most 8 buys a day
- **v87_e_stop8_tp10**: Round 2: as v87_b with take profit at +10%
- **v87_f_stop8_tp25**: Round 2: as v87_b with take profit at +25%
- **v87_g_stop12_few**: Round 2: as v87_c, at most 8 buys a day

<details><summary><b>v87_a_stop5</b>: 829 trades, paper −$86.06, live −$15.17</summary>

- Entries 829 (20.73/day); closed 829, open at end 0; median hold 320 min; median trade -1.4%
- Equity $163.94 (-34.4%); best day $5.15, worst day −$8.16, losing days 29/40; risk governor stopped buys on 35 days
- Held overnight: 12 trades (1.4%), P&L $0.64
- Real-quote check: 827 trades priced, median spread paid 0.6% in / 0.4% out
- Live mirror: 498 buys, 498 sells, 498 round trips, win rate 37.8%; skipped SPREAD_TOO_WIDE 74, PRICE_ABOVE_ORDER_CAP 205, EXIT_NOT_HELD_LIVE 374, LIVE_QUOTE_STALE 24, PRICE_MOVED_AWAY 28, REQUEST_TOO_OLD 30

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 480 | 50.2% | 0.6% | $29.11 |
| stop | 294 | 0.0% | -6.8% | −$197.28 |
| take_profit | 46 | 100.0% | 18.6% | $82.51 |
| time | 7 | 42.9% | 0.6% | $0.40 |
| rotation_for_stronger_continuation | 2 | 0.0% | -4.0% | −$0.80 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 432 | 37.7% | -0.6% | −$26.24 |
| 5–10% | 334 | 31.1% | -1.7% | −$57.61 |
| 10–20% | 63 | 36.5% | -0.3% | −$2.21 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1848), EXECUTION_QUOTE_NOT_AUTHORITATIVE (580), ENTRY_CHASE_LIMIT (517), DUPLICATE_POSITION (432), CONTINUATION_SIGNAL_WEAK (223), MOVE_TOO_NEGATIVE (210), NO_IGNITION_SIGNAL (159), SIGNAL_CYCLE_CAP (110), SPREAD_TOO_WIDE (62), EXECUTION_QUOTE_STALE (51)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3611), DAILY_ENTRY_LIMIT (2054), PENDING_EXIT_INTENT (31)
</details>

<details><summary><b>v87_b_stop8</b>: 820 trades, paper −$57.61, live −$5.31</summary>

- Entries 820 (20.5/day); closed 820, open at end 0; median hold 345 min; median trade -0.8%
- Equity $192.39 (-23.0%); best day $4.67, worst day −$5.60, losing days 28/40; risk governor stopped buys on 34 days
- Held overnight: 18 trades (2.2%), P&L −$1.18
- Real-quote check: 819 trades priced, median spread paid 0.5% in / 0.3% out
- Live mirror: 480 buys, 480 sells, 480 round trips, win rate 42.5%; skipped SPREAD_TOO_WIDE 71, PRICE_ABOVE_ORDER_CAP 225, EXIT_NOT_HELD_LIVE 373, LIVE_QUOTE_STALE 19, PRICE_MOVED_AWAY 25, REQUEST_TOO_OLD 49

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 593 | 44.9% | 0.0% | $2.86 |
| stop | 163 | 0.0% | -9.5% | −$153.60 |
| take_profit | 51 | 100.0% | 19.2% | $93.53 |
| time | 12 | 33.3% | 0.1% | $0.05 |
| rotation_for_stronger_continuation | 1 | 0.0% | -4.5% | −$0.45 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 448 | 39.7% | -0.4% | −$18.74 |
| 5–10% | 313 | 37.4% | -1.3% | −$40.07 |
| 10–20% | 59 | 44.1% | 0.3% | $1.20 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (2004), ENTRY_CHASE_LIMIT (512), EXECUTION_QUOTE_NOT_AUTHORITATIVE (495), DUPLICATE_POSITION (457), CONTINUATION_SIGNAL_WEAK (202), MOVE_TOO_NEGATIVE (196), NO_IGNITION_SIGNAL (146), SIGNAL_CYCLE_CAP (112), CAPITAL_RESERVE_BLOCK (96), SPREAD_TOO_WIDE (66)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3744), DAILY_ENTRY_LIMIT (1623), PENDING_EXIT_INTENT (12)
</details>

<details><summary><b>v87_c_stop12</b>: 763 trades, paper −$54.94, live −$1.26</summary>

- Entries 763 (19.08/day); closed 763, open at end 0; median hold 350 min; median trade -0.8%
- Equity $195.06 (-22.0%); best day $3.97, worst day −$6.39, losing days 28/40; risk governor stopped buys on 31 days
- Held overnight: 24 trades (3.1%), P&L −$5.76
- Real-quote check: 761 trades priced, median spread paid 0.5% in / 0.3% out
- Live mirror: 452 buys, 452 sells, 452 round trips, win rate 42.9%; skipped SPREAD_TOO_WIDE 68, PRICE_ABOVE_ORDER_CAP 202, EXIT_NOT_HELD_LIVE 327, REQUEST_TOO_OLD 86, LIVE_QUOTE_STALE 17, PRICE_MOVED_AWAY 23, NO_LIVE_QUOTE 1

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 627 | 41.1% | -0.6% | −$38.51 |
| stop | 75 | 0.0% | -13.8% | −$101.59 |
| take_profit | 46 | 100.0% | 19.6% | $87.03 |
| time | 14 | 28.6% | -0.9% | −$1.09 |
| rotation_for_stronger_continuation | 1 | 0.0% | -7.8% | −$0.78 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 441 | 41.5% | -0.2% | −$12.00 |
| 5–10% | 266 | 37.2% | -1.8% | −$45.39 |
| 10–20% | 56 | 46.4% | 0.5% | $2.45 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1921), ENTRY_CHASE_LIMIT (488), DUPLICATE_POSITION (424), EXECUTION_QUOTE_NOT_AUTHORITATIVE (387), CONTINUATION_SIGNAL_WEAK (182), MOVE_TOO_NEGATIVE (169), NO_IGNITION_SIGNAL (113), SIGNAL_CYCLE_CAP (98), SPREAD_TOO_WIDE (54), BELOW_MIN_ENTRY_NOTIONAL (54)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3858), DAILY_ENTRY_LIMIT (1195), PENDING_EXIT_INTENT (28)
</details>

<details><summary><b>v87_d_stop8_few</b>: 419 trades, paper −$56.03, live −$13.31</summary>

- Entries 419 (10.48/day); closed 419, open at end 0; median hold 370 min; median trade -2.0%
- Equity $193.97 (-22.4%); best day $4.23, worst day −$7.01, losing days 28/40; risk governor stopped buys on 40 days
- Held overnight: 10 trades (2.4%), P&L −$1.21
- Real-quote check: 419 trades priced, median spread paid 0.8% in / 0.5% out
- Live mirror: 242 buys, 242 sells, 242 round trips, win rate 38.8%; skipped SPREAD_TOO_WIDE 59, PRICE_ABOVE_ORDER_CAP 92, EXIT_NOT_HELD_LIVE 202, PRICE_MOVED_AWAY 19, LIVE_QUOTE_STALE 7

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 249 | 43.4% | -0.2% | −$4.70 |
| stop | 125 | 0.0% | -9.9% | −$121.99 |
| take_profit | 37 | 100.0% | 19.7% | $71.45 |
| time | 8 | 25.0% | -1.0% | −$0.78 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 181 | 35.9% | -0.7% | −$14.67 |
| 5–10% | 212 | 32.5% | -2.3% | −$47.12 |
| 10–20% | 26 | 50.0% | 2.2% | $5.76 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (846), EXECUTION_QUOTE_NOT_AUTHORITATIVE (596), ENTRY_CHASE_LIMIT (332), NO_IGNITION_SIGNAL (174), MOVE_TOO_NEGATIVE (171), CONTINUATION_SIGNAL_WEAK (170), DUPLICATE_POSITION (170), SIGNAL_CYCLE_CAP (112), EXECUTION_QUOTE_STALE (43), SPREAD_TOO_WIDE (36)

Blocked while the daily risk governor had stopped buying: DAILY_ENTRY_LIMIT (3137), PORTFOLIO_VALUATION_INCOMPLETE (2942)
</details>

<details><summary><b>v87_e_stop8_tp10</b>: 816 trades, paper −$68.85, live −$19.39</summary>

- Entries 816 (20.4/day); closed 816, open at end 0; median hold 340 min; median trade -0.8%
- Equity $181.15 (-27.5%); best day $4.10, worst day −$6.02, losing days 28/40; risk governor stopped buys on 33 days
- Held overnight: 18 trades (2.2%), P&L −$1.33
- Real-quote check: 815 trades priced, median spread paid 0.5% in / 0.3% out
- Live mirror: 475 buys, 475 sells, 475 round trips, win rate 43.4%; skipped SPREAD_TOO_WIDE 72, PRICE_ABOVE_ORDER_CAP 225, EXIT_NOT_HELD_LIVE 371, LIVE_QUOTE_STALE 19, PRICE_MOVED_AWAY 25, REQUEST_TOO_OLD 38

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 565 | 43.0% | -0.3% | −$13.72 |
| stop | 160 | 0.0% | -9.5% | −$151.07 |
| take_profit | 78 | 100.0% | 12.9% | $97.54 |
| time | 12 | 33.3% | -0.7% | −$0.83 |
| rotation_for_stronger_continuation | 1 | 0.0% | -7.6% | −$0.76 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 445 | 40.5% | -0.5% | −$22.58 |
| 5–10% | 314 | 38.2% | -1.4% | −$44.40 |
| 10–20% | 57 | 43.9% | -0.3% | −$1.87 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (2017), ENTRY_CHASE_LIMIT (513), EXECUTION_QUOTE_NOT_AUTHORITATIVE (511), DUPLICATE_POSITION (457), CONTINUATION_SIGNAL_WEAK (202), MOVE_TOO_NEGATIVE (199), NO_IGNITION_SIGNAL (150), SIGNAL_CYCLE_CAP (112), BELOW_MIN_ENTRY_NOTIONAL (73), SPREAD_TOO_WIDE (66)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3751), DAILY_ENTRY_LIMIT (1607)
</details>

<details><summary><b>v87_f_stop8_tp25</b>: 822 trades, paper −$43.19, live −$16.42</summary>

- Entries 822 (20.55/day); closed 822, open at end 0; median hold 350 min; median trade -0.9%
- Equity $206.81 (-17.3%); best day $13.46, worst day −$7.49, losing days 25/40; risk governor stopped buys on 35 days
- Held overnight: 19 trades (2.3%), P&L −$0.91
- Real-quote check: 821 trades priced, median spread paid 0.5% in / 0.3% out
- Live mirror: 485 buys, 485 sells, 485 round trips, win rate 41.9%; skipped SPREAD_TOO_WIDE 72, PRICE_ABOVE_ORDER_CAP 221, EXIT_NOT_HELD_LIVE 375, LIVE_QUOTE_STALE 19, PRICE_MOVED_AWAY 25, REQUEST_TOO_OLD 55

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 615 | 46.2% | 0.4% | $24.20 |
| stop | 170 | 0.0% | -9.6% | −$161.38 |
| take_profit | 25 | 100.0% | 39.2% | $93.93 |
| time | 12 | 33.3% | 0.1% | $0.05 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 452 | 39.2% | -0.6% | −$26.56 |
| 5–10% | 312 | 35.6% | -0.8% | −$25.76 |
| 10–20% | 58 | 43.1% | 1.6% | $9.13 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (1862), ENTRY_CHASE_LIMIT (502), EXECUTION_QUOTE_NOT_AUTHORITATIVE (495), DUPLICATE_POSITION (459), CONTINUATION_SIGNAL_WEAK (201), MOVE_TOO_NEGATIVE (195), NO_IGNITION_SIGNAL (146), SIGNAL_CYCLE_CAP (112), SPREAD_TOO_WIDE (65), EXECUTION_QUOTE_STALE (48)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3770), DAILY_ENTRY_LIMIT (1647), PENDING_EXIT_INTENT (12)
</details>

<details><summary><b>v87_g_stop12_few</b>: 422 trades, paper −$50.39, live −$17.42</summary>

- Entries 422 (10.55/day); closed 422, open at end 0; median hold 375 min; median trade -1.4%
- Equity $199.61 (-20.2%); best day $7.88, worst day −$7.23, losing days 29/40; risk governor stopped buys on 40 days
- Held overnight: 18 trades (4.3%), P&L −$8.11
- Real-quote check: 422 trades priced, median spread paid 0.8% in / 0.5% out
- Live mirror: 243 buys, 243 sells, 243 round trips, win rate 39.5%; skipped SPREAD_TOO_WIDE 58, PRICE_ABOVE_ORDER_CAP 92, EXIT_NOT_HELD_LIVE 202, PRICE_MOVED_AWAY 21, LIVE_QUOTE_STALE 8

| Exit reason | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| session_close | 304 | 38.5% | -1.0% | −$29.29 |
| stop | 68 | 0.0% | -13.9% | −$92.28 |
| take_profit | 38 | 100.0% | 19.9% | $74.11 |
| time | 12 | 25.0% | -2.5% | −$2.94 |

| Stock was up … when bought | Trades | Win rate | Avg | P&L |
|---|---:|---:|---:|---:|
| up ≤5% | 187 | 37.4% | -0.6% | −$13.32 |
| 5–10% | 207 | 35.3% | -2.3% | −$45.65 |
| 10–20% | 28 | 53.6% | 3.1% | $8.58 |
| 20–50% | 0 | — | — | $0.00 |
| over 50% | 0 | — | — | $0.00 |

Stocks not bought, by first reason (each stock counted once a day): PRICE_ABOVE_RUNNER_LANE (789), EXECUTION_QUOTE_NOT_AUTHORITATIVE (477), ENTRY_CHASE_LIMIT (332), DUPLICATE_POSITION (172), CONTINUATION_SIGNAL_WEAK (156), MOVE_TOO_NEGATIVE (149), NO_IGNITION_SIGNAL (137), SIGNAL_CYCLE_CAP (107), EXECUTION_QUOTE_STALE (41), SPREAD_TOO_WIDE (36)

Blocked while the daily risk governor had stopped buying: PORTFOLIO_VALUATION_INCOMPLETE (3388), DAILY_ENTRY_LIMIT (2594)
</details>

## Data and method
- Discovery, scoring, shortlist, sizing, risk governor, entries, exits and accounting are MEDS's own production code (runLeaderCycle); only the trade-shape settings differ between rule sets.
- Each cycle sees only one-minute bars that had completed by that moment (premarket: 15 minutes delayed, as production). Cycles every 5 minutes 09:30–16:00 ET plus 09:00–09:20 premarket research.
- Screens (top gainers/losers, most active by volume and by trades) are rebuilt every cycle from one-minute bars. A stock can appear on them only from the moment data up to then put it near the top of a screen (the whole market is scanned every 15 minutes from 08:00: top 100 gainers, 50 losers, 150 most active by volume and by trades), from its first news story, or all day if it was on the previous session's boards (shown before the open, as Alpaca does). So nothing a stock did later can make it appear earlier; a fresh runner can appear up to 15 minutes later than live. Untradable symbols are left off the movers screen, as Alpaca does. Delisted stocks are included where Alpaca still serves their history.
- Quotes at decision time are modeled from the bars with a spread model fitted to 315 real NBBO quotes (median 0.41%). Every trade is then re-priced at the real NBBO 60s after the decision.
- Production decides from Alpaca's free IEX feed; the backtest uses the consolidated tape. IEX shows a small share of each stock's volume and wider quotes, so live MEDS sizes paper entries smaller, hits its per-minute exit limit (5% of minute volume) more often and rejects more names for spread. Expect live paper decisions to be a subset of these.
- Not modeled: overnight (20:00–04:00) position management, options (disabled in production), halts, borrow, fills beyond the displayed quote, and settlement of sale proceeds. Tradable status and news text are as Alpaca reports them today. Live mirror limits: {"max_capital":250,"max_order_notional":12,"max_orders_per_day":40,"daily_loss_limit":15,"buy_limit_buffer_pct":0.01,"max_chase_pct":0.02,"max_spread_pct":0.03,"per_minute":3,"request_ttl_ms":180000,"quote_max_age_ms":120000}.
- The spread model is fitted on quotes from the same days it is used on; it only decides which trades are attempted, and every trade is then priced at real quotes.
- Past results do not guarantee future results. Treat differences between rule sets as the signal, not the absolute dollar numbers.
- Screen coverage (share of regular-session cycles where the replayed screen provably equals the real one): gainers 28.0%, losers 14.8%, most active by volume 87.6%, by trades 93.0%. Where it is lower, a stock that had only just started moving may be missing from the replayed screen (it appears at the next 15-minute mark); nothing is ever shown early.
- Spread model: fitted to sampled NBBO quotes, 315 samples, R² 0.67, median error 41%. Real quotes older than 2 minutes at sampling: 6.3%.
- Run: 98 min, 13484 Alpaca requests (0 retried), 3714 quotes fetched.