"""Durable state in SQLite: orders, fills, positions, equity marks, key-values and an event log.
Everything the engine needs to restart is here; nothing important lives only in memory."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .broker import Order

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
  client_order_id TEXT PRIMARY KEY, symbol TEXT, side TEXT, type TEXT, quantity REAL, limit_price REAL,
  state TEXT, filled_qty REAL, avg_price REAL, fee REAL, broker_order_id TEXT, created_ts REAL, updated_ts REAL,
  reason TEXT, strategy TEXT);
CREATE TABLE IF NOT EXISTS fills (
  fill_id TEXT PRIMARY KEY, client_order_id TEXT, symbol TEXT, side TEXT, quantity REAL, price REAL, fee REAL, ts REAL);
CREATE TABLE IF NOT EXISTS positions (symbol TEXT PRIMARY KEY, quantity REAL, cost_basis REAL);
CREATE TABLE IF NOT EXISTS equity (ts REAL PRIMARY KEY, equity REAL, cash REAL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, level TEXT, kind TEXT, detail TEXT);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self.db = sqlite3.connect(self.path, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)

    # ---- orders ----
    def upsert_order(self, o: Order) -> None:
        r = o.to_row()
        cols = ",".join(r)
        self.db.execute(f"INSERT OR REPLACE INTO orders ({cols}) VALUES ({','.join('?' * len(r))})", list(r.values()))

    def get_order(self, coid: str) -> Order | None:
        cur = self.db.execute("SELECT * FROM orders WHERE client_order_id=?", (coid,))
        row = cur.fetchone()
        return Order(**dict(zip([c[0] for c in cur.description], row))) if row else None

    def orders(self, states: set | None = None) -> list[Order]:
        cur = self.db.execute("SELECT * FROM orders ORDER BY created_ts")
        names = [c[0] for c in cur.description]
        out = [Order(**dict(zip(names, r))) for r in cur.fetchall()]
        return [o for o in out if states is None or o.state in states]

    # ---- fills: recorded once, however many times they are reported ----
    def add_fill(self, fill_id: str, coid: str, symbol: str, side: str, qty: float, price: float, fee: float, ts: float) -> bool:
        cur = self.db.execute("INSERT OR IGNORE INTO fills VALUES (?,?,?,?,?,?,?,?)", (fill_id, coid, symbol, side, qty, price, fee, ts))
        return cur.rowcount == 1

    def fills(self) -> list[dict]:
        cur = self.db.execute("SELECT * FROM fills ORDER BY ts")
        names = [c[0] for c in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]

    # ---- positions ----
    def position(self, symbol: str) -> tuple[float, float]:
        row = self.db.execute("SELECT quantity, cost_basis FROM positions WHERE symbol=?", (symbol,)).fetchone()
        return (row[0], row[1]) if row else (0.0, 0.0)

    def set_position(self, symbol: str, qty: float, cost_basis: float) -> None:
        self.db.execute("INSERT OR REPLACE INTO positions VALUES (?,?,?)", (symbol, qty, cost_basis))

    def positions(self) -> dict:
        return {s: q for s, q, _ in self.db.execute("SELECT * FROM positions") if abs(q) > 1e-12}

    # ---- equity / kv / events ----
    def mark_equity(self, ts: float, equity: float, cash: float) -> None:
        self.db.execute("INSERT OR REPLACE INTO equity VALUES (?,?,?)", (ts, equity, cash))

    def equity_curve(self) -> list[tuple]:
        return self.db.execute("SELECT ts, equity, cash FROM equity ORDER BY ts").fetchall()

    def put(self, key: str, value) -> None:
        self.db.execute("INSERT OR REPLACE INTO kv VALUES (?,?)", (key, json.dumps(value)))

    def get(self, key: str, default=None):
        row = self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def event(self, level: str, kind: str, detail: dict | str = "", ts: float | None = None) -> None:
        self.db.execute("INSERT INTO events (ts, level, kind, detail) VALUES (?,?,?,?)",
                        (time.time() if ts is None else ts, level, kind, detail if isinstance(detail, str) else json.dumps(detail)))

    def events(self, level: str | None = None) -> list[dict]:
        q = "SELECT ts, level, kind, detail FROM events" + (" WHERE level=?" if level else "") + " ORDER BY id"
        cur = self.db.execute(q, (level,) if level else ())
        return [dict(zip(("ts", "level", "kind", "detail"), r)) for r in cur.fetchall()]

    def close(self) -> None:
        self.db.close()
