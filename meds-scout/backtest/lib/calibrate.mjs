// Fits the spread model to real NBBO quotes sampled from the dataset, in the
// part of the market MEDS trades: $0.10-$25 stocks that are trading, weighted
// toward the day's movers. The samples are saved with the fit so the numbers
// can be checked.
import {DayMarket} from './market.mjs';
import {fitSpreadModel, PRIOR_SPREAD_MODEL} from './spread.mjs';
import {rng} from './synthetic.mjs';
import {etWall, MIN, RealDate} from './time.mjs';

export async function calibrateSpreads({dates, loadDay, book, samples = 300, seed = 7, log = () => {}}) {
  const rand = rng(seed), points = [];
  const perDay = Math.max(1, Math.ceil(samples / dates.length));
  for (const date of dates) {
    const {day} = loadDay(date), market = new DayMarket(day, {spreadModel: PRIOR_SPREAD_MODEL});
    const open = etWall(date, '09:30'), minutes = 385;
    const symbols = [...market.series.entries()].filter(([, x]) => x.tier === 'fine').map(([s]) => s);
    let tries = 0, taken = 0;
    while (taken < perDay && tries++ < perDay * 40 && symbols.length) {
      const s = symbols[Math.floor(rand() * symbols.length)], x = market.series.get(s);
      const t = open + (5 + Math.floor(rand() * minutes)) * MIN + 5000, i = x.last(t);
      if (i < 0 || t - (x.t[i] + x.width) > 3 * MIN) continue;        // must be trading now
      const price = x.c[i], ref = market.ref[s]?.[0];
      if (!(price >= 0.1 && price <= 25)) continue;
      const mover = ref > 0 && price / ref - 1 >= 0.08;
      if (!mover && rand() < 0.7) continue;                             // favour movers ~70/30
      let dv = 0, trades = 0, hi = -Infinity, lo = Infinity;
      for (let k = i; k >= 0 && x.t[k] + x.width > t - 5 * MIN; k--) { dv += x.v[k] * x.c[k]; trades += x.n[k]; hi = Math.max(hi, x.h[k]); lo = Math.min(lo, x.l[k]); }
      points.push({date, symbol: s, t, price, dollarVolume5: dv, trades5: trades, range5Pct: (hi - lo) / price * 100, mover});
      taken++;
    }
  }
  log(`calibration: sampling ${points.length} real quotes`);
  const rows = [];
  for (const p of points) {
    const q = await book.at(p.symbol, p.t);
    if (!q || !(q.bp > 0) || !(q.ap >= q.bp)) continue;
    const mid = (q.ap + q.bp) / 2;
    rows.push({...p, at: new RealDate(p.t).toISOString(), bid: q.bp, ask: q.ap, quote_age_s: (p.t - RealDate.parse(q.t)) / 1000,
      spread_pct: Math.max((q.ap - q.bp) / mid * 100, 1e-4), last_vs_mid_pct: (p.price / mid - 1) * 100});
  }
  book.save();
  const model = fitSpreadModel(rows);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const summary = {samples_requested: points.length, quotes_found: rows.length, model,
    median_spread_pct: med(rows.map(r => r.spread_pct)), median_spread_pct_movers: med(rows.filter(r => r.mover).map(r => r.spread_pct)),
    median_quote_age_s: med(rows.map(r => r.quote_age_s)), share_quotes_older_than_120s: rows.length ? rows.filter(r => r.quote_age_s > 120).length / rows.length : null};
  log(`calibration: ${rows.length} quotes, median spread ${summary.median_spread_pct?.toFixed(2)}%, model ${model.source}${model.r2 != null ? ', R² ' + model.r2.toFixed(2) : ''}`);
  return {summary, rows};
}
