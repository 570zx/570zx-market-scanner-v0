// Intraday SPY strategies on one-minute bars. Pure functions.
//
// A session is {date, early, spy: {open, px, vwap}, sh: {open, px, vwap}} where
// px[m] is the close of the one-minute bar starting m minutes after 09:30 ET
// (m = 0..389) and vwap[m] the session VWAP through that bar. A decision at
// wall time T uses bars that completed by T (px[T-1]); its order fills at the
// close of the next bar (px[T]), one minute of latency, plus a cost per side.
// Everything is flat by the close (px[389]). Early-close days are skipped.

export const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m - 570; };
export const CLOSE_BAR = 389;
export const CHECKS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'].map(at);
export const COST = {spy: 0.0002, sh: 0.0005};

// Noise band width per check time: mean |move from the open| at that time over the prior `lookback` sessions.
export function noiseSigma(sessions, lookback = 14) {
  const out = new Array(sessions.length).fill(null);
  for (let i = lookback; i < sessions.length; i++) {
    const sig = {};
    for (const t of CHECKS) {
      let sum = 0, n = 0;
      for (let k = i - lookback; k < i; k++) {
        const s = sessions[k].spy; if (sessions[k].early || !s) continue;
        const p = s.px[t - 1]; if (p > 0 && s.open > 0) { sum += Math.abs(p / s.open - 1); n++; }
      }
      sig[t] = n >= lookback * 0.7 ? sum / n : NaN;
    }
    out[i] = sig;
  }
  return out;
}

// Run one strategy: returns the daily equity curve and trades.
// strategy.day(ctx, i) returns a list of legs [{side: 'spy'|'sh', entry: minute, exit: minute}] for session i,
// or uses ctx.sim for path-dependent logic.
export function runIntraday({sessions, strategy, startEquity = 250, costScale = 1}) {
  let equity = startEquity;
  const curve = [], trades = [];
  let invested = 0;
  const ctx = {sessions, sigma: strategy.needsSigma ? noiseSigma(sessions) : null};
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const legs = s.early || i === 0 ? [] : strategy.legs(ctx, i);
    let dayMult = 1;
    for (const leg of legs) {
      const series = s[leg.side]; if (!series) continue;
      const pIn = series.px[leg.entry], pOut = series.px[leg.exit];
      if (!(pIn > 0 && pOut > 0) || leg.exit <= leg.entry) continue;
      const c = COST[leg.side] * costScale;
      const r = (pOut * (1 - c)) / (pIn * (1 + c)) - 1;
      dayMult *= 1 + r;
      trades.push({date: s.date, side: leg.side, entry: leg.entry, exit: leg.exit, retPct: r * 100, reason: leg.reason ?? ''});
    }
    if (legs.length) invested++;
    equity *= dayMult;
    curve.push(equity);
  }
  return {id: strategy.id, curve, trades, from: 0, startEquity, invested: sessions.length ? invested / sessions.length : 0, turnover: trades.length * 2};
}

const prevClose = (sessions, i) => { const p = sessions[i - 1]; return p?.spy ? p.spy.px[CLOSE_BAR] : NaN; };

// Zarattini, Aziz & Barbon (2024) "Beat the Market": trade SPY when it leaves the
// noise band around the open; exit when it falls back through max(band, VWAP).
// Long-only account: the short side is taken by buying SH (1x inverse), or skipped.
export const noiseArea = ({shortWithSH}) => ({
  id: shortWithSH ? 'noise_spy_sh' : 'noise_spy_long',
  label: `SPY noise-band breakout (Zarattini et al. 2024), checked every 30 minutes from 10:00: long SPY above the upper band${shortWithSH ? ', long SH (inverse) below the lower band' : ''}; exit on a close back through the band/VWAP; flat at 16:00.`,
  needsSigma: true,
  legs(ctx, i) {
    const s = ctx.sessions[i], sig = ctx.sigma[i], pc = prevClose(ctx.sessions, i);
    if (!sig || !(pc > 0) || !(s.spy?.open > 0)) return [];
    const legs = [];
    let pos = null, entry = null;
    for (const t of CHECKS) {
      const p = s.spy.px[t - 1], vw = s.spy.vwap[t - 1], sg = sig[t];
      if (!(p > 0) || !Number.isFinite(sg)) continue;
      const ub = Math.max(s.spy.open, pc) * (1 + sg), lb = Math.min(s.spy.open, pc) * (1 - sg);
      if (pos === 'spy' && p < Math.max(ub, vw)) { legs.push({side: 'spy', entry, exit: t, reason: 'band'}); pos = null; }
      else if (pos === 'sh' && p > Math.min(lb, vw)) { legs.push({side: 'sh', entry, exit: t, reason: 'band'}); pos = null; }
      if (!pos) {
        if (p > ub) { pos = 'spy'; entry = t; }
        else if (p < lb && shortWithSH && s.sh) { pos = 'sh'; entry = t; }
      }
    }
    if (pos) legs.push({side: pos, entry, exit: CLOSE_BAR, reason: 'close'});
    return legs;
  },
});

