// Metrics and the human-readable summary.
import {etDate, RealDate} from './time.mjs';

const sum = xs => xs.reduce((a, b) => a + b, 0);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (a, b) => b ? a / b * 100 : null;
const r2 = x => x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;

export function maxDrawdownPct(curve) {
  let peak = -Infinity, worst = 0;
  for (const [, equity] of curve) { peak = Math.max(peak, equity); if (peak > 0) worst = Math.max(worst, (peak - equity) / peak); }
  return worst * 100;
}

export function tradeStats(trades) {
  const rets = trades.map(t => t.return_pct), pnl = trades.map(t => t.realized_pnl);
  return {n: trades.length, wins: trades.filter(t => t.realized_pnl > 0).length, win_rate_pct: r2(pct(trades.filter(t => t.realized_pnl > 0).length, trades.length)),
    avg_return_pct: r2(trades.length ? sum(rets) / trades.length : null), median_return_pct: r2(median(rets)), pnl: r2(sum(pnl)),
    avg_minutes_held: r2(trades.length ? sum(trades.map(t => t.minutes_held)) / trades.length : null), median_minutes_held: r2(median(trades.map(t => t.minutes_held)))};
}

const BUCKETS = [['up ≤5%', -Infinity, 5], ['5–10%', 5, 10], ['10–20%', 10, 20], ['20–50%', 20, 50], ['over 50%', 50, Infinity]];

