#!/usr/bin/env python3
"""Flatten the result files into the CSV files the dashboard reads:
results/summary.json (round one and the re-scored MEDS backtests), results/equity_summary.json (round two),
results/older_sample.json (1999-2015 test) and results/paper_replay_equity.json (paper-engine replay)."""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "dashboard"
S = json.loads((ROOT / "results" / "summary.json").read_text())
S2 = json.loads((ROOT / "results" / "equity_summary.json").read_text())
OLDER = json.loads((ROOT / "results" / "older_sample.json").read_text())
R = json.loads((ROOT / "results" / "paper_replay_equity.json").read_text())
P = S["prior_meds"]


# Columns holding fractions are written as percentages with one decimal, ratios with two and dollars with two,
# so the number a reader sees on the page is the number in the file.
PCT = {"oos_return_per_year", "oos_max_drawdown", "win_rate", "equity_change", "hold_spy_change", "max_drawdown", "avg_closed_trade", "pnl", "return", "total_return"}
TWO = {"oos_sharpe", "benchmark_sharpe", "final_equity", "entry_price", "last_price", "exit_price", "equity", "engine", "engine_with_limits", "hold_qqq"}


def fmt(k, v):
    if v is None or (isinstance(v, float) and v != v):
        return ""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return v
    if k in PCT:
        return round(100 * v, 1)
    if k in TWO:
        return round(v, 2)
    return round(v, 4) if isinstance(v, float) else v


def write(name: str, rows: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cols = list(rows[0])
    with (OUT / name).open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: fmt(k, r.get(k)) for k in cols})
    print(f"{name}: {len(rows)} rows")


def klass(verdict: str) -> str:
    head = verdict.split(":")[0]
    return {"SURVIVES": "proven", "PROVISIONAL": "provisional", "CONFIRMED": "provisional", "NO EDGE": "no_edge", "FRAGILE": "fragile", "INCONCLUSIVE": "inconclusive"}.get(head, "failed")


# ---- 1. strategy status -------------------------------------------------------------------
rows = []
for r in S["ranking"]:
    rows.append({"id": r["id"], "strategy": r["name"], "market": r["market"], "verdict": r["verdict"], "status": klass(r["verdict"]),
                 "oos_sharpe": r.get("holdout_sharpe"), "benchmark_sharpe": r.get("benchmark_holdout_sharpe"), "oos_return_per_year": r.get("holdout_cagr"),
                 "oos_max_drawdown": r.get("holdout_max_drawdown"), "win_rate": r.get("holdout_win_rate"), "trades": r.get("holdout_trades"),
                 "settings_tried": r.get("settings_tried"), "tested_on": "2023-01 to 2026-11, never used to pick settings", "source": "APEX round one"})
MARKET = {"E01": "Index and sector ETFs, large stocks", "E02": "3x ETFs", "E03a": "SPY, QQQ, IWM", "E03b": "3x ETFs", "E04a": "SPY, QQQ, IWM, overnight", "E04b": "3x ETFs, overnight",
          "E05a1": "SPY, QQQ, intraday", "E05a3": "3x ETFs, intraday", "E05b1": "Index ETFs, 15:30 to 15:55", "E05b3": "3x and inverse ETFs, 15:30 to 15:55",
          "E05c1": "Index ETFs, 10:00 to 15:55", "E05c3": "3x and inverse ETFs, 10:00 to 15:55", "E06a": "SPY, QQQ, TLT", "E06b": "3x ETFs", "E07a": "SPY, QQQ", "E07b": "3x ETFs, gold, Treasuries",
          "E08": "SVXY", "E09": "QQQ, SPY signals; 3x funds; 5-minute bars", "E10": "11 sector ETFs", "E11": "Gold, bond, oil, bitcoin ETFs", "E12": "42 ETFs and large stocks",
          "E13a": "Mix of unleveraged families", "E13b": "Mix of leveraged families", "E14": "72 ETFs and stocks, overnight", "E15": "3x funds, NVDA, TSLA; 5-minute bars",
          "E16a": "Inverse ETFs", "E16b": "3x inverse ETFs", "E17": "Bitcoin at ETF hours", "E18": "One account, several rules"}
