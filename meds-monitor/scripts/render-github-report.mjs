const base = process.env.MEDS_BASE_URL || "https://meds-monitor.pages.dev";

async function get(path) {
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "MEDS-GitHub-Monitor/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return {ok:false,error:`${path} returned HTTP ${response.status}`};
    return await response.json();
  } catch { return {ok:false,error:`${path} unavailable; no current data`}; }
}

function cell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function table(rows, columns) {
  if (!rows.length) return "_No rows._";
  const head = `| ${columns.map(([label]) => label).join(" | ")} |`;
  const rule = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map(([, key]) => cell(row[key])).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

const [status, tradesPage, positionsPage, decisionsPage, huntPage, huntPositionsPage, huntGainersPage] = await Promise.all([
  get("/status"),
  get("/status/trades?limit=100"),
  get("/status/positions?limit=100"),
  get("/status/decisions?limit=100"),
  get("/status/hunt?limit=100"),
  get("/status/hunt/positions?limit=100"),
  get("/status/hunt/gainers?limit=20"),
]);

const ledgers = status.ledgers || [];
const trades = tradesPage.rows || [];
const positions = positionsPage.rows || [];
const decisions = (decisionsPage.rows || []).slice(0, 50);
const huntTrades = huntPage.rows || [];
const huntGainerRows = huntGainersPage.rows || [];
const huntGainerSummary = huntGainersPage.summary || {};
const huntPositions = (huntPositionsPage.rows || []).map((row) => {
  let features = {};
  try { features = JSON.parse(row.features || "{}"); } catch {}
  const stage = Number(row.take200_done)
    ? "5% RUNNER"
    : Number(row.ladder100_done) ? "NEXT +200%"
    : Number(row.ladder50_done) ? "NEXT +100%"
    : Number(row.ladder25_done) ? "NEXT +50%"
    : "NEXT +25%";
  return {
    ...row,
    stage,
    remaining: row.remaining_qty == null ? row.quantity : row.remaining_qty,
    capacity_limited: features.capacity_limited === true ? "YES" : "no",
    distance_to_200_pct: Number(row.current_bid)>0 && Number(row.entry_price)>0
      ? ((Number(row.entry_price)*3/Number(row.current_bid))-1)*100 : "",
    target_notional: features.target_notional,
    actual_notional: features.actual_notional,
    minute_participation: features.minute_participation == null ? "" : (Number(features.minute_participation)*100).toFixed(2)+"%",
  };
});
const compoundingRows=(status.leader_hunt?.compounding_scoreboard || []).map((row)=>({
  ...row,
  current_multiple:Number(row.current_multiple||0).toFixed(3)+"x",
  next_multiple:row.next_multiple==null?"COMPLETE":Number(row.next_multiple)+"x",
  progress_to_next_pct:row.progress_to_next_pct==null?"":Number(row.progress_to_next_pct).toFixed(1)+"%",
  max_drawdown_pct:row.max_drawdown_pct==null?"":(Number(row.max_drawdown_pct)*100).toFixed(2)+"%",
}));
const generatedAt = new Date().toISOString();
// Leader Hunt telemetry is supplemental research data and must not make the
// core system look unhealthy during a rolling deployment.
const retrievalErrors=[status,tradesPage,positionsPage,decisionsPage].filter(x=>x.error).map(x=>x.error);

const report = `# MEDS Scout — Live Paper-Trading Monitor

> Automatically refreshed from Cloudflare every five minutes. Public and read-only. No credentials, control actions, or brokerage execution are exposed.

**Snapshot generated:** ${generatedAt}  
**System:** ${status.ok && !retrievalErrors.length ? "HEALTHY" : "UNHEALTHY"}  
**Mode:** ${status.mode || "unknown"}  
**Live execution:** ${status.live_execution === true ? "ENABLED — INVESTIGATE" : status.live_execution === false ? "false" : "unknown — telemetry unavailable"}

${retrievalErrors.length ? '**Telemetry unavailable (empty tables below are not evidence of zero activity):** '+retrievalErrors.map(cell).join('; ') : ''}

## Health

| Component | Healthy | Last tick | Last success | Error | Count |
| --- | --- | --- | --- | --- | --- |
| Scanner | ${status.scanner?.healthy} | ${cell(status.scanner?.last_tick_at)} | ${cell(status.scanner?.last_success_at)} | ${cell(status.scanner?.last_error)} | — |
| Paper engine | ${status.paper?.healthy} | ${cell(status.paper?.last_cycle_at)} | ${cell(status.paper?.last_cycle_at)} | ${cell(status.paper?.paper_error)} | ${cell(status.paper?.cycle_count)} cycles / ${cell(status.paper?.decision_count)} decisions |

## Paper ledgers

${table(ledgers, [
  ["Ledger", "id"], ["Starting", "starting_equity"], ["Cash", "cash"],
  ["Realized P&L", "realized_pnl"], ["Max drawdown", "max_drawdown_pct"],
  ["Open", "open_position_count"], ["Closed", "closed_trade_count"], ["Updated", "updated_at"],
])}

## Simulator diagnostics

- Simulator: ${cell(status.diagnostics?.simulator_version || "legacy/unavailable")}
- Execution: ${cell(status.diagnostics?.execution_version || "legacy/unavailable")}
- Historical drawdown: ${cell(status.diagnostics?.legacy_drawdown_quality || "pre-fix/untrusted")}
- Warning: ${cell(status.diagnostics?.warning)}

${table((status.diagnostics?.valuations || []).map(v=>({
  ledger:v.label, equity:v.complete ? v.equity : "UNAVAILABLE", risk:v.complete ? v.aggregate_reserved_risk : "INCOMPLETE",
  warnings:(v.diagnostics || []).join("; "),at:v.created_at,
  exposure:Object.entries(v.by_underlying || {}).map(([symbol,e])=>symbol+": risk="+Number(e.reserved_risk).toFixed(2)).join("; "),
})), [["Ledger","ledger"],["Marked equity","equity"],["Reserved risk","risk"],["Underlying risk","exposure"],["Warnings","warnings"],["As of","at"]])}

${table(status.diagnostics?.prospective_metrics || [], [["Ledger ID","ledger_id"],["Post-fix peak equity","max_equity"],["Post-fix max drawdown","max_drawdown_pct"]])}

<details><summary>Entry rejections (last 24 hours, including legacy records)</summary>

${table(status.diagnostics?.rejected_entries_24h || [], [["Reason","reason"],["Count","count"]])}

</details>

## Leader Hunt — high-volume research

- Version: ${cell(status.leader_hunt?.version || "unavailable")}
- Health: ${status.leader_hunt?.healthy === true ? "HEALTHY" : status.leader_hunt?.healthy === false ? "UNHEALTHY" : "unknown"}
- Latest observation age: ${cell(status.leader_hunt?.observation_age_seconds)} seconds
- Latest scan research candidates: ${cell(status.leader_hunt?.last_scan_research_shortlist)}
- Latest scan execution-fresh candidates: ${cell(status.leader_hunt?.last_scan_execution_fresh)}
- Continuity warning: ${cell(status.leader_hunt?.warning)}
- Objective: ${cell(status.leader_hunt?.objective || "catch eventual top gainers before +10%")}
- Assets: ${cell((status.leader_hunt?.assets || ["equity"]).join(", "))}
- Penny-stock floor: ${cell(status.leader_hunt?.penny_floor)}
- Max option signals per cycle: ${cell(status.leader_hunt?.max_option_signals_per_cycle)}
- Option stop: ${status.leader_hunt?.option_stop_pct == null ? "" : (Number(status.leader_hunt.option_stop_pct)*100).toFixed(0)+"% premium loss"}
- Option max hold: ${cell(status.leader_hunt?.option_max_hold_minutes)} minutes
- Option data: ${cell(status.leader_hunt?.option_data_quality)}
- Tracked per cycle: ${cell(status.leader_hunt?.tracked_per_cycle)}
- Max fresh signals per cycle: ${cell(status.leader_hunt?.max_new_signals_per_cycle)}
- Max open positions per account: ${cell(status.leader_hunt?.max_open_per_account)}
- Position size: ${status.leader_hunt?.position_pct == null ? "" : (Number(status.leader_hunt.position_pct)*100).toFixed(1)+"% of starting equity"}
- Profit ladder: ${(status.leader_hunt?.profit_ladder || []).map(x=>"+"+(Number(x.return_pct)*100).toFixed(0)+"%: sell "+(Number(x.fraction)*100).toFixed(1)+"%").join(" | ")}
- Main target: ${status.leader_hunt?.take_profit_return_pct == null ? "" : "+"+(Number(status.leader_hunt.take_profit_return_pct)*100).toFixed(0)+"% return; sell "+(Number(status.leader_hunt.take_profit_fraction)*100).toFixed(0)+"%"}
- Peak runner: ${status.leader_hunt?.runner_fraction == null ? "" : (Number(status.leader_hunt.runner_fraction)*100).toFixed(0)+"% remaining; "+(Number(status.leader_hunt.runner_trail_pct)*100).toFixed(0)+"% high-water retrace exit"}
- Max pre-target hold: ${cell(status.leader_hunt?.max_hold_minutes)} minutes
- Max runner hold after target: ${cell(status.leader_hunt?.runner_max_hold_minutes)} minutes
- Max minute-volume participation: ${status.leader_hunt?.max_minute_participation == null ? "" : (Number(status.leader_hunt.max_minute_participation)*100).toFixed(1)+"%"}
- Telemetry warning: ${cell(status.leader_hunt?.error || status.leader_hunt?.warning || huntPage.error || huntPositionsPage.error)}

### Top-gainer capture audit

- Board session: ${cell(huntGainersPage.session_date)}
- Board snapshot: ${cell(huntGainersPage.board_at)}
- Top-10 caught before +10%: ${cell(huntGainerSummary.top10_caught_before_10)} / ${cell(huntGainerSummary.top10_count)}
- Top-20 caught before +10%: ${cell(huntGainerSummary.caught_before_10)} / ${cell(huntGainerSummary.board_size)}
- Discovered while ≤+10%: ${cell(huntGainerSummary.discovered_under_10)}
- Reached 12-name shortlist while ≤+10%: ${cell(huntGainerSummary.shortlisted_under_10)}
- Eligible while ≤+10%: ${cell(huntGainerSummary.eligible_under_10)}
- Audit warning: ${cell(huntGainersPage.error)}

${table(huntGainerRows, [
  ["Rank","rank"],["Symbol","symbol"],["Current %","current_gain_pct"],
  ["First seen %","first_seen_gain_pct"],["Source","first_seen_source"],
  ["First ≤10%","first_under_10_gain_pct"],["Shortlisted","first_shortlisted_at"],
  ["Eligible","first_eligible_at"],["Entry %","entry_gain_pct"],["Asset","entry_asset"],
  ["Caught <10","caught_before_10"],["Miss reason","miss_reason"],
])}

### Capital-tier accounts

${table(status.leader_hunt?.accounts || [], [
  ["Account","label"],["Starting","starting_equity"],["Cash","cash"],["Equity","current_equity"],
  ["Realized P&L","realized_pnl"],["Max DD","max_drawdown_pct"],["Open","open_positions"],
  ["Closed","closed_trades"],["Trades 24h","trades_24h"],["Winners 24h","winners_24h"],["Updated","updated_at"],
])}

### Performance by asset

${table(status.leader_hunt?.asset_breakdown || [], [
  ["Asset","asset_type"],["Open","open_positions"],["Trades 24h","trades_24h"],
  ["Winners 24h","winners_24h"],["Avg closed %","avg_closed_return_pct"],
])}

### Compounding scoreboard — target 10x to 100x

${table(compoundingRows, [
  ["Account","label"],["Current","current_multiple"],["Equity","current_equity"],["Next","next_multiple"],
  ["Next target $","next_target_equity"],["Progress","progress_to_next_pct"],["Max DD","max_drawdown_pct"],
  ["2x","milestone_2x_at"],["5x","milestone_5x_at"],["10x","milestone_10x_at"],
  ["25x","milestone_25x_at"],["50x","milestone_50x_at"],["100x","milestone_100x_at"],
])}

### Performance by entry session

${table(status.leader_hunt?.session_breakdown || [], [
  ["Session","phase"],["Open signals","open_signals"],["Open positions","open_account_positions"],
  ["Avg open %","avg_open_return_pct"],["Closed signals 24h","closed_signals_24h"],
  ["Trades 24h","account_trades_24h"],["Winners 24h","winners_24h"],["Win rate","win_rate_24h"],
  ["Avg closed %","avg_closed_return_pct"],["Avg MFE %","avg_mfe_pct"],["Avg MAE %","avg_mae_pct"],
  ["Best %","best_return_pct"],["Worst %","worst_return_pct"],
])}

| Observations 24h | Open research positions | Closed trades 24h | Winners 24h | Win rate | Avg return % | Best % | Worst % | Latest observation | Latest close |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${cell(status.leader_hunt?.observations_24h)} | ${cell(status.leader_hunt?.open_positions)} | ${cell(status.leader_hunt?.trades_24h)} | ${cell(status.leader_hunt?.winners_24h)} | ${status.leader_hunt?.win_rate_24h == null ? "" : (Number(status.leader_hunt.win_rate_24h)*100).toFixed(1)+"%"} | ${cell(status.leader_hunt?.avg_return_pct_24h)} | ${cell(status.leader_hunt?.best_return_pct_24h)} | ${cell(status.leader_hunt?.worst_return_pct_24h)} | ${cell(status.leader_hunt?.latest_observation_at)} | ${cell(status.leader_hunt?.latest_trade_at)} |

### Leader Hunt open positions (${huntPositions.length})

${table(huntPositions, [
  ["Account","account"],["Asset","asset_type"],["Underlying","underlying"],["Symbol/contract","symbol"],["Entry","entry_price"],["Bid/mark","current_bid"],
  ["Unrealized %","unrealized_return_pct"],["Entry day %","entry_day_change_pct"],["Stage","stage"],
  ["Qty","quantity"],["Remaining","remaining"],["Locked P&L","locked_realized_pnl"],
  ["Distance to +200 %","distance_to_200_pct"],["Capacity limited","capacity_limited"],
  ["Actual notional","actual_notional"],["Minute participation","minute_participation"],["Mark time","mark_at"],
])}

### Recent Leader Hunt closes (${huntTrades.length})

${table(huntTrades, [
  ["Account","account"],["Asset","asset_type"],["Underlying","underlying"],["Symbol/contract","symbol"],["Entry % up","entry_day_change_pct"],["Entry score","entry_score"],
  ["Qty","quantity"],["Entry notional","entry_notional"],["Entry","entry_price"],["Exit","exit_price"],
  ["P&L","realized_pnl"],["Return %","return_pct"],["MFE %","mfe_pct"],["MAE %","mae_pct"],
  ["Minutes","minutes_held"],["Reason","exit_reason"],["Phase","opened_phase"],["Closed","closed_at"],
])}

## Open paper positions (${positions.length})

${table(positions, [
  ["Ledger", "ledger"], ["Lane", "lane"], ["Asset", "asset_type"], ["Symbol", "symbol"],
  ["Strategy", "strategy"], ["Direction", "direction"], ["Qty", "quantity"],
  ["Entry", "entry_price"], ["Mark", "current_mark"], ["Stop", "stop_price"],
  ["Target", "target_price"], ["Opened", "opened_at"],
])}

## Closed paper trades (${trades.length})

${table(trades, [
  ["Ledger", "ledger"], ["Lane", "lane"], ["Asset", "asset_type"], ["Symbol", "symbol"],
  ["Strategy", "strategy"], ["Direction", "direction"], ["Qty", "quantity"],
  ["Entry", "entry_price"], ["Exit", "exit_price"], ["P&L", "realized_pnl"],
  ["Simulator", "simulator_version"], ["Return %", "return_pct"], ["R", "r_multiple"], ["Reason", "exit_reason"], ["Closed", "closed_at"],
])}

## Most recent paper decisions (${decisions.length} shown)

${table(decisions, [
  ["Time", "created_at"], ["Ledger", "ledger"], ["Lane", "lane"], ["Asset", "asset_type"],
  ["Symbol", "symbol"], ["Strategy", "strategy"], ["Decision", "decision"],
  ["Score", "score"], ["Reference", "reference_price"], ["Reason", "reason"],
])}

## Version

- Worker version: ${cell(status.version?.worker_version)}
- Worker deployed: ${cell(status.version?.deployed_at)}
- D1 schema: ${cell(status.paper?.schema_version)}

_Source endpoints remain available at ${base}, but normal ChatGPT should read this GitHub issue through the connected GitHub app._
`;

process.stdout.write(report.slice(0, 64000));

// Workflow pushes provide an immediate verification refresh when scheduled jobs are delayed (watchdog verification).
