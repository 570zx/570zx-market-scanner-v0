import {test} from 'node:test';
import {ensureCapacitySchema,ACTIVE_ACCOUNT,CAPACITY_VERSION,LeaderPlan,accountingStatements} from '../src/leader-capacity.ts';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{ensurePaperSchema,runTick,runHuntAccounts,manageHuntAccountPositions,manageHuntOptionPositions,manageLeaderHuntPositions,valueLedger,markLedger,markHuntAccounts,HUNT_VERSION,selectLeaderOption,enterLeaderHuntOptions,scanTick} from '../src/index.ts';
import {fencedDatabase,healthState,plannedCadence,ENGINE_VERSION,AUTONOMOUS_SCHEMA} from '../src/autonomous.ts';
import {MarketDataCycle,mandatoryUniverse,refreshHeldQuotes,retainQuotes} from '../src/market-data.ts';
import {runnerReasons,optionDirection,orderedRunnerCandidates,preservedMaxHold} from '../src/leader-policy.ts';
import {persistResearch,auditMovers,performanceReport,recordDecision,moverMiss} from '../src/research-audit.ts';

class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.calls=0;}
  prepare(sql){const owner=this,db=this.db;const args=[];return {args,bind(...a){return Object.assign(owner.prepare(sql),{args:a});},
    _run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};},
    async run(){owner.calls++;return this._run();},async all(){owner.calls++;return {results:db.prepare(sql).all(...this.args)};},async first(){owner.calls++;return db.prepare(sql).get(...this.args)??null;}};}
  async batch(ss){this.calls++;this.db.exec('BEGIN');try{const r=ss.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function setup(){
  const MEDS_DB=new D1();
  for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql','0004_autonomous.sql']) MEDS_DB.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  const env={MEDS_DB,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',ADMIN_TOKEN:'test',ALPACA_API_KEY:'fixture',ALPACA_API_SECRET:'fixture'};
  await ensurePaperSchema(env);await ensureCapacitySchema(MEDS_DB);env.LEADER_ONLY='true';env.PAPER_ENABLED='false';return {env,db:MEDS_DB.db};
}
async function clocked(fn,time='2026-09-18T12:00:00Z'){
  const NativeDate=Date,oldFetch=fetch;let clock=NativeDate.parse(time);
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
  globalThis.fetch=async()=>{throw new Error('unexpected network call in test');};
  try{return await fn(ms=>{clock+=ms;});}finally{globalThis.Date=NativeDate;globalThis.fetch=oldFetch;}
}
const quote=(bp=4,ap=4.01,age=0)=>({bp,ap,bs:100,as:100,t:new Date(Date.now()-age).toISOString()});
const snapshot=(bp=4,ap=4.01,v=100000)=>({latestQuote:quote(bp,ap),minuteBar:{v,c:bp,h:ap,l:bp,o:bp,t:new Date().toISOString()},prevDailyBar:{c:3.9,v:100000},dailyBar:{v:200000}});
const candidate=(overrides={})=>({symbol:'EARLY',price:4,bid:4,ask:4.01,spreadPct:.25,dayChangePct:3,score:55,catalystScore:0,catalystSummary:'',volumeAccel:.15,dayVolume:200000,previousDayVolume:100000,minuteVolume:100000,consecutiveHits:2,executionFresh:true,quoteAgeMs:0,discoverySource:'top_gainer',discoveryRank:1,reasons:[],...overrides});

function provider({price=4,fail=false,minuteVolume=100000,optionBid=.08,optionAsk=.09,bidSize=100,mixed=false}={}){
  const symbols=Array.from({length:260},(_,i)=>'TEST'+i),requests=[];
  globalThis.fetch=async url=>{
    const u=new URL(String(url));requests.push(u.pathname+u.search);
    if(fail)return new Response('fixture down',{status:503});
    if(u.pathname.endsWith('/movers'))return Response.json({gainers:symbols.slice(0,50).map(symbol=>({symbol,price,percent_change:2})),losers:[]});
    if(u.pathname.endsWith('/most-actives'))return Response.json({most_actives:symbols.map(symbol=>({symbol}))});
    if(u.pathname.includes('/news'))return Response.json({news:price>=100||mixed?symbols.map(symbol=>({symbols:[symbol],headline:'FDA approval'})):[]});
    if(u.pathname.includes('/stocks/snapshots'))return Response.json(Object.fromEntries(u.searchParams.get('symbols').split(',').map(s=>[s,(()=>{const px=mixed&&s.startsWith('TEST')&&Number(s.slice(4))%2===0?100:price;const snap={...snapshot(px,px*1.002,mixed&&s==='HELD1'?.02:minuteVolume),prevDailyBar:{c:px/1.02,v:100000}};if(u.searchParams.get('feed')==='delayed_sip')snap.latestQuote.t=new Date(Date.now()-15*60_000).toISOString();return snap;})()])));
    if(u.pathname.includes('/stocks/quotes/latest'))return Response.json({quotes:{}});
    if(u.pathname.includes('/options/snapshots')){
      const syms=u.searchParams.get('symbols')?.split(',')??[u.pathname.split('/').at(-1)+'260925C00100000'];
      return Response.json({snapshots:Object.fromEntries(syms.map(s=>[s,{latestQuote:{...quote(optionBid,optionAsk),bs:bidSize},greeks:{delta:.5}}]))});
    }
    throw Error('unexpected '+url);
  };return requests;
}
function historical(db){return JSON.stringify(Object.fromEntries(['paper_ledgers','paper_positions','paper_option_positions','paper_trades','paper_cycles','paper_decisions','hunt_accounts','hunt_account_positions','hunt_account_option_positions','hunt_account_trades','hunt_account_option_trades','hunt_account_events','hunt_account_option_events'].map(table=>[table,db.prepare('SELECT * FROM '+table+(table.startsWith('hunt_account')?" WHERE account_id!='H250'":'')+' ORDER BY 1').all()])));}
function seed(db,n=16,kind='equity',entry=4,account=ACTIVE_ACCOUNT){
  const stamp=new Date(Date.now()-300000).toISOString();
  for(let i=0;i<n;i++){
    const symbol=kind==='option'?'OPT'+i+'260925C00100000':'HELD'+i,quantity=kind==='option'?1:.25,cost=entry*quantity*(kind==='option'?100:1);
    const row={account_id:account,symbol,opened_at:stamp,entry_price:entry,quantity,entry_notional:cost,stop_price:entry*.95,target_price:entry*3,highest_price:entry,lowest_price:entry,entry_score:55,entry_day_change_pct:2,opened_phase:'regular',features:JSON.stringify({max_hold_minutes:kind==='option'?1440:720}),status:'open',version:CAPACITY_VERSION,remaining_qty:quantity,locked_realized_pnl:0,take200_done:0};
    if(kind==='option')Object.assign(row,{underlying:'OPT'+i,current_mark:entry,current_mark_at:stamp,data_quality:'indicative'});
    const cols=Object.keys(row);db.prepare(`INSERT INTO hunt_account_${kind==='option'?'option_':''}positions(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));
    db.prepare('UPDATE hunt_accounts SET cash=cash-? WHERE account_id=?').run(cost,account);
  }
}

test('premarket uses delayed SIP for research without treating delayed quotes as executable',t=>clocked(async()=>{
  const {env,db}=await setup();const requests=provider();
  const r=await runTick(env,'premarket-feed');
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(requests.some(x=>x.includes('/v2/stocks/snapshots')&&x.includes('feed=delayed_sip')),'premarket snapshots must use delayed SIP');
  assert.ok(r.research_shortlist>0,'delayed SIP should keep premarket research alive');
  assert.equal(r.research_execution_fresh,0,'15-minute delayed SIP must not be treated as execution-fresh');
  assert.equal(r.hunt.account_entries,0,'delayed research quotes must never create a fill');
  assert.ok(r.database.statements<=40);
  t.diagnostic(JSON.stringify({scenario:'premarket delayed SIP research',research:r.research_shortlist,execution_fresh:r.research_execution_fresh,...r.database}));
  db.close();
},'2026-09-18T12:00:00Z'));

test('regular-session continuation runner can enter above the old +45% shortlist ceiling',t=>clocked(async()=>{
  const {env,db}=await setup();provider();const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    const response=await original(url),u=new URL(String(url));
    if(!u.pathname.includes('/stocks/snapshots'))return response;
    const body=await response.json();
    for(const snap of Object.values(body)){
      const px=(snap.latestQuote.bp+snap.latestQuote.ap)/2;
      snap.prevDailyBar={c:px/1.60,v:100000};
    }
    return Response.json(body);
  };
  const r=await runTick(env,'continuation-60pct');
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(r.research_shortlist>0,'+60% movers must survive shortlist construction');
  assert.ok(r.hunt.account_entries>0,'evidence-backed +60% movers must remain enterable');
  const entries=db.prepare("SELECT entry_day_change_pct FROM hunt_account_positions WHERE account_id='H250'").all();
  assert.ok(entries.some(x=>x.entry_day_change_pct>45),'at least one entry must prove the old +45% hard cap is gone');
  assert.ok(r.database.statements<=40);
  t.diagnostic(JSON.stringify({scenario:'continuation above old cap',entries:r.hunt.account_entries,...r.database}));
  db.close();
},'2026-09-18T15:00:00Z'));

test('one-account full discovery/entry cycle uses set-based writes and leaves history byte-for-byte unchanged',t=>clocked(async()=>{
  const {env,db}=await setup();seed(db,2,'equity',4,'H100');seed(db,2,'option',.03,'H1K');const before=historical(db);provider();
  const r=await runTick(env,'capacity');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.hunt.account_entries,6);
  assert.equal(historical(db),before);assert.equal(r.normal_paper_executed,false);assert.ok(r.database.statements<=35);
  const p=db.prepare("SELECT * FROM hunt_account_positions WHERE account_id='H250'").all();assert.equal(p.length,6);
  const a=db.prepare("SELECT * FROM hunt_accounts WHERE account_id='H250'").get();assert.ok(a.cash>=30);assert.ok(Math.abs(a.cash+p.reduce((n,p)=>n+p.entry_notional,0)-250)<1e-8);
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit').get().payload);assert.equal(audit.research.length,260);
  assert.ok(audit.decisions.some(d=>d.reasons.includes('SIGNAL_CYCLE_CAP')));
  assert.equal((await runTick(env,'duplicate')).skipped,'cycle already complete');
  const status=await (await worker.fetch(new Request('https://test/status'),env)).json();assert.equal(status.leader_hunt.accounts.length,1);assert.equal(status.leader_hunt.historical_accounts.length,5);
  t.diagnostic(JSON.stringify({scenario:'equity entries',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

test('full 32-position mixed inventory management with ladder/+200 exits stays under statement budget',t=>clocked(async()=>{
  const {env,db}=await setup();seed(db,16,'equity',1);seed(db,16,'option',.03);const before=historical(db);
  provider({price:4,optionBid:.10,optionAsk:.11});const r=await runTick(env,'capacity');assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(r.database.statements<=40);assert.equal(historical(db),before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_trades WHERE account_id='H250'").get().n,16);
  const a=db.prepare("SELECT * FROM hunt_accounts WHERE account_id='H250'").get();
  const rows=db.prepare("SELECT entry_price,remaining_qty,locked_realized_pnl,quantity FROM hunt_account_positions WHERE account_id='H250' UNION ALL SELECT entry_price*100,remaining_qty,locked_realized_pnl,quantity FROM hunt_account_option_positions WHERE account_id='H250'").all();
  const invested=rows.reduce((n,p)=>n+p.entry_price*p.remaining_qty,0);assert.ok(Math.abs(a.cash+invested-250-a.realized_pnl)<1e-7);
  t.diagnostic(JSON.stringify({scenario:'32 mixed positions +200',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

test('held provider failures preserve cash and positions, retain stale marks, and do not touch inactive portfolios',t=>clocked(async()=>{
  const {env,db}=await setup();seed(db,16,'equity',1);seed(db,16,'option',.03);const before=historical(db),cash=db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash;
  provider({fail:true});const r=await runTick(env,'failure');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.hunt.exits,0);assert.equal(r.hunt.account_entries,0);assert.equal(r.valuation_state,'PORTFOLIO_PARTIALLY_VALUED');
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);assert.equal(historical(db),before);assert.ok(r.database.statements<=35);
  assert.ok(r.usage.retries>=2);t.diagnostic(JSON.stringify({scenario:'all providers fail, mixed holdings',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

test('indicative options remain research-only while liquid controls retain research evidence',t=>clocked(async()=>{
  const {env,db}=await setup();provider({price:100,optionBid:1,optionAsk:1.05});const r=await runTick(env,'options');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.hunt.account_entries,0);
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit').get().payload);assert.ok(audit.decisions.some(d=>d.reasons.includes('OPTION_EXECUTION_QUOTE_NOT_AUTHORITATIVE')));assert.equal(audit.research.length,260);
  t.diagnostic(JSON.stringify({scenario:'eight unaffordable chains',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

function mixedBook(db){
  seed(db,16,'equity',5);seed(db,16,'option',.02);
  // Prior realized gains exercise the milestone statement without changing $250 starting capital.
  db.exec("UPDATE hunt_accounts SET cash=cash+350,realized_pnl=350,current_equity=600,max_equity=600 WHERE account_id='H250'");
  db.exec("UPDATE hunt_account_positions SET entry_price=1,entry_notional=.25,stop_price=.95,target_price=3,highest_price=1,lowest_price=1 WHERE account_id='H250' AND symbol NOT IN ('HELD0','HELD1'); UPDATE hunt_accounts SET cash=cash+14 WHERE account_id='H250'");
}
test('maximum mixed path: exits, events and pending intents force reduce-only entries',t=>clocked(async()=>{
  const {env,db}=await setup();mixedBook(db);provider({mixed:true});const r=await runTick(env,'worst');assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.database.statements<=40);
  for(const table of ['hunt_account_trades','hunt_account_option_trades','hunt_exit_intents'])assert.ok(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,table);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_positions WHERE account_id='H250' AND symbol LIKE 'TEST%'").get().n,0);const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit ORDER BY bucket DESC LIMIT 1').get().payload);assert.ok(audit.decisions.some(d=>d.reasons.includes('PENDING_EXIT_INTENT')));
  assert.ok(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash>=30);
  t.diagnostic(JSON.stringify({scenario:'mixed maximum',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

test('late audit failure rolls back every fill and permits an idempotent retry',()=>clocked(async()=>{
  const {env,db}=await setup();mixedBook(db);provider({mixed:true});const cash=db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash;
  db.exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON leader_cycle_audit BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
  const failed=await runTick(env,'failure');assert.equal(failed.ok,false);assert.match(failed.error,/fixture audit failure/);
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);assert.equal(db.prepare('SELECT COUNT(*) n FROM engine_cycles').get().n,0);
  db.exec('DROP TRIGGER fixture_fail');assert.equal((await runTick(env,'retry')).ok,true);db.close();
},'2026-09-18T15:00:00Z'));

test('pause fence rejects the cycle; metric failure preserves committed success',()=>clocked(async()=>{
  const {env,db}=await setup();provider();const original=env.MEDS_DB.batch.bind(env.MEDS_DB);
  env.MEDS_DB.batch=async ss=>{db.exec('UPDATE service_state SET paused=1 WHERE id=1');return original(ss);};
  assert.equal((await runTick(env,'pause-race')).ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM leader_cycle_audit').get().n,0);
  env.MEDS_DB.batch=original;db.exec('UPDATE service_state SET paused=0 WHERE id=1');
  db.exec("CREATE TRIGGER metric_fail BEFORE UPDATE ON engine_cycles BEGIN SELECT RAISE(ABORT,'metrics only'); END");
  const r=await runTick(env,'metrics');assert.equal(r.ok,true);assert.ok(r.metrics_warning);assert.equal(r.hunt.account_entries,6);db.close();
},'2026-09-18T15:00:00Z'));

test('session cadence keys off the due bucket instead of last-success jitter',()=>clocked(async()=>{
  const {env,db}=await setup();env.ENGINE_CADENCE='session';provider();
  db.prepare("UPDATE service_state SET last_success_at=? WHERE id=1").run(new Date(Date.now()-298000).toISOString());
  const r=await runTick(env,'jitter');
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM engine_cycles').get().n,1);
  db.close();
},'2026-09-18T15:00:00Z'));

test('Leader-only status ignores frozen normal-paper staleness and reports the active risk policy',()=>clocked(async()=>{
  const {env,db}=await setup();provider();env.ENGINE_CADENCE='session';
  const r=await runTick(env,'health');assert.equal(r.ok,true,JSON.stringify(r));
  const status=await (await worker.fetch(new Request('https://test/status'),env)).json();
  const health=await (await worker.fetch(new Request('https://test/health'),env)).json();
  assert.notEqual(status.health,'ENGINE_CRITICAL');
  assert.equal(status.paper.state,'HISTORICAL_INACTIVE');
  assert.equal(status.engine.active_risk_policy.target_entry_notional,10);
  assert.equal(status.diagnostics.risk_limits.protected_cash_reserve,30);
  assert.equal(health.health,status.health);
  assert.equal(health.valuation_state,'VALUED');
  const cycle=db.prepare('SELECT started_at,completed_at,management_at,metrics FROM engine_cycles').get();
  assert.ok(Date.parse(cycle.completed_at)>=Date.parse(cycle.started_at));
  assert.ok(Date.parse(cycle.management_at)>=Date.parse(cycle.started_at));
  assert.ok(Number(JSON.parse(cycle.metrics).wall_time_ms)>=0);
  db.close();
},'2026-09-18T15:00:00Z'));

test('runtime config version mismatch fails closed and schema alignment repairs only config',()=>clocked(async()=>{
  const {env,db}=await setup();
  const cash=db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash;
  db.prepare("UPDATE leader_runtime_config SET version='stale-version' WHERE id=1").run();
  const blocked=await runTick(env,'version-mismatch');
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/CONFIGURATION_INVALID_OR_VERSION_MISMATCH/);
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);
  await ensureCapacitySchema(env.MEDS_DB);
  const cfg=db.prepare('SELECT account_id,version,normal_enabled FROM leader_runtime_config WHERE id=1').get();
  assert.equal(cfg.account_id,'H250');assert.equal(cfg.version,CAPACITY_VERSION);assert.equal(cfg.normal_enabled,0);
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);
  db.close();
},'2026-09-18T15:00:00Z'));

test('research firsts and excursions survive later cycles; migration never resets capital',()=>clocked(async advance=>{
  const {env,db}=await setup();provider();assert.equal((await runTick(env,'first')).ok,true);
  const cash=db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash;await ensureCapacitySchema(env.MEDS_DB);assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);
  advance(300000);provider({price:5});assert.equal((await runTick(env,'later')).ok,true);
  const state=db.prepare('SELECT data FROM leader_research_shards').all().map(x=>JSON.parse(x.data)).find(x=>x.TEST0).TEST0;
  assert.equal(state.first_seen_at,'2026-09-18T15:00:00.000Z');assert.ok(state.high>state.first_price);assert.ok(state.entry||state.first_rejection);
  const res=await (await worker.fetch(new Request('https://test/status/hunt/research?symbol=TEST0'),env)).json();assert.equal(res.ok,true);assert.equal(res.rows.length,2);db.close();
},'2026-09-18T15:00:00Z'));

test('manual pause is reduce-only: exits continue while new risk is blocked',()=>clocked(async()=>{
  const {env,db}=await setup();seed(db,1,'equity',4);provider({price:2});
  const pause=await worker.fetch(new Request('https://test/control/pause',{method:'POST',headers:{authorization:'Bearer test'}}),env);
  const p=await pause.json();assert.equal(p.reduce_only,true);assert.equal(p.paused,false);
  assert.equal(db.prepare('SELECT paused FROM service_state WHERE id=1').get().paused,0);
  const r=await runTick(env,'reduce-only');assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(r.hunt.exits>=1,'reduce-only must continue risk-reducing exits');
  assert.equal(r.hunt.account_entries,0,'reduce-only must block new risk');
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit ORDER BY bucket DESC LIMIT 1').get().payload);
  assert.ok(audit.decisions.some(d=>d.stage==='ENTRY_RISK_GATE'&&d.reasons.includes('MANUAL_REDUCE_ONLY')));
  const health=await (await worker.fetch(new Request('https://test/health'),env)).json();
  assert.equal(health.reduce_only,true);assert.equal(health.risk_mode,'REDUCE_ONLY');
  const resume=await worker.fetch(new Request('https://test/control/resume',{method:'POST',headers:{authorization:'Bearer test'}}),env);
  assert.equal((await resume.json()).reduce_only,false);
  db.close();
},'2026-09-18T15:00:00Z'));

test('daily maintenance compacts old raw audits while preserving symbol evidence',()=>clocked(async()=>{
  const {env,db}=await setup();
  const evidence={symbol:'OLD',first_seen_at:'2026-09-10T14:00:00.000Z',first_price:1,first_change:12,source:'top_gainer',high:3,low:.8,first_rejection:{at:'2026-09-10T14:00:00.000Z',reasons:['SPREAD_TOO_WIDE']}};
  db.prepare('INSERT INTO leader_research_shards(session_date,shard,version,data) VALUES(?,?,?,?)').run('2026-09-10',0,CAPACITY_VERSION,JSON.stringify({OLD:evidence}));
  db.prepare('INSERT INTO leader_cycle_audit(bucket,created_at,version,payload) VALUES(?,?,?,?)').run('2026-09-10T14:00:00.000Z','2026-09-10T14:00:00.000Z',CAPACITY_VERSION,JSON.stringify({session_date:'2026-09-10',research:[evidence],decisions:[],board:[],movers:[],shortlist:['OLD']}));
  db.prepare('UPDATE leader_maintenance_state SET last_maintenance_date=NULL WHERE id=1').run();
  provider();const r=await runTick(env,'maintenance');assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.database.statements<=40);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM leader_research_shards WHERE session_date='2026-09-10'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM leader_cycle_audit WHERE substr(created_at,1,10)='2026-09-10'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM leader_research_archive WHERE session_date='2026-09-10' AND symbol='OLD'").get().n,1);
  const summary=db.prepare("SELECT cycles,audit_bytes FROM leader_session_summary WHERE session_date='2026-09-10' AND version=?").get(CAPACITY_VERSION);
  assert.equal(summary.cycles,1);assert.ok(summary.audit_bytes>0);
  const res=await (await worker.fetch(new Request('https://test/status/hunt/research?symbol=OLD'),env)).json();
  const old=res.outcomes.find(x=>x.session_date==='2026-09-10');assert.ok(old);assert.equal(old.first_price,1);assert.equal(old.sampled_mfe_pct,200);
  assert.equal(db.prepare('SELECT last_maintenance_date FROM leader_maintenance_state WHERE id=1').get().last_maintenance_date,'2026-09-18');
  db.close();
},'2026-09-18T15:00:00Z'));

// CI requires real D1 metadata; SQLite mock zeros are not a row-capacity result.
test('real D1 metadata: maximum mixed full cycle',{skip:process.env.MEDS_REAL_D1!=='true',timeout:90000},async t=>{
  const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:['DB','EQUITY','ENTRY','FAILURE','OPTIONS']}));
  try{for(const scenario of ['DB','EQUITY','ENTRY','FAILURE','OPTIONS']){const real=await mf.getD1Database(scenario);await clocked(async()=>{
    const {env,db}=await setup();
    if(scenario==='DB'||scenario==='FAILURE')mixedBook(db);
    // Historical volume must not multiply active-account lifecycle scans.
    seed(db,1,'equity',1,'H100');
    const oldId=db.prepare("SELECT id FROM hunt_account_positions WHERE account_id='H100'").get().id;
    const oldEvent=db.prepare("INSERT INTO hunt_account_events(account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version) VALUES('H100',?,'HELD0','2026-09-01T15:00:00Z',?,1,.00000001,0,'{}','leader-hunt-v7-asymmetric-runner')");
    for(let i=0;i<5000;i++)oldEvent.run(oldId,'PARTIAL_EXIT_'+i);
    if(scenario==='EQUITY')seed(db,32,'equity',1);
    const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();
    for(const row of schema.filter(r=>r.type==='table'))await real.prepare(row.sql).run();
    for(const row of schema.filter(r=>r.type==='table')){
      const records=db.prepare('SELECT * FROM '+row.name).all();
      for(let i=0;i<records.length;i+=200){const chunk=records.slice(i,i+200),cols=Object.keys(chunk[0]);await real.prepare(`INSERT INTO ${row.name}(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(chunk)).run();}
    }
    for(const row of schema.filter(r=>r.type!=='table'))await real.prepare(row.sql).run();
    env.MEDS_DB=real;provider(scenario==='DB'?{mixed:true}:scenario==='FAILURE'?{fail:true}:scenario==='OPTIONS'?{price:100,optionBid:1,optionAsk:1.05}:{});const r=await runTick(env,'real-d1');assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.database.statements<=40);
    assert.ok(r.database.rows_read>0);assert.ok(r.database.rows_written>0);const storage=await real.prepare("SELECT length(CAST(payload AS BLOB)) audit_bytes FROM leader_cycle_audit ORDER BY bucket DESC LIMIT 1").first();t.diagnostic('REAL_D1_CAPACITY '+JSON.stringify({scenario,...r,...storage}));
    if(scenario==='DB')assert.ok(r.database.rows_written*151<80000,'mixed-cycle daily projection must leave 20% write headroom');assert.ok(r.database.rows_read*151<4000000,'151 cycles/day must leave 20% read headroom');db.close();
  },'2026-09-18T15:00:00Z');}}finally{await mf.dispose();}
});

