#!/usr/bin/env python3
"""Replay a strategy through the paper execution engine, bar by bar, over the 2023+ holdout.

This is NOT a forward test (the data is historical). It does two different jobs:
  1. Consistency: the event-driven engine (orders, fills, fees, ledger) must reproduce the
     vectorised backtest. Two independent implementations agreeing is the check.
  2. Rehearsal: the same run with the default circuit breakers shows what the risk governor
     does to a real path, and produces the files the dashboard reads.

Usage: python3 scripts/paper_replay.py
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
sys.path.insert(0, str(ROOT / "scripts"))

from apex.backtest import run_positions  # noqa: E402
from apex.costs import RH_CRYPTO_TAKER as TAKER  # noqa: E402
from apex.data import load_btc  # noqa: E402
from apex.execution.engine import Engine  # noqa: E402
from apex.execution.paper import PaperBroker  # noqa: E402
from apex.execution.store import Store  # noqa: E402
from apex.ledger import _clean  # noqa: E402
from apex.metrics import max_drawdown  # noqa: E402
from apex.research import H0  # noqa: E402
from apex.risk import RiskConfig, RiskGovernor  # noqa: E402
from run_experiments import cfg_regime  # noqa: E402

STRATEGY = "50-day trend, out in crisis or thin"      # the best crypto candidate of round one (it still failed)
SYMBOL, START_CASH = "BTC-USD", 250.0


def replay(d1, h1, sig, cfg: RiskConfig, workdir: Path, label: str) -> dict:
    broker = PaperBroker(Store(workdir / f"{label}_broker.sqlite"), TAKER, starting_cash=START_CASH)
    i0 = int(np.searchsorted(d1.ts, H0))
    broker.set_price(SYMBOL, float(d1.o[i0]), float(d1.ts[i0]))
    eng = Engine(broker, Store(workdir / f"{label}_engine.sqlite"), RiskGovernor(cfg, base_dir=workdir), STRATEGY, SYMBOL,
                 fee_buffer=TAKER.fee + 0.0005)
    day_of = {int(t): i for i, t in enumerate(d1.ts)}
    j0 = int(np.searchsorted(h1.ts, d1.ts[i0]))
    j1 = int(np.searchsorted(h1.ts, d1.ts[-1]))                      # stop where the daily series stops
    for j in range(j0, j1 + 1):
        now, px = float(h1.ts[j]), float(h1.o[j])
        broker.set_price(SYMBOL, px, now)
        i = day_of.get(int(h1.ts[j]))
        if i is not None and i >= 1:                                 # a new UTC day opens: act on yesterday's close
            eng.rebalance(float(sig[i - 1]), decision_ts=float(d1.ts[i - 1]), now=now)
        eng.mark(now)
    curve = eng.store.equity_curve()
    ts = np.array([c[0] for c in curve])
    eq = np.array([c[1] for c in curve])
    fills = eng.store.fills()
    trips, buy = [], None
    for f in fills:
        if f["side"] == "buy" and buy is None:
            buy = f
        elif f["side"] == "sell" and buy is not None:
            cost, proceeds = buy["quantity"] * buy["price"] + buy["fee"], f["quantity"] * f["price"] - f["fee"]
            trips.append({"entry": str(pd.to_datetime(buy["ts"], unit="s").date()), "exit": str(pd.to_datetime(f["ts"], unit="s").date()),
                          "entry_price": buy["price"], "exit_price": f["price"], "return": proceeds / cost - 1,
                          "days": (f["ts"] - buy["ts"]) / 86400, "fees": buy["fee"] + f["fee"]})
            buy = None
    day = (ts // 86400).astype(np.int64)
    last = np.concatenate([np.flatnonzero(np.diff(day)), [len(day) - 1]])
    r = np.array([t["return"] for t in trips])
    events = eng.store.events()
    status = eng.status()
    acct = broker.get_account()
    out = {
        "label": label, "start_cash": START_CASH, "final_equity": float(eq[-1]), "total_return": float(eq[-1] / START_CASH - 1),
        "max_drawdown_hourly_marks": max_drawdown(np.diff(eq) / eq[:-1]),
        "orders": len(eng.store.orders()), "fills": len(fills), "round_trips": len(trips),
        "win_rate": float((r > 0).mean()) if len(r) else None, "avg_trade": float(r.mean()) if len(r) else None,
        "fees_paid": float(sum(f["fee"] for f in fills)),
        "reconciled": eng.reconcile(float(ts[-1])), "status": status,
        "open_position": {"symbol": SYMBOL, "quantity": acct.positions.get(SYMBOL, 0.0), "value": acct.positions.get(SYMBOL, 0.0) * broker.get_quote(SYMBOL).bid,
                          "cash": acct.cash, "as_of": str(pd.to_datetime(ts[-1], unit="s"))},
        "alerts": [{"time": str(pd.to_datetime(e["ts"], unit="s")), "kind": e["kind"], "detail": e["detail"]} for e in events if e["level"] in ("alert", "error")],
        "blocked_decisions": sum(1 for e in events if e["kind"] == "RISK_BLOCK"),
        "trades": trips,
        "equity_daily": [{"date": str(pd.to_datetime(ts[k], unit="s").date()), "equity": float(eq[k])} for k in last],
    }
    eng.store.close()
    broker.store.close()
    return out


def main() -> None:
    d1, h1 = load_btc(ROOT / "data", "1d"), load_btc(ROOT / "data", "1h")
    sig = np.nan_to_num(cfg_regime()[STRATEGY](d1))
    i0 = int(np.searchsorted(d1.ts, H0))
    # vectorised reference over exactly the same span, starting flat
    ref = run_positions(d1.slice(i0 - 1, len(d1)), sig[i0 - 1:], TAKER)
    ref_total = float(np.prod(1 + ref.ret) - 1)
    hold_total = float(d1.o[-1] / d1.o[i0] - 1)
    with tempfile.TemporaryDirectory() as tmp:
        free = replay(d1, h1, sig, RiskConfig(daily_loss_limit=0.99, max_drawdown_limit=0.99, max_orders_per_day=50), Path(tmp), "no_breakers")
        guarded = replay(d1, h1, sig, RiskConfig(), Path(tmp), "default_limits")
    diff = free["total_return"] - ref_total
    out = {
        "strategy": STRATEGY, "symbol": SYMBOL, "cost_model": TAKER.name, "period": [str(pd.to_datetime(d1.ts[i0], unit="s").date()), str(pd.to_datetime(d1.ts[-1], unit="s").date())],
        "what_this_is": "Historical replay through the paper engine. Not a forward test.",
        "hold_btc_total_return": hold_total,
        "consistency": {"vectorised_backtest_total_return": ref_total, "paper_engine_total_return": free["total_return"], "difference": diff,
                        "backtest_round_trips": int(len(ref.trade_ret)), "engine_round_trips": free["round_trips"],
                        "agree": bool(abs(diff) < 0.02 and abs(len(ref.trade_ret) - free["round_trips"]) <= 1)},
        "runs": {"no_breakers": free, "default_limits": guarded},
    }
    (ROOT / "results" / "paper_replay.json").write_text(json.dumps(_clean(out), indent=1))
    c = out["consistency"]
    print(f"strategy: {STRATEGY}  {out['period'][0]} -> {out['period'][1]}")
    print(f"backtest {c['vectorised_backtest_total_return']:+.4f}  engine {c['paper_engine_total_return']:+.4f}  diff {c['difference']:+.4f}  "
          f"trips {c['backtest_round_trips']}/{c['engine_round_trips']}  agree={c['agree']}")
    for k, r in out["runs"].items():
        print(f"{k:15s} final ${r['final_equity']:.2f}  return {r['total_return']:+.3f}  maxDD {r['max_drawdown_hourly_marks']:.3f}  orders {r['orders']}  "
              f"trips {r['round_trips']}  win {r['win_rate']}  fees ${r['fees_paid']:.2f}  blocked {r['blocked_decisions']}  alerts {len(r['alerts'])}  halted {r['status']['halted']}  reconciled {r['reconciled']}")
    print(f"hold BTC {hold_total:+.3f}")


if __name__ == "__main__":
    main()
