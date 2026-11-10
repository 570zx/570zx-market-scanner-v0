"""Turn the raw public downloads into validated bar files under data/.

Usage: python3 -I scripts/ingest_data.py <bitstamp_repo_dir> <coinmetrics_repo_dir>
Run with -I: the raw directories are untrusted downloads and must never be on sys.path.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from apex.data import ingest_bitstamp, ingest_coinmetrics  # noqa: E402

ASSETS = ["btc", "eth", "doge", "sol", "xrp", "ada", "avax", "link", "ltc", "bch", "xlm", "etc", "uni", "aave", "xtz", "comp", "shib", "dot", "bnb"]

if __name__ == "__main__":
    bs, cm = Path(sys.argv[1]), Path(sys.argv[2])
    out = ROOT / "data"
    print(json.dumps(ingest_bitstamp(bs, out), indent=2))
    print(json.dumps(ingest_coinmetrics(cm, out, ASSETS), indent=1))