test('elite continuation runner can rotate one weak holding when only reserve cash remains',()=>clocked(async()=>{
  const {env,db}=await setup();
  const account=db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();
  account.cash=30;
  const held={id:9001,kind:'equity',account_id:'H250',symbol:'OLD',opened_at:new Date(Date.now()-3600000).toISOString(),entry_price:4,quantity:2.5,remaining_qty:2.5,entry_notional:10,stop_price:3.8,target_price:12,highest_price:4.1,lowest_price:3.9,entry_score:30,entry_day_change_pct:2,opened_phase:'regular',features:'{}',status:'open',version:'leader-hunt-v8.1-leader250-capacity',locked_realized_pnl:0,take200_done:0};
  const plan=new LeaderPlan(account,[held],[],[],[],new Date(),'regular');
  const strong=candidate({symbol:'RAIN',price:1.105,bid:1.10,ask:1.11,spreadPct:.9,dayChangePct:65,score:80,catalystScore:22,catalystSummary:'fresh catalyst',volumeAccel:1,dayVolume:9000000,previousDayVolume:100000,minuteVolume:100000,consecutiveHits:4,discoverySource:'top_gainer'});
  const stocks={OLD:snapshot(3.96,3.97,100000),RAIN:snapshot(1.10,1.11,100000)};
  plan.enterEquities([strong],stocks,c=>({score:c.score,day_change_pct:c.dayChangePct}));
  assert.equal(plan.rotations,1);
  assert.equal(plan.trades.length,1);
  assert.equal(plan.trades[0].exit_reason,'rotation_for_stronger_continuation');
  assert.equal(plan.trades[0].symbol,'OLD');
  assert.equal(plan.newPositions.length,1);
  assert.equal(plan.newPositions[0].symbol,'RAIN');
  assert.equal(plan.newPositions[0].version,CAPACITY_VERSION);
  assert.equal(plan.decisions.at(-1).outcome,'ENTERED');
  assert.equal(plan.decisions.at(-1).features.rotated_out,'OLD');
  assert.ok(plan.cash>=30-1e-8,'rotation must preserve protected reserve');
  db.close();
},'2026-09-18T15:00:00Z'));


