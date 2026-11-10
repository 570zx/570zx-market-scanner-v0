"""The arithmetic of the three targets. No market data is needed for most of this:
these are constraints any strategy must satisfy, whatever its signal."""
from __future__ import annotations

import math

import numpy as np
from scipy.stats import norm


def growth_per_trade(p: float, payoff: float, f: float, cost_r: float = 0.0) -> float:
    """Expected log growth per trade. Win prob p; a win makes `payoff` R, a loss costs 1 R;
    f = fraction of equity risked (1 R); cost_r = round-trip cost in R, paid on every trade."""
    up, dn = 1 + f * (payoff - cost_r), 1 - f * (1 + cost_r)
    if up <= 0 or dn <= 0:
        return float("-inf")
    return p * math.log(up) + (1 - p) * math.log(dn)


def trades_needed(target_multiple: float, p: float, payoff: float, f: float, cost_r: float = 0.0) -> float:
    g = growth_per_trade(p, payoff, f, cost_r)
    return math.log(target_multiple) / g if g > 0 else float("inf")


def expectancy_r(p: float, payoff: float, cost_r: float = 0.0) -> float:
    return p * payoff - (1 - p) - cost_r


def kelly_required_sharpe(log_growth_per_year: float) -> float:
    """At full Kelly the best achievable log growth is S^2/2 (S = annual Sharpe).
    So a target growth rate needs at least S = sqrt(2 g), run at full-Kelly leverage."""
    return math.sqrt(2 * log_growth_per_year)


def kelly_drawdown_prob(x: float, kelly_multiple: float = 1.0) -> float:
    """Probability of EVER being down by fraction x from a high when betting `kelly_multiple`
    times the Kelly fraction (continuous approximation): (1-x)^(2/k - 1)."""
    return (1 - x) ** (2 / kelly_multiple - 1)


def simulate(sharpe: float, ann_vol: float, days: int, n: int = 20000, periods: int = 365, seed: int = 5,
             dd_stop: float | None = None) -> dict:
    """Simulate a strategy with a given true annual Sharpe run at a given annual volatility
    (volatility is the leverage dial). Daily steps. dd_stop applies a permanent drawdown breaker."""
    rng = np.random.default_rng(seed)
    mu, sd = sharpe * ann_vol / periods, ann_vol / math.sqrt(periods)
    r = rng.normal(mu, sd, size=(n, days))
    r = np.maximum(r, -0.999)
    eq = np.cumprod(1 + r, axis=1)
    peak = np.maximum.accumulate(np.concatenate([np.ones((n, 1)), eq], axis=1), axis=1)[:, 1:]
    dd = 1 - eq / peak
    if dd_stop is not None:
        hit = dd >= dd_stop
        first = np.where(hit.any(axis=1), hit.argmax(axis=1), days - 1)
        final = eq[np.arange(n), first]
        tripped = hit.any(axis=1)
    else:
        final, tripped = eq[:, -1], np.zeros(n, bool)
    mdd = dd.max(axis=1)
    return {"sharpe": sharpe, "ann_vol": ann_vol, "days": days,
            "median_return": float(np.median(final) - 1), "p_double": float((final >= 2).mean()),
            "p_loss": float((final < 1).mean()), "p_dd_12": float((mdd >= 0.12).mean()),
            "p_dd_50": float((mdd >= 0.50).mean()), "p_dd_90": float((mdd >= 0.90).mean()),
            "p_breaker_tripped": float(tripped.mean())}


def best_vol_for_doubling(sharpe: float, days: int, vols=None, **kw) -> dict:
    """For a given true Sharpe, search the leverage (volatility) that maximises the chance of
    doubling within `days`, and report what that leverage does to drawdowns."""
    vols = vols if vols is not None else [0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]
    rows = [simulate(sharpe, v, days, **kw) for v in vols]
    best = max(rows, key=lambda r: r["p_double"])
    return {"best": best, "rows": rows}


def lottery_doubling(per_bet_win_prob: float, months: int) -> float:
    """Chance of doubling `months` times in a row when each month is one all-in even-money bet."""
    return per_bet_win_prob ** months


def cost_hurdle_table(costs: dict, stops=(0.005, 0.01, 0.02, 0.05, 0.10)) -> list[dict]:
    """Round-trip cost expressed in R (multiples of the stop distance) for each cost model."""
    rows = []
    for name, rt in costs.items():
        rows.append({"cost_model": name, "round_trip": rt, **{f"stop_{s:g}": rt / s for s in stops}})
    return rows


# ---------------------------------------------------------------------------------------------
# Closed forms. Equity is modelled as geometric Brownian motion: a strategy with annual Sharpe S
# run at annual volatility sigma (sigma is the leverage dial) has log-drift m = S*sigma - sigma^2/2.
# Continuous rebalancing, no costs, no fat tails, any leverage available: an upper bound on reality.
# ---------------------------------------------------------------------------------------------

def p_touch_up(sharpe: float, sigma: float, years: float, multiple: float = 2.0) -> float:
    """Probability that equity reaches `multiple` x at some moment within `years`."""
    b, m, sd = math.log(multiple), sharpe * sigma - sigma ** 2 / 2, sigma * math.sqrt(years)
    return float(norm.cdf((m * years - b) / sd) + math.exp(min(700.0, 2 * m * b / sigma ** 2 + norm.logcdf((-b - m * years) / sd))))


def p_touch_down(sharpe: float, sigma: float, years: float, loss: float = 0.5) -> float:
    """Probability that equity is down by `loss` at some moment within `years`."""
    a, m, sd = -math.log(1 - loss), sharpe * sigma - sigma ** 2 / 2, sigma * math.sqrt(years)
    return float(norm.cdf((-a - m * years) / sd) + math.exp(min(700.0, -2 * m * a / sigma ** 2 + norm.logcdf((-a + m * years) / sd))))


def p_up_before_down(sharpe: float, sigma: float, multiple: float = 2.0, loss: float = 0.12) -> float:
    """Probability of reaching `multiple` x before ever being down `loss` (no time limit)."""
    b, a = math.log(multiple), -math.log(1 - loss)
    theta = 2 * sharpe / sigma - 1
    if abs(theta) < 1e-9:
        return a / (a + b)
    x = theta * a
    if x > 600:
        return 1.0
    return float((1 - math.exp(x)) / (math.exp(-theta * b) - math.exp(x)))


def best_leverage_to_touch(sharpe: float, years: float, multiple: float = 2.0) -> dict:
    sig = np.geomspace(0.05, 60.0, 500)
    ps = np.array([p_touch_up(sharpe, x, years, multiple) for x in sig])
    i = int(np.argmax(ps))
    return {"sharpe": sharpe, "p_touch": float(ps[i]), "vol_needed": float(sig[i]),
            "p_down_50_same_period": p_touch_down(sharpe, float(sig[i]), years, 0.5),
            "at_grid_edge": bool(i == len(sig) - 1)}


def min_vol_for_median_double(sharpe: float, years: float = 1.0) -> float | None:
    """Smallest volatility at which the median path doubles in `years` (needs S^2 >= 2 ln2 / years)."""
    g = math.log(2) / years
    disc = sharpe ** 2 - 2 * g
    return None if disc < 0 else sharpe - math.sqrt(disc)
