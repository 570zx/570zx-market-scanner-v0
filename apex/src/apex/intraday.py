"""Intraday research on 5-minute bars.

A day is 78 slots: slot k is the bar that starts at 09:30 + 5k minutes New York time. On early-close days
only slots 0..41 (to 13:00) exist. Every rule here decides at the CLOSE of a bar and trades at the OPEN of
the next one, and every position is closed at the open of the day's last bar (15:55, or 12:55 on an
early-close day), so nothing is ever held overnight.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .equities import EARLY_CLOSE, cost_of

SLOTS = 78


def ny_offset(ts: np.ndarray) -> np.ndarray:
    """UTC offset (seconds) of New York. US rule since 2007: daylight time from the second Sunday of March
    07:00 UTC to the first Sunday of November 06:00 UTC."""
    years = ts.astype("datetime64[s]").astype("datetime64[Y]").astype(int) + 1970
    off = np.full(len(ts), -5 * 3600, dtype=np.int64)
    for y in np.unique(years):
        mar1 = datetime(int(y), 3, 1, tzinfo=timezone.utc)
        second_sun = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7)
        nov1 = datetime(int(y), 11, 1, tzinfo=timezone.utc)
        first_sun = nov1 + timedelta(days=(6 - nov1.weekday()) % 7)
        a, b = int(second_sun.timestamp()) + 7 * 3600, int(first_sun.timestamp()) + 6 * 3600
        off[(years == y) & (ts >= a) & (ts < b)] = -4 * 3600
    return off


class Grid:
    """One symbol's regular-session 5-minute bars on a [days x 78] grid (NaN where there was no bar)."""

    def __init__(self, dates: pd.DatetimeIndex, o, h, l, c, v, vw):
        self.dates, self.o, self.h, self.l, self.c, self.v, self.vw = dates, o, h, l, c, v, vw
        n = len(dates)
        self.last = np.where(dates.isin(EARLY_CLOSE), 41, SLOTS - 1)          # slot of the day's final bar
        live = np.arange(SLOTS)[None, :] <= self.last[:, None]
        for a in (self.o, self.h, self.l, self.c, self.v, self.vw):
            a[~live] = np.nan
        # price you would get for an order sent to trade at the open of slot k: that bar's open, or (trading
        # halted, no prints) the first print after it; if there is none, the last close before it
        px = pd.DataFrame(self.o).bfill(axis=1).to_numpy()
        cf = pd.DataFrame(self.c).ffill(axis=1).to_numpy()
        px = np.where(np.isfinite(px), px, np.concatenate([np.full((n, 1), np.nan), cf[:, :-1]], axis=1))
        px[~live] = np.nan
        self.px, self.cf = px, np.where(live, cf, np.nan)                       # cf: last traded price as of each bar's close

    def truncate(self, last: pd.Timestamp) -> "Grid":
        m = self.dates <= last
        return Grid(self.dates[m], *(a[m].copy() for a in (self.o, self.h, self.l, self.c, self.v, self.vw)))


