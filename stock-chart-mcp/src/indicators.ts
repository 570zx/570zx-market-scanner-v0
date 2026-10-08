// Pure technical indicators. Every series has the same length as its input;
// positions without enough history are null.

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) out[i] = prev = values[i] * k + prev * (1 - k);
  return out;
}

// Wilder's RSI.
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(values, fast), s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const first = line.findIndex(v => v != null);
  const signal: Series = new Array(values.length).fill(null);
  if (first >= 0) {
    const tail = ema(line.slice(first) as number[], signalPeriod);
    tail.forEach((v, i) => (signal[first + i] = v));
  }
  const hist: Series = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { line, signal, hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: Series = [], lower: Series = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(v / period);
    upper.push(mid[i]! + mult * sd); lower.push(mid[i]! - mult * sd);
  }
  return { mid, upper, lower };
}

export type Ohlcv = { o: number; h: number; l: number; c: number; v: number };

export function atr(bars: Ohlcv[], period = 14): Series {
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l
    : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) out[i] = prev = (prev * (period - 1) + tr[i]) / period;
  return out;
}

// Volume-weighted average price, re-anchored whenever sessionKey changes.
export function vwap(bars: Ohlcv[], sessionKey: (i: number) => string): Series {
  let key = '', pv = 0, vol = 0;
  return bars.map((b, i) => {
    const k = sessionKey(i);
    if (k !== key) { key = k; pv = 0; vol = 0; }
    pv += ((b.h + b.l + b.c) / 3) * b.v; vol += b.v;
    return vol > 0 ? pv / vol : null;
  });
}

// Least-squares slope of the last n values, as % of the last value per bar.
export function slopePct(values: number[], n: number) {
  const ys = values.slice(-n);
  if (ys.length < 3) return 0;
  const mx = (ys.length - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return ((num / den) / ys[ys.length - 1]) * 100;
}

// Swing highs/lows (k bars each side), merged when within `tolerance`.
export function swingLevels(bars: Ohlcv[], k = 3, tolerance = 0) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h > bars[i].h) hi = false;
      if (bars[j].l < bars[i].l) lo = false;
    }
    if (hi) highs.push(bars[i].h);
    if (lo) lows.push(bars[i].l);
  }
  return cluster([...highs, ...lows], tolerance);
}

function cluster(levels: number[], tolerance: number) {
  const sorted = [...levels].sort((a, b) => a - b);
  const groups: { sum: number; n: number }[] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g.sum / g.n <= tolerance) { g.sum += v; g.n++; } else groups.push({ sum: v, n: 1 });
  }
  return groups.map(g => ({ price: g.sum / g.n, touches: g.n }));
}

export function last<T>(s: (T | null)[]): T | null {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i];
  return null;
}

// Bars since `a` last crossed `b` (0 = on the last bar), with direction.
export function lastCross(a: Series, b: Series, within: number) {
  for (let i = a.length - 1; i > 0 && i >= a.length - 1 - within; i--) {
    const [a0, b0, a1, b1] = [a[i - 1], b[i - 1], a[i], b[i]];
    if (a0 == null || b0 == null || a1 == null || b1 == null) return null;
    if (a0 <= b0 && a1 > b1) return { barsAgo: a.length - 1 - i, dir: 'up' as const };
    if (a0 >= b0 && a1 < b1) return { barsAgo: a.length - 1 - i, dir: 'down' as const };
  }
  return null;
}
