import {pathToFileURL} from 'node:url';
const cell=v=>v===null||v===undefined?'—':String(v).replaceAll('|','\\|').replaceAll('\n',' ');
const table=(rows,columns)=>rows?.length?[
  '| '+columns.map(c=>c[0]).join(' | ')+' |',
  '| '+columns.map(()=>'---').join(' | ')+' |',
  ...rows.map(row=>'| '+columns.map(c=>cell(row[c[1]])).join(' | ')+' |'),
].join('\n'):'_No records for this selection._';
export function renderReport({status={},audit={},performance={},previous={},positions={},errors=[]},now=new Date()){
 const hunt=status.leader_hunt??{},engine=status.engine??{};
 const state=status.health??(status.ok?'HEALTHY':'TELEMETRY_UNAVAILABLE');
 return `# MEDS Scout — Live Paper-Trading Monitor

> Read-only reporting surface. Engine operation does not require GitHub or ChatGPT. Report refresh is manual until the deployment and usage gates are satisfied.

**Report retrieved:** ${now.toISOString()}

**Worker snapshot:** ${cell(status.time)}

**Engine state:** ${cell(state)}

**Mode:** ${cell(status.mode)} · **Live execution:** ${cell(status.live_execution)}

**Leader version:** ${cell(hunt.version)} · **Engine version:** ${cell(engine.version)}

${errors.length?'**Retrieval errors:** '+errors.map(cell).join('; '):''}

## Operations

| Component | State | Last success or management | Detail |
| --- | --- | --- | --- |
| Scanner | ${cell(status.scanner?.state)} | ${cell(status.scanner?.last_success_at)} | ${cell(status.scanner?.last_error)} |
| Paper | ${cell(status.paper?.state)} | ${cell(status.paper?.last_cycle_at)} | ${cell(status.paper?.valuation_state)} |
| Leader | ${cell(hunt.health)} | ${cell(hunt.last_management_at)} | ${cell(hunt.last_scan_hunt_error)} |

- Deployment gate enabled: ${cell(engine.configured_enabled)}; runtime paused: ${cell(engine.runtime_paused)}.
- Planned active-session interval: ${cell(engine.cadence_minutes)} minutes; configured scheduler: ${cell(engine.single_scheduler)}.
- Latest cycle provider requests: ${cell(engine.usage?.requests)} / ${cell(engine.usage?.request_limit)}; cache hits: ${cell(engine.usage?.cache_hits)}; bounded retries: ${cell(engine.usage?.retries)}.
- Latest measured database calls: ${cell(engine.usage?.database?.calls)}; SQL statements: ${cell(engine.usage?.database?.statements)}; reported rows written: ${cell(engine.usage?.database?.rows_written)}. Deployment plan limits must be checked before restarting.
- Provider warnings: ${cell((engine.usage?.failures??[]).map(f=>f.endpoint+': '+f.reason).join('; '))}.
- Research candidates: ${cell(hunt.last_scan_research_shortlist)}; execution-fresh candidates: ${cell(hunt.last_scan_execution_fresh)}.

## Capital tiers and valuation

${table(hunt.accounts,[['Account','label'],['Cash','cash'],['Spendable','spendable_cash'],['Live marked equity','current_equity'],['Dated reporting equity','reporting_equity'],['Valuation state','valuation_state'],['Open','open_positions'],['As of','valuation_at']])}

Dated reporting equity may contain stale retained quotes. Missing values stay unavailable. Only complete fresh valuations update equity peaks and drawdown. Capital tiers are correlated simulations, not independent strategy trials.

${table((status.valuations??[]).map(v=>({...v,mark_issues:v.marks.filter(m=>m.state!=='FRESH').map(m=>m.symbol+': '+m.state+' ('+cell(m.age_seconds)+'s)').join('; ')})),[['Account','account_id'],['State','state'],['Known subtotal at snapshot','known_value_at_snapshot'],['Reporting value','reporting_value'],['Quote issues','mark_issues']])}

## Version-separated performance

${table([{selection:'Current version',...performance.summary},{selection:'v7',...previous.summary}],[['Selection','selection'],['Closed trades','trades'],['Win rate','win_rate'],['Average %','average_return'],['Median %','median_return'],['Best %','best'],['Worst %','worst'],['Avg MFE %','average_mfe'],['Avg MAE %','average_mae'],['Avg minutes','average_holding_minutes'],['+200 hits','take200_hits']])}

${table(performance.groups,[['Current-version lane','key'],['Trades','trades'],['Win rate','win_rate'],['Average %','average_return'],['Median %','median_return'],['Runner exits','runner_exits']])}

${table(performance.lifecycle_events,[['Version','version'],['Lifecycle event','event_type'],['Account hits','count']])}

## Top-mover audit

Board: ${cell(audit.board_at)} · Session: ${cell(audit.board_phase)}

Top 10 caught before +10%: ${cell(audit.summary?.top10_caught_before_10)} / ${cell(audit.summary?.top10_count)}.

Board captures before +5 / +10 / +20%: ${cell(audit.summary?.caught_before_5)} / ${cell(audit.summary?.caught_before_10)} / ${cell(audit.summary?.caught_before_20)}.

${table(audit.rows,[['Rank','rank'],['Symbol','symbol'],['Current %','current_gain_pct'],['First seen %','first_seen_gain_pct'],['Source','first_seen_source'],['Entry %','entry_gain_pct'],['Miss reason','miss_reason'],['Sampled MFE %','sampled_mfe_pct'],['Sampled MAE %','sampled_mae_pct']])}

Provider appearance is the first MEDS poll observing it, not an unknowable upstream publication time. Excursions use sampled prices after first observation, not hypothetical perfect fills.

## Latest decisions

${table((status.decisions_latest??[]).map(r=>({...r,reasons:r.reasons.join(', ')})),[['Lane','lane'],['Stage','stage'],['Outcome','outcome'],['Reason codes','reasons'],['Count','count']])}

## Open Leader positions

${table(positions.rows,[['Account','account'],['Asset','asset_type'],['Symbol','symbol'],['Remaining','remaining_qty'],['Entry','entry_price'],['Fresh return %','unrealized_return_pct'],['Quote state','quote_state'],['Quote time','mark_at'],['Entry version','version']])}

## Deployment

- Worker version: ${cell(status.version?.worker_version)}; deployed: ${cell(status.version?.deployed_at)}.
- D1 schema: ${cell(status.paper?.schema_version)}.
- Simulator: ${cell(status.diagnostics?.simulator_version)}; execution model: ${cell(status.diagnostics?.execution_version)}.
- Existing pre-fix drawdown history is preserved and remains untrusted.

Read-only API: /status, /health, /status/hunt/gainers, /status/hunt/decisions, /status/hunt/performance.
`.slice(0,64000);
}
export async function fetchReport(base){
 const errors=[];
 const get=async path=>{
   try{const r=await fetch(base+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}
   catch(error){errors.push(path+': '+error.message);return {};}
 };
 const [status,audit,performance,previous,positions]=await Promise.all([
   get('/status'),get('/status/hunt/gainers?limit=20'),get('/status/hunt/performance'),get('/status/hunt/performance?version=previous'),get('/status/hunt/positions?limit=100'),
 ]);
 return {status,audit,performance,previous,positions,errors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.stdout.write(renderReport(await fetchReport(process.env.MEDS_BASE_URL||'https://meds-scout-agent.sucharda-dodge.workers.dev')));
}
