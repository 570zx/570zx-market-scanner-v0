// Static PNG chart: candles + overlays, then volume and RSI in their own
// panels (each panel has one y-axis). Colours: up/down use the blue/red
// diverging pair; overlays use fixed categorical slots; text stays in ink.

import type { Bar } from './alpaca.ts';
import type { Analysis } from './analyze.ts';
import { priceDigits } from './analyze.ts';
import { etParts } from './time.ts';
import { Raster, text, textWidth } from './png.ts';
import type { Series } from './indicators.ts';

const PALETTE = [
  '#fcfcfb', // 0 surface
  '#ebeae6', // 1 grid
  '#52514e', // 2 secondary text / axes
  '#0b0b0b', // 3 primary text
  '#2a78d6', // 4 up
  '#e34948', // 5 down
  '#eb6834', // 6 VWAP (slot 2)
  '#4a3aa7', // 7 EMA 21 (slot 7, high contrast)
  '#eeedf5', // 8 Bollinger fill
  '#b7b6b0', // 9 Bollinger edge
  '#b7d3f6', // 10 volume up
  '#f4c3c2', // 11 volume down
  '#f3f2ee', // 12 RSI 30-70 zone
  '#ffffff', // 13 tag text
];
const C = { bg: 0, grid: 1, axis: 2, ink: 3, up: 4, down: 5, vwap: 6, ema: 7, bandFill: 8, band: 9, volUp: 10, volDown: 11, zone: 12, white: 13 };

const W = 960, H = 600, S = 2; // S = font scale
const L = 16, R = 88;
const PRICE = { top: 72, bottom: 372 }, VOL = { top: 384, bottom: 448 }, RSI = { top: 462, bottom: 560 };