test('rotation never sells a victim when replacement minute liquidity is zero',()=>clocked(async()=>{
  const {env,db}=await setup();
  const account=db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();
  account.cash=30;
  const held={id:9101,kind:'equity',account_id:'H250',symbol:'OLD',opened_at:new Date(Date.now()-3600000).toISOString(),entry_price:4,quantity:2.5,remaining_qty:2.5,entry_notional:10,stop_price:3.8,target_price:12,highest_price:4.1,lowest_price:3.9,entry_score:30,entry_day_change_pct:2,opened_phase:'regular',features:'{}',status:'open',version:'leader-hunt-v8.1-leader250-capacity',locked_realized_pnl:0,take200_done:0};
  const plan=new LeaderPlan(account,[held],[],[],[],new Date(),'regular');
  const strong=candidate({symbol:'RAIN',price:1.105,bid:1.10,ask:1.11,spreadPct:.9,dayChangePct:65,score:80,catalystScore:22,volumeAccel:1,dayVolume:9000000,previousDayVolume:100000,minuteVolume:100000,consecutiveHits:4});
  plan.enterEquities([strong],{OLD:snapshot(3.96,3.97,100000),RAIN:snapshot(1.10,1.11,0)},c=>c);
  assert.equal(plan.rotations,0);assert.equal(plan.trades.length,0);assert.equal(plan.newPositions.length,0);
  assert.deepEqual(plan.decisions.at(-1).reasons,['MINUTE_LIQUIDITY_LIMIT']);
  db.close();
},'2026-09-18T15:00:00Z'));

