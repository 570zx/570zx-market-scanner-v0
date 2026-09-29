// Deterministic synthetic market days in the dataset's format, for tests and
// for smoke-running the replay without network access. Not market data.
import {etWall, addDays} from './time.mjs';
import {DATASET_VERSION, FIRST_SESSION_SLOT, SLOTS} from './dataset.mjs';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const r4 = x => Math.round(x * 10000) / 10000;

// path(minuteAfter0400) -> price; volume(minute) -> shares
function series(path, volume, {from = 0, to = 720, every = 1} = {}) {
  const cols = {t: [], o: [], h: [], l: [], c: [], v: [], n: []};
  for (let m = from; m < to; m += every) {
    const v = volume(m);
    if (!(v > 0)) continue;
    const o = path(m), c = path(m + every - 1e-6), wig = Math.abs(c - o) * 0.3 + o * 0.002;
    cols.t.push(m); cols.o.push(r4(o)); cols.c.push(r4(c)); cols.h.push(r4(Math.max(o, c) + wig)); cols.l.push(r4(Math.max(0.0001, Math.min(o, c) - wig)));
    cols.v.push(Math.round(v)); cols.n.push(Math.max(1, Math.round(v / 150)));
  }
  return cols;
}

const OPEN = 330; // 09:30 is 330 minutes after 04:00

export function syntheticDay(date, prevDate, {seed = 1, symbols = 30, runner = true, fader = true} = {}) {
  const rand = rng(seed), fine = {}, coarse = {}, ref = {}, news = [];
  const t0 = etWall(date, '04:00'), at = m => t0 + m * 60_000;
  const add = (s, prev, prevVol, path, volume) => { ref[s] = [prev, prevVol]; fine[s] = series(path, volume); };
  if (runner) {
    // Quiet premarket, ignition at 09:45, +45% by 10:40, then a slow fade.
    add('RUNR', 1.00, 2_000_000,
      m => m < OPEN + 15 ? 1.02 + 0.0002 * (m % 7) : m < OPEN + 70 ? 1.02 + 0.43 * (m - OPEN - 15) / 55 : Math.max(1.12, 1.45 - 0.0012 * (m - OPEN - 70)),
      m => m < OPEN ? (m % 9 === 0 ? 3000 : 0) : m < OPEN + 15 ? 20_000 : m < OPEN + 70 ? 120_000 : 40_000);
    news.push({id: 'n-runr', t: at(OPEN + 14), h: 'RUNR announces FDA approval of lead program', s: '', sy: ['RUNR']});
  }
  if (fader) {
    // Gaps +30%, fades 25% from the open.
    add('FADR', 2.00, 1_000_000, m => m < OPEN ? 2.55 : Math.max(1.9, 2.6 - 0.004 * (m - OPEN)), m => m < OPEN ? (m % 5 === 0 ? 5000 : 0) : 60_000);
    news.push({id: 'n-fadr', t: at(OPEN + 3), h: 'FADR prices registered direct offering', s: '', sy: ['FADR']});
  }
  for (let i = 0; i < symbols; i++) {
    const s = 'SYN' + String(i).padStart(2, '0'), base = 1 + rand() * 15, drift = (rand() - 0.45) * 0.0004, vol = 5000 + rand() * 60_000;
    const noise = Array.from({length: 721}, () => (rand() - 0.5) * 0.004);
    let px = base; const path = new Array(721);
    for (let m = 0; m <= 720; m++) { px *= 1 + drift + noise[m]; path[m] = px; }
    add(s, r4(base / (1 + (rand() - 0.3) * 0.12)), Math.round(vol * 300), m => path[Math.min(720, Math.floor(m))], m => (m >= OPEN || m % 11 === 0) ? vol * (0.5 + rand()) : 0);
  }
  for (let i = 0; i < 3; i++) {
    const s = 'BIG' + i, base = 150 + i * 40;
    ref[s] = [base, 30_000_000];
    coarse[s] = series(m => base * (1 + 0.00002 * m), () => 2_000_000, {every: 15});
    news.push({id: 'n-big' + i, t: at(OPEN - 60 + i), h: s + ' quarterly earnings beat', s: '', sy: [s]});
  }
  news.sort((a, b) => a.t - b.t);
  const boards = {gainers: [], losers: [], byVolume: Object.keys(ref).slice(0, 5).map(symbol => ({symbol, volume: 1e6, trade_count: 1e4})), byTrades: []};
  // Every synthetic stock may appear on the screens all day (no screen plan),
  // and nothing is left out of the data.
  const windows = Array.from({length: SLOTS - FIRST_SESSION_SLOT}, (_, i) => ({slot: FIRST_SESSION_SLOT + i, gain: [], loss: [], volume: [], trades: []}));
  return {version: DATASET_VERSION, date, open: '09:30', close: '16:00', t0, prevDate, ref, boards, windows, fine, coarse, news, stats: {synthetic: true}};
}

export function syntheticDays(first, n, options = {}) {
  const out = [];
  let date = first, prev = addDays(first, -1);
  while (out.length < n) {
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) { out.push(syntheticDay(date, prev, {...options, seed: (options.seed ?? 1) + out.length})); prev = date; }
    date = addDays(date, 1);
  }
  return out;
}
