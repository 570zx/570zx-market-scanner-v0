import {LEADER_VERSION} from './autonomous.ts';
import {candidateLane,runnerReasons,executionReasons,optionDirection,type ResearchCandidate} from './leader-policy.ts';

export const cycleBucket=(now=new Date())=>new Date(Math.floor(now.getTime()/300_000)*300_000).toISOString();
export const cadenceBucket=(now=new Date(),minutes=5)=>{const ms=Math.max(1,minutes)*60_000;return new Date(Math.floor(now.getTime()/ms)*ms).toISOString();};
export const sessionDate=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function decisionStatement(db:D1Database,c:ResearchCandidate,lane:string,stage:string,reasons:string[],features:unknown,account='',now=new Date(),outcome?:string){
  return db.prepare(`INSERT INTO candidate_decisions VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bucket,symbol,lane,account_id,stage,version) DO UPDATE SET
    created_at=excluded.created_at,outcome=excluded.outcome,reasons=excluded.reasons,features=excluded.features
    WHERE candidate_decisions.outcome!='ENTERED' OR excluded.outcome='ENTERED'`)
    .bind(cycleBucket(now),now.toISOString(),c.symbol,lane,account,stage,outcome??(reasons.length?'REJECTED':'ELIGIBLE'),JSON.stringify(reasons),JSON.stringify(features),LEADER_VERSION);
}
export async function recordDecision(...args:Parameters<typeof decisionStatement>){await decisionStatement(...args).run();}

export async function persistResearch(db:D1Database,symbols:string[],rows:ResearchCandidate[],sources:Map<string,{source:string;rank:number|null}>,shortlist:Set<string>,phase:string,features:(c:any)=>unknown,now=new Date()){
  const bySymbol=new Map(rows.map(c=>[c.symbol,c])),universe=new Set(symbols);
  const statements:D1PreparedStatement[]=[];
  for(const symbol of new Set([...symbols,...sources.keys()])){
    const c=bySymbol.get(symbol),source=sources.get(symbol)?.source??'held_or_continuity';
    const shortlisted=shortlist.has(symbol);
    let reasons:string[];
    if(!universe.has(symbol)) reasons=['NOT_IN_DISCOVERY_UNIVERSE'];
    else if(!c) reasons=['DATA_PROVIDER_FAILURE','RESEARCH_PRICE_UNAVAILABLE'];
    else reasons=[...runnerReasons(c),...executionReasons(c),...(!shortlisted?['NOT_SHORTLISTED']:[])];
    const snapshot={...(c?features(c) as object:{}),phase,source,shortlisted,
      runner_reasons:c?runnerReasons(c):[],option_eligible:!!c&&optionDirection(c)!==null,
      price:c?.price??null,day_change_pct:c?.dayChangePct??null,reasons};
    const encoded=JSON.stringify(snapshot),stamp=now.toISOString();
    statements.push(db.prepare(`INSERT INTO candidate_decisions VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(bucket,symbol,lane,account_id,stage,version) DO UPDATE SET created_at=excluded.created_at,outcome=excluded.outcome,reasons=excluded.reasons,features=excluded.features`)
      .bind(cycleBucket(now),stamp,symbol,c?candidateLane(c):'UNCLASSIFIED','','RESEARCH',reasons.length?'REJECTED':'ELIGIBLE',JSON.stringify(reasons),encoded,LEADER_VERSION));
    statements.push(db.prepare(`INSERT INTO research_outcomes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(session_date,symbol,version) DO UPDATE SET
      first_provider_at=COALESCE(research_outcomes.first_provider_at,excluded.first_provider_at),
      first_seen_at=COALESCE(research_outcomes.first_seen_at,excluded.first_seen_at),
      first_price=COALESCE(research_outcomes.first_price,excluded.first_price),first_change=COALESCE(research_outcomes.first_change,excluded.first_change),
      shortlisted_at=COALESCE(research_outcomes.shortlisted_at,excluded.shortlisted_at),runner_at=COALESCE(research_outcomes.runner_at,excluded.runner_at),
      executable_at=COALESCE(research_outcomes.executable_at,excluded.executable_at),last_seen_at=excluded.last_seen_at,
      high=CASE WHEN excluded.high IS NULL THEN research_outcomes.high WHEN research_outcomes.high IS NULL THEN excluded.high ELSE MAX(research_outcomes.high,excluded.high) END,
      low=CASE WHEN excluded.low IS NULL THEN research_outcomes.low WHEN research_outcomes.low IS NULL THEN excluded.low ELSE MIN(research_outcomes.low,excluded.low) END,
      latest_features=excluded.latest_features`)
      .bind(sessionDate(now),symbol,LEADER_VERSION,['recent','held_or_continuity'].includes(source)?null:stamp,
        universe.has(symbol)?stamp:null,c?.price??null,c?.dayChangePct??null,source,'equity_unclassified',shortlisted?stamp:null,
        c&&shortlisted&&!runnerReasons(c).length?stamp:null,c&&shortlisted&&!runnerReasons(c).length&&c.executionFresh?stamp:null,
        stamp,c?.price??null,c?.price??null,encoded));
  }
  for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
}