test('partial stop liquidity cannot be reused by capital rotation in the same cycle',()=>clocked(async()=>{
  const {env,db}=await setup();
  const account=db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();account.cash=30;
  const held={id:9201,kind:'equity',account_id:'H250',symbol:'OLD',opened_at:new Date(Date.now()-3600000).toISOString(),entry_price:4,quantity:10,remaining_qty:10,entry_notional:40,stop_price:3.8,target_price:12,highest_price:4,lowest_price:4,entry_score:20,entry_day_change_pct:2,opened_phase:'regular',features:'{}',status:'open',version:'leader-hunt-v8.1-leader250-capacity',locked_realized_pnl:0,take200_done:0};
  const plan=new LeaderPlan(account,[held],[],[],[],new Date(),'regular');
  const stocks={OLD:snapshot(3.7,3.71,10),RAIN:snapshot(1.10,1.11,100000)};
  plan.manage(stocks,{});
  const soldBefore=plan.events.reduce((n,e)=>n+Number(e.quantity),0);
  const strong=candidate({symbol:'RAIN',price:1.105,bid:1.10,ask:1.11,spreadPct:.9,dayChangePct:65,score:80,catalystScore:22,volumeAccel:1,dayVolume:9000000,previousDayVolume:100000,minuteVolume:100000,consecutiveHits:4});
  plan.enterEquities([strong],stocks,c=>c);
  assert.equal(soldBefore,.5);assert.equal(plan.rotations,0);assert.equal(plan.trades.length,0);
  assert.equal(plan.positions[0].remaining_qty,9.5);assert.equal(plan.newPositions.length,0);
  db.close();
},'2026-09-18T15:00:00Z'));

