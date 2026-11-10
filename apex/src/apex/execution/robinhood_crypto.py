"""Adapter for Robinhood's official Crypto Trading API (https://docs.robinhood.com/crypto/trading/).

Only the official, documented API is used: an API key registered in the Robinhood account plus
an Ed25519 key pair the account owner generates. No session cookies, no scraping, no unofficial
endpoints.

REAL ORDERS ARE OFF BY DEFAULT. Sending one requires all three of:
  1. the object is constructed with live_enabled=True,
  2. the environment has APEX_LIVE_TRADING=I_ACCEPT_REAL_MONEY_ORDERS,
  3. an arming file (default ./LIVE_ARMED.json) names the account and a per-order dollar cap.
Read-only calls (account, holdings, quotes, order history) work without arming.

Provenance of the wire format: request signing, headers, base URL and rate limits follow
Robinhood's published reference; endpoint paths and JSON field names were cross-checked against
an open-source client of the same API on 2026-11-09. Robinhood's own reference page could not
be machine-read from the build environment, so `self_check()` (read-only) must pass against the
real API before this adapter is ever armed.

Known unknowns
  * The order payload carries no fee field. Fees are taken from the fee tier / estimated-price
    endpoint and settled against the account's buying power during reconciliation.
  * Rate limit: 100 requests a minute, bursts to 300 (token bucket below).
  * A request timestamp is valid for 30 seconds: the host clock must be right.
"""
from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Callable

from .broker import (CANCELED, FILLED, PARTIAL, REJECTED, SUBMITTED, UNKNOWN, Account, Broker, LiveTradingDisabled, Order, Quote)

BASE_URL = "https://trading.robinhood.com"
P_ACCOUNT = "/api/v1/crypto/trading/accounts/"
P_HOLDINGS = "/api/v1/crypto/trading/holdings/"
P_PAIRS = "/api/v1/crypto/trading/trading_pairs/"
P_ORDERS = "/api/v1/crypto/trading/orders/"
P_BBO = "/api/v1/crypto/marketdata/best_bid_ask/"
ARM_ENV, ARM_VALUE = "APEX_LIVE_TRADING", "I_ACCEPT_REAL_MONEY_ORDERS"
STATE_MAP = {"open": SUBMITTED, "partially_filled": PARTIAL, "filled": FILLED, "canceled": CANCELED, "failed": REJECTED}


class TokenBucket:
    """100 requests/minute sustained, 300 burst."""

    def __init__(self, rate_per_min: float = 100.0, capacity: float = 300.0, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.rate, self.capacity, self.clock, self.sleep = rate_per_min / 60.0, capacity, clock, sleep
        self.tokens, self.last = capacity, clock()

    def take(self) -> float:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        waited = 0.0
        if self.tokens < 1:
            waited = (1 - self.tokens) / self.rate
            self.sleep(waited)
            self.tokens, self.last = 1.0, self.clock()
        self.tokens -= 1
        return waited


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"Robinhood API {status}: {body[:200]}")
        self.status = status