export function moverMiss(first:any,entry:any,reasons:string[]){
  if(entry) return Number(entry.entry_day_change_pct)<=10?'ENTERED_BEFORE_10':'ENTERED_AFTER_10';
  if(!first?.first_seen_at) return 'NOT_IN_DISCOVERY_UNIVERSE';
  // v8.2+ continuation policy deliberately allows first discovery above +10%.
  // Report the actual rejection/availability reason instead of the obsolete
  // DISCOVERED_AFTER_THRESHOLD label from the early-runner-only policy.
  if(reasons.length) return reasons[0];
  if(!first.shortlisted_at) return 'NOT_SHORTLISTED';
  return 'NO_ENTRY_DECISION_RECORDED';
}

export async function auditMovers(db:D1Database,phase:string,now=new Date()){
  const bucket=cycleBucket(now),date=sessionDate(now);
  const board=(await db.prepare('SELECT * FROM hunt_gainer_board WHERE bucket=? ORDER BY rank LIMIT 20').bind(bucket).all<any>()).results??[];
  if(!board.length) return {count:0};
  const outcomes=(await db.prepare('SELECT * FROM research_outcomes WHERE session_date=? AND version=?').bind(date,LEADER_VERSION).all<any>()).results??[];
  const entries=(await db.prepare(`SELECT symbol,opened_at,entry_price,entry_day_change_pct,'equity' AS asset_type,version FROM hunt_account_positions WHERE opened_at>=?
    UNION ALL SELECT underlying AS symbol,opened_at,entry_price,entry_day_change_pct,'option' AS asset_type,version FROM hunt_account_option_positions WHERE opened_at>=?`)
    .bind(date,date).all<any>()).results??[];
  const symbols=board.map(g=>g.symbol);
  const decisions=(await db.prepare(`SELECT * FROM candidate_decisions WHERE created_at>=? AND version=? AND symbol IN (${symbols.map(()=>'?').join(',')})
    ORDER BY CASE WHEN COALESCE(json_extract(features,'$.day_change_pct'),0)<=10 THEN 0 ELSE 1 END,
    CASE stage WHEN 'ENTRY' THEN 0 WHEN 'OPTION_CHAIN' THEN 1 ELSE 2 END,created_at ASC`)
    .bind(date,LEADER_VERSION,...symbols).all<any>()).results??[];
  const statements:D1PreparedStatement[]=[];
  for(const g of board){
    const first=outcomes.find(o=>o.symbol===g.symbol);
    const entry=entries.filter(e=>e.symbol===g.symbol&&sessionDate(new Date(e.opened_at))===date).sort((a,b)=>a.opened_at.localeCompare(b.opened_at))[0];
    const rejects=decisions.filter(d=>d.symbol===g.symbol&&d.outcome==='REJECTED');
    const reasons=[...new Set(rejects.flatMap(d=>JSON.parse(d.reasons) as string[]))];
    const summary={symbol:g.symbol,rank:g.rank,board_at:g.created_at,board_phase:phase,current_gain_pct:g.percent_change,current_price:g.price,
      instrument_type:first?.instrument_type??'unknown',first_provider_at:first?.first_provider_at??null,
      provider_time_basis:'first MEDS poll that observed provider appearance; upstream first publication time unavailable',
      first_seen_at:first?.first_seen_at??null,first_seen_gain_pct:first?.first_change??null,first_seen_price:first?.first_price??null,
      first_seen_source:first?.source??null,first_shortlisted_at:first?.shortlisted_at??null,first_eligible_at:first?.runner_at??null,
      execution_eligible_at:first?.executable_at??null,first_entry_at:entry?.opened_at??null,entry_price:entry?.entry_price??null,
      entry_gain_pct:entry?.entry_day_change_pct??null,entry_asset:entry?.asset_type??null,
      caught_before_5:!!entry&&entry.entry_day_change_pct<=5,caught_before_10:!!entry&&entry.entry_day_change_pct<=10,caught_before_20:!!entry&&entry.entry_day_change_pct<=20,
      sampled_mfe_pct:first?.first_price>0?(first.high/first.first_price-1)*100:null,
      sampled_mae_pct:first?.first_price>0?(first.low/first.first_price-1)*100:null,
      excursion_basis:'observed research prices after first usable price; not continuous-market best fill',
      miss_reason:moverMiss(first,entry,reasons),miss_reason_decision_at:rejects[0]?.created_at??null,rejection_reasons:reasons,
      rejection_by_account:rejects.filter(d=>d.account_id).map(d=>({account:d.account_id,lane:d.lane,reasons:JSON.parse(d.reasons)})),version:LEADER_VERSION};
    statements.push(db.prepare('INSERT OR REPLACE INTO mover_audits VALUES(?,?,?,?,?,?,?)').bind(bucket,g.symbol,date,phase,g.rank,JSON.stringify(summary),LEADER_VERSION));
  }
  await db.batch(statements);
  return {count:board.length};
}

