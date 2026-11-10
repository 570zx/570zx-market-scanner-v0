"""Continuous improvement: is a strategy's forward (paper or live) record still consistent with
its backtest? A strategy that drifts below what the backtest allows goes back to research; a
changed strategy is a new strategy and must pass every validation gate again."""
from __future__ import annotations

import math

import numpy as np
from scipy import stats

MIN_TRADES = 20      # below this, any verdict is noise


def degradation_check(forward: np.ndarray, backtest: np.ndarray, n_boot: int = 5000, seed: int = 0) -> dict:
    """Where does the forward record fall among same-sized samples drawn from the backtest?
    Under the 5th percentile on average return: DEGRADED. Under the 20th: WATCH."""
    forward, backtest = np.asarray(forward, float), np.asarray(backtest, float)
    n = len(forward)
    out = {"forward_trades": n, "backtest_trades": int(len(backtest))}
    if n == 0 or len(backtest) < 30:
        return {**out, "status": "TOO_EARLY"}
    rng = np.random.default_rng(seed)
    samples = rng.choice(backtest, size=(n_boot, n), replace=True)
    pct_mean = float((samples.mean(axis=1) <= forward.mean()).mean())
    pct_win = float(((samples > 0).mean(axis=1) <= (forward > 0).mean()).mean())
    status = "TOO_EARLY" if n < MIN_TRADES else "DEGRADED" if pct_mean < 0.05 else "WATCH" if pct_mean < 0.20 else "OK"
    return {**out, "forward_mean": float(forward.mean()), "backtest_mean": float(backtest.mean()), "percentile_of_forward_mean": pct_mean,
            "forward_win_rate": float((forward > 0).mean()), "backtest_win_rate": float((backtest > 0).mean()),
            "percentile_of_forward_win_rate": pct_win, "status": status}


def win_rate_check(wins: int, n: int, expected: float) -> dict:
    """Binomial test of a forward win count against the backtest's win rate (for when only
    summary statistics of the backtest are available)."""
    if n == 0:
        return {"trades": 0, "status": "TOO_EARLY"}
    p_low = float(stats.binom.cdf(wins, n, expected))          # chance of this few wins or fewer if nothing changed
    status = "TOO_EARLY" if n < MIN_TRADES else "DEGRADED" if p_low < 0.05 else "WATCH" if p_low < 0.20 else "OK"
    return {"trades": n, "wins": wins, "expected_win_rate": expected, "p_this_few_wins_or_fewer": p_low, "status": status}


def mean_check(mean: float, n: int, expected_mean: float, expected_sd: float) -> dict:
    """How likely is an average trade this low if the backtest still held? Normal approximation from the
    backtest's mean and standard deviation per trade. Trade returns are skewed (many small wins, a few large
    losses), so for a small count this is rough and errs toward raising the alarm."""
    if n == 0:
        return {"trades": 0, "status": "TOO_EARLY"}
    p_low = float(stats.norm.cdf((mean - expected_mean) / (expected_sd / math.sqrt(n))))
    status = "TOO_EARLY" if n < MIN_TRADES else "DEGRADED" if p_low < 0.05 else "WATCH" if p_low < 0.20 else "OK"
    return {"trades": n, "avg_trade": mean, "expected_avg_trade": expected_mean, "p_this_low_or_lower": p_low, "status": status}
