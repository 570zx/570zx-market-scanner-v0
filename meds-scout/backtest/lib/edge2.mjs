// Edge hunt 2: ideas not tested before. Pure strategy definitions for runAllocation.
// All rules and numbers are fixed here before the run (pre-registered); nothing is tuned.
import {sma, trailingVol, ibs, lastOfMonth} from './edge-daily.mjs';

const col = (ctx, key, make) => { if (!ctx.cache.has(key)) ctx.cache.set(key, make()); return ctx.cache.get(key); };
const smaOf = (ctx, sym, n) => col(ctx, `sma:${sym}:${n}`, () => sma(ctx.bars[sym].c, n));
const DAY = 86400000;
const gapDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const weekday = s => new Date(s + 'T12:00:00Z').getUTCDay();

// Turn of the month: own the index from the close of the month's last session to the close of the
// 3rd session of the new month (so the last day's overnight plus the first three days). flags[d] = hold over d -> d+1.
export function turnOfMonthFlags(sessions) {
  const f = new Uint8Array(sessions.length);
  for (let d = 0; d < sessions.length; d++) {
    if (lastOfMonth(sessions, d)) { f[d] = 1; continue; }
    const m = sessions[d].slice(0, 7);
    let k = 0; // position within the month (0 = first session)
    for (let j = d - 1; j >= 0 && sessions[j].slice(0, 7) === m; j--) k++;
    if (k <= 1) f[d] = 1; // hold over 1st->2nd and 2nd->3rd sessions
  }
  return f;
}

// Session k is the last before a market holiday (a weekday with no trading), not an ordinary weekend.
export function isPreHoliday(sessions, k) {
  if (k >= sessions.length - 1) return false;
  const g = gapDays(sessions[k], sessions[k + 1]);
  return g > 3 || (g > 1 && weekday(sessions[k]) !== 5);
}
// Hold over d -> d+1 when d+1 is a pre-holiday session (the classic pre-holiday day return).
export function preHolidayFlags(sessions) {
  const f = new Uint8Array(sessions.length);
  for (let d = 0; d < sessions.length - 1; d++) if (isPreHoliday(sessions, d + 1)) f[d] = 1;
  return f;
}

export const calendarHold = (id, label, sym, makeFlags) => ({
  id, label, exec: 'close', cost: 0.0005,
  init: ctx => ({flags: makeFlags(ctx.sessions), in: false}),
  weights(ctx, d, st) {
    if (!(ctx.bars[sym].c[d] > 0)) return null;
    const want = st.flags[d] === 1;
    if (want === st.in) return null;
    st.in = want;
    return want ? {[sym]: 1} : {};
  },
});

// Trend with volatility targeting: while QQQ > its 200-day average hold TQQQ sized to about 45% annual
// volatility (20-day realised), at most 100%; the rest in T-bills. Rebalance only on 10+ point changes.
export const volTargetTrend = ({signal = 'QQQ', hold = 'TQQQ', target = 0.45} = {}) => ({
  id: `voltarget_${hold}`, label: `Hold ${hold} while ${signal} is above its 200-day average, sized to ${Math.round(target * 100)}% annual volatility (20-day), rest in BIL; BIL when below.`,
  exec: 'close', cost: 0.0005, cashLike: ['BIL'], band: 0.10,
  weights(ctx, d) {
    const c = ctx.bars[signal].c, m = smaOf(ctx, signal, 200)[d];
    if (!(c[d] > 0) || !Number.isFinite(m)) return null;
    if (c[d] <= m) return {BIL: 1};
    const v = trailingVol(ctx.bars[hold].c, d, 20);
    const w = Number.isFinite(v) && v > 0 ? Math.min(1, target / v) : 0.5;
    return {[hold]: Math.round(w * 20) / 20, BIL: 1 - Math.round(w * 20) / 20};
  },
});

// The "split" option: half the account follows the TQQQ trend switch, half runs IBS mean reversion on QQQ.
export const splitTrendIbs = () => ({
  id: 'split_trendTQQQ_ibsQQQ', label: 'Half: TQQQ while QQQ > 200-day average (else BIL). Half: IBS on QQQ (buy close in bottom 20% of range, sell close in top 20%; cash when out).',
  exec: 'close', cost: 0.0005, cashLike: ['BIL'],
  weights(ctx, d, st) {
    const q = ctx.bars.QQQ, m = smaOf(ctx, 'QQQ', 200)[d];
    if (!(q.c[d] > 0) || !Number.isFinite(m)) return null;
    const up = q.c[d] > m, x = ibs(q, d);
    let ibsIn = st.ibsIn ?? false;
    if (!ibsIn && x < 0.2) ibsIn = true; else if (ibsIn && x > 0.8) ibsIn = false;
    if (up === st.up && ibsIn === st.ibsIn) return null;
    st.up = up; st.ibsIn = ibsIn;
    const w = up ? {TQQQ: 0.5} : {BIL: 0.5};
    if (ibsIn) w.QQQ = 0.5;
    return w;
  },
});

// Trend plus turn of month: TQQQ in uptrends; in downtrends own QQQ only in turn-of-month windows, else BIL.
export const trendWithTom = () => ({
  id: 'trend_TQQQ_tom', label: 'TQQQ while QQQ > 200-day average; when below, QQQ only during turn-of-month windows (last session to 3rd session), otherwise BIL.',
  exec: 'close', cost: 0.0005, cashLike: ['BIL'],
  init: ctx => ({flags: turnOfMonthFlags(ctx.sessions)}),
  weights(ctx, d, st) {
    const q = ctx.bars.QQQ, m = smaOf(ctx, 'QQQ', 200)[d];
    if (!(q.c[d] > 0) || !Number.isFinite(m)) return null;
    const mode = q.c[d] > m ? 'T' : st.flags[d] ? 'Q' : 'B';
    if (mode === st.mode) return null;
    st.mode = mode;
    return mode === 'T' ? {TQQQ: 1} : mode === 'Q' ? {QQQ: 1} : {BIL: 1};
  },
});

// Crypto: hold the coin while it closes above its n-day average, otherwise cash. Robinhood charges no
// commission but builds a spread into crypto prices; 0.30% per side is assumed (doubled in the stress test).
export const cryptoTrend = (sym, n) => ({
  id: `trend${n}_${sym.replace('/USD', '')}`, label: `Hold ${sym} while it closes above its ${n}-day average; cash otherwise. Checked daily at 00:00 UTC.`,
  exec: 'close', cost: 0.003,
  weights(ctx, d, st) {
    const c = ctx.bars[sym].c, m = smaOf(ctx, sym, n)[d];
    if (!(c[d] > 0) || !Number.isFinite(m)) return null;
    const up = c[d] > m;
    if (up === st.in) return null;
    st.in = up;
    return up ? {[sym]: 1} : {};
  },
});
export const cryptoHold = sym => ({
  id: `hold_${sym.replace('/USD', '')}`, label: `Buy and hold ${sym} (benchmark)`, exec: 'close', cost: 0.003,
  weights: (ctx, d, st) => { if (st.done || !(ctx.bars[sym].c[d] > 0)) return null; st.done = true; return {[sym]: 1}; },
});