// Gao, Han, Li & Zhou (2018): the first half-hour's return predicts the last half-hour's.
// Trade 15:30 -> 16:00 when the prior close -> 10:00 return and the 15:00 -> 15:30 return agree.
export const lastHalfHour = ({shortWithSH}) => ({
  id: shortWithSH ? 'last30_spy_sh' : 'last30_spy_long',
  label: `Last-half-hour momentum (Gao et al. 2018): at 15:30, if SPY is up from yesterday's close to 10:00 and up from 15:00 to 15:30, hold SPY to the close${shortWithSH ? '; if both are down, hold SH to the close' : ''}.`,
  legs(ctx, i) {
    const s = ctx.sessions[i], pc = prevClose(ctx.sessions, i);
    const p10 = s.spy?.px[at('10:00') - 1], p1500 = s.spy?.px[at('15:00') - 1], p1530 = s.spy?.px[at('15:30') - 1];
    if (!(pc > 0 && p10 > 0 && p1500 > 0 && p1530 > 0)) return [];
    const r1 = p10 / pc - 1, r12 = p1530 / p1500 - 1;
    if (r1 > 0 && r12 > 0) return [{side: 'spy', entry: at('15:30'), exit: CLOSE_BAR}];
    if (shortWithSH && r1 < 0 && r12 < 0 && s.sh) return [{side: 'sh', entry: at('15:30'), exit: CLOSE_BAR}];
    return [];
  },
});

// Claim seen on Moltbook (m/trading, Jan 2026, 47 sessions, "73% win rate"):
// fade SPY's 15:40 -> 15:50 move into the close.
export const fade350 = ({shortWithSH}) => ({
  id: shortWithSH ? 'fade350_spy_sh' : 'fade350_spy_long',
  label: `"3:50 PM fade" (a Moltbook agent's claim): at 15:50, if SPY fell from 15:40 to 15:50, hold SPY to the close${shortWithSH ? '; if it rose, hold SH to the close' : ''}.`,
  legs(ctx, i) {
    const s = ctx.sessions[i], a = s.spy?.px[at('15:40') - 1], b = s.spy?.px[at('15:50') - 1];
    if (!(a > 0 && b > 0) || a === b) return [];
    if (b < a) return [{side: 'spy', entry: at('15:50'), exit: CLOSE_BAR}];
    return shortWithSH && s.sh ? [{side: 'sh', entry: at('15:50'), exit: CLOSE_BAR}] : [];
  },
});

// Reference rows: where SPY's return comes from.
export const intradayOnly = {
  id: 'ref_spy_open_to_close', label: 'Reference: own SPY from 09:31 to 16:00 every day (flat overnight).',
  legs: (ctx, i) => [{side: 'spy', entry: 1, exit: CLOSE_BAR}],
};
export const overnightOnly = {
  id: 'ref_spy_close_to_open', label: 'Reference: own SPY from 16:00 to 09:31 the next day (flat during the day).',
  // Modeled as a separate path in runOvernight below.
  overnight: true,
};

// Overnight holding: buy at yesterday's close, sell at today's 09:31 bar.
export function runOvernight({sessions, startEquity = 250, costScale = 1}) {
  let equity = startEquity; const curve = [], trades = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i], p = sessions[i - 1];
    if (i > 0 && !s.early && !p?.early && p?.spy && s.spy) {
      const pIn = p.spy.px[CLOSE_BAR], pOut = s.spy.px[1];
      if (pIn > 0 && pOut > 0) {
        const c = COST.spy * costScale, r = (pOut * (1 - c)) / (pIn * (1 + c)) - 1;
        equity *= 1 + r; trades.push({date: s.date, side: 'spy', retPct: r * 100});
      }
    }
    curve.push(equity);
  }
  return {id: overnightOnly.id, curve, trades, from: 0, startEquity, invested: 1, turnover: trades.length * 2};
}

export function tradeStats(trades) {
  const n = trades.length, wins = trades.filter(t => t.retPct > 0).length;
  const r = x => Math.round(x * 1000) / 1000;
  return {n, winRatePct: n ? Math.round(wins / n * 1000) / 10 : null, avgTradePct: n ? r(trades.reduce((a, t) => a + t.retPct, 0) / n) : null};
}