test('rotation cooldown and score improvement prevent next-cycle churn',()=>clocked(async()=>{
  const {env,db}=await setup();
  const account=db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();
  Object.assign(account,{cash:30,rotations_today:1,last_rotation_at:new Date(Date.now()-5*60000).toISOString()});
  const held={id:9301,kind:'equity',account_id:'H250',symbol:'NEWER',opened_at:new Date(Date.now()-3600000).toISOString(),entry_price:4,quantity:2.5,remaining_qty:2.5,entry_notional:10,stop_price:3.8,target_price:12,highest_price:4,lowest_price:3.9,entry_score:75,entry_day_change_pct:20,opened_phase:'regular',features:'{}',status:'open',version:CAPACITY_VERSION,locked_realized_pnl:0,take200_done:0};
  const plan=new LeaderPlan(account,[held],[],[],[],new Date(),'regular',new Map([['NEWER',75]]));
  const weaker=candidate({symbol:'NEXT',price:1.105,bid:1.10,ask:1.11,spreadPct:.9,dayChangePct:55,score:55,catalystScore:22,volumeAccel:1,dayVolume:9000000,previousDayVolume:100000,minuteVolume:100000,consecutiveHits:4});
  plan.enterEquities([weaker],{NEWER:snapshot(3.9,3.91,100000),NEXT:snapshot(1.10,1.11,100000)},c=>c);
  assert.equal(plan.rotations,0);assert.equal(plan.trades.length,0);assert.equal(plan.newPositions.length,0);
  db.close();
},'2026-09-18T15:00:00Z'));

