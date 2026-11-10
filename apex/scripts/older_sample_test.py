#!/usr/bin/env python3
"""APEX round two, step 2: test the two leading regularities on years the research never touched.

Round two's data starts on 2016-01-04. This script runs the SAME rules, unchanged, on daily bars from before
2016 (1999-2015 for QQQ, 2005-2015 for most ETFs, 2010-2015 for the 3x funds).

Data: the public-domain (CC0) "Huge Stock Market Dataset" (Stooq prices adjusted for splits and dividends,
ending 2017-11-10), fetched with git from a public mirror:
    git clone --depth 1 --filter=blob:none --sparse https://github.com/neo-zhao/CMSC320_Final_Tutorial_Huge_Stock_Market_Dataset
With daily bars a rule decides and trades at the official close (not at 15:55) and "night" runs from the close
to the next official open. In the 2016+ data, deciding at 15:55 and buying at the last print gave the same result
as buying at 15:55, so the two are comparable.

WRITTEN BEFORE THE FIRST RUN. The rules and what would count as failure:

T1  Weak close, QQQ and SPY (1 bp a side). Buy at the close when the close is in the bottom 15% of the day's range;
    sell at the first close above the price paid net of costs, else after 5 sessions.
    NOT CONFIRMED unless, over all pre-2016 trades, the win rate is 70% or more, the average trade is positive
    after costs with t >= 2, and the average trade is positive in each half of the sample.
T2  The same signal traded in the leveraged fund: TQQQ (3x, from 2010), UPRO (3x, from 2009), QLD and SSO (2x, from 2006);
    2.5 bp a side. NOT CONFIRMED unless the average trade is positive and the rule made money.
T3  Semiconductors earn their return overnight. Night (close to next open) against day (open to close) for SMH, SOXX,
    SOXL and seven chip stocks. Rule: own SOXL only overnight while SMH is above its 200-day average (2.5 bp a side).
    NOT CONFIRMED unless (a) night minus day is positive for both SMH and SOXX before 2016, and (b) the SOXL rule made
    money after costs with a higher Sharpe than holding SOXL over the same years.
T4  One account, two rules. D: QQQ weak close first, otherwise SMH overnight in an uptrend (no leverage).
    C: TQQQ weak close first, otherwise SOXL overnight in an uptrend.
    NOT CONFIRMED unless D's Sharpe is above holding QQQ's, and C's above holding TQQQ's, before 2016.

Usage: python3 scripts/older_sample_test.py     Output: results/older_sample.json
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from apex import equities as E  # noqa: E402
from apex import metrics as M  # noqa: E402
from apex.ledger import Ledger, _clean  # noqa: E402

D = ROOT / "data" / "older"
CUT = pd.Timestamp("2016-01-01")
SYMS = ["QQQ", "SPY", "IWM", "DIA", "SMH", "SOXX", "SOXL", "TQQQ", "UPRO", "QLD", "SSO", "TNA", "XLK", "GLD", "TLT",
        "NVDA", "AMD", "INTC", "TXN", "QCOM", "MU", "AVGO", "AAPL", "MSFT", "AMZN"]


def load() -> E.Panel:
    fr = {}
    for s in SYMS:
        f = D / f"{s.lower()}.us.txt"
        if f.exists():
            fr[s] = pd.read_csv(f, parse_dates=["Date"], index_col="Date")
    dates = pd.DatetimeIndex(sorted(set().union(*[set(x.index) for x in fr.values()])))
    g = lambda col: pd.DataFrame({s: x[col].reindex(dates) for s, x in fr.items()})
    o, h, l, c = g("Open"), g("High"), g("Low"), g("Close")
    rng = h - l
    f = {"o": o, "h": h, "l": l, "c": c, "late": c, "ibs": ((c - l) / rng.where(rng > 0)).clip(0, 1), "r_ll": c / c.shift(1) - 1}
    return E.Panel(dates, list(fr), f, E.calendar(dates))


def st(ret: np.ndarray) -> dict:
    s = E.stats(ret)
    return {k: s.get(k) for k in ("years", "cagr", "sharpe", "max_drawdown")} if s else {}


def trades(r: np.ndarray) -> dict | None:
    if len(r) == 0:
        return None
    s = M.trade_stats(r)
    return {k: s[k] for k in ("trades", "win_rate", "win_rate_ci95", "expectancy", "expectancy_ci95", "t_stat", "avg_win", "avg_loss", "worst_trade")}


def span(p: E.Panel, sym: str, start: str | None = None) -> np.ndarray:
    first = p["late"][sym].first_valid_index()
    a = max(first, pd.Timestamp(start)) if start else first
    return np.asarray((p.dates >= a) & (p.dates < CUT))


def main() -> None:
    p = load()
    out: dict = {"data": {"first": str(p.dates[0].date()), "last": str(p.dates[-1].date()), "cut": str(CUT.date()),
                          "symbols": {s: str(p["late"][s].first_valid_index().date()) for s in p.symbols}}}
    hold = lambda s: np.nan_to_num(p["r_ll"][s].to_numpy())

    # ---- T1 / T2: weak close
    t12 = {}
    for sig, veh in (("QQQ", "QQQ"), ("SPY", "SPY"), ("QQQ", "TQQQ"), ("SPY", "UPRO"), ("QQQ", "QLD"), ("SPY", "SSO")):
        r = E.simulate_stack(p, sig, veh, None, None)
        m = span(p, veh)
        te, tr = r["mr_trade_entry"], r["mr_trade_ret"]
        keep = m[te]
        dates_in = p.dates[m]
        mid = dates_in[len(dates_in) // 2]
        first_half = keep & np.asarray(p.dates[te] < mid)
        second_half = keep & np.asarray(p.dates[te] >= mid)
        t12[f"{veh} on {sig}'s weak close"] = {
            "years": [str(dates_in[0].date()), str(dates_in[-1].date())], "all_trades": trades(tr[keep]),
            "first_half": trades(tr[first_half]), "second_half": trades(tr[second_half]), "split_at": str(mid.date()),
            "rule": st(r["ret"][m]), "hold": st(hold(veh)[m]), "share_of_days_invested": float((r["held"][m] == 1).mean())}
    out["weak_close"] = t12

    # ---- T3: night against day
    nd = {}
    for s in ("SMH", "SOXX", "SOXL", "NVDA", "AMD", "INTC", "TXN", "QCOM", "MU", "AVGO", "QQQ", "SPY", "IWM", "TQQQ", "GLD"):
        if s not in p.symbols:
            continue
        m = span(p, s, "1999-01-01")
        night = (p["o"][s] / p["late"][s].shift(1) - 1).to_numpy()[m]
        day = (p["late"][s] / p["o"][s] - 1).to_numpy()[m]
        ok = np.isfinite(night) & np.isfinite(day)
        d = night[ok] - day[ok]
        nd[s] = {"sessions": int(ok.sum()), "from": str(p.dates[m][0].date()), "night_bp": float(night[ok].mean() * 1e4), "day_bp": float(day[ok].mean() * 1e4),
                 "t_night_minus_day": float(d.mean() / (d.std(ddof=1) / math.sqrt(len(d))))}
    out["night_vs_day"] = nd
    late = p["late"]
    rules = {}
    for veh, trend in (("SOXL", "SMH"), ("SMH", "SMH"), ("SOXX", "SOXX"), ("TQQQ", "QQQ")):
        up = ((late[trend] > E.sma(late[trend], 200)) & late[veh].notna())
        night = E.run_weights(p, pd.DataFrame({veh: up.astype(float)}), pd.DataFrame({veh: 0.0}, index=p.dates))
        allday = E.run_weights(p, pd.DataFrame({veh: up.astype(float)}), None)
        m = span(p, veh) & np.asarray(E.sma(late[trend], 200).notna())
        tr = night["trade_ret"][m[night["trade_entry"]]]
        rules[f"{veh} overnight while {trend} is above its 200-day average"] = {
            "years": [str(p.dates[m][0].date()), str(p.dates[m][-1].date())], "night_only": st(night["ret"][m]), "all_day_in_uptrend": st(allday["ret"][m]),
            "hold": st(hold(veh)[m]), "nights": trades(tr)}
    out["night_rules"] = rules

    # ---- T4: one account, two rules
    stacks = {}
    for name, args, bench in (("D: QQQ weak close first, otherwise SMH overnight in an uptrend", ("QQQ", "QQQ", "SMH", "SMH"), "QQQ"),
                              ("C: TQQQ weak close first, otherwise SOXL overnight in an uptrend", ("QQQ", "TQQQ", "SOXL", "SMH"), "TQQQ")):
        r = E.simulate_stack(p, *args)
        m = span(p, args[1]) & span(p, args[2]) & np.asarray(E.sma(late[args[3]], 200).notna())
        yrs = p.dates.year.to_numpy()
        stacks[name] = {"years": [str(p.dates[m][0].date()), str(p.dates[m][-1].date())], "rule": st(r["ret"][m]), "hold_" + bench: st(hold(bench)[m]),
                        "hold_QQQ": st(hold("QQQ")[m]), "hold_SPY": st(hold("SPY")[m]),
                        "by_year": {int(y): float(np.prod(1 + r["ret"][m & (yrs == y)]) - 1) for y in sorted(set(yrs[m]))},
                        "worst_day": float(r["ret"][m].min())}
    out["stacks"] = stacks

    # ---- verdicts, by the rules in the docstring
    v = {}
    for k in ("QQQ on QQQ's weak close", "SPY on SPY's weak close"):
        a = t12[k]
        ok = (a["all_trades"]["win_rate"] >= 0.70 and a["all_trades"]["expectancy"] > 0 and a["all_trades"]["t_stat"] >= 2
              and a["first_half"]["expectancy"] > 0 and a["second_half"]["expectancy"] > 0)
        v["T1 " + k] = "CONFIRMED" if ok else "NOT CONFIRMED"
    for k in ("TQQQ on QQQ's weak close", "UPRO on SPY's weak close", "QLD on QQQ's weak close", "SSO on SPY's weak close"):
        a = t12[k]
        v["T2 " + k] = "CONFIRMED" if a["all_trades"]["expectancy"] > 0 and a["rule"]["cagr"] > 0 else "NOT CONFIRMED"
    sx = rules["SOXL overnight while SMH is above its 200-day average"]
    v["T3 (a) night beats day in SMH and SOXX"] = "CONFIRMED" if nd["SMH"]["night_bp"] > nd["SMH"]["day_bp"] and nd["SOXX"]["night_bp"] > nd["SOXX"]["day_bp"] else "NOT CONFIRMED"
    v["T3 (b) SOXL overnight in an uptrend"] = "CONFIRMED" if sx["night_only"]["cagr"] > 0 and sx["night_only"]["sharpe"] > sx["hold"]["sharpe"] else "NOT CONFIRMED"
    dk, ck = list(stacks)
    v["T4 D (no leverage)"] = "CONFIRMED" if stacks[dk]["rule"]["sharpe"] > stacks[dk]["hold_QQQ"]["sharpe"] else "NOT CONFIRMED"
    v["T4 C (3x)"] = "CONFIRMED" if stacks[ck]["rule"]["sharpe"] > stacks[ck]["hold_TQQQ"]["sharpe"] else "NOT CONFIRMED"
    out["verdicts"] = v

    (ROOT / "results" / "older_sample.json").write_text(json.dumps(_clean(out), indent=1))
    led = Ledger(ROOT / "results" / "ledger.jsonl", mode="full")
    led.record("E19", "The weak-close bounce and the overnight return of semiconductors also hold on daily data from before 2016, which the research never touched.",
               "See the docstring of scripts/older_sample_test.py (T1-T4), written before the first run.",
               "; ".join(f"{k}: {x}" for k, x in v.items()), _clean(out), "Older-sample test of the two leading regularities", trials=12,
               notes="Public-domain daily bars, 1999-2015.")
    for k, x in v.items():
        print(f"{x:14s} {k}")
    f = lambda d: "n/a" if not d else f"{d['cagr'] * 100:6.1f}%/yr Sharpe {d['sharpe']:.2f} DD {d['max_drawdown'] * 100:.0f}%"
    for k, a in t12.items():
        t = a["all_trades"]
        print(f"{k:28s} {a['years'][0]}..{a['years'][1]}  trades {t['trades']:4d} win {t['win_rate'] * 100:.0f}% avg {t['expectancy'] * 100:.2f}% t {t['t_stat']:.1f} "
              f"(halves {a['first_half']['expectancy'] * 100:.2f}% / {a['second_half']['expectancy'] * 100:.2f}%) | rule {f(a['rule'])} | hold {f(a['hold'])}")
    for s, a in nd.items():
        print(f"night/day {s:5s} from {a['from']} n {a['sessions']:5d} night {a['night_bp']:6.1f}bp day {a['day_bp']:6.1f}bp t {a['t_night_minus_day']:5.2f}")
    for k, a in rules.items():
        print(f"{k:60s} {a['years'][0]}..{a['years'][1]} night {f(a['night_only'])} | all day {f(a['all_day_in_uptrend'])} | hold {f(a['hold'])}")
    for k, a in stacks.items():
        b = [x for x in a if x.startswith("hold_")][0]
        print(f"{k[:44]:44s} {a['years'][0]}..{a['years'][1]} rule {f(a['rule'])} | {b} {f(a[b])} | QQQ {f(a['hold_QQQ'])} | worst day {a['worst_day'] * 100:.1f}%")
        print("    by year:", {y: round(x * 100, 1) for y, x in a["by_year"].items()})


if __name__ == "__main__":
    main()
