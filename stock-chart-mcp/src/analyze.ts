// Turns bars into indicator series, a structured read-out and a plain-English
// summary. Descriptive only: it reports what the indicators show and never
// tells anyone to buy or sell.

import type { Bar, RangeKey } from './alpaca.ts';
import { RANGES, sessionOf, type IntervalKey, type RangeSpec, type Session } from './alpaca.ts';
import { etParts } from './time.ts';
import * as ind from './indicators.ts';

export type Signal = { key: string; text: string };
export type WatchState = {
  above_vwap: boolean | null; rsi_zone: 'overbought' | 'oversold' | 'neutral' | null;
  macd_side: 'bull' | 'bear' | null; session_high: number | null; session_low: number | null;
};

export type Analysis = ReturnType<typeof analyze>;

// Arithmetic rounding: toFixed() is slow across thousands of per-bar values.
const POW = [1, 10, 100, 1000, 10000];
const round = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * POW[d]) / POW[d]);
export const priceDigits = (p: number) => (p >= 1 ? 2 : 4);
const fmt = (v: number | null, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

export function analyze(symbol: string, range: RangeKey, bars: Bar[],
  opts: { prevClose?: number | null; spec?: RangeSpec; interval?: IntervalKey } = {}) {
  if (bars.length < 2) throw new Error('NOT_ENOUGH_BARS');
  const spec = opts.spec ?? RANGES[range];
  const closes = bars.map(b => b.c);
  const dates = bars.map(b => etParts(b.t).date);
  const sessions: Session[] = bars.map(b => sessionOf(b.t, spec));
  const series = {
    sma20: ind.sma(closes, 20),
    sma50: ind.sma(closes, 50),
    ema9: ind.ema(closes, 9),
    ema21: ind.ema(closes, 21),
    bb: ind.bollinger(closes, 20, 2),
    rsi: ind.rsi(closes, 14),
    macd: ind.macd(closes),
    atr: ind.atr(bars, 14),
    vwap: spec.intraday && spec.vwap !== false ? regularVwap(bars, sessions, dates) : null,
  };

  const lastBar = bars[bars.length - 1];
  const price = lastBar.c;
  const d = priceDigits(price);
  const sessionBars = spec.intraday ? bars.filter((_, i) => dates[i] === dates[dates.length - 1]) : bars;
  const high = Math.max(...bars.map(b => b.h)), low = Math.min(...bars.map(b => b.l));
  const base = opts.prevClose ?? bars[0].o;
  const change = price - base, changePct = (change / base) * 100;

  const v = {
    sma20: ind.last(series.sma20), sma50: ind.last(series.sma50),
    ema9: ind.last(series.ema9), ema21: ind.last(series.ema21),
    vwap: series.vwap ? ind.last(series.vwap) : null,
    rsi: ind.last(series.rsi), atr: ind.last(series.atr),
    macd: ind.last(series.macd.line), macdSignal: ind.last(series.macd.signal), macdHist: ind.last(series.macd.hist),
    bbUpper: ind.last(series.bb.upper), bbLower: ind.last(series.bb.lower), bbMid: ind.last(series.bb.mid),
  };

  // Relative volume: last bar vs the previous 20 bars of the same session
  // type (after-hours bars are not compared with the regular session).
  const lastSession = sessions[sessions.length - 1];
  const prior = bars.slice(0, -1).filter((_, i) => sessions[i] === lastSession).slice(-20);
  const avgVol = prior.length ? prior.reduce((a, b) => a + b.v, 0) / prior.length : 0;
  const relVol = avgVol > 0 ? lastBar.v / avgVol : null;

  // Bollinger bandwidth percentile (squeeze detection).
  const bw = series.bb.upper.map((u, i) => (u != null ? (u - series.bb.lower[i]!) / series.bb.mid[i]! : null))
    .filter((x): x is number => x != null).slice(-100);
  const bwNow = bw[bw.length - 1];
  const bwRank = bw.length >= 30 ? bw.filter(x => x < bwNow).length / bw.length : null;

  const atrVal = v.atr ?? (high - low) / Math.max(bars.length, 1);
  const levels = ind.swingLevels(bars, spec.intraday ? 3 : 4, atrVal * 0.5);
  const resistance = levels.filter(l => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
  const support = levels.filter(l => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3);

  // Trend: three votes.
  const slope = ind.slopePct(closes, Math.min(30, closes.length));
  const votes = [
    v.ema21 != null ? Math.sign(price - v.ema21) : 0,
    v.ema9 != null && v.ema21 != null ? Math.sign(v.ema9 - v.ema21) : 0,
    Math.abs(slope) < 0.005 ? 0 : Math.sign(slope),
  ];
  const score = votes.reduce((a, b) => a + b, 0);
  const trend = score >= 2 ? 'uptrend' : score <= -2 ? 'downtrend' : 'sideways / mixed';

  const signals: Signal[] = [];
  const add = (key: string, text: string) => signals.push({ key, text });
  if (lastSession === 'pre' || lastSession === 'post')
    add(`${lastSession}_market`, `Latest bar is ${lastSession === 'pre' ? 'premarket' : 'after-hours'}: thin liquidity, moves can reverse at the open`);
  if (v.rsi != null) {
    if (v.rsi >= 70) add('rsi_overbought', `RSI ${v.rsi.toFixed(0)}: overbought`);
    else if (v.rsi <= 30) add('rsi_oversold', `RSI ${v.rsi.toFixed(0)}: oversold`);
  }
  const mc = ind.lastCross(series.macd.line, series.macd.signal, 3);
  if (mc) add(`macd_cross_${mc.dir}`, `MACD crossed ${mc.dir === 'up' ? 'above' : 'below'} its signal line ${ago(mc.barsAgo)}`);
  const ec = ind.lastCross(series.ema9, series.ema21, 3);
  if (ec) add(`ema_cross_${ec.dir}`, `EMA 9 crossed ${ec.dir === 'up' ? 'above' : 'below'} EMA 21 ${ago(ec.barsAgo)}`);
  if (series.vwap) {
    const vc = ind.lastCross(closes, series.vwap, 3);
    if (vc) add(`vwap_cross_${vc.dir}`, `Price crossed ${vc.dir === 'up' ? 'above' : 'below'} VWAP ${ago(vc.barsAgo)}`);
  }
  if (v.bbUpper != null && price > v.bbUpper) add('bb_above', 'Closed above the upper Bollinger band (stretched)');
  if (v.bbLower != null && price < v.bbLower) add('bb_below', 'Closed below the lower Bollinger band (stretched)');
  if (bwRank != null && bwRank <= 0.15) add('bb_squeeze', 'Bollinger bands are unusually tight (squeeze: a larger move often follows)');
  if (relVol != null && relVol >= 2) add('volume_spike', `Last bar volume is ${relVol.toFixed(1)}x the recent average`);
  if (sessionBars.length > 3) {
    const prevHigh = Math.max(...sessionBars.slice(0, -1).map(b => b.h)), prevLow = Math.min(...sessionBars.slice(0, -1).map(b => b.l));
    if (lastBar.h > prevHigh) add('new_high', spec.intraday ? 'Printing a new high of the day' : 'Printing a new high for the range');
    if (lastBar.l < prevLow) add('new_low', spec.intraday ? 'Printing a new low of the day' : 'Printing a new low for the range');
  }
  if (resistance[0] && resistance[0].price - price <= atrVal * 0.5)
    add('near_resistance', `Within half an ATR of resistance near ${fmt(resistance[0].price, d)}`);
  if (support[0] && price - support[0].price <= atrVal * 0.5)
    add('near_support', `Within half an ATR of support near ${fmt(support[0].price, d)}`);

  const state: WatchState = {
    above_vwap: v.vwap != null ? price > v.vwap : null,
    rsi_zone: v.rsi == null ? null : v.rsi >= 70 ? 'overbought' : v.rsi <= 30 ? 'oversold' : 'neutral',
    macd_side: v.macd != null && v.macdSignal != null ? (v.macd >= v.macdSignal ? 'bull' : 'bear') : null,
    session_high: Math.max(...sessionBars.map(b => b.h)),
    session_low: Math.min(...sessionBars.map(b => b.l)),
  };

  // Volume and bar counts per session for the latest day shown.
  const lastDate = dates[dates.length - 1];
  const sessionVolume: Partial<Record<Session, { bars: number; volume: number }>> = {};
  bars.forEach((b, i) => {
    if (spec.intraday && dates[i] !== lastDate) return;
    const e = (sessionVolume[sessions[i]] ??= { bars: 0, volume: 0 });
    e.bars++; e.volume += b.v;
  });

  return {
    symbol, range, interval: opts.interval ?? 'auto', timeframe: spec.timeframe, bar_count: bars.length,
    last_bar_session: lastSession, session_volume: sessionVolume,
    from: bars[0].t, to: lastBar.t,
    price: round(price, d), change: round(change, d), change_pct: round(changePct),
    change_basis: opts.prevClose != null ? 'previous close' : 'first bar open',
    high: round(high, d), low: round(low, d), volume: bars.reduce((a, b) => a + b.v, 0),
    trend, trend_slope_pct_per_bar: round(slope, 4),
    indicators: {
      sma20: round(v.sma20, d), sma50: round(v.sma50, d), ema9: round(v.ema9, d), ema21: round(v.ema21, d),
      vwap: round(v.vwap, d), rsi14: round(v.rsi, 1),
      macd: { line: round(v.macd, 4), signal: round(v.macdSignal, 4), histogram: round(v.macdHist, 4) },
      bollinger: { upper: round(v.bbUpper, d), middle: round(v.bbMid, d), lower: round(v.bbLower, d), width_percentile: round(bwRank, 2) },
      atr14: round(v.atr, d), atr_pct: round(v.atr != null ? (v.atr / price) * 100 : null),
      relative_volume: round(relVol),
    },
    levels: { resistance: mergeRounded(resistance, d), support: mergeRounded(support, d) },
    signals, state, series, sessions,
  };
}

// VWAP over regular-session bars only, re-anchored each day; null for
// premarket and after-hours bars.
function regularVwap(bars: Bar[], sessions: Session[], dates: string[]) {
  const regular = bars.map((b, i) => (sessions[i] === 'regular' ? b : { ...b, v: 0 }));
  return ind.vwap(regular, i => dates[i]).map((v, i) => (sessions[i] === 'regular' ? v : null));
}

// Levels that round to the same displayed price are one level.
function mergeRounded(levels: { price: number; touches: number }[], d: number) {
  const out: { price: number | null; touches: number }[] = [];
  for (const l of levels) {
    const price = round(l.price, d), same = out.find(o => o.price === price);
    if (same) same.touches += l.touches; else out.push({ price, touches: l.touches });
  }
  return out;
}

function ago(n: number) { return n === 0 ? 'on the latest bar' : `${n} bar${n === 1 ? '' : 's'} ago`; }

export function summarize(a: Analysis): string {
  const d = priceDigits(a.price ?? 1), i = a.indicators;
  const lines = [
    `${a.symbol} · ${a.range} · ${a.timeframe} bars · ${a.bar_count} bars (${a.from} → ${a.to})`,
    `Last ${fmt(a.price, d)}  ${pct(a.change_pct)} vs ${a.change_basis}  ·  range ${fmt(a.low, d)} – ${fmt(a.high, d)}`,
    `Trend: ${a.trend}`,
    '',
    'Indicators',
    `  EMA 9 / 21: ${fmt(i.ema9, d)} / ${fmt(i.ema21, d)}   SMA 20 / 50: ${fmt(i.sma20, d)} / ${fmt(i.sma50, d)}`,
    ...(i.vwap != null ? [`  VWAP (regular session): ${fmt(i.vwap, d)} (price ${a.state.above_vwap ? 'above' : 'below'})`] : []),
    ...(a.timeframe === '4Hour' ? ['  VWAP: not computed on 4-hour bars. Bars that span the open or close are labelled "mixed".'] : []),
    `  RSI 14: ${fmt(i.rsi14, 1)}   MACD: ${fmt(i.macd.line, 4)} vs signal ${fmt(i.macd.signal, 4)} (hist ${fmt(i.macd.histogram, 4)})`,
    `  Bollinger 20,2: ${fmt(i.bollinger.lower, d)} – ${fmt(i.bollinger.upper, d)}   ATR 14: ${fmt(i.atr14, d)} (${fmt(i.atr_pct)}%)`,
    `  Relative volume (last bar vs same session): ${i.relative_volume == null ? 'n/a' : i.relative_volume + 'x'}`,
    ...(a.timeframe.endsWith('Min') || a.timeframe.endsWith('Hour') ? [`  Latest day volume by session: ${(['pre', 'mixed', 'regular', 'post'] as const)
      .filter(k => a.session_volume[k]).map(k => `${k} ${a.session_volume[k]!.volume.toLocaleString('en-US')} (${a.session_volume[k]!.bars} bars)`).join(', ')}; last bar is ${a.last_bar_session}`] : []),
    '',
    `Resistance: ${a.levels.resistance.map(l => `${fmt(l.price, d)} (${l.touches}x)`).join(', ') || 'none in view'}`,
    `Support: ${a.levels.support.map(l => `${fmt(l.price, d)} (${l.touches}x)`).join(', ') || 'none in view'}`,
    '',
    'Signals',
    ...(a.signals.length ? a.signals.map(s => `  • ${s.text}`) : ['  • nothing notable on the latest bars']),
  ];
  return lines.join('\n');
}

// Plain JSON without the per-bar series.
export function brief(a: Analysis) {
  const { series, sessions, ...rest } = a;
  return rest;
}

// Candles and indicator values per bar, column-oriented to stay compact.
export const TABLE_COLUMNS = ['time_utc', 'time_et', 'session', 'open', 'high', 'low', 'close', 'volume',
  'vwap', 'ema9', 'ema21', 'sma20', 'sma50', 'bb_upper', 'bb_lower', 'rsi14', 'macd', 'macd_signal', 'macd_hist'] as const;
export function table(a: Analysis, bars: Bar[]) {
  const d = priceDigits(a.price ?? 1), s = a.series;
  const r = (v: number | null | undefined, n = d) => round(v, n);
  return {
    columns: TABLE_COLUMNS,
    rows: bars.map((b, i) => {
      const et = etParts(b.t);
      return [b.t, `${et.date} ${et.hhmm}`, a.sessions[i], b.o, b.h, b.l, b.c, b.v,
        r(s.vwap?.[i]), r(s.ema9[i]), r(s.ema21[i]), r(s.sma20[i]), r(s.sma50[i]), r(s.bb.upper[i]), r(s.bb.lower[i]),
        r(s.rsi[i], 1), r(s.macd.line[i], 4), r(s.macd.signal[i], 4), r(s.macd.hist[i], 4)];
    }),
  };
}
