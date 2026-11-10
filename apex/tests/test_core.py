import math

import numpy as np
import pytest

from apex import metrics as M
from apex import validation as V
from apex.backtest import bracket_trades, run_positions
from apex.costs import GROSS, CostModel, rh_crypto_tier
from apex.data import Bars, resample, validate_minutes
from apex.feasibility import growth_per_trade, kelly_required_sharpe, trades_needed
from apex.risk import RiskConfig, RiskGovernor, fixed_fractional_notional, kelly_fraction
from apex import strategies as S


def bars(o, h=None, l=None, c=None, step=60, t0=1_600_000_020):
    o = np.asarray(o, float)
    h = o if h is None else np.asarray(h, float)
    l = o if l is None else np.asarray(l, float)
    c = o if c is None else np.asarray(c, float)
    ts = t0 + step * np.arange(len(o), dtype=np.int64)
    return Bars(ts, o, h, l, c, np.ones(len(o)), step, np.ones(len(o), bool))


def test_signal_fills_at_next_open_not_same_close():
    b = bars([100, 100, 110, 121, 121])
    sig = np.array([0, 1, 0, 0, 0.0])            # decided at close of bar 1
    r = run_positions(b, sig, GROSS)
    # filled at open of bar 2 (110), sold at open of bar 3 (121): +10%, NOT the 100->110 move
    assert r.ret.tolist() == pytest.approx([0, 0, 0.10, 0])
    assert r.trade_ret.tolist() == pytest.approx([0.10])


def test_costs_charged_on_entry_and_exit():
    b = bars([100, 100, 100, 100, 100])
    c = CostModel("x", 0.01, 0.0)
    r = run_positions(b, np.array([0, 1, 0, 0, 0.0]), c)
    assert r.ret.sum() == pytest.approx(-0.02)
    assert r.trade_ret[0] == pytest.approx((1 - 0.01) * (1 - 0.01) - 1)
    assert r.turnover == pytest.approx(2.0)


def test_open_trade_at_end_is_not_counted_as_closed():
    b = bars([100, 100, 105, 110, 120])
    r = run_positions(b, np.array([0, 1, 1, 1, 1.0]), GROSS)
    assert len(r.trade_ret) == 0


def test_bracket_target_stop_and_same_minute_goes_to_stop():
    o = [100, 100, 100, 100, 100, 100]
    h = [100, 100, 102, 100, 103, 100]
    l = [100, 100, 100, 100, 97, 100]
    b = bars(o, h, l, o)
    hit = bracket_trades(b, np.array([0]), 0.02, 0.02, 4, 0, 0, 0, 0)
    assert hit.reason.tolist() == ["target"] and hit.ret[0] == pytest.approx(0.02)
    both = bracket_trades(b, np.array([2]), 0.02, 0.02, 3, 0, 0, 0, 0)   # enters bar 3; bar 4 touches both
    assert both.reason.tolist() == ["stop"] and both.ret[0] == pytest.approx(-0.02)


def test_bracket_gap_through_stop_fills_at_worse_price_and_time_exit():
    o = [100, 100, 100, 90, 90, 90]
    l = [100, 100, 100, 90, 90, 90]
    b = bars(o, o, l, o)
    r = bracket_trades(b, np.array([0]), 0.05, 0.02, 4, 0, 0, 0, 0)
    assert r.reason.tolist() == ["stop"] and r.ret[0] == pytest.approx(-0.10)     # not -2%
    flat = bars([100] * 8)
    t = bracket_trades(flat, np.array([0]), 0.05, 0.05, 3, 0.001, 0.001, 0.001, 0.001)
    assert t.reason.tolist() == ["time"] and t.ret[0] == pytest.approx(0.999 / 1.001 - 1)


def test_bracket_one_at_a_time_and_limit_entry_needs_trade_through():
    b = bars([100] * 20)
    r = bracket_trades(b, np.array([0, 1, 2, 10]), 0.05, 0.05, 5, 0, 0, 0, 0)
    assert len(r.ret) == 2 and r.skipped == 2
    nofill = bracket_trades(b, np.array([0]), 0.05, 0.05, 5, 0, 0, 0, 0, limit_entry=True)
    assert len(nofill.ret) == 0 and nofill.skipped == 1


