"""Signal functions. Every function returns signal[t] using only bars 0..t (close of t).
The backtester fills at the open of t+1. All are long-or-flat: Robinhood spot crypto
cannot be shorted, and agent accounts trade long equities only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .data import Bars


def _s(a: np.ndarray) -> pd.Series:
    return pd.Series(a)


def sma_trend(b: Bars, n: int) -> np.ndarray:
    """Long while the close is above its n-bar average."""
    c = _s(b.c)
    return (c > c.rolling(n).mean()).to_numpy().astype(float)


def tsmom(b: Bars, n: int) -> np.ndarray:
    """Time-series momentum: long while the n-bar return is positive."""
    c = _s(b.c)
    return (c / c.shift(n) - 1 > 0).to_numpy().astype(float)


def donchian(b: Bars, n_in: int, n_out: int) -> np.ndarray:
    """Breakout: enter on a close above the highest high of the previous n_in bars,
    exit on a close below the lowest low of the previous n_out bars."""
    hi = _s(b.h).rolling(n_in).max().shift(1).to_numpy()
    lo = _s(b.l).rolling(n_out).min().shift(1).to_numpy()
    sig = np.zeros(len(b))
    on = False
    for t in range(len(b)):
        if not on and b.c[t] > hi[t]:
            on = True
        elif on and b.c[t] < lo[t]:
            on = False
        sig[t] = 1.0 if on else 0.0
    return sig


def dip_buy(b: Bars, drop: float, hold: int) -> np.ndarray:
    """Short-term reversal: after a bar that closes down by `drop` or more, hold for `hold` bars."""
    r = _s(b.c).pct_change()
    trig = (r <= -drop).astype(float)
    return (trig.rolling(hold).max().fillna(0) > 0).to_numpy().astype(float)


def vol_filtered_trend(b: Bars, n: int, vol_n: int, calm: bool) -> np.ndarray:
    """SMA trend, taken only when realised volatility is below (calm=True) or above
    (calm=False) its own expanding median. The median uses past data only."""
    r = _s(b.c).pct_change()
    vol = r.rolling(vol_n).std()
    med = vol.expanding(vol_n * 4).median()
    cond = (vol < med) if calm else (vol >= med)
    return (sma_trend(b, n) * cond.fillna(False).to_numpy()).astype(float)


def hours_window(b: Bars, start_hour: int, length: int, weekdays: tuple[int, ...] | None = None) -> np.ndarray:
    """Seasonality: hold during a fixed UTC window every day. signal[t] says whether to be
    long over bar t+1, so it is keyed on the hour of the NEXT bar (known in advance)."""
    nxt = b.ts + b.step
    hour = (nxt // 3600) % 24
    in_win = ((hour - start_hour) % 24) < length
    if weekdays is not None:
        dow = ((nxt // 86400) + 3) % 7        # 0 = Monday
        in_win &= np.isin(dow, weekdays)
    return in_win.astype(float)


def intraday_momentum(b: Bars, lookback: int, hold: int) -> np.ndarray:
    """Long for `hold` bars when the previous `lookback`-bar return is positive, re-decided every `hold` bars."""
    c = _s(b.c)
    up = (c / c.shift(lookback) - 1 > 0).to_numpy()
    idx = np.arange(len(b))
    decide = (idx % hold) == 0
    sig = np.zeros(len(b))
    cur = 0.0
    for t in range(len(b)):
        if decide[t]:
            cur = 1.0 if up[t] else 0.0
        sig[t] = cur
    return sig


def range_expansion(b: Bars, mult: float, avg_n: int, hold: int) -> np.ndarray:
    """Volatility expansion: when a bar's range is `mult` times the average range and it
    closes in its top quarter, go long for `hold` bars."""
    rng = _s(b.h - b.l)
    avg = rng.rolling(avg_n).mean().shift(1)
    pos_in_bar = (b.c - b.l) / np.where(b.h > b.l, b.h - b.l, np.nan)
    trig = ((rng > mult * avg) & (pos_in_bar > 0.75)).astype(float)
    return (trig.rolling(hold).max().fillna(0) > 0).to_numpy().astype(float)


def dislocation_entries(b: Bars, k: float, vol_n: int, vol_z: float) -> np.ndarray:
    """Liquidity dislocation: indices of bars that fell more than k standard deviations
    (rolling, past data only) on volume more than `vol_z` deviations above normal."""
    r = _s(b.c).pct_change()
    sd = r.rolling(vol_n).std().shift(1)
    lv = np.log1p(_s(b.v))
    vz = (lv - lv.rolling(vol_n).mean().shift(1)) / lv.rolling(vol_n).std().shift(1)
    trig = (r < -k * sd) & (vz > vol_z)
    return np.flatnonzero(trig.fillna(False).to_numpy())


# ---------- cross-sectional (daily panel of closes, one column per coin) ----------

def xs_momentum_weights(px: pd.DataFrame, lookback: int, top: int, rebalance: int, abs_filter: bool = True) -> pd.DataFrame:
    """Every `rebalance` days hold the `top` coins by `lookback`-day return, equal weight.
    With abs_filter, a coin must also have a positive return, otherwise that slot is cash."""
    mom = (px / px.shift(lookback) - 1).to_numpy()
    n, k = mom.shape
    w = np.zeros((n, k))
    last = np.zeros(k)
    for i in range(n):
        if i % rebalance == 0:
            m = mom[i]
            valid = np.isfinite(m)
            if abs_filter:
                valid &= m > 0
            last = np.zeros(k)
            idx = np.flatnonzero(valid)
            if len(idx):
                pick = idx[np.argsort(-m[idx], kind="stable")][:top]
                last[pick] = 1.0 / top
        w[i] = last
    return pd.DataFrame(w, index=px.index, columns=px.columns)


def xs_reversal_weights(px: pd.DataFrame, lookback: int, rebalance: int) -> pd.DataFrame:
    """Every `rebalance` days hold the single coin with the WORST `lookback`-day return (relative-value reversal)."""
    mom = (px / px.shift(lookback) - 1).to_numpy()
    n, k = mom.shape
    w = np.zeros((n, k))
    last = np.zeros(k)
    for i in range(n):
        if i % rebalance == 0:
            last = np.zeros(k)
            idx = np.flatnonzero(np.isfinite(mom[i]))
            if len(idx) == k:                      # only when every leg has history
                last[idx[np.argmin(mom[i][idx])]] = 1.0
        w[i] = last
    return pd.DataFrame(w, index=px.index, columns=px.columns)


def trend_basket_weights(px: pd.DataFrame, n: int) -> pd.DataFrame:
    """Equal slot per coin; a coin's slot is invested only while it is above its n-day average."""
    live = px.notna()
    above = (px > px.rolling(n).mean()) & live
    slots = live.sum(axis=1).clip(lower=1)
    return above.astype(float).div(slots, axis=0)


def run_weights(px: pd.DataFrame, w: pd.DataFrame, cost_per_side: float, delay: int = 1) -> tuple[np.ndarray, float]:
    """Daily portfolio returns for target weights w[D] decided on closes through day D.
    With delay=1 (default) the trade happens one full day later, at the close of D+1, because
    a daily reference price cannot be traded at the instant it is published. Cost is charged
    on every change in weights."""
    r = px.pct_change().shift(-1)                      # return earned from close D to close D+1
    held = w.shift(delay).fillna(0.0)                  # weights actually in place at close D
    gross = (held * r.fillna(0.0)).sum(axis=1)
    turn = held.diff().abs().sum(axis=1).fillna(0.0)
    net = (gross - cost_per_side * turn).to_numpy()[:-1]
    return net, float(turn.sum())
