#!/usr/bin/env python3
"""APEX round one: experiments on free public data with Robinhood's published costs.

Every hypothesis below was written, with its kill rule, before this script was first run.
Nothing dated 2023-01-01 or later is used to pick a rule or a setting.

Usage:  python3 scripts/run_experiments.py [--prior DIR_WITH_MEDS_BACKTEST_RESULTS] [--fast]
Output: results/summary.json, results/ledger.jsonl (append-only), results/series/*.csv
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from apex import feasibility as F  # noqa: E402
from apex import metrics as M  # noqa: E402
from apex import regime as RG  # noqa: E402
from apex import strategies as S  # noqa: E402
from apex import validation as V  # noqa: E402
from apex.backtest import bracket_trades, run_positions  # noqa: E402
from apex.costs import GROSS, RH_CRYPTO_MAKER, RH_CRYPTO_T3, RH_CRYPTO_TAKER, CostModel, rh_crypto_tier  # noqa: E402
from apex.data import load_btc, load_cm  # noqa: E402
from apex.ledger import Ledger, _clean, data_fingerprint  # noqa: E402
from apex.research import (H0, PPY, W0, Hypothesis, KILL_STANDARD, evaluate_bar_family, evaluate_panel_family,  # noqa: E402
                           masks, sharpe_diff_boot, stats, to_daily, daily_mean)
from apex.risk import kelly_fraction  # noqa: E402

DATA, OUT = ROOT / "data", ROOT / "results"
TAKER, MAKER = RH_CRYPTO_TAKER, RH_CRYPTO_MAKER
T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


def slim(res: dict) -> dict:
    return {k: v for k, v in res.items() if not k.startswith("_")}


def tstat(x: np.ndarray) -> float:
    x = np.asarray(x, float)
    return float(x.mean() / (x.std(ddof=1) / math.sqrt(len(x)))) if len(x) > 2 and x.std() > 0 else float("nan")


# --------------------------------------------------------------------------------------
# Hypothesis registry (written before the first run)
# --------------------------------------------------------------------------------------
HYP = {h.id: h for h in [
    Hypothesis("H01", "BTC daily trend", "Being long BTC only while it is in an uptrend (above a moving average, positive momentum, or after a breakout) gives a better return for the risk than holding BTC.",
               "Time-series momentum literature (Moskowitz, Ooi & Pedersen 2012) and its crypto replications"),
    Hypothesis("H02", "BTC 4-hour trend", "The same trend rules on 4-hour bars react faster and still beat holding after costs.", "Extension of H01 to a faster clock"),
    Hypothesis("H03", "BTC hourly momentum", "Hourly momentum persists long enough to pay Robinhood's costs.", "Intraday momentum literature (Gao, Han, Li & Zhou 2018) applied to BTC"),
    Hypothesis("H04", "BTC hourly dip buying", "After a sharp one-hour drop BTC bounces enough to pay Robinhood's costs.", "Short-term reversal literature; liquidity-provision premium"),
    Hypothesis("H05", "BTC volatility expansion", "A wide-range hour that closes near its high is followed by continuation large enough to pay costs.", "Volatility-breakout trading folklore; range-expansion systems"),
    Hypothesis("H06", "BTC time of day", "Some fixed 4-hour window of the day has a reliably positive return that survives costs.", "Published intraday seasonality claims for BTC"),
    Hypothesis("H07", "BTC day of week", "Some weekday (or the weekend) has a reliably better return that survives costs.", "Weekend/day-of-week effect claims"),
    Hypothesis("H08", "BTC liquidity dislocation", "Buying right after a violent high-volume 5-minute drop, with a profit target and a stop, has positive expectancy after costs.",
               "Liquidation-cascade mean reversion", "Killed unless net expectancy per trade at Robinhood Tier 1 market-order costs is positive in the 2023+ holdout with t >= 2, and the before-cost result beats random entry times (p < 0.05) in both periods."),
    Hypothesis("H09", "Win rate by construction", "A 70% win rate can be manufactured from random entries by making the target small and the stop wide, with no edge at all.",
               "Arithmetic of asymmetric brackets", "This is a control, not a strategy: confirmed if random entries reach about 70%+ wins before costs while expectancy is zero or negative."),
    Hypothesis("H10", "Coin momentum rotation", "Holding the recently strongest Robinhood-listed coins beats holding BTC or an equal-weight basket.", "Cross-sectional momentum in crypto (Liu, Tsyvinski & Wu 2022)"),
    Hypothesis("H11", "Coin trend basket", "Holding each coin only while it is above its own moving average beats holding BTC or an equal-weight basket.", "Trend following applied coin by coin"),
    Hypothesis("H12", "BTC on-chain signals", "On-chain valuation (MVRV), exchange flows or address activity time BTC better than holding.", "On-chain analytics practice; Coin Metrics community data"),
    Hypothesis("H13", "Regime gating", "Switching the trend rule or the holding off in bad regimes (crisis, thin, volatility expansion, downtrend) improves on holding.", "Regime-switching allocation"),
    Hypothesis("H14", "Machine learning, daily", "Gradient-boosted trees on price, volume and on-chain features predict next-day direction well enough to beat holding, alone or as a filter on the trend rule (meta-labeling).",
               "Lopez de Prado (2018) meta-labeling; gradient boosting"),
    Hypothesis("H16", "BTC/ETH relative value", "Rotating between BTC and ETH on their relative strength (or relative weakness) beats holding BTC or a 50/50 mix.",
               "Pairs/relative-value trading, expressed long-only because Robinhood spot crypto cannot be shorted"),
    Hypothesis("H15", "Machine learning, hourly", "Gradient-boosted trees predict the next 4 hours well enough to pay Robinhood's costs.", "Same, on a faster clock"),
]}


# --------------------------------------------------------------------------------------
# 1. The arithmetic of the three targets
# --------------------------------------------------------------------------------------
def exp_feasibility(fast: bool) -> dict:
    costs = {"Robinhood crypto, market orders (Tier 1)": TAKER.round_trip, "Robinhood crypto, resting limit orders (Tier 1)": MAKER.round_trip,
             "Robinhood crypto, market orders at $50K+/month (Tier 3)": RH_CRYPTO_T3.round_trip,
             "Liquid ETF such as SPY/QQQ (assumed 0.05%/side)": 0.001, "Small-cap stock (MEDS measured about 0.5%/side)": 0.01}
    be = []
    for tgt, stp in ((0.005, 0.015), (0.01, 0.03), (0.02, 0.05), (0.03, 0.03), (0.05, 0.05), (0.05, 0.025), (0.10, 0.05), (0.20, 0.10)):
        row = {"target": tgt, "stop": stp, "breakeven_before_costs": stp / (tgt + stp)}
        for name, c in costs.items():
            row[name] = None if tgt <= c else (stp + c) / (tgt + stp)      # None: a win is smaller than the cost, cannot profit
        be.append(row)
    need = []
    for p, payoff in ((0.55, 1.0), (0.70, 0.6), (0.40, 2.0), (0.60, 1.0), (0.70, 1.0)):
        e = F.expectancy_r(p, payoff)
        row = {"win_rate": p, "payoff": payoff, "edge_R": e}
        for f in (0.005, 0.01, 0.02, 0.05):
            n = F.trades_needed(2.0, p, payoff, f)
            row[f"trades_to_double_at_{f:g}"] = n
        row["trades_per_trading_day_for_annual_double_at_0.005"] = row["trades_to_double_at_0.005"] / 252
        row["trades_per_trading_day_for_monthly_double_at_0.005"] = row["trades_to_double_at_0.005"] / 21
        need.append(row)
    annual = []
    for sh in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0):
        row = F.best_leverage_to_touch(sh, 1.0)
        mv = F.min_vol_for_median_double(sh, 1.0)
        row["min_vol_for_median_double"] = mv
        row["p_double_before_12pct_drawdown_at_that_vol"] = None if mv is None else F.p_up_before_down(sh, mv, 2.0, 0.12)
        row["p_double_before_50pct_drawdown_at_that_vol"] = None if mv is None else F.p_up_before_down(sh, mv, 2.0, 0.50)
        annual.append(row)
    monthly = []
    for sh in (0.0, 1.0, 2.0, 3.0, 4.0, 6.0, 10.0):
        row = F.best_leverage_to_touch(sh, 1 / 12)
        row["p_twelve_months_in_a_row"] = row["p_touch"] ** 12
        row["leverage_on_btc_at_60pct_vol"] = row["vol_needed"] / 0.60
        row["leverage_on_sp500_at_16pct_vol"] = row["vol_needed"] / 0.16
        monthly.append(row)
    sim_check = F.simulate(2.0, 0.40, 365, n=4000 if fast else 20000)
    return {
        "breakeven_win_rate": be, "costs_round_trip": costs, "trades_needed": need,
        "kelly": {"sharpe_needed_annual_double": F.kelly_required_sharpe(math.log(2)), "sharpe_needed_monthly_double": F.kelly_required_sharpe(12 * math.log(2)),
                  "p_double_before_halving_full_kelly": F.p_up_before_down(1.0, 1.0, 2.0, 0.5), "p_double_before_halving_half_kelly": F.p_up_before_down(1.0, 0.5, 2.0, 0.5),
                  "monthly_double_as_annual_multiple": 2 ** 12},
        "no_edge_bound": {"p_double_once": 0.5, "p_double_12_times": 1 / 4096},
        "annual_double_by_sharpe": annual, "monthly_double_by_sharpe": monthly,
        "simulation_cross_check": {"sharpe": 2.0, "vol": 0.40, "simulated_p_double_at_year_end": sim_check["p_double"],
                                   "closed_form_p_touch_double_within_year": F.p_touch_up(2.0, 0.40, 1.0)},
        "note": "Closed forms assume continuous rebalancing, no costs, no fat tails and any leverage on demand. Reality is worse on every count.",
    }


# --------------------------------------------------------------------------------------
# 2. Signal families on BTC bars
# --------------------------------------------------------------------------------------
def cfg_daily_trend() -> dict:
    c = {}
    for n in (20, 50, 100, 150, 200):
        c[f"Above {n}-day average"] = lambda b, n=n: S.sma_trend(b, n)
    for n in (20, 30, 60, 90, 120):
        c[f"{n}-day return positive"] = lambda b, n=n: S.tsmom(b, n)
    for a, z in ((20, 10), (55, 20), (100, 50)):
        c[f"{a}-day breakout, {z}-day exit"] = lambda b, a=a, z=z: S.donchian(b, a, z)
    return c


def cfg_h4_trend() -> dict:
    c = {}
    for d in (5, 10, 20, 50):
        c[f"Above {d}-day average (4h bars)"] = lambda b, n=d * 6: S.sma_trend(b, n)
    for d in (7, 14, 30):
        c[f"{d}-day return positive (4h bars)"] = lambda b, n=d * 6: S.tsmom(b, n)
    for a, z in ((20, 10), (55, 20)):
        c[f"{a}-day breakout, {z}-day exit (4h bars)"] = lambda b, a=a * 6, z=z * 6: S.donchian(b, a, z)
    return c


def cfg_h1_mom() -> dict:
    c = {}
    for n in (24, 72, 168):
        c[f"Above {n}-hour average"] = lambda b, n=n: S.sma_trend(b, n)
        c[f"{n}-hour return positive"] = lambda b, n=n: S.tsmom(b, n)
    for lb, hd in ((24, 4), (24, 24), (6, 6)):
        c[f"{lb}h return positive, hold {hd}h"] = lambda b, lb=lb, hd=hd: S.intraday_momentum(b, lb, hd)
    return c


def cfg_h1_dip() -> dict:
    return {f"Hour falls {int(d * 100)}%+, hold {h}h": (lambda b, d=d, h=h: S.dip_buy(b, d, h))
            for d, h in ((0.02, 6), (0.02, 24), (0.03, 12), (0.03, 24), (0.05, 24), (0.05, 72))}


def cfg_h1_volx() -> dict:
    return {f"Range {m:g}x normal, hold {h}h": (lambda b, m=m, h=h: S.range_expansion(b, m, 48, h))
            for m, h in ((2.0, 6), (2.0, 24), (3.0, 12), (3.0, 48))}


def cfg_hours() -> dict:
    return {f"Hold {s:02d}:00-{(s + 4) % 24:02d}:00 UTC": (lambda b, s=s: S.hours_window(b, s, 4)) for s in range(24)}


def cfg_dow() -> dict:
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    c = {f"Hold {names[d]} only": (lambda b, d=d: S.hours_window(b, 0, 24, (d,))) for d in range(7)}
    c["Hold weekends only"] = lambda b: S.hours_window(b, 0, 24, (5, 6))
    c["Hold weekdays only"] = lambda b: S.hours_window(b, 0, 24, (0, 1, 2, 3, 4))
    return c


def cfg_regime() -> dict:
    def gated(base, off=(), only=()):
        def f(b):
            lab = RG.classify(b)
            keep = np.isin(lab, only) if only else ~np.isin(lab, off)
            keep &= lab != "warmup"
            return base(b) * keep
        return f
    trend = lambda b: S.sma_trend(b, 50)
    hold = lambda b: np.ones(len(b))
    return {
        "50-day trend, out in crisis": gated(trend, off=("crisis",)),
        "50-day trend, out in crisis or thin": gated(trend, off=("crisis", "thin")),
        "50-day trend, out in volatility expansion": gated(trend, off=("vol_expansion",)),
        "50-day trend, only in an uptrend regime": gated(trend, only=("trend_up",)),
        "Hold, out in crisis": gated(hold, off=("crisis",)),
        "Hold, out in downtrend": gated(hold, off=("trend_down",)),
        "Hold, out in crisis or downtrend": gated(hold, off=("crisis", "trend_down")),
        "Hold, only in uptrend or consolidation": gated(hold, only=("trend_up", "consolidation")),
        "50-day trend, only when volatility is below its median": lambda b: S.vol_filtered_trend(b, 50, 30, True),
        "50-day trend, only when volatility is above its median": lambda b: S.vol_filtered_trend(b, 50, 30, False),
    }


def cfg_onchain(cm_btc: pd.DataFrame) -> dict:
    """Coin Metrics value for UTC day D is only knowable after D ends; the signal at the close of
    day D uses the value for day D-1 (one extra day of safety for publication lag)."""
    net = cm_btc["FlowOutExUSD"] - cm_btc["FlowInExUSD"]
    adr = cm_btc["AdrActCnt"]
    derived = {"mvrv": cm_btc["CapMVRVCur"], "net7": net.rolling(7).sum(), "net30": net.rolling(30).sum(),
               "adr_30_90": adr.rolling(30).mean() / adr.rolling(90).mean(), "adr_30_365": adr.rolling(30).mean() / adr.rolling(365).mean()}

    def feat(b, key):
        days = pd.to_datetime(b.ts, unit="s") - pd.Timedelta(days=1)
        return derived[key].reindex(days).to_numpy()
    c = {}
    for thr in (1.5, 2.0, 2.5, 3.0):
        c[f"MVRV below {thr:g}"] = lambda b, t=thr: (feat(b, "mvrv") < t).astype(float)
    c["Hold unless MVRV above 3.5"] = lambda b: (~(feat(b, "mvrv") > 3.5)).astype(float) * np.isfinite(feat(b, "mvrv"))
    c["Net exchange outflow, 7 days"] = lambda b: (feat(b, "net7") > 0).astype(float)
    c["Net exchange outflow, 30 days"] = lambda b: (feat(b, "net30") > 0).astype(float)
    c["Active addresses: 30-day above 90-day"] = lambda b: (feat(b, "adr_30_90") > 1).astype(float)
    c["Active addresses: 30-day above 365-day"] = lambda b: (feat(b, "adr_30_365") > 1).astype(float)
    c["50-day trend and MVRV below 3.5"] = lambda b: S.sma_trend(b, 50) * (feat(b, "mvrv") < 3.5)
    return c


# --------------------------------------------------------------------------------------
# 3. Seasonality detail (before-cost size of the effect)
# --------------------------------------------------------------------------------------
def seasonality_detail(h1, d1) -> dict:
    r, ts = h1.o[1:] / h1.o[:-1] - 1, h1.ts[:-1]
    hour = (ts // 3600) % 24
    disc, hold = ts < H0, ts >= H0
    md = np.array([r[disc & (hour == h)].mean() for h in range(24)])
    mh = np.array([r[hold & (hour == h)].mean() for h in range(24)])
    win_d = np.array([sum(md[(s + k) % 24] for k in range(4)) for s in range(24)])
    win_h = np.array([sum(mh[(s + k) % 24] for k in range(4)) for s in range(24)])
    best = int(np.argmax(win_d))
    rd, td = d1.o[1:] / d1.o[:-1] - 1, d1.ts[:-1]
    dow = ((td // 86400) + 3) % 7
    dd, dh = td < H0, td >= H0
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return {
        "hour_of_day": {"corr_discovery_vs_holdout": float(np.corrcoef(md, mh)[0, 1]),
                        "best_window_in_discovery": f"{best:02d}:00-{(best + 4) % 24:02d}:00 UTC",
                        "best_window_gross_bp_per_day_discovery": float(win_d[best] * 1e4),
                        "same_window_gross_bp_per_day_holdout": float(win_h[best] * 1e4),
                        "best_window_holdout_rank_of_24": int((win_h > win_h[best]).sum() + 1),
                        "round_trip_cost_bp_market_orders": TAKER.round_trip * 1e4, "round_trip_cost_bp_limit_orders": MAKER.round_trip * 1e4,
                        "mean_bp_by_hour_discovery": [float(x * 1e4) for x in md], "mean_bp_by_hour_holdout": [float(x * 1e4) for x in mh]},
        "day_of_week": {names[d]: {"discovery_bp": float(rd[dd & (dow == d)].mean() * 1e4), "discovery_t": tstat(rd[dd & (dow == d)]),
                                   "holdout_bp": float(rd[dh & (dow == d)].mean() * 1e4), "holdout_t": tstat(rd[dh & (dow == d)])} for d in range(7)},
    }


# --------------------------------------------------------------------------------------
# 4. Liquidity dislocation brackets + the win-rate control
# --------------------------------------------------------------------------------------
def exp_dislocation(m1, m5, fast: bool) -> dict:
    variants = {"1% target / 3% stop / 24h": (0.01, 0.03, 1440), "2% target / 2% stop / 24h": (0.02, 0.02, 1440), "5% target / 5% stop / 72h": (0.05, 0.05, 4320)}
    off = int((m5.ts[0] - m1.ts[0]) // 60)
    sets = {}
    for k in (3.0, 4.0):
        for vz in (1.0, 2.0):
            i5 = S.dislocation_entries(m5, k, 2016, vz)
            sets[f"drop > {k:g} sd, volume > {vz:g} sd"] = (i5 * 5 + off + 4).astype(np.int64)
    tk = TAKER.per_side

    def run(idx, v, scheme):
        tgt, stp, hd = variants[v]
        if scheme == "gross":
            return bracket_trades(m1, idx, tgt, stp, hd, 0, 0, 0, 0)
        if scheme == "taker":
            return bracket_trades(m1, idx, tgt, stp, hd, tk, tk, tk, tk)
        return bracket_trades(m1, idx, tgt, stp, hd, MAKER.per_side, MAKER.per_side, tk, tk, limit_entry=True)

    def split(br):
        out = {}
        for name, m in (("discovery", br.entry_ts < H0), ("holdout", br.entry_ts >= H0)):
            st = M.trade_stats(br.ret[m]) if m.any() else {"trades": 0}
            if m.any():
                st["exit_mix"] = {r: float((br.reason[m] == r).mean()) for r in ("target", "stop", "time")}
                st["gross_expectancy"] = float(br.gross[m].mean())
            out[name] = st
        return out

    res = {"signals": {k: int(len(v)) for k, v in sets.items()}, "by_set": {}}
    for sname, idx in sets.items():
        res["by_set"][sname] = {v: {sch: split(run(idx, v, sch)) for sch in ("gross", "taker", "maker")} for v in variants}
    # null: random entry times, same count, same rules
    primary = "drop > 3 sd, volume > 1 sd"
    idx = sets[primary]
    h_i = int(np.searchsorted(m1.ts, H0))
    reps = 20 if fast else 100
    rng = np.random.default_rng(21)
    null = {}
    for v in variants:
        tgt, stp, hd = variants[v]
        null[v] = {}
        for pname, lo, hi in (("discovery", 2016 * 5 * 2, h_i), ("holdout", h_i, len(m1) - hd - 2)):
            n_sig = int(((idx >= lo) & (idx < hi)).sum())
            means, wins = [], []
            for _ in range(reps):
                ridx = rng.integers(lo, hi, size=n_sig)
                br = bracket_trades(m1, ridx, tgt, stp, hd, 0, 0, 0, 0)
                if len(br.ret):
                    means.append(br.gross.mean())
                    wins.append((br.gross > 0).mean())
            actual = res["by_set"][primary][v]["gross"][pname]
            a_mean = actual.get("expectancy", float("nan"))
            null[v][pname] = {"random_mean_gross": float(np.mean(means)), "random_win_rate": float(np.mean(wins)),
                              "random_win_rate_p5_p95": [float(np.percentile(wins, 5)), float(np.percentile(wins, 95))],
                              "random_net_expectancy_market_orders": float(np.mean(means) - TAKER.round_trip),
                              "actual_mean_gross": a_mean, "p_value_vs_random": V.random_entry_pvalue(a_mean, np.array(means)), "reps": reps}
    res["null"] = null
    res["primary_set"] = primary
    # verdict by the pre-registered rule, on the primary set
    ok = False
    for v in variants:
        h = res["by_set"][primary][v]["taker"]["holdout"]
        beats = all(null[v][p]["p_value_vs_random"] < 0.05 for p in ("discovery", "holdout"))
        if h.get("trades", 0) >= 30 and h.get("expectancy", -1) > 0 and h.get("t_stat", 0) >= 2 and beats:
            ok = True
    res["verdict"] = "SURVIVES" if ok else "FAILS: negative expectancy after costs"
    a = null["1% target / 3% stop / 24h"]
    res["winrate_control_verdict"] = ("CONFIRMED: random entries win about %.0f%% of the time before costs with this bracket and lose %.2f%% per trade after Robinhood market-order costs"
                                      % (100 * a["discovery"]["random_win_rate"], -100 * a["discovery"]["random_net_expectancy_market_orders"]))
    res["n_configs"] = len(sets) * len(variants)
    return res


# --------------------------------------------------------------------------------------
# 5. Machine learning
# --------------------------------------------------------------------------------------
def _wf_predict(X: np.ndarray, y: np.ndarray, years: np.ndarray, first_year: int = 2016, purge: int = 5) -> np.ndarray:
    from sklearn.ensemble import HistGradientBoostingClassifier
    p = np.full(len(y), np.nan)
    for Y in range(first_year, int(years.max()) + 1):
        tr = np.flatnonzero((years < Y) & np.isfinite(y))
        te = np.flatnonzero(years == Y)
        if len(te) == 0 or len(tr) < 250:
            continue
        tr = tr[:-purge]                                   # labels near the boundary overlap the test year
        mdl = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150, l2_regularization=1.0,
                                             min_samples_leaf=40, early_stopping=False, random_state=0)
        mdl.fit(X[tr], y[tr])
        p[te] = mdl.predict_proba(X[te])[:, 1]
    return p


def ml_daily(cm_btc: pd.DataFrame):
    net = cm_btc["FlowOutExUSD"] - cm_btc["FlowInExUSD"]
    oc = pd.DataFrame({"mvrv": cm_btc["CapMVRVCur"], "adr_chg30": cm_btc["AdrActCnt"].pct_change(30), "tx_chg30": cm_btc["TxCnt"].pct_change(30),
                       "netflow_z": (net - net.rolling(90).mean()) / net.rolling(90).std()})
    cache: dict = {}

    def build(b):
        key = (len(b), int(b.ts[-1]))
        if key in cache:
            return cache[key]
        c, o, h, l, v = (pd.Series(x) for x in (b.c, b.o, b.h, b.l, b.v))
        r1 = c.pct_change()
        X = pd.DataFrame({f"ret_{n}": c.pct_change(n) for n in (1, 2, 3, 5, 10, 20, 50, 100)})
        X["vol_10"], X["vol_30"] = r1.rolling(10).std(), r1.rolling(30).std()
        X["vol_ratio"] = X["vol_10"] / X["vol_30"]
        lv = np.log1p(v)
        X["volu_z"] = (lv - lv.rolling(30).mean()) / lv.rolling(30).std()
        for n in (20, 50, 200):
            X[f"gap_{n}"] = c / c.rolling(n).mean() - 1
        X["range"] = (h - l) / c
        X["close_pos"] = (c - l) / (h - l).replace(0, np.nan)
        X["dow"] = ((b.ts // 86400) + 3) % 7
        days = pd.to_datetime(b.ts, unit="s") - pd.Timedelta(days=1)
        for col in oc:
            X[col] = oc[col].reindex(days).to_numpy()
        fwd = (o.shift(-2) / o.shift(-1) - 1).to_numpy()          # what a signal at the close of t earns
        y = np.where(np.isfinite(fwd), (fwd > 0).astype(float), np.nan)
        years = pd.to_datetime(b.ts, unit="s").year.to_numpy()
        Xv = X.to_numpy()
        p = _wf_predict(Xv, y, years)
        trend = S.sma_trend(b, 50)
        ym = np.where(trend > 0, y, np.nan)                      # meta-label: was the trend trade right?
        pm = _wf_predict(Xv, ym, years)
        cache[key] = (p, pm, trend, y, fwd)
        return cache[key]

    cfgs = {
        "Boosted trees: long when P(up) > 50%": lambda b: np.nan_to_num((build(b)[0] > 0.50).astype(float)),
        "Boosted trees: long when P(up) > 55%": lambda b: np.nan_to_num((build(b)[0] > 0.55).astype(float)),
        "50-day trend filtered by a meta-model": lambda b: build(b)[2] * np.nan_to_num((build(b)[1] > 0.50).astype(float)),
    }
    return cfgs, build


def ml_hourly():
    cache: dict = {}

    def build(b):
        key = (len(b), int(b.ts[-1]))
        if key in cache:
            return cache[key]
        c, o, h, l, v = (pd.Series(x) for x in (b.c, b.o, b.h, b.l, b.v))
        r1 = c.pct_change()
        X = pd.DataFrame({f"ret_{n}": c.pct_change(n) for n in (1, 2, 4, 12, 24, 72, 168)})
        X["vol_24"], X["vol_168"] = r1.rolling(24).std(), r1.rolling(168).std()
        X["vol_ratio"] = X["vol_24"] / X["vol_168"]
        lv = np.log1p(v)
        X["volu_z"] = (lv - lv.rolling(168).mean()) / lv.rolling(168).std()
        for n in (24, 168):
            X[f"gap_{n}"] = c / c.rolling(n).mean() - 1
        X["range"] = (h - l) / c
        X["close_pos"] = (c - l) / (h - l).replace(0, np.nan)
        X["hour"] = (b.ts // 3600) % 24
        X["dow"] = ((b.ts // 86400) + 3) % 7
        fwd = (o.shift(-5) / o.shift(-1) - 1).to_numpy()          # next 4 hours after the fill
        y = np.where(np.isfinite(fwd), (fwd > 0).astype(float), np.nan)
        years = pd.to_datetime(b.ts, unit="s").year.to_numpy()
        p = _wf_predict(X.to_numpy(), y, years, purge=8)
        cache[key] = (p, y, fwd)
        return cache[key]

    cfgs = {f"Boosted trees: long while P(up, next 4h) > {int(t * 100)}%": (lambda b, t=t: np.nan_to_num((build(b)[0] > t).astype(float))) for t in (0.50, 0.55, 0.60)}
    return cfgs, build


def ml_quality(p: np.ndarray, y: np.ndarray, fwd: np.ndarray, ts: np.ndarray) -> dict:
    from sklearn.metrics import brier_score_loss, roc_auc_score
    out = {}
    for name, m in (("wf_2018_2022", (ts >= W0) & (ts < H0)), ("holdout", ts >= H0)):
        k = m & np.isfinite(p) & np.isfinite(y)
        if k.sum() < 100:
            continue
        base = float(y[k].mean())
        q = pd.qcut(p[k], 10, labels=False, duplicates="drop")
        dec = pd.DataFrame({"q": q, "fwd": fwd[k], "p": p[k], "y": y[k]}).groupby("q").agg(mean_p=("p", "mean"), hit=("y", "mean"), mean_fwd_bp=("fwd", lambda x: x.mean() * 1e4))
        out[name] = {"n": int(k.sum()), "auc": float(roc_auc_score(y[k], p[k])), "accuracy_at_50": float(((p[k] > 0.5) == (y[k] > 0.5)).mean()),
                     "base_rate_up": base, "brier": float(brier_score_loss(y[k], p[k])), "brier_of_constant_base_rate": float(np.mean((y[k] - base) ** 2)),
                     "top_decile_mean_fwd_bp": float(dec["mean_fwd_bp"].iloc[-1]), "bottom_decile_mean_fwd_bp": float(dec["mean_fwd_bp"].iloc[0]),
                     "calibration": [{"predicted": float(a), "realised": float(b_)} for a, b_ in zip(dec["mean_p"], dec["hit"])]}
    return out


# --------------------------------------------------------------------------------------
# 6. Sizing, circuit breakers, account size (on the daily-trend walk-forward strategy)
# --------------------------------------------------------------------------------------
def exp_risk(d1, h1, f1: dict) -> dict:
    sig = f1["_series"]["sig_wf"]
    out = {}
    # --- sizing ---
    c = pd.Series(d1.c)
    vol30 = (c.pct_change().rolling(30).std() * math.sqrt(365)).to_numpy()
    disc_trades = f1["_series"]["bt"].trade_ret[(f1["_series"]["bt"].trade_entry >= W0) & (f1["_series"]["bt"].trade_entry < H0)]
    kf = kelly_fraction(disc_trades)
    quant = lambda e: np.round(np.clip(np.nan_to_num(e), 0, 1) * 4) / 4          # trade in quarter steps to limit churn
    sizers = {"All in while the signal is on": sig, "Half size": 0.5 * sig,
              "Volatility target 40%/yr (max 1x)": sig * quant(0.40 / vol30), "Volatility target 20%/yr (max 1x)": sig * quant(0.20 / vol30),
              f"Half Kelly from 2018-22 trades (Kelly = {kf:.2f}, capped at 1x)": sig * min(1.0, kf / 2),
              "0.5% of equity at risk per position (10% stop distance = 5% position)": 0.05 * sig}
    rows = {}
    for name, s in sizers.items():
        bt = run_positions(d1, s, TAKER)
        dts, d = to_daily(bt.ts, bt.ret)
        mk = masks(dts)
        rows[name] = {k: stats(d[m], daily_mean(bt.ts, bt.pos)[m]) for k, m in mk.items() if k != "discovery"}
    out["sizing"] = rows
    out["kelly_fraction_2018_2022"] = kf
    # --- breakers, on hourly marks so the daily-loss breaker can act inside the day ---
    didx = (h1.ts - d1.ts[0]) // 86400                        # which UTC day each hourly bar belongs to
    target = np.where((didx - 1 >= 0) & (didx - 1 < len(sig)), sig[np.clip(didx - 1, 0, len(sig) - 1)], 0.0)
    sig_h = np.roll(target, -1)
    sig_h[-1] = 0.0
    bt_h = run_positions(h1, sig_h, TAKER)
    bt_d = run_positions(d1, sig, TAKER)
    n_common = int(np.searchsorted(h1.ts, d1.ts[-1]))             # compare over the span both cover
    out["hourly_replica_check"] = {"daily_total": float(np.prod(1 + bt_d.ret) - 1), "hourly_total_same_span": float(np.prod(1 + bt_h.ret[:n_common]) - 1)}
    hold_h = run_positions(h1, np.ones(len(h1)), TAKER)
    rules = {"No breakers": dict(daily_loss=None, max_dd=None), "Daily 2% only": dict(daily_loss=0.02, max_dd=None),
             "Drawdown 12%, restart by hand (never restarted)": dict(daily_loss=None, max_dd=0.12, resume_after_days=None),
             "Drawdown 12%, 30-day cool-off": dict(daily_loss=None, max_dd=0.12, resume_after_days=30),
             "Both, 30-day cool-off": dict(daily_loss=0.02, max_dd=0.12, resume_after_days=30),
             "Both, wider: daily 5%, drawdown 25%, 30-day cool-off": dict(daily_loss=0.05, max_dd=0.25, resume_after_days=30)}
    br = {}
    for sname, bt in (("Daily trend (walk-forward)", bt_h), ("Hold BTC", hold_h)):
        br[sname] = {}
        for pname, m in (("wf_2018_2022", (bt.ts >= W0) & (bt.ts < H0)), ("holdout", (bt.ts >= H0) & (bt.ts < d1.ts[-1]))):
            br[sname][pname] = {}
            for rname, kw in rules.items():
                o = V.breakers(bt.ret[m], bt.ts[m], pos=bt.pos[m], cost=TAKER.per_side, **kw)
                _, d = to_daily(bt.ts[m], o["ret"])
                st = stats(d)
                br[sname][pname][rname] = {"cagr": st.get("cagr"), "sharpe": st.get("sharpe"), "max_drawdown": o["max_drawdown"],
                                           "drawdown_trips": o["dd_trips"], "daily_trips": o["daily_trips"], "stopped_for_good": o["stopped_for_good"]}
    out["breakers"] = br
    # --- account size: fee tier follows 30-day traded volume ---
    bt = bt_d
    hm = bt.ts >= H0
    delta = np.abs(np.diff(np.concatenate([[0.0], bt.pos])))
    turn30 = float(delta[hm].sum() / (hm.sum() / 30))
    acct = []
    for size in (250, 1_000, 2_000, 10_000, 50_000, 250_000, 1_000_000):
        tier, taker, maker = rh_crypto_tier(turn30 * size)
        cm_ = CostModel(f"tier {tier}", taker, 0.0002)
        b2 = run_positions(d1, sig, cm_)
        dts, d = to_daily(b2.ts, b2.ret)
        st = stats(d[dts >= H0])
        acct.append({"account": size, "avg_30d_volume": turn30 * size, "fee_tier": tier, "taker_fee": taker, "holdout_cagr": st.get("cagr"), "holdout_sharpe": st.get("sharpe"),
                     "risk_dollars_at_0.5pct": size * 0.005, "fees_per_year_dollars": float(delta[hm].sum() / (hm.sum() / 365) * size * taker)})
    out["account_size"] = {"turnover_per_30d_x_equity": turn30, "rows": acct,
                           "volume_needed_for_tier2": 10_000, "full_account_trades_per_month_to_reach_tier2_at_250": 10_000 / 250,
                           "fees_paid_reaching_tier2_at_250": 10_000 * 0.0095}
    return out


# --------------------------------------------------------------------------------------
# 7. Prior MEDS results, re-scored on the same statistics
# --------------------------------------------------------------------------------------
def exp_prior(prior: Path) -> dict:
    out = {"available": prior.exists()}
    if not prior.exists():
        return out
    runs = prior / "runs"

    def pair_trades(csv: Path, sym: str | None = None) -> np.ndarray:
        df = pd.read_csv(csv)
        if sym:
            df = df[df["sym"] == sym]
        r, buy = [], None
        for _, row in df.iterrows():
            if row["side"] == "buy":
                buy = row
            elif buy is not None:
                r.append((row["value"] - row["fee"]) / (buy["value"] + buy["fee"]) - 1)
                buy = None
        return np.array(r)

    edge = runs / "edge-2026-09-30-36686884727"
    ed = json.loads((edge / "results.json").read_text())
    rows = {}
    for item in ed["daily"] + ed["intraday"]:
        s = item["stats"]
        rows[s["id"]] = {"cagr": s["cagrPct"] / 100, "max_drawdown": s["maxDrawdownPct"] / 100, "sharpe": s["sharpe"], "trades": s["trades"],
                         "before_2025": s.get("beforeHoldoutPct", 0) / 100, "from_2025": s.get("holdoutPct", 0) / 100, "invested": s.get("investedPct", 0) / 100,
                         "from": s.get("from"), "to": s.get("to")}
    for sid, sym in (("ibs_QQQ", "QQQ"), ("ibs_SPY", "SPY"), ("rsi2_QQQ", "QQQ"), ("rsi2_SPY", "SPY"), ("trend_TQQQ", "TQQQ"), ("trend_QQQ", "QQQ")):
        f = edge / f"trades-{sid}.csv"
        if f.exists():
            st = M.trade_stats(pair_trades(f, sym))
            rows[sid]["trade_stats"] = {k: st.get(k) for k in ("trades", "win_rate", "win_rate_ci95", "avg_win", "avg_loss", "expectancy", "expectancy_ci95", "t_stat", "profit_factor", "longest_losing_streak")}
    out["edge_hunt"] = rows
    lead = runs / "2026-09-30-36642030554"
    lrows = {}
    for f in sorted(lead.glob("trades-v87_*.csv")):
        df = pd.read_csv(f)
        st = M.trade_stats(df["return_pct"].to_numpy() / 100)
        lrows[f.stem.replace("trades-", "")] = {k: st.get(k) for k in ("trades", "win_rate", "win_rate_ci95", "avg_win", "avg_loss", "expectancy", "expectancy_ci95", "t_stat", "profit_factor", "longest_losing_streak")}
        lrows[f.stem.replace("trades-", "")]["days"] = int(pd.to_datetime(df["opened_at"]).dt.date.nunique())
    out["leader_v87"] = lrows
    cp = json.loads((runs / "candle-portfolio-2026-10-21-39582308891" / "results.json").read_text())
    lv = json.loads((runs / "leveraged-2026-10-21-39606522680" / "results.json").read_text())
    pick = lambda d: {"cagr": d["cagr"], "sharpe": d["sharpe"], "max_drawdown": d["maxDd"], "trades": (d.get("trades") or {}).get("n"), "win_rate": (d.get("trades") or {}).get("winRate")}
    out["etf_weak_close"] = {"from": cp["from"], "n_configs": cp["nCfg"], "walk_forward": pick(cp["wf"]), "walk_forward_costs_x2": pick(cp["wfHard"]), "original": pick(cp["original"]), "hold_spy": pick(cp["spy"])}
    out["leveraged_etf_weak_close"] = {"from": lv["from"], "n_configs": lv["nCfg"], "walk_forward": pick(lv["wf"]), "original": pick(lv["original"]), "hold_spy": pick(lv["spy"]),
                                       "leverage_table": lv["levTable"], "six_month_doubling": lv["sixMonth"]}
    pf = prior / "paper_forward"
    if (pf / "ledger.json").exists():
        import re
        led_ = json.loads((pf / "ledger.json").read_text())
        md = (pf / "PAPER-FORWARD.md").read_text()
        head = re.search(r"Go-live (\S+); last update (\S+) \((\d+) sessions", md)
        eq = re.findall(r"Equity since go-live: (-?[\d.]+)% \(hold SPY: (-?[\d.]+)%\)\. Max drawdown ([\d.]+)%", md)
        out["paper_forward"] = {"go_live": head.group(1), "last_update": head.group(2), "sessions": int(head.group(3)), "accounts": {}}
        for (acct, v), e in zip(led_.items(), eq):
            rets = np.array([t["ret"] for t in v["trades"]])
            lo, hi = M.wilson(int((rets > 0).sum()), len(rets)) if len(rets) else (None, None)
            out["paper_forward"]["accounts"][acct] = {
                "equity_since_go_live": float(e[0]) / 100, "hold_spy_same_period": float(e[1]) / 100, "max_drawdown": float(e[2]) / 100,
                "closed_trades": int(len(rets)), "wins": int((rets > 0).sum()), "win_rate_ci95": [lo, hi],
                "avg_closed_trade": float(rets.mean()) if len(rets) else None,
                "open_positions": [{"sym": p["sym"], "entry_date": p["entryDate"], "entry": p["entry"], "mark": p["mark"], "pnl": p["mark"] / p["entry"] - 1, "days": p["days"]} for p in v["open"]],
                "trades": v["trades"]}
    ov = json.loads((runs / "overnight-2026-09-30-36690242616" / "results.json").read_text())
    out["overnight"] = {r["id"]: {"cagr": r["stats"]["cagrPct"] / 100, "sharpe": r["stats"]["sharpe"], "max_drawdown": r["stats"]["maxDrawdownPct"] / 100,
                                  "before_2025": r["stats"].get("beforeHoldoutPct", 0) / 100, "from_2025": r["stats"].get("holdoutPct", 0) / 100} for r in ov["rows"]}
    return out


# --------------------------------------------------------------------------------------
def summarize_family(h: Hypothesis, res: dict, market: str) -> dict:
    wf = res["walk_forward"]
    primary = next(iter(wf["by_cost"]))
    hold = wf["by_cost"][primary].get("holdout", {})
    pre = wf["by_cost"][primary].get("wf_2018_2022", {})
    bench = res.get("benchmark_hold", {}).get("holdout") or res.get("benchmarks", {}).get(res.get("benchmark_used", ""), {}).get("holdout", {})
    tr = wf.get("trades", {}).get("holdout", {})
    pb = res.get("vs_holding_holdout") or res.get("vs_benchmark_holdout") or {}
    return {"id": h.id, "name": h.family, "market": market, "verdict": res["verdict"], "settings_tried": res["n_configs"],
            "holdout_sharpe": hold.get("sharpe"), "holdout_cagr": hold.get("cagr"), "holdout_max_drawdown": hold.get("max_drawdown"), "holdout_exposure": hold.get("exposure"),
            "wf_2018_2022_sharpe": pre.get("sharpe"), "wf_2018_2022_cagr": pre.get("cagr"), "wf_2018_2022_max_drawdown": pre.get("max_drawdown"),
            "benchmark_holdout_sharpe": bench.get("sharpe"), "benchmark_holdout_cagr": bench.get("cagr"), "benchmark_holdout_max_drawdown": bench.get("max_drawdown"),
            "deflated_sharpe_prob": res["deflated_sharpe_holdout"].get("dsr"), "p_beats_benchmark": pb.get("p_better"),
            "share_of_settings_profitable_holdout": res["sensitivity_holdout"].get("share_positive"),
            "holdout_trades": tr.get("trades"), "holdout_win_rate": tr.get("win_rate"), "holdout_win_rate_ci95": tr.get("win_rate_ci95"),
            "holdout_expectancy": tr.get("expectancy"), "holdout_profit_factor": tr.get("profit_factor"), "holdout_longest_losing_streak": tr.get("longest_losing_streak")}


RANK = {"SURVIVES": 5, "PROVISIONAL": 4, "NO EDGE": 3, "FRAGILE": 2, "FAILS": 1, "INCONCLUSIVE": 1, "INVALID": 0, "CONFIRMED": 0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prior", default=str(ROOT.parent / "prior_results"))
    ap.add_argument("--fast", action="store_true", help="fewer simulations (smoke test)")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    (OUT / "series").mkdir(exist_ok=True)
    led = Ledger(OUT / ("ledger_smoke_tests.jsonl" if args.fast else "ledger.jsonl"), mode="fast" if args.fast else "full")
    summary: dict = {"run_id": led.run_id, "holdout_start": V.HOLDOUT_START, "walk_forward_start": "2018-01-01",
                     "data": data_fingerprint([DATA / "btc_1m.npz", DATA / "cm_daily.pkl"]),
                     "primary_cost": {"name": TAKER.name, "per_side": TAKER.per_side, "round_trip": TAKER.round_trip}}

    log("feasibility arithmetic")
    summary["feasibility"] = exp_feasibility(args.fast)

    d1, h4, h1 = load_btc(DATA, "1d"), load_btc(DATA, "4h"), load_btc(DATA, "1h")
    cm = load_cm(DATA)
    cm_btc = cm["btc"]
    summary["data"]["btc_bars"] = {"first": str(d1.index()[0].date()), "last": str(d1.index()[-1].date()), "daily_bars": len(d1), "hourly_bars": len(h1)}
    # 8 regime settings were also run once with an earlier classifier (all-history percentiles, which mislabelled
    # half of 2023+ as "thin"); they count toward the number of things tried.
    fam, ranking, total_trials = {}, [], 8
    others = (GROSS, MAKER, RH_CRYPTO_T3)

    ml_d_cfg, ml_d_build = ml_daily(cm_btc)
    ml_h_cfg, ml_h_build = ml_hourly()
    plan = [("H01", d1, cfg_daily_trend(), "BTC, daily"), ("H02", h4, cfg_h4_trend(), "BTC, 4-hour"), ("H03", h1, cfg_h1_mom(), "BTC, hourly"),
            ("H04", h1, cfg_h1_dip(), "BTC, hourly"), ("H05", h1, cfg_h1_volx(), "BTC, hourly"), ("H06", h1, cfg_hours(), "BTC, hourly"),
            ("H07", d1, cfg_dow(), "BTC, daily"), ("H12", d1, cfg_onchain(cm_btc), "BTC, daily"), ("H13", d1, cfg_regime(), "BTC, daily"),
            ("H14", d1, ml_d_cfg, "BTC, daily"), ("H15", h1, ml_h_cfg, "BTC, hourly")]
    for hid, bars, cfgs, market in plan:
        h = HYP[hid]
        log(f"{hid} {h.family}: {len(cfgs)} settings")
        res = evaluate_bar_family(bars, cfgs, TAKER, others, n_checks=2 if hid in ("H14", "H15") else 3)
        fam[hid] = res
        total_trials += len(cfgs)
        row = summarize_family(h, res, market)
        ranking.append(row)
        led.record(hid, h.statement, h.kill_rule, res["verdict"], slim(res), h.family, trials=len(cfgs), notes=h.source)
        log(f"   -> {res['verdict']} | holdout Sharpe {row['holdout_sharpe']} vs hold {row['benchmark_holdout_sharpe']}")
        s = res["_series"]
        pd.DataFrame({"date": pd.to_datetime(s["dts"], unit="s").date, "strategy": s["wf"], "hold_btc": s["bench"], "exposure": s["expo"]}).to_csv(OUT / "series" / f"{hid}.csv", index=False)

    log("seasonality detail")
    summary["seasonality"] = seasonality_detail(h1, d1)

    log("regime table")
    lab = RG.classify(d1)
    hold_ret = d1.o[1:] / d1.o[:-1] - 1                       # earned over bar t
    f1s = fam["H01"]["_series"]
    reg = {}
    for pname, m in (("discovery", d1.ts[:-1] < H0), ("holdout", d1.ts[:-1] >= H0)):
        lab_prev = np.concatenate([["warmup"], lab[:-2]])     # label known at the close of t-1 governs bar t
        reg[pname] = {"hold_btc": RG.returns_by_regime(hold_ret[m], lab_prev[m], PPY), "daily_trend_wf": RG.returns_by_regime(f1s["bt"].ret[m], lab_prev[m], PPY)}
    summary["regimes"] = reg

    log("H08/H09 dislocation brackets on 1-minute data")
    m1, m5 = load_btc(DATA, "1m"), load_btc(DATA, "5m")
    dis = exp_dislocation(m1, m5, args.fast)
    del m1
    total_trials += dis["n_configs"]
    summary["dislocation"] = dis
    led.record("H08", HYP["H08"].statement, HYP["H08"].kill_rule, dis["verdict"], dis, HYP["H08"].family, trials=dis["n_configs"], notes=HYP["H08"].source)
    led.record("H09", HYP["H09"].statement, HYP["H09"].kill_rule, dis["winrate_control_verdict"], dis["null"], HYP["H09"].family, trials=1, notes=HYP["H09"].source)
    pv = "1% target / 3% stop / 24h"
    hd = dis["by_set"][dis["primary_set"]][pv]["taker"]["holdout"]
    ranking.append({"id": "H08", "name": HYP["H08"].family, "market": "BTC, 1-minute", "verdict": dis["verdict"], "settings_tried": dis["n_configs"],
                    "holdout_trades": hd.get("trades"), "holdout_win_rate": hd.get("win_rate"), "holdout_win_rate_ci95": hd.get("win_rate_ci95"), "holdout_expectancy": hd.get("expectancy"),
                    "holdout_profit_factor": hd.get("profit_factor"), "holdout_longest_losing_streak": hd.get("longest_losing_streak"), "note": f"shown: {pv}, market orders"})
    log(f"   -> {dis['verdict']}")

    log("H10/H11 coin panel")
    coins = ["btc", "eth", "doge", "xrp", "ada", "link", "ltc", "bch", "xlm", "etc", "uni", "aave", "xtz", "comp", "dot"]
    px = pd.DataFrame({c: cm[(c, "PriceUSD")] for c in coins}).loc["2016-01-01":].dropna(how="all")
    live = px.notna()
    benches = {"Hold BTC": pd.DataFrame(0.0, index=px.index, columns=px.columns).assign(btc=1.0), "Hold equal-weight basket": live.astype(float).div(live.sum(axis=1), axis=0)}
    xs = {f"Top {t} by {lb}-day return, rebalance every {rb} days": (lambda p, lb=lb, t=t, rb=rb: S.xs_momentum_weights(p, lb, t, rb))
          for lb in (14, 30, 60, 90) for t in (1, 3) for rb in (7, 30)}
    tb = {f"Each coin while above its {n}-day average": (lambda p, n=n: S.trend_basket_weights(p, n)) for n in (20, 50, 100, 200)}
    for hid, cfgs in (("H10", xs), ("H11", tb)):
        h = HYP[hid]
        res = evaluate_panel_family(px, cfgs, benches, TAKER.per_side, {"gross": 0.0, "limit orders": MAKER.per_side})
        fam[hid] = res
        total_trials += len(cfgs)
        row = summarize_family(h, res, "15 Robinhood-listed coins, daily")
        ranking.append(row)
        led.record(hid, h.statement, h.kill_rule, res["verdict"], slim(res), h.family, trials=len(cfgs), notes=h.source + "; universe is coins listed today, which flatters the result")
        log(f"   {hid} -> {res['verdict']} | holdout Sharpe {row['holdout_sharpe']} vs {res['benchmark_used']} {row['benchmark_holdout_sharpe']}")
        s = res["_series"]
        pd.DataFrame({"date": pd.to_datetime(s["dts"], unit="s").date, "strategy": s["wf"], **{k: v for k, v in s["bench"].items()}}).to_csv(OUT / "series" / f"{hid}.csv", index=False)
    px2 = px[["btc", "eth"]].loc["2016-06-01":]
    b2 = {"Hold BTC": pd.DataFrame({"btc": 1.0, "eth": 0.0}, index=px2.index), "Hold 50/50 BTC and ETH": pd.DataFrame({"btc": 0.5, "eth": 0.5}, index=px2.index)}
    rv = {f"Hold the stronger over {n} days, weekly": (lambda p, n=n: S.xs_momentum_weights(p, n, 1, 7, abs_filter=False)) for n in (7, 30, 90)}
    rv.update({f"Hold the weaker over {n} days, weekly": (lambda p, n=n: S.xs_reversal_weights(p, n, 7)) for n in (7, 30)})
    h = HYP["H16"]
    res = evaluate_panel_family(px2, rv, b2, TAKER.per_side, {"gross": 0.0, "limit orders": MAKER.per_side})
    fam["H16"] = res
    total_trials += len(rv)
    row = summarize_family(h, res, "BTC and ETH, daily")
    ranking.append(row)
    led.record("H16", h.statement, h.kill_rule, res["verdict"], slim(res), h.family, trials=len(rv), notes=h.source)
    log(f"   H16 -> {res['verdict']} | holdout Sharpe {row['holdout_sharpe']} vs {res['benchmark_used']} {row['benchmark_holdout_sharpe']}")
    summary["coin_panel"] = {"coins": coins, "first": str(px.index[0].date()), "last": str(px.index[-1].date())}

    log("machine-learning quality")
    p, pm, trend, y, fwd = ml_d_build(d1)
    summary["ml_daily_quality"] = ml_quality(p, y, fwd, d1.ts)
    ym = np.where(trend > 0, y, np.nan)
    summary["ml_daily_meta_quality"] = ml_quality(pm, ym, fwd, d1.ts)
    ph, yh, fh = ml_h_build(h1)
    summary["ml_hourly_quality"] = ml_quality(ph, yh, fh, h1.ts)
    summary["ml_reference_trend_50d"] = fam["H01"]["configs"]["Above 50-day average"]

    log("sizing, breakers, account size")
    summary["risk"] = exp_risk(d1, h1, fam["H01"])

    log("prior MEDS results")
    summary["prior_meds"] = exp_prior(Path(args.prior))

    # multiple-testing view of the single best result
    best = max((r for r in ranking if r.get("holdout_sharpe") is not None), key=lambda r: r["holdout_sharpe"])
    bs = fam[best["id"]]["_series"]
    hm = bs["dts"] >= H0
    summary["best_of_all"] = {"id": best["id"], "name": best["name"], "holdout_sharpe": best["holdout_sharpe"], "total_settings_tried": total_trials,
                              "deflated_sharpe_all_trials": M.deflated_sharpe(bs["wf"][hm], n_trials=total_trials)}
    ranking.sort(key=lambda r: (-RANK.get(r["verdict"].split(":")[0], 1), -(r.get("deflated_sharpe_prob") or 0), -(r.get("holdout_sharpe") or -9)))
    summary["ranking"] = ranking
    summary["families"] = {k: slim(v) for k, v in fam.items()}
    summary["hypotheses"] = {k: {"family": h.family, "statement": h.statement, "kill_rule": h.kill_rule, "source": h.source} for k, h in HYP.items()}
    summary["total_settings_tried"] = total_trials
    (OUT / "summary.json").write_text(json.dumps(_clean(summary), indent=1))
    log(f"done: {total_trials} settings across {len(HYP)} hypotheses -> {OUT / 'summary.json'}")
    for r in ranking:
        print(f"  {r['id']} {r['name']:<28} {r['verdict']}")


if __name__ == "__main__":
    main()
