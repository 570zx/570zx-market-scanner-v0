"""Paper broker. Simulates Robinhood-style fills from a quote feed. There is no network code in
this module: it cannot send a real order however it is called.

Fill model
  market buy   fills at the ask (plus slippage), market sell at the bid (minus slippage)
  limit        rests; fills only when the quote crosses it
  partial      at most `max_fill_notional` per step; the rest stays open and fills on later steps
  fees         cost model's fee on the filled notional
  rejects      buys beyond available cash (no leverage) and sells beyond the holding (no shorting)
All state is in the Store, so a restart continues where it stopped.
"""
from __future__ import annotations

from ..costs import CostModel
from .broker import (CANCELED, FILLED, OPEN_STATES, PARTIAL, REJECTED, SUBMITTED, Account, Broker, Order, Quote)
from .store import Store


class PaperBroker(Broker):
    name = "paper"
    is_live = False

    def __init__(self, store: Store, cost: CostModel, starting_cash: float = 250.0, half_spread: float | None = None,
                 max_fill_notional: float | None = None, maker_fee: float | None = None):
        self.store, self.cost = store, cost
        self.half_spread = cost.slippage if half_spread is None else half_spread
        self.max_fill_notional = max_fill_notional
        self.maker_fee = cost.fee if maker_fee is None else maker_fee
        self.quotes: dict[str, Quote] = {}
        if store.get("paper_cash") is None:
            store.put("paper_cash", starting_cash)
            store.put("paper_start_cash", starting_cash)

    # ---- market data comes from outside (a bar replay or a live read-only quote reader) ----
    def set_price(self, symbol: str, price: float, ts: float) -> None:
        self.quotes[symbol] = Quote(symbol, price * (1 - self.half_spread), price * (1 + self.half_spread), ts)
        self._work(ts)

    def get_quote(self, symbol: str) -> Quote:
        if symbol not in self.quotes:
            raise LookupError(f"no quote for {symbol}")
        return self.quotes[symbol]

    @property
    def cash(self) -> float:
        return float(self.store.get("paper_cash"))

    def get_account(self) -> Account:
        pos = self.store.positions()
        eq = self.cash + sum(q * self.quotes[s].bid for s, q in pos.items() if s in self.quotes)
        return Account(self.cash, eq, pos)

    # ---- orders ----
    def submit(self, order: Order) -> Order:
        existing = self.store.get_order(order.client_order_id)
        if existing is not None and existing.state != "INTENDED":
            return existing                                   # duplicate submission: return the original, do nothing
        q = self.get_quote(order.symbol)
        order.created_ts = order.created_ts or q.ts
        order.updated_ts = q.ts
        held = self.store.position(order.symbol)[0]
        if order.quantity <= 0:
            return self._reject(order, "BAD_QUANTITY")
        if order.side == "sell" and order.quantity > held + 1e-12:
            return self._reject(order, "SELL_EXCEEDS_HOLDING")
        if order.side == "buy":
            px = order.limit_price or q.ask
            if order.quantity * px * (1 + self.cost.fee) > self.cash + 1e-9:
                return self._reject(order, "INSUFFICIENT_CASH")
        order.state = SUBMITTED
        order.broker_order_id = "paper-" + order.client_order_id[:8]
        self.store.upsert_order(order)
        self._try_fill(order, q)
        return self.store.get_order(order.client_order_id)

    def _reject(self, order: Order, why: str) -> Order:
        order.state, order.reason = REJECTED, why
        self.store.upsert_order(order)
        self.store.event("warn", "ORDER_REJECTED", {"id": order.client_order_id, "why": why}, ts=order.updated_ts)
        return order

    def _work(self, ts: float) -> None:
        for o in self.store.orders(OPEN_STATES - {"INTENDED", "UNKNOWN"}):
            if o.symbol in self.quotes:
                self._try_fill(o, self.quotes[o.symbol])

    def _try_fill(self, o: Order, q: Quote) -> None:
        if o.type == "market":
            px, fee_rate = (q.ask if o.side == "buy" else q.bid), self.cost.fee
        else:
            crossed = q.ask <= o.limit_price if o.side == "buy" else q.bid >= o.limit_price
            if not crossed:
                return
            px, fee_rate = o.limit_price, self.maker_fee
        qty = o.remaining
        if self.max_fill_notional is not None:
            qty = min(qty, self.max_fill_notional / px)
        if qty <= 0:
            return
        n_prev = len([f for f in self.store.fills() if f["client_order_id"] == o.client_order_id])
        fee = qty * px * fee_rate
        if not self.store.add_fill(f"{o.client_order_id}:{n_prev}", o.client_order_id, o.symbol, o.side, qty, px, fee, q.ts):
            return
        held, basis = self.store.position(o.symbol)
        if o.side == "buy":
            self.store.put("paper_cash", self.cash - qty * px - fee)
            self.store.set_position(o.symbol, held + qty, basis + qty * px + fee)
        else:
            self.store.put("paper_cash", self.cash + qty * px - fee)
            left = held - qty
            self.store.set_position(o.symbol, left if left > 1e-12 else 0.0, basis * (left / held) if held > 0 and left > 1e-12 else 0.0)
        o.avg_price = (o.avg_price * o.filled_qty + px * qty) / (o.filled_qty + qty)
        o.filled_qty += qty
        o.fee += fee
        o.state = FILLED if o.remaining <= 1e-12 else PARTIAL
        o.updated_ts = q.ts
        self.store.upsert_order(o)

    def cancel(self, client_order_id: str) -> Order | None:
        o = self.store.get_order(client_order_id)
        if o is not None and o.state in OPEN_STATES:
            o.state = CANCELED
            self.store.upsert_order(o)
        return o

    def get_order(self, client_order_id: str) -> Order | None:
        return self.store.get_order(client_order_id)

    def open_orders(self) -> list[Order]:
        return self.store.orders(OPEN_STATES)
