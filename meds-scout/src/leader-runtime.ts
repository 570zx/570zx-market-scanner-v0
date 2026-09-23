import {MarketDataCycle,mandatoryUniverse} from './market-data.ts';
import {validQuote} from './paper-accounting.ts';
import {runnerReasons,executionReasons,candidateLane,optionDirection} from './leader-policy.ts';
import {LEASE_MS,plannedCadence} from './autonomous.ts';
import {cycleBucket,cadenceBucket,sessionDate,moverMiss} from './research-audit.ts';
import {ACTIVE_ACCOUNT,CAPACITY_ENGINE,CAPACITY_VERSION,CycleDB,LeaderPlan,ingest,accountingStatements,valuation,type Row} from './leader-capacity.ts';

type Dependencies={phase:(now?:Date)=>string;active:(now?:Date)=>boolean;feed:(now?:Date)=>string;
  discover:(env:any,recent:string[])=>Promise<any>;snapshots:(env:any,symbols:string[])=>Promise<any>;news:(env:any,symbols:string[])=>Promise<any[]>;
  score:(c:any,regular:boolean)=>any;catalyst:(news:any[],symbol:string)=>any;select:(rows:any[],discovery:any)=>any[];
  features:(c:any,phase:any)=>Row;chain:(env:any,c:any,direction:'bull'|'bear')=>Promise<any[]>};
const shardFor=(symbol:string)=>[...symbol].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%16;
const fresh=(time:string|undefined,maxAge:number)=>Number.isFinite(Date.parse(time??''))&&Date.parse(time!)<=Date.now()&&Date.now()-Date.parse(time!)<=maxAge;
const upsert=(columns:string[],keys:string[])=>'ON CONFLICT('+keys.join(',')+') DO UPDATE SET '+columns.filter(c=>!keys.includes(c)).map(c=>c+'=excluded.'+c).join(',');