for r in S2["ranking"]:
    rows.append({"id": r["id"], "strategy": r["family"], "market": MARKET.get(r["id"], "US ETFs"), "verdict": r["verdict"], "status": klass(r["verdict"]),
                 "oos_sharpe": r.get("holdout_sharpe"), "benchmark_sharpe": r.get("benchmark_holdout_sharpe"), "oos_return_per_year": r.get("holdout_cagr"),
                 "oos_max_drawdown": r.get("holdout_max_drawdown"), "win_rate": r.get("holdout_win_rate"), "trades": r.get("holdout_trades"),
                 "settings_tried": r.get("settings"), "tested_on": "2023-01 to 2026-11, never used to pick settings", "source": "APEX round two"})
wc, nr, sk, ov_ = OLDER["weak_close"], OLDER["night_rules"], OLDER["stacks"], OLDER["verdicts"]


def older(oid, name, market, verdict, rule, hold_stats, tr, tested):
    rows.append({"id": oid, "strategy": name, "market": market, "verdict": verdict, "status": klass(verdict), "oos_sharpe": rule["sharpe"], "benchmark_sharpe": hold_stats["sharpe"],
                 "oos_return_per_year": rule["cagr"], "oos_max_drawdown": rule["max_drawdown"], "win_rate": tr["win_rate"] if tr else None, "trades": tr["trades"] if tr else None,
                 "settings_tried": 1, "tested_on": tested, "source": "APEX older-sample test"})


a_ = wc["QQQ on QQQ's weak close"]
older("O1", "QQQ weak close, sold at the first profit", "QQQ, daily closes", "CONFIRMED: held on years never used before, and beat holding QQQ there for the risk taken",
      a_["rule"], a_["hold"], a_["all_trades"], "1999 to 2015, never used before")
a_ = wc["SPY on SPY's weak close"]
older("O2", "SPY weak close, sold at the first profit", "SPY, daily closes", "CONFIRMED: held on years never used before, and beat holding SPY there for the risk taken",
      a_["rule"], a_["hold"], a_["all_trades"], "2005 to 2015, never used before")
a_ = wc["TQQQ on QQQ's weak close"]
older("O3", "QQQ weak close traded through TQQQ (3x)", "TQQQ, daily closes", "NO EDGE: made money in 2010 to 2015 with 84% winners, but was no better for the risk than holding TQQQ then",
      a_["rule"], a_["hold"], a_["all_trades"], "2010 to 2015, never used before")
a_ = nr["SOXL overnight while SMH is above its 200-day average"]
older("O4", "SOXL overnight only, in an uptrend", "SOXL, close to open", "NOT CONFIRMED: worse for the risk than holding SOXL before 2016; the unleveraged funds lost money overnight",
      a_["night_only"], a_["hold"], a_["nights"], "2010 to 2015, never used before")
k_d, k_c = list(sk)
older("O5", "One account: QQQ weak close, otherwise SMH overnight", "QQQ and SMH", "NOT CONFIRMED: far behind holding QQQ before 2016",
      sk[k_d]["rule"], sk[k_d]["hold_QQQ"], None, "2005 to 2015, never used before")
older("O6", "One account: TQQQ weak close, otherwise SOXL overnight", "TQQQ and SOXL", "NOT CONFIRMED: no better for the risk than holding TQQQ before 2016",
      sk[k_c]["rule"], sk[k_c]["hold_TQQQ"], None, "2010 to 2015, never used before")
e, ov, etf, lev, ld = P["edge_hunt"], P["overnight"], P["etf_weak_close"], P["leveraged_etf_weak_close"], P["leader_v87"]["v87_b_stop8"]


def prior(pid, name, market, verdict, sharpe, bench, ret, dd, win, trades, tried, tested):
    rows.append({"id": pid, "strategy": name, "market": market, "verdict": verdict, "status": klass(verdict), "oos_sharpe": sharpe, "benchmark_sharpe": bench,
                 "oos_return_per_year": ret, "oos_max_drawdown": dd, "win_rate": win, "trades": trades, "settings_tried": tried, "tested_on": tested,
                 "source": "MEDS stored backtest, re-scored"})


w = etf["walk_forward"]
prior("M01", "ETF weak-close reversal, 9 ETFs", "US ETFs, daily", "PROVISIONAL: better return for the risk than SPY, lower return; forward paper test running",
      w["sharpe"], etf["hold_spy"]["sharpe"], w["cagr"], w["max_drawdown"], w["win_rate"], w["trades"], etf["n_configs"], "2019 to 2026, walk-forward")
