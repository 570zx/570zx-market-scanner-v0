# MEDS edge hunt: 2017-01-13 to 2026-09-29

Every idea still standing, on the same real data, against buy-and-hold. Each starts with $250, trades only with cash (no margin, no shorting: the short side uses SH, a 1x inverse S&P ETF), and pays a cost on every trade. All 15 strategies below (plus buy-and-hold and reference rows) were written down before the run with textbook settings; nothing was tuned on these results. 2025-01-01 onward is reported separately as the held-back period. With this many ideas tried, expect the best one to look better than it really is: prefer ideas that beat buy-and-hold in both periods and survive doubled costs.

## Daily strategies

| Strategy | $250 became | Yearly (CAGR) | Worst drop | Sharpe | Trades/yr | Time invested | Before 2025 | 2025–26 (held back) | Yearly if costs ×2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **hold_SPY** | $975 | +15.1% | -33.8% | 0.88 | 0.1 | 100% | +193.3% | +33.0% | +15.1% |
| **hold_QQQ** | $1,602 | +21.1% | -35.0% | 0.96 | 0.1 | 100% | +340.3% | +45.6% | +21.1% |
| **hold_TQQQ** | $6,871 | +40.8% | -81.7% | 0.85 | 0.1 | 100% | +1284.1% | +98.6% | +40.8% |
| **ibs_SPY** | $558 | +8.6% | -22.8% | 0.74 | 55.36 | 36.68% | +81.6% | +22.9% | +5.7% |
| **ibs_QQQ** | $1,189 | +17.5% | -15.8% | 1.12 | 57.42 | 34.43% | +298.2% | +19.4% | +14.2% |
| **rsi2_SPY** | $351 | +3.6% | -15.8% | 0.59 | 17.35 | 11.39% | +23.5% | +13.8% | +2.7% |
| **rsi2_QQQ** | $391 | +4.7% | -10.3% | 0.61 | 16.94 | 12.01% | +37.2% | +14.1% | +3.9% |
| **trend_TQQQ** | $6,837 | +40.7% | -56.4% | 0.93 | 8.37 | 83.4% | +1528.9% | +67.9% | +40.1% |
| **trend_TQQQ_band** | $5,640 | +38.0% | -66.0% | 0.89 | 2.17 | 82.05% | +1597.3% | +32.9% | +37.8% |
| **trend_QQQ** | $1,191 | +17.5% | -23.1% | 1.03 | 8.37 | 83.4% | +261.1% | +31.9% | +17.0% |
| **etf_rotation** | $708 | +11.4% | -15.3% | 0.98 | 29.43 | 92.7% | +96.3% | +44.3% | +11.0% |
| **momentum_15** | $425 | +5.6% | -30.3% | 0.44 | 161.94 | 89.34% | +34.9% | +25.9% | +5.0% |

### Year by year (daily strategies)

| Strategy | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| hold_SPY | +19.8% | -5.0% | +31.1% | +18.4% | +28.6% | -18.2% | +26.2% | +24.9% | +17.7% | +12.9% |
| hold_QQQ | +27.5% | -0.1% | +39.0% | +48.6% | +27.4% | -32.5% | +54.9% | +25.6% | +20.8% | +20.5% |
| hold_TQQQ | +94.7% | -19.8% | +133.8% | +110.0% | +83.0% | -79.1% | +198.1% | +58.3% | +34.4% | +47.8% |
| ibs_SPY | +7.1% | -18.6% | +9.4% | +39.2% | +6.1% | +22.1% | +4.0% | +1.5% | +14.7% | +7.1% |
| ibs_QQQ | +14.8% | -6.5% | +8.2% | +101.7% | +22.2% | +11.4% | +27.1% | -1.7% | +13.9% | +4.9% |
| rsi2_SPY | +4.1% | -8.2% | +2.1% | +2.5% | +10.2% | -3.1% | +2.6% | +12.6% | +5.5% | +7.9% |
| rsi2_QQQ | +6.7% | -2.4% | +0.8% | +1.4% | +9.7% | -3.8% | +4.0% | +17.3% | +5.3% | +8.4% |
| trend_TQQQ | +94.7% | -23.1% | +51.5% | +104.9% | +83.0% | -43.1% | +112.6% | +58.3% | +26.8% | +32.4% |
| trend_TQQQ_band | +94.7% | +6.1% | +45.7% | +46.8% | +83.0% | -31.0% | +92.1% | +58.3% | +16.5% | +14.1% |
| trend_QQQ | +27.5% | -4.5% | +18.6% | +36.3% | +27.4% | -16.5% | +37.2% | +25.6% | +14.2% | +15.6% |
| etf_rotation | +18.4% | -3.8% | +6.7% | +18.1% | +28.4% | -8.6% | +1.7% | +14.6% | +23.4% | +17.0% |
| momentum_15 | +8.3% | -6.0% | -5.5% | +14.7% | -3.1% | -8.0% | +5.6% | +29.9% | +11.1% | +13.3% |

