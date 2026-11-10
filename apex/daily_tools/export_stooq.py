#!/usr/bin/env python3
"""Download long daily price histories (open, high, low, close, volume) from Stooq's public CSV links.

Purpose: an older, independent sample (before 2016) to test APEX's candidate rules on years the research
never touched. Read-only GET requests, no account, no key. The workflow encrypts the output before it
leaves the runner, like the Alpaca export.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

SYMBOLS = ("SPY QQQ IWM DIA MDY SMH XLK XLF XLE XLV XLI XLY XLP XLU XLB GLD SLV TLT IEF SHY EFA EEM "
           "TQQQ SQQQ UPRO SPXU SSO QLD SOXL SOXS TNA TZA FAS FAZ TECL USD "
           "NVDA AMD AAPL MSFT AMZN GOOGL TSLA META NFLX AVGO INTC TXN QCOM MU").split()


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "export_daily")
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for i, s in enumerate(SYMBOLS):
        url = f"https://stooq.com/q/d/l/?s={s.lower()}.us&i=d"
        txt = ""
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research; daily history download)"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    txt = r.read().decode("utf-8", "replace")
                break
            except Exception as e:                      # noqa: BLE001
                txt = f"ERROR {type(e).__name__}: {e}"
                time.sleep(5 * (attempt + 1))
        lines = txt.strip().splitlines()
        ok = len(lines) > 100 and lines[0].lower().startswith("date")
        meta[s] = {"ok": ok, "rows": len(lines) - 1 if ok else 0, "first": lines[1].split(",")[0] if ok else None,
                   "last": lines[-1].split(",")[0] if ok else None, "head": None if ok else txt[:160]}
        if ok:
            (out / f"{s}.csv").write_text(txt)
        print(f"{i + 1:2d}/{len(SYMBOLS)} {s:6s} {meta[s]}", flush=True)
        time.sleep(1.5)
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    good = sum(1 for m in meta.values() if m["ok"])
    print(f"done: {good} of {len(SYMBOLS)} symbols")
    if good == 0:
        sys.exit("nothing was downloaded")


if __name__ == "__main__":
    main()