q = e["ibs_QQQ"]
prior("M02", "QQQ weak-close reversal", "QQQ, daily", "PROVISIONAL: better return for the risk than holding QQQ, lower return",
      q["sharpe"], e["hold_QQQ"]["sharpe"], q["cagr"], q["max_drawdown"], q["trade_stats"]["win_rate"], q["trade_stats"]["trades"], 1, "2017 to 2026, one textbook setting")
q = e["ibs_SPY"]
prior("M03", "SPY weak-close reversal", "SPY, daily", "FAILS: no better than holding",
      q["sharpe"], e["hold_SPY"]["sharpe"], q["cagr"], q["max_drawdown"], q["trade_stats"]["win_rate"], q["trade_stats"]["trades"], 1, "2017 to 2026, one textbook setting")
for pid, k, sym in (("M04", "rsi2_SPY", "SPY"), ("M05", "rsi2_QQQ", "QQQ")):
    q = e[k]
    prior(pid, f"{sym} two-day RSI reversal", f"{sym}, daily", "NO EDGE: lower drawdown than holding, but not a better return for the risk",
          q["sharpe"], e[f"hold_{sym}"]["sharpe"], q["cagr"], q["max_drawdown"], q["trade_stats"]["win_rate"], q["trade_stats"]["trades"], 1, "2017 to 2026, one textbook setting")
q = e["trend_TQQQ"]
prior("M06", "TQQQ while QQQ is above its 200-day average", "TQQQ (3x Nasdaq), daily", "NO EDGE: the return is 3x leverage, not timing; same Sharpe as holding QQQ",
      q["sharpe"], e["hold_QQQ"]["sharpe"], q["cagr"], q["max_drawdown"], q["trade_stats"]["win_rate"], q["trade_stats"]["trades"], 2, "2017 to 2026, one textbook setting")
q = ov["night_TQQQ_open_trend"]
prior("M07", "TQQQ overnight only, with trend filter", "TQQQ, close to open", "NO EDGE: ahead of holding QQQ in this backtest, but behind holding in APEX's 2023 to 2026 test and in 2010 to 2015",
      q["sharpe"], ov["hold_QQQ"]["sharpe"], q["cagr"], q["max_drawdown"], 0.569, 2069, 19, "2016 to 2026, one setting")
q = e["etf_rotation"]
prior("M08", "Monthly ETF rotation", "10 ETFs, monthly", "PROVISIONAL: better return for the risk than SPY, lower return",
      q["sharpe"], e["hold_SPY"]["sharpe"], q["cagr"], q["max_drawdown"], None, None, 1, "2017 to 2026, one textbook setting")
w = lev["walk_forward"]
prior("M09", "Leveraged-ETF weak-close reversal", "3x ETFs, daily", "FAILS: no better than holding",
      w["sharpe"], lev["hold_spy"]["sharpe"], w["cagr"], w["max_drawdown"], w["win_rate"], w["trades"], lev["n_configs"], "2019 to 2026, walk-forward")
prior("M10", "Leader Hunt v8.7, small-cap momentum", "US small caps, intraday", "FAILS: negative expectancy after costs",
      None, None, None, 0.261, ld["win_rate"], ld["trades"], 7, "40 sessions, Aug to Sep 2026")
prior("M11", "Opening-range breakout", "US small caps, intraday", "FAILS: loses money after costs", None, None, None, 0.147, 0.435, 62, 4, "40 sessions, Aug to Sep 2026")
prior("M12", "First-candle rule", "SPY and QQQ, intraday", "FAILS: no version stayed profitable on both ETFs", None, None, None, None, None, None, 1080, "2023 to 2026, untouched")
q = e["noise_spy_long"]
prior("M13", "SPY intraday: noise-band breakout, last half hour, 3:50 fade", "SPY, intraday", "FAILS: loses money after costs",
      q["sharpe"], e["hold_SPY"]["sharpe"], q["cagr"], q["max_drawdown"], 0.35, 1293, 6, "2016 to 2026 (best of six shown)")
