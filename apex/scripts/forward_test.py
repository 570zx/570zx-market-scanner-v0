#!/usr/bin/env python3
"""APEX forward paper test of the weak-close rule.

PAPER ONLY. It reads market data and writes a report. It places no orders and touches no broker account.

The test is a pure function of three things: the rule (frozen below), the go-live date, and the market data
since then. Every run replays the rule from the go-live date over all complete sessions, with the same code the
backtest used (apex.equities.simulate_stack). There is no stored state to drift, and anyone can repeat a run.
What makes it a forward test is the order of events: the rule was committed to the repository before the first
session it is judged on.

The rule, the go-live date and the expectations must not be edited while the test runs. A changed rule is a new
test with a new go-live date.

Three things to know when reading the record:
  * Prices are adjusted for splits and dividends, as in the backtest. "A profit" therefore counts a dividend
    received while holding.
  * Every trade is assumed to fill at the decision price, plus the assumed cost. This tests the rule, not the
    quality of real fills: only real orders can measure that.
  * The rule trades about 30 times a year. The alarms below can catch a breakdown within a year; confirming an
    edge from this record alone takes several years (see REVIEW_RULE).

Usage:
  python3 scripts/forward_test.py --data data/equities --go-live 2026-09-01 --out /tmp/rehearsal    # rehearsal on local data
  python3 scripts/forward_test.py --fetch --out forward-state --previous forward-state/ledger.json   # the scheduled job
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from apex import equities as E  # noqa: E402
from apex import monitor  # noqa: E402
from apex.metrics import longest_losing_streak, max_drawdown  # noqa: E402

# ---- frozen on 2026-11-10 ------------------------------------------------------------------------------------
GO_LIVE = "2026-11-11"                       # the first session after the rule was committed
SIGNAL, THRESHOLD, MAX_HOLD = "QQQ", 0.15, 5
RULE = ("Five minutes before the close (15:55 New York time; 12:55 on a day that closes at 13:00), buy if QQQ is in the bottom 15% of its range for "
        "the day so far. Sell at the first such moment that shows a profit after costs, or after 5 sessions.")
ACCOUNTS = {"C": ("QQQ", "the rule traded in QQQ"),
            "D": ("TQQQ", "the same QQQ signal traded in TQQQ, the 3x fund")}
CHECKPOINTS = (30, 100)                      # closed trades per account
# What the backtests lead us to expect (QQQ 1999-2026, 833 trades; TQQQ 2010-2026, 463 trades): the share of winners,
# the average and standard deviation of a trade, and the largest drop that one simulated year in twenty exceeded.
EXPECT = {"C": {"win_rate": 0.83, "avg_trade": 0.0039, "trade_sd": 0.0255, "drawdown_p95": 0.24, "trades_a_year": 30},
          "D": {"win_rate": 0.84, "avg_trade": 0.0131, "trade_sd": 0.0531, "drawdown_p95": 0.39, "trades_a_year": 28}}
REVIEW_RULE = (
    "Checkpoints at 30 and 100 closed trades per account. An account is on track at a checkpoint if its average trade is positive after costs and no "
    "alarm has fired. Alarms, each of which means stop and look before anything else: the largest drop exceeds what one backtest year in twenty "
    "exceeded (24% for C, 39% for D); or, from 20 trades on, the count of winners or the average trade is lower than the backtest would produce one "
    "time in twenty; or a trade already published has changed. The alarms are checked after every session, so over a long run a false alarm is "
    "more likely than one in twenty: an alarm means look, not conclude. Passing a checkpoint shows the rule behaves as it did in the backtest. It "
    "does not prove an edge: even a record exactly as good as the backtest needs about 100 trades in D and about 260 in C before its average "
    "stands clear of zero four times in five.")
# ---------------------------------------------------------------------------------------------------------------


def symbols() -> list[str]:
    return sorted({SIGNAL} | {v for v, _ in ACCOUNTS.values()})


def fetch_panel(workdir: Path, start: str, client=None, now: datetime | None = None) -> E.Panel:
    """Download 5-minute bars for the test's symbols since `start` and build the session panel from them."""
    import export_alpaca as X
    cl = client or X.Client(os.environ["ALPACA_API_KEY"], os.environ["ALPACA_API_SECRET"])
    end = ((now or datetime.now(timezone.utc)) - timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")      # the free feed is 15 minutes behind
    out = {}
    for s in symbols():
        parts = [X.to_arrays(page[s]) for page in cl.bars([s], "5Min", start + "T00:00:00Z", end) if page.get(s)]
        if not parts:
            raise SystemExit(f"no bars for {s}")
        ts, o, h, l, c, v, vw = (np.concatenate(x) for x in zip(*parts))
        out[s] = X.aggregate_sessions(ts, o, h, l, c, v, vw)
    np.savez(workdir / "sessions.npz", **{f"{s}__date": d for s, (d, _) in out.items()}, **{f"{s}__x": x for s, (_, x) in out.items()})
    (workdir / "meta.json").write_text(json.dumps({"fields": X.FIELDS}))
    return E.load_panel(workdir, symbols())


def complete(p: E.Panel) -> E.Panel:
    """Drop the last session unless its decision price exists for every symbol: the 15:55 sample on a normal day
    (not merely the latest trade so far), the early-close sample on a 13:00 close."""
    syms = symbols()
    while len(p.dates):
        half = bool(p.cal["half"].iloc[-1])
        if all(np.isfinite(p["late"][s].iloc[-1]) and (half or np.isfinite(p["p955"][s].iloc[-1])) for s in syms):
            return p
        p = p.truncate(p.dates[-2]) if len(p.dates) > 1 else p.since(p.dates[-1] + pd.Timedelta(days=1))
    return p


def history_check(previous: dict | None, key: str, closed: list[dict]) -> dict:
    """Every closed trade already published must still be there, unchanged. (Vendors restate prices now and then;
    a silent change to the record is exactly what a forward test must not allow.)"""
    old = ((previous or {}).get("accounts", {}).get(key) or {}).get("trades") or []
    now = {(t["entered"], t["exited"]): t["return"] for t in closed}
    changed = [t for t in old if (t["entered"], t["exited"]) not in now or abs(now[(t["entered"], t["exited"])] - t["return"]) > 0.0005]
    return {"published_before": len(old), "changed": changed, "ok": not changed}


def run(p: E.Panel, go_live: str = GO_LIVE, previous: dict | None = None) -> dict:
    p = p.since(pd.Timestamp(go_live))
    n = len(p.dates)
    day = lambda i: str(p.dates[int(i)].date())
    out = {"paper_only": True, "go_live": go_live, "rule": RULE, "settings": {"signal": SIGNAL, "bottom_share_of_range": THRESHOLD, "max_sessions": MAX_HOLD},
           "review_rule": REVIEW_RULE, "sessions": n, "last_session": day(n - 1) if n else None, "accounts": {}}
    if n == 0:
        return out
    ibs = p["ibs"][SIGNAL].to_numpy()
    out["last_signal"] = {"session": day(n - 1), "position_in_range": float(ibs[-1]) if np.isfinite(ibs[-1]) else None, "is_a_weak_close": bool(ibs[-1] < THRESHOLD)}
    out["sessions_with_missing_data"] = [day(i) for i in range(n) if not all(np.isfinite(p["late"][s].iloc[i]) and np.isfinite(p["o"][s].iloc[i]) for s in symbols())]
    hold = lambda s: float(p["late"][s].iloc[-1] / p["late"][s].iloc[0] - 1)
    for key, (veh, label) in ACCOUNTS.items():
        r = E.simulate_stack(p, SIGNAL, veh, None, None, thr=THRESHOLD, max_hold=MAX_HOLD)
        tr, te, tx = r["mr_trade_ret"], r["mr_trade_entry"], r["mr_trade_exit"]
        closed = [{"entered": day(e), "exited": day(x), "sessions": int(x - e), "return": float(v)} for e, x, v in zip(te, tx, tr)]
        k, wins, dd, ex = len(tr), int((tr > 0).sum()), max_drawdown(r["ret"]), EXPECT[key]
        checks = {"winners": monitor.win_rate_check(wins, k, ex["win_rate"]),
                  "average_trade": monitor.mean_check(float(tr.mean()) if k else 0.0, k, ex["avg_trade"], ex["trade_sd"]),
                  "history": history_check(previous, key, closed)}
        # a checkpoint is judged on the trades up to it, not on whatever came after
        cps = {str(c): {"reached": bool(k >= c), "avg_trade": float(tr[:c].mean()) if k >= c else None, "on_track": bool(tr[:c].mean() > 0) if k >= c else None} for c in CHECKPOINTS}
        last = max((c for c in CHECKPOINTS if k >= c), default=None)
        status = ("ALARM: a published trade has changed" if not checks["history"]["ok"] else
                  "ALARM: the largest drop is beyond the backtest's one-in-twenty year" if dd > ex["drawdown_p95"] else
                  "ALARM: fewer winners than the backtest allows" if checks["winners"]["status"] == "DEGRADED" else
                  "ALARM: the average trade is below what the backtest allows" if checks["average_trade"]["status"] == "DEGRADED" else
                  "RUNNING" if last is None else
                  f"{'REVIEW DUE' if last == CHECKPOINTS[-1] else 'RUNNING'}: {'on track' if cps[str(last)]['on_track'] else 'behind (average trade not positive)'} at the {last}-trade checkpoint")
        op = r["mr_open"]
        out["accounts"][key] = {
            "label": label, "vehicle": veh, "status": status, "equity_change": float(np.prod(1 + r["ret"]) - 1), "hold_qqq_change": hold(SIGNAL),
            "hold_vehicle_change": hold(veh), "max_drawdown": dd, "closed_trades": k, "wins": wins, "win_rate": float(wins / k) if k else None,
            "avg_trade": float(tr.mean()) if k else None, "longest_losing_streak": int(longest_losing_streak(tr)) if k else 0,
            "next_checkpoint": next((c for c in CHECKPOINTS if k < c), None), "checkpoints": cps, "expected": ex, "checks": checks,
            "bought_last_session": bool(op is not None and op["entry_day"] == n - 1), "sold_last_session": bool(k and tx[-1] == n - 1),
            "open_position": None if op is None else {"entered": day(op["entry_day"]), "sessions_held": int(n - 1 - op["entry_day"]), "return_so_far": op["return_so_far"]},
            "trades": closed[::-1]}
    return out


def markdown(res: dict) -> str:
    pct = lambda x: "n/a" if x is None else f"{x * 100:+.2f}%"
    L = ["# APEX weak-close rule: forward paper test", "",
         f"**Paper only: no orders are placed and no broker account is touched.** Go-live {res['go_live']}; last complete session {res['last_session'] or 'none yet'} "
         f"({res['sessions']} sessions so far).", "", f"The rule, frozen: {res['rule']}", ""]
    if res.get("rehearsal"):
        L += ["**Rehearsal: this run used a go-live date other than the frozen one. It is not part of the record.**", ""]
    if not res["sessions"]:
        return "\n".join(L + ["No complete session since go-live yet."]) + "\n"
    s = res["last_signal"]
    L += [f"Last session {s['session']}: QQQ stood at {'n/a' if s['position_in_range'] is None else format(s['position_in_range'] * 100, '.0f') + '%'} of its range at the decision "
          f"moment, which is {'a weak close' if s['is_a_weak_close'] else 'not a weak close'}.", ""]
    if res["sessions_with_missing_data"]:
        L += [f"Sessions with missing data (no decision possible): {', '.join(res['sessions_with_missing_data'])}.", ""]
    for key, a in res["accounts"].items():
        ex, today = a["expected"], [w for w, f in (("bought", a["bought_last_session"]), ("sold", a["sold_last_session"])) if f]
        L += [f"## Account {key}: {a['label']}", "",
              f"Status: **{a['status']}**. Last session: {' and '.join(today) if today else 'no trade'}.", "",
              f"Since go-live: {pct(a['equity_change'])} (holding QQQ: {pct(a['hold_qqq_change'])}" + (f"; holding {a['vehicle']}: {pct(a['hold_vehicle_change'])}" if a["vehicle"] != SIGNAL else "") +
              f"). Largest drop {a['max_drawdown'] * 100:.2f}% (alarm at {ex['drawdown_p95'] * 100:.0f}%). Closed trades {a['closed_trades']}, winners {a['wins']}, average {pct(a['avg_trade'])}, "
              f"longest losing streak {a['longest_losing_streak']}. The backtest leads us to expect about {ex['win_rate'] * 100:.0f}% winners, {ex['avg_trade'] * 100:+.2f}% a trade and about "
              f"{ex['trades_a_year']} trades a year. Next checkpoint: {str(a['next_checkpoint']) + ' trades' if a['next_checkpoint'] else 'none left'}.", ""]
        if not a["checks"]["history"]["ok"]:
            L += ["Trades that were published earlier and are now different: " + "; ".join(f"{t['entered']} to {t['exited']} ({pct(t['return'])})" for t in a["checks"]["history"]["changed"]) + ".", ""]
        if a["open_position"]:
            o = a["open_position"]
            L += [f"Open position: entered {o['entered']}, held {o['sessions_held']} sessions, {pct(o['return_so_far'])} so far.", ""]
        if a["trades"]:
            L += ["| Entered | Exited | Sessions | Return |", "|---|---|---:|---:|"] + [f"| {t['entered']} | {t['exited']} | {t['sessions']} | {pct(t['return'])} |" for t in a["trades"]] + [""]
    L += ["## How this record will be judged", "", res["review_rule"], "", "Returns are after assumed costs (0.01% a side in QQQ, 0.025% in TQQQ) and assume each trade fills at the decision price; real fills are not "
          "measured here. Prices are left out of this report on purpose."]
    return "\n".join(L) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="directory holding sessions.npz and meta.json")
    ap.add_argument("--fetch", action="store_true", help="download the bars from Alpaca instead")
    ap.add_argument("--out", default="forward-state")
    ap.add_argument("--previous", help="the ledger.json published by the previous run, if any")
    ap.add_argument("--go-live", default=GO_LIVE, help="for rehearsals only; the real test uses the frozen date")
    args = ap.parse_args()
    if args.fetch:
        start = (pd.Timestamp(args.go_live) - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
        with tempfile.TemporaryDirectory() as tmp:
            p = fetch_panel(Path(tmp), start)
    elif args.data:
        p = E.load_panel(args.data, symbols())
    else:
        ap.error("give --data DIR or --fetch")
    prev = Path(args.previous) if args.previous else None
    previous = json.loads(prev.read_text()) if prev and prev.exists() else None
    if previous and previous.get("go_live") != args.go_live:
        previous = None                                              # a record with another go-live date is another test
    res = run(complete(p), args.go_live, previous)
    res["rehearsal"] = args.go_live != GO_LIVE
    res["code_version"] = os.environ.get("GITHUB_SHA")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "ledger.json").write_text(json.dumps(res, indent=1))
    (out / "APEX-FORWARD.md").write_text(markdown(res))
    print(markdown(res))


if __name__ == "__main__":
    main()
