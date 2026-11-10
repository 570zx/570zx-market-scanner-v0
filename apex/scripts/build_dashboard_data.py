#!/usr/bin/env python3
"""Flatten results/summary.json and results/paper_replay.json into the CSV files the dashboard reads."""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "dashboard"
S = json.loads((ROOT / "results" / "summary.json").read_text())
R = json.loads((ROOT / "results" / "paper_replay.json").read_text())
P = S["prior_meds"]


# Columns holding fractions are written as percentages with one decimal, ratios with two and dollars with two,
# so the number a reader sees on the page is the number in the file.
PCT = {"oos_return_per_year", "oos_max_drawdown", "win_rate", "equity_change", "hold_spy_change", "max_drawdown", "avg_closed_trade", "pnl", "return", "total_return"}
TWO = {"oos_sharpe", "benchmark_sharpe", "final_equity", "fees_paid", "entry_price", "last_price", "exit_price", "fees", "equity", "engine", "engine_with_limits", "hold_btc"}


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
    return {"SURVIVES": "proven", "PROVISIONAL": "provisional", "NO EDGE": "no_edge", "FRAGILE": "fragile", "INCONCLUSIVE": "inconclusive"}.get(head, "failed")


# ---- 1. strategy status -------------------------------------------------------------------
rows = []
for r in S["ranking"]:
    rows.append({"id": r["id"], "strategy": r["name"], "market": r["market"], "verdict": r["verdict"], "status": klass(r["verdict"]),
                 "oos_sharpe": r.get("holdout_sharpe"), "benchmark_sharpe": r.get("benchmark_holdout_sharpe"), "oos_return_per_year": r.get("holdout_cagr"),
                 "oos_max_drawdown": r.get("holdout_max_drawdown"), "win_rate": r.get("holdout_win_rate"), "trades": r.get("holdout_trades"),
                 "settings_tried": r.get("settings_tried"), "tested_on": "2023-01 to 2026-11, never used to pick settings", "source": "APEX round one"})
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
prior("M07", "TQQQ overnight only, with trend filter", "TQQQ, close to open", "PROVISIONAL: better return for the risk than holding QQQ; needs a trade every night, sensitive to costs",
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

# ---- 5-7. paper-engine replay (historical) --------------------------------------------------
free, guard = R["runs"]["no_breakers"], R["runs"]["default_limits"]
series = json.loads("{}")
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
sys.path.insert(0, str(ROOT / "src"))
from apex.data import load_btc  # noqa: E402
d1 = load_btc(ROOT / "data", "1d")
px = pd.Series(d1.o, index=pd.to_datetime(d1.ts, unit="s").strftime("%Y-%m-%d"))
g = {x["date"]: x["equity"] for x in guard["equity_daily"]}
eq_rows, first = [], None
for x in free["equity_daily"]:
    if x["date"] not in px.index:
        continue
    first = first or px[x["date"]]
    eq_rows.append({"date": x["date"], "engine": round(x["equity"], 2), "engine_with_limits": round(g.get(x["date"], float("nan")), 2), "hold_btc": round(250 * px[x["date"]] / first, 2)})
write("replay_equity.csv", eq_rows[::3] + ([eq_rows[-1]] if (len(eq_rows) - 1) % 3 else []))       # every third day keeps the file small
write("replay_trades.csv", [{"n": i + 1, "entry_date": t["entry"], "exit_date": t["exit"], "entry_price": round(t["entry_price"], 2), "exit_price": round(t["exit_price"], 2),
                             "return": t["return"], "days_held": round(t["days"], 1), "fees": round(t["fees"], 2)} for i, t in enumerate(free["trades"])][::-1])
c = R["consistency"]
write("replay_summary.csv", [
    {"run": "engine", "label": "Paper engine, no limits", "final_equity": free["final_equity"], "total_return": free["total_return"], "max_drawdown": free["max_drawdown_hourly_marks"],
     "orders": free["orders"], "round_trips": free["round_trips"], "win_rate": free["win_rate"], "fees_paid": free["fees_paid"], "blocked_decisions": free["blocked_decisions"], "state": "running"},
    {"run": "engine_with_limits", "label": "Paper engine, 2% daily and 12% drawdown limits", "final_equity": guard["final_equity"], "total_return": guard["total_return"],
     "max_drawdown": guard["max_drawdown_hourly_marks"], "orders": guard["orders"], "round_trips": guard["round_trips"], "win_rate": guard["win_rate"], "fees_paid": guard["fees_paid"],
     "blocked_decisions": guard["blocked_decisions"], "state": "halted: drawdown limit"},
    {"run": "backtest", "label": "Backtest of the same rules", "final_equity": 250 * (1 + c["vectorised_backtest_total_return"]), "total_return": c["vectorised_backtest_total_return"],
     "max_drawdown": None, "orders": None, "round_trips": c["backtest_round_trips"], "win_rate": None, "fees_paid": None, "blocked_decisions": None, "state": "reference"},
    {"run": "hold", "label": "Hold BTC", "final_equity": 250 * (1 + R["hold_btc_total_return"]), "total_return": R["hold_btc_total_return"], "max_drawdown": S["families"]["H01"]["benchmark_hold"]["holdout"]["max_drawdown"],
     "orders": 1, "round_trips": 0, "win_rate": None, "fees_paid": None, "blocked_decisions": None, "state": "reference"}])

# ---- 8. risk alerts ------------------------------------------------------------------------
plain = {"DAILY_LOSS_LIMIT": "Daily loss limit hit (2%): no new buys until the next UTC day", "MAX_DRAWDOWN_LIMIT": "Drawdown limit hit (12%): trading stopped until a person clears it",
         "RECONCILE_MISMATCH": "Broker and engine positions disagree", "EMERGENCY_STOP": "Emergency stop", "SUBMIT_ERROR": "Order sent, no answer", "ORDER_UNKNOWN": "Order not found at the broker"}
alerts = []
for a in guard["alerts"]:
    d = json.loads(a["detail"]) if a["detail"].startswith("{") else {}
    alerts.append({"time": a["time"][:16], "account": "BTC paper engine (replay with limits)", "severity": "stop" if a["kind"] == "MAX_DRAWDOWN_LIMIT" else "warning",
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
