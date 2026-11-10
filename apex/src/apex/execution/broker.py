"""Broker boundary. Research and portfolio code never import a concrete broker; they talk to
this interface. Two implementations exist and they share no code path for sending orders:

  PaperBroker              simulated fills, no network code at all
  RobinhoodCryptoBroker    Robinhood's official Crypto Trading API; orders blocked unless armed
"""
from __future__ import annotations

import hashlib
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field

# Order lifecycle. UNKNOWN means "sent, no answer": it is never re-sent blindly, only looked up.
INTENDED, SUBMITTED, PARTIAL, FILLED, CANCELED, REJECTED, UNKNOWN = (
    "INTENDED", "SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "UNKNOWN")
OPEN_STATES = {INTENDED, SUBMITTED, PARTIAL, UNKNOWN}
DONE_STATES = {FILLED, CANCELED, REJECTED}


@dataclass
class Quote:
    symbol: str
    bid: float
    ask: float
    ts: float

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2


@dataclass
class Order:
    client_order_id: str
    symbol: str
    side: str                       # "buy" | "sell"
    type: str                       # "market" | "limit"
    quantity: float                 # asset units
    limit_price: float | None = None
    state: str = INTENDED
    filled_qty: float = 0.0
    avg_price: float = 0.0
    fee: float = 0.0
    broker_order_id: str | None = None
    created_ts: float = 0.0
    updated_ts: float = 0.0
    reason: str = ""
    strategy: str = ""

    def to_row(self) -> dict:
        return asdict(self)

    @property
    def remaining(self) -> float:
        return max(0.0, self.quantity - self.filled_qty)


@dataclass
class Account:
    cash: float
    equity: float
    positions: dict = field(default_factory=dict)   # symbol -> quantity


def client_order_id(strategy: str, symbol: str, decision_ts: float, side: str, seq: int = 0) -> str:
    """Deterministic id: the same decision always maps to the same order, so a retry or a
    restart can never create a second order for it."""
    h = hashlib.sha256(f"{strategy}|{symbol}|{int(decision_ts)}|{side}|{seq}".encode()).digest()
    return str(uuid.UUID(bytes=h[:16], version=4))


class LiveTradingDisabled(RuntimeError):
    """Raised when anything tries to send a real order without the explicit arming steps."""


class Broker(ABC):
    name: str = "abstract"
    is_live: bool = False

    @abstractmethod
    def get_quote(self, symbol: str) -> Quote: ...

    @abstractmethod
    def get_account(self) -> Account: ...

    @abstractmethod
    def submit(self, order: Order) -> Order: ...

    @abstractmethod
    def cancel(self, client_order_id: str) -> Order | None: ...

    @abstractmethod
    def get_order(self, client_order_id: str) -> Order | None: ...

    @abstractmethod
    def open_orders(self) -> list[Order]: ...