def sign(api_key: str, private_key_b64: str, timestamp: int, path: str, method: str, body: str) -> str:
    """Ed25519 signature over api_key + timestamp + path + method + body, base64 encoded."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    seed = base64.b64decode(private_key_b64)[:32]
    key = Ed25519PrivateKey.from_private_bytes(seed)
    return base64.b64encode(key.sign(f"{api_key}{timestamp}{path}{method}{body}".encode())).decode()


def _default_transport(method: str, url: str, headers: dict, body: str | None, timeout: float) -> tuple[int, str]:
    import requests
    r = requests.request(method, url, headers=headers, data=body, timeout=timeout)
    return r.status_code, r.text


class RobinhoodCryptoBroker(Broker):
    name = "robinhood-crypto"

    def __init__(self, api_key: str | None = None, private_key_b64: str | None = None, live_enabled: bool = False,
                 arm_file: str | Path = "LIVE_ARMED.json", transport: Callable | None = None, bucket: TokenBucket | None = None,
                 clock: Callable[[], float] = time.time, timeout: float = 10.0, max_get_retries: int = 3):
        # Credentials come from the environment (or a secrets manager that sets it); never from a file in the repo.
        self._key = api_key or os.environ.get("APEX_RH_API_KEY", "")
        self._priv = private_key_b64 or os.environ.get("APEX_RH_PRIVATE_KEY_B64", "")
        if not self._key or not self._priv:
            raise ValueError("Robinhood API credentials are not set (APEX_RH_API_KEY, APEX_RH_PRIVATE_KEY_B64)")
        self._live_flag, self.arm_file = bool(live_enabled), Path(arm_file)
        self.transport, self.bucket, self.clock = transport or _default_transport, bucket or TokenBucket(), clock
        self.timeout, self.max_get_retries = timeout, max_get_retries
        self._account_number: str | None = None

    def __repr__(self) -> str:                      # never print secrets
        return f"RobinhoodCryptoBroker(key=***{self._key[-4:]}, live_armed={self.is_live})"

    # ------------------------------------------------------------------ arming
    def _arming(self) -> dict | None:
        if not self._live_flag or os.environ.get(ARM_ENV) != ARM_VALUE or not self.arm_file.exists():
            return None
        try:
            cfg = json.loads(self.arm_file.read_text())
        except Exception:
            return None
        return cfg if cfg.get("armed") is True and float(cfg.get("max_order_notional", 0)) > 0 and cfg.get("account_number") else None

    @property
    def is_live(self) -> bool:                      # type: ignore[override]
        return self._arming() is not None

    def _require_live(self, notional: float) -> None:
        cfg = self._arming()
        if cfg is None:
            raise LiveTradingDisabled("real orders are disabled: constructor flag, environment variable and arming file are all required")
        if notional > float(cfg["max_order_notional"]) + 1e-9:
            raise LiveTradingDisabled(f"order of ${notional:.2f} exceeds the armed cap of ${float(cfg['max_order_notional']):.2f}")
        if self._account_number and cfg["account_number"] != self._account_number:
            raise LiveTradingDisabled("arming file names a different account")

    # ------------------------------------------------------------------ wire
    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        payload = json.dumps(body) if body is not None else ""
        attempts = self.max_get_retries if method == "GET" else 1          # an order POST is never retried
        last: Exception | None = None
        for i in range(attempts):
            self.bucket.take()
            ts = int(self.clock())
            headers = {"x-api-key": self._key, "x-timestamp": str(ts), "x-signature": sign(self._key, self._priv, ts, path, method, payload),
                       "Content-Type": "application/json; charset=utf-8"}
            try:
                status, text = self.transport(method, BASE_URL + path, headers, payload or None, self.timeout)
            except Exception as e:                                         # network error / timeout
                last = e
                if method != "GET":
                    raise
                if i < attempts - 1:
                    self.bucket.sleep(min(2 ** i, 8))
                continue
            if status in (429, 500, 502, 503, 504) and method == "GET" and i < attempts - 1:
                last = ApiError(status, text)
                self.bucket.sleep(min(2 ** i, 8))
                continue
            if status >= 400:
                raise ApiError(status, text)
            return json.loads(text) if text else {}
        raise last if last else RuntimeError("request failed")

    @staticmethod
    def _results(d: dict) -> list:
        return d.get("results", [d] if d else [])

    # ------------------------------------------------------------------ read-only
    def account_raw(self) -> dict:
        d = self._request("GET", P_ACCOUNT)
        acct = self._results(d)[0] if "results" in d else d
        self._account_number = acct.get("account_number", self._account_number)
        return acct

    def get_quote(self, symbol: str) -> Quote:
        r = self._results(self._request("GET", f"{P_BBO}?symbol={symbol}"))[0]
        bid = float(r.get("bid_inclusive_of_sell_spread", r.get("bid", r.get("bid_price", 0))))
        ask = float(r.get("ask_inclusive_of_buy_spread", r.get("ask", r.get("ask_price", 0))))
        if not (0 < bid <= ask):
            raise ApiError(200, f"unusable quote for {symbol}: {r}")
        return Quote(symbol, bid, ask, self.clock())

    def get_account(self) -> Account:
        acct = self.account_raw()
        cash = float(acct.get("buying_power", 0))
        pos = {f"{h['asset_code']}-USD": float(h.get("total_quantity", 0)) for h in self._results(self._request("GET", P_HOLDINGS)) if float(h.get("total_quantity", 0)) > 0}
        eq = cash + sum(q * self.get_quote(s).bid for s, q in pos.items())
        return Account(cash, eq, pos)

    def trading_pair(self, symbol: str) -> dict:
        return self._results(self._request("GET", f"{P_PAIRS}?symbol={symbol}"))[0]

    def _parse_order(self, r: dict) -> Order:
        cfg = r.get("market_order_config") or r.get("limit_order_config") or {}
        filled = float(r.get("filled_asset_quantity") or 0)
        return Order(client_order_id=r.get("client_order_id", ""), symbol=r.get("symbol", ""), side=r.get("side", ""), type=r.get("type", ""),
                     quantity=float(cfg.get("asset_quantity") or filled or 0), limit_price=float(cfg["limit_price"]) if cfg.get("limit_price") else None,
                     state=STATE_MAP.get(r.get("state", ""), UNKNOWN), filled_qty=filled, avg_price=float(r.get("average_price") or 0),
                     broker_order_id=r.get("id"))

    def get_order(self, client_order_id: str) -> Order | None:
        path = P_ORDERS
        for _ in range(5):                                                 # recent history, newest first
            d = self._request("GET", path)
            for r in d.get("results", []):
                if r.get("client_order_id") == client_order_id:
                    return self._parse_order(r)
            if not d.get("next"):
                break
            path = d["next"].replace(BASE_URL, "")
        return None

    def open_orders(self) -> list[Order]:
        return [self._parse_order(r) for r in self._request("GET", f"{P_ORDERS}?state=open").get("results", [])]

    def self_check(self, symbol: str = "BTC-USD") -> dict:
        """Read-only verification that the live API answers in the shapes this adapter expects."""
        acct = self.account_raw()
        pair, q = self.trading_pair(symbol), self.get_quote(symbol)
        problems = []
        if "buying_power" not in acct:
            problems.append("account has no buying_power field")
        for k in ("min_order_size", "asset_increment"):
            if k not in pair:
                problems.append(f"trading pair has no {k} field")
        return {"ok": not problems, "problems": problems, "account_status": acct.get("status"), "spread_bps": (q.ask / q.bid - 1) * 1e4,
                "min_order_size": pair.get("min_order_size"), "live_armed": self.is_live}

    # ------------------------------------------------------------------ orders (guarded)
    def submit(self, order: Order) -> Order:
        px = order.limit_price or self.get_quote(order.symbol).ask
        self._require_live(order.quantity * px)                            # raises unless explicitly armed
        body = {"client_order_id": order.client_order_id, "side": order.side, "type": order.type, "symbol": order.symbol}
        qty = f"{order.quantity:.8f}"
        if order.type == "market":
            body["market_order_config"] = {"asset_quantity": qty}
        else:
            body["limit_order_config"] = {"asset_quantity": qty, "limit_price": f"{order.limit_price:.2f}", "time_in_force": "gtc"}
        placed = self._parse_order(self._request("POST", P_ORDERS, body))
        placed.strategy = order.strategy
        return placed

    def cancel(self, client_order_id: str) -> Order | None:
        o = self.get_order(client_order_id)
        if o is None or not o.broker_order_id:
            return o
        self._request("POST", f"{P_ORDERS}{o.broker_order_id}/cancel/")      # cancelling reduces risk: allowed without arming
        return self.get_order(client_order_id)
