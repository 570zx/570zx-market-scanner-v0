"""Equity and ETF research on session data (one row per trading day, built from 5-minute bars).

Two tradable moments per day keep the simulation honest:
  LATE  15:55 New York (the open of the 15:55 bar). A rule deciding here may use the day's high and low
        so far and the 15:55 price. It cannot use the official close, because the order has to be in
        before the close exists. On early-close days LATE is the 13:00 print (see EARLY_CLOSE).
  OPEN  the first regular trade (field o). A rule trading here must decide from the previous day or the
        premarket. Rules that need to see the first minutes trade at a later sample (09:35, 10:00, ...).

A day's return runs LATE(d-1) -> OPEN(d) -> LATE(d). Costs are charged on every change of position.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import metrics as M
from . import validation as V

PPY = 252.0
HOLDOUT = pd.Timestamp("2023-01-01")
WF_FIRST_YEAR = 2019

# Sessions that closed at 13:00 New York. Checked against the data: on each of these days less than a quarter
# of SPY's 09:30-16:00 volume traded after 13:05 (every other day: more than 27%).
EARLY_CLOSE = pd.DatetimeIndex([
    "2016-11-25", "2017-07-03", "2017-11-24", "2018-07-03", "2018-11-23", "2018-12-24", "2019-07-03", "2019-11-29", "2019-12-24",
    "2020-11-27", "2020-12-24", "2021-11-26", "2022-11-25", "2023-07-03", "2023-11-24", "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24"])
AFTERNOON_FIELDS = ["p840", "p900", "p930", "p945", "p950", "p955", "h945", "l945", "v945", "h955", "l955", "v955"]

# One-way cost as a fraction of price. Robinhood charges no commission on stocks and ETFs, so this is half the
# quoted spread plus slippage. MEDS measured full spreads of 0.003%-0.006% on SPY/QQQ and 0.016%-0.026% on TQQQ;
# the figures below are deliberately above half of that.
COST_TIERS = {
    0.0001: ["SPY", "QQQ", "IWM", "DIA"],
    0.00015: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO"],
    0.0002: ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC", "SMH", "TLT", "IEF", "SHY", "HYG", "LQD", "GLD", "SLV",
             "EFA", "EEM", "FXI", "EWZ", "EWJ", "XBI", "KRE", "GDX", "XOP", "SH", "PSQ", "TIP", "IBIT", "BITO"],
    0.00025: ["TQQQ", "SQQQ", "UPRO", "SPXL", "SPXU", "SOXL", "SOXS", "TNA", "TZA", "FAS"],
    0.0004: ["SVXY", "VXX", "UVXY", "VIXY", "USO", "UNG", "DBC", "XHB", "XRT"],
    0.0005: ["TECL", "UDOW", "LABU", "NUGT", "ERX", "TMF", "FAZ", "SDOW", "TECS", "LABD", "FNGU"],
}
DEFAULT_COST = 0.0004


def cost_of(symbols: list[str], mult: float = 1.0) -> pd.Series:
    m = {s: c for c, syms in COST_TIERS.items() for s in syms}
    return pd.Series({s: m.get(s, DEFAULT_COST) * mult for s in symbols})


@dataclass
class Panel:
    dates: pd.DatetimeIndex
    symbols: list[str]
    f: dict = field(default_factory=dict)        # field name -> DataFrame [dates x symbols]
    cal: pd.DataFrame | None = None              # exchange calendar facts, known in advance

    def __getitem__(self, k: str) -> pd.DataFrame:
        return self.f[k]

    def truncate(self, last: pd.Timestamp) -> "Panel":
        """The panel as it would have looked on `last` (used by the lookahead test)."""
        m = self.dates <= last
        return Panel(self.dates[m], self.symbols, {k: v.loc[m] for k, v in self.f.items()}, None if self.cal is None else self.cal.loc[m])


def calendar(dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Calendar facts for each session and for the session after it. The exchange calendar is published years
    ahead, so "tomorrow is the last trading day of the month" is not information from the future. The final
    month in the data is incomplete, so its days-to-month-end are left unknown (no calendar trades there)."""
    ym = (dates.year * 100 + dates.month).to_numpy()
    s = pd.Series(1, index=dates)
    tdom = s.groupby(ym).cumsum().to_numpy()
    n_in_month = s.groupby(ym).transform("sum").to_numpy()
    rev = (tdom - n_in_month - 1).astype(float)          # -1 = last trading day of the month
    rev[ym == ym[-1]] = np.nan
    gap = np.diff(dates.values).astype("timedelta64[D]").astype(int)
    dow = dates.dayofweek.to_numpy()
    # a holiday closure follows today when the next session is further away than the weekend explains
    normal_gap = np.where(dow[:-1] == 4, 3, 1)
    pre_hol = np.concatenate([gap > normal_gap, [False]])
    cal = pd.DataFrame({"tdom": tdom, "tdom_rev": rev, "dow": dow, "pre_holiday": pre_hol}, index=dates)
    for k in ("tdom", "tdom_rev", "dow", "pre_holiday"):
        cal["next_" + k] = cal[k].shift(-1)
    cal["half"] = dates.isin(EARLY_CLOSE)
    return cal


