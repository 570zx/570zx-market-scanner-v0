"""Tests for the forward paper test and for the handling of early-close days. All data here is synthetic."""
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
for sub in ("src", "scripts", "tools", "tests"):
    sys.path.insert(0, str(ROOT / sub))

import export_alpaca as X  # noqa: E402
import forward_test as F  # noqa: E402
from apex import equities as E  # noqa: E402
from apex import monitor  # noqa: E402
from test_equities import make_panel  # noqa: E402

C_Q, C_T = float(E.cost_of(["QQQ"])["QQQ"]), float(E.cost_of(["TQQQ"])["TQQQ"])
DAYS = pd.bdate_range("2026-11-10", periods=7)          # 10 (the day before go-live), 11, 12, 13, 16, 17, 18
#        11-10  11-11  11-12  11-13  11-16  11-17  11-18
QQQ = {"o": [100.0, 100.0, 100.0, 98.0, 98.0, 99.0, 97.0],
       "hi": [101.0, 101.0, 100.5, 98.5, 99.5, 99.2, 97.3],
       "lo": [99.0, 99.0, 98.0, 97.0, 97.8, 97.0, 96.0],
       "late": [99.1, 100.5, 98.2, 97.9, 99.0, 97.1, 96.5]}   # weak closes on 11-10, 11-12 and 11-17
TQQQ = {"o": [50.0, 50.0, 50.0, 47.0, 47.0, 49.0, 44.0], "late": [49.0, 50.0, 47.0, 46.5, 49.0, 44.0, 42.5]}


def panel():
    return make_panel(DAYS, {"QQQ": QQQ, "TQQQ": TQQQ})


def test_replay_starts_flat_on_go_live_and_matches_hand_calculation():
    res = F.run(panel(), "2026-11-11")
    assert res["paper_only"] and res["sessions"] == 6 and res["last_session"] == "2026-11-18"
    c, d = res["accounts"]["C"], res["accounts"]["D"]
    # the weak close on 11-10 is before go-live: nothing is carried in
    assert [t["entered"] for t in c["trades"]] == ["2026-11-12"] and [t["exited"] for t in c["trades"]] == ["2026-11-16"]
    assert c["trades"][0]["sessions"] == 2
    assert c["trades"][0]["return"] == pytest.approx(99.0 * (1 - C_Q) / (98.2 * (1 + C_Q)) - 1)
    assert d["trades"][0]["return"] == pytest.approx(49.0 * (1 - C_T) / (47.0 * (1 + C_T)) - 1)
    assert c["closed_trades"] == 1 and c["wins"] == 1 and c["status"] == "RUNNING" and c["next_checkpoint"] == 30
    assert c["open_position"]["entered"] == "2026-11-17" and c["open_position"]["sessions_held"] == 1
    assert c["open_position"]["return_so_far"] == pytest.approx(96.5 * (1 - C_Q) / (97.1 * (1 + C_Q)) - 1)
    assert not c["bought_last_session"] and not c["sold_last_session"]
    assert res["last_signal"]["is_a_weak_close"] is False and res["last_signal"]["position_in_range"] == pytest.approx(0.5 / 1.3)
    # equity: one closed trade, then the open one marked at the last 15:55 (before selling costs)
    assert c["equity_change"] == pytest.approx((99.0 * (1 - C_Q) / (98.2 * (1 + C_Q))) * (96.5 / (97.1 * (1 + C_Q))) - 1)
    assert c["hold_qqq_change"] == pytest.approx(96.5 / 100.5 - 1) and d["hold_vehicle_change"] == pytest.approx(42.5 / 50.0 - 1)
    text = F.markdown(res)
    assert "Paper only" in text and "Account D" in text and "| 2026-11-12 | 2026-11-16 | 2 |" in text


def test_a_session_without_its_decision_price_is_not_used():
    p = panel()
    p.f["p955"].loc[DAYS[-1], "QQQ"] = np.nan              # the job ran before 15:55: only the latest trade so far exists
    p.f["t_last"].loc[DAYS[-1], "QQQ"] = 900.0
    p = E.finish_panel(p)
    assert np.isfinite(p["late"]["QQQ"].iloc[-1])           # the panel still shows a price for the day ...
    q = F.complete(p)
    assert q.dates[-1] == DAYS[-2]                          # ... but the forward test does not count the day
    assert F.complete(panel()).dates[-1] == DAYS[-1]
    assert F.run(q, "2026-11-11")["last_session"] == "2026-11-17"


def test_no_session_yet():
    res = F.run(panel(), "2027-01-04")
    assert res["sessions"] == 0 and res["accounts"] == {}
    assert "No complete session" in F.markdown(res)


