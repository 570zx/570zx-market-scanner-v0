"""Adversarial validation: every check here exists to kill a result, not to confirm it."""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from .data import Bars
from .metrics import equity_stats, max_drawdown

HOLDOUT_START = "2023-01-01"   # nothing after this date may be used to choose a rule or a setting


def holdout_index(ts: np.ndarray, start: str = HOLDOUT_START) -> int:
    return int(np.searchsorted(ts, pd.Timestamp(start, tz="UTC").timestamp()))


def prefix_invariance(signal_fn: Callable[[Bars], np.ndarray], bars: Bars, n_checks: int = 6, seed: int = 3) -> dict:
    """Lookahead test. Recompute the signal on data truncated at random points; the value at
    the truncation point must equal the value computed with the full history available.
    Any difference means the signal used information from the future."""
    full = np.nan_to_num(np.asarray(signal_fn(bars), float))
    rng = np.random.default_rng(seed)
    cuts = rng.integers(len(bars) // 2, len(bars) - 1, size=n_checks)
    worst = 0.0
    for k in cuts:
        part = np.nan_to_num(np.asarray(signal_fn(bars.slice(0, int(k) + 1)), float))
        worst = max(worst, float(np.max(np.abs(part[-50:] - full[int(k) - 49:int(k) + 1]))))
    return {"passed": bool(worst < 1e-9), "max_abs_diff": worst, "checks": int(n_checks)}


def block_bootstrap(ret: np.ndarray, periods_per_year: float, block: int = 20, n_sims: int = 2000,
                    horizon: int | None = None, seed: int = 11) -> dict:
    """Monte Carlo of the return path by resampling blocks (keeps short-range dependence).
    Reports the spread of outcomes over `horizon` periods (default: one year)."""
    ret = np.asarray(ret, float)
    horizon = horizon or int(periods_per_year)
    rng = np.random.default_rng(seed)
    nb = int(np.ceil(horizon / block))
    starts = rng.integers(0, max(1, len(ret) - block), size=(n_sims, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(n_sims, -1)[:, :horizon]
    paths = ret[idx]
    eq = np.cumprod(1 + paths, axis=1)
    peak = np.maximum.accumulate(np.concatenate([np.ones((n_sims, 1)), eq], axis=1), axis=1)[:, 1:]
    dd = (1 - eq / peak).max(axis=1)
    final = eq[:, -1] - 1
    q = lambda a, p: float(np.percentile(a, p))
    return {
        "horizon_periods": horizon,
        "return_p5": q(final, 5), "return_p50": q(final, 50), "return_p95": q(final, 95),
        "maxdd_p50": q(dd, 50), "maxdd_p95": q(dd, 95),
        "p_loss": float((final < 0).mean()),
        "p_double": float((final >= 1.0).mean()),
        "p_dd_over_12pct": float((dd > 0.12).mean()),
        "p_dd_over_50pct": float((dd > 0.50).mean()),
    }


def trade_bootstrap(trade_ret: np.ndarray, risk_fraction: float, n_trades: int, n_sims: int = 5000,
                    ruin_level: float = 0.5, seed: int = 13) -> dict:
    """Resample trade outcomes to study sequencing: each trade's return is applied to
    `risk_fraction` of equity scaled so that the average loss equals that fraction."""
    r = np.asarray(trade_ret, float)
    losses = r[r <= 0]
    unit = abs(losses.mean()) if len(losses) else abs(r).mean()
    rng = np.random.default_rng(seed)
    draws = rng.choice(r, size=(n_sims, n_trades), replace=True) / unit * risk_fraction
    draws = np.maximum(draws, -0.999)
    eq = np.cumprod(1 + draws, axis=1)
    peak = np.maximum.accumulate(np.concatenate([np.ones((n_sims, 1)), eq], axis=1), axis=1)[:, 1:]
    dd = (1 - eq / peak).max(axis=1)
    return {
        "n_trades": n_trades, "risk_fraction": risk_fraction,
        "median_return": float(np.median(eq[:, -1]) - 1),
        "return_p5": float(np.percentile(eq[:, -1], 5) - 1),
        "maxdd_p50": float(np.percentile(dd, 50)), "maxdd_p95": float(np.percentile(dd, 95)),
        "p_ruin": float((eq.min(axis=1) <= ruin_level).mean()),
        "p_double": float((eq[:, -1] >= 2).mean()),
    }


def walk_forward(ret_by_param: dict, ts: np.ndarray, periods_per_year: float, first_test: str = "2018-01-01",
                 min_trades_metric: Callable | None = None) -> dict:
    """Walk-forward selection. For each calendar year from `first_test`, pick the setting with
    the best Sharpe over ALL earlier data, then record that year's returns for that setting.
    The stitched series contains no setting chosen with knowledge of its own period."""
    keys = list(ret_by_param)
    years = pd.to_datetime(ts, unit="s", utc=True).year.to_numpy()
    y0 = pd.Timestamp(first_test).year
    out, chosen = np.zeros(len(ts)), {}
    used = np.zeros(len(ts), bool)
    for y in range(y0, int(years.max()) + 1):
        tr, te = years < y, years == y
        if tr.sum() < periods_per_year or te.sum() == 0:
            continue
        best, best_s = None, -np.inf
        for k in keys:
            x = ret_by_param[k][tr]
            s = x.mean() / x.std() if x.std() > 0 else -np.inf
            if s > best_s:
                best, best_s = k, s
        used |= te
        if best is None:                 # nothing has a track record yet: stay flat this year
            continue
        out[te] = ret_by_param[best][te]
        chosen[y] = best
    stats = equity_stats(out[used], periods_per_year) if used.any() else {}
    switches = sum(1 for a, b in zip(list(chosen.values())[:-1], list(chosen.values())[1:]) if a != b)
    return {"ret": out[used], "ts": ts[used], "chosen": {int(k): str(v) for k, v in chosen.items()}, "switches": switches, "stats": stats}


def sensitivity(sharpe_by_param: dict) -> dict:
    """How much does the result depend on the exact setting? A real effect is positive
    across most of the neighbourhood, not at one lucky point."""
    v = np.array([x for x in sharpe_by_param.values() if np.isfinite(x)])
    if len(v) == 0:
        return {}
    return {"settings": int(len(v)), "share_positive": float((v > 0).mean()), "median_sharpe": float(np.median(v)),
            "best_sharpe": float(v.max()), "worst_sharpe": float(v.min())}


def random_entry_pvalue(actual_mean: float, null_means: np.ndarray) -> float:
    """Share of random-entry portfolios that did at least as well as the strategy."""
    return float((np.asarray(null_means) >= actual_mean).mean())


def breakers(ret: np.ndarray, ts: np.ndarray, daily_loss: float | None = 0.02, max_dd: float | None = 0.12,
             resume_after_days: int | None = None, pos: np.ndarray | None = None, cost: float = 0.0) -> dict:
    """Apply the portfolio circuit breakers to a per-bar return series.

    Daily breaker: once the UTC day's loss reaches `daily_loss`, flat until the next UTC day.
    Drawdown breaker: once equity is `max_dd` below its high, stop. With resume_after_days=None
    the stop is permanent (a person has to restart it); otherwise trading resumes after that many
    days with the high-water mark reset.
    If `pos` is given, being forced flat while holding costs `cost` (the exit), and coming back
    into a position that was already open costs `cost` again (the re-entry)."""
    ret = np.asarray(ret, float)
    day = ts // 86400
    out = np.zeros_like(ret)
    eq = peak = 1.0
    day_start_eq, cur_day = 1.0, day[0]
    halted_until, day_halt, dd_trips, daily_trips, dead = -1, False, 0, 0, False
    was_blocked = False
    for i in range(len(ret)):
        if day[i] != cur_day:
            cur_day, day_start_eq, day_halt = day[i], eq, False
        if dead or day[i] < halted_until or day_halt:
            was_blocked = True
            continue
        r = ret[i]
        if was_blocked and pos is not None and i > 0 and pos[i] != 0 and pos[i - 1] != 0:
            r = (1 + r) * (1 - cost * abs(pos[i])) - 1          # pay to get back in
        was_blocked = False
        eq_new = eq * (1 + r)
        trip_day = daily_loss is not None and eq_new / day_start_eq - 1 <= -daily_loss
        trip_dd = max_dd is not None and 1 - eq_new / max(peak, eq_new) >= max_dd
        if (trip_day or trip_dd) and pos is not None and pos[i] != 0:
            r = (1 + r) * (1 - cost * abs(pos[i])) - 1          # pay to get out
            eq_new = eq * (1 + r)
        out[i] = r
        eq = eq_new
        peak = max(peak, eq)
        if trip_day:
            day_halt, daily_trips = True, daily_trips + 1
        if trip_dd:
            dd_trips += 1
            if resume_after_days is None:
                dead = True
            else:
                halted_until, peak = day[i] + resume_after_days, eq
    return {"ret": out, "dd_trips": dd_trips, "daily_trips": daily_trips, "stopped_for_good": dead,
            "max_drawdown": max_drawdown(out), "final": float(np.prod(1 + out) - 1)}
