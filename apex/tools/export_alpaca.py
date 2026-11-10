#!/usr/bin/env python3
"""Export market data from Alpaca for APEX research. Read-only: every request is a GET for bars.

Runs in GitHub Actions, where the repository's Alpaca keys live. The output is encrypted by the
workflow before it leaves the runner, because the repository is public and vendor market data
must not be republished.

Writes into --out:
  daily.npz      per symbol: <SYM>__date (int32 yyyymmdd), <SYM>__x (float64 [n, 6]: o h l c v vwap)
  sessions.npz   per symbol: <SYM>__date, <SYM>__x (float64 [n, len(FIELDS)]) built from 5-minute bars
  bars5_<SYM>.npz  full 5-minute bars (incl. extended hours) for the CORE symbols
  meta.json      field names, row counts, request statistics
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BASE = "https://data.alpaca.markets"
RPM = 150                      # the free plan allows 200 a minute; stay under it

# Prices sampled at these Eastern times (minutes after midnight): the open of the first regular bar at or after T.
SAMPLE_TIMES = [575, 585, 600, 630, 660, 720, 780, 840, 900, 930, 945, 950, 955]
RUN_HL_TIMES = [600, 930, 945, 955]            # running high/low of regular bars that START before T
FIELDS = (["o", "h", "l", "c", "v", "vwap", "n_reg", "t_first", "t_last", "pc5", "h_pre5", "l_pre5", "v_pre5"]
          + [f"p{t}" for t in SAMPLE_TIMES]
          + [f"h{t}" for t in RUN_HL_TIMES] + [f"l{t}" for t in RUN_HL_TIMES] + [f"v{t}" for t in RUN_HL_TIMES]
          + ["or5_h", "or5_l", "or15_h", "or15_l", "or30_h", "or30_l",
             "pm_first", "pm_last", "pm_h", "pm_l", "pm_v", "ah_last", "ah_h", "ah_l", "ah_v"])


def ny_offset(ts: np.ndarray) -> np.ndarray:
    """UTC offset (seconds) of New York for each epoch second. US rule since 2007:
    daylight time from the second Sunday of March 07:00 UTC to the first Sunday of November 06:00 UTC."""
    years = (ts.astype("datetime64[s]").astype("datetime64[Y]").astype(int) + 1970)
    off = np.full(len(ts), -5 * 3600, dtype=np.int64)
    for y in np.unique(years):
        mar1 = datetime(int(y), 3, 1, tzinfo=timezone.utc)
        second_sun = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7)
        nov1 = datetime(int(y), 11, 1, tzinfo=timezone.utc)
        first_sun = nov1 + timedelta(days=(6 - nov1.weekday()) % 7)
        a = int(second_sun.timestamp()) + 7 * 3600
        b = int(first_sun.timestamp()) + 6 * 3600
        off[(years == y) & (ts >= a) & (ts < b)] = -4 * 3600
    return off


def aggregate_sessions(ts, o, h, l, c, v, vw):
    """One row per trading day from 5-minute bars (bar time = bar start, UTC epoch seconds)."""
    ts = np.asarray(ts, np.int64)
    loc = ts + ny_offset(ts)
    day = loc // 86400
    mod = (loc % 86400) // 60
    cuts = np.concatenate([[0], np.flatnonzero(np.diff(day)) + 1, [len(ts)]])
    dates, rows = [], []
    nan = float("nan")
    for a, b in zip(cuts[:-1], cuts[1:]):
        m = mod[a:b]
        reg = np.flatnonzero((m >= 570) & (m < 960)) + a
        if len(reg) == 0:
            continue
        mr = mod[reg]
        r = dict.fromkeys(FIELDS, nan)
        r["o"], r["h"], r["l"], r["c"] = o[reg[0]], h[reg].max(), l[reg].min(), c[reg[-1]]
        r["v"] = v[reg].sum()
        r["vwap"] = float((vw[reg] * v[reg]).sum() / r["v"]) if r["v"] > 0 else nan
        r["n_reg"], r["t_first"], r["t_last"] = len(reg), mr[0], mr[-1]
        r["pc5"] = o[reg[-1]]
        if len(reg) > 1:
            r["h_pre5"], r["l_pre5"], r["v_pre5"] = h[reg[:-1]].max(), l[reg[:-1]].min(), v[reg[:-1]].sum()
        for t in SAMPLE_TIMES:
            k = np.searchsorted(mr, t)
            if k < len(reg) and mr[k] - t <= 10:
                r[f"p{t}"] = o[reg[k]]
        for t in RUN_HL_TIMES:
            k = np.searchsorted(mr, t)
            if k > 0:
                r[f"h{t}"], r[f"l{t}"], r[f"v{t}"] = h[reg[:k]].max(), l[reg[:k]].min(), v[reg[:k]].sum()
        for name, lim in (("or5", 575), ("or15", 585), ("or30", 600)):
            k = np.searchsorted(mr, lim)
            if k > 0:
                r[f"{name}_h"], r[f"{name}_l"] = h[reg[:k]].max(), l[reg[:k]].min()
        pm = np.flatnonzero((m >= 240) & (m < 570)) + a
        if len(pm):
            r["pm_first"], r["pm_last"], r["pm_h"], r["pm_l"], r["pm_v"] = o[pm[0]], c[pm[-1]], h[pm].max(), l[pm].min(), v[pm].sum()
        ah = np.flatnonzero((m >= 960) & (m < 1200)) + a
        if len(ah):
            r["ah_last"], r["ah_h"], r["ah_l"], r["ah_v"] = c[ah[-1]], h[ah].max(), l[ah].min(), v[ah].sum()
        d = datetime.fromtimestamp(int(day[a]) * 86400, tz=timezone.utc)
        dates.append(d.year * 10000 + d.month * 100 + d.day)
        rows.append([r[f] for f in FIELDS])
    return np.array(dates, dtype=np.int32), np.array(rows, dtype=np.float64).reshape(len(rows), len(FIELDS))


class Client:
    def __init__(self, key: str, secret: str, rpm: int = RPM):
        self.headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "accept": "application/json"}
        self.interval, self.lock, self.next_slot = 60.0 / rpm, threading.Lock(), 0.0
        self.requests = self.retries = 0

    def _slot(self) -> None:
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next_slot)
            self.next_slot = at + self.interval
        if at > now:
            time.sleep(at - now)

    def get(self, path: str, params: dict) -> dict:
        url = BASE + path + "?" + urllib.parse.urlencode(params)
        for attempt in range(8):
            self._slot()
            self.requests += 1
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=self.headers), timeout=90) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")[:300]
                if e.code == 429 or e.code >= 500:
                    self.retries += 1
                    time.sleep(min(90, 3 * 2 ** attempt))
                    continue
                raise RuntimeError(f"HTTP {e.code} on {path} ({params.get('symbols', '')[:40]} {params.get('timeframe')}): {body}") from None
            except Exception as e:                       # network trouble
                self.retries += 1
                if attempt == 7:
                    raise RuntimeError(f"network error on {path}: {type(e).__name__}") from None
                time.sleep(min(90, 3 * 2 ** attempt))
        raise RuntimeError(f"gave up on {path}")

    def bars(self, symbols: list[str], timeframe: str, start: str, end: str):
        """Yield pages {symbol: [bar, ...]}."""
        token = None
        while True:
            p = {"symbols": ",".join(symbols), "timeframe": timeframe, "start": start, "end": end, "adjustment": "all",
                 "feed": "sip", "limit": 10000, "sort": "asc"}
            if token:
                p["page_token"] = token
            page = self.get("/v2/stocks/bars", p)
            yield page.get("bars") or {}
            token = page.get("next_page_token")
            if not token:
                return


def to_arrays(rows: list[dict]):
    ts = np.array([b["t"][:19] for b in rows], dtype="datetime64[s]").astype(np.int64)
    f = lambda k: np.array([b.get(k, np.nan) for b in rows], dtype=np.float64)
    return ts, f("o"), f("h"), f("l"), f("c"), f("v"), f("vw")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="export")
    ap.add_argument("--symbols", default=str(Path(__file__).with_name("export_symbols.json")))
    ap.add_argument("--start", default="2015-06-01")
    ap.add_argument("--workers", type=int, default=5)
    args = ap.parse_args()
    cfg = json.loads(Path(args.symbols).read_text())
    daily_syms = sorted(set(cfg["daily"]) | set(cfg["sessions"]) | set(cfg["core"]))
    session_syms = sorted(set(cfg["sessions"]) | set(cfg["core"]))
    core = set(cfg["core"])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cl = Client(os.environ["ALPACA_API_KEY"], os.environ["ALPACA_API_SECRET"])
    start = args.start + "T00:00:00Z"
    end = (datetime.now(timezone.utc) - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    t0 = time.time()
    log = lambda m: print(f"[{time.time() - t0:6.0f}s] {m}", flush=True)
    meta = {"start": start, "end": end, "fields": FIELDS, "daily": {}, "sessions": {}, "core": {}, "errors": {}}

    # ---- daily bars ----
    daily: dict[str, list] = {}
    import re
    for i in range(0, len(daily_syms), 40):
        chunk = daily_syms[i:i + 40]
        for _ in range(8):                               # drop a symbol the data API rejects and try the rest again
            got: dict[str, list] = {}
            try:
                for page in cl.bars(chunk, "1Day", start, end):
                    for s, rows in page.items():
                        got.setdefault(s, []).extend(rows)
                daily.update(got)
                break
            except Exception as e:
                bad = re.search(r"invalid symbol: ?([A-Za-z0-9.\-/]+)", str(e))
                if bad and bad.group(1) in chunk:
                    meta["errors"][f"daily:{bad.group(1)}"] = "invalid symbol"
                    chunk = [x for x in chunk if x != bad.group(1)]
                    continue
                meta["errors"][f"daily:{chunk[0]}..{chunk[-1]}"] = str(e)[:300]
                log(f"daily chunk failed: {str(e)[:200]}")
                break
    arrays = {}
    for s, rows in daily.items():
        ts, o, h, l, c, v, vw = to_arrays(rows)
        d = ts.astype("datetime64[s]").astype("datetime64[D]").astype(object)
        arrays[f"{s}__date"] = np.array([x.year * 10000 + x.month * 100 + x.day for x in d], dtype=np.int32)
        arrays[f"{s}__x"] = np.column_stack([o, h, l, c, v, vw])
        meta["daily"][s] = len(rows)
    np.savez_compressed(out / "daily.npz", **arrays)
    log(f"daily: {len(daily)} of {len(daily_syms)} symbols, {sum(meta['daily'].values())} bars, {cl.requests} requests")
    del daily, arrays

    # ---- 5-minute bars, one symbol per worker ----
    sess: dict[str, tuple] = {}
    lock = threading.Lock()
    todo = list(session_syms)

    def work() -> None:
        while True:
            with lock:
                if not todo:
                    return
                s = todo.pop(0)
            try:
                parts = []
                for page in cl.bars([s], "5Min", start, end):
                    rows = page.get(s) or []
                    if rows:
                        parts.append(to_arrays(rows))
                if not parts:
                    meta["errors"][f"5min:{s}"] = "no bars"
                    continue
                ts, o, h, l, c, v, vw = (np.concatenate(x) for x in zip(*parts))
                dates, x = aggregate_sessions(ts, o, h, l, c, v, vw)
                with lock:
                    sess[s] = (dates, x)
                    meta["sessions"][s] = int(len(dates))
                if s in core:
                    np.savez_compressed(out / f"bars5_{s}.npz", ts=ts, o=o.astype(np.float32), h=h.astype(np.float32), l=l.astype(np.float32),
                                        c=c.astype(np.float32), v=v.astype(np.float32), vw=vw.astype(np.float32))
                    meta["core"][s] = int(len(ts))
                log(f"5min {s}: {len(ts)} bars, {len(dates)} days ({len(todo)} symbols left, {cl.requests} requests, {cl.retries} retries)")
            except Exception as e:
                meta["errors"][f"5min:{s}"] = str(e)[:300]
                log(f"5min {s} failed: {str(e)[:200]}")

    threads = [threading.Thread(target=work) for _ in range(args.workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    np.savez_compressed(out / "sessions.npz", **{f"{s}__date": d for s, (d, _) in sess.items()}, **{f"{s}__x": x for s, (_, x) in sess.items()})
    meta["requests"], meta["retries"], meta["seconds"] = cl.requests, cl.retries, round(time.time() - t0)
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    log(f"done: {len(sess)} session symbols, {len(meta['core'])} core, {len(meta['errors'])} errors")
    if not sess:
        sys.exit("no session data was exported")


if __name__ == "__main__":
    main()
