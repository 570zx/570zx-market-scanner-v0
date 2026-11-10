"""Tests for the equity/ETF engines. All data here is synthetic."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from apex import equities as E  # noqa: E402
from apex import intraday as I  # noqa: E402

FIELDS = ["o", "h", "l", "c", "v", "t_last", "p780", "p600", "p930", "p955", "h930", "l930", "h955", "l955", "v955", "pm_last",
          "p840", "p900", "p945", "p950", "h945", "l945", "v945"]


def make_panel(dates, data: dict) -> E.Panel:
    """data: {symbol: {"o": [...], "late": [...], "hi": [...], "lo": [...]}}; other fields are filled consistently."""
    dates = pd.DatetimeIndex(dates)
    f = {k: pd.DataFrame(index=dates, columns=list(data), dtype=float) for k in FIELDS}
    for s, d in data.items():
        o, late = np.asarray(d["o"], float), np.asarray(d["late"], float)
        hi = np.asarray(d.get("hi", np.maximum(o, late)), float)
        lo = np.asarray(d.get("lo", np.minimum(o, late)), float)
        f["o"][s], f["p955"][s], f["c"][s], f["p780"][s] = o, late, late, late
        f["h"][s], f["h955"][s], f["h930"][s], f["h945"][s] = hi, hi, hi, hi
        f["l"][s], f["l955"][s], f["l930"][s], f["l945"][s] = lo, lo, lo, lo
        f["t_last"][s], f["v"][s], f["v955"][s], f["v945"][s] = 955.0, 1e6, 1e6, 1e6
        for k in ("p600", "p930", "p840", "p900", "p945", "p950", "pm_last"):
            f[k][s] = d.get(k, o)
    return E.finish_panel(E.Panel(dates, list(data), f, E.calendar(dates)))


def bdays(n, start="2021-03-01"):
    return pd.bdate_range(start, periods=n)


def test_run_weights_overnight_only_matches_hand_calculation():
    #          day0          day1            day2
    o = [100.0, 102.0, 101.0]
    late = [101.0, 103.0, 100.0]
    p = make_panel(bdays(3), {"SPY": {"o": o, "late": late}})
    c = float(E.cost_of(["SPY"])["SPY"])
    wl = pd.DataFrame({"SPY": [1.0, 1.0, 0.0]}, index=p.dates)            # buy at LATE of day 0 and day 1
    wo = pd.DataFrame({"SPY": [0.0, 0.0, 0.0]}, index=p.dates)            # always sell at the open
    r = E.run_weights(p, wl, wo)
    assert r["ret"][0] == pytest.approx(-c)                                # day 0: only the cost of buying at LATE
    assert r["ret"][1] == pytest.approx((102 / 101) * (1 - c) * (1 - c) - 1)   # overnight gain, sell at open, buy again at LATE
    assert r["ret"][2] == pytest.approx((101 / 103) * (1 - c) - 1)
    assert len(r["trade_ret"]) == 2
    assert r["trade_ret"][0] == pytest.approx(102 / 101 * (1 - c) ** 2 - 1)
    assert list(r["trade_entry"]) == [0, 1]


def test_run_weights_hold_through_has_no_extra_costs():
    o, late = [100.0, 102.0, 101.0, 104.0], [101.0, 103.0, 100.0, 105.0]
    p = make_panel(bdays(4), {"SPY": {"o": o, "late": late}})
    c = float(E.cost_of(["SPY"])["SPY"])
    r = E.run_weights(p, pd.DataFrame({"SPY": [1.0, 1.0, 1.0, 0.0]}, index=p.dates), None)
    total = np.prod(1 + r["ret"])
    assert total == pytest.approx(105 / 101 * (1 - c) ** 2)                # one buy at day-0 LATE, one sell at day-3 LATE
    assert len(r["trade_ret"]) == 1 and r["trade_ret"][0] == pytest.approx(105 / 101 * (1 - c) ** 2 - 1)


def test_slots_strength_exit_and_costs():
    # day 1 closes weak -> buy at LATE(1)=95. Day 2 LATE=97 is below day 1's high (101) -> hold. Day 3 LATE=103 > day 2's high (98) -> sell.
    o = [100, 100, 96, 99, 103]
    late = [100, 95, 97, 103, 103]
    hi = [100.5, 101, 98, 103.5, 104]
    lo = [99.5, 94.5, 95.5, 98.5, 102.5]
    p = make_panel(bdays(5), {"QQQ": {"o": o, "late": late, "hi": hi, "lo": lo}})
    c = float(E.cost_of(["QQQ"])["QQQ"])
    entry = pd.DataFrame({"QQQ": [False, True, False, False, False]}, index=p.dates)
    r = E.simulate_slots(p, entry, p["ibs"][["QQQ"]], 1, "strength", 5)
    assert list(r["trade_entry"]) == [1] and list(r["trade_exit"]) == [3]
    assert r["trade_ret"][0] == pytest.approx(103 * (1 - c) / (95 * (1 + c)) - 1)
    assert np.prod(1 + r["ret"]) == pytest.approx(103 * (1 - c) / (95 * (1 + c)))


def test_slots_max_hold_and_overnight_mode():
    o = [100, 100, 99, 98, 97, 96, 95, 94]
    late = [100, 99, 98, 97, 96, 95, 94, 93]
    p = make_panel(bdays(8), {"QQQ": {"o": o, "late": late, "hi": [x + 5 for x in late], "lo": [x - 1 for x in late]}})
    entry = pd.DataFrame({"QQQ": [False, True] + [False] * 6}, index=p.dates)
    r = E.simulate_slots(p, entry, p["ibs"][["QQQ"]], 1, "strength", 3)
    assert list(r["trade_exit"]) == [4]                                    # never above yesterday's high: out after 3 sessions
    r = E.simulate_slots(p, entry, p["ibs"][["QQQ"]], 1, "open")
    assert list(r["trade_exit"]) == [2]                                    # sold at the next open
    c = float(E.cost_of(["QQQ"])["QQQ"])
    assert r["trade_ret"][0] == pytest.approx(99 * (1 - c) / (99 * (1 + c)) - 1)


def test_truncation_test_catches_a_peek_at_tomorrow():
    rng = np.random.default_rng(0)
    n = 300
    late = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    o = late * (1 + rng.normal(0, 0.003, n))
    p = make_panel(bdays(n), {"SPY": {"o": o, "late": late}})

    def honest(pp):
        sig = pp["late"]["SPY"] > E.sma(pp["late"]["SPY"], 10)
        return {"x": E.run_weights(pp, pd.DataFrame({"SPY": sig.astype(float)}), None)}

    def cheat(pp):
        sig = pp["late"]["SPY"].shift(-1) > pp["late"]["SPY"]             # knows tomorrow
        return {"x": E.run_weights(pp, pd.DataFrame({"SPY": sig.fillna(False).astype(float)}), None)}

    cuts = [str(p.dates[i].date()) for i in (120, 150, 180, 200, 230, 260)]
    assert E.truncation_test(honest, p, cuts)["passed"]
    assert not E.truncation_test(cheat, p, cuts)["passed"]


def test_leg_and_calendar():
    dates = pd.DatetimeIndex(["2024-11-25", "2024-11-26", "2024-11-27", "2024-11-29", "2024-12-02", "2024-12-03"])
    p = make_panel(dates, {"SPY": {"o": [100] * 6, "late": [101, 102, 103, 104, 105, 106], "p930": [100.5] * 6}})
    c = float(E.cost_of(["SPY"])["SPY"])
    x = E.leg(p, "SPY", "p930", "late", [True, False, True, True, False, False])
    assert x[0] == pytest.approx(101 / 100.5 * (1 - c) ** 2 - 1) and x[1] == 0
    assert x[3] == 0                                                        # 2024-11-29 closed at 13:00: there is no 15:30 price
    cal = p.cal
    assert bool(cal.loc["2024-11-27", "pre_holiday"]) and not bool(cal.loc["2024-11-26", "pre_holiday"])
    assert cal.loc["2024-11-29", "tdom_rev"] == -1 and cal.loc["2024-12-02", "tdom"] == 1
    assert bool(cal.loc["2024-11-29", "half"])
    assert np.isnan(cal.loc["2024-12-02", "tdom_rev"])                      # the last month in the data is incomplete


def _grid(n_days=30, seed=1, start="2024-11-01"):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n_days)
    c = np.empty((n_days, I.SLOTS))
    px = 100.0
    for d in range(n_days):
        steps = rng.normal(0, 0.001, I.SLOTS)
        c[d] = px * np.cumprod(1 + steps)
        px = c[d, -1] * (1 + rng.normal(0, 0.003))
    o = np.concatenate([c[:, :1] * (1 + rng.normal(0, 0.0005, (n_days, 1))), c[:, :-1]], axis=1)
    h, l = np.maximum(o, c) * 1.0003, np.minimum(o, c) * 0.9997
    v = np.full_like(c, 1e5)
    return I.Grid(dates, o, h, l, c, v, (o + c) / 2)


def test_intraday_states_do_not_use_later_bars():
    g = _grid()
    for fn in (lambda x: I.noise_area_state(x, lookback=5), lambda x: I.orb_state(x, 3)):
        base = fn(g)
        g2 = _grid()
        d, k = 20, 40
        for a in (g2.o, g2.h, g2.l, g2.c):
            a[d, k + 1:] *= 1.05                                           # change everything after slot k on day d
        g2 = I.Grid(g2.dates, g2.o, g2.h, g2.l, g2.c, g2.v, g2.vw)
        alt = fn(g2)
        assert np.array_equal(base[:d], alt[:d])
        assert np.array_equal(base[d, :k + 1], alt[d, :k + 1])


def test_run_states_fills_at_next_open_and_flattens_before_the_close():
    g = _grid()
    st = np.zeros((len(g.dates), I.SLOTS), dtype=np.int8)
    d = 10
    st[d, 5:] = 1                                                          # long from the close of slot 5 onward
    r = I.run_states(st, g, None, "TQQQ", None)
    c = float(E.cost_of(["TQQQ"])["TQQQ"])
    last = g.last[d]
    assert r["ret"][d] == pytest.approx(g.px[d, last] / g.px[d, 6] * (1 - c) ** 2 - 1)   # in at the open of slot 6, out at the open of the last bar
    assert np.count_nonzero(r["ret"]) == 1
    early = int(np.flatnonzero(g.dates.isin(E.EARLY_CLOSE))[0])           # 2024-11-29 closes at 13:00
    assert g.last[early] == 41 and np.isnan(g.o[early, 42:]).all()
    st[early, 5:] = 1
    r = I.run_states(st, g, None, "TQQQ", None)
    assert r["ret"][early] == pytest.approx(g.px[early, 41] / g.px[early, 6] * (1 - c) ** 2 - 1)


def test_run_states_switch_to_inverse_fund_pays_both_costs():
    g, gi = _grid(seed=1), _grid(seed=2)
    st = np.zeros((len(g.dates), I.SLOTS), dtype=np.int8)
    d = 12
    st[d, 5:20], st[d, 20:] = 1, -1
    r = I.run_states(st, g, gi, "TQQQ", "SQQQ")
    c = float(E.cost_of(["TQQQ"])["TQQQ"])
    a = g.px[d, 21] / g.px[d, 6] * (1 - c) ** 2 - 1
    b = gi.px[d, g.last[d]] / gi.px[d, 21] * (1 - c) ** 2 - 1
    assert r["ret"][d] == pytest.approx((1 + a) * (1 + b) - 1)
    assert len(r["trade_ret"]) == 2


def test_stack_weak_close_first_then_night():
    # QQQ closes weak on day 1 -> buy TQQQ at LATE(1). Day 2 shows a profit -> sell. No signal on day 2, SMH in an "uptrend" (sma_n=2) -> SOXL for the night, sold at day 3's open.
    dates = bdays(6)
    q = {"o": [100, 100, 96, 99, 100, 101], "late": [100, 95, 97, 99.5, 100.5, 101.5], "hi": [100.5, 101, 97.2, 99.6, 100.6, 101.6], "lo": [99.5, 94.9, 95.5, 98.5, 99.5, 100.5]}
    t = {"o": [50, 50, 44, 47, 48, 49], "late": [50, 43, 46, 47.5, 48.5, 49.5]}
    s = {"o": [20, 20, 21, 23, 23.5, 24], "late": [20, 21, 22, 22.5, 23.2, 24.2]}
    m = {"o": [200, 201, 203, 205, 207, 209], "late": [200, 202, 204, 206, 208, 210]}
    p = make_panel(dates, {"QQQ": q, "TQQQ": t, "SOXL": s, "SMH": m})
    ct, cs = float(E.cost_of(["TQQQ"])["TQQQ"]), float(E.cost_of(["SOXL"])["SOXL"])
    r = E.simulate_stack(p, "QQQ", "TQQQ", "SOXL", "SMH", sma_n=2)
    assert list(r["held"][:3]) == [0, 1, 2]                                  # nothing, weak-close position, then a night position
    assert list(r["mr_trade_entry"]) == [1]
    assert r["mr_trade_ret"][0] == pytest.approx(46 * (1 - ct) / (43 * (1 + ct)) - 1)
    assert r["night_trade_entry"][0] == 2
    assert r["night_trade_ret"][0] == pytest.approx(23 * (1 - cs) / (22 * (1 + cs)) - 1)
    # the account compounds one trade into the next
    first_two = (46 * (1 - ct) / (43 * (1 + ct))) * (23 * (1 - cs) / (22 * (1 + cs)))
    assert np.prod(1 + r["ret"][:4]) == pytest.approx(first_two * (22.5 / (22.5 * (1 + cs))), rel=1e-9)   # and day 3 buys the next night at LATE(3)
    # half size leaves half the account in cash
    h = E.simulate_stack(p, "QQQ", "TQQQ", None, None, size=0.5)
    assert np.prod(1 + h["ret"]) == pytest.approx(1 + 0.5 * (46 * (1 - ct) / (43 * (1 + ct)) - 1))