def load_panel(data_dir: str | Path, symbols: list[str] | None = None) -> Panel:
    data_dir = Path(data_dir)
    fields = json.loads((data_dir / "meta.json").read_text())["fields"]
    z = np.load(data_dir / "sessions.npz")
    syms = sorted({k.split("__")[0] for k in z.files})
    if symbols is not None:
        syms = [s for s in symbols if s in syms]
    frames = {}
    for s in syms:
        d = pd.to_datetime(z[f"{s}__date"].astype(str), format="%Y%m%d")
        frames[s] = pd.DataFrame(z[f"{s}__x"], index=d, columns=fields)
    dates = pd.DatetimeIndex(sorted(set().union(*[set(fr.index) for fr in frames.values()])))
    f = {k: pd.DataFrame({s: frames[s][k].reindex(dates) for s in syms}) for k in fields}
    return finish_panel(Panel(dates, syms, f, calendar(dates)))


def finish_panel(p: Panel) -> Panel:
    """Derived fields shared by every rule. Everything here is known at LATE of its own row."""
    f = p.f
    half = np.broadcast_to(np.asarray(p.dates.isin(EARLY_CLOSE))[:, None], f["o"].shape)
    for k in AFTERNOON_FIELDS:                                      # after 13:00 on an early-close day is not the regular session
        f[k] = f[k].where(~half)
    has = f["p955"].notna()
    late = f["p955"].where(has, f["c"].where(f["t_last"] < 955))    # no 15:55 bar: the last trade before it
    hi, lo = f["h955"].where(has, f["h"]), f["l955"].where(has, f["l"])
    late = late.where(~half, f["p780"])                             # early close: the 13:00 print
    hi, lo = hi.where(~half, f["h930"]), lo.where(~half, f["l930"])
    hi, lo = np.fmax(hi, late), np.fmin(lo, late)
    f["late"], f["hi_late"], f["lo_late"] = late, hi, lo
    rng = hi - lo
    f["ibs"] = ((late - lo) / rng.where(rng > 0)).clip(0, 1)        # where the 15:55 price sits in the day's range so far
    f["r_on"] = f["o"] / late.shift(1) - 1                          # 15:55 yesterday -> today's open
    f["r_id"] = late / f["o"] - 1                                   # today's open -> 15:55
    f["r_ll"] = late / late.shift(1) - 1                            # 15:55 -> 15:55
    return p


# ------------------------------------------------------------------ statistics
def stats(ret: np.ndarray, expo: np.ndarray | None = None) -> dict:
    ret = np.asarray(ret, float)
    if len(ret) < 30:
        return {}
    st = M.equity_stats(ret, PPY, expo)
    return {k: st[k] for k in ("years", "total_return", "cagr", "sharpe", "sortino", "max_drawdown", "ann_vol", "exposure") if k in st}


def masks(dates: pd.DatetimeIndex) -> dict:
    return {"discovery": np.asarray(dates < HOLDOUT), "wf_pre": np.asarray((dates.year >= WF_FIRST_YEAR) & (dates < HOLDOUT)), "holdout": np.asarray(dates >= HOLDOUT)}


