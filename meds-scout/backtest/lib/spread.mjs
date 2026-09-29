// Bid/ask spread model. Minute bars carry trades, not quotes, so the replay
// needs a spread for each decision-time quote. The model is fitted to real
// NBBO quotes sampled from the same dataset (calibrate step); until then a
// prior is used. Every real order is re-priced at actual NBBO quotes in the
// cost pass, so this model only shapes which trades are attempted, not what
// they are reported to have earned there.
//
// log(spread %) = b0 + b1 ln(price) + b2 ln(1 + $vol5/1000) + b3 ln(1 + trades5) + b4 ln(1 + range5 %)

export const PRIOR_SPREAD_MODEL = Object.freeze({
  version: 'prior-v1', source: 'prior (not yet calibrated)', samples: 0,
  coef: [1.0, -0.35, -0.30, -0.05, 0.25], sigma: 0.8, min_pct: 0.02, max_pct: 25,
});

export function features({price, dollarVolume5 = 0, trades5 = 0, range5Pct = 0}) {
  return [1, Math.log(price), Math.log1p(Math.max(0, dollarVolume5) / 1000), Math.log1p(Math.max(0, trades5)), Math.log1p(Math.max(0, range5Pct))];
}

// Median spread in percent of price, never below one tick.
export function spreadPct(model, input) {
  const x = features(input), b = model.coef;
  let log = 0;
  for (let k = 0; k < b.length; k++) log += b[k] * x[k];
  const tickPct = (input.price >= 1 ? 0.01 : 0.0001) / input.price * 100;
  return Math.min(model.max_pct ?? 25, Math.max(model.min_pct ?? 0.02, tickPct, Math.exp(log)));
}

// Ordinary least squares on log spread. Returns a model plus fit statistics.
export function fitSpreadModel(samples, {minSamples = 60} = {}) {
  const rows = samples.filter(s => s.price > 0 && s.spread_pct > 0 && Number.isFinite(s.spread_pct));
  if (rows.length < minSamples) return {...PRIOR_SPREAD_MODEL, source: `prior (only ${rows.length} usable samples)`, samples: rows.length};
  const X = rows.map(features), y = rows.map(r => Math.log(r.spread_pct)), p = X[0].length;
  const XtX = Array.from({length: p}, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  for (let a = 0; a < p; a++) XtX[a][a] += 1e-6; // ridge guard against collinearity
  const coef = solve(XtX, Xty);
  const pred = X.map(x => x.reduce((n, v, k) => n + v * coef[k], 0));
  const resid = y.map((v, i) => v - pred[i]);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssRes = resid.reduce((n, r) => n + r * r, 0), ssTot = y.reduce((n, v) => n + (v - mean) ** 2, 0);
  const absPctErr = rows.map((r, i) => Math.abs(Math.exp(pred[i]) - r.spread_pct) / r.spread_pct).sort((a, b) => a - b);
  return {version: 'fitted-v1', source: 'fitted to sampled NBBO quotes', samples: rows.length, coef: coef.map(c => Math.round(c * 1e5) / 1e5),
    sigma: Math.sqrt(ssRes / Math.max(1, rows.length - p)), r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    median_abs_pct_error: absPctErr[Math.floor(absPctErr.length / 2)], min_pct: 0.02, max_pct: 25};
}

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('spread model: singular design');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