test('penny entry is rejected when modeled immediate liquidation exceeds its stop risk',()=>clocked(async()=>{
  const {env,db}=await setup();
  const account=db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();
  const plan=new LeaderPlan(account,[],[],[],[],new Date(),'regular');
  const wide=candidate({symbol:'WIDE',price:.4,bid:.384,ask:.416,spreadPct:8,score:70,minuteVolume:100000,catalystScore:10});
  plan.enterEquities([wide],{WIDE:snapshot(.384,.416,100000)},c=>c);
  assert.equal(plan.newPositions.length,0);assert.deepEqual(plan.decisions.at(-1).reasons,['IMMEDIATE_LIQUIDATION_RISK']);
  db.close();
},'2026-09-18T15:00:00Z'));

test('incomplete held valuation blocks every new entry while preserving management',()=>clocked(async()=>{
  const {env,db}=await setup();seed(db,1,'equity',4);
  provider();const base=globalThis.fetch;
  globalThis.fetch=async url=>{
    const u=new URL(String(url)),res=await base(url);
    if(u.pathname.includes('/stocks/snapshots')&&u.searchParams.get('symbols')?.split(',').includes('HELD0')){
      const body=await res.json();if(body.HELD0)delete body.HELD0.latestQuote;return Response.json(body);
    }
    return res;
  };
  const r=await runTick(env,'incomplete-valuation');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.hunt.account_entries,0);assert.equal(r.valuation_state,'PORTFOLIO_PARTIALLY_VALUED');
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit ORDER BY bucket DESC LIMIT 1').get().payload);
  assert.ok(audit.decisions.some(d=>d.stage==='ENTRY_RISK_GATE'&&d.reasons.includes('PORTFOLIO_VALUATION_INCOMPLETE')));
  db.close();
},'2026-09-18T15:00:00Z'));