def sharpe_diff_boot(a: np.ndarray, b: np.ndarray, block: int = 10, n: int = 2000, seed: int = 1) -> dict:
    """Paired block bootstrap of (Sharpe of a) - (Sharpe of b), annualised."""
    L = len(a)
    if L < 3 * block:
        return {"p_better": float("nan")}
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, L - block, size=(n, L // block + 1))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(n, -1)[:, :L]
    A, B = a[idx], b[idx]
    sa = np.divide(A.mean(1), A.std(1), out=np.zeros(n), where=A.std(1) > 0)
    sb = np.divide(B.mean(1), B.std(1), out=np.zeros(n), where=B.std(1) > 0)
    d = (sa - sb) * math.sqrt(PPY)
    return {"p_better": float((d > 0).mean()), "diff_ci95": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]}


# ------------------------------------------------------------------ weight-based engine
def run_weights(p: Panel, w_late: pd.DataFrame, w_open: pd.DataFrame | None = None, cost_mult: float = 1.0,
                open_field: str = "o") -> dict:
    """w_late[d]: weights chosen at LATE of day d and carried overnight.
    w_open[d]:  weights for the morning of day d, traded at `open_field` and carried to LATE.
                None means: do not trade in the morning (the overnight weights are kept).
    A "trade" in the result is one unbroken holding of one symbol."""
    syms = list(w_late.columns)
    c = cost_of(syms, cost_mult).to_numpy()
    late, mo = p["late"][syms], p[open_field][syms]
    r_on = (mo / late.shift(1) - 1).fillna(0.0).to_numpy()
    r_id = (late / mo - 1).fillna(0.0).to_numpy()
    wl = w_late.reindex(p.dates).fillna(0.0).to_numpy(float)
    held_on = np.vstack([np.zeros((1, len(syms))), wl[:-1]])
    held_id = held_on if w_open is None else w_open.reindex(p.dates).fillna(0.0).to_numpy(float)
    cost_open = (np.abs(held_id - held_on) * c).sum(1)
    cost_late = (np.abs(wl - held_id) * c).sum(1)
    ret = (1 + (held_on * r_on).sum(1)) * (1 - cost_open) * (1 + (held_id * r_id).sum(1)) * (1 - cost_late) - 1
    expo = 0.5 * (np.abs(held_on).sum(1) + np.abs(held_id).sum(1))
    # trades: runs of consecutive half-day segments in which a symbol is held
    n = len(p.dates)
    tr, te = [], []
    for j in range(len(syms)):
        seg_pos = np.empty(2 * n, bool)
        seg_pos[0::2], seg_pos[1::2] = held_on[:, j] != 0, held_id[:, j] != 0
        if not seg_pos.any():
            continue
        seg_ret = np.empty(2 * n)
        seg_ret[0::2], seg_ret[1::2] = np.sign(held_on[:, j]) * r_on[:, j], np.sign(held_id[:, j]) * r_id[:, j]
        edge = np.diff(np.concatenate([[0], seg_pos.astype(np.int8), [0]]))
        for a, b in zip(np.flatnonzero(edge == 1), np.flatnonzero(edge == -1)):
            tr.append(float(np.prod(1 + seg_ret[a:b])) * (1 - c[j]) ** 2 - 1)
            te.append(max(0, (a - 1) // 2) if a % 2 == 0 else a // 2)       # an overnight segment was entered the day before
    order = np.argsort(te, kind="stable") if te else []
    idx = np.arange(1, len(syms) + 1)
    return {"ret": ret, "expo": expo, "turnover": np.abs(held_id - held_on).sum(1) + np.abs(wl - held_id).sum(1),
            "dec": (wl * idx).sum(1) + 0.37 * (held_id * idx).sum(1),       # what was decided each day (for the lookahead test)
            "trade_ret": np.array(tr)[order] if tr else np.array([]), "trade_entry": np.array(te, dtype=int)[order] if te else np.array([], dtype=int)}


def leg(p: Panel, sym: str, a: str, b: str, cond, cost_mult: float = 1.0, size=1.0) -> np.ndarray:
    """Daily return of buying `sym` at sample `a` and selling it at sample `b` on the days where cond is true."""
    r = (p[b][sym] / p[a][sym] - 1).to_numpy()
    c = float(cost_of([sym], cost_mult)[sym])
    cond = np.asarray(cond, bool) & np.isfinite(r)
    size = np.broadcast_to(np.asarray(size, float), r.shape)
    return np.where(cond, size * ((1 + np.nan_to_num(r)) * (1 - c) ** 2 - 1), 0.0)


def legs_result(legs: list[np.ndarray], day_share: float) -> dict:
    """Combine same-day legs that use the same money one after another (at most one is active at a time).
    day_share: the fraction of a 24-hour day a leg is held, for the exposure figure."""
    ret = np.prod([1 + x for x in legs], axis=0) - 1
    active = np.any([x != 0 for x in legs], axis=0)
    tr = np.concatenate([x[x != 0] for x in legs])
    te = np.concatenate([np.flatnonzero(x != 0) for x in legs])
    order = np.argsort(te, kind="stable")
    return {"ret": ret, "expo": active * day_share, "trade_ret": tr[order], "trade_entry": te[order], "dec": active.astype(float)}


# ------------------------------------------------------------------ slot engine (path dependent)
def simulate_slots(p: Panel, entry: pd.DataFrame, score: pd.DataFrame, slots: int, exit_mode: str, max_hold: int = 5,
                   cost_mult: float = 1.0, stop: float | None = None, exit_sig: pd.DataFrame | None = None) -> dict:
    """Up to `slots` positions, each opened with equity/slots at LATE on a day where entry[d, s] is true
    (lowest score first). Exits, all at LATE except `open`:
      hold      after max_hold sessions
      strength  the first LATE above the previous day's high, else after max_hold sessions
      up        the first LATE above the entry price net of costs, else after max_hold sessions
      signal    the first LATE where exit_sig[d, s] is true, else after max_hold sessions
      open      the next open (an overnight trade)
    `stop`: optional fraction below entry, checked at LATE only (no resting stop orders are assumed)."""
    syms = list(entry.columns)
    c = cost_of(syms, cost_mult).to_numpy()
    late, op, hi_full = p["late"][syms].to_numpy(), p["o"][syms].to_numpy(), p["h"][syms].to_numpy()
    ent = entry.reindex(p.dates).fillna(False).to_numpy(bool)
    sc = score.reindex(p.dates).to_numpy(float)
    xs = exit_sig.reindex(p.dates).fillna(False).to_numpy(bool) if exit_sig is not None else None
    n = len(p.dates)
    cash, pos = 1.0, {}                                   # symbol index -> [shares, entry_price, entry_day]
    eq_prev, rets, expo, dec, trades = 1.0, np.zeros(n), np.zeros(n), np.zeros(n), []
    last_px = np.full(len(syms), np.nan)
    for d in range(n):
        if exit_mode == "open":                           # overnight trades leave at the open
            for j in list(pos):
                if np.isfinite(op[d, j]):
                    sh, ep, ed = pos.pop(j)
                    px = op[d, j] * (1 - c[j])
                    cash += sh * px
                    trades.append((ed, d, j, px / ep - 1))
        ok = np.isfinite(late[d])
        last_px = np.where(ok, late[d], last_px)
        if exit_mode != "open":
            for j in list(pos):
                if not ok[j]:
                    continue
                sh, ep, ed = pos[j]
                held = d - ed
                out = held >= max_hold
                if exit_mode == "strength" and np.isfinite(hi_full[d - 1, j]) and late[d, j] > hi_full[d - 1, j]:
                    out = True
                if exit_mode == "up" and late[d, j] * (1 - c[j]) > ep:
                    out = True
                if exit_mode == "signal" and xs[d, j]:
                    out = True
                if stop is not None and late[d, j] < ep * (1 - stop):
                    out = True
                if out and held >= 1:
                    px = late[d, j] * (1 - c[j])
                    cash += sh * px
                    trades.append((ed, d, j, px / ep - 1))
                    del pos[j]
        equity = cash + sum(sh * last_px[j] for j, (sh, _, _) in pos.items())
        free = slots - len(pos)
        if free > 0:
            cand = [j for j in np.flatnonzero(ent[d] & ok) if j not in pos]
            cand.sort(key=lambda j: (sc[d, j] if np.isfinite(sc[d, j]) else 9e9))
            for j in cand[:free]:
                budget = min(equity / slots, cash)
                if budget <= 1e-9:
                    break
                ep = late[d, j] * (1 + c[j])
                pos[j] = [budget / ep, ep, d]
                cash -= budget
        equity = cash + sum(sh * last_px[j] for j, (sh, _, _) in pos.items())
        rets[d] = equity / eq_prev - 1
        expo[d] = 1 - cash / equity if equity > 0 else 0.0
        dec[d] = sum(j + 1 for j in pos)
        eq_prev = equity
    return {"ret": rets, "expo": expo, "dec": dec, "trade_ret": np.array([t[3] for t in trades]), "trade_entry": np.array([t[0] for t in trades], dtype=int),
            "trade_exit": np.array([t[1] for t in trades], dtype=int), "trade_sym": [syms[t[2]] for t in trades]}


# ------------------------------------------------------------------ family evaluation
KILL_STANDARD = (
    "Killed unless the walk-forward version, after costs, (1) makes money in the 2023+ holdout, (2) has a higher Sharpe than "
    "holding SPY and than holding QQQ over the same holdout, and (3) at least 60% of the settings tried are profitable in the holdout. "
    "Proven only if the deflated-Sharpe probability and the probability of beating the better of the two benchmarks are both 95% or more."
)


def verdict(hold: dict, bench: dict, share_pos: float, dsr: float, p_better: float, n_trades: int | None, lookahead_ok: bool = True) -> str:
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


TRADE_KEYS = ("trades", "win_rate", "win_rate_ci95", "expectancy", "expectancy_ci95", "t_stat", "profit_factor", "longest_losing_streak", "avg_win", "avg_loss", "worst_trade")


def _tstats(r: np.ndarray) -> dict | None:
    if len(r) == 0:
        return None
    s = M.trade_stats(r)
    return {a: s.get(a) for a in TRADE_KEYS}


def evaluate_family(p: Panel, results: dict[str, dict], benches: dict[str, np.ndarray], stress: dict[str, dict] | None = None,
                    lookahead_ok: bool = True, wf_first_year: int = WF_FIRST_YEAR) -> dict:
    """results: {setting: {"ret": daily returns aligned to p.dates, "expo": ..., optional "trade_ret", "trade_entry"}}.
    Walk-forward: each year from `wf_first_year` trades the setting with the best Sharpe over all earlier years.
    The benchmark for the verdict is whichever of `benches` has the higher Sharpe in the holdout."""
    dates = p.dates
    mk = masks(dates)
    ts = dates.values.astype("datetime64[s]").astype(np.int64)
    daily = {k: np.nan_to_num(np.asarray(v["ret"], float)) for k, v in results.items()}
    zeros = np.zeros(len(dates))
    per = {}
    for k, v in results.items():
        e = np.asarray(v.get("expo", zeros), float)
        per[k] = {"discovery": stats(daily[k][mk["discovery"]], e[mk["discovery"]]), "holdout": stats(daily[k][mk["holdout"]], e[mk["holdout"]])}
        if len(v.get("trade_ret", [])):
            hm = mk["holdout"][np.asarray(v["trade_entry"])]
            tr = np.asarray(v["trade_ret"])
            per[k]["trades_holdout"], per[k]["trades_discovery"] = _tstats(tr[hm]), _tstats(tr[~hm])
    wf = V.walk_forward(daily, ts, PPY, first_test=f"{wf_first_year}-01-01")
    years = dates.year.to_numpy()
    wf_ret, wf_expo, tr_ret, tr_hold = np.zeros(len(dates)), np.zeros(len(dates)), [], []
    for y, label in wf["chosen"].items():
        m = years == int(y)
        v = results[label]
        wf_ret[m] = daily[label][m]
        wf_expo[m] = np.asarray(v.get("expo", zeros))[m]
        if len(v.get("trade_ret", [])):
            te = np.asarray(v["trade_entry"])
            sel = years[te] == int(y)
            tr_ret.extend(np.asarray(v["trade_ret"])[sel])
            tr_hold.extend(mk["holdout"][te][sel])
    tr_ret, tr_hold = np.array(tr_ret), np.array(tr_hold, dtype=bool)
    hold = stats(wf_ret[mk["holdout"]], wf_expo[mk["holdout"]])
    wf_all = (years >= wf_first_year)
    bstats = {k: stats(b[mk["holdout"]]) for k, b in benches.items()}
    bname = max(bstats, key=lambda k: bstats[k].get("sharpe", -9))
    sens = V.sensitivity({k: v["holdout"].get("sharpe", float("nan")) for k, v in per.items()})
    dsr = M.deflated_sharpe(wf_ret[mk["holdout"]], n_trials=len(results))
    pb = sharpe_diff_boot(wf_ret[mk["holdout"]], benches[bname][mk["holdout"]])
    th = _tstats(tr_ret[tr_hold]) if tr_hold.any() else None
    n_tr = int(th["trades"]) if th else (0 if any(len(v.get("trade_ret", [])) for v in results.values()) else None)
    out = {
        "verdict": verdict(hold, bstats[bname], sens.get("share_positive", 0.0), dsr.get("dsr", float("nan")), pb.get("p_better", float("nan")), n_tr, lookahead_ok),
        "n_configs": len(results), "chosen": wf["chosen"], "switches": wf["switches"],
        "wf_holdout": hold, "wf_pre": stats(wf_ret[mk["wf_pre"]], wf_expo[mk["wf_pre"]]), "wf_all": stats(wf_ret[wf_all], wf_expo[wf_all]),
        "benchmark": bname, "bench_holdout": bstats, "bench_pre": {k: stats(b[mk["wf_pre"]]) for k, b in benches.items()},
        "deflated_sharpe_holdout": dsr, "vs_bench_holdout": pb, "sensitivity_holdout": sens,
        "monte_carlo_1y": V.block_bootstrap(wf_ret[wf_all], PPY, block=10) if wf_all.sum() > 300 else {},
        "wf_trades_holdout": th, "wf_trades_pre": _tstats(tr_ret[~tr_hold]) if (~tr_hold).any() else None,
        "configs": per, "_wf_ret": wf_ret, "_wf_expo": wf_expo,
    }
    if stress:
        out["cost_stress"] = {}
        for name, res in stress.items():
            sr = np.zeros(len(dates))
            for y, label in wf["chosen"].items():
                m = years == int(y)
                sr[m] = np.nan_to_num(np.asarray(res[label]["ret"], float))[m]
            out["cost_stress"][name] = {"wf_holdout": stats(sr[mk["holdout"]]), "wf_pre": stats(sr[mk["wf_pre"]])}
    return out


def truncation_test(build, p: Panel, cuts: list[str], tol: float = 1e-9) -> dict:
    """Lookahead test for a whole family. Rebuild every setting on the panel cut off at each date. The daily
    returns AND the positions decided on every day up to and including the cut must be identical to the ones
    computed with all the later data present. A rule that peeks one day ahead changes its decision on the cut day."""
    full = build(p)
    worst, bad = 0.0, []
    for cut in cuts:
        pt = p.truncate(pd.Timestamp(cut))
        n = len(pt.dates)
        if n < 50:
            continue
        part = build(pt)
        for k in full:
            for key in ("ret", "dec"):
                if key not in full[k]:
                    continue
                d = float(np.max(np.abs(np.nan_to_num(np.asarray(part[k][key], float)) - np.nan_to_num(np.asarray(full[k][key], float))[:n])))
                worst = max(worst, d)
                if d > tol:
                    bad.append(f"{k} [{key}] @ {cut}: {d:.2e}")
    return {"passed": not bad, "max_abs_diff": worst, "cuts": cuts, "failures": bad[:5]}


# ------------------------------------------------------------------ small signal helpers (all causal)
def rsi(x: pd.DataFrame | pd.Series, n: int):
    d = x.diff()
    up, dn = d.clip(lower=0), (-d).clip(lower=0)
    au, ad = up.ewm(alpha=1 / n, adjust=False, min_periods=n).mean(), dn.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return (100 - 100 / (1 + au / ad.where(ad > 0))).where(ad > 0, 100.0).where(au.notna())


def sma(x, n: int):
    return x.rolling(n, min_periods=n).mean()
