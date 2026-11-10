import base64
import json

import pytest

from apex.costs import CostModel
from apex.execution.broker import FILLED, PARTIAL, REJECTED, SUBMITTED, UNKNOWN, LiveTradingDisabled, Order, client_order_id
from apex.execution.engine import Engine
from apex.execution.paper import PaperBroker
from apex.execution.robinhood_crypto import ARM_ENV, ARM_VALUE, ApiError, RobinhoodCryptoBroker, TokenBucket, sign
from apex.execution.store import Store
from apex.risk import RiskConfig, RiskGovernor

COST = CostModel("test", 0.01, 0.0)
DAY = 86400.0


def make(tmp_path, cash=1000.0, cfg=None, **paper_kw):
    broker = PaperBroker(Store(tmp_path / "broker.sqlite"), COST, starting_cash=cash, **paper_kw)
    broker.set_price("BTC-USD", 100.0, 10 * DAY)
    gov = RiskGovernor(cfg or RiskConfig(daily_loss_limit=0.5, max_drawdown_limit=0.9), base_dir=tmp_path)
    return broker, Engine(broker, Store(tmp_path / "engine.sqlite"), gov, "t", "BTC-USD")


def test_paper_fill_fees_and_ledger_agree(tmp_path):
    broker, eng = make(tmp_path)
    o = eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    assert o.state == FILLED and o.filled_qty == pytest.approx(5.0)
    assert broker.cash == pytest.approx(1000 - 500 - 5.0)             # notional + 1% fee
    assert eng.cash == pytest.approx(broker.cash) and eng.store.positions() == broker.get_account().positions
    assert eng.reconcile(10 * DAY)


def test_no_leverage_and_no_shorting(tmp_path):
    broker, _ = make(tmp_path)
    too_big = broker.submit(Order("a", "BTC-USD", "buy", "market", 11.0))
    assert too_big.state == REJECTED and too_big.reason == "INSUFFICIENT_CASH"
    short = broker.submit(Order("b", "BTC-USD", "sell", "market", 1.0))
    assert short.state == REJECTED and short.reason == "SELL_EXCEEDS_HOLDING"
    assert broker.cash == 1000.0


def test_duplicate_orders_are_impossible(tmp_path):
    broker, eng = make(tmp_path)
    a = eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    b = eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY + 5)     # same decision replayed
    assert b is None or b.client_order_id == a.client_order_id
    assert len(broker.store.orders()) == 1 and len(broker.store.fills()) == 1
    again = broker.submit(Order(a.client_order_id, "BTC-USD", "buy", "market", 5.0))   # same id sent twice
    assert again.filled_qty == pytest.approx(5.0) and len(broker.store.fills()) == 1
    assert client_order_id("t", "BTC-USD", 1, "buy") == client_order_id("t", "BTC-USD", 1, "buy")
    assert client_order_id("t", "BTC-USD", 1, "buy") != client_order_id("t", "BTC-USD", 2, "buy")


def test_partial_fills_accumulate_once(tmp_path):
    broker, eng = make(tmp_path, max_fill_notional=200.0)
    o = eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    assert o.state == PARTIAL and o.filled_qty == pytest.approx(2.0)
    assert eng.rebalance(0.5, decision_ts=10 * DAY + 60, now=10 * DAY + 60) is None      # still working: no stacking
    for k in range(1, 4):
        broker.set_price("BTC-USD", 100.0, 10 * DAY + 60 * k)
        eng.mark(10 * DAY + 60 * k)
        eng.mark(10 * DAY + 60 * k)                                     # syncing twice must not double count
    done = eng.store.get_order(o.client_order_id)
    assert done.state == FILLED and done.filled_qty == pytest.approx(5.0)
    assert sum(f["quantity"] for f in eng.store.fills()) == pytest.approx(5.0)
    assert eng.cash == pytest.approx(broker.cash) and eng.reconcile(10 * DAY + 999)


def test_limit_order_rests_until_crossed(tmp_path):
    broker, _ = make(tmp_path)
    o = broker.submit(Order("lim", "BTC-USD", "buy", "limit", 1.0, limit_price=95.0))
    assert o.state == SUBMITTED and o.filled_qty == 0
    broker.set_price("BTC-USD", 96.0, 10 * DAY + 60)
    assert broker.get_order("lim").state == SUBMITTED
    broker.set_price("BTC-USD", 94.0, 10 * DAY + 120)
    f = broker.get_order("lim")
    assert f.state == FILLED and f.avg_price == 95.0


