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

const [status, tradesPage, positionsPage, decisionsPage] = await Promise.all([
  get("/status"),
  get("/status/trades?limit=100"),
  get("/status/positions?limit=100"),
  get("/status/decisions?limit=100"),
]);

const ledgers = status.ledgers || [];
const trades = tradesPage.rows || [];
const positions = positionsPage.rows || [];
const decisions = (decisionsPage.rows || []).slice(0, 50);
const generatedAt = new Date().toISOString();
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