## Intraday SPY strategies

| Strategy | $250 became | Yearly (CAGR) | Worst drop | Sharpe | Trades | Win rate | Avg trade | Before 2025 | 2025–26 (held back) | Yearly if costs ×2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **ref_spy_open_to_close** | $128 | -6.1% | -53.0% | -0.42 | 2678 | 50.1% | -0.022% | -44.5% | -8.0% | -15.0% |
| **ref_spy_close_to_open** | $216 | -1.3% | -34.8% | -0.06 | 2657 | 52.1% | -0.003% | -13.1% | -0.4% | -10.7% |
| **noise_spy_long** | $210 | -1.6% | -17.0% | -0.39 | 1293 | 35% | -0.013% | -9.1% | -7.4% | -6.2% |
| **noise_spy_sh** | $78 | -10.3% | -69.2% | -1.63 | 2519 | 30.1% | -0.045% | -56.7% | -28.2% | -23.8% |
| **last30_spy_long** | $194 | -2.4% | -22.8% | -0.94 | 780 | 38.3% | -0.032% | -17.2% | -6.4% | -5.2% |
| **last30_spy_sh** | $114 | -7.0% | -54.5% | -1.96 | 1342 | 34.3% | -0.058% | -45.8% | -15.7% | -14.3% |
| **fade350_spy_long** | $142 | -5.2% | -43.3% | -3 | 1343 | 34.8% | -0.042% | -38.7% | -7.4% | -9.8% |
| **fade350_spy_sh** | $39 | -15.9% | -84.4% | -6.16 | 2595 | 26.9% | -0.071% | -78.9% | -25.8% | -28.8% |

### Year by year (intraday)

| Strategy | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ref_spy_open_to_close | -0.3% | -1.9% | -24.1% | +4.5% | -5.5% | -3.0% | -18.5% | +5.9% | -9.4% | -3.4% | -4.8% |
| ref_spy_close_to_open | -8.7% | -0.7% | +2.6% | +0.9% | -0.5% | +8.3% | -18.5% | -3.5% | +9.3% | -1.9% | +1.5% |
| noise_spy_long | -3.2% | -4.1% | +0.6% | -3.2% | -3.5% | +4.7% | +5.6% | -0.8% | -5.0% | -4.0% | -3.5% |
| noise_spy_sh | -9.4% | -18.8% | +3.6% | -14.4% | -11.1% | -5.0% | -1.2% | -6.8% | -14.6% | -14.7% | -15.9% |
| last30_spy_long | -3.0% | -3.7% | -1.6% | -2.8% | +6.1% | -4.0% | -4.5% | -2.3% | -2.5% | -3.7% | -2.8% |
| last30_spy_sh | -5.2% | -9.0% | -3.4% | -7.2% | -3.3% | -8.6% | -7.5% | -7.5% | -7.4% | -9.3% | -7.0% |
| fade350_spy_long | -4.7% | -5.3% | -8.1% | -3.9% | -4.6% | -9.3% | -5.5% | -2.6% | -3.4% | -5.3% | -2.2% |
| fade350_spy_sh | -9.7% | -14.2% | -15.5% | -15.0% | -20.1% | -18.6% | -19.0% | -14.5% | -15.9% | -17.3% | -10.3% |

## The rules