def test_restart_recovers_state_and_does_not_repeat_orders(tmp_path):
    broker, eng = make(tmp_path)
    eng.rebalance(1.0, decision_ts=10 * DAY, now=10 * DAY)
    eng.mark(10 * DAY + 60)
    peak, cash, pos = eng.gov.peak_equity, eng.cash, eng.store.positions()
    eng.store.close(); broker.store.close()
    broker2 = PaperBroker(Store(tmp_path / "broker.sqlite"), COST, starting_cash=1.0)   # starting cash ignored: state exists
    broker2.set_price("BTC-USD", 100.0, 10 * DAY + 120)
    eng2 = Engine(broker2, Store(tmp_path / "engine.sqlite"), RiskGovernor(RiskConfig(daily_loss_limit=0.5, max_drawdown_limit=0.9), base_dir=tmp_path), "t", "BTC-USD")
    assert eng2.cash == pytest.approx(cash) and eng2.store.positions() == pos and eng2.gov.peak_equity == pytest.approx(peak)
    assert eng2.rebalance(1.0, decision_ts=10 * DAY, now=10 * DAY + 180) is None           # already there, nothing to do
    assert len(broker2.store.orders()) == 1
    assert [e["kind"] for e in eng2.store.events()].count("ENGINE_RESTART") == 1


def test_crash_between_journal_and_send_is_recovered_exactly_once(tmp_path):
    broker, eng = make(tmp_path)
    coid = client_order_id("t", "BTC-USD", 10 * DAY, "buy")
    eng.store.upsert_order(Order(coid, "BTC-USD", "buy", "market", 2.0, created_ts=10 * DAY))   # journaled, never sent
    eng.sync(10 * DAY + 1); eng.sync(10 * DAY + 2); eng.sync(10 * DAY + 3)
    assert len(broker.store.orders()) == 1 and eng.store.get_order(coid).state == FILLED
    assert eng.store.positions() == {"BTC-USD": pytest.approx(2.0)}


def test_lost_response_is_looked_up_never_resent(tmp_path):
    broker, eng = make(tmp_path)
    real_submit = broker.submit

    def lossy(order):
        real_submit(order)                       # the broker got it...
        raise TimeoutError("no response")        # ...but the answer never arrived
    broker.submit = lossy
    eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    assert any(e["kind"] == "SUBMIT_ERROR" for e in eng.store.events())
    broker.submit = real_submit
    eng.sync(10 * DAY + 5)
    orders = eng.store.orders()
    assert len(orders) == 1 and orders[0].state == FILLED and len(broker.store.fills()) == 1
    assert eng.reconcile(10 * DAY + 6)


def test_unknown_order_blocks_new_orders_until_resolved(tmp_path):
    broker, eng = make(tmp_path)
    broker.submit = lambda order: (_ for _ in ()).throw(ConnectionError("down"))     # never reaches the broker
    eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    assert eng.store.orders()[0].state == UNKNOWN
    assert eng.rebalance(0.5, decision_ts=10 * DAY + 60, now=10 * DAY + 60) is None
    assert len(eng.store.orders()) == 1 and len(broker.store.orders()) == 0


def test_reconcile_mismatch_blocks_buys_but_allows_exits(tmp_path):
    broker, eng = make(tmp_path)
    eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    broker.store.set_position("BTC-USD", 3.0, 300.0)                   # someone sold 2 BTC outside the engine
    assert not eng.reconcile(10 * DAY + 1) and eng.gov.halted_reason == "RECONCILE_MISMATCH"
    assert eng.rebalance(1.0, decision_ts=10 * DAY + 60, now=10 * DAY + 60) is None
    assert any(e["kind"] == "RECONCILE_MISMATCH" for e in eng.store.events("error"))


def test_kill_switch_and_emergency_flatten(tmp_path):
    broker, eng = make(tmp_path)
    eng.rebalance(0.5, decision_ts=10 * DAY, now=10 * DAY)
    eng.emergency_stop(10 * DAY + 60, flatten=True)
    assert (tmp_path / "KILL").exists() and eng.store.positions() == {}
    assert eng.rebalance(0.5, decision_ts=10 * DAY + 120, now=10 * DAY + 120) is None
    assert [e["why"] for e in map(lambda e: json.loads(e["detail"]), eng.store.events("warn")) if "why" in e] == ["KILL_SWITCH"]