function distribution(rows:any[]){
  const returns=rows.map(r=>Number(r.return_pct)).sort((a,b)=>a-b);
  const mean=(key:string)=>rows.length?rows.reduce((n,r)=>n+Number(r[key]??0),0)/rows.length:null;
  const n=returns.length;
  return {trades:n,winners:rows.filter(r=>r.realized_pnl>0).length,win_rate:n?rows.filter(r=>r.realized_pnl>0).length/n:null,
    average_return:mean('return_pct'),median_return:n?(returns[Math.floor((n-1)/2)]+returns[Math.floor(n/2)])/2:null,
    best:n?returns[n-1]:null,worst:n?returns[0]:null,average_mfe:mean('mfe_pct'),average_mae:mean('mae_pct'),average_holding_minutes:mean('minutes_held'),
    take200_hits:rows.filter(r=>r.take200_hit).length,runner_exits:rows.filter(r=>String(r.exit_reason).startsWith('runner_')).length,
    runner_average_return:rows.some(r=>String(r.exit_reason).startsWith('runner_'))?distributionWithoutRecursion(rows.filter(r=>String(r.exit_reason).startsWith('runner_'))):null};
}
function distributionWithoutRecursion(rows:any[]){return rows.reduce((n,r)=>n+Number(r.return_pct),0)/rows.length;}
export const STRATEGY_VERSION_ORDER=[
  'leader-hunt-v7-asymmetric-runner',
  'leader-hunt-v8.1-leader250-capacity',
  'leader-hunt-v8.2-continuation-runner',
  'leader-hunt-v8.3-capital-rotation',
] as const;
export async function performanceReport(db:D1Database,url:URL,currentVersion=LEADER_VERSION){
  const requested=url.searchParams.get('version')??currentVersion;
  const idx=STRATEGY_VERSION_ORDER.indexOf(currentVersion as any);
  const previous=idx>0?STRATEGY_VERSION_ORDER[idx-1]:null;
  const version=requested==='previous'?(previous??currentVersion):requested;
  const params:unknown[]=[],clauses:string[]=[];
  if(version!=='all'){clauses.push('version=?');params.push(version);}
  if(url.searchParams.get('window')==='24h'){clauses.push('closed_at>=?');params.push(new Date(Date.now()-86400000).toISOString());}
  const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  const rows=(await db.prepare(`SELECT * FROM (SELECT 'equity' AS asset_type,* FROM hunt_account_trades ${where})`).bind(...params).all<any>()).results??[];
  rows.push(...((await db.prepare(`SELECT 'option' AS asset_type,* FROM hunt_account_option_trades ${where}`).bind(...params).all<any>()).results??[]));
  const dimension=url.searchParams.get('group')??'asset_type';
  const allowed=new Set(['asset_type','version','account_id','opened_phase','source','price_bucket','score_bucket']);
  if(!allowed.has(dimension)) return {ok:false,error:'invalid group',allowed_groups:[...allowed]};
  const groups=new Map<string,any[]>();
  for(const r of rows){
    let f:any={};try{f=JSON.parse(r.features);}catch{}
    const price=Number(f.price??r.entry_price),score=Number(f.equity_runner_score??r.entry_score);
    const value=dimension==='source'?f.discovery_source??'legacy_unknown':dimension==='price_bucket'?price<1?'<1':price<=5?'1-5':price<=25?'5-25':'>25':dimension==='score_bucket'?score<50?'<50':score<100?'50-99':'100+':String(r[dimension]);
    groups.set(value,[...(groups.get(value)??[]),r]);
  }
  const events=(await db.prepare(`SELECT version,event_type,COUNT(*) AS count FROM
    (SELECT version,event_type,created_at FROM hunt_account_events UNION ALL SELECT version,event_type,created_at FROM hunt_account_option_events)
    ${where.replaceAll('closed_at','created_at')} GROUP BY version,event_type`).bind(...params).all<any>()).results??[];
  const count=(event:string)=>events.filter(e=>e.event_type===event).reduce((n,e)=>n+Number(e.count),0);
  return {ok:true,read_only:true,version,requested_version:requested,previous_version:previous,window:url.searchParams.get('window')??'all-time',current_version:currentVersion,
    sample_unit:'account trades; capital tiers are correlated simulations, not independent signals',summary:{...distribution(rows),ladder_25_hits:count('LADDER_25'),ladder_50_hits:count('LADDER_50'),ladder_100_hits:count('LADDER_100'),take200_events:count('TAKE_200')},
    lifecycle_events:events,group:dimension,groups:[...groups].map(([key,r])=>({key,...distribution(r)}))};
}
