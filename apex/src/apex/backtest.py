"""Backtesting.

Two simulators, both strictly causal:

run_positions   Bar-based. signal[t] may use information up to and including the close of
                bar t. The order goes in at the OPEN of bar t+1, never at the close that
                produced the signal. Costs are charged on every change of position.

bracket_trades  Event-driven on 1-minute bars for entries with a profit target, a stop and
                a time limit. If target and stop are both touched in the same minute the
                stop is assumed to have filled first. A stop that is gapped through fills
                at the worse price.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .costs import CostModel
from .data import Bars


@dataclass
class BTResult:
    ts: np.ndarray          # start time of each holding interval
    ret: np.ndarray         # net return of each interval
    pos: np.ndarray         # position held during each interval
    trade_ret: np.ndarray   # net return of each closed trade
    trade_entry: np.ndarray
    trade_exit: np.ndarray
    turnover: float         # sum of |position changes|

    def daily(self, step: int) -> np.ndarray:
        """Compound interval returns into UTC-day returns."""
        if step >= 86400:
            return self.ret
        day = self.ts // 86400
        edges = np.flatnonzero(np.diff(day)) + 1
        return np.exp(np.add.reduceat(np.log1p(self.ret), np.concatenate([[0], edges]))) - 1.0


def run_positions(bars: Bars, signal: np.ndarray, cost: CostModel) -> BTResult:
    n = len(bars)
    signal = np.nan_to_num(np.asarray(signal, float))
    if len(signal) != n:
        raise ValueError("signal length must equal number of bars")
    held = np.zeros(n - 1)
    held[1:] = signal[: n - 2]            # signal at close t-1 -> filled at open t -> held over [open t, open t+1)
    r = bars.o[1:] / bars.o[:-1] - 1.0
    delta = np.diff(np.concatenate([[0.0], held]))
    ret = held * r - cost.per_side * np.abs(delta)
    # closed trades: maximal runs of non-zero position with the same sign
    sgn = np.sign(held)
    change = np.flatnonzero(np.diff(np.concatenate([[0.0], sgn, [0.0]])) != 0)
    tr, te, tx = [], [], []
    for a, b in zip(change[:-1], change[1:]):
        if sgn[a] == 0:
            continue
        if b >= n - 1:                    # still open at the end of the data: not a closed trade
            continue
        seg = held[a:b] * r[a:b] - cost.per_side * np.abs(np.concatenate([[held[a]], np.diff(held[a:b])]))
        gross = np.prod(1.0 + seg) * (1.0 - cost.per_side * abs(held[b - 1])) - 1.0
        tr.append(gross / abs(held[a:b]).max())   # return on the capital committed to the trade
        te.append(bars.ts[a])
        tx.append(bars.ts[b])
    return BTResult(bars.ts[:-1], ret, held, np.array(tr), np.array(te, dtype=np.int64), np.array(tx, dtype=np.int64), float(np.abs(delta).sum()))


@dataclass
class BracketResult:
    ret: np.ndarray       # net return per trade
    gross: np.ndarray     # return before costs
    entry_ts: np.ndarray
    exit_ts: np.ndarray
    reason: np.ndarray    # 'target' | 'stop' | 'time'
    skipped: int          # signals not taken (already in a trade, no fill, or outage)


def bracket_trades(m1: Bars, entry_idx: np.ndarray, target: float, stop: float, max_hold: int,
                   entry_cost: float, target_cost: float, stop_cost: float, time_cost: float,
                   one_at_a_time: bool = True, limit_entry: bool = False, fill_window: int = 30) -> BracketResult:
    """Simulate long bracket trades on 1-minute bars.

    entry_idx   index of the minute whose CLOSE produced the signal; the order is placed for the next minute.
    target/stop fractional distances from the entry price (e.g. 0.01 = 1%).
    *_cost      per-side cost fraction for each leg (lets entries/targets be maker and stops taker).
    limit_entry if True, entry is a resting limit at the signal close and only fills if price
                trades strictly below it within `fill_window` minutes (no fill, no trade).
    """
    n = len(m1)
    o, h, l, c, ts = m1.o, m1.h, m1.l, m1.c, m1.ts
    ok = m1.ok if m1.ok is not None else np.ones(n, bool)
    R, G, E, X, why = [], [], [], [], []
    skipped, free_at = 0, 0
    for i in np.sort(np.asarray(entry_idx, dtype=np.int64)):
        start = i + 1
        if start >= n - 1 or (one_at_a_time and start < free_at) or not ok[start]:
            skipped += 1
            continue
        if limit_entry:
            lim = c[i]
            w = l[start:start + fill_window] < lim
            if not w.any():
                skipped += 1
                continue
            start = start + int(np.argmax(w))
            entry = lim                    # a resting limit fills at its own price
        else:
            entry = o[start]
        end = min(start + max_hold, n - 1)
        tp, sl = entry * (1 + target), entry * (1 - stop)
        hh, ll = h[start:end], l[start:end]
        if limit_entry:                    # on the fill minute only prices after the fill count; be conservative:
            hh = hh.copy(); hh[0] = min(hh[0], entry)   # no target credit on the fill minute
        hit_t = hh >= tp
        hit_s = ll <= sl
        it = int(np.argmax(hit_t)) if hit_t.any() else 10 ** 12
        is_ = int(np.argmax(hit_s)) if hit_s.any() else 10 ** 12
        if is_ <= it and is_ < 10 ** 12:
            j = start + is_
            px, fee, reason = min(sl, o[j]) if j > start else sl, stop_cost, "stop"
        elif it < 10 ** 12:
            j = start + it
            px, fee, reason = tp, target_cost, "target"
        else:
            j = end
            px, fee, reason = o[end], time_cost, "time"
        gross = px / entry - 1.0
        net = (px * (1 - fee)) / (entry * (1 + entry_cost)) - 1.0
        R.append(net); G.append(gross); E.append(ts[start]); X.append(ts[j]); why.append(reason)
        free_at = j + 1
    return BracketResult(np.array(R), np.array(G), np.array(E, dtype=np.int64), np.array(X, dtype=np.int64), np.array(why), skipped)
