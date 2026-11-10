"""Append-only experiment ledger. Every experiment is written, including the ones that fail.
A record is never edited or deleted; a re-run appends a new record with a new run id."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path


def _clean(x):
    import numpy as np
    if isinstance(x, dict):
        return {str(k): _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, (np.floating, float)):
        f = float(x)
        return None if f != f or f in (float("inf"), float("-inf")) else round(f, 6)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, np.ndarray):
        return None
    return x


class Ledger:
    def __init__(self, path: Path, run_id: str | None = None, mode: str = "full"):
        self.mode = mode
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        self.records: list[dict] = []

    def record(self, hypothesis_id: str, statement: str, kill_rule: str, verdict: str, evidence: dict,
               family: str, trials: int = 1, notes: str = "") -> dict:
        rec = _clean({"run_id": self.run_id, "mode": self.mode, "id": hypothesis_id, "family": family, "statement": statement,
                      "kill_rule": kill_rule, "verdict": verdict, "trials": trials, "evidence": evidence, "notes": notes})
        rec["hash"] = hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).hexdigest()[:16]
        with self.path.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        self.records.append(rec)
        return rec


def data_fingerprint(paths: list[Path]) -> dict:
    out = {}
    for p in paths:
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        out[Path(p).name] = h.hexdigest()[:16]
    return out