def test_a_changed_published_trade_raises_the_alarm():
    first = F.run(panel(), "2026-11-11")
    again = F.run(panel(), "2026-11-11", previous=first)
    assert again["accounts"]["C"]["checks"]["history"] == {"published_before": 1, "changed": [], "ok": True}
    tampered = {"accounts": {"C": {"trades": [dict(first["accounts"]["C"]["trades"][0], **{"return": 0.05})]}, "D": {"trades": [{"entered": "2026-11-11", "exited": "2026-11-12", "return": 0.01}]}}}
    res = F.run(panel(), "2026-11-11", previous=tampered)
    assert res["accounts"]["C"]["status"] == "ALARM: a published trade has changed"
    assert res["accounts"]["D"]["status"] == "ALARM: a published trade has changed"
    assert "now different" in F.markdown(res)


def test_a_drop_beyond_the_backtest_raises_the_alarm():
    t = dict(TQQQ, late=[49.0, 50.0, 47.0, 40.0, 33.0, 28.0, 27.0])        # bought at 47, down 40% and more
    res = F.run(make_panel(DAYS, {"QQQ": dict(QQQ, late=[99.1, 100.5, 98.2, 97.9, 97.9, 97.9, 97.9]), "TQQQ": t}), "2026-11-11")
    assert res["accounts"]["D"]["status"].startswith("ALARM: the largest drop")
    assert res["accounts"]["C"]["status"] == "RUNNING"


def cycles(n: int, win: bool):
    """n round trips. A winner: a weak close, then a bounce. A loser: a weak close, then five lower sessions."""
    q = {"o": [], "hi": [], "lo": [], "late": []}
    for _ in range(n):
        steps = [(100.0, 100.5, 98.0, 98.2)] + ([(98.5, 99.6, 98.4, 99.5)] if win else [(98.0, 98.3, 97.9, 98.15)] * 5)
        for o, hi, lo, late in steps:
            for k, v in zip(("o", "hi", "lo", "late"), (o, hi, lo, late)):
                q[k].append(v)
    days = pd.bdate_range("2027-01-04", periods=len(q["o"]))
    return make_panel(days, {"QQQ": q, "TQQQ": {"o": q["o"], "late": q["late"]}})


def test_checkpoint_is_judged_on_the_trades_up_to_it():
    res = F.run(cycles(33, win=True), "2027-01-04")
    c = res["accounts"]["C"]
    assert c["closed_trades"] == 33 and c["wins"] == 33
    assert c["status"] == "RUNNING: on track at the 30-trade checkpoint" and c["next_checkpoint"] == 100
    assert c["checkpoints"]["30"] == {"reached": True, "avg_trade": pytest.approx(99.5 * (1 - C_Q) / (98.2 * (1 + C_Q)) - 1), "on_track": True}
    assert c["checkpoints"]["100"]["reached"] is False
    assert c["checks"]["winners"]["status"] == "OK" and c["checks"]["average_trade"]["status"] == "OK"


def test_too_few_winners_raises_the_alarm():
    res = F.run(cycles(21, win=False), "2027-01-04")
    c = res["accounts"]["C"]
    assert c["closed_trades"] == 21 and c["wins"] == 0 and c["trades"][0]["sessions"] == 5
    assert c["max_drawdown"] < 0.24                                              # small losses: the drawdown alarm stays quiet
    assert c["status"] == "ALARM: fewer winners than the backtest allows"
    assert F.run(cycles(19, win=False), "2027-01-04")["accounts"]["C"]["status"] == "RUNNING"      # under 20 trades: no verdict


def test_mean_check():
    assert monitor.mean_check(0.0, 0, 0.004, 0.025)["status"] == "TOO_EARLY"
    assert monitor.mean_check(-0.02, 10, 0.004, 0.025)["status"] == "TOO_EARLY"         # fewer than 20 trades: no verdict
    assert monitor.mean_check(0.004, 40, 0.004, 0.025)["status"] == "OK"
    low = monitor.mean_check(-0.006, 40, 0.004, 0.025)                                   # 2.5 standard errors below
    assert low["status"] == "DEGRADED" and low["p_this_low_or_lower"] == pytest.approx(0.0057, abs=0.001)


def test_early_close_days_follow_the_rule():
    known = ["2016-11-25", "2017-07-03", "2017-11-24", "2018-07-03", "2018-11-23", "2018-12-24", "2019-07-03", "2019-11-29", "2019-12-24", "2020-11-27", "2020-12-24",
             "2021-11-26", "2022-11-25", "2023-07-03", "2023-11-24", "2024-07-03", "2024-11-29", "2024-12-24", "2025-07-03", "2025-11-28", "2025-12-24"]
    assert [str(d.date()) for d in E.early_closes(2016, 2025)] == known       # the days found in the data, 2016-2025
    assert [str(d.date()) for d in E.early_closes(2026, 2026)] == ["2026-11-27", "2026-12-24"]     # 2026-07-03 is a Friday: the market is shut


