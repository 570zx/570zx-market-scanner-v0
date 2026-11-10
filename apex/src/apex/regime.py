"""Market-regime classifier. Rule-based and causal: every threshold is a percentile of the
bar's own recent past (rolling window), so a label never depends on later data.

Labels (one per bar, first match wins):
  crisis          drawdown from the 90-bar high worse than 25% with volatility in its top decile
  thin            volume below half of its 180-bar median
  vol_expansion   short-term volatility more than 1.5x long-term volatility
  trend_up        above the long average and efficiency ratio high
  trend_down      below the long average and efficiency ratio high
  consolidation   volatility in its bottom third
  mean_reverting  everything else (choppy, no direction)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .data import Bars

LABELS = ["crisis", "thin", "vol_expansion", "trend_up", "trend_down", "consolidation", "mean_reverting"]


def classify(b: Bars, fast: int = 10, slow: int = 50, window: int = 730, warmup: int = 200) -> np.ndarray:
    c, v = pd.Series(b.c), pd.Series(b.v)
    r = c.pct_change()
    vol_f, vol_s = r.rolling(fast).std(), r.rolling(slow).std()
    vol_pct = vol_s.rolling(window, min_periods=warmup).rank(pct=True)          # vs the last `window` bars only
    volu_rel = v.rolling(fast).mean() / v.rolling(180, min_periods=90).median()  # vs its own recent normal
    dd = 1 - c / c.rolling(90).max()
    er = (c - c.shift(slow)).abs() / c.diff().abs().rolling(slow).sum()         # Kaufman efficiency ratio
    er_hi = er > er.rolling(window, min_periods=warmup).median()
    above = c > c.rolling(slow).mean()
    lab = np.full(len(b), "mean_reverting", dtype=object)
    lab[(vol_pct < 1 / 3).to_numpy()] = "consolidation"
    lab[(er_hi & ~above).to_numpy()] = "trend_down"
    lab[(er_hi & above).to_numpy()] = "trend_up"
    lab[(vol_f > 1.5 * vol_s).to_numpy()] = "vol_expansion"
    lab[(volu_rel < 0.5).to_numpy()] = "thin"
    lab[((dd > 0.25) & (vol_pct > 0.90)).to_numpy()] = "crisis"
    lab[:warmup] = "warmup"
    return lab


def returns_by_regime(ret: np.ndarray, labels: np.ndarray, periods_per_year: float) -> dict:
    """labels[t] is known at the close of bar t; ret[t+1] is earned afterwards. Align accordingly."""
    out = {}
    lab = labels[: len(ret)]
    for name in LABELS:
        m = lab == name
        x = ret[m]
        if len(x) < 20:
            continue
        out[name] = {"share_of_time": float(m.mean()), "mean_ann": float(x.mean() * periods_per_year),
                     "sharpe": float(x.mean() / x.std() * np.sqrt(periods_per_year)) if x.std() > 0 else float("nan"),
                     "bars": int(len(x))}
    return out