prior("M14", "Swing trades: pullback, gap-and-hold, momentum", "US stocks, daily", "FAILS: five of six versions lost 54% to 94%", None, None, None, None, None, None, 6, "2021 to 2026")
prior("M15", "Weak-close reversal on single stocks", "128 large US stocks", "FAILS: the ETF effect does not carry over to stocks", None, None, None, None, 0.53, 36472, 12, "2016 to 2026")
q = e["momentum_15"]
prior("M16", "Monthly stock momentum, top 15", "US large caps, monthly", "FAILS: no better than holding",
      q["sharpe"], e["hold_SPY"]["sharpe"], q["cagr"], q["max_drawdown"], None, None, 1, "2017 to 2026, one textbook setting")
q = ov["night_QQQ_open"]
prior("M17", "SPY or QQQ overnight only", "SPY and QQQ, close to open", "FAILS: no better than holding",
      q["sharpe"], ov["hold_QQQ"]["sharpe"], q["cagr"], q["max_drawdown"], 0.55, 2678, 19, "2016 to 2026")
order = {"proven": 0, "provisional": 1, "no_edge": 2, "fragile": 3, "inconclusive": 4, "failed": 5}
rows.sort(key=lambda r: (order[r["status"]], -(r["oos_sharpe"] if r["oos_sharpe"] is not None else -99)))
LABEL = {"proven": "Proven", "provisional": "Provisional", "no_edge": "No edge", "fragile": "Fragile", "inconclusive": "Inconclusive", "failed": "Failed"}
for i, r in enumerate(rows, 1):
    r["rank"] = i
    r["status_label"] = LABEL[r["status"]]
    why = r["verdict"].split(":", 1)[1].strip() if ":" in r["verdict"] else r["verdict"]
    r["reason"] = why[0].upper() + why[1:]
COLS = ["rank", "id", "strategy", "market", "status", "status_label", "reason", "oos_sharpe", "benchmark_sharpe", "oos_return_per_year", "oos_max_drawdown",
        "win_rate", "trades", "settings_tried", "tested_on", "source", "verdict"]
write("strategy_status.csv", [{k: r.get(k) for k in COLS} for r in rows])

# ---- 2-4. the forward paper test MEDS already runs ------------------------------------------
pf = P["paper_forward"]
labels = {"A": "A: weak close, above 200-day average, hold 5 sessions", "B": "B: weak close, sell on strength (5 sessions at most)"}
write("forward_accounts.csv", [{"account": a, "rules": labels[a], "equity_change": v["equity_since_go_live"], "hold_spy_change": v["hold_spy_same_period"],
                                "max_drawdown": v["max_drawdown"], "closed_trades": v["closed_trades"], "wins": v["wins"], "avg_closed_trade": v["avg_closed_trade"],
                                "open_positions": len(v["open_positions"]), "sessions": pf["sessions"], "go_live": pf["go_live"], "as_of": pf["last_update"]}
                               for a, v in pf["accounts"].items()])
write("forward_positions.csv", [{"key": f"{a}-{p['sym']}", "account": a, "symbol": p["sym"], "entry_date": p["entry_date"], "entry_price": p["entry"], "last_price": p["mark"],
                                 "pnl": p["pnl"], "sessions_held": p["days"]} for a, v in pf["accounts"].items() for p in v["open_positions"]])
write("forward_trades.csv", [{"key": f"{a}-{t['sym']}-{t['entry']}", "account": a, "symbol": t["sym"], "entry_date": t["entry"], "exit_date": t["exit"], "sessions": t["days"],
                              "exit_reason": {"time": "time limit", "strength": "sold on strength"}.get(t["why"], t["why"]), "return": t["ret"]}
                             for a, v in pf["accounts"].items() for t in sorted(v["trades"], key=lambda t: t["exit"], reverse=True)])

# ---- 5-7. paper-engine replay (historical): the weak-close rule in QQQ, and the same rule in TQQQ -------------
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
sys.path.insert(0, str(ROOT / "src"))
from apex import equities as E  # noqa: E402
from apex.metrics import max_drawdown  # noqa: E402
pnl = E.load_panel(ROOT / "data" / "equities", ["QQQ", "TQQQ"])
free, guard = R["runs"]["QQQ, limits off"], R["runs"]["QQQ, default limits"]
tfree, tguard = R["runs"]["TQQQ, limits off"], R["runs"]["TQQQ, default limits"]
late = pnl["late"]["QQQ"]
first = float(pnl["o"]["QQQ"].iloc[0])
hold_eq = {str(d.date()): 250 * float(v) / first for d, v in late.items()}
g = {x["date"]: x["equity"] for x in guard["equity_daily"]}
eq_rows = [{"date": x["date"], "engine": round(x["equity"], 2), "engine_with_limits": round(g.get(x["date"], float("nan")), 2), "hold_qqq": round(hold_eq[x["date"]], 2)}
           for x in free["equity_daily"]]