def test_daily_loss_and_drawdown_breakers_halt_the_engine(tmp_path):
    broker, eng = make(tmp_path, cfg=RiskConfig())                     # default 2% daily / 12% drawdown
    eng.rebalance(1.0, decision_ts=10 * DAY, now=10 * DAY)
    broker.set_price("BTC-USD", 96.0, 10 * DAY + 3600)                 # about -5% on the day
    eng.mark(10 * DAY + 3600)
    assert eng.gov.halted_reason == "DAILY_LOSS_LIMIT"
    eng.rebalance(0.0, decision_ts=10 * DAY + 3600, now=10 * DAY + 3600)        # exit is still allowed
    assert eng.store.positions() == {}
    assert eng.rebalance(1.0, decision_ts=10 * DAY + 7200, now=10 * DAY + 7200) is None
    broker.set_price("BTC-USD", 96.0, 11 * DAY)
    eng.mark(11 * DAY)                                                  # new UTC day: daily breaker resets
    assert eng.gov.halted_reason is None
    eng.rebalance(1.0, decision_ts=11 * DAY, now=11 * DAY)
    broker.set_price("BTC-USD", 85.0, 11 * DAY + 3600)
    eng.mark(11 * DAY + 3600)
    assert eng.gov.halted_reason == "MAX_DRAWDOWN_LIMIT"
    broker.set_price("BTC-USD", 85.0, 12 * DAY)
    eng.mark(12 * DAY)
    assert eng.gov.halted_reason == "MAX_DRAWDOWN_LIMIT"               # stays until a person clears it
    assert {"DAILY_LOSS_LIMIT", "MAX_DRAWDOWN_LIMIT"} <= {e["kind"] for e in eng.store.events("alert")}


# ----------------------------------------------------------------------------- Robinhood adapter
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

PRIV = Ed25519PrivateKey.generate()
PRIV_B64 = base64.b64encode(PRIV.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())).decode()


class FakeRH:
    def __init__(self):
        self.calls, self.fail_gets, self.orders = [], 0, {}

    def __call__(self, method, url, headers, body, timeout):
        path = url.replace("https://trading.robinhood.com", "")
        self.calls.append((method, path, headers, body))
        PRIV.public_key().verify(base64.b64decode(headers["x-signature"]),
                                 f"{headers['x-api-key']}{headers['x-timestamp']}{path}{method}{body or ''}".encode())   # raises if wrong
        if method == "GET" and self.fail_gets > 0:
            self.fail_gets -= 1
            return 429, "slow down"
        if path.startswith("/api/v1/crypto/marketdata/best_bid_ask/"):
            return 200, json.dumps({"results": [{"symbol": "BTC-USD", "bid_inclusive_of_sell_spread": "99.5", "ask_inclusive_of_buy_spread": "100.5"}]})
        if path == "/api/v1/crypto/trading/accounts/":
            return 200, json.dumps({"account_number": "ACC1", "status": "active", "buying_power": "250.00"})
        if path == "/api/v1/crypto/trading/holdings/":
            return 200, json.dumps({"results": [{"asset_code": "BTC", "total_quantity": "0.5"}]})
        if path.startswith("/api/v1/crypto/trading/trading_pairs/"):
            return 200, json.dumps({"results": [{"symbol": "BTC-USD", "min_order_size": "0.000001", "asset_increment": "0.00000001"}]})
        if method == "POST" and path == "/api/v1/crypto/trading/orders/":
            b = json.loads(body)
            self.orders[b["client_order_id"]] = {**b, "id": "oid-1", "state": "open", "filled_asset_quantity": "0", "average_price": None}
            return 201, json.dumps(self.orders[b["client_order_id"]])
        if method == "GET" and path.startswith("/api/v1/crypto/trading/orders/"):
            return 200, json.dumps({"results": list(self.orders.values()), "next": None})
        return 404, "not found"


def rh(tmp_path, live=False, **kw):
    fake = FakeRH()
    b = RobinhoodCryptoBroker("rh-api-key-1234", PRIV_B64, live_enabled=live, arm_file=tmp_path / "LIVE_ARMED.json", transport=fake,
                              bucket=TokenBucket(sleep=lambda s: None), clock=lambda: 1_800_000_000.0, **kw)
    return b, fake


