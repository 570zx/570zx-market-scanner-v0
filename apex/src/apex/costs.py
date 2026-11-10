"""Execution cost models.

Robinhood Crypto figures come from Robinhood's published fee schedule (document id
20261016) and its crypto order-routing page (figures "as of June 15, 2026"):

  * Exchange routing: taker ("standard") and maker ("reduced") fee by trailing
    30-day routed volume. Tier 1 ($0-$10K): 0.95% / 0.50% per side.
  * Market-maker routing: no commission, but about $0.95 per $100 is built into
    the spread, so a marketable order costs about the same as a Tier 1 taker.

A $250 account cannot leave Tier 1: Tier 2 needs $10K of routed volume in 30 days,
which is 40 full-account round trips.

Equities on Robinhood are commission-free; the cost is the spread (plus small
regulatory fees on sells). MEDS measured SPY/QQQ full spreads near 0.003%-0.006%
and 0.3%-0.6% per side on the small caps its Leader strategy traded.
"""
from __future__ import annotations

from dataclasses import dataclass

# (30-day volume floor in USD, taker %, maker %)
RH_CRYPTO_TIERS = [
    (0, 0.95, 0.50),
    (10_000, 0.75, 0.35),
    (50_000, 0.25, 0.125),
    (250_000, 0.15, 0.075),
    (500_000, 0.125, 0.06),
    (1_000_000, 0.10, 0.04),
    (5_000_000, 0.04, 0.02),
    (10_000_000, 0.03, 0.01),
    (25_000_000, 0.03, 0.00),
]


def rh_crypto_tier(volume_30d: float) -> tuple[int, float, float]:
    """Return (tier number, taker fraction, maker fraction) for a trailing 30-day volume."""
    tier = 1
    taker, maker = RH_CRYPTO_TIERS[0][1:]
    for i, (floor, t, m) in enumerate(RH_CRYPTO_TIERS, start=1):
        if volume_30d >= floor:
            tier, taker, maker = i, t, m
    return tier, taker / 100.0, maker / 100.0


@dataclass(frozen=True)
class CostModel:
    name: str
    fee: float          # fraction of notional per side
    slippage: float     # fraction per side paid on top (half spread / market impact)

    @property
    def per_side(self) -> float:
        return self.fee + self.slippage

    @property
    def round_trip(self) -> float:
        return 2.0 * self.per_side


GROSS = CostModel("gross (no costs)", 0.0, 0.0)
RH_CRYPTO_TAKER = CostModel("Robinhood crypto, Tier 1 market orders", 0.0095, 0.0002)
RH_CRYPTO_MAKER = CostModel("Robinhood crypto, Tier 1 resting limit orders", 0.0050, 0.0)
RH_CRYPTO_T3 = CostModel("Robinhood crypto, Tier 3 ($50K+/30d) market orders", 0.0025, 0.0002)
RH_ETF = CostModel("Robinhood liquid ETF (commission-free, spread only)", 0.0, 0.0005)

ALL = {m.name: m for m in [GROSS, RH_CRYPTO_TAKER, RH_CRYPTO_MAKER, RH_CRYPTO_T3, RH_ETF]}