export async function runLeaderCycle(env:any,source:string,d:Dependencies){
  if(env.TRADING_MODE!=='shadow')throw Error('Only shadow mode is supported; no brokerage execution exists');
  const db=new CycleDB(env.MEDS_DB),now=new Date(),bucket=cycleBucket(now),date=sessionDate(now),marketPhase=d.phase(now);
  const cadence=env.ENGINE_CADENCE==='session'?plannedCadence(marketPhase):5,engineBucket=cadenceBucket(now,cadence||5),startedAt=now.toISOString();
  const state=(await db.all(`SELECT s.*,m.version AS schema_version,(SELECT completed_at FROM engine_cycles WHERE bucket=?) AS completed_at FROM service_state s JOIN paper_meta m ON m.id=s.id WHERE s.id=1`,[engineBucket],'state'))[0];
  if(env.SCOUT_ENABLED!=='true'||state?.paused)return {ok:true,skipped:'disabled',version:CAPACITY_ENGINE};
  if(!d.active(now))return {ok:true,skipped:'outside scan window'};
  if(state?.schema_version!==11)return {ok:false,error:'DEPLOYMENT_MIGRATION_REQUIRED: expected schema 11'};
  if(state.completed_at)return {ok:true,skipped:'cycle already complete'};
  const owner=crypto.randomUUID();
  const claim=await db.run(`UPDATE service_state SET lock_owner=?,lock_until=?,last_tick_at=?,last_source=?,tick_count=tick_count+1 WHERE id=1 AND paused=0 AND (lock_until IS NULL OR lock_until<=?)`,[owner,now.getTime()+LEASE_MS,now.toISOString(),source,now.getTime()],'lease_claim');
  if(!claim.meta.changes)return {ok:true,skipped:'scan already running'};
  const data=new MarketDataCycle(env,36),runEnv={...env,DATA:data};
  try{
    if(!env.ALPACA_API_KEY||!env.ALPACA_API_SECRET)throw Error('Missing Alpaca secrets');
    // Reads are independent of the number of historical accounts or held symbols.
    // No normal ledger/position/decision query exists in this runtime.
    const [accounts,equities,options,events,intents,cooldowns,prior,retained,shards]=await Promise.all([
      db.all(`SELECT a.*,r.revision,c.version AS runtime_config_version,COALESCE(d.rotations,0) AS rotations_today,d.last_rotation_at FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) JOIN leader_runtime_config c USING(account_id) LEFT JOIN leader_daily_risk d ON d.account_id=a.account_id AND d.session_date=? WHERE c.id=1 AND a.account_id=? AND c.version=?`,[date,ACTIVE_ACCOUNT,CAPACITY_VERSION],'active_account'),
      db.all(`SELECT *, 'equity' AS kind FROM hunt_account_positions WHERE account_id=? AND status='open' ORDER BY id`,[ACTIVE_ACCOUNT],'equity_inventory'),
      db.all(`SELECT *, 'option' AS kind FROM hunt_account_option_positions WHERE account_id=? AND status='open' ORDER BY id`,[ACTIVE_ACCOUNT],'option_inventory'),
      db.all(`SELECT 'equity' AS kind,position_id,event_type FROM hunt_account_events WHERE account_id=? AND position_id IN (SELECT id FROM hunt_account_positions WHERE account_id=? AND status='open') UNION ALL SELECT 'option',position_id,event_type FROM hunt_account_option_events WHERE account_id=? AND position_id IN (SELECT id FROM hunt_account_option_positions WHERE account_id=? AND status='open')`,[ACTIVE_ACCOUNT,ACTIVE_ACCOUNT,ACTIVE_ACCOUNT,ACTIVE_ACCOUNT],'lifecycle'),
      db.all(`SELECT i.* FROM hunt_exit_intents i WHERE (kind='equity' AND position_id IN (SELECT id FROM hunt_account_positions WHERE account_id=? AND status='open')) OR (kind='option' AND position_id IN (SELECT id FROM hunt_account_option_positions WHERE account_id=? AND status='open'))`,[ACTIVE_ACCOUNT,ACTIVE_ACCOUNT],'pending_exits'),
      db.all(`SELECT symbol FROM hunt_account_trades WHERE account_id=? AND closed_at>=? UNION SELECT underlying AS symbol FROM hunt_account_option_trades WHERE account_id=? AND closed_at>=?`,[ACTIVE_ACCOUNT,new Date(now.getTime()-900000).toISOString(),ACTIVE_ACCOUNT,new Date(now.getTime()-900000).toISOString()],'cooldowns'),
      db.all(`SELECT * FROM symbol_state WHERE last_seen_at>=?`,[new Date(now.getTime()-12*3600000).toISOString()],'symbol_state'),
      db.all(`SELECT * FROM quote_cache WHERE (asset='equity' AND symbol IN (SELECT symbol FROM hunt_account_positions WHERE account_id=? AND status='open')) OR (asset='option' AND symbol IN (SELECT symbol FROM hunt_account_option_positions WHERE account_id=? AND status='open'))`,[ACTIVE_ACCOUNT,ACTIVE_ACCOUNT],'retained_marks'),
      db.all(`SELECT shard,data FROM leader_research_shards WHERE session_date=? AND version=?`,[date,CAPACITY_VERSION],'research_state'),
    ]);
    if(accounts.length!==1||accounts[0].starting_equity!==250)throw Error('ACTIVE_ACCOUNT_CONFIGURATION_INVALID_OR_VERSION_MISMATCH');
    if(equities.length+options.length>32)throw Error('ACTIVE_ACCOUNT_POSITION_CAP_INVALID');
    const discovery=await d.discover(runEnv,prior.slice().sort((a,b)=>b.score-a.score).slice(0,80).map(p=>p.symbol));
    const executionFeed=d.feed(now),equityExecutionAuthoritative=marketPhase==='regular'&&executionFeed==='iex';
    const held=[...new Set([...equities.map(p=>p.symbol),...options.map(p=>p.underlying)])];
    const symbols=mandatoryUniverse(held,discovery.symbols,prior.map(p=>p.symbol),320);
    const stocks=await d.snapshots(runEnv,symbols),optionMarks:Row={};
    const missing=held.filter(s=>!validQuote(stocks[s]?.latestQuote));
    if(missing.length){data.retries++;try{const r=await data.json('/v2/stocks/quotes/latest?'+new URLSearchParams({symbols:missing.join(','),feed:executionFeed}),0);for(const s of missing)if(validQuote(r.quotes?.[s]))stocks[s]={...stocks[s],latestQuote:r.quotes[s]};}catch{}}
    const quarantinedHeld=new Set<string>();
    const retainedByKey=new Map(retained.map(r=>[r.asset+':'+r.symbol,r]));
    for(const p of equities){
      const q=stocks[p.symbol]?.latestQuote;if(!validQuote(q))continue;
      const old=retainedByKey.get('equity:'+p.symbol),reference=Number(old?.bid??p.entry_price);
      if(reference>0){
        const ratio=Number(q.bp)/reference;
        if(ratio>5||ratio<.2){quarantinedHeld.add(p.symbol);stocks[p.symbol]={...stocks[p.symbol],latestQuote:undefined};}
      }
    }
    if(options.length){
      const path='/v1beta1/options/snapshots?'+new URLSearchParams({symbols:options.map(p=>p.symbol).join(','),feed:'indicative'});
      try{Object.assign(optionMarks,(await data.json(path)).snapshots??{});}catch{}
      const stale=options.filter(p=>!validQuote(optionMarks[p.symbol]?.latestQuote));
      if(stale.length){data.retries++;try{Object.assign(optionMarks,(await data.json('/v1beta1/options/snapshots?'+new URLSearchParams({symbols:stale.map(p=>p.symbol).join(','),feed:'indicative'}),0)).snapshots??{});}catch{}}
    }
    const priorMap=new Map(prior.map(p=>[p.symbol,p])),rows:Row[]=[];
    for(const symbol of symbols){
      const s=stocks[symbol],q=s?.latestQuote,age=marketPhase==='regular'?300000:1200000;
      const shaped=fresh(q?.t,age)&&q.bp>0&&q.ap>=q.bp;
      const price=shaped?(q.bp+q.ap)/2:fresh(s?.latestTrade?.t,age)?s.latestTrade.p:fresh(s?.minuteBar?.t,age)?s.minuteBar.c:0;
      if(!(price>0))continue;
      const old=priorMap.get(symbol),p=old&&sessionDate(new Date(old.last_seen_at))===date?old:null;
      const minute=fresh(s?.minuteBar?.t,180000)?Number(s.minuteBar.v??0):0,previous=p?.last_minute_volume??minute,prevClose=s?.prevDailyBar?.c??0;
      const info=discovery.sourceBySymbol.get(symbol),t=Date.parse(q?.t??'');
      const c={symbol,price,bid:shaped?q.bp:price,ask:shaped?q.ap:price,spreadPct:shaped?(q.ap-q.bp)/price*100:99,
        dayChangePct:prevClose>0?(price/prevClose-1)*100:0,dayVolume:s?.dailyBar?.v??0,previousDayVolume:s?.prevDailyBar?.v??0,
        minuteVolume:minute,volumeAccel:previous>0?(minute-previous)/previous:0,consecutiveHits:(p&&Date.now()-Date.parse(p.last_seen_at)<(plannedCadence(marketPhase)+2)*60000?p.consecutive_hits:0)+1,
        catalystScore:0,catalystSummary:'',score:0,reasons:[],executionAuthority:equityExecutionAuthoritative,executionFeed,
        executionFresh:equityExecutionAuthoritative&&validQuote(q),quoteAgeMs:Number.isFinite(t)?Date.now()-t:Infinity,
        discoverySource:info?.source,discoveryRank:info?.rank??null,
        dataWarnings:[...(prevClose>0?[]:['REFERENCE_PRICE_UNAVAILABLE']),...(quarantinedHeld.has(symbol)?['UNVERIFIED_HELD_PRICE_DISCONTINUITY']:[])]};
      d.score(c,marketPhase==='regular');rows.push(c);
    }
    // Never hard-cap positive day change before policy evaluation. A name first
    // seen at +25% can still have most of an asymmetric move ahead of it.
    // Negative controls remain bounded; positive continuation is governed by
    // runnerReasons() evidence thresholds rather than an arbitrary percent cap.
    let selected=d.select(rows.filter(c=>c.price>=.1&&c.dayChangePct>=-15),discovery);
    let news:any[]=[];try{news=await d.news(runEnv,selected.map(c=>c.symbol));}catch{}
    for(const c of selected){const h=d.catalyst(news,c.symbol);c.catalystScore=h.score;c.catalystSummary=h.summary;d.score(c,marketPhase==='regular');}
    selected=d.select(selected,discovery);
    const features=(c:any)=>d.features(c,marketPhase),strengthBySymbol=new Map(prior.map(p=>[p.symbol,Number(p.score??0)])),plan=new LeaderPlan(accounts[0],[...equities,...options],events,intents,cooldowns.map(c=>c.symbol),now,marketPhase,strengthBySymbol);
    plan.manage(stocks,optionMarks);const managementAt=new Date().toISOString();
    const preEntryValuation=valuation(plan,stocks,optionMarks,retained);
    if(preEntryValuation.complete){
      plan.enterEquities(selected,stocks,features);
      await plan.enterOptions(selected,stocks,optionMarks,(c,dir)=>d.chain(runEnv,c,dir),features);
    }else{
      for(const c of selected){
        if(!runnerReasons(c as any).length&&c.executionFresh===true)
          plan.decision(c,candidateLane(c as any),'ENTRY_RISK_GATE',['PORTFOLIO_VALUATION_INCOMPLETE'],features(c));
      }
    }
    if(Date.now()>plan.executionDeadline)throw Error('EXECUTION_QUOTES_EXPIRED_BEFORE_COMMIT');
    const ss=accountingStatements(env.MEDS_DB,plan),stamp=now.toISOString(),selectedSet=new Set(selected.map(c=>c.symbol)),rowMap=new Map(rows.map(c=>[c.symbol,c]));
    const shardMap=new Map<number,Row>(shards.map(s=>[s.shard,JSON.parse(s.data)])),changed=new Set<number>();
    const research:Row[]=[];
    for(const symbol of new Set([...symbols,...discovery.sourceBySymbol.keys()])){
      const c=rowMap.get(symbol),shortlisted=selectedSet.has(symbol),info=discovery.sourceBySymbol.get(symbol),source=info?.source??'held_or_continuity';
      const reasons=!symbols.includes(symbol)?['NOT_IN_DISCOVERY_UNIVERSE']:!c?['DATA_PROVIDER_FAILURE','RESEARCH_PRICE_UNAVAILABLE']:[...runnerReasons(c as any),...executionReasons(c as any),...(!shortlisted?['NOT_SHORTLISTED']:[])];
      const evidence={symbol,source,shortlisted,price:c?.price??null,day_change_pct:c?.dayChangePct??null,runner_eligible:!!c&&!runnerReasons(c as any).length,execution_eligible:!!c&&c.executionFresh&&shortlisted&&!runnerReasons(c as any).length,
        option_eligible:!!c&&optionDirection(c as any)!==null,reasons,features:c?features(c):{}};
      research.push(evidence);
      const shard=shardFor(symbol),map=shardMap.get(shard)??{},old=map[symbol]??{};
      const decision=plan.decisions.find(r=>r.symbol===symbol&&r.outcome==='ENTERED'),reject=plan.decisions.find(r=>r.symbol===symbol&&r.outcome==='REJECTED');
      const next={...old,symbol,instrument_type:'equity_unclassified',first_provider_at:old.first_provider_at??(!['recent','held_or_continuity'].includes(source)?stamp:null),
        first_seen_at:old.first_seen_at??(symbols.includes(symbol)?stamp:null),first_price:old.first_price??c?.price??null,first_change:old.first_change??c?.dayChangePct??null,
        source:old.source??source,shortlisted_at:old.shortlisted_at??(shortlisted?stamp:null),runner_at:old.runner_at??(evidence.runner_eligible&&shortlisted?stamp:null),
        executable_at:old.executable_at??(evidence.execution_eligible?stamp:null),high:c?Math.max(old.high??c.price,c.price):old.high??null,low:c?Math.min(old.low??c.price,c.price):old.low??null,
        entry:old.entry??(decision?{opened_at:stamp,entry_day_change_pct:c?.dayChangePct,entry_price:plan.newPositions.find(p=>(p.underlying??p.symbol)===symbol)?.entry_price,asset_type:decision.lane==='OPTIONS_MOMENTUM'?'option':'equity'}:null),
        first_rejection:old.first_rejection??(reject?{at:stamp,reasons:reject.reasons}:reasons.length?{at:stamp,reasons}:null),
        early_rejection:old.early_rejection??(c&&c.dayChangePct<=10?(reject?{at:stamp,reasons:reject.reasons}:reasons.length?{at:stamp,reasons}:null):null)};
      if(JSON.stringify(old)!==JSON.stringify(next)){map[symbol]=next;shardMap.set(shard,map);changed.add(shard);}
    }
    if(changed.size)ss.push(ingest(env.MEDS_DB,'leader_research_shards',[...changed].map(shard=>({session_date:date,shard,version:CAPACITY_VERSION,data:JSON.stringify(shardMap.get(shard))})),['session_date','shard','version','data'],'ON CONFLICT(session_date,shard,version) DO UPDATE SET data=excluded.data'));
    if(selected.length){
      const cols='symbol,last_price,last_bid,last_ask,day_volume,previous_day_volume,last_minute_volume,score,status,consecutive_hits,last_seen_at'.split(',');
      ss.push(ingest(env.MEDS_DB,'symbol_state',selected.map(c=>({symbol:c.symbol,last_price:c.price,last_bid:c.bid,last_ask:c.ask,day_volume:c.dayVolume,previous_day_volume:c.previousDayVolume,last_minute_volume:c.minuteVolume,score:c.score,status:'WATCH',consecutive_hits:c.consecutiveHits,last_seen_at:stamp})),cols,upsert(cols,['symbol'])));
    }
    const board=discovery.gainers.slice(0,50).map((g:any,i:number)=>({bucket,session_date:date,created_at:stamp,phase:marketPhase,rank:i+1,symbol:g.symbol,price:g.price??null,change:g.change??null,percent_change:g.percent_change??g.percentChange??null,raw_json:JSON.stringify(g),version:CAPACITY_VERSION}));
    let audits:Row[]=[];
    if(board.length){
      audits=board.slice(0,20).map((g:any)=>{
        const f=shardMap.get(shardFor(g.symbol))?.[g.symbol],entry=f?.entry;
        const currentReject=plan.decisions.find(r=>r.symbol===g.symbol&&r.outcome==='REJECTED'&&r.stage==='ENTRY');
        const reject=currentReject?{at:stamp,reasons:currentReject.reasons}:f?.early_rejection??f?.first_rejection,reasons=reject?.reasons??[];
        const summary={symbol:g.symbol,rank:g.rank,board_at:stamp,board_phase:marketPhase,current_gain_pct:g.percent_change,current_price:g.price,instrument_type:f?.instrument_type??'unknown',first_provider_at:f?.first_provider_at??null,
          provider_time_basis:'first MEDS poll that observed provider appearance; upstream first publication time unavailable',first_seen_at:f?.first_seen_at??null,first_seen_gain_pct:f?.first_change??null,first_seen_price:f?.first_price??null,first_seen_source:f?.source??null,
          first_shortlisted_at:f?.shortlisted_at??null,first_eligible_at:f?.runner_at??null,execution_eligible_at:f?.executable_at??null,first_entry_at:entry?.opened_at??null,entry_price:entry?.entry_price??null,entry_gain_pct:entry?.entry_day_change_pct??null,entry_asset:entry?.asset_type??null,
          caught_before_5:!!entry&&entry.entry_day_change_pct<=5,caught_before_10:!!entry&&entry.entry_day_change_pct<=10,caught_before_20:!!entry&&entry.entry_day_change_pct<=20,
          sampled_mfe_pct:f?.first_price>0?(f.high/f.first_price-1)*100:null,sampled_mae_pct:f?.first_price>0?(f.low/f.first_price-1)*100:null,
          excursion_basis:'observed research prices after first usable price; not continuous-market best fill',miss_reason:moverMiss(f,entry,reasons),miss_reason_decision_at:reject?.at??null,rejection_reasons:reasons,
          rejection_by_account:plan.decisions.filter(r=>r.symbol===g.symbol&&r.outcome==='REJECTED').map(r=>({account:ACTIVE_ACCOUNT,lane:r.lane,reasons:r.reasons})),version:CAPACITY_VERSION};
        return {bucket,symbol:g.symbol,session_date:date,phase:marketPhase,rank:g.rank,summary:JSON.stringify(summary),version:CAPACITY_VERSION};
      });
    }
    ss.push(ingest(env.MEDS_DB,'leader_cycle_audit',[{bucket,created_at:stamp,version:CAPACITY_VERSION,payload:JSON.stringify({session_date:date,phase:marketPhase,research,decisions:plan.decisions,board,movers:audits.map(a=>JSON.parse(a.summary)),shortlist:selected.map(c=>c.symbol)})}],['bucket','created_at','version','payload'],'ON CONFLICT(bucket) DO NOTHING'));
    const quoteRows:Row[]=[];
    const wanted=new Map([...equities,...options,...plan.newPositions].map(p=>[p.kind+':'+p.symbol,p]));
    for(const p of wanted.values()){
      const q=(p.kind==='option'?optionMarks:stocks)[p.symbol]?.latestQuote,shaped=q&&q.bp>0&&q.ap>=q.bp&&fresh(q.t,365*86400000),isFresh=validQuote(q);
      if(shaped)quoteRows.push({asset:p.kind,symbol:p.symbol,feed:p.kind==='option'?'indicative':d.feed(now),quote_at:q.t,bid:q.bp,ask:q.ap,bid_size:q.bs??null,ask_size:q.as??null,retrieved_at:stamp});
    }
    if(quoteRows.length){const cols=Object.keys(quoteRows[0]);ss.push(ingest(env.MEDS_DB,'quote_cache',quoteRows,cols,upsert(cols,['asset','symbol'])+' WHERE excluded.quote_at>quote_cache.quote_at'));}
    const v=valuation(plan,stocks,optionMarks,retained),vCols=Object.keys(v);ss.push(ingest(env.MEDS_DB,'portfolio_valuation_state',[v],vCols,upsert(vCols,['account_id'])));
    const peak=v.complete?Math.max(accounts[0].max_equity,v.live_equity!):accounts[0].max_equity,dd=v.complete?Math.max(accounts[0].max_drawdown_pct,1-v.live_equity!/peak):accounts[0].max_drawdown_pct;
    ss.push(env.MEDS_DB.prepare('UPDATE hunt_accounts SET current_equity=CASE WHEN ? THEN ? ELSE current_equity END,max_equity=?,max_drawdown_pct=?,updated_at=? WHERE account_id=?').bind(v.complete,v.live_equity,peak,dd,stamp,ACTIVE_ACCOUNT));
    const milestones=v.complete?[2,5,10,25,50,100].filter(m=>v.live_equity!/250>=m).map(multiple=>({account_id:ACTIVE_ACCOUNT,multiple,reached_at:stamp,equity:v.live_equity,max_drawdown_pct:dd,version:CAPACITY_VERSION})):[];
    if(milestones.length)ss.push(ingest(env.MEDS_DB,'hunt_account_milestones',milestones,['account_id','multiple','reached_at','equity','max_drawdown_pct','version'],'ON CONFLICT DO NOTHING'));
    const result={ok:true,version:CAPACITY_ENGINE,runtime:'leader_only',active_account:ACTIVE_ACCOUNT,normal_paper_executed:false,scanned:symbols.length,research_shortlist:selected.length,research_execution_fresh:selected.filter(c=>c.executionFresh).length,
      hunt:{version:CAPACITY_VERSION,account_entries:plan.newPositions.length,exits:plan.trades.length,open:plan.open.length,tracked:selected.length},usage:data.metrics(),valuation_state:v.complete?'VALUED':'PORTFOLIO_PARTIALLY_VALUED'};
    // Fence, every accounting/telemetry set, cycle completion and lock release
    // form ONE transaction. No intermediate fills survive an audit failure.
    const projected=db.usage.statements+ss.length+4;
    if(projected>40)throw Error('STATEMENT_BUDGET_EXCEEDED: '+projected);
    const completedAt=new Date().toISOString(),wallTimeMs=Math.max(0,Date.now()-now.getTime());
    const metrics={...data.metrics(),wall_time_ms:wallTimeMs,database:{...db.usage,statements:projected,rows_note:'includes metadata from precommit reads; commit row counts returned in invocation result'},statement_limit:40};
    await db.batch([
      env.MEDS_DB.prepare('INSERT OR REPLACE INTO engine_write_guard VALUES(1,?,?)').bind(owner,Date.now()),...ss,
      env.MEDS_DB.prepare(`INSERT INTO engine_cycles(bucket,started_at,completed_at,management_at,state,metrics,version) VALUES(?,?,?,?,'COMPLETE',?,?)`).bind(engineBucket,startedAt,completedAt,managementAt,JSON.stringify(metrics),CAPACITY_ENGINE),
      env.MEDS_DB.prepare('UPDATE service_state SET last_success_at=?,last_result=?,last_error=NULL,lock_owner=NULL,lock_until=NULL WHERE id=1 AND lock_owner=?').bind(completedAt,JSON.stringify(result),owner),
    ]);
    const measured={...data.metrics(),wall_time_ms:wallTimeMs,database:{...db.usage,statements:db.usage.statements+1,rows_note:'actual D1 metadata through the accounting transaction; excludes this final metrics UPDATE'},statement_limit:40};
    try { await db.run('UPDATE engine_cycles SET metrics=? WHERE bucket=? AND version=?',[JSON.stringify(measured),engineBucket,CAPACITY_ENGINE],'metrics'); }
    catch { return {...result,database:db.usage,capacity_limit:40,metrics_warning:'Accounting and audit committed; final D1 row-metric enrichment unavailable'}; }
    return {...result,database:db.usage,capacity_limit:40};
  }catch(error){
    const message=error instanceof Error?error.message.slice(0,300):'engine failure';
    await db.run('UPDATE service_state SET last_error=?,lock_owner=NULL,lock_until=NULL WHERE id=1 AND lock_owner=?',[message,owner],'failure_release');
    return {ok:false,error:message,usage:data.metrics(),database:db.usage};
  }
}
