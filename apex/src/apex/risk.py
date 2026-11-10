"""Position sizing and portfolio risk controls.

Defaults are the brief's starting configuration: 0.5% of equity at risk per position,
a 2% daily-loss breaker and a 12% drawdown breaker. No strategy can override the governor.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class RiskConfig:
    risk_per_position: float = 0.005     # fraction of equity lost if the stop is hit
    daily_loss_limit: float = 0.02
    max_drawdown_limit: float = 0.12
    max_gross_exposure: float = 1.0      # no leverage: positions cannot exceed equity
    max_position_fraction: float = 1.0   # largest single position as a share of equity
    max_orders_per_day: int = 20
    min_order_notional: float = 1.0
    kill_switch_file: str = "KILL"       # if this file exists, nothing new is opened


def fixed_fractional_notional(equity: float, stop_distance: float, cfg: RiskConfig) -> float:
    """Notional such that a move of `stop_distance` against the position loses risk_per_position of equity."""
    if stop_distance <= 0:
        return 0.0
    raw = equity * cfg.risk_per_position / stop_distance
    return float(min(raw, equity * cfg.max_position_fraction, equity * cfg.max_gross_exposure))


def vol_target_exposure(ret: np.ndarray, target_ann_vol: float, lookback: int, periods_per_year: float, cap: float = 1.0) -> np.ndarray:
    """Exposure multiplier for each period from trailing realised volatility (past data only)."""
    import pandas as pd
    vol = pd.Series(ret).rolling(lookback).std().shift(1) * np.sqrt(periods_per_year)
    return (target_ann_vol / vol).clip(upper=cap).fillna(0.0).to_numpy()


def kelly_fraction(trade_ret: np.ndarray) -> float:
    """Growth-optimal fraction of equity per trade for an empirical trade distribution
    (numerical maximum of mean log growth). Returns 0 when the edge is not positive."""
    r = np.asarray(trade_ret, float)
    if len(r) < 10 or r.mean() <= 0:
        return 0.0
    fs = np.linspace(0.0, min(0.999 / max(1e-9, -r.min()), 20.0), 400)
    g = [np.mean(np.log1p(np.maximum(f * r, -0.999999))) for f in fs]
    return float(fs[int(np.argmax(g))])


@dataclass
class RiskGovernor:
    """Stateful pre-trade gate used by the execution engine. Fail closed: any doubt blocks new risk.
    Exits (orders that reduce a position) are always allowed."""
    cfg: RiskConfig = field(default_factory=RiskConfig)
    base_dir: Path = Path(".")
    peak_equity: float = 0.0
    day: int = -1
    day_start_equity: float = 0.0
    orders_today: int = 0
    halted_reason: str | None = None

    def state(self) -> dict:
        return {"peak_equity": self.peak_equity, "day": self.day, "day_start_equity": self.day_start_equity,
                "orders_today": self.orders_today, "halted_reason": self.halted_reason}

    def load(self, s: dict) -> None:
        for k, v in s.items():
            setattr(self, k, v)

    def on_equity(self, equity: float, now: float | None = None) -> None:
        now = time.time() if now is None else now
        d = int(now // 86400)
        if d != self.day:
            self.day, self.day_start_equity, self.orders_today = d, equity, 0
            if self.halted_reason == "DAILY_LOSS_LIMIT":
                self.halted_reason = None            # daily breaker resets with the UTC day
        self.peak_equity = max(self.peak_equity, equity)
        if self.day_start_equity > 0 and equity / self.day_start_equity - 1 <= -self.cfg.daily_loss_limit:
            self.halted_reason = self.halted_reason or "DAILY_LOSS_LIMIT"
        if self.peak_equity > 0 and 1 - equity / self.peak_equity >= self.cfg.max_drawdown_limit:
            self.halted_reason = "MAX_DRAWDOWN_LIMIT"   # stays set until a person clears it

    def kill_switch_on(self) -> bool:
        return (Path(self.base_dir) / self.cfg.kill_switch_file).exists() or os.environ.get("APEX_KILL") == "1"

    def check(self, side: str, notional: float, equity: float, gross_exposure: float, reduces_position: bool) -> tuple[bool, str]:
        if reduces_position:
            return True, "EXIT_ALWAYS_ALLOWED"
        if self.kill_switch_on():
            return False, "KILL_SWITCH"
        if self.halted_reason:
            return False, self.halted_reason
        if equity <= 0:
            return False, "NO_EQUITY"
        if notional < self.cfg.min_order_notional:
            return False, "BELOW_MIN_ORDER"
        if self.orders_today >= self.cfg.max_orders_per_day:
            return False, "DAILY_ORDER_LIMIT"
        if notional > equity * self.cfg.max_position_fraction + 1e-9:
            return False, "POSITION_TOO_LARGE"
        if gross_exposure + notional > equity * self.cfg.max_gross_exposure + 1e-9:
            return False, "GROSS_EXPOSURE_LIMIT"
        return True, "OK"

    def clear_halt(self, confirm: str) -> None:
        """A drawdown halt can only be cleared deliberately."""
        if confirm != "I have reviewed the drawdown":
            raise PermissionError("halt not cleared: confirmation text does not match")
        self.halted_reason = None
