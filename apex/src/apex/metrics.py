"""Performance statistics with uncertainty. Nothing here looks at future data."""
from __future__ import annotations

import math

import numpy as np
from scipy import stats

EULER = 0.5772156649015329


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a proportion."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def longest_losing_streak(r: np.ndarray) -> int:
    best = cur = 0
    for x in r:
        cur = cur + 1 if x <= 0 else 0
        best = max(best, cur)
    return best


def max_drawdown(ret: np.ndarray) -> float:
    eq = np.cumprod(1.0 + ret)
    peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
    return float(np.max(1.0 - eq / peak)) if len(eq) else 0.0


def trade_stats(r: np.ndarray, n_boot: int = 2000, seed: int = 7) -> dict:
    """Per-trade statistics. `r` are net fractional returns per closed trade."""
    r = np.asarray(r, float)
    n = len(r)
    if n == 0:
        return {"trades": 0}
    wins, losses = r[r > 0], r[r <= 0]
    lo, hi = wilson(len(wins), n)
    mean = float(r.mean())
    sd = float(r.std(ddof=1)) if n > 1 else float("nan")
    t = mean / (sd / math.sqrt(n)) if n > 1 and sd > 0 else float("nan")
    rng = np.random.default_rng(seed)
    boot = rng.choice(r, size=(n_boot, n), replace=True).mean(axis=1) if n > 1 else np.array([mean])
    gp, gl = float(wins.sum()), float(-losses.sum())
    return {
        "trades": n,
        "win_rate": len(wins) / n,
        "win_rate_ci95": [lo, hi],
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "expectancy": mean,
        "expectancy_ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
        "t_stat": t,
        "profit_factor": gp / gl if gl > 0 else float("inf"),
        "longest_losing_streak": longest_losing_streak(r),
        "worst_trade": float(r.min()),
        "best_trade": float(r.max()),
    }


def equity_stats(ret: np.ndarray, periods_per_year: float, exposure: np.ndarray | None = None) -> dict:
    """Statistics of a per-period return series (already net of costs)."""
    ret = np.asarray(ret, float)
    n = len(ret)
    if n < 2:
        return {"periods": n}
    total = float(np.prod(1.0 + ret))
    years = n / periods_per_year
    cagr = total ** (1.0 / years) - 1.0 if total > 0 else -1.0
    mu, sd = float(ret.mean()), float(ret.std(ddof=1))
    downside = ret[ret < 0]
    dsd = float(np.sqrt((downside ** 2).mean())) if len(downside) else float("nan")
    ann = math.sqrt(periods_per_year)
    out = {
        "periods": n,
        "years": years,
        "total_return": total - 1.0,
        "cagr": cagr,
        "ann_vol": sd * ann,
        "sharpe": mu / sd * ann if sd > 0 else float("nan"),
        "sortino": mu / dsd * ann if dsd and dsd > 0 else float("nan"),
        "max_drawdown": max_drawdown(ret),
        "skew": float(stats.skew(ret)),
        "kurtosis": float(stats.kurtosis(ret, fisher=False)),
    }
    if exposure is not None:
        e = float(np.mean(np.abs(exposure)))      # time-weighted average exposure
        out["exposure"] = e
        out["return_per_unit_exposure"] = cagr / e if e > 0 else float("nan")
    return out


def expected_max_sharpe(n_trials: int, var_sr: float) -> float:
    """Expected best per-period Sharpe among `n_trials` strategies that have no edge
    (Bailey & Lopez de Prado, 'The Deflated Sharpe Ratio')."""
    if n_trials < 2:
        return 0.0
    z1 = stats.norm.ppf(1 - 1.0 / n_trials)
    z2 = stats.norm.ppf(1 - 1.0 / (n_trials * math.e))
    return math.sqrt(var_sr) * ((1 - EULER) * z1 + EULER * z2)


def deflated_sharpe(ret: np.ndarray, n_trials: int, var_sr_trials: float | None = None) -> dict:
    """Probability that the true Sharpe is above what luck alone would deliver as the
    best of `n_trials` tries. Values near 1 are good; under 0.95 is not evidence of an edge."""
    ret = np.asarray(ret, float)
    n = len(ret)
    sd = ret.std(ddof=1)
    if n < 30 or sd == 0:
        return {"dsr": float("nan")}
    sr = ret.mean() / sd
    sk, ku = stats.skew(ret), stats.kurtosis(ret, fisher=False)
    if var_sr_trials is None:
        var_sr_trials = 1.0 / n  # variance of a zero-edge per-period Sharpe estimate
    sr0 = expected_max_sharpe(n_trials, var_sr_trials)
    denom = math.sqrt(max(1e-12, 1 - sk * sr + (ku - 1) / 4.0 * sr * sr))
    z = (sr - sr0) * math.sqrt(n - 1) / denom
    return {"dsr": float(stats.norm.cdf(z)), "sr_per_period": float(sr), "luck_benchmark_sr": float(sr0), "n_trials": n_trials}


def breakeven_win_rate(payoff_ratio: float, cost_in_r: float = 0.0) -> float:
    """Win rate at which expectancy is zero. payoff_ratio = avg win / avg loss (both gross);
    cost_in_r = round-trip cost divided by the loss size."""
    return (1.0 + cost_in_r) / (1.0 + payoff_ratio)