write("replay_equity.csv", eq_rows[::5] + ([eq_rows[-1]] if (len(eq_rows) - 1) % 5 else []))       # every fifth session keeps the file small
write("replay_trades.csv", [{"n": i + 1, "entry_date": t["entry"], "exit_date": t["exit"], "entry_price": round(t["entry_price"], 2), "exit_price": round(t["exit_price"], 2),
                             "return": t["return"], "days_held": t["days"]} for i, t in enumerate(free["trades"])][::-1])
c, ct = R["consistency"]["QQQ"], R["consistency"]["TQQQ"]
dd_hold = lambda sym: max_drawdown(np.nan_to_num(pnl["r_ll"][sym].to_numpy()))


def run_row(run, label, r, state):
    return {"run": run, "label": label, "final_equity": r["final_equity"], "total_return": r["total_return"], "max_drawdown": r["max_drawdown_daily_marks"], "orders": r["orders"],
            "round_trips": r["round_trips"], "win_rate": r["win_rate"], "blocked_decisions": r["blocked_decisions"], "state": state}


def ref_row(run, label, total, dd, trips):
    return {"run": run, "label": label, "final_equity": 250 * (1 + total), "total_return": total, "max_drawdown": dd, "orders": None, "round_trips": trips, "win_rate": None,
            "blocked_decisions": None, "state": "reference"}


write("replay_summary.csv", [
    run_row("engine", "QQQ, paper engine, no limits", free, "running"),
    run_row("engine_with_limits", "QQQ, paper engine, 2% daily and 12% drawdown limits", guard, "halted: drawdown limit" if guard["status"]["halted"] else "running"),
    ref_row("backtest", "QQQ, backtest of the same rule", c["backtest_total_return"], None, c["backtest_round_trips"]),
    ref_row("hold", "Hold QQQ", c["hold_total_return"], dd_hold("QQQ"), 0),
    run_row("tqqq_engine", "TQQQ, paper engine, no limits", tfree, "running"),
    run_row("tqqq_limits", "TQQQ, paper engine, 2% daily and 12% drawdown limits", tguard, "halted: drawdown limit" if tguard["status"]["halted"] else "running"),
    ref_row("tqqq_hold", "Hold TQQQ", ct["hold_total_return"], dd_hold("TQQQ"), 0)])

# ---- 8. risk alerts ------------------------------------------------------------------------
plain = {"DAILY_LOSS_LIMIT": "Daily loss limit hit (2%): no new buys until the next UTC day", "MAX_DRAWDOWN_LIMIT": "Drawdown limit hit (12%): trading stopped until a person clears it",
         "RECONCILE_MISMATCH": "Broker and engine positions disagree", "EMERGENCY_STOP": "Emergency stop", "SUBMIT_ERROR": "Order sent, no answer", "ORDER_UNKNOWN": "Order not found at the broker"}
alerts = []
for a in guard["alerts"]:
    d = json.loads(a["detail"]) if a["detail"].startswith("{") else {}
    alerts.append({"time": a["time"][:16], "account": "QQQ paper engine (replay with limits)", "severity": "stop" if a["kind"] == "MAX_DRAWDOWN_LIMIT" else "warning",
                   "alert": plain.get(a["kind"], a["kind"]), "equity": d.get("equity")})
for acct, v in pf["accounts"].items():
    for p in v["open_positions"]:
        if p["pnl"] <= -0.05:
            alerts.append({"time": pf["last_update"] + " 16:00", "account": f"ETF forward paper test, account {acct}", "severity": "watch",
                           "alert": f"{p['sym']} open position is down {abs(p['pnl']) * 100:.1f}% after {p['days']} sessions", "equity": None})
alerts.sort(key=lambda a: a["time"], reverse=True)
for i, a in enumerate(alerts, 1):
    a["n"] = i
write("alerts.csv", [{"n": a["n"], **{k: v for k, v in a.items() if k != "n"}} for a in alerts])
