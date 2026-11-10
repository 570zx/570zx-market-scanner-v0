"""Market data: ingest raw public datasets into validated bar files, and load them.

Sources (both public, fetched with git, no paid services):
  * Bitstamp BTC/USD 1-minute OHLCV, 2012 -> present
    https://github.com/ff137/bitstamp-btcusd-minute-data
    Bitstamp is the Robinhood affiliate where Robinhood rests crypto limit orders,
    so this is the closest free proxy for the prices a Robinhood order would see.
  * Coin Metrics community daily metrics (price + on-chain), per asset
    https://github.com/coinmetrics/data

Ingest validates the data and refuses to write a bar file that fails a check.
"""
from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

MIN = 60
RESEARCH_START = 1388534400  # 2014-01-01 UTC; earlier Bitstamp liquidity is too thin


@dataclass
class Bars:
    """Fixed-interval OHLCV bars. `ts` is the UTC open time of each bar (seconds)."""

    ts: np.ndarray
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray
    step: int
    ok: np.ndarray | None = None  # False where the bar overlaps a known exchange outage

    def __len__(self) -> int:
        return len(self.ts)

    def slice(self, a: int, b: int) -> "Bars":
        ok = None if self.ok is None else self.ok[a:b]
        return Bars(self.ts[a:b], self.o[a:b], self.h[a:b], self.l[a:b], self.c[a:b], self.v[a:b], self.step, ok)

    def index(self) -> pd.DatetimeIndex:
        return pd.to_datetime(self.ts, unit="s", utc=True)

    def save(self, path: Path) -> None:
        ok = np.ones(len(self.ts), bool) if self.ok is None else self.ok
        np.savez_compressed(path, ts=self.ts, o=self.o, h=self.h, l=self.l, c=self.c, v=self.v, step=self.step, ok=ok)

    @staticmethod
    def load(path: Path) -> "Bars":
        z = np.load(path)
        return Bars(z["ts"], z["o"], z["h"], z["l"], z["c"], z["v"], int(z["step"]), z["ok"])


def validate_minutes(df: pd.DataFrame) -> dict:
    """Checks on the raw 1-minute frame. Raises ValueError on any hard failure."""
    ts = df["timestamp"].to_numpy()
    rep: dict = {"rows": int(len(df))}
    if len(df) == 0:
        raise ValueError("empty dataset")
    d = np.diff(ts)
    rep["duplicates"] = int((d == 0).sum())
    rep["gaps"] = int((d > MIN).sum())
    rep["out_of_order"] = int((d < 0).sum())
    if rep["out_of_order"] or rep["duplicates"]:
        raise ValueError(f"timestamps not strictly increasing: {rep}")
    if rep["gaps"]:
        raise ValueError(f"missing minutes: {rep['gaps']} gaps")
    px = df[["open", "high", "low", "close"]].to_numpy()
    if not np.isfinite(px).all() or (px <= 0).any():
        raise ValueError("non-finite or non-positive prices")
    bad_hl = int(((df["high"] < df[["open", "close"]].max(axis=1) - 1e-9) | (df["low"] > df[["open", "close"]].min(axis=1) + 1e-9)).sum())
    rep["ohlc_inconsistent"] = bad_hl
    if bad_hl > 0.0001 * len(df):
        raise ValueError(f"too many inconsistent OHLC rows: {bad_hl}")
    r = np.abs(np.diff(np.log(df["close"].to_numpy())))
    rep["minute_moves_over_10pct"] = int((r > 0.10).sum())
    rep["zero_volume_share"] = float((df["volume"] == 0).mean())
    rep["first"] = str(pd.to_datetime(int(ts[0]), unit="s", utc=True))
    rep["last"] = str(pd.to_datetime(int(ts[-1]), unit="s", utc=True))
    return rep


def resample(m: Bars, step: int) -> Bars:
    """Aggregate 1-minute bars to `step` seconds, aligned to UTC boundaries. Partial edges dropped."""
    k = step // m.step
    first = int(np.argmax(m.ts % step == 0))
    n = (len(m) - first) // k
    sl = slice(first, first + n * k)
    rs = lambda a: a[sl].reshape(n, k)
    ok = None if m.ok is None else rs(m.ok).all(axis=1)
    return Bars(rs(m.ts)[:, 0].copy(), rs(m.o)[:, 0].copy(), rs(m.h).max(axis=1), rs(m.l).min(axis=1),
                rs(m.c)[:, -1].copy(), rs(m.v).sum(axis=1), step, ok)


