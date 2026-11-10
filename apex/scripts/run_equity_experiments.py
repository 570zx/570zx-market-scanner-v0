#!/usr/bin/env python3
"""APEX round two: stocks and ETFs, where Robinhood charges no commission.

Every hypothesis below was written, with its kill rule, before this script was first run on the holdout.
Development runs used --discovery-only, which cuts the data off at 2022-12-31 so that no holdout number
could be seen while the code was being debugged. Nothing dated 2023-01-01 or later picks a rule or a setting.

Usage:  python3 scripts/run_equity_experiments.py [--discovery-only] [--skip-lookahead]
Output: results/equity_summary.json, results/ledger.jsonl (append-only), results/series/E*.csv (not committed)
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from apex import equities as E  # noqa: E402
from apex import intraday as I  # noqa: E402
from apex import metrics as M  # noqa: E402
from apex import validation as V  # noqa: E402
from apex.ledger import Ledger, _clean, data_fingerprint  # noqa: E402
from apex.research import Hypothesis  # noqa: E402
from apex.data import load_btc  # noqa: E402

warnings.filterwarnings("ignore", category=RuntimeWarning)
DATA, OUT = ROOT / "data" / "equities", ROOT / "results"
T0 = time.time()

IDX = ["SPY", "QQQ", "IWM", "DIA"]
SECT = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"]
BROAD = IDX + SECT
LEV_IDX = ["TQQQ", "UPRO", "TNA", "UDOW"]
LEV_BROAD = LEV_IDX + ["SOXL", "TECL", "FAS", "LABU", "ERX"]
ML_UNI = BROAD + ["SMH", "XBI", "KRE", "GDX", "XOP", "EFA", "EEM", "FXI", "EWZ", "EWJ", "TLT", "IEF", "HYG", "LQD", "GLD", "SLV", "USO",
                  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO"]
MEGA = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO"]
CORE = ["SPY", "QQQ", "IWM", "TQQQ", "SQQQ", "SOXL", "UPRO", "NVDA", "TSLA"]
K = E.KILL_STANDARD


def log(msg: str) -> None:
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


# --------------------------------------------------------------------------------------
# Hypothesis registry (written before the first holdout run)
# --------------------------------------------------------------------------------------
HYP = {h.id: h for h in [
    Hypothesis("E01", "Weak close, index and sector ETFs",
               "An index or sector ETF that is near the bottom of its day's range five minutes before the close tends to bounce over the next days; buying those closes beats holding.",
               "Internal-bar-strength / short-term reversal literature; MEDS found it earlier on the same years, so the holdout is not untouched for this family.", K),
    Hypothesis("E02", "Weak close, 3x leveraged ETFs",
               "The same weak-close bounce, traded through 3x leveraged ETFs, keeps its edge after the larger spreads and the leverage decay.",
               "MEDS LEVERAGED.md (same caveat: these years were already looked at once).", K),
    Hypothesis("E03a", "RSI(2) pullback, index ETFs", "Buying an index ETF when its 2-day RSI is very low and selling when it closes back above its 5-day average beats holding.",
               "Connors & Alvarez, 'Short Term Trading Strategies That Work' (2008).", K),
    Hypothesis("E03b", "RSI(2) pullback, 3x ETFs", "The RSI(2) pullback rule on the index, traded through the 3x ETF, beats holding.", "As E03a.", K),
    Hypothesis("E04a", "Overnight only, index ETFs", "Index ETFs earn their return overnight; owning them only from 15:55 to the next open beats holding after two trades a day.",
               "Cooper, Cliff & Gulen (2008); Lou, Polk & Skouras (2019); MEDS OVERNIGHT.md.", K),
    Hypothesis("E04b", "Overnight only, 3x ETFs", "The overnight-only rule on 3x ETFs, alone or with a trend or weak-close condition, beats holding.", "As E04a.", K),
    Hypothesis("E05a1", "Gap to close, index ETFs", "After a large overnight gap, the regular session continues (or fades) the gap enough to trade it from the open to 15:55.",
               "Opening-gap reversal and continuation studies; no strong prior.", K),
    Hypothesis("E05a3", "Gap to close, 3x ETFs", "As E05a1 through 3x ETFs.", "As E05a1.", K),
    Hypothesis("E05b1", "Last half hour momentum, index ETFs", "The move from yesterday's close to 15:30 (or the first half hour's move) carries on through the last half hour.",
               "Gao, Han, Li & Zhou (2018) 'Market intraday momentum'; Baltussen et al. (2021) on hedging and leveraged-ETF rebalancing flows.", K),
    Hypothesis("E05b3", "Last half hour momentum, 3x and inverse ETFs", "As E05b1 through 3x long and 3x inverse ETFs.", "As E05b1.", K),
    Hypothesis("E05c1", "Morning move carries to the close, index ETFs", "A strong move by 10:00 carries on until 15:55.", "Intraday trend-day literature; Zarattini, Aziz & Barbon (2024).", K),
    Hypothesis("E05c3", "Morning move carries to the close, 3x and inverse ETFs", "As E05c1 through 3x long and 3x inverse ETFs.", "As E05c1.", K),
    Hypothesis("E06a", "Calendar effects, index ETFs and Treasuries", "Turn-of-the-month days, particular weekdays, pre-holiday days or month-end Treasury buying earn enough to beat holding.",
               "Ariel (1987), Lakonishok & Smidt (1988), McConnell & Xu (2008); month-end bond flows (Hartley & Schwarz 2019).", K),
    Hypothesis("E06b", "Calendar effects, 3x ETFs", "As E06a through 3x ETFs.", "As E06a.", K),
    Hypothesis("E07a", "Trend and volatility timing, index ETFs", "Holding an index ETF only above its moving average, or sized to a volatility target, beats holding.",
               "Faber (2007); Moreira & Muir (2017) 'Volatility-managed portfolios'.", K),
    Hypothesis("E07b", "Trend and volatility timing, 3x ETFs", "A 3x ETF held only in an uptrend, sized to a volatility target, or rotated with Treasuries and gold beats holding.",
               "Gayed & Bilello (2016) 'Leverage for the long run'; MEDS LEVERAGED.md.", K),
    Hypothesis("E08", "Short volatility (SVXY)", "The inverse-volatility fund SVXY, held only when volatility futures are calm or falling, earns the volatility premium without the crashes.",
               "Volatility risk premium literature; February 2018 is in the discovery data as the known failure.", K),
    Hypothesis("E09", "Intraday momentum outside the noise area (5-minute bars)",
               "When QQQ or SPY leaves the band its recent open-to-time moves define, the move continues to the close; trading it through 3x and inverse ETFs beats holding.",
               "Zarattini, Aziz & Barbon (2024) 'Beat the Market: An Effective Intraday Momentum Strategy for S&P500 ETF (SPY)'.", K),
    Hypothesis("E10", "Sector rotation", "Buying the weakest sector ETFs of the last days (reversal) or the strongest of the last months (momentum) beats holding.",
               "Lehmann (1990) short-term reversal; Moskowitz & Grinblatt (1999) industry momentum.", K),
    Hypothesis("E11", "Night versus day, gold, bonds, oil and bitcoin funds", "Gold, Treasury, oil or bitcoin ETFs earn their return in one half of the day, and owning only that half beats holding.",
               "Overnight gold anomaly; no strong prior for the others.", K),
    Hypothesis("E12", "Machine-learned ranking", "A model trained on past years to rank ETFs and large stocks by next-night or next-day return picks winners out of sample.",
               "Gu, Kelly & Xiu (2020); fixed hyperparameters, retrained each year on earlier years only.", K),
    Hypothesis("E13a", "Ensemble of unleveraged strategies", "Combining the families that had a walk-forward Sharpe of 1 or more in earlier years, weighted by inverse volatility, beats holding.",
               "Diversification across imperfectly correlated edges; the rule is fixed before any holdout number is seen.", K),
    Hypothesis("E13b", "Ensemble of leveraged strategies", "As E13a, built from the 3x, inverse and intraday families.", "As E13a.", K),
    Hypothesis("E14", "Overnight persistence", "ETFs and stocks that earned the most overnight recently keep earning more overnight; buying the top ones at 15:55 and selling at the open beats holding.",
               "Lou, Polk & Skouras (2019) 'A tug of war'.", K),
    Hypothesis("E16a", "Strong close, inverse ETFs", "An index that is near the top of its day's range five minutes before the close tends to give some back; holding a 1x inverse ETF for a day beats holding.",
               "The mirror image of E01; weak prior, because stocks drift up.", K),
    Hypothesis("E16b", "Strong close, 3x inverse ETFs", "As E16a through 3x inverse ETFs.", "As E16a.", K),
    Hypothesis("E17", "Bitcoin trend through a spot-bitcoin ETF",
               "Round one found bitcoin trend rules that looked good before Robinhood's 0.95% crypto fee and failed after it. A spot-bitcoin ETF trades commission-free, "
               "so the same rules, decided and traded at 15:55 New York time on ETF trading days, beat holding.",
               "Round one (H01, H13). The ETF price before January 2024 is rebuilt from Bitstamp prices at ETF hours less a 0.25% yearly fee. "
               "Round one already saw this family's 2023+ result before costs, so the holdout is not untouched.", K),
    Hypothesis("E18", "One account, stacked: weak close, night and day",
               "An overnight rule and an intraday rule never need the same money at the same time, so one account can run both, with a weak-close position taking the money first "
               "when it is on. Built only from other families' walk-forward series, chosen each year on earlier years, the stacked account beats holding.",
               "Capital efficiency rather than a new signal. Needs sale proceeds to be usable at once (Robinhood's margin-type account, without borrowing). "
               "The overlap between sleeves is approximated here and has to be confirmed by an exact replay.", K),
    Hypothesis("E15", "Opening-range breakout (5-minute bars)", "A close beyond the first minutes' range starts a move that lasts to the close; trading it through 3x ETFs or liquid stocks beats holding.",
               "Zarattini & Aziz (2023) 'Can day trading really be profitable?'; MEDS ORB.md found it losing on small caps over 40 days.", K),
]}
ONE_X = ["E01", "E03a", "E04a", "E05a1", "E05b1", "E05c1", "E06a", "E07a", "E10", "E11", "E12", "E16a", "E17"]
LEVERED = ["E02", "E03b", "E04b", "E05a3", "E05b3", "E05c3", "E06b", "E07b", "E08", "E09", "E14", "E15", "E16b"]


# --------------------------------------------------------------------------------------
# Family builders: each returns {setting label: result dict}
# --------------------------------------------------------------------------------------
def fam_weak_close(p, cm, universes, trend_opts, exits):
    out, ibs, late = {}, p["ibs"], p["late"]
    up = (late["QQQ"] > E.sma(late["QQQ"], 200)).to_numpy()[:, None]
    names = {"strength": "until it closes above yesterday's high (5 days at most)", "up": "until it is profitable (5 days at most)", "hold": "one day"}
    for uname, (syms, slots) in universes.items():
        for thr in (0.15, 0.25):
            for tf in trend_opts:
                entry = (ibs[syms] < thr) & late[syms].notna()
                if tf:
                    entry = entry & up
                for mode in exits:
                    out[f"{uname}: bottom {int(thr * 100)}% of the range{', only while QQQ is in an uptrend' if tf else ''}, held {names[mode]}"] = \
                        E.simulate_slots(p, entry, ibs[syms], slots, mode, 1 if mode == "hold" else 5, cm)
    return out


def fam_rsi2(p, cm, pairs):
    out, late = {}, p["late"]
    for sig, veh in pairs:
        r2, s5, s200 = E.rsi(late[sig], 2), E.sma(late[sig], 5), E.sma(late[sig], 200)
        for thr in (5, 10, 20):
            for tf in (False, True):
                ent = (r2 < thr) & late[veh].notna()
                if tf:
                    ent = ent & (late[sig] > s200)
                out[f"{veh}: RSI(2) of {sig} below {thr}{', only above the 200-day average' if tf else ''}"] = \
                    E.simulate_slots(p, pd.DataFrame({veh: ent}), pd.DataFrame({veh: r2}), 1, "signal", 10, cm, exit_sig=pd.DataFrame({veh: late[sig] > s5}))
    return out


def fam_overnight(p, cm, pairs):
    out, late, ibs, rll = {}, p["late"], p["ibs"], p["r_ll"]
    for sig, veh in pairs:
        up = late[sig] > E.sma(late[sig], 200)
        conds = {"every night": pd.Series(True, index=p.dates), "only in an uptrend": up, "only after a weak close": ibs[sig] < 0.5,
                 "only after a down day": rll[sig] < 0, "only in an uptrend after a weak close": up & (ibs[sig] < 0.5)}
        for cname, cond in conds.items():
            wl = pd.DataFrame({veh: (cond & late[veh].notna()).astype(float)})
            out[f"{veh} overnight, {cname}"] = E.run_weights(p, wl, pd.DataFrame({veh: 0.0}, index=p.dates), cm)
    return out


def fam_gap(p, cm, pairs):
    """Decided before the open from the last premarket trade; bought at the open, sold at 15:55."""
    out = {}
    for sig, veh in pairs:
        gap = (p["pm_last"][sig] / p["late"][sig].shift(1) - 1).to_numpy()
        for name, cond in (("gap down of 1% or more", gap <= -0.01), ("gap down of 0.5% or more", gap <= -0.005),
                           ("gap up of 0.5% or more", gap >= 0.005), ("gap up of 1% or more", gap >= 0.01)):
            out[f"{veh} from the open to 15:55 after a {name} in {sig}"] = E.legs_result([E.leg(p, veh, "o", "late", cond, cm)], 385 / 1440)
    return out


def fam_late_momentum(p, cm, triples):
    """Decided at 15:30, held to 15:55. triples: (signal, long vehicle, inverse vehicle or None)."""
    out = {}
    for sig, lv, sv in triples:
        r = (p["p930"][sig] / p["late"][sig].shift(1) - 1).to_numpy()
        first = (p["p600"][sig] / p["late"][sig].shift(1) - 1).to_numpy()
        for thr in (0.0, 0.005, 0.01):
            what = "is up" if thr == 0 else f"is up {thr * 100:g}% or more"
            out[f"{lv} 15:30 to 15:55 when {sig} {what} on the day"] = E.legs_result([E.leg(p, lv, "p930", "late", r > thr, cm)], 25 / 1440)
            if sv:
                out[f"{lv} or {sv} 15:30 to 15:55 in the direction of {sig}'s day ({thr * 100:g}% or more)"] = \
                    E.legs_result([E.leg(p, lv, "p930", "late", r > thr, cm), E.leg(p, sv, "p930", "late", r < -thr, cm)], 25 / 1440)
        out[f"{lv} 15:30 to 15:55 when {sig}'s first half hour was up"] = E.legs_result([E.leg(p, lv, "p930", "late", first > 0, cm)], 25 / 1440)
        if sv:
            out[f"{lv} or {sv} 15:30 to 15:55 in the direction of {sig}'s first half hour"] = \
                E.legs_result([E.leg(p, lv, "p930", "late", first > 0, cm), E.leg(p, sv, "p930", "late", first < 0, cm)], 25 / 1440)
    return out


def fam_morning_momentum(p, cm, triples):
    """Decided at 10:00, held to 15:55."""
    out = {}
    for sig, lv, sv in triples:
        r = (p["p600"][sig] / p["late"][sig].shift(1) - 1).to_numpy()
        for thr in (0.003, 0.006, 0.01):
            out[f"{lv} 10:00 to 15:55 when {sig} is up {thr * 100:g}% or more by 10:00"] = E.legs_result([E.leg(p, lv, "p600", "late", r >= thr, cm)], 355 / 1440)
            if sv:
                out[f"{lv} or {sv} 10:00 to 15:55 in the direction of {sig}'s move by 10:00 ({thr * 100:g}% or more)"] = \
                    E.legs_result([E.leg(p, lv, "p600", "late", r >= thr, cm), E.leg(p, sv, "p600", "late", r <= -thr, cm)], 355 / 1440)
    return out


def _hold_next(p, flag, veh, cm):
    """flag[d] true -> own `veh` from 15:55 of day d to 15:55 of day d+1."""
    f = pd.Series(np.asarray(flag, bool), index=p.dates) & p["late"][veh].notna()
    return E.run_weights(p, pd.DataFrame({veh: f.astype(float)}), None, cm)


def fam_calendar(p, cm, stock_vehs, bond_veh):
    out, cal = {}, p.cal
    for veh in stock_vehs:
        for name, (a, b) in {"last day and first 3 days": (1, 3), "last 2 and first 3 days": (2, 3), "last 4 and first 2 days": (4, 2)}.items():
            out[f"{veh} around the turn of the month ({name})"] = _hold_next(p, ((cal["next_tdom_rev"] >= -a) | (cal["next_tdom"] <= b)).fillna(False), veh, cm)
        for dw, nm in enumerate(["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays"]):
            out[f"{veh} on {nm}"] = _hold_next(p, (cal["next_dow"] == dw), veh, cm)
        out[f"{veh} on the day before a market holiday"] = _hold_next(p, cal["next_pre_holiday"].fillna(False).astype(bool), veh, cm)
    for k in (5, 7):
        out[f"{bond_veh} for the last {k} trading days of each month"] = _hold_next(p, (cal["next_tdom_rev"] >= -k).fillna(False), bond_veh, cm)
    return out


def fam_trend(p, cm, pairs, lev, rotations=False):
    out, late, rll, cal = {}, p["late"], p["r_ll"], p.cal
    for sig, veh in pairs:
        for n in (50, 100, 200):
            on = (late[sig] > E.sma(late[sig], n)) & late[veh].notna()
            out[f"{veh} while {sig} is above its {n}-day average"] = E.run_weights(p, pd.DataFrame({veh: on.astype(float)}), None, cm)
        vol = rll[sig].rolling(20, min_periods=20).std() * math.sqrt(E.PPY) * lev
        up = late[sig] > E.sma(late[sig], 200)
        for tgt in ((0.25, 0.40) if lev == 3 else (0.10, 0.15)):
            for tf in (False, True):
                w = (tgt / vol).clip(upper=1.0).where(late[veh].notna(), 0.0)
                if tf:
                    w = w.where(up, 0.0)
                out[f"{veh} sized to {int(tgt * 100)}% volatility{', only above the 200-day average' if tf else ''}"] = E.run_weights(p, pd.DataFrame({veh: w.fillna(0.0)}), None, cm)
    if rotations:
        month_end = (cal["next_tdom"] == 1).to_numpy()                    # tomorrow starts a new month
        pool = ["TQQQ", "TMF", "GLD", "SHY"]
        for look in (63, 126):
            mom = late[pool] / late[pool].shift(look) - 1
            w = pd.DataFrame(0.0, index=p.dates, columns=pool)
            mv = mom.to_numpy()
            full = np.isfinite(mv).all(axis=1)
            cur = -1
            for i in range(len(p.dates)):
                if month_end[i] and full[i]:
                    cur = int(np.argmax(mv[i]))
                if cur >= 0:
                    w.iat[i, cur] = 1.0
            out[f"Each month, the best of TQQQ, TMF, GLD, SHY over the last {look} days"] = E.run_weights(p, w, None, cm)
        up = late["QQQ"] > E.sma(late["QQQ"], 200)
        for alt in ("TMF", "GLD"):
            w = pd.DataFrame({"TQQQ": up.astype(float), alt: (~up & E.sma(late["QQQ"], 200).notna()).astype(float)})
            out[f"TQQQ while QQQ is above its 200-day average, otherwise {alt}"] = E.run_weights(p, w, None, cm)
    return out


def fam_short_vol(p, cm):
    out, late, rll = {}, p["late"], p["r_ll"]
    sv, vx = late["SVXY"], late["VIXY"]
    ok = sv.notna()
    def run(cond):
        return E.run_weights(p, pd.DataFrame({"SVXY": (cond & ok).astype(float)}), None, cm)
    out["SVXY always"] = run(pd.Series(True, index=p.dates))
    for n in (5, 10, 20):
        out[f"SVXY while VIXY is below its {n}-day average"] = run(vx < E.sma(vx, n))
    out["SVXY while it is above its own 50-day average"] = run(sv > E.sma(sv, 50))
    out["SVXY while VIXY is below its 10-day average and QQQ is in an uptrend"] = run((vx < E.sma(vx, 10)) & (late["QQQ"] > E.sma(late["QQQ"], 200)))
    out["SVXY while SPY's 5-day volatility is below its 20-day volatility"] = run(rll["SPY"].rolling(5).std() < rll["SPY"].rolling(20).std())
    return out


def fam_sector(p, cm):
    out, late, ibs, cal = {}, p["late"], p["ibs"], p.cal
    def bottom(score, k, valid):
        rk = score.where(valid).rank(axis=1, method="first")
        return ((rk <= k) & valid).astype(float) / k
    valid = late[SECT].notna()
    for k in (1, 3):
        for look in (1, 5):
            r = late[SECT] / late[SECT].shift(look) - 1
            out[f"The {k} weakest sector ETF{'s' if k > 1 else ''} of the last {look} day{'s' if look > 1 else ''}, held one day"] = \
                E.run_weights(p, bottom(r, k, valid & r.notna()), None, cm)
    out["The 3 sector ETFs lowest in their day's range, held one day"] = E.run_weights(p, bottom(ibs[SECT], 3, valid & ibs[SECT].notna()), None, cm)
    vb = late[BROAD].notna() & ibs[BROAD].notna()
    out["The 3 index or sector ETFs lowest in their day's range, held one day"] = E.run_weights(p, bottom(ibs[BROAD], 3, vb), None, cm)
    month_end = (cal["next_tdom"] == 1).to_numpy()
    for look in (63, 126, 252):
        mom = late[SECT] / late[SECT].shift(look) - 1
        top = bottom(-mom, 3, valid & mom.notna())
        w = top.where(pd.Series(month_end, index=p.dates), np.nan).ffill().fillna(0.0)
        out[f"Each month, the 3 strongest sector ETFs of the last {look} days"] = E.run_weights(p, w, None, cm)
    return out


def fam_night_day(p, cm):
    out, late = {}, p["late"]
    for s in ("GLD", "SLV", "TLT", "USO", "BITO", "IBIT"):
        ok = late[s].notna()
        out[f"{s} overnight only"] = E.run_weights(p, pd.DataFrame({s: ok.astype(float)}), pd.DataFrame({s: 0.0}, index=p.dates), cm)
        day = (ok.shift(1, fill_value=False) & p["o"][s].notna()).astype(float)
        out[f"{s} in the regular session only"] = E.run_weights(p, pd.DataFrame({s: 0.0}, index=p.dates), pd.DataFrame({s: day}), cm)
    return out


def fam_overnight_persistence(p, cm):
    out = {}
    uni = [s for s in p.symbols if s not in ("VXX", "UVXY", "VIXY", "SVXY", "FNGU")]
    ron, late = p["r_on"][uni], p["late"][uni]
    for look in (20, 60, 120):
        avg = ron.rolling(look, min_periods=look).mean()                 # includes this morning's gap, known long before 15:55
        valid = avg.notna() & late.notna()
        rk = avg.where(valid).rank(axis=1, ascending=False, method="first")
        for k in (1, 3):
            wl = ((rk <= k) & valid).astype(float) / k
            out[f"The {k} fund{'s' if k > 1 else ''} or stock{'s' if k > 1 else ''} with the best average night over {look} days, held overnight"] = \
                E.run_weights(p, wl, pd.DataFrame(0.0, index=p.dates, columns=uni), cm)
    return out


def fam_noise_area(p, cm, G):
    out = {}
    q, s = G["QQQ"], G["SPY"]
    vol = p["r_ll"]["QQQ"].rolling(14, min_periods=14).std().shift(1).to_numpy()      # known before today's open
    size_vt = np.clip(0.02 / (3 * vol), 0, 1)
    for sides in ("long", "both"):
        for one in (False, True):
            st = I.noise_area_state(q, sides=sides, one_shot=one)
            nm = f"QQQ breaks out of its noise area: {'TQQQ' if sides == 'long' else 'TQQQ or SQQQ'}{', one trade a day' if one else ''}"
            out[nm] = I.run_states(st, G["TQQQ"], G["SQQQ"] if sides == "both" else None, "TQQQ", "SQQQ" if sides == "both" else None, 1.0, cm)
    st = I.noise_area_state(q, sides="both")
    out["QQQ breaks out of its noise area: TQQQ or SQQQ, sized to 2% daily volatility"] = I.run_states(st, G["TQQQ"], G["SQQQ"], "TQQQ", "SQQQ", size_vt, cm)
    out["QQQ breaks out of its noise area: QQQ itself, long only"] = I.run_states(I.noise_area_state(q, sides="long"), q, None, "QQQ", None, 1.0, cm)
    out["SPY breaks out of its noise area: UPRO, long only"] = I.run_states(I.noise_area_state(s, sides="long"), G["UPRO"], None, "UPRO", None, 1.0, cm)
    return out


def fam_orb(p, cm, G):
    out = {}
    for nb, nm in ((1, "5-minute"), (3, "15-minute"), (6, "30-minute")):
        for sides in ("long", "both"):
            st = I.orb_state(G["QQQ"], nb, sides)
            out[f"QQQ {nm} opening range: {'TQQQ' if sides == 'long' else 'TQQQ or SQQQ'}"] = \
                I.run_states(st, G["TQQQ"], G["SQQQ"] if sides == "both" else None, "TQQQ", "SQQQ" if sides == "both" else None, 1.0, cm)
        out[f"SPY {nm} opening range: UPRO, long only"] = I.run_states(I.orb_state(G["SPY"], nb, "long"), G["UPRO"], None, "UPRO", None, 1.0, cm)
        for sym in ("SOXL", "NVDA", "TSLA"):
            out[f"{sym} {nm} opening range, long only"] = I.run_states(I.orb_state(G[sym], nb, "long"), G[sym], None, sym, None, 1.0, cm)
    return out


def fam_strong_close(p, cm, pairs):
    out, late, ibs = {}, p["late"], p["ibs"]
    for sig, veh in pairs:
        down = late[sig] < E.sma(late[sig], 200)
        for thr in (0.85, 0.75):
            for tf in (False, True):
                cond = (ibs[sig] > thr) & (down if tf else True)
                out[f"{veh} for a day after {sig} closes in the top {int(round((1 - thr) * 100))}% of its range{', only in a downtrend' if tf else ''}"] = _hold_next(p, cond, veh, cm)
    return out


def add_btc_fund(p) -> dict:
    """Add 'XBT' to the panel: bitcoin (Bitstamp) at the ETF's hours, 09:30 and 15:55 New York (13:00 on early closes),
    less a 0.25% yearly fee. It stands in for a spot-bitcoin ETF before one existed; the check against IBIT is returned."""
    m1 = load_btc(ROOT / "data", "1m")
    day0 = p.dates.values.astype("datetime64[s]").astype(np.int64)
    off = I.ny_offset(day0 + 17 * 3600)
    half = np.asarray(p.cal["half"], bool)
    def at(minute):
        idx = (day0 + np.asarray(minute) * 60 - off - int(m1.ts[0])) // 60
        ok = (idx >= 0) & (idx < len(m1))
        return np.where(ok, m1.o[np.clip(idx, 0, len(m1) - 1)], np.nan)
    fee = np.exp(-0.0025 * (day0 - day0[0]) / (365.25 * 86400))
    p.f["o"] = p.f["o"].assign(XBT=at(570) * fee)
    p.f["late"] = p.f["late"].assign(XBT=at(np.where(half, 780, 955)) * fee)
    p.f["r_ll"] = p.f["r_ll"].assign(XBT=p.f["late"]["XBT"] / p.f["late"]["XBT"].shift(1) - 1)
    both = pd.concat([p["r_ll"]["XBT"], p["r_ll"]["IBIT"]], axis=1).dropna()
    both = both[both.index >= "2024-01-16"]
    if len(both) < 30:
        return {}
    d = both["XBT"] - both["IBIT"]
    return {"days": int(len(both)), "correlation_of_daily_returns": float(both.corr().iloc[0, 1]), "mean_daily_difference": float(d.mean()),
            "std_of_daily_difference": float(d.std()), "total_return_rebuilt": float((1 + both["XBT"]).prod() - 1), "total_return_ibit": float((1 + both["IBIT"]).prod() - 1)}


def fam_btc_fund(p, cm):
    out = {}
    late = p["late"]["XBT"]
    ok = late.notna()
    r = p["r_ll"]["XBT"]
    def run(w, wo=None):
        return E.run_weights(p, pd.DataFrame({"XBT": pd.Series(w, index=p.dates).astype(float).where(ok, 0.0).fillna(0.0)}), wo, cm)
    for n in (20, 50, 100):
        out[f"Bitcoin fund while bitcoin is above its {n}-day average"] = run(late > E.sma(late, n))
    for n in (20, 60):
        out[f"Bitcoin fund while bitcoin is higher than {n} days ago"] = run(late > late.shift(n))
    s50 = E.sma(late, 50)
    v10 = r.rolling(10, min_periods=10).std()
    calm = v10 < v10.rolling(500, min_periods=250).quantile(0.9)
    out["Bitcoin fund above its 50-day average, out when 10-day volatility is in its top tenth"] = run((late > s50) & calm)
    v20 = r.rolling(20, min_periods=20).std() * math.sqrt(E.PPY)
    out["Bitcoin fund above its 50-day average, sized to 40% volatility"] = run((0.40 / v20).clip(upper=1.0).where(late > s50, 0.0))
    out["Bitcoin fund overnight only"] = run(ok, pd.DataFrame({"XBT": 0.0}, index=p.dates))
    day = (ok.shift(1, fill_value=False) & p["o"]["XBT"].notna()).astype(float)
    out["Bitcoin fund in the regular session only"] = E.run_weights(p, pd.DataFrame({"XBT": 0.0}, index=p.dates), pd.DataFrame({"XBT": day}), cm)
    return out


# ---- machine learning -----------------------------------------------------------------
_ML_CACHE: dict = {}


def ml_predictions(p):
    """Walk-forward predictions. For each year from 2019 the model is fitted on rows dated before that year
    (targets fully known by then) and predicts that year. Hyperparameters are fixed in advance."""
    key = (len(p.dates), str(p.dates[-1]))
    if key in _ML_CACHE:
        return _ML_CACHE[key]
    from sklearn.ensemble import HistGradientBoostingRegressor
    from sklearn.linear_model import Ridge
    uni = [s for s in ML_UNI if s in p.symbols]
    late, ibs, rll, cal = p["late"][uni], p["ibs"][uni], p["r_ll"][uni], p.cal
    feats = {"ibs": ibs, "r1": rll, "rid": p["r_id"][uni], "ron": p["r_on"][uni], "rsi2": E.rsi(late, 2)}
    for n in (2, 3, 5, 10, 21, 63):
        feats[f"r{n}"] = late / late.shift(n) - 1
    for n in (10, 50, 200):
        feats[f"d{n}"] = late / E.sma(late, n) - 1
    v5, v21 = rll.rolling(5).std(), rll.rolling(21, min_periods=21).std()
    feats["v5"], feats["v21"], feats["vr"] = v5, v21, v5 / v21
    rng = p["hi_late"][uni] / p["lo_late"][uni] - 1
    feats["rng"] = rng / rng.rolling(21, min_periods=10).mean()
    vol = p["v955"][uni].where(p["v955"][uni].notna(), p["v"][uni])
    feats["volr"] = vol / vol.rolling(21, min_periods=10).mean().shift(1)
    mx, mn = late.rolling(10).max(), late.rolling(10).min()
    feats["pos10"] = (late - mn) / (mx - mn).where(mx > mn)
    for k in ("r1", "r5", "ibs"):
        feats["x_" + k] = feats[k].rank(axis=1, pct=True)
    mkt = {"m_spy1": p["r_ll"]["SPY"], "m_spy5": p["late"]["SPY"] / p["late"]["SPY"].shift(5) - 1, "m_spyibs": p["ibs"]["SPY"],
           "m_vx1": p["r_ll"]["VIXY"], "m_vx5": p["late"]["VIXY"] / p["late"]["VIXY"].shift(5) - 1, "m_tlt1": p["r_ll"]["TLT"],
           "c_dow": cal["dow"].astype(float), "c_tdom": cal["tdom"].astype(float), "c_rev": cal["tdom_rev"].fillna(-99.0)}
    names = list(feats) + list(mkt)
    n, m = len(p.dates), len(uni)
    X = np.empty((n, m, len(names)))
    for i, k in enumerate(feats):
        X[:, :, i] = feats[k].to_numpy()
    for i, k in enumerate(mkt):
        X[:, :, len(feats) + i] = mkt[k].to_numpy()[:, None]
    risk = v21.to_numpy()
    y = {"night": (p["o"][uni].shift(-1) / late - 1).to_numpy() / risk, "day": (late.shift(-1) / late - 1).to_numpy() / risk}
    years = p.dates.year.to_numpy()
    valid = np.isfinite(X[:, :, :len(feats)]).sum(axis=2) >= len(feats) - 2
    valid &= np.isfinite(risk) & (risk > 0) & late.notna().to_numpy()
    preds = {(mdl, tgt): np.full((n, m), np.nan) for mdl in ("boosted trees", "ridge") for tgt in y}
    for yr in range(E.WF_FIRST_YEAR, int(years.max()) + 1):
        te = years == yr
        tr = np.zeros(n, bool)
        tr[:max(0, int(np.flatnonzero(years >= yr)[0]) - 1)] = True          # the last earlier day's target is not known yet
        if tr.sum() < 500 or not te.any():
            continue
        for tgt, yy in y.items():
            mtr = valid[tr] & np.isfinite(yy[tr])
            Xtr, ytr = X[tr][mtr], np.clip(yy[tr][mtr], -5, 5)
            mte = valid[te]
            Xte = X[te][mte]
            gb = HistGradientBoostingRegressor(max_depth=3, max_iter=150, learning_rate=0.05, min_samples_leaf=300, l2_regularization=1.0,
                                               early_stopping=False, random_state=0).fit(Xtr, ytr)
            mu, sd = np.nanmean(Xtr, axis=0), np.nanstd(Xtr, axis=0)
            sd[sd == 0] = 1.0
            z = lambda a: np.clip(np.nan_to_num((a - mu) / sd), -5, 5)
            rg = Ridge(alpha=100.0).fit(z(Xtr), ytr)
            for mdl, pr in (("boosted trees", gb.predict(Xte)), ("ridge", rg.predict(z(Xte)))):
                blk = preds[(mdl, tgt)][te]
                blk[mte] = pr
                preds[(mdl, tgt)][te] = blk
    _ML_CACHE[key] = (uni, preds, y, valid)
    return _ML_CACHE[key]


def fam_ml(p, cm):
    uni, preds, _, _ = ml_predictions(p)
    out = {}
    for (mdl, tgt), pr in preds.items():
        d = pd.DataFrame(pr, index=p.dates, columns=uni)
        rk = d.rank(axis=1, ascending=False, method="first")
        for k in (1, 3):
            wl = ((rk <= k) & (d > 0)).astype(float) / k
            wo = pd.DataFrame(0.0, index=p.dates, columns=uni) if tgt == "night" else None
            out[f"{mdl}: top {k} by predicted next-{tgt} return, held {'overnight' if tgt == 'night' else 'one day'}"] = E.run_weights(p, wl, wo, cm)
    return out


def ml_diagnostics(p) -> dict:
    """How good are the out-of-sample rankings themselves, before any trading rule? (2019-2022 and 2023+.)"""
    uni, preds, y, valid = ml_predictions(p)
    out = {}
    for (mdl, tgt), pr in preds.items():
        yy = y[tgt]
        for name, m in (("2019-2022", (p.dates.year >= 2019) & (p.dates < E.HOLDOUT)), ("2023+", p.dates >= E.HOLDOUT)):
            ic = []
            for i in np.flatnonzero(m):
                ok = np.isfinite(pr[i]) & np.isfinite(yy[i])
                if ok.sum() >= 10:
                    ic.append(pd.Series(pr[i][ok]).corr(pd.Series(yy[i][ok]), method="spearman"))
            ic = np.array(ic)
            if len(ic) > 30:
                out[f"{mdl}, next {tgt}, {name}"] = {"days": int(len(ic)), "mean_rank_correlation": float(ic.mean()),
                                                     "t_stat": float(ic.mean() / (ic.std(ddof=1) / math.sqrt(len(ic))))}
    return out


# ---- ensemble ---------------------------------------------------------------------------
def fam_ensemble(p, sleeves: dict[str, np.ndarray], benches: dict[str, np.ndarray]) -> dict:
    """Sleeves are the walk-forward return series of other families (out of sample from 2019 by construction).
    At the start of each year from 2021 a sleeve is eligible if its Sharpe from 2019 to the end of the previous
    year is (rule A) at least 1.0, or (rule B) above that of the better of holding SPY and holding QQQ over the
    same span. Eligible sleeves (the best 3, the best 5, or all) are weighted equally or by the inverse of their
    trailing 63-day volatility, lagged a day. Nothing from the year being traded, or later, enters the choice."""
    out = {}
    years = p.dates.year.to_numpy()
    ids = list(sleeves)
    R = np.column_stack([sleeves[k] for k in ids])
    vol = pd.DataFrame(R).rolling(63, min_periods=40).std().shift(1).to_numpy()
    sharpe = lambda x: x.mean() / x.std() * math.sqrt(E.PPY) if x.std() > 0 else -9.0
    for rule, rname in (("abs", "past Sharpe of 1 or more"), ("bench", "past Sharpe above holding")):
        for top, tname in ((3, "best 3"), (5, "best 5"), (99, "all")):
            for wt in ("inverse volatility", "equal"):
                ret, expo_n, members = np.zeros(len(years)), np.zeros(len(years)), {}
                for yr in range(2021, int(years.max()) + 1):
                    past, cur = (years >= E.WF_FIRST_YEAR) & (years < yr), years == yr
                    if not cur.any():
                        continue
                    bar = 1.0 if rule == "abs" else max(sharpe(b[past]) for b in benches.values())
                    sh = {j: sharpe(R[past, j]) for j in range(len(ids)) if np.prod(1 + R[past, j]) > 1}
                    pick = [j for j, v in sorted(sh.items(), key=lambda kv: -kv[1]) if v >= bar][:top]
                    members[yr] = [ids[j] for j in pick]
                    if not pick:
                        continue
                    if wt == "equal":
                        w = np.full((cur.sum(), len(pick)), 1.0 / len(pick))
                    else:
                        iv = 1.0 / np.where(vol[cur][:, pick] > 0, vol[cur][:, pick], np.nan)
                        tot = np.nansum(iv, axis=1, keepdims=True)
                        w = np.where(tot > 0, np.nan_to_num(iv) / np.where(tot > 0, tot, 1), 1.0 / len(pick))
                    ret[cur] = (w * R[cur][:, pick]).sum(axis=1)
                    expo_n[cur] = 1.0
                out[f"{tname} families with a {rname}, weighted by {wt}"] = {"ret": ret, "expo": expo_n, "members": members}
    return out


NIGHT_FAMS, DAY_FAMS = ["E04a", "E04b", "E14"], ["E05a1", "E05a3", "E05b1", "E05b3", "E05c1", "E05c3", "E09", "E15"]


def fam_stack(p, fam: dict) -> dict:
    """One account shared by up to three sleeves. Each year from 2021 the night sleeve is the overnight-only family
    with the best walk-forward Sharpe from 2019 to the end of the previous year, and the day sleeve the best
    intraday-only family, optionally only if that Sharpe is at least 1. With a weak-close sleeve in front, the
    night and day sleeves get only the money the weak-close sleeve is not using."""
    out = {}
    years = p.dates.year.to_numpy()
    sharpe = lambda x: x.mean() / x.std() * math.sqrt(E.PPY) if x.std() > 0 else -9.0
    zero = np.zeros(len(years))
    specs = {
        "Night and day sleeves (best of each)": (NIGHT_FAMS, DAY_FAMS, None, -9.0),
        "Night and day sleeves (each only with a past Sharpe of 1 or more)": (NIGHT_FAMS, DAY_FAMS, None, 1.0),
        "3x weak close first, then night and day sleeves (best of each)": (NIGHT_FAMS, DAY_FAMS, "E02", -9.0),
        "3x weak close first, then night and day sleeves (each only with a past Sharpe of 1 or more)": (NIGHT_FAMS, DAY_FAMS, "E02", 1.0),
        "Unleveraged: weak close first, then unleveraged night and day sleeves (best of each)": (["E04a"], ["E05a1", "E05b1", "E05c1"], "E01", -9.0),
        "3x weak close first, then the night sleeve only (best)": (NIGHT_FAMS, [], "E02", -9.0),
    }
    for name, (nights, days, mr, bar) in specs.items():
        ret, members = np.zeros(len(years)), {}
        for yr in range(2021, int(years.max()) + 1):
            past, cur = (years >= E.WF_FIRST_YEAR) & (years < yr), years == yr
            if not cur.any():
                continue
            pick = []
            for ids in (nights, days):
                sh = {k: sharpe(fam[k]["_wf_ret"][past]) for k in ids if k in fam}
                k = max(sh, key=sh.get) if sh else None
                pick.append(k if k and sh[k] >= bar else None)
            rn = fam[pick[0]]["_wf_ret"] if pick[0] else zero
            rd = fam[pick[1]]["_wf_ret"] if pick[1] else zero
            nd = (1 + rn) * (1 + rd) - 1
            if mr and mr in fam:
                busy = np.concatenate([[0.0], np.clip(fam[mr]["_wf_expo"][:-1], 0, 1)])       # share of the account the weak-close sleeve carried into the day
                r = (1 + fam[mr]["_wf_ret"]) * (1 + (1 - busy) * nd) - 1
            else:
                r = nd
            ret[cur] = r[cur]
            members[yr] = {"night": pick[0], "day": pick[1], "first": mr}
        out[name] = {"ret": ret, "expo": (ret != 0).astype(float), "members": members}
    return out


# --------------------------------------------------------------------------------------
def summarize(fid: str, res: dict, look: dict | None) -> dict:
    h = HYP[fid]
    hold, b = res["wf_holdout"], res["bench_holdout"].get(res["benchmark"], {})
    th = res.get("wf_trades_holdout") or {}
    cs = res.get("cost_stress", {})
    g = lambda d, k: d.get(k) if d else None
    return {"id": fid, "family": h.family, "verdict": res["verdict"], "settings": res["n_configs"],
            "holdout_sharpe": g(hold, "sharpe"), "holdout_cagr": g(hold, "cagr"), "holdout_max_drawdown": g(hold, "max_drawdown"), "holdout_exposure": g(hold, "exposure"),
            "benchmark": res["benchmark"], "benchmark_holdout_sharpe": g(b, "sharpe"), "benchmark_holdout_cagr": g(b, "cagr"), "benchmark_holdout_max_drawdown": g(b, "max_drawdown"),
            "pre_sharpe": g(res["wf_pre"], "sharpe"), "pre_cagr": g(res["wf_pre"], "cagr"), "pre_max_drawdown": g(res["wf_pre"], "max_drawdown"),
            "deflated_sharpe_prob": res["deflated_sharpe_holdout"].get("dsr"), "p_beats_benchmark": res["vs_bench_holdout"].get("p_better"),
            "share_settings_profitable": res["sensitivity_holdout"].get("share_positive"), "median_setting_sharpe": res["sensitivity_holdout"].get("median_sharpe"),
            "holdout_trades": th.get("trades"), "holdout_win_rate": th.get("win_rate"), "holdout_win_rate_ci95": th.get("win_rate_ci95"),
            "holdout_expectancy": th.get("expectancy"), "holdout_t_stat": th.get("t_stat"),
            "gross_holdout_sharpe": g(cs.get("no costs", {}).get("wf_holdout"), "sharpe"), "costs_x3_holdout_sharpe": g(cs.get("costs x3", {}).get("wf_holdout"), "sharpe"),
            "costs_x3_holdout_cagr": g(cs.get("costs x3", {}).get("wf_holdout"), "cagr"),
            "chosen": res["chosen"], "lookahead_test": look}


def slim(res: dict) -> dict:
    return {k: v for k, v in res.items() if not k.startswith("_")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discovery-only", action="store_true", help="cut the data at 2022-12-31 (development; no holdout numbers)")
    ap.add_argument("--skip-lookahead", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated family ids (development)")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    (OUT / "series").mkdir(exist_ok=True)
    dev = args.discovery_only or bool(args.only)
    led = Ledger(OUT / ("ledger_smoke_tests.jsonl" if dev else "ledger.jsonl"), mode="discovery-only" if dev else "full")

    p = E.load_panel(DATA)
    grids = {s: I.load_grid(DATA, s, p.dates) for s in CORE}
    btc_check = add_btc_fund(p)
    if args.discovery_only:
        p = p.truncate(pd.Timestamp("2022-12-31"))
        grids = {s: g.truncate(p.dates[-1]) for s, g in grids.items()}
    log(f"panel {p.dates[0].date()} -> {p.dates[-1].date()}: {len(p.dates)} sessions, {len(p.symbols)} symbols; 5-minute grids for {len(grids)}")
    benches = {"hold SPY": np.nan_to_num(p["r_ll"]["SPY"].to_numpy()), "hold QQQ": np.nan_to_num(p["r_ll"]["QQQ"].to_numpy())}

    def G(pp):
        return grids if len(pp.dates) == len(p.dates) else {s: g.truncate(pp.dates[-1]) for s, g in grids.items()}

    one = [(s, s) for s in ("SPY", "QQQ", "IWM")]
    three = [("SPY", "UPRO"), ("QQQ", "TQQQ"), ("IWM", "TNA")]
    plan = {
        "E01": lambda pp, cm: fam_weak_close(pp, cm, {"QQQ": (["QQQ"], 1), "SPY": (["SPY"], 1), "4 index ETFs, 2 at a time": (IDX, 2), "15 index and sector ETFs, 3 at a time": (BROAD, 3),
                                                      "10 large stocks, 3 at a time": (MEGA, 3)}, (False,), ("strength", "up", "hold")),
        "E02": lambda pp, cm: fam_weak_close(pp, cm, {"TQQQ": (["TQQQ"], 1), "4 leveraged index ETFs, 2 at a time": (LEV_IDX, 2), "9 leveraged ETFs, 3 at a time": (LEV_BROAD, 3)}, (False, True), ("strength", "hold")),
        "E03a": lambda pp, cm: fam_rsi2(pp, cm, one),
        "E03b": lambda pp, cm: fam_rsi2(pp, cm, three),
        "E04a": lambda pp, cm: fam_overnight(pp, cm, one),
        "E04b": lambda pp, cm: fam_overnight(pp, cm, [("SPY", "UPRO"), ("QQQ", "TQQQ"), ("SMH", "SOXL")]),
        "E05a1": lambda pp, cm: fam_gap(pp, cm, [("SPY", "SPY"), ("QQQ", "QQQ")]),
        "E05a3": lambda pp, cm: fam_gap(pp, cm, [("SPY", "UPRO"), ("QQQ", "TQQQ")]),
        "E05b1": lambda pp, cm: fam_late_momentum(pp, cm, [("SPY", "SPY", "SH"), ("QQQ", "QQQ", "PSQ"), ("IWM", "IWM", None)]),
        "E05b3": lambda pp, cm: fam_late_momentum(pp, cm, [("SPY", "UPRO", "SPXU"), ("QQQ", "TQQQ", "SQQQ"), ("IWM", "TNA", "TZA")]),
        "E05c1": lambda pp, cm: fam_morning_momentum(pp, cm, [("SPY", "SPY", "SH"), ("QQQ", "QQQ", "PSQ"), ("IWM", "IWM", None)]),
        "E05c3": lambda pp, cm: fam_morning_momentum(pp, cm, [("SPY", "UPRO", "SPXU"), ("QQQ", "TQQQ", "SQQQ"), ("IWM", "TNA", "TZA")]),
        "E06a": lambda pp, cm: fam_calendar(pp, cm, ["SPY", "QQQ"], "TLT"),
        "E06b": lambda pp, cm: fam_calendar(pp, cm, ["UPRO", "TQQQ"], "TMF"),
        "E07a": lambda pp, cm: fam_trend(pp, cm, [("SPY", "SPY"), ("QQQ", "QQQ")], 1),
        "E07b": lambda pp, cm: fam_trend(pp, cm, [("SPY", "UPRO"), ("QQQ", "TQQQ"), ("SMH", "SOXL")], 3, rotations=True),
        "E08": lambda pp, cm: fam_short_vol(pp, cm),
        "E09": lambda pp, cm: fam_noise_area(pp, cm, G(pp)),
        "E10": lambda pp, cm: fam_sector(pp, cm),
        "E11": lambda pp, cm: fam_night_day(pp, cm),
        "E12": lambda pp, cm: fam_ml(pp, cm),
        "E14": lambda pp, cm: fam_overnight_persistence(pp, cm),
        "E15": lambda pp, cm: fam_orb(pp, cm, G(pp)),
        "E16a": lambda pp, cm: fam_strong_close(pp, cm, [("SPY", "SH"), ("QQQ", "PSQ")]),
        "E16b": lambda pp, cm: fam_strong_close(pp, cm, [("SPY", "SPXU"), ("QQQ", "SQQQ")]),
        "E17": lambda pp, cm: fam_btc_fund(pp, cm),
    }
    only = [x for x in args.only.split(",") if x]
    cuts = ["2019-03-15", "2020-03-20", "2021-06-30", "2022-01-21"]
    if not args.discovery_only:
        cuts += ["2023-08-09", "2024-03-28", "2024-11-29", "2025-04-08"]
    fam, rows, total = {}, [], 0
    for fid, build in plan.items():
        if only and fid not in only:
            continue
        h = HYP[fid]
        res1 = build(p, 1.0)
        look = None
        if not args.skip_lookahead:
            look = E.truncation_test(lambda pp: build(pp, 1.0), p, cuts[2::3] if fid == "E12" else cuts)
        bb = dict(benches, **{"hold the bitcoin fund": np.nan_to_num(p["r_ll"]["XBT"].to_numpy())}) if fid == "E17" else benches
        res = E.evaluate_family(p, res1, bb, {"no costs": build(p, 0.0), "costs x3": build(p, 3.0)}, lookahead_ok=(look or {"passed": True})["passed"])
        fam[fid] = res
        total += len(res1)
        row = summarize(fid, res, look)
        rows.append(row)
        led.record(fid, h.statement, h.kill_rule, res["verdict"], slim(res), h.family, trials=len(res1), notes=h.source)
        f2 = lambda x: "  n/a" if x is None else f"{x:5.2f}"
        log(f"{fid:6s} {h.family[:44]:44s} {len(res1):3d} settings | pre Sharpe {f2(row['pre_sharpe'])} | holdout Sharpe {f2(row['holdout_sharpe'])} vs {f2(row['benchmark_holdout_sharpe'])} "
            f"| lookahead {'ok' if (look or {}).get('passed', True) else 'FAILED'} | {res['verdict']}")
        if not dev:
            pd.DataFrame({"date": p.dates.date, "strategy": res["_wf_ret"], "exposure": res["_wf_expo"]}).to_csv(OUT / "series" / f"{fid}.csv", index=False)

    ens = {}
    if not only:
        for eid, members in (("E13a", ONE_X), ("E13b", LEVERED), ("E18", None)):
            if members is None:
                res1 = fam_stack(p, fam)
            else:
                res1 = fam_ensemble(p, {k: fam[k]["_wf_ret"] for k in members if k in fam}, benches)
            res = E.evaluate_family(p, res1, benches, None, wf_first_year=2022)
            res["members_by_year"] = {k: v["members"] for k, v in res1.items()}
            fam[eid] = res
            total += len(res1)
            row = summarize(eid, res, None)
            rows.append(row)
            led.record(eid, HYP[eid].statement, HYP[eid].kill_rule, res["verdict"], slim(res), HYP[eid].family, trials=len(res1), notes=HYP[eid].source)
            log(f"{eid:6s} {HYP[eid].family[:44]:44s} {len(res1):3d} settings | holdout Sharpe {row['holdout_sharpe']} vs {row['benchmark_holdout_sharpe']} | {res['verdict']}")
            if not dev:
                pd.DataFrame({"date": p.dates.date, "strategy": res["_wf_ret"], "exposure": res["_wf_expo"]}).to_csv(OUT / "series" / f"{eid}.csv", index=False)

    summary = {"run_id": led.run_id, "mode": led.mode, "holdout_start": str(E.HOLDOUT.date()), "walk_forward_first_year": E.WF_FIRST_YEAR,
               "data": {"first": str(p.dates[0].date()), "last": str(p.dates[-1].date()), "sessions": len(p.dates), "symbols": len(p.symbols),
                        "files": data_fingerprint([DATA / "sessions.npz", DATA / "daily.npz"])},
               "total_settings_tried": total, "ranking": rows,
               "benchmarks": {k: {"holdout": E.stats(b[E.masks(p.dates)["holdout"]]), "pre": E.stats(b[E.masks(p.dates)["wf_pre"]])} for k, b in benches.items()},
               "families": {k: slim(v) for k, v in fam.items()}}
    summary["bitcoin_fund_check"] = btc_check
    if "E12" in fam:
        summary["ml_diagnostics"] = ml_diagnostics(p)
    name = "equity_summary_dev.json" if dev else "equity_summary.json"
    (OUT / name).write_text(json.dumps(_clean(summary), indent=1))
    log(f"wrote results/{name}: {len(rows)} families, {total} settings")


if __name__ == "__main__":
    main()
