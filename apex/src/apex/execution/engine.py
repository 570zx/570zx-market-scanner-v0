"""Execution engine: turns a target position into orders, safely.

Order of operations for every decision:
  1. sync      pull order states from the broker, record new fills exactly once
  2. reconcile broker positions must equal the engine's own ledger, or new risk is blocked
  3. risk      the governor approves or blocks (exits are always allowed)
  4. journal   the intent is written to disk BEFORE anything is sent
  5. submit    one attempt; a failure leaves the order UNKNOWN and it is looked up, never re-sent
The engine keeps its own ledger in its own database, separate from the broker's, so
reconciliation is a real comparison.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from ..risk import RiskGovernor
from .broker import (DONE_STATES, INTENDED, OPEN_STATES, REJECTED, UNKNOWN, Broker, LiveTradingDisabled, Order, client_order_id)
from .store import Store


class Engine:
    def __init__(self, broker: Broker, store: Store, governor: RiskGovernor, strategy: str, symbol: str,
                 min_trade_fraction: float = 0.02, fee_buffer: float = 0.012, qty_tolerance: float = 1e-9):
        self.broker, self.store, self.gov = broker, store, governor
        self.strategy, self.symbol = strategy, symbol
        self.min_trade_fraction, self.fee_buffer, self.tol = min_trade_fraction, fee_buffer, qty_tolerance
        saved = store.get("governor")
        if saved:
            self.gov.load(saved)                                    # restart: risk state survives
        if store.get("cash") is None:
            store.put("cash", broker.get_account().cash)
            store.event("info", "ENGINE_START", {"broker": broker.name, "live": broker.is_live, "strategy": strategy})
        else:
            store.event("info", "ENGINE_RESTART", {"broker": broker.name, "open_orders": len(store.orders(OPEN_STATES))})

    # ------------------------------------------------------------------ ledger
    @property
    def cash(self) -> float:
        return float(self.store.get("cash"))

    def equity(self) -> float:
        qty = self.store.position(self.symbol)[0]
        return self.cash + (qty * self.broker.get_quote(self.symbol).bid if qty else 0.0)

    def sync(self, now: float) -> int:
        """Bring local orders up to date with the broker. Returns the number of new fills recorded."""
        new = 0
        for o in self.store.orders(OPEN_STATES):
            b = self.broker.get_order(o.client_order_id)
            if b is None:
                if o.state == INTENDED:
                    # Journaled but never reached the broker (crash between journal and send).
                    # The id is deterministic and the broker has no such order, so sending now is safe.
                    self._send(o, now)
                elif o.state != UNKNOWN:
                    o.state, o.reason = UNKNOWN, "NOT_FOUND_AT_BROKER"
                    self.store.upsert_order(o)
                    self.store.event("error", "ORDER_UNKNOWN", {"id": o.client_order_id}, ts=now)
                continue
            dq = b.filled_qty - o.filled_qty
            if dq > 1e-12:
                px = (b.avg_price * b.filled_qty - o.avg_price * o.filled_qty) / dq
                fee = b.fee - o.fee
                if self.store.add_fill(f"{o.client_order_id}:{b.filled_qty:.10f}", o.client_order_id, o.symbol, o.side, dq, px, fee, now):
                    held, basis = self.store.position(o.symbol)
                    if o.side == "buy":
                        self.store.put("cash", self.cash - dq * px - fee)
                        self.store.set_position(o.symbol, held + dq, basis + dq * px + fee)
                    else:
                        left = held - dq
                        self.store.put("cash", self.cash + dq * px - fee)
                        self.store.set_position(o.symbol, left if left > 1e-12 else 0.0, basis * (left / held) if held > 0 and left > 1e-12 else 0.0)
                    new += 1
            o.filled_qty, o.avg_price, o.fee, o.state, o.broker_order_id, o.updated_ts = b.filled_qty, b.avg_price, b.fee, b.state, b.broker_order_id, now
            o.reason = b.reason or o.reason
            self.store.upsert_order(o)
        return new

    def reconcile(self, now: float) -> bool:
        mine, theirs = self.store.positions(), self.broker.get_account().positions
        diffs = {s: (mine.get(s, 0.0), theirs.get(s, 0.0)) for s in set(mine) | set(theirs)
                 if abs(mine.get(s, 0.0) - theirs.get(s, 0.0)) > max(self.tol, 1e-6 * abs(theirs.get(s, 0.0)))}
        if diffs:
            if self.gov.halted_reason != "RECONCILE_MISMATCH":
                self.store.event("error", "RECONCILE_MISMATCH", {s: {"engine": a, "broker": b} for s, (a, b) in diffs.items()}, ts=now)
            self.gov.halted_reason = "RECONCILE_MISMATCH"
            self._save()
            return False
        return True

    # ------------------------------------------------------------------ decisions
    def rebalance(self, target_fraction: float, decision_ts: float, now: float) -> Order | None:
        """Move the position toward `target_fraction` of equity (0..1). One order per decision."""
        self.sync(now)
        ok_recon = self.reconcile(now)
        q = self.broker.get_quote(self.symbol)
        eq = self.equity()
        self.gov.on_equity(eq, now)
        held = self.store.position(self.symbol)[0]
        cur = held * q.bid
        want = max(0.0, min(1.0, target_fraction)) * eq
        if abs(want - cur) < self.min_trade_fraction * eq:
            self._save()
            return None
        if want > cur:
            side, notional = "buy", min(want - cur, self.cash / (1 + self.fee_buffer))
            qty = notional / q.ask
        else:
            side = "sell"
            qty = held if want <= 0 else min(held, (cur - want) / q.bid)
            notional = qty * q.bid
        if any(o.symbol == self.symbol for o in self.store.orders(OPEN_STATES)):
            self.store.event("warn", "ORDER_ALREADY_WORKING", {"decision_ts": decision_ts}, ts=now)
            return None
        ok, why = self.gov.check(side, notional, eq, cur, reduces_position=(side == "sell"))
        if not ok or (side == "buy" and not ok_recon):
            self.store.event("warn", "RISK_BLOCK", {"side": side, "why": why if not ok else "RECONCILE_MISMATCH", "decision_ts": decision_ts}, ts=now)
            self._save()
            return None
        coid = client_order_id(self.strategy, self.symbol, decision_ts, side)
        if self.store.get_order(coid) is not None:
            return self.store.get_order(coid)                       # this decision already has its order
        o = Order(coid, self.symbol, side, "market", qty, created_ts=now, updated_ts=now, strategy=self.strategy)
        self.store.upsert_order(o)                                  # journal first
        self._send(o, now)
        self.gov.orders_today += 1
        self.sync(now)
        self._save()
        return self.store.get_order(coid)

    def _send(self, o: Order, now: float) -> None:
        try:
            self.broker.submit(replace(o))      # a copy: whatever the broker does to it, the journal entry stays as written
        except LiveTradingDisabled as e:
            o.state, o.reason = REJECTED, "LIVE_TRADING_DISABLED"
            self.store.upsert_order(o)
            self.store.event("error", "LIVE_TRADING_DISABLED", str(e), ts=now)
        except Exception as e:                                      # timeout, 5xx, lost response
            o.state, o.reason = UNKNOWN, f"SUBMIT_ERROR: {type(e).__name__}"
            self.store.upsert_order(o)
            self.store.event("error", "SUBMIT_ERROR", {"id": o.client_order_id, "error": str(e)[:200]}, ts=now)

    def mark(self, now: float) -> float:
        """Record equity and let the governor see it. Call on every bar."""
        self.sync(now)
        eq = self.equity()
        before = self.gov.halted_reason
        self.gov.on_equity(eq, now)
        if self.gov.halted_reason and self.gov.halted_reason != before:
            self.store.event("alert", self.gov.halted_reason, {"equity": round(eq, 4), "peak": round(self.gov.peak_equity, 4)}, ts=now)
        self.store.mark_equity(now, eq, self.cash)
        self._save()
        return eq

    def emergency_stop(self, now: float, flatten: bool = False) -> None:
        """Kill switch: block new risk, cancel everything working, optionally sell the position."""
        (Path(self.gov.base_dir) / self.gov.cfg.kill_switch_file).write_text("emergency stop\n")
        for o in self.store.orders(OPEN_STATES):
            self.broker.cancel(o.client_order_id)
        self.sync(now)
        self.store.event("alert", "EMERGENCY_STOP", {"flatten": flatten}, ts=now)
        if flatten and self.store.position(self.symbol)[0] > 0:
            self.rebalance(0.0, decision_ts=now, now=now)

    def _save(self) -> None:
        self.store.put("governor", self.gov.state())

    def status(self) -> dict:
        orders = self.store.orders()
        return {"broker": self.broker.name, "live": self.broker.is_live, "cash": self.cash, "positions": self.store.positions(),
                "open_orders": len([o for o in orders if o.state in OPEN_STATES]), "done_orders": len([o for o in orders if o.state in DONE_STATES]),
                "halted": self.gov.halted_reason, "kill_switch": self.gov.kill_switch_on()}