test('overnight feed remains research-only even when quote timestamps are fresh',()=>clocked(async()=>{
  const {env,db}=await setup();provider();
  const r=await runTick(env,'overnight-authority');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(r.hunt.account_entries,0);assert.equal(r.research_execution_fresh,0);
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit ORDER BY bucket DESC LIMIT 1').get().payload);
  assert.ok(audit.research.some(x=>x.reasons.includes('EXECUTION_QUOTE_NOT_AUTHORITATIVE')));
  db.close();
},'2026-09-18T02:00:00Z'));

test('unverified held 100x price discontinuity is quarantined instead of realized',()=>clocked(async()=>{
  const {env,db}=await setup();seed(db,1,'equity',4);provider({price:400});
  const r=await runTick(env,'discontinuity');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_trades WHERE account_id='H250'").get().n,0);
  assert.equal(r.valuation_state,'PORTFOLIO_PARTIALLY_VALUED');
  const pos=db.prepare("SELECT status,remaining_qty FROM hunt_account_positions WHERE account_id='H250' AND symbol='HELD0'").get();
  assert.equal(pos.status,'open');assert.equal(pos.remaining_qty,.25);
  db.close();
},'2026-09-18T15:00:00Z'));

test('execution deadline guard rejects an expired final-commit timestamp',async()=>{
  const {env,db}=await setup();
  await assert.rejects(env.MEDS_DB.prepare('INSERT OR REPLACE INTO leader_execution_guard VALUES(1,?,?)').bind(Date.now()-1000,Date.now()).run(),/execution quote expired at commit/);
  await env.MEDS_DB.prepare('INSERT OR REPLACE INTO leader_execution_guard VALUES(1,?,?)').bind(Date.now()+10000,Date.now()).run();
  db.close();
});