- **hold_SPY**: Buy and hold SPY (benchmark)
- **hold_QQQ**: Buy and hold QQQ (benchmark)
- **hold_TQQQ**: Buy and hold TQQQ (benchmark)
- **ibs_SPY**: IBS mean reversion on SPY: buy at the close when the close is in the bottom 20% of the day's range; sell at the close when it is in the top 20%. Cash when out.
- **ibs_QQQ**: IBS mean reversion on QQQ: buy at the close when the close is in the bottom 20% of the day's range; sell at the close when it is in the top 20%. Cash when out.
- **rsi2_SPY**: RSI(2) mean reversion on SPY: buy at the close when above its 200-day average and RSI(2) < 10; sell at the close above the 5-day average. Cash when out.
- **rsi2_QQQ**: RSI(2) mean reversion on QQQ: buy at the close when above its 200-day average and RSI(2) < 10; sell at the close above the 5-day average. Cash when out.
- **trend_TQQQ**: Hold TQQQ while QQQ closes above its 200-day average; otherwise BIL (T-bills). Decided and traded at the close.
- **trend_TQQQ_band**: Hold TQQQ while QQQ closes more than 5% above its 200-day average (leave when it closes 3% below); otherwise BIL (T-bills). Decided and traded at the close.
- **trend_QQQ**: Hold QQQ while QQQ closes above its 200-day average; otherwise BIL (T-bills). Decided and traded at the close.
- **etf_rotation**: ETF rotation: at each month-end, of SPY, QQQ, IWM, EFA, EEM, TLT, IEF, GLD, DBC, VNQ, hold the 4 with the best average 1/3/6/12-month return that are above their 210-day average and beat T-bills over 12 months; weight by inverse 60-day volatility; unused slots in BIL.
- **momentum_15**: Stock momentum: at each month-end, the 15 large US stocks (not ETFs; over $300M traded a day, price over $20) with the best 12-month return skipping the last month, equal weight. SPY below its 200-day average: half size; also falling: all BIL. Scaled down when the book's 6-month volatility is above 15%.
- **ref_spy_open_to_close**: Reference: own SPY from 09:31 to 16:00 every day (flat overnight).
- **ref_spy_close_to_open**: Reference: own SPY from 16:00 to 09:31 the next day (flat during the day).
- **noise_spy_long**: SPY noise-band breakout (Zarattini et al. 2024), checked every 30 minutes from 10:00: long SPY above the upper band; exit on a close back through the band/VWAP; flat at 16:00.
- **noise_spy_sh**: SPY noise-band breakout (Zarattini et al. 2024), checked every 30 minutes from 10:00: long SPY above the upper band, long SH (inverse) below the lower band; exit on a close back through the band/VWAP; flat at 16:00.
- **last30_spy_long**: Last-half-hour momentum (Gao et al. 2018): at 15:30, if SPY is up from yesterday's close to 10:00 and up from 15:00 to 15:30, hold SPY to the close.
- **last30_spy_sh**: Last-half-hour momentum (Gao et al. 2018): at 15:30, if SPY is up from yesterday's close to 10:00 and up from 15:00 to 15:30, hold SPY to the close; if both are down, hold SH to the close.
- **fade350_spy_long**: "3:50 PM fade" (a Moltbook agent's claim): at 15:50, if SPY fell from 15:40 to 15:50, hold SPY to the close.
- **fade350_spy_sh**: "3:50 PM fade" (a Moltbook agent's claim): at 15:50, if SPY fell from 15:40 to 15:50, hold SPY to the close; if it rose, hold SH to the close.

## Method and limits
- Daily: ETF prices include dividends (Alpaca "all" adjustment). Stock-momentum prices are split-adjusted only (dividends left out, a small understatement). The first 260 sessions are history only; trading starts 2017-01-13.
- "Close" strategies decide on the day's close and trade at it. Live, the bot decides at about 15:55 from a live quote, so the backtest is slightly optimistic for them; the doubled-cost column is the guard.
- Costs per side: 0.05% for ETFs, 0.10% for single stocks, 0.02% for SPY intraday, 0.05% for SH. SPY's real spread is about 0.002%.
- Intraday: SPY and SH one-minute bars (consolidated tape). Decisions use bars completed by the decision time and fill at the next minute's close. Early-close days are skipped.
- Stock momentum uses every US stock Alpaca still serves, including delisted ones, with funds and leveraged products left out by name. Companies Alpaca no longer serves are missing (slightly flatters results).
- Not modeled: taxes, T+1 settlement rules (strategies that sell and buy on the same day need the Agentic account's "limited margin" setting), fractional-share limits, halts.
- Past results do not guarantee future results.