def test_signature_headers_and_read_only_calls(tmp_path):
    b, fake = rh(tmp_path)
    acct = b.get_account()                                   # signature is verified inside the fake on every call
    assert acct.cash == 250.0 and acct.positions == {"BTC-USD": 0.5} and acct.equity == pytest.approx(250 + 0.5 * 99.5)
    assert b.get_quote("BTC-USD").ask == 100.5
    assert b.self_check()["ok"] and b.self_check()["live_armed"] is False
    assert all(set(h) >= {"x-api-key", "x-signature", "x-timestamp"} for _, _, h, _ in fake.calls)
    assert "rh-api-key-1234" not in repr(b) and PRIV_B64 not in repr(b)
    assert sign("k", PRIV_B64, 1, "/p", "GET", "") == sign("k", PRIV_B64, 1, "/p", "GET", "")


def test_real_orders_are_blocked_unless_all_three_arming_steps_are_done(tmp_path, monkeypatch):
    order = Order("cid-1", "BTC-USD", "buy", "market", 0.1)
    monkeypatch.delenv(ARM_ENV, raising=False)
    b, fake = rh(tmp_path)
    with pytest.raises(LiveTradingDisabled):
        b.submit(order)
    b, fake = rh(tmp_path, live=True)                         # flag only
    with pytest.raises(LiveTradingDisabled):
        b.submit(order)
    monkeypatch.setenv(ARM_ENV, ARM_VALUE)                    # flag + env, no arming file
    with pytest.raises(LiveTradingDisabled):
        b.submit(order)
    (tmp_path / "LIVE_ARMED.json").write_text(json.dumps({"armed": True, "account_number": "ACC1", "max_order_notional": 5}))
    with pytest.raises(LiveTradingDisabled):                  # armed, but the order is over the dollar cap
        b.submit(order)
    assert not any(m == "POST" for m, *_ in fake.calls)       # nothing was ever sent
    (tmp_path / "LIVE_ARMED.json").write_text(json.dumps({"armed": True, "account_number": "ACC1", "max_order_notional": 50}))
    b2, fake2 = rh(tmp_path, live=False)                      # env + file but no constructor flag
    with pytest.raises(LiveTradingDisabled):
        b2.submit(order)
    assert b.is_live
    placed = b.submit(order)                                  # only now does a POST go out (to the fake)
    posts = [c for c in fake.calls if c[0] == "POST"]
    assert len(posts) == 1 and json.loads(posts[0][3])["market_order_config"] == {"asset_quantity": "0.10000000"}
    assert placed.state == SUBMITTED and b.get_order("cid-1").broker_order_id == "oid-1"


def test_gets_retry_posts_never_do(tmp_path, monkeypatch):
    b, fake = rh(tmp_path)
    fake.fail_gets = 2
    assert b.get_quote("BTC-USD").bid == 99.5 and len(fake.calls) == 3
    fake.fail_gets = 9
    with pytest.raises(ApiError):
        b.get_quote("BTC-USD")
    monkeypatch.setenv(ARM_ENV, ARM_VALUE)
    (tmp_path / "LIVE_ARMED.json").write_text(json.dumps({"armed": True, "account_number": "ACC1", "max_order_notional": 50}))
    b, fake = rh(tmp_path, live=True)
    real = b.transport
    b.transport = lambda m, u, h, body, t: (_ for _ in ()).throw(TimeoutError()) if m == "POST" else real(m, u, h, body, t)
    with pytest.raises(TimeoutError):
        b.submit(Order("cid-2", "BTC-USD", "buy", "market", 0.1))


def test_engine_with_unarmed_robinhood_adapter_sends_nothing(tmp_path, monkeypatch):
    monkeypatch.delenv(ARM_ENV, raising=False)
    b, fake = rh(tmp_path)
    eng = Engine(b, Store(tmp_path / "e.sqlite"), RiskGovernor(RiskConfig(daily_loss_limit=0.9, max_drawdown_limit=0.9, max_position_fraction=1.0), base_dir=tmp_path), "t", "BTC-USD")
    eng.store.set_position("BTC-USD", 0.5, 50.0)              # match the account so reconciliation passes
    o = eng.rebalance(1.0, decision_ts=1.0, now=1_800_000_000.0)
    assert o.state == REJECTED and o.reason == "LIVE_TRADING_DISABLED"
    assert not any(m == "POST" for m, *_ in fake.calls)
    assert any(e["kind"] == "LIVE_TRADING_DISABLED" for e in eng.store.events("error"))


def test_token_bucket_waits_when_empty():
    t, slept = [0.0], []
    bucket = TokenBucket(rate_per_min=60, capacity=2, clock=lambda: t[0], sleep=lambda s: (slept.append(s), t.__setitem__(0, t[0] + s)))
    assert bucket.take() == 0 and bucket.take() == 0
    assert bucket.take() == pytest.approx(1.0) and slept == [pytest.approx(1.0)]
