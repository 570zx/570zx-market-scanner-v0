#!/usr/bin/env python3
"""APEX round two, step 3: what the results mean.

Everything in this script was run AFTER the 2023+ holdout had been seen. None of it can prove an edge. It
describes, stress-tests and sizes the rules that the pre-registered runs left standing, and it counts how many
extra variants were looked at so the reader can discount accordingly.

Inputs:  results/equity_summary.json, results/series/E*.csv (from run_equity_experiments.py),
         results/older_sample.json (from older_sample_test.py), data/equities, data/older
Output:  results/equity_deep_dive.json
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats as sps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import older_sample_test as OLD  # noqa: E402
from apex import equities as E  # noqa: E402
from apex import intraday as I  # noqa: E402
from apex import metrics as M  # noqa: E402
from apex import validation as V  # noqa: E402
from apex.ledger import Ledger, _clean  # noqa: E402
from apex.risk import kelly_fraction  # noqa: E402

DATA, OUT = ROOT / "data" / "equities", ROOT / "results"
VARIANTS = {"n": 0}                       # post-hoc rule evaluations made by this script


def count(x):
    VARIANTS["n"] += 1
    return x


def st(ret) -> dict:
    s = E.stats(np.asarray(ret, float))
    return {k: s.get(k) for k in ("years", "cagr", "sharpe", "max_drawdown", "ann_vol")} if s else {}


def tr_stats(r) -> dict | None:
    r = np.asarray(r, float)
    if len(r) == 0:
        return None
    s = M.trade_stats(r)
    return {k: s[k] for k in ("trades", "win_rate", "win_rate_ci95", "expectancy", "expectancy_ci95", "t_stat", "avg_win", "avg_loss", "worst_trade", "longest_losing_streak")}


def nw_alpha(y: np.ndarray, x: np.ndarray, lags: int = 5) -> dict:
    """Return not explained by market exposure: y = alpha + beta x, with a Newey-West t for alpha."""
    X = np.column_stack([np.ones(len(x)), x])
    b = np.linalg.lstsq(X, y, rcond=None)[0]
    e = y - X @ b
    xi = np.linalg.inv(X.T @ X)
    S = (X * e[:, None]).T @ (X * e[:, None])
    for L in range(1, lags + 1):
        G = (X[L:] * e[L:, None]).T @ (X[:-L] * e[:-L, None])
        S += (1 - L / (lags + 1)) * (G + G.T)
    Vb = xi @ S @ xi
    return {"alpha_per_year": float(b[0] * 252), "t": float(b[0] / math.sqrt(Vb[0, 0])), "beta": float(b[1])}


def seq_trades(late: np.ndarray, entry: np.ndarray, c: float, max_hold: int = 5) -> np.ndarray:
    """Weak-close exit rule applied to arbitrary entry days (one position at a time). Returns trade returns."""
    out, d, n = [], 0, len(late)
    while d < n:
        if entry[d] and np.isfinite(late[d]):
            paid, k = late[d] * (1 + c), d + 1
            while k < n and not (np.isfinite(late[k]) and (late[k] * (1 - c) > paid or k - d >= max_hold)):
                k += 1
            if k >= n:
                break
            out.append(late[k] * (1 - c) / paid - 1)
            d = k
            continue
        d += 1
    return np.array(out)


def random_entry_control(p: E.Panel, sym: str, mask: np.ndarray, rng, n_sims: int = 2000) -> dict:
    """Is it the entry or the exit? Same exit rule, same number of entry days, but the days drawn at random."""
    late = p["late"][sym].to_numpy()
    c = float(E.cost_of([sym])[sym])
    sig = (p["ibs"][sym].to_numpy() < 0.15) & mask
    r = seq_trades(late, sig, c)
    idx = np.flatnonzero(mask & np.isfinite(late))
    means, wins = np.empty(n_sims), np.empty(n_sims)
    for i in range(n_sims):
        m = np.zeros(len(late), bool)
        m[rng.choice(idx, size=int(sig.sum()), replace=False)] = True
        rr = seq_trades(late, m, c)
        means[i], wins[i] = rr.mean(), (rr > 0).mean()
    return {"trades": int(len(r)), "win_rate": float((r > 0).mean()), "avg_trade": float(r.mean()),
            "random_win_rate": float(wins.mean()), "random_avg_trade": float(means.mean()), "random_avg_trade_p95": float(np.percentile(means, 95)),
            "p_random_at_least_as_good": float(max((means >= r.mean()).mean(), 1.0 / n_sims))}


def decision_time_profile(p: E.Panel, sig: str) -> dict:
    """Weak-close rule on 5-minute bars: decide at the open of slot k from the range so far, buy one bar later."""
    g = I.load_grid(DATA, sig, p.dates)
    c = float(E.cost_of([sig])[sig])
    yrs = p.dates.year.to_numpy()
    half = np.asarray(p.cal["half"])
    out = {}
    for label, kd, kf in (("15:00", 66, 67), ("15:30", 72, 73), ("15:45", 75, 76), ("15:50", 76, 77), ("15:55 (buy at the last print)", 77, 78), ("15:55 (buy at once)", 77, 77)):
        count(None)
        trades, pos = [], None
        for d in range(len(p.dates)):
            last = g.last[d]
            k1, k2 = (kd, kf) if not half[d] else (last - (77 - kd), last - (77 - kf))
            x = g.px[d, last]
            if pos is not None and np.isfinite(x) and (x * (1 - c) > pos[0] or d - pos[1] >= 5):
                trades.append((pos[1], x * (1 - c) / pos[0] - 1))
                pos = None
            if pos is None and k1 >= 1:
                px = g.px[d, k1]
                hi, lo = max(np.nanmax(g.h[d, :k1]), px), min(np.nanmin(g.l[d, :k1]), px)
                if np.isfinite(px) and hi > lo and (px - lo) / (hi - lo) < 0.15:
                    fill = g.px[d, k2] if k2 <= last else g.cf[d, last]
                    if np.isfinite(fill):
                        pos = (fill * (1 + c), d)
        te, tr = np.array([t[0] for t in trades]), np.array([t[1] for t in trades])
        out[label] = {name: {"trades": int(m[te].sum()), "win_rate": float((tr[m[te]] > 0).mean()), "avg_trade": float(tr[m[te]].mean()),
                             "t": float(tr[m[te]].mean() / (tr[m[te]].std(ddof=1) / math.sqrt(m[te].sum())))}
                      for name, m in (("2016-2018", yrs <= 2018), ("2019-2022", (yrs >= 2019) & (yrs <= 2022)), ("2023-2026", yrs >= 2023))}
    return out


def main() -> None:
    rng = np.random.default_rng(42)
    p = E.load_panel(DATA)
    po = OLD.load()
    summ = json.loads((OUT / "equity_summary.json").read_text())
    older = json.loads((OUT / "older_sample.json").read_text())
    yrs, yo = p.dates.year.to_numpy(), po.dates.year.to_numpy()
    pre_cut = np.asarray(po.dates < OLD.CUT)
    per = {"2016-2018": yrs <= 2018, "2019-2022": (yrs >= 2019) & (yrs <= 2022), "2023-2026": yrs >= 2023}
    hold = lambda s: np.nan_to_num(p["r_ll"][s].to_numpy())
    out: dict = {"what_this_is": "Run after the holdout was seen. Descriptive only; nothing here is proof."}

    # ---- 1. return beyond market exposure, every family ---------------------------------
    alpha = {}
    spans = {"2019-2022": (yrs >= 2019) & (yrs <= 2022), "2023-2026": yrs >= 2023, "2019-2026": yrs >= 2019}
    for r in summ["ranking"]:
        w = pd.read_csv(OUT / "series" / f"{r['id']}.csv")["strategy"].to_numpy()
        alpha[r["id"]] = {"family": r["family"], **{k: {**st(w[m]), "vs_QQQ": nw_alpha(w[m], hold("QQQ")[m])} for k, m in spans.items()}}
    out["families_vs_market"] = alpha
    out["holding"] = {s: {k: st(hold(s)[m]) for k, m in {**per, "2019-2026": yrs >= 2019, "2016-2026": yrs >= 2016}.items()} for s in ("SPY", "QQQ", "TQQQ", "SMH", "SOXL")}

    # ---- 2. where the return arrives: night against day ---------------------------------
    nd = {}
    for s in ("SPY", "QQQ", "IWM", "SMH", "TQQQ", "SOXL", "NVDA", "AMD", "AVGO", "AAPL", "GLD", "TLT"):
        nd[s] = {}
        for k, m in (("2016-2022", yrs <= 2022), ("2023-2026", yrs >= 2023)):
            a, b = p["r_on"][s][m].dropna(), p["r_id"][s][m].dropna()
            d = (p["r_on"][s][m] - p["r_id"][s][m]).dropna()
            nd[s][k] = {"night_bp": float(a.mean() * 1e4), "day_bp": float(b.mean() * 1e4), "t_night_minus_day": float(d.mean() / (d.std(ddof=1) / math.sqrt(len(d))))}
    out["night_vs_day_2016_on"] = nd

    # ---- 3. the overnight semiconductor rule: strong since 2016, not confirmed before -----
    late = p["late"]
    up = (late["SMH"] > E.sma(late["SMH"], 200)) & late["SOXL"].notna()
    wl, wo = pd.DataFrame({"SOXL": up.astype(float)}), pd.DataFrame({"SOXL": 0.0}, index=p.dates)
    base = E.run_weights(p, wl, wo)
    sx = {"rule": "Own SOXL only from 15:55 to the next open, and only while SMH is above its 200-day average.",
          "base": {k: st(base["ret"][m]) for k, m in {**per, "2019-2026": yrs >= 2019}.items()},
          "by_year": {int(y): float(np.prod(1 + base["ret"][yrs == y]) - 1) for y in range(2016, 2027)},
          "nights": tr_stats(base["trade_ret"]), "worst_night": float(base["trade_ret"].min()),
          "variants_2019_2026": {}}
    var = {"costs x3": E.run_weights(p, wl, wo, 3.0), "no costs": E.run_weights(p, wl, wo, 0.0),
           "sell at 09:35": E.run_weights(p, wl, wo, 1.0, "p575"), "sell at 10:00": E.run_weights(p, wl, wo, 1.0, "p600"),
           "SOXL all day in the uptrend": E.run_weights(p, wl, None)}
    for n in (100, 150, 250):
        u = (late["SMH"] > E.sma(late["SMH"], n)) & late["SOXL"].notna()
        var[f"{n}-day average"] = E.run_weights(p, pd.DataFrame({"SOXL": u.astype(float)}), wo)
    for k, v in var.items():
        count(None)
        sx["variants_2019_2026"][k] = st(v["ret"][yrs >= 2019])
    sx["before_2016"] = older["night_rules"]["SOXL overnight while SMH is above its 200-day average"]
    sx["before_2016_unleveraged"] = {k: older["night_rules"][k] for k in older["night_rules"] if k.startswith(("SMH", "SOXX"))}
    sx["older_sample_verdict"] = {k: v for k, v in older["verdicts"].items() if k.startswith("T3")}
    out["overnight_semiconductors"] = sx

    # ---- 4. the weak-close bounce ------------------------------------------------------
    wc: dict = {"rule": "At 15:55, if QQQ is in the bottom 15% of its range for the day so far, buy. Sell at the first 15:55 where the position shows a "
                        "profit after costs; if that has not happened after 5 sessions, sell anyway."}
    # 4a. entry or exit? random entry days with the same exit rule
    ctl = {}
    for sym in ("QQQ", "SPY"):
        first = int(po["late"][sym].first_valid_index().year)
        ctl[sym] = {f"{first}-2007": random_entry_control(po, sym, (yo <= 2007) & pre_cut, rng), "2008-2015": random_entry_control(po, sym, (yo >= 2008) & pre_cut, rng),
                    "2016-2022": random_entry_control(p, sym, yrs <= 2022, rng), "2023-2026": random_entry_control(p, sym, yrs >= 2023, rng)}
        ps = [v["p_random_at_least_as_good"] for v in ctl[sym].values()]
        chi = -2 * sum(math.log(x) for x in ps)
        ctl[sym]["all_periods_combined_p"] = float(sps.chi2.sf(chi, 2 * len(ps)))
    wc["entry_or_exit"] = ctl
    # 4b. how close to the close does the decision have to be?
    wc["decision_time"] = {s: decision_time_profile(p, s) for s in ("QQQ", "SPY")}
    # 4c. history by vehicle: before 2016 on daily closes, from 2016 at 15:55
    veh = {}
    for sig, v in (("QQQ", "QQQ"), ("SPY", "SPY"), ("QQQ", "TQQQ"), ("SPY", "UPRO")):
        a, b = count(E.simulate_stack(po, sig, v, None, None)), count(E.simulate_stack(p, sig, v, None, None))
        mo = OLD.span(po, v)
        ret = np.concatenate([a["ret"][mo], b["ret"]])
        dates = po.dates[mo].append(p.dates)
        y = dates.year.to_numpy()
        tr = np.concatenate([a["mr_trade_ret"][mo[a["mr_trade_entry"]]], b["mr_trade_ret"]])
        hold_ret = np.concatenate([np.nan_to_num(po["r_ll"][v].to_numpy())[mo], hold(v)])
        blocks = {"before 2016": y < 2016, "2016-2022": (y >= 2016) & (y <= 2022), "2023-2026": y >= 2023, "all": y > 0}
        veh[f"{v} (signal {sig})"] = {
            "from": str(dates[0].date()), "to": str(dates[-1].date()),
            "rule": {k: st(ret[m]) for k, m in blocks.items()}, "hold": {k: st(hold_ret[m]) for k, m in blocks.items()},
            "trades_all": tr_stats(tr), "share_of_days_invested": float(np.concatenate([a["held"][mo], b["held"]]).astype(bool).mean()),
            "by_year": {int(k): {"rule": float(np.prod(1 + ret[y == k]) - 1), "hold": float(np.prod(1 + hold_ret[y == k]) - 1)} for k in sorted(set(y))},
            "worst_day": float(ret.min()), "worst_year": float(min(np.prod(1 + ret[y == k]) - 1 for k in set(y))),
            "monte_carlo_one_year": V.block_bootstrap(ret, 252, block=10), "kelly_fraction_per_trade": kelly_fraction(tr),
            "alpha_vs_holding_it": nw_alpha(ret, hold_ret)}
        ts = dates.values.astype("datetime64[s]").astype(np.int64)
        br = V.breakers(ret, ts, 0.02, 0.12, None)
        stop = int(np.flatnonzero(np.cumsum(br["ret"] != 0) == np.count_nonzero(br["ret"]))[0]) if np.count_nonzero(br["ret"]) else 0
        veh[f"{v} (signal {sig})"]["with_default_limits"] = {"stopped_for_good": br["stopped_for_good"], "last_active_day": str(dates[stop].date()),
                                                            "return_until_stopped": br["final"], "max_drawdown": br["max_drawdown"], "daily_limit_days": br["daily_trips"]}
        sizing = {}
        for f in (1.0, 0.5, 0.25, 0.1):
            a2, b2 = count(E.simulate_stack(po, sig, v, None, None, size=f)), count(E.simulate_stack(p, sig, v, None, None, size=f))
            r2 = np.concatenate([a2["ret"][mo], b2["ret"]])
            sizing[f"{int(f * 100)}% of the account"] = {**st(r2), "worst_day": float(r2.min()), "mc_drawdown_p95_one_year": V.block_bootstrap(r2, 252, block=10)["maxdd_p95"]}
        veh[f"{v} (signal {sig})"]["sizing"] = sizing
        veh[f"{v} (signal {sig})"]["_ret"], veh[f"{v} (signal {sig})"]["_dates"] = ret, dates
    wc["history"] = veh
    # 4d. a 3x fund did not exist in 2000-2002 or 2008: rebuild one from QQQ (3x the daily move less fund and financing costs)
    q = po["r_ll"]["QQQ"]
    rf = pd.Series(0.0015, index=po.dates)
    for a, b, x in (("1999", "2000", 0.055), ("2001", "2001", 0.035), ("2002", "2004", 0.013), ("2005", "2005", 0.032), ("2006", "2007", 0.05), ("2008", "2008", 0.02)):
        rf[a:b] = x
    syn = (3 * q - (0.0095 + 2 * (rf + 0.005)) / 252).fillna(0.0)
    po.f["late"] = po.f["late"].assign(QQQ3X=(1 + syn).cumprod() * 100.0)
    s3 = count(E.simulate_stack(po, "QQQ", "QQQ3X", None, None))
    s3t = count(E.simulate_stack(po, "QQQ", "QQQ3X", None, None, mr_uptrend_only=True))
    m_real = OLD.span(po, "TQQQ")
    live = np.asarray(po.dates >= po["late"]["QQQ"].first_valid_index())            # the date index starts in 1972; QQQ starts in 1999
    eras = (("1999-2002", live & (yo <= 2002)), ("2003-2007", (yo >= 2003) & (yo <= 2007)), ("2008-2009", (yo >= 2008) & (yo <= 2009)), ("1999-2009", live & (yo <= 2009)), ("1999-2015", live & pre_cut))
    wc["rebuilt_3x_stress"] = {
        "check_against_real_TQQQ_2010_2015": {"rebuilt_cagr": st(syn.to_numpy()[m_real])["cagr"], "real_cagr": st(np.nan_to_num(po["r_ll"]["TQQQ"].to_numpy())[m_real])["cagr"],
                                              "correlation": float(np.corrcoef(syn.to_numpy()[m_real][1:], np.nan_to_num(po["r_ll"]["TQQQ"].to_numpy())[m_real][1:])[0, 1])},
        "rule": {k: st(s3["ret"][m]) for k, m in eras},
        "rule_only_in_uptrend": {k: st(s3t["ret"][m]) for k, m in eras},
        "holding_the_rebuilt_fund": {k: st(syn.to_numpy()[m]) for k, m in eras},
        "by_year": {int(k): float(np.prod(1 + s3["ret"][yo == k]) - 1) for k in range(1999, 2010)}}
    # 4e. nearby settings on the 2016+ data (thresholds, holding limit, trend filter), QQQ and TQQQ
    near = {}
    for v in ("QQQ", "TQQQ"):
        near[v] = {}
        for label, kw in (("as stated", {}), ("bottom 10%", {"thr": 0.10}), ("bottom 20%", {"thr": 0.20}), ("bottom 30%", {"thr": 0.30}), ("3 sessions at most", {"max_hold": 3}),
                          ("10 sessions at most", {"max_hold": 10}), ("only while QQQ is above its 200-day average", {"mr_uptrend_only": True}), ("costs x3", {"cost_mult": 3.0})):
            r = count(E.simulate_stack(p, "QQQ", v, None, None, **kw))
            near[v][label] = {**{k: st(r["ret"][m]) for k, m in {**per, "2016-2026": yrs > 0}.items()}, "trades": tr_stats(r["mr_trade_ret"])}
    wc["nearby_settings_2016_on"] = near
    wc["older_sample_verdict"] = {k: v for k, v in older["verdicts"].items() if k.startswith(("T1", "T2"))}
    wc["older_sample"] = older["weak_close"]
    out["weak_close"] = wc

    # ---- 5. one account, both rules (assembled after the fact; the older sample did not confirm it) ----
    stacks = {}
    for name, args in (("C: TQQQ weak close first, otherwise SOXL overnight in an uptrend", ("QQQ", "TQQQ", "SOXL", "SMH")),
                       ("D: QQQ weak close first, otherwise SMH overnight in an uptrend", ("QQQ", "QQQ", "SMH", "SMH"))):
        r = count(E.simulate_stack(p, *args))
        stacks[name] = {**{k: st(r["ret"][m]) for k, m in {**per, "2016-2026": yrs > 0}.items()},
                        "by_year": {int(y): float(np.prod(1 + r["ret"][yrs == y]) - 1) for y in range(2016, 2027)}, "worst_day": float(r["ret"].min()),
                        "before_2016": older["stacks"][name]}
    stacks["older_sample_verdict"] = {k: v for k, v in older["verdicts"].items() if k.startswith("T4")}
    out["one_account_two_rules"] = stacks

    # ---- 6. survivorship: a universe picked with hindsight flatters anything that is long ----
    mega = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO"]
    ew = p["r_ll"][mega].mean(axis=1).fillna(0).to_numpy()
    out["hindsight_universe"] = {"equal_weight_of_the_10_large_stocks": {k: st(ew[m]) for k, m in per.items()},
                                 "note": "The 10 large stocks were chosen in 2026. Families E01 (its large-stock settings), E12 and E14 trade them; all three did worse than simply holding the ten."}

    # ---- 7. the three targets, against the evidence -----------------------------------
    allcfg = [(fid, k, v["holdout"].get("cagr"), v["holdout"].get("max_drawdown")) for fid, f in summ["families"].items() for k, v in f["configs"].items() if v["holdout"]]
    frontier = {}
    for cap in (0.12, 0.25, 0.50, 1.00):
        ok = [x for x in allcfg if x[2] is not None and x[3] is not None and x[3] <= cap]
        b = max(ok, key=lambda x: x[2]) if ok else None
        frontier[f"drawdown up to {int(cap * 100)}%"] = {"best_cagr": b[2], "family": b[0], "setting": b[1], "its_drawdown": b[3], "settings_in_bucket": len(ok)} if b else None
    out["targets"] = {
        "settings_at_or_above_100pct_a_year_in_the_holdout": int(sum(1 for x in allcfg if x[2] is not None and x[2] >= 1.0)), "settings_tested": len(allcfg),
        "best_holdout_cagr_by_drawdown_allowed": frontier,
        "note": "The best-of-many figures above are biased upward: each is the luckiest of the settings in its bucket."}
    out["targets"]["A_win_rate"] = {"qqq_trades_since_1999": wc["history"]["QQQ (signal QQQ)"]["trades_all"],
                                    "random_days_same_exit_win_rate": {k: v["random_win_rate"] for k, v in ctl["QQQ"].items() if isinstance(v, dict)}}
    out["post_hoc_rule_evaluations_in_this_script"] = VARIANTS["n"]
    out["pre_registered_settings"] = summ["total_settings_tried"]

    for k in list(wc["history"]):
        ser = wc["history"][k]
        if k in ("QQQ (signal QQQ)", "TQQQ (signal QQQ)"):
            pd.DataFrame({"date": ser["_dates"].date, "rule": ser["_ret"]}).to_csv(OUT / "series" / f"weak_close_{k.split()[0]}.csv", index=False)
        del ser["_ret"], ser["_dates"]
    (OUT / "equity_deep_dive.json").write_text(json.dumps(_clean(out), indent=1))
    led = Ledger(OUT / "ledger.jsonl", mode="post-hoc")
    led.record("E20", "After the holdout: which of the rules left standing is real, and what would it have paid?",
               "No kill rule: descriptive work done after the holdout was seen. It cannot prove anything and is recorded so the extra looks are counted.",
               "POST-HOC: weak-close bounce confirmed on 1999-2015; overnight semiconductor rule and both one-account stacks not confirmed there",
               {k: out[k] for k in ("overnight_semiconductors", "one_account_two_rules", "targets", "post_hoc_rule_evaluations_in_this_script")},
               "Post-hoc description, stress tests and sizing", trials=VARIANTS["n"])

    f = lambda d: "n/a" if not d else f"{d['cagr'] * 100:6.1f}%/yr S {d['sharpe']:.2f} DD {d['max_drawdown'] * 100:3.0f}%"
    print("post-hoc rule evaluations:", VARIANTS["n"])
    for k, v in wc["history"].items():
        t = v["trades_all"]
        print(f"{k:20s} {v['from']}..{v['to']} rule {f(v['rule']['all'])} | hold {f(v['hold']['all'])} | trades {t['trades']} win {t['win_rate'] * 100:.0f}% avg {t['expectancy'] * 100:.2f}% t {t['t_stat']:.1f} "
              f"avg win {t['avg_win'] * 100:.2f}% avg loss {t['avg_loss'] * 100:.2f}% | invested {v['share_of_days_invested'] * 100:.0f}% of days | worst day {v['worst_day'] * 100:.1f}% worst year {v['worst_year'] * 100:.0f}%")
        print("     by period:", {a: f(b) for a, b in v["rule"].items()})
        print("     sizing:", {a: f"{b['cagr'] * 100:.1f}%/yr DD {b['max_drawdown'] * 100:.0f}% worst day {b['worst_day'] * 100:.1f}%" for a, b in v["sizing"].items()})
        mc = v["monte_carlo_one_year"]
        print(f"     one year: p5 {mc['return_p5'] * 100:.0f}% median {mc['return_p50'] * 100:.0f}% p95 {mc['return_p95'] * 100:.0f}% | P(loss) {mc['p_loss']:.2f} P(double) {mc['p_double']:.3f} | DD median {mc['maxdd_p50'] * 100:.0f}% p95 {mc['maxdd_p95'] * 100:.0f}% "
              f"| default limits: stopped {v['with_default_limits']['last_active_day']} | Kelly {v['kelly_fraction_per_trade']:.1f} | alpha vs holding it {v['alpha_vs_holding_it']['alpha_per_year'] * 100:.1f}%/yr t {v['alpha_vs_holding_it']['t']:.1f}")
    for sym, c in ctl.items():
        print(sym, "entry vs random days:", {k: (f"{v['avg_trade'] * 100:.2f}% vs {v['random_avg_trade'] * 100:.2f}% p {v['p_random_at_least_as_good']:.3f}; win {v['win_rate'] * 100:.0f}% vs {v['random_win_rate'] * 100:.0f}%" if isinstance(v, dict) else f"{v:.1e}") for k, v in c.items()})
    r3 = wc["rebuilt_3x_stress"]
    print("rebuilt 3x check:", r3["check_against_real_TQQQ_2010_2015"])
    print("rebuilt 3x rule:", {k: f(v) for k, v in r3["rule"].items()}, "| in uptrend only:", {k: f(v) for k, v in r3["rule_only_in_uptrend"].items()})
    print("holding rebuilt 3x:", {k: f(v) for k, v in r3["holding_the_rebuilt_fund"].items()})
    print("rebuilt 3x rule by year:", {k: round(v * 100) for k, v in r3["by_year"].items()})
    print("frontier:", {k: (round(v["best_cagr"] * 100, 1), v["family"], v["setting"][:50]) for k, v in frontier.items() if v})
    print("settings at or above 100%/yr in the holdout:", out["targets"]["settings_at_or_above_100pct_a_year_in_the_holdout"], "of", len(allcfg))


if __name__ == "__main__":
    main()