export function summarizeVariant(variant, run, costs = {}) {
  const trades = run.trades, days = run.days, last = days.at(-1) ?? {};
  const overnight = trades.filter(t => etDate(RealDate.parse(t.opened_at)) !== etDate(RealDate.parse(t.closed_at)));
  const byReason = {};
  for (const t of trades) (byReason[t.exit_reason] ??= []).push(t);
  const byEntry = Object.fromEntries(BUCKETS.map(([label, lo, hi]) => [label, tradeStats(trades.filter(t => t.entry_day_change_pct > lo && t.entry_day_change_pct <= hi))]));
  const dailyChanges = days.map((d, i) => d.equity_marked - (i ? days[i - 1].equity_marked : 250));
  const rejections = Object.entries(run.rejections).filter(([k]) => k !== 'ENTERED').sort((a, b) => b[1] - a[1]).slice(0, 10);
  const live = costs.live, paper = costs.paper;
  return {
    id: variant.id, label: variant.label, changes: variant.changes,
    days: days.length, cycles: run.cycles, failed_cycles: run.failed_cycles, errors: run.errors.slice(0, 5),
    entries: run.entries.length, entries_per_day: r2(days.length ? run.entries.length / days.length : 0),
    closed: tradeStats(trades), open_at_end: run.open_at_end.length,
    final_equity: r2(last.equity_marked ?? 250), return_pct: r2(((last.equity_marked ?? 250) / 250 - 1) * 100), realized_pnl: r2(last.realized_pnl ?? 0),
    max_drawdown_pct: r2(maxDrawdownPct(run.curve)), best_day: r2(Math.max(0, ...dailyChanges)), worst_day: r2(Math.min(0, ...dailyChanges)),
    losing_days: dailyChanges.filter(x => x < 0).length,
    overnight: {...tradeStats(overnight), share_pct: r2(pct(overnight.length, trades.length))},
    exits: Object.fromEntries(Object.entries(byReason).map(([k, ts]) => [k, tradeStats(ts)]).sort((a, b) => b[1].n - a[1].n)),
    by_entry_day_change: byEntry, top_rejections: rejections,
    risk_governor_days: days.filter(d => d.risk_state === 'REDUCE_ONLY').length,
    risk_gate_blocked: Object.entries(run.risk_gate ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
    screen_coverage_pct: Object.fromEntries(Object.entries(run.coverage ?? {}).map(([k, [n, exact]]) => [k, n ? r2(exact / n * 100) : null])),
    paper_at_real_quotes: paper ? {priced: paper.priced, unpriced: paper.unpriced, pnl_model: r2(paper.pnl_model), pnl_nbbo: r2(paper.pnl_nbbo),
      median_entry_spread_pct: r2(median(paper.entry_spread_pct)), median_exit_spread_pct: r2(median(paper.exit_spread_pct))} : null,
    live_mirror: live ? {orders: live.orders, buys: live.buys, sells: live.sells, total_pnl: r2(live.total_pnl), realized: r2(live.realized), open_positions: live.open_positions,
      round_trips: live.round_trips.length, win_rate_pct: r2(pct(live.wins, live.round_trips.length)), avg_return_pct: r2(live.round_trips.length ? sum(live.round_trips.map(t => t.return_pct)) / live.round_trips.length : null),
      skipped: live.skipped} : null,
  };
}

const money = x => x == null ? '—' : (x < 0 ? '−$' : '$') + Math.abs(x).toFixed(2);
const pctText = x => x == null ? '—' : x.toFixed(1) + '%';

export function renderSummary({meta, results}) {
  const L = [];
  L.push(`# MEDS backtest: ${meta.first_day} to ${meta.last_day} (${meta.days} trading days)`);
  L.push('');
  L.push(`Replays MEDS's production Leader code (${meta.engine}) minute by minute over real market history, starting from $250 each rule set. ` +
    `Market data: Alpaca historical consolidated tape. ${meta.synthetic ? '**SYNTHETIC TEST DATA — not market results.**' : ''}`);
  L.push('');
  L.push('| Rule set | Trades | Win rate | Avg trade | Paper P&L | Same trades at real quotes | Live mirror P&L | Max drawdown | Held overnight |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    L.push(`| **${r.id}** | ${r.closed.n} | ${pctText(r.closed.win_rate_pct)} | ${pctText(r.closed.avg_return_pct)} | ${money(r.final_equity - 250)} | ` +
      `${money(r.paper_at_real_quotes?.pnl_nbbo)} | ${money(r.live_mirror?.total_pnl)} | ${pctText(r.max_drawdown_pct)} | ${r.overnight.n} |`);
  }
  L.push('');
  L.push('**Paper P&L**: the paper account ($250, fractional shares) marked at the last trade, using the modeled spread. ' +
    '**Same trades at real quotes**: those exact trades re-priced at the real NBBO one minute after each decision (bought at the ask, sold at the bid). ' +
    '**Live mirror P&L**: what the Robinhood mirror would have done with those decisions — whole shares, $12 orders, its 3% spread and 2% chase limits, 3 orders a minute.');
  L.push('');
  L.push('## Rule sets');
  for (const r of results) L.push(`- **${r.id}**: ${r.label}`);
  L.push('');
  for (const r of results) {
    L.push(`<details><summary><b>${r.id}</b>: ${r.closed.n} trades, paper ${money(r.final_equity - 250)}, live ${money(r.live_mirror?.total_pnl)}</summary>`);
    L.push('');
    L.push(`- Entries ${r.entries} (${r.entries_per_day}/day); closed ${r.closed.n}, open at end ${r.open_at_end}; median hold ${r.closed.median_minutes_held ?? '—'} min; median trade ${pctText(r.closed.median_return_pct)}`);
    L.push(`- Equity $${r.final_equity} (${pctText(r.return_pct)}); best day ${money(r.best_day)}, worst day ${money(r.worst_day)}, losing days ${r.losing_days}/${r.days}; risk governor stopped buys on ${r.risk_governor_days} days`);
    L.push(`- Held overnight: ${r.overnight.n} trades (${pctText(r.overnight.share_pct)}), P&L ${money(r.overnight.pnl)}`);
    if (r.paper_at_real_quotes) L.push(`- Real-quote check: ${r.paper_at_real_quotes.priced} trades priced, median spread paid ${pctText(r.paper_at_real_quotes.median_entry_spread_pct)} in / ${pctText(r.paper_at_real_quotes.median_exit_spread_pct)} out`);
    if (r.live_mirror) L.push(`- Live mirror: ${r.live_mirror.buys} buys, ${r.live_mirror.sells} sells, ${r.live_mirror.round_trips} round trips, win rate ${pctText(r.live_mirror.win_rate_pct)}; skipped ${Object.entries(r.live_mirror.skipped).map(([k, v]) => k + ' ' + v).join(', ') || 'none'}`);
    L.push('');
    L.push('| Exit reason | Trades | Win rate | Avg | P&L |');
    L.push('|---|---:|---:|---:|---:|');
    for (const [k, s] of Object.entries(r.exits)) L.push(`| ${k} | ${s.n} | ${pctText(s.win_rate_pct)} | ${pctText(s.avg_return_pct)} | ${money(s.pnl)} |`);
    L.push('');
    L.push('| Stock was up … when bought | Trades | Win rate | Avg | P&L |');
    L.push('|---|---:|---:|---:|---:|');
    for (const [k, s] of Object.entries(r.by_entry_day_change)) L.push(`| ${k} | ${s.n} | ${pctText(s.win_rate_pct)} | ${pctText(s.avg_return_pct)} | ${money(s.pnl)} |`);
    L.push('');
    L.push(`Stocks not bought, by first reason (each stock counted once a day): ${r.top_rejections.map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}`);
    if (r.risk_gate_blocked.length) L.push(`\nBlocked while the daily risk governor had stopped buying: ${r.risk_gate_blocked.map(([k, v]) => `${k} (${v})`).join(', ')}`);
    if (r.failed_cycles) L.push(`\n**${r.failed_cycles} cycles failed**: ${r.errors.map(e => e.error).join(' | ')}`);
    L.push('</details>');
    L.push('');
  }
  L.push('## Data and method');
  for (const line of meta.notes) L.push('- ' + line);
  const cov = results[0]?.screen_coverage_pct;
  if (cov && !meta.synthetic) L.push(`- Screen coverage (share of regular-session cycles where the replayed screen provably equals the real one): gainers ${pctText(cov.gainers)}, losers ${pctText(cov.losers)}, most active by volume ${pctText(cov.volume)}, by trades ${pctText(cov.trades)}. Where it is lower, a stock that had only just started moving may be missing from the replayed screen (it appears at the next 15-minute mark); nothing is ever shown early.`);
  if (meta.calibration) L.push(`- Spread model: ${meta.spread_model.source}, ${meta.spread_model.samples} samples${meta.spread_model.r2 != null ? `, R² ${meta.spread_model.r2.toFixed(2)}, median error ${(meta.spread_model.median_abs_pct_error * 100).toFixed(0)}%` : ''}. Real quotes older than 2 minutes at sampling: ${pctText(meta.calibration.share_quotes_older_than_120s == null ? null : meta.calibration.share_quotes_older_than_120s * 100)}.`);
  L.push(`- Run: ${meta.minutes} min, ${meta.alpaca_requests} Alpaca requests (${meta.alpaca_retries} retried), ${meta.quotes_fetched} quotes fetched.`);
  if (meta.failures.length) L.push(`- **Failed rule sets**: ${meta.failures.map(f => f.id).join(', ')}`);
  return L.join('\n');
}

export function tradesCsv(run, paper) {
  const nbbo = new Map((paper?.rows ?? []).map(r => [r.symbol + '|' + r.opened_at, r]));
  const cols = ['symbol', 'opened_at', 'closed_at', 'entry_day_change_pct', 'entry_price', 'exit_price', 'quantity', 'realized_pnl', 'return_pct', 'minutes_held', 'exit_reason', 'mfe_pct', 'mae_pct', 'nbbo_pnl'];
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = run.trades.map(t => [...cols.slice(0, -1).map(c => t[c]), nbbo.get(t.symbol + '|' + t.opened_at)?.nbbo_pnl]);
  return [cols.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n') + '\n';
}