def test_lookahead_detector_catches_future_data():
    rng = np.random.default_rng(0)
    b = bars(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 600))))
    assert V.prefix_invariance(lambda x: S.sma_trend(x, 20), b)["passed"]
    assert V.prefix_invariance(lambda x: S.donchian(x, 20, 10), b)["passed"]
    cheat = lambda x: (np.roll(x.c, -1) > x.c).astype(float)       # peeks at the next bar
    assert not V.prefix_invariance(cheat, b)["passed"]
    full_sample = lambda x: (x.c > x.c.mean()).astype(float)       # uses the whole-sample mean
    assert not V.prefix_invariance(full_sample, b)["passed"]


def test_all_signal_functions_are_causal():
    rng = np.random.default_rng(1)
    p = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 1500)))
    b = Bars(1_600_000_000 - 1_600_000_000 % 3600 + 3600 * np.arange(1500, dtype=np.int64), p, p * 1.01, p * 0.99,
             np.roll(p, -1), rng.uniform(1, 5, 1500), 3600, np.ones(1500, bool))
    b.c[-1] = b.o[-1]
    fns = [lambda x: S.tsmom(x, 24), lambda x: S.dip_buy(x, 0.01, 5), lambda x: S.vol_filtered_trend(x, 20, 10, True),
           lambda x: S.hours_window(x, 21, 3), lambda x: S.intraday_momentum(x, 24, 4), lambda x: S.range_expansion(x, 1.2, 20, 4)]
    for f in fns:
        assert V.prefix_invariance(f, b)["passed"]


def test_metrics():
    lo, hi = M.wilson(70, 100)
    assert 0.60 < lo < 0.70 < hi < 0.79
    st = M.trade_stats(np.array([0.01] * 7 + [-0.03] * 3))
    assert st["win_rate"] == pytest.approx(0.7) and st["expectancy"] == pytest.approx(-0.002)
    assert st["longest_losing_streak"] == 3 and st["profit_factor"] == pytest.approx(0.07 / 0.09)
    assert M.max_drawdown(np.array([0.1, -0.5, 0.2])) == pytest.approx(0.5)
    assert M.breakeven_win_rate(1 / 2.3333333) == pytest.approx(0.70, abs=1e-6)
    rng = np.random.default_rng(2)
    noise = rng.normal(0, 0.01, 2000)
    assert M.deflated_sharpe(noise + 0.0004, n_trials=200)["dsr"] < 0.95       # weak edge + many tries: not evidence
    assert M.deflated_sharpe(noise + 0.002, n_trials=200)["dsr"] > 0.99


def test_walk_forward_only_uses_the_past():
    ts = (np.arange(365 * 6) * 86400 + 1483228800).astype(np.int64)            # 2017-01-01 ..
    years = 2017 + np.arange(365 * 6) // 365
    a = np.where(years <= 2019, 0.002, -0.002) + 0.0001 * np.sin(np.arange(len(ts)))
    b_ = np.where(years <= 2019, -0.002, 0.002) + 0.0001 * np.cos(np.arange(len(ts)))
    wf = V.walk_forward({"A": a, "B": b_}, ts, 365, first_test="2018-01-01")
    assert wf["chosen"][2018] == "A" and wf["chosen"][2020] == "A"            # 2020 still picks A: it cannot know
    assert wf["chosen"][2022] in ("A", "B")


def test_breakers_stop_trading():
    ts = (np.arange(48) * 3600 + 1_600_000_000 - 1_600_000_000 % 86400).astype(np.int64)
    ret = np.full(48, -0.005)
    out = V.breakers(ret, ts, daily_loss=0.02, max_dd=0.12)
    assert out["daily_trips"] == 2 and out["final"] > -0.06                    # ~2% a day, then flat
    out2 = V.breakers(np.full(48, -0.01), ts, daily_loss=0.5, max_dd=0.12)
    assert out2["stopped_for_good"] and out2["max_drawdown"] < 0.14


