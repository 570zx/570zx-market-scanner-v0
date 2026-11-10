"""Strategy research engine.

A hypothesis is a falsifiable statement plus the rule that kills it, both written BEFORE the
experiment runs. `evaluate_bar_family` / `evaluate_panel_family` then run every setting in the
family through the same pipeline:

    signal (causal) -> backtest with costs -> discovery/holdout split -> walk-forward selection
    -> lookahead test -> parameter sensitivity -> deflated Sharpe -> bootstrap vs benchmark
    -> Monte Carlo of the path -> verdict

The verdict is computed by rule, not by judgement.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

from . import metrics as M
from . import strategies as S
from . import validation as V
from .backtest import BTResult, run_positions
from .costs import CostModel
from .data import Bars

PPY = 365.0                      # crypto trades every day
WF_START = "2018-01-01"          # first walk-forward test year
H0 = pd.Timestamp(V.HOLDOUT_START, tz="UTC").timestamp()
W0 = pd.Timestamp(WF_START, tz="UTC").timestamp()

KILL_STANDARD = (
    "Killed unless the walk-forward version, after Robinhood Tier 1 market-order costs, "
    "(1) makes money in the 2023+ holdout, (2) has a higher Sharpe than buying and holding over the same holdout, "
    "and (3) at least 60% of the settings tried are profitable in the holdout. "
    "Proven only if the deflated-Sharpe probability and the probability of beating holding are both 95% or more."
)


@dataclass(frozen=True)
class Hypothesis:
    id: str
    family: str
    statement: str
    source: str
    kill_rule: str = KILL_STANDARD


def to_daily(ts: np.ndarray, ret: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    day = ts // 86400
    edges = np.concatenate([[0], np.flatnonzero(np.diff(day)) + 1])
    return day[edges] * 86400, np.exp(np.add.reduceat(np.log1p(ret), edges)) - 1.0


def daily_mean(ts: np.ndarray, x: np.ndarray) -> np.ndarray:
    day = ts // 86400
    edges = np.concatenate([[0], np.flatnonzero(np.diff(day)) + 1])
    counts = np.diff(np.concatenate([edges, [len(x)]]))
    return np.add.reduceat(np.abs(x), edges) / counts


def stats(ret: np.ndarray, exposure: np.ndarray | None = None) -> dict:
    if len(ret) < 30:
        return {}
    st = M.equity_stats(ret, PPY, exposure)
    keep = ("years", "total_return", "cagr", "sharpe", "sortino", "max_drawdown", "ann_vol", "exposure", "return_per_unit_exposure")
    return {k: st[k] for k in keep if k in st}


def masks(dts: np.ndarray) -> dict:
    return {"discovery": dts < H0, "wf_2018_2022": (dts >= W0) & (dts < H0), "holdout": dts >= H0}


def trade_stats_by_period(bt: BTResult) -> dict:
    out = {}
    for name, m in (("discovery", bt.trade_entry < H0), ("wf_2018_2022", (bt.trade_entry >= W0) & (bt.trade_entry < H0)),
                    ("holdout", bt.trade_entry >= H0)):
        out[name] = M.trade_stats(bt.trade_ret[m]) if m.any() else {"trades": 0}
    return out


def sharpe_diff_boot(a: np.ndarray, b: np.ndarray, block: int = 20, n: int = 2000, seed: int = 1) -> dict:
    """Paired block bootstrap of (Sharpe of a) - (Sharpe of b), annualised."""
    L = len(a)
    if L < 3 * block:
        return {"p_better": float("nan")}
    rng = np.random.default_rng(seed)
    nb = L // block + 1
    starts = rng.integers(0, L - block, size=(n, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(n, -1)[:, :L]
    A, B = a[idx], b[idx]
    sa = np.divide(A.mean(1), A.std(1), out=np.zeros(n), where=A.std(1) > 0)
    sb = np.divide(B.mean(1), B.std(1), out=np.zeros(n), where=B.std(1) > 0)
    d = (sa - sb) * math.sqrt(PPY)
    return {"p_better": float((d > 0).mean()), "diff_ci95": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]}


def verdict(hold: dict, bench: dict, share_pos: float, dsr: float, p_better: float, lookahead_ok: bool,
            n_trades: int | None = None) -> str:
    if not lookahead_ok:
        return "INVALID: lookahead test failed"
    if not hold or not bench:
        return "INCONCLUSIVE: not enough data"
    if n_trades is not None and n_trades < 5:
        return f"INCONCLUSIVE: only {n_trades} trades in the holdout"
    s, sb = hold.get("sharpe", float("nan")), bench.get("sharpe", float("nan"))
    if not (s == s) or not (s > 0 and hold["cagr"] > 0):
        return "FAILS: loses money after costs"
    if s <= sb:
        if hold["max_drawdown"] < 0.6 * bench["max_drawdown"]:
            return "NO EDGE: lower drawdown than holding, but not a better return for the risk"
        return "FAILS: no better than holding"
    if share_pos < 0.6:
        return "FRAGILE: depends on the exact setting"
    if dsr == dsr and dsr >= 0.95 and p_better == p_better and p_better >= 0.95:
        return "SURVIVES"
    return "PROVISIONAL: beat holding out of sample, not statistically proven"


def stitch(sigs: dict, chosen: dict, ts: np.ndarray) -> np.ndarray:
    years = pd.to_datetime(ts, unit="s").year.to_numpy()
    out = np.zeros(len(ts))
    for y, label in chosen.items():
        m = years == int(y)
        out[m] = sigs[label][m]
    return out


def evaluate_bar_family(bars: Bars, configs: dict[str, Callable[[Bars], np.ndarray]], primary: CostModel,
                        others: tuple[CostModel, ...] = (), n_checks: int = 3) -> dict:
    n = len(bars)
    bench_bt = run_positions(bars, np.ones(n), primary)
    dts, bench = to_daily(bench_bt.ts, bench_bt.ret)
    mk = masks(dts)
    sigs, daily, per_cfg, look_ok = {}, {}, {}, True
    for label, fn in configs.items():
        sig = np.nan_to_num(np.asarray(fn(bars), float))
        sigs[label] = sig
        bt = run_positions(bars, sig, primary)
        _, d = to_daily(bt.ts, bt.ret)
        expo = daily_mean(bt.ts, bt.pos)
        daily[label] = d
        per_cfg[label] = {"discovery": stats(d[mk["discovery"]], expo[mk["discovery"]]),
                          "holdout": stats(d[mk["holdout"]], expo[mk["holdout"]]),
                          "trades": {k: {kk: v.get(kk) for kk in ("trades", "win_rate", "expectancy")} for k, v in trade_stats_by_period(bt).items()}}
        chk = V.prefix_invariance(fn, bars, n_checks=n_checks)
        per_cfg[label]["lookahead_ok"] = chk["passed"]
        look_ok &= chk["passed"]
    wf = V.walk_forward(daily, dts, PPY, first_test=WF_START)
    sig_wf = stitch(sigs, wf["chosen"], bars.ts)
    by_cost, wf_bt, wf_daily, wf_expo = {}, None, None, None
    for c in (primary, *others):
        bt = run_positions(bars, sig_wf, c)
        _, d = to_daily(bt.ts, bt.ret)
        expo = daily_mean(bt.ts, bt.pos)
        by_cost[c.name] = {k: stats(d[m], expo[m]) for k, m in mk.items() if k != "discovery"}
        if c is primary:
            wf_bt, wf_daily, wf_expo = bt, d, expo
    hold, bench_hold = by_cost[primary.name]["holdout"], stats(bench[mk["holdout"]])
    sens = V.sensitivity({k: v["holdout"].get("sharpe", float("nan")) for k, v in per_cfg.items()})
    sens_disc = V.sensitivity({k: v["discovery"].get("sharpe", float("nan")) for k, v in per_cfg.items()})
    dsr = M.deflated_sharpe(wf_daily[mk["holdout"]], n_trials=len(configs))
    pb = sharpe_diff_boot(wf_daily[mk["holdout"]], bench[mk["holdout"]])
    oos = dts >= W0
    mc = V.block_bootstrap(wf_daily[oos], PPY)
    wf_trades = trade_stats_by_period(wf_bt)
    v = verdict(hold, bench_hold, sens.get("share_positive", 0.0), dsr.get("dsr", float("nan")), pb.get("p_better", float("nan")), look_ok,
                n_trades=int(wf_trades["holdout"].get("trades", 0)))
    return {
        "verdict": v, "n_configs": len(configs), "lookahead_ok": look_ok,
        "walk_forward": {"chosen": wf["chosen"], "switches": wf["switches"], "by_cost": by_cost,
                         "trades": trade_stats_by_period(wf_bt), "turnover_per_year_holdout": turnover_per_year(wf_bt, mk["holdout"], dts)},
        "benchmark_hold": {k: stats(bench[m]) for k, m in mk.items()},
        "deflated_sharpe_holdout": dsr, "vs_holding_holdout": pb,
        "sensitivity_holdout": sens, "sensitivity_discovery": sens_disc,
        "monte_carlo_1y": mc, "configs": per_cfg,
        "_series": {"dts": dts, "wf": wf_daily, "bench": bench, "expo": wf_expo, "sig_wf": sig_wf, "bt": wf_bt, "sigs": sigs},
    }


def turnover_per_year(bt: BTResult, hold_mask_daily: np.ndarray, dts: np.ndarray) -> float:
    m = bt.ts >= H0
    if not m.any():
        return float("nan")
    delta = np.abs(np.diff(np.concatenate([[0.0], bt.pos])))
    years = (bt.ts[m][-1] - bt.ts[m][0]) / 86400 / 365
    return float(delta[m].sum() / years) if years > 0 else float("nan")


# ----------------------------- daily panel (several coins) -----------------------------

def panel_prefix_invariance(fn: Callable[[pd.DataFrame], pd.DataFrame], px: pd.DataFrame, n_checks: int = 3, seed: int = 4) -> bool:
    full = fn(px).to_numpy()
    rng = np.random.default_rng(seed)
    for k in rng.integers(len(px) // 2, len(px) - 1, size=n_checks):
        part = fn(px.iloc[: int(k) + 1]).to_numpy()
        if np.max(np.abs(np.nan_to_num(part[-30:]) - np.nan_to_num(full[int(k) - 29:int(k) + 1]))) > 1e-9:
            return False
    return True


def evaluate_panel_family(px: pd.DataFrame, configs: dict[str, Callable[[pd.DataFrame], pd.DataFrame]],
                          benches: dict[str, pd.DataFrame], cost: float, other_costs: dict[str, float] | None = None,
                          n_checks: int = 2) -> dict:
    dts = px.index[:-1].values.astype("datetime64[s]").astype(np.int64)      # UTC day stamps
    mk = masks(dts)
    W, daily, per_cfg, look_ok = {}, {}, {}, True
    for label, fn in configs.items():
        w = fn(px)
        W[label] = w
        d, turn = S.run_weights(px, w, cost)
        daily[label] = d
        expo = w.shift(1).fillna(0).abs().sum(axis=1).to_numpy()[:-1]
        per_cfg[label] = {"discovery": stats(d[mk["discovery"]], expo[mk["discovery"]]), "holdout": stats(d[mk["holdout"]], expo[mk["holdout"]])}
        ok = panel_prefix_invariance(fn, px, n_checks=n_checks)
        per_cfg[label]["lookahead_ok"] = ok
        look_ok &= ok
    wf = V.walk_forward(daily, dts, PPY, first_test=WF_START)
    years = px.index.year.to_numpy()
    w_wf = pd.DataFrame(0.0, index=px.index, columns=px.columns)
    for y, label in wf["chosen"].items():
        m = years == int(y)
        w_wf.loc[m] = W[label].loc[m].to_numpy()
    by_cost = {}
    costs = {"primary": cost, **(other_costs or {})}
    wf_daily = None
    for name, c in costs.items():
        d, turn = S.run_weights(px, w_wf, c)
        expo = w_wf.shift(1).fillna(0).abs().sum(axis=1).to_numpy()[:-1]
        by_cost[name] = {k: stats(d[m], expo[m]) for k, m in mk.items() if k != "discovery"}
        if name == "primary":
            wf_daily, wf_expo = d, expo
            held = w_wf.shift(1).fillna(0.0)
            tdaily = held.diff().abs().sum(axis=1).fillna(0.0).to_numpy()[:-1]
            hm = mk["holdout"]
            turn_hold = float(tdaily[hm].sum() / (hm.sum() / 365)) if hm.any() else float("nan")
    bench_out, bench_series = {}, {}
    for name, w in benches.items():
        d, _ = S.run_weights(px, w, cost)
        bench_series[name] = d
        bench_out[name] = {k: stats(d[m]) for k, m in mk.items()}
    best_bench = max(bench_out, key=lambda k: bench_out[k]["holdout"].get("sharpe", -9))
    hold = by_cost["primary"]["holdout"]
    sens = V.sensitivity({k: v["holdout"].get("sharpe", float("nan")) for k, v in per_cfg.items()})
    dsr = M.deflated_sharpe(wf_daily[mk["holdout"]], n_trials=len(configs))
    pb = sharpe_diff_boot(wf_daily[mk["holdout"]], bench_series[best_bench][mk["holdout"]])
    mc = V.block_bootstrap(wf_daily[dts >= W0], PPY)
    v = verdict(hold, bench_out[best_bench]["holdout"], sens.get("share_positive", 0.0), dsr.get("dsr", float("nan")), pb.get("p_better", float("nan")), look_ok)
    return {"verdict": v, "n_configs": len(configs), "lookahead_ok": look_ok,
            "walk_forward": {"chosen": wf["chosen"], "switches": wf["switches"], "by_cost": by_cost, "turnover_per_year_holdout": turn_hold},
            "benchmarks": bench_out, "benchmark_used": best_bench,
            "deflated_sharpe_holdout": dsr, "vs_benchmark_holdout": pb, "sensitivity_holdout": sens,
            "monte_carlo_1y": mc, "configs": per_cfg,
            "_series": {"dts": dts, "wf": wf_daily, "bench": bench_series, "w_wf": w_wf}}