def load_grid(data_dir: str | Path, sym: str, dates: pd.DatetimeIndex) -> Grid:
    z = np.load(Path(data_dir) / f"bars5_{sym}.npz")
    ts = z["ts"].astype(np.int64)
    loc = ts + ny_offset(ts)
    mod = (loc % 86400) // 60
    keep = (mod >= 570) & (mod < 960)
    day = pd.to_datetime((loc[keep] // 86400) * 86400, unit="s")
    di = dates.get_indexer(day)
    slot = ((mod[keep] - 570) // 5).astype(int)
    ok = di >= 0
    out = []
    for k in ("o", "h", "l", "c", "v", "vw"):
        a = np.full((len(dates), SLOTS), np.nan)
        a[di[ok], slot[ok]] = z[k][keep][ok].astype(np.float64)
        out.append(a)
    return Grid(dates, *out)


# ------------------------------------------------------------------ signals (state per day and slot)
def noise_area_state(g: Grid, lookback: int = 14, mult: float = 1.0, check_every: int = 6, first_check: int = 5,
                     last_entry: int = 71, sides: str = "both", one_shot: bool = False, use_vwap: bool = True) -> np.ndarray:
    """Intraday momentum after Zarattini, Aziz & Barbon (2024). For each time of day, sigma is the average absolute
    move from the open to that time over the previous `lookback` sessions. The 'noise area' runs from
    min(open, previous close) * (1 - mult*sigma) to max(open, previous close) * (1 + mult*sigma).
    At each check (every half hour from 10:00): above the upper edge and above the session VWAP -> long (+1);
    below the lower edge and below VWAP -> short (-1); otherwise flat.
    Returns state[d, k]: the position wanted after the close of slot k (0 before the first check)."""
    n = len(g.dates)
    day_open = g.px[:, 0]
    prev_close = np.concatenate([[np.nan], np.array([g.cf[d, g.last[d]] for d in range(n - 1)])])
    move = np.abs(g.cf / day_open[:, None] - 1)
    sigma = pd.DataFrame(move).rolling(lookback, min_periods=max(5, lookback - 4)).mean().shift(1).to_numpy()   # previous sessions only
    ub = np.fmax(day_open, prev_close)[:, None] * (1 + mult * sigma)
    lb = np.fmin(day_open, prev_close)[:, None] * (1 - mult * sigma)
    pv = np.nancumsum(np.nan_to_num(g.vw) * np.nan_to_num(g.v), axis=1)
    vv = np.nancumsum(np.nan_to_num(g.v), axis=1)
    vwap = np.divide(pv, vv, out=np.full_like(pv, np.nan), where=vv > 0)
    up = (g.cf > ub) & ((g.cf > vwap) | (not use_vwap))
    dn = (g.cf < lb) & ((g.cf < vwap) | (not use_vwap))
    state = np.zeros((n, SLOTS), dtype=np.int8)
    for d in range(n):
        if not np.isfinite(prev_close[d]) or not np.isfinite(sigma[d, first_check]):
            continue
        s, done = 0, False
        for k in range(first_check, g.last[d] - 1):
            if (k - first_check) % check_every == 0:
                want = 1 if up[d, k] else (-1 if dn[d, k] else 0)
                if sides == "long" and want < 0:
                    want = 0
                if want != s:
                    if s != 0 and one_shot:
                        done = True
                    if want != 0 and (k > last_entry or done):
                        want = 0
                    s = want
            state[d, k] = s
    return state


def orb_state(g: Grid, n_bars: int = 3, sides: str = "both", last_entry: int = 65, stop: str = "range") -> np.ndarray:
    """Opening-range breakout. The range is the high and low of the first n_bars bars. The first close above the
    high -> long (+1); the first close below the low -> short (-1). One trade a day. A long is stopped out by a
    close back below the range low (stop='range') or its midpoint (stop='mid'); mirrored for shorts."""
    n = len(g.dates)
    hi = np.nanmax(g.h[:, :n_bars], axis=1)
    lo = np.nanmin(g.l[:, :n_bars], axis=1)
    mid = (hi + lo) / 2
    state = np.zeros((n, SLOTS), dtype=np.int8)
    for d in range(n):
        if not (np.isfinite(hi[d]) and np.isfinite(lo[d]) and hi[d] > lo[d]):
            continue
        s, done = 0, False
        for k in range(n_bars - 1, g.last[d] - 1):
            c = g.cf[d, k]
            if s == 0 and not done and k <= last_entry and k >= n_bars:
                if c > hi[d]:
                    s = 1
                elif c < lo[d] and sides == "both":
                    s = -1
            elif s == 1 and c < (lo[d] if stop == "range" else mid[d]):
                s, done = 0, True
            elif s == -1 and c > (hi[d] if stop == "range" else mid[d]):
                s, done = 0, True
            state[d, k] = s
    return state


# ------------------------------------------------------------------ P&L
def run_states(state: np.ndarray, long_g: Grid, short_g: Grid | None, long_sym: str, short_sym: str | None,
               size: np.ndarray | float = 1.0, cost_mult: float = 1.0) -> dict:
    """state[d, k] in {-1, 0, +1} decided at the close of slot k, traded at the open of slot k+1.
    +1 holds `long_sym`; -1 holds `short_sym` (an inverse fund, bought, never sold short). size[d] is the fraction
    of the account used that day. Everything is sold at the open of the day's last bar."""
    n = state.shape[0]
    size = np.broadcast_to(np.asarray(size, float), (n,))
    cl = float(cost_of([long_sym], cost_mult)[long_sym])
    cs = float(cost_of([short_sym], cost_mult)[short_sym]) if short_sym else 0.0
    ret, expo, tr, te = np.zeros(n), np.zeros(n), [], []
    for d in range(n):
        st = state[d]
        if not st.any() or not np.isfinite(size[d]) or size[d] <= 0:
            continue
        L = long_g.last[d]
        eq, cur, entry_px, held = 1.0, 0, np.nan, 0
        for k in range(0, L):                       # decision at close of slot k -> trade at open of slot k+1
            want = int(st[k]) if k < L - 1 else 0   # the decision at the close of the second-to-last bar is always: flat
            if want == -1 and short_g is None:
                want = 0
            if want != cur:
                if cur != 0:                        # sell what is held
                    g, c = (long_g, cl) if cur == 1 else (short_g, cs)
                    px = g.px[d, k + 1]
                    r = px / entry_px * (1 - c) ** 2 - 1 if np.isfinite(px) and np.isfinite(entry_px) else 0.0
                    eq *= 1 + size[d] * r
                    tr.append(r)
                    te.append(d)
                    cur = 0
                if want != 0:
                    g = long_g if want == 1 else short_g
                    px = g.px[d, k + 1]
                    if np.isfinite(px):
                        cur, entry_px = want, px
            if cur != 0:
                held += 1
        ret[d] = eq - 1
        expo[d] = size[d] * held / 288.0            # share of a 24-hour day (288 five-minute bars) in the market
    return {"ret": ret, "expo": expo, "dec": state.astype(float).sum(axis=1), "trade_ret": np.array(tr), "trade_entry": np.array(te, dtype=int)}