test('set-based position management matches v8 cash, quantities, lifecycle and realized accounting',()=>clocked(async()=>{
  const a=await setup(),b=await setup();mixedBook(a.db);mixedBook(b.db);
  const stocks=Object.fromEntries(Array.from({length:16},(_,i)=>['HELD'+i,snapshot(4,4.01,i===1?.02:100000)]));
  const marks=Object.fromEntries(Array.from({length:16},(_,i)=>['OPT'+i+'260925C00100000',{latestQuote:quote(.08,.09)}]));
  await manageHuntAccountPositions(a.env,stocks,new Date(),false);await manageHuntOptionPositions(a.env,marks,new Date());
  const account=b.db.prepare("SELECT a.*,r.revision FROM hunt_accounts a JOIN hunt_revisions r USING(account_id) WHERE account_id='H250'").get();
  const positions=b.db.prepare("SELECT *, 'equity' kind FROM hunt_account_positions").all().concat(b.db.prepare("SELECT *, 'option' kind FROM hunt_account_option_positions").all());
  const plan=new LeaderPlan(account,positions,[],[],[],new Date(),'regular');plan.manage(stocks,marks);await b.env.MEDS_DB.batch(accountingStatements(b.env.MEDS_DB,plan));
  for(const sql of ["SELECT cash,realized_pnl FROM hunt_accounts WHERE account_id='H250'","SELECT status,remaining_qty,locked_realized_pnl,take200_done,highest_price,lowest_price FROM hunt_account_positions ORDER BY id","SELECT status,remaining_qty,locked_realized_pnl,take200_done,highest_price,lowest_price FROM hunt_account_option_positions ORDER BY id"]){
    const left=a.db.prepare(sql).all(),right=b.db.prepare(sql).all();assert.equal(left.length,right.length);
    left.forEach((row,i)=>Object.keys(row).forEach(k=>typeof row[k]==='number'?assert.ok(Math.abs(row[k]-right[i][k])<1e-8,k):assert.equal(row[k],right[i][k],k)));
  }a.db.close();b.db.close();
},'2026-09-18T15:00:00Z'));

test('mixed management recovers held stock and option quotes with one bounded retry each',t=>clocked(async()=>{
  const {env,db}=await setup();mixedBook(db);provider({mixed:true});const original=fetch;let optionFailures=0;
  globalThis.fetch=async url=>{
    const u=new URL(String(url));
    if(u.pathname.includes('/stocks/snapshots')){const response=await original(url),body=await response.json();for(const [symbol,s] of Object.entries(body))if(symbol.startsWith('HELD')||symbol.startsWith('OPT'))s.latestQuote=quote(4,4.008,120000);return Response.json(body);}
    if(u.pathname.includes('/stocks/quotes/latest'))return Response.json({quotes:Object.fromEntries(u.searchParams.get('symbols').split(',').map(s=>[s,quote(4,4.008)]))});
    if(u.pathname==='/v1beta1/options/snapshots'&&optionFailures++===0)return new Response('retry fixture',{status:503});
    return original(url);
  };
  const r=await runTick(env,'recovery');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.usage.retries,2);assert.ok(r.hunt.exits>=17);assert.ok(r.database.statements<=40);
  t.diagnostic(JSON.stringify({scenario:'mixed retry recovery',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));