def test_costs_and_risk():
    assert rh_crypto_tier(250)[0] == 1 and rh_crypto_tier(250)[1] == pytest.approx(0.0095)
    assert rh_crypto_tier(60_000)[0] == 3
    cfg = RiskConfig()
    assert fixed_fractional_notional(1000, 0.05, cfg) == pytest.approx(100.0)   # 0.5% risk / 5% stop
    assert fixed_fractional_notional(1000, 0.001, cfg) == pytest.approx(1000.0)  # capped: no leverage
    g = RiskGovernor(cfg)
    g.on_equity(1000, now=86400 * 10)
    assert g.check("buy", 100, 1000, 0, False) == (True, "OK")
    assert g.check("buy", 1001, 1000, 0, False)[1] == "POSITION_TOO_LARGE"
    g.on_equity(979, now=86400 * 10 + 60)
    assert g.check("buy", 100, 979, 0, False)[1] == "DAILY_LOSS_LIMIT"
    assert g.check("sell", 100, 979, 100, True)[0]                              # exits always allowed
    g.on_equity(979, now=86400 * 11)
    assert g.check("buy", 100, 979, 0, False)[0]                                # new day
    g.on_equity(870, now=86400 * 11 + 60)
    assert g.halted_reason == "MAX_DRAWDOWN_LIMIT"
    g.on_equity(870, now=86400 * 12)
    assert g.check("buy", 100, 870, 0, False)[1] == "MAX_DRAWDOWN_LIMIT"        # does not reset by itself
    with pytest.raises(PermissionError):
        g.clear_halt("ok")
    assert kelly_fraction(np.array([-0.01] * 60 + [0.01] * 40)) == 0.0


def test_feasibility_math():
    assert growth_per_trade(0.5, 1.0, 0.01) < 0                                  # fair coin loses to variance
    assert trades_needed(2.0, 0.5, 1.0, 0.005) == float("inf")
    n = trades_needed(2.0, 0.55, 1.0, 0.005)                                    # 0.1R edge at 0.5% risk
    assert 1300 < n < 1500
    assert kelly_required_sharpe(math.log(2) * 12) == pytest.approx(4.08, abs=0.01)


def test_resample_and_validation():
    n = 600
    p = np.linspace(100, 110, n)
    m = Bars(1_600_000_200 + 60 * np.arange(n, dtype=np.int64), p, p + 1, p - 1, p, np.ones(n), 60, np.ones(n, bool))
    h = resample(m, 300)
    assert (h.ts % 300 == 0).all() and h.v[0] == 5 and h.h[0] == m.h[np.argmax(m.ts % 300 == 0):][:5].max()
    import pandas as pd
    df = pd.DataFrame({"timestamp": m.ts, "open": m.o, "high": m.h, "low": m.l, "close": m.c, "volume": m.v})
    assert validate_minutes(df)["gaps"] == 0
    with pytest.raises(ValueError):
        validate_minutes(df.drop(index=[10]))


def test_monitor_flags_degradation_only_with_enough_trades():
    from apex.monitor import degradation_check, win_rate_check
    rng = np.random.default_rng(5)
    back = rng.normal(0.004, 0.02, 800)
    assert degradation_check(rng.normal(0.004, 0.02, 60), back)["status"] in ("OK", "WATCH")
    assert degradation_check(rng.normal(-0.01, 0.02, 60), back)["status"] == "DEGRADED"
    assert degradation_check(rng.normal(-0.01, 0.02, 6), back)["status"] == "TOO_EARLY"
    assert win_rate_check(6, 6, 0.68)["status"] == "TOO_EARLY"
    assert win_rate_check(10, 40, 0.68)["status"] == "DEGRADED" and win_rate_check(28, 40, 0.68)["status"] == "OK"


def test_closed_forms_match_simulation():
    from apex import feasibility as F
    rng = np.random.default_rng(9)
    S_, sig, T, steps, n = 1.5, 0.6, 1.0, 2000, 4000
    dt = T / steps
    x = np.cumsum(rng.normal((S_ * sig - sig ** 2 / 2) * dt, sig * math.sqrt(dt), size=(n, steps)), axis=1)
    assert abs((x.max(axis=1) >= math.log(2)).mean() - F.p_touch_up(S_, sig, T)) < 0.03
    assert abs((x.min(axis=1) <= math.log(0.5)).mean() - F.p_touch_down(S_, sig, T, 0.5)) < 0.03
    assert F.p_up_before_down(1.0, 1.0, 2.0, 0.5) == pytest.approx(2 / 3)
    assert F.best_leverage_to_touch(0.0, 1 / 12)["p_touch"] <= 0.5 + 1e-6          # no edge: never better than a coin flip
