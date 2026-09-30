# MEDS overnight test: 2016-01-04 to 2026-09-29

Does buying at the close and selling the next morning (premarket or at the open) beat simply holding? Each row starts at $250 and trades every night with cash only. "Before costs" ignores the bid/ask spread; "after costs" pays half the measured spread plus 0.005% on every buy and sell. Prices are split-adjusted, not dividend-adjusted (holding also collects dividends; overnight holders do too on ex-dates). 2025-01-01 onward is shown separately.

| Strategy | $250 became (after costs) | Yearly before costs | Yearly after costs | Yearly if costs ×2 | Worst drop | Sharpe | Nights | Win rate | Before 2025 | 2025–26 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **hold_SPY** | $951 | +13.3% | +13.3% | +13.3% | -34.2% | 0.79 | — | — | +191.6% | +30.4% |
| **day_SPY** | $265 | +3.9% | +0.6% | -2.7% | -24.4% | 0.11 | 2679 | 53% | +2.8% | +3.3% |
| **night_SPY_0430** | $287 | +6.0% | +1.3% | -3.2% | -26.0% | 0.18 | 2671 | 54% | +3.6% | +10.9% |
| **night_SPY_0700** | $334 | +7.4% | +2.7% | -1.7% | -28.7% | 0.31 | 2678 | 54.4% | +20.1% | +11.2% |
| **night_SPY_0900** | $374 | +7.8% | +3.8% | +0.0% | -31.6% | 0.39 | 2678 | 55.3% | +31.9% | +13.4% |
| **night_SPY_open** | $434 | +8.8% | +5.3% | +1.9% | -30.1% | 0.51 | 2678 | 55.2% | +54.5% | +12.3% |
| **hold_QQQ** | $1,684 | +19.5% | +19.5% | +19.5% | -35.6% | 0.91 | — | — | +366.5% | +44.4% |
| **day_QQQ** | $301 | +5.6% | +1.7% | -2.0% | -32.0% | 0.19 | 2679 | 53.3% | +15.0% | +4.6% |
| **night_QQQ_0430** | $507 | +11.9% | +6.8% | +1.9% | -22.5% | 0.64 | 2608 | 55.5% | +63.0% | +24.3% |
| **night_QQQ_0700** | $552 | +12.8% | +7.7% | +2.8% | -23.9% | 0.67 | 2676 | 55.2% | +79.4% | +23.1% |
| **night_QQQ_0900** | $625 | +13.4% | +8.9% | +4.6% | -28.0% | 0.71 | 2676 | 56.5% | +98.6% | +25.9% |
| **night_QQQ_open** | $612 | +12.9% | +8.7% | +4.7% | -26.7% | 0.68 | 2678 | 55% | +101.9% | +21.3% |
| **hold_TQQQ** | $8,671 | +39.2% | +39.2% | +39.2% | -81.8% | 0.83 | — | — | +1671.6% | +95.8% |
| **day_TQQQ** | $196 | +5.6% | -2.3% | -9.6% | -75.9% | 0.21 | 2679 | 53.5% | -23.0% | +1.7% |
| **night_TQQQ_0430** | $1,707 | +30.0% | +19.6% | +10.1% | -57.9% | 0.7 | 2457 | 56.3% | +310.1% | +66.5% |
| **night_TQQQ_0700** | $1,583 | +31.2% | +18.8% | +7.6% | -62.6% | 0.66 | 2662 | 55.7% | +298.7% | +58.8% |
| **night_TQQQ_0900** | $2,077 | +32.2% | +21.9% | +12.3% | -67.9% | 0.7 | 2676 | 56.7% | +395.8% | +67.6% |
| **night_TQQQ_open** | $1,971 | +31.0% | +21.3% | +12.2% | -65.3% | 0.68 | 2678 | 55% | +434.4% | +47.5% |
| **night_TQQQ_open_trend** | $4,464 | +38.9% | +30.9% | +23.3% | -47.3% | 1.06 | 2069 | 56.9% | +977.2% | +65.8% |
| **attention_gainers** | $1,764 | +102.5% | +22.4% | -26.1% | -86.2% | 0.63 | 2439 | 46% | +724.6% | -14.4% |
| **attention_losers** | $53 | +41.1% | -14.8% | -48.5% | -93.0% | -0.09 | 2439 | 47.3% | -78.9% | +1.3% |
| **attention_volume** | $54 | +41.2% | -14.7% | -48.4% | -94.0% | -0.13 | 2439 | 44.5% | -70.5% | -27.0% |