# ---- the download path, with a stand-in for the data vendor ----
def bars_for(day: str, price_at, last_minute: int = 955) -> list[dict]:
    """5-minute bars from 09:30 New York time (EST: UTC-5) to `last_minute`; price_at(m) -> (open, high, low, close)."""
    out = []
    for m in range(570, last_minute + 1, 5):
        o, h, l, c = price_at(m)
        t = pd.Timestamp(day) + pd.Timedelta(minutes=m + 300)
        out.append({"t": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "o": o, "h": h, "l": l, "c": c, "v": 1000.0, "vw": (h + l) / 2})
    return out


def flat(px, hi=None, lo=None, at=None):
    """Flat at px, except: `at` = {minute: open} overrides, and one early bar that sets the day's high and low."""
    def f(m):
        if m == 600:
            return px, hi or px, lo or px, px
        o = (at or {}).get(m, px)
        return o, o, o, o
    return f


class FakeVendor:
    def __init__(self, last_day_until: int = 955):
        half = lambda scale: (lambda m: (95.0 * scale,) * 4 if m >= 800 else flat(100.0 * scale, 101.0 * scale, 99.0 * scale, {775: 99.1 * scale, 780: 99.6 * scale})(m))
        self.days = {
            "2026-11-25": lambda s: flat(100.0 * s, 101.0 * s, 99.0 * s, {955: 100.5 * s}),      # 75% of the range: no signal
            "2026-11-27": half,                                                                  # 13:00 close; after-hours trades fall to 95
            "2026-11-30": lambda s: flat(100.0 * s, 100.5 * s, 99.5 * s, {955: 100.2 * s}),      # above the 99.1 paid: sell
            "2026-12-01": lambda s: flat(100.0 * s, 101.0 * s, 99.0 * s, {955: 100.0 * s}),
        }
        self.last_day_until = last_day_until

    def bars(self, symbols, timeframe, start, end):
        assert timeframe == "5Min" and len(symbols) == 1
        scale = 1.0 if symbols[0] == "QQQ" else 0.5
        rows = []
        for i, (day, make) in enumerate(self.days.items()):
            rows += bars_for(day, make(scale), self.last_day_until if i == len(self.days) - 1 else 955)
        yield {symbols[0]: rows}


def test_download_path_uses_1255_on_an_early_close_and_ignores_later_trades(tmp_path):
    p = F.fetch_panel(tmp_path, "2026-11-20", client=FakeVendor(), now=datetime(2026, 12, 1, 21, 40, tzinfo=timezone.utc))
    assert [str(d.date()) for d in p.dates] == ["2026-11-25", "2026-11-27", "2026-11-30", "2026-12-01"]
    assert bool(p.cal["half"].loc["2026-11-27"]) and "p775" in p.f
    assert p["late"]["QQQ"].loc["2026-11-27"] == pytest.approx(99.1)        # the 12:55 price, not the 13:00 print (99.6)
    assert p["lo_late"]["QQQ"].loc["2026-11-27"] == pytest.approx(99.0)     # the after-hours fall to 95 had not happened yet
    assert p["ibs"]["QQQ"].loc["2026-11-27"] == pytest.approx(0.05)
    assert p["late"]["QQQ"].loc["2026-11-25"] == pytest.approx(100.5)       # a normal day: the 15:55 price
    res = F.run(F.complete(p), "2026-11-25")
    c, d = res["accounts"]["C"], res["accounts"]["D"]
    assert [(t["entered"], t["exited"]) for t in c["trades"]] == [("2026-11-27", "2026-11-30")]
    assert c["trades"][0]["return"] == pytest.approx(100.2 * (1 - C_Q) / (99.1 * (1 + C_Q)) - 1)
    assert d["trades"][0]["return"] == pytest.approx(50.1 * (1 - C_T) / (49.55 * (1 + C_T)) - 1)
    assert res["sessions_with_missing_data"] == []


def test_download_path_waits_for_the_1555_price(tmp_path):
    p = F.fetch_panel(tmp_path, "2026-11-20", client=FakeVendor(last_day_until=900), now=datetime(2026, 12, 1, 20, 20, tzinfo=timezone.utc))
    assert str(p.dates[-1].date()) == "2026-12-01" and str(F.complete(p).dates[-1].date()) == "2026-11-30"


def test_exporter_fields_for_the_early_close_moment():
    rows = bars_for("2026-11-27", lambda m: (95.0,) * 4 if m >= 800 else flat(100.0, 101.0, 99.0, {775: 99.1, 780: 99.6})(m))
    ts, o, h, l, c, v, vw = X.to_arrays(rows)
    dates, x = X.aggregate_sessions(ts, o, h, l, c, v, vw)
    r = dict(zip(X.FIELDS, x[0]))
    assert list(dates) == [20261127]
    assert r["p775"] == pytest.approx(99.1) and r["p780"] == pytest.approx(99.6)
    assert r["h775"] == pytest.approx(101.0) and r["l775"] == pytest.approx(99.0)
    assert r["l930"] == pytest.approx(95.0)                                # the range to 15:30 does include the later trades