export async function renderChart(a: Analysis, bars: Bar[]): Promise<Uint8Array<ArrayBuffer>> {
  const r = new Raster(W, H, PALETTE, C.bg);
  const n = bars.length, plotW = W - L - R, step = plotW / n;
  const xAt = (i: number) => L + step * (i + 0.5);
  const d = priceDigits(a.price ?? 1);
  const s = a.series;
  const et = bars.map(b => etParts(b.t));

  // ---- header
  const sign = (a.change_pct ?? 0) >= 0 ? '+' : '';
  text(r, L, 12, `${a.symbol}  ${a.price?.toFixed(d)}`, C.ink, 3);
  const headW = textWidth(`${a.symbol}  ${a.price?.toFixed(d)}`, 3);
  text(r, L + headW + 16, 19, `${sign}${a.change?.toFixed(d)} (${sign}${a.change_pct?.toFixed(2)}%)`, (a.change_pct ?? 0) >= 0 ? C.up : C.down, S);
  const meta = `${a.range} ${a.timeframe}  ${a.trend}`;
  text(r, W - R - textWidth(meta, S), 19, meta, C.axis, S);
  let lx = L;
  const legend = (label: string, color: number, fill = false) => {
    if (fill) r.rect(lx, 50, 18, 8, color); else r.rect(lx, 53, 18, 2, color);
    text(r, lx + 24, 48, label, C.axis, S);
    lx += 24 + textWidth(label, S) + 22;
  };
  if (s.vwap) legend('VWAP', C.vwap);
  legend('EMA 21', C.ema);
  legend('BB 20,2', C.band);

  // ---- price panel
  const visible = (x: Series) => x.filter((v): v is number => v != null);
  let lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
  for (const v of [...visible(s.bb.upper), ...visible(s.bb.lower), ...(s.vwap ? visible(s.vwap) : [])]) {
    // Keep overlays in view but never let them squash the candles too much.
    const pad = (hi - lo) * 0.25;
    if (v > hi && v < hi + pad) hi = v;
    if (v < lo && v > lo - pad) lo = v;
  }
  const pad = (hi - lo || hi * 0.01) * 0.06;
  lo -= pad; hi += pad;
  const yP = (v: number) => PRICE.bottom - ((v - lo) / (hi - lo)) * (PRICE.bottom - PRICE.top);
  const clampP = (y: number) => Math.min(PRICE.bottom, Math.max(PRICE.top, y));

  const ticks = niceTicks(lo, hi, 6);
  const tickDigits = Math.max(0, Math.min(4, -Math.floor(Math.log10(ticks.step) + 1e-9)));
  for (const t of ticks.values) {
    const y = Math.round(yP(t));
    r.hline(L, W - R, y, C.grid);
    text(r, W - R + 8, y - 7, t.toFixed(tickDigits), C.axis, S);
  }

  // Bollinger band fill and edges.
  for (let i = 0; i < n; i++) {
    const u = s.bb.upper[i], l = s.bb.lower[i];
    if (u == null || l == null) continue;
    const x0 = Math.round(L + step * i), x1 = Math.round(L + step * (i + 1));
    const y0 = clampP(yP(u)), y1 = clampP(yP(l));
    r.rect(x0, y0, x1 - x0, y1 - y0, C.bandFill);
  }
  drawLine(r, s.bb.upper, xAt, v => clampP(yP(v)), C.band, 1);
  drawLine(r, s.bb.lower, xAt, v => clampP(yP(v)), C.band, 1);

  // Candles.
  const bodyW = Math.max(1, Math.floor(step * 0.62));
  bars.forEach((b, i) => {
    const color = b.c >= b.o ? C.up : C.down, x = Math.round(xAt(i));
    r.vline(x, yP(b.h), yP(b.l), color);
    const top = Math.round(yP(Math.max(b.o, b.c))), bot = Math.round(yP(Math.min(b.o, b.c)));
    r.rect(x - Math.floor(bodyW / 2), top, bodyW, Math.max(1, bot - top), color);
  });

  drawLine(r, s.ema21, xAt, v => clampP(yP(v)), C.ema, 2);
  if (s.vwap) drawLine(r, s.vwap, xAt, v => clampP(yP(v)), C.vwap, 2, (i) => i > 0 && et[i].date !== et[i - 1].date);

  // Last price tag on the axis.
  const last = bars[n - 1], tagColor = last.c >= last.o ? C.up : C.down, ty = Math.round(yP(last.c));
  r.hline(L, W - R, ty, tagColor, 4);
  r.rect(W - R + 2, ty - 10, R - 4, 20, tagColor);
  text(r, W - R + 8, ty - 7, last.c.toFixed(d), C.white, S);

  // ---- volume panel
  text(r, L, VOL.top - 2, 'VOL', C.axis, S);
  const maxV = Math.max(...bars.map(b => b.v), 1);
  const yV = (v: number) => VOL.bottom - (v / maxV) * (VOL.bottom - VOL.top - 14);
  r.hline(L, W - R, VOL.bottom, C.grid);
  bars.forEach((b, i) => {
    const x = Math.round(xAt(i)), y = Math.round(yV(b.v));
    r.rect(x - Math.floor(bodyW / 2), y, bodyW, VOL.bottom - y, b.c >= b.o ? C.volUp : C.volDown);
  });
  text(r, W - R + 8, VOL.top + 4, compact(maxV), C.axis, S);

  // ---- RSI panel
  const yR = (v: number) => RSI.bottom - (v / 100) * (RSI.bottom - RSI.top);
  r.rect(L, yR(70), W - R - L, yR(30) - yR(70), C.zone);
  for (const lvl of [30, 50, 70]) {
    r.hline(L, W - R, Math.round(yR(lvl)), C.grid, lvl === 50 ? 0 : 6);
    text(r, W - R + 8, Math.round(yR(lvl)) - 7, String(lvl), C.axis, S);
  }
  drawLine(r, s.rsi, xAt, yR, C.ema, 2);
  const rsiNow = a.indicators.rsi14;
  text(r, L, RSI.top - 2, `RSI 14${rsiNow != null ? '  ' + rsiNow.toFixed(0) : ''}`, C.axis, S);

  // ---- time axis: ticks at natural boundaries (hour, day, month, year).
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const tick = (i: number): [string, string] => {
    const p = et[i], month = MONTHS[Number(p.date.slice(5, 7)) - 1];
    if (a.range === '1d') return [p.hhmm.slice(0, 2), p.hhmm];
    if (a.range === '5d' || a.range === '1mo') return [p.date, p.mmdd];
    if (a.range === '5y') return [p.date.slice(0, 4), p.date.slice(0, 4)];
    return [p.date.slice(0, 7), p.date.slice(5, 7) === '01' ? `${month} ${p.date.slice(0, 4)}` : month];
  };
  let lastRight = -Infinity, prevKey = '';
  bars.forEach((_, i) => {
    const [key, lab] = tick(i);
    if (key === prevKey) return;
    prevKey = key;
    const x = Math.round(xAt(i)), w = textWidth(lab, S);
    const left = Math.max(L, Math.min(W - R - w, x - w / 2));
    if (left <= lastRight + 14) return;
    r.vline(x, RSI.bottom, RSI.bottom + 4, C.axis);
    text(r, left, RSI.bottom + 10, lab, C.axis, S);
    lastRight = left + w;
  });
  r.hline(L, W - R, RSI.bottom, C.axis);
  const foot = 'TIMES ET  DATA: ALPACA';
  text(r, W - R - textWidth(foot), 56, foot, C.band, 1);

  return r.png();
}

function drawLine(r: Raster, values: Series, xAt: (i: number) => number, y: (v: number) => number, c: number, thick: number,
  breakAt?: (i: number) => boolean) {
  let prev: [number, number] | null = null;
  values.forEach((v, i) => {
    if (v == null || breakAt?.(i)) { prev = v == null ? null : [xAt(i), y(v)]; return; }
    const pt: [number, number] = [xAt(i), y(v)];
    if (prev) r.line(prev[0], prev[1], pt[0], pt[1], c, thick);
    prev = pt;
  });
}

export function niceTicks(lo: number, hi: number, count: number) {
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) values.push(Number(v.toFixed(10)));
  return { step, values };
}

function compact(v: number) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(Math.round(v));
}