def ingest_bitstamp(raw_dir: Path, out_dir: Path) -> dict:
    hist = raw_dir / "data/historical/btcusd_bitstamp_1min_2012-2025.csv.gz"
    upd = raw_dir / "data/updates/btcusd_bitstamp_1min_latest.csv"
    prov = raw_dir / "data/provenance/btcusd_bitstamp_1min.csv"
    dt = {"timestamp": "float64", "open": "float64", "high": "float64", "low": "float64", "close": "float64", "volume": "float64"}
    with gzip.open(hist, "rt") as f:
        a = pd.read_csv(f, dtype=dt)
    b = pd.read_csv(upd, dtype=dt)
    df = pd.concat([a, b], ignore_index=True)
    df["timestamp"] = df["timestamp"].astype("int64")
    df = df.drop_duplicates("timestamp", keep="last").sort_values("timestamp")
    df = df[df["timestamp"] >= RESEARCH_START].reset_index(drop=True)
    rep = validate_minutes(df)
    ts = df["timestamp"].to_numpy()
    ok = np.ones(len(df), bool)
    outages = 0
    if prov.exists():
        p = pd.read_csv(prov)
        for s, e in zip(p["start_timestamp"], p["end_timestamp"]):
            i, j = np.searchsorted(ts, [s, e + MIN])
            if j > i:
                ok[i:j] = False
                outages += 1
    rep["outage_windows_flagged"] = outages
    rep["outage_minutes_share"] = float(1 - ok.mean())
    m = Bars(ts, *(df[c].to_numpy() for c in ["open", "high", "low", "close", "volume"]), MIN, ok)
    out_dir.mkdir(parents=True, exist_ok=True)
    m.save(out_dir / "btc_1m.npz")
    for name, step in [("5m", 300), ("15m", 900), ("1h", 3600), ("4h", 14400), ("1d", 86400)]:
        resample(m, step).save(out_dir / f"btc_{name}.npz")
    (out_dir / "btc_ingest_report.json").write_text(json.dumps(rep, indent=2))
    return rep


def ingest_coinmetrics(raw_dir: Path, out_dir: Path, assets: list[str]) -> dict:
    """Daily panel. Coin Metrics daily values are stamped at 00:00 UTC of day D and cover day D,
    so a value for day D is only knowable after D ends. Loaders shift accordingly."""
    cols = ["PriceUSD", "CapMVRVCur", "AdrActCnt", "FlowInExUSD", "FlowOutExUSD", "TxCnt", "volume_reported_spot_usd_1d"]
    frames, rep = {}, {}
    for a in assets:
        f = raw_dir / "csv" / f"{a}.csv"
        if not f.exists():
            rep[a] = "missing"
            continue
        d = pd.read_csv(f, usecols=lambda c: c == "time" or c in cols, parse_dates=["time"]).set_index("time")
        d = d[d["PriceUSD"].notna() & (d["PriceUSD"] > 0)] if "PriceUSD" in d else d.iloc[0:0]
        if len(d) < 400:
            rep[a] = f"too short ({len(d)} rows)"
            continue
        gaps = int((d.index.to_series().diff().dt.days.fillna(1) > 1).sum())
        big = int((np.abs(np.diff(np.log(d["PriceUSD"].to_numpy()))) > 1.0).sum())
        rep[a] = {"rows": len(d), "first": str(d.index[0].date()), "last": str(d.index[-1].date()), "gaps": gaps, "moves_over_e": big}
        frames[a] = d
    out_dir.mkdir(parents=True, exist_ok=True)
    panel = pd.concat(frames, axis=1)
    panel.to_pickle(out_dir / "cm_daily.pkl")
    (out_dir / "cm_ingest_report.json").write_text(json.dumps(rep, indent=2))
    return rep


def load_btc(data_dir: Path, tf: str, start: str | None = None, end: str | None = None) -> Bars:
    b = Bars.load(Path(data_dir) / f"btc_{tf}.npz")
    a = 0 if start is None else int(np.searchsorted(b.ts, pd.Timestamp(start, tz="UTC").timestamp()))
    z = len(b) if end is None else int(np.searchsorted(b.ts, pd.Timestamp(end, tz="UTC").timestamp()))
    return b.slice(a, z)


def load_cm(data_dir: Path) -> pd.DataFrame:
    return pd.read_pickle(Path(data_dir) / "cm_daily.pkl")