## Measured bid/ask spreads (median, full spread as % of price)

| Symbol | 15:59 close | 04:30 | 07:00 | 09:00 | 09:31 open |
|---|---:|---:|---:|---:|---:|
| SPY | 0.003% (60) | 0.014% (60) | 0.013% (60) | 0.007% (60) | 0.003% (60) |
| QQQ | 0.003% (60) | 0.015% (60) | 0.014% (60) | 0.009% (60) | 0.006% (60) |
| TQQQ | 0.016% (60) | 0.036% (60) | 0.044% (60) | 0.029% (60) | 0.026% (60) |

## The rules

- **hold_SPY**: Hold SPY (price only, no costs)
- **day_SPY**: Own SPY only from 09:31 to the close
- **night_SPY_0430**: Buy SPY at the close, sell at 04:30 premarket
- **night_SPY_0700**: Buy SPY at the close, sell at 07:00 premarket
- **night_SPY_0900**: Buy SPY at the close, sell at 09:00 premarket
- **night_SPY_open**: Buy SPY at the close, sell at the 09:30 open
- **hold_QQQ**: Hold QQQ (price only, no costs)
- **day_QQQ**: Own QQQ only from 09:31 to the close
- **night_QQQ_0430**: Buy QQQ at the close, sell at 04:30 premarket
- **night_QQQ_0700**: Buy QQQ at the close, sell at 07:00 premarket
- **night_QQQ_0900**: Buy QQQ at the close, sell at 09:00 premarket
- **night_QQQ_open**: Buy QQQ at the close, sell at the 09:30 open
- **hold_TQQQ**: Hold TQQQ (price only, no costs)
- **day_TQQQ**: Own TQQQ only from 09:31 to the close
- **night_TQQQ_0430**: Buy TQQQ at the close, sell at 04:30 premarket
- **night_TQQQ_0700**: Buy TQQQ at the close, sell at 07:00 premarket
- **night_TQQQ_0900**: Buy TQQQ at the close, sell at 09:00 premarket
- **night_TQQQ_open**: Buy TQQQ at the close, sell at the 09:30 open
- **night_TQQQ_open_trend**: Buy TQQQ at the close and sell at the open, only while QQQ is above its 200-day average
- **attention_gainers**: At each close buy the 5 liquid stocks (price ≥ $10, ≥ $50M traded a day, no funds) with the biggest gain that day; sell at the next open. 0.10% cost per side.
- **attention_losers**: At each close buy the 5 liquid stocks (price ≥ $10, ≥ $50M traded a day, no funds) with the biggest loss that day; sell at the next open. 0.10% cost per side.
- **attention_volume**: At each close buy the 5 liquid stocks (price ≥ $10, ≥ $50M traded a day, no funds) with the biggest volume surge that day; sell at the next open. 0.10% cost per side.

## Limits
- Entry is the 15:59 bar's close; exits are the last trade completed by each time (premarket) or the first regular minute. Real fills can differ, most of all in thin premarket trading.
- Robinhood's agentic tools allow premarket selling only as whole-share limit orders (fractional shares trade 09:30–16:00 only), and a trade every night needs the "limited margin" setting (unsettled funds).
- The stock rows use daily bars (close to next open) and a flat 0.10% cost per side; small, volatile names cost more.
- Several variants are shown; treat the pattern (where returns accrue) as the result, not the single best row.
