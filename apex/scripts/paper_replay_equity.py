#!/usr/bin/env python3
"""Replay the weak-close rule through the paper execution engine, session by session, 2016-01-04 onward.

This is NOT a forward test (the data is historical). It does two jobs:
  1. Consistency: the event-driven engine (orders, fills at bid/ask, ledger, reconciliation) must reproduce the
     backtest's exact one-account replay (apex.equities.simulate_stack). Two independent implementations agreeing
     is the check.
  2. Rehearsal: the same run under the default limits (2% a day, 12% drawdown) shows what the risk governor does.

Usage: python3 scripts/paper_replay_equity.py        Output: results/paper_replay_equity.json
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from apex import equities as E  # noqa: E402
from apex import intraday as I  # noqa: E402
from apex.costs import CostModel  # noqa: E402
from apex.execution.engine import Engine  # noqa: E402
from apex.execution.paper import PaperBroker  # noqa: E402
from apex.execution.store import Store  # noqa: E402
from apex.ledger import _clean  # noqa: E402
from apex.metrics import max_drawdown  # noqa: E402
from apex.risk import RiskConfig, RiskGovernor  # noqa: E402

SIGNAL, THRESHOLD, MAX_HOLD, START_CASH = "QQQ", 0.15, 5, 250.0
RULE = "At 15:55, if QQQ is in the bottom 15% of its range for the day so far, buy. Sell at the first 15:55 showing a profit after costs, or after 5 sessions."


def replay(p: E.Panel, vehicle: str, cfg: RiskConfig, workdir: Path, label: str) -> dict:
    c = float(E.cost_of([vehicle])[vehicle])
    cost = CostModel(f"{vehicle}: no commission, {c * 1e4:g} bp a side", 0.0, c)
    broker = PaperBroker(Store(workdir / f"{label}_broker.sqlite"), cost, starting_cash=START_CASH)
    late, op, ibs = p["late"][vehicle].to_numpy(), p["o"][vehicle].to_numpy(), p["ibs"][SIGNAL].to_numpy()
    day0 = p.dates.values.astype("datetime64[s]").astype(np.int64)
    off = I.ny_offset(day0 + 17 * 3600)
    t_open = day0 + 570 * 60 - off
    t_late = day0 + np.where(np.asarray(p.cal["half"]), 780, 955) * 60 - off
    broker.set_price(vehicle, float(op[0]), float(t_open[0]))
    eng = Engine(broker, Store(workdir / f"{label}_engine.sqlite"), RiskGovernor(cfg, base_dir=workdir), "weak close", vehicle, fee_buffer=0.0)
    entry_day, marks, trips = None, [], []
    for d in range(len(p.dates)):
        if np.isfinite(op[d]):
            broker.set_price(vehicle, float(op[d]), float(t_open[d]))
            eng.mark(float(t_open[d]))
        if not np.isfinite(late[d]):
            continue
        now = float(t_late[d])
        broker.set_price(vehicle, float(late[d]), now)
        held, basis = eng.store.position(vehicle)
        if held > 0 and entry_day is not None:
            q = broker.get_quote(vehicle)
            if q.bid > basis / held or d - entry_day >= MAX_HOLD:               # a profit after costs, or time is up
                o = eng.rebalance(0.0, decision_ts=now, now=now)
                if o is not None and eng.store.position(vehicle)[0] == 0:
                    trips.append({"entry": str(p.dates[entry_day].date()), "exit": str(p.dates[d].date()), "entry_price": basis / held, "exit_price": q.bid,
                                  "return": q.bid / (basis / held) - 1, "days": d - entry_day})
                    entry_day = None
        if eng.store.position(vehicle)[0] == 0 and np.isfinite(ibs[d]) and ibs[d] < THRESHOLD:
            o = eng.rebalance(1.0, decision_ts=now + 1, now=now)                  # +1: a separate decision from any exit at the same moment
            if o is not None and eng.store.position(vehicle)[0] > 0:
                entry_day = d
        marks.append((str(p.dates[d].date()), eng.mark(now)))
    eq = np.array([m[1] for m in marks])
    r = np.array([t["return"] for t in trips])
    events = eng.store.events()
    out = {
        "label": label, "vehicle": vehicle, "start_cash": START_CASH, "final_equity": float(eq[-1]), "total_return": float(eq[-1] / START_CASH - 1),
        "max_drawdown_daily_marks": max_drawdown(np.diff(eq) / eq[:-1]), "orders": len(eng.store.orders()), "fills": len(eng.store.fills()),
        "round_trips": len(trips), "win_rate": float((r > 0).mean()) if len(r) else None, "avg_trade": float(r.mean()) if len(r) else None,
        "reconciled": eng.reconcile(float(t_late[-1])), "status": eng.status(),
        "alerts": [{"time": str(pd.to_datetime(e["ts"], unit="s")), "kind": e["kind"], "detail": e["detail"]} for e in events if e["level"] in ("alert", "error")],
        "blocked_decisions": sum(1 for e in events if e["kind"] == "RISK_BLOCK"),
        "trades": trips, "equity_daily": [{"date": a, "equity": float(b)} for a, b in marks],
    }
    eng.store.close()
    broker.store.close()
    return out


def main() -> None:
    p = E.load_panel(ROOT / "data" / "equities")
    res = {"rule": RULE, "what_this_is": "Historical replay through the paper engine. Not a forward test.",
           "period": [str(p.dates[0].date()), str(p.dates[-1].date())], "runs": {}, "consistency": {}}
    free = RiskConfig(daily_loss_limit=0.99, max_drawdown_limit=0.99, max_orders_per_day=50)
    with tempfile.TemporaryDirectory() as tmp:
        for veh in ("QQQ", "TQQQ"):
            ref = E.simulate_stack(p, SIGNAL, veh, None, None)
            ref_total = float(np.prod(1 + ref["ret"]) - 1)
            a = replay(p, veh, free, Path(tmp), f"{veh}_no_breakers")
            b = replay(p, veh, RiskConfig(), Path(tmp), f"{veh}_default_limits")
            hold_total = float(p["late"][veh].iloc[-1] / p["o"][veh].iloc[0] - 1)
            res["runs"][f"{veh}, limits off"] = a
            res["runs"][f"{veh}, default limits"] = b
            res["consistency"][veh] = {"backtest_total_return": ref_total, "paper_engine_total_return": a["total_return"], "difference": a["total_return"] - ref_total,
                                       "backtest_round_trips": int(len(ref["mr_trade_ret"])), "engine_round_trips": a["round_trips"],
                                       "agree": bool(abs(a["total_return"] / ref_total - 1) < 0.02 and abs(len(ref["mr_trade_ret"]) - a["round_trips"]) <= 1),
                                       "hold_total_return": hold_total}
            c = res["consistency"][veh]
            print(f"{veh}: backtest {c['backtest_total_return']:+.3f}  engine {c['paper_engine_total_return']:+.3f}  trips {c['backtest_round_trips']}/{c['engine_round_trips']}  agree={c['agree']}  hold {hold_total:+.3f}")
            for k, r in ((f"{veh}, limits off", a), (f"{veh}, default limits", b)):
                print(f"   {k:24s} ${START_CASH:.0f} -> ${r['final_equity']:.2f}  maxDD {r['max_drawdown_daily_marks']:.3f}  orders {r['orders']}  trips {r['round_trips']}  win {r['win_rate']}  "
                      f"blocked {r['blocked_decisions']}  alerts {len(r['alerts'])}  halted {r['status']['halted']}  reconciled {r['reconciled']}")
                if r["alerts"]:
                    print("      first alert:", r["alerts"][0])
    (ROOT / "results" / "paper_replay_equity.json").write_text(json.dumps(_clean(res), indent=1))


if __name__ == "__main__":
    main()
