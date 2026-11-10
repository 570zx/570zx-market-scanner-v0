#!/usr/bin/env python3
"""How much do the 21 early-close days (13:00 closes) matter to the published results?

The session data exported for round two has no 12:55 sample. On early-close days the panel therefore used the
13:00 print as the decision price and a day's range that runs to 15:30, which includes after-hours trades that
had not happened yet at 13:00. That is a look into the future on about two days a year. This script measures it.

  Part 1 (exact, the 12 symbols with 5-minute bars): rebuild the 12:55 price and the range before 12:55 from the
          bars, rerun the weak-close rule, and compare with the published handling.
  Part 2 (sensitivity, every symbol): make every rule that reads the day's range blind on early-close days,
          rerun those eight families, and compare verdicts with the published ones.

Usage: python3 scripts/early_close_check.py [--record]      Output: results/early_close_check.json; --record adds ledger record E22
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "scripts"))

import export_alpaca as X  # noqa: E402
import run_equity_experiments as R  # noqa: E402
from apex import equities as E  # noqa: E402
from apex.ledger import Ledger, _clean  # noqa: E402

DATA = ROOT / "data" / "equities"
PAIRS = [("QQQ", "QQQ"), ("QQQ", "TQQQ"), ("SPY", "SPY"), ("SPY", "UPRO"), ("IWM", "IWM")]


def add_exact_fields(p: E.Panel, symbols: list[str]) -> E.Panel:
    """Add p775 / h775 / l775 for early-close days from the 5-minute bars, then rebuild the derived fields."""
    half = p.dates[np.asarray(p.cal["half"])]
    names = ["p775", "h775", "l775"]
    cols = [X.FIELDS.index(k) for k in names]
    add = {k: pd.DataFrame(np.nan, index=p.dates, columns=p.symbols) for k in names}
    for s in symbols:
        z = np.load(DATA / f"bars5_{s}.npz")
        ts = z["ts"].astype(np.int64)
        day = pd.to_datetime(((ts + X.ny_offset(ts)) // 86400) * 86400, unit="s")
        m = day.isin(half)
        dates, x = X.aggregate_sessions(ts[m], *(z[k][m].astype(np.float64) for k in ("o", "h", "l", "c", "v", "vw")))
        idx = pd.to_datetime(dates.astype(str), format="%Y%m%d")
        for k, c in zip(names, cols):
            add[k].loc[idx, s] = x[:, c]
    p.f.update(add)
    return E.finish_panel(p)


def rule(p: E.Panel, sig: str, veh: str) -> dict:
    r = E.simulate_stack(p, sig, veh, None, None)
    live = np.flatnonzero(p["late"][veh].notna().to_numpy())[0]
    st = E.stats(r["ret"][live:])
    t = r["mr_trade_ret"]
    return {"trades": int(len(t)), "win_rate": float((t > 0).mean()), "avg_trade": float(t.mean()), "total_return": st["total_return"], "cagr": st["cagr"],
            "sharpe": st["sharpe"], "max_drawdown": st["max_drawdown"], "_entries": set(p.dates[r["mr_trade_entry"]].strftime("%Y-%m-%d"))}


def main() -> None:
    core = sorted(s for s in R.CORE if (DATA / f"bars5_{s}.npz").exists())
    need = sorted({s for pr in PAIRS for s in pr})
    old = E.load_panel(DATA, need)
    new = add_exact_fields(E.load_panel(DATA, need), [s for s in need if s in core])
    half = old.dates[np.asarray(old.cal["half"])]
    out = {"early_close_days": [str(d.date()) for d in half], "part1_exact": {}, "part2_blind": {}}

    # ---- Part 1 ----
    for s in ("QQQ", "SPY", "IWM"):
        a, b = old["ibs"][s].loc[half], new["ibs"][s].loc[half]
        tol = 0.005                                              # half a cent: the 5-minute files are stored in single precision
        wider = (old["hi_late"][s].loc[half] > new["hi_late"][s].loc[half] + tol) | (old["lo_late"][s].loc[half] < new["lo_late"][s].loc[half] - tol)
        out["part1_exact"][f"signal {s}"] = {
            "days_where_the_published_range_included_later_trades": int(wider.sum()),
            "buy_signals_published": int((a < 0.15).sum()), "buy_signals_exact": int((b < 0.15).sum()),
            "days_where_the_signal_differs": [str(d.date()) for d in half[np.asarray((a < 0.15) != (b < 0.15))]],
            "median_abs_price_gap_1255_vs_1300": float(np.nanmedian(np.abs(new["late"][s].loc[half] / old["late"][s].loc[half] - 1)))}
    print("Part 1: the weak-close rule, published handling vs exact handling of early-close days")
    for sig, veh in PAIRS:
        a, b = rule(old, sig, veh), rule(new, sig, veh)
        diff = sorted(a["_entries"] ^ b["_entries"])
        out["part1_exact"][f"{sig} signal, {veh} traded"] = {"published": {k: v for k, v in a.items() if k[0] != "_"}, "exact": {k: v for k, v in b.items() if k[0] != "_"},
                                                             "entries_that_differ": diff}
        print(f"  {sig:>4s}->{veh:<5s} trades {a['trades']}/{b['trades']}  win {a['win_rate']:.3f}/{b['win_rate']:.3f}  avg {a['avg_trade'] * 100:.3f}%/{b['avg_trade'] * 100:.3f}%  "
              f"a year {a['cagr'] * 100:.2f}%/{b['cagr'] * 100:.2f}%  Sharpe {a['sharpe']:.3f}/{b['sharpe']:.3f}  fall {a['max_drawdown'] * 100:.1f}%/{b['max_drawdown'] * 100:.1f}%  differing entries {diff}")

    # ---- Part 2 ----
    pub = {r["id"]: r for r in json.loads((ROOT / "results" / "equity_summary.json").read_text())["ranking"]}
    p = E.load_panel(DATA)
    blind = ~np.broadcast_to(np.asarray(p.cal["half"])[:, None], p.f["ibs"].shape)
    for k in ("ibs", "hi_late", "lo_late"):                      # the position in the range, and the range itself
        p.f[k] = p.f[k].where(blind)
    benches = {"hold SPY": np.nan_to_num(p["r_ll"]["SPY"].to_numpy()), "hold QQQ": np.nan_to_num(p["r_ll"]["QQQ"].to_numpy())}
    one = [(s, s) for s in ("SPY", "QQQ", "IWM")]
    plan = {
        "E01": lambda pp, cm: R.fam_weak_close(pp, cm, {"QQQ": (["QQQ"], 1), "SPY": (["SPY"], 1), "4 index ETFs, 2 at a time": (R.IDX, 2), "15 index and sector ETFs, 3 at a time": (R.BROAD, 3),
                                                        "10 large stocks, 3 at a time": (R.MEGA, 3)}, (False,), ("strength", "up", "hold")),
        "E02": lambda pp, cm: R.fam_weak_close(pp, cm, {"TQQQ": (["TQQQ"], 1), "4 leveraged index ETFs, 2 at a time": (R.LEV_IDX, 2), "9 leveraged ETFs, 3 at a time": (R.LEV_BROAD, 3)}, (False, True), ("strength", "hold")),
        "E04a": lambda pp, cm: R.fam_overnight(pp, cm, one),
        "E04b": lambda pp, cm: R.fam_overnight(pp, cm, [("SPY", "UPRO"), ("QQQ", "TQQQ"), ("SMH", "SOXL")]),
        "E10": lambda pp, cm: R.fam_sector(pp, cm),
        "E16a": lambda pp, cm: R.fam_strong_close(pp, cm, [("SPY", "SH"), ("QQQ", "PSQ")]),
        "E16b": lambda pp, cm: R.fam_strong_close(pp, cm, [("SPY", "SPXU"), ("QQQ", "SQQQ")]),
        "E12": lambda pp, cm: R.fam_ml(pp, cm),
    }
    R._ML_CACHE.clear()                                          # the ranker caches its predictions by date range: refit on the blinded panel
    print("Part 2: families that read the position in the day's range, made blind on early-close days")
    same = 0
    for fid, build in plan.items():
        res = E.evaluate_family(p, build(p, 1.0), benches, {"no costs": build(p, 0.0), "costs x3": build(p, 3.0)}, lookahead_ok=True)
        row = R.summarize(fid, res, None)
        same += row["verdict"] == pub[fid]["verdict"]
        out["part2_blind"][fid] = {"verdict_published": pub[fid]["verdict"], "verdict_blind": row["verdict"],
                                   "holdout_sharpe_published": pub[fid]["holdout_sharpe"], "holdout_sharpe_blind": row["holdout_sharpe"],
                                   "holdout_cagr_published": pub[fid].get("holdout_cagr"), "holdout_cagr_blind": row.get("holdout_cagr")}
        print(f"  {fid:5s} verdict {pub[fid]['verdict']} -> {row['verdict']}   holdout Sharpe {pub[fid]['holdout_sharpe']} -> {row['holdout_sharpe']}")
    out["part2_blind"]["verdicts_unchanged"] = f"{same} of {len(plan)}"
    out["not_covered"] = ("Part 2 removes the information from the future but cannot restore the exact 12:55 values for symbols without 5-minute bars, "
                          "and every family still uses the 13:00 print as its price on early-close days for those symbols. "
                          "The machine-learning ranker (E12) is refitted on the blinded panel; small changes to its inputs move its picks, so its "
                          "numbers shift more than the others.")
    (ROOT / "results" / "early_close_check.json").write_text(json.dumps(_clean(out), indent=1))
    print("wrote results/early_close_check.json")
    if "--record" not in sys.argv:
        return
    q = out["part1_exact"]["QQQ signal, QQQ traded"]
    Ledger(ROOT / "results" / "ledger.jsonl", mode="full").record(
        "E22", "Check: the handling of early-close days does not change the round-two conclusions",
        "Fails if exact handling changes a verdict, or moves the weak-close rule's return by more than 0.5 points a year",
        "CONFIRMED" if same == len(plan) and abs(q["exact"]["cagr"] - q["published"]["cagr"]) < 0.005 else "NOT CONFIRMED",
        out, "Data handling", trials=len(PAIRS) + len(plan),
        notes="On early-close days the published panel used the 13:00 print and a range that ran to 15:30. Found on 2026-11-10 while preparing the forward test. "
              "The ledger holds three E22 records and the last one stands: the first counted affected days with a tolerance tighter than the rounding "
              "of the 5-minute files, and the first two left out the machine-learning family.")
    print("recorded E22 in the ledger")


if __name__ == "__main__":
    main()
