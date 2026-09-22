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
    const u=new URL(String(url));requests.push(u.pathname);
    if(fail)return new Response('fixture down',{status:503});
    if(u.pathname.endsWith('/movers'))return Response.json({gainers:symbols.slice(0,50).map(symbol=>({symbol,price,percent_change:2})),losers:[]});
    if(u.pathname.endsWith('/most-actives'))return Response.json({most_actives:symbols.map(symbol=>({symbol}))});
    if(u.pathname.includes('/news'))return Response.json({news:price>=100||mixed?symbols.map(symbol=>({symbols:[symbol],headline:'FDA approval'})):[]});
    if(u.pathname.includes('/stocks/snapshots'))return Response.json(Object.fromEntries(u.searchParams.get('symbols').split(',').map(s=>[s,(()=>{const px=mixed&&s.startsWith('TEST')&&Number(s.slice(4))%2===0?100:price;return {...snapshot(px,px*1.002,mixed&&s==='HELD1'?.02:minuteVolume),prevDailyBar:{c:px/1.02,v:100000}};})()])));
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

test('unaffordable whole-contract options are explained while liquid controls retain research evidence',t=>clocked(async()=>{
  const {env,db}=await setup();provider({price:100,optionBid:1,optionAsk:1.05});const r=await runTick(env,'options');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.hunt.account_entries,0);
  const audit=JSON.parse(db.prepare('SELECT payload FROM leader_cycle_audit').get().payload);assert.ok(audit.decisions.some(d=>d.reasons.includes('OPTION_CONTRACT_TOO_EXPENSIVE')));assert.equal(audit.research.length,260);
  t.diagnostic(JSON.stringify({scenario:'eight unaffordable chains',...r.database,provider:r.usage.requests}));db.close();
},'2026-09-18T15:00:00Z'));

function mixedBook(db){
  seed(db,16,'equity',5);seed(db,16,'option',.02);
  db.exec("UPDATE hunt_account_positions SET entry_price=1,entry_notional=.25,stop_price=.95,target_price=3,highest_price=1,lowest_price=1 WHERE account_id='H250' AND symbol NOT IN ('HELD0','HELD1'); UPDATE hunt_accounts SET cash=cash+14 WHERE account_id='H250'");
}
test('maximum mixed path: both entry assets, both exits, events and partial intents',t=>clocked(async()=>{
  const {env,db}=await setup();mixedBook(db);provider({mixed:true});const r=await runTick(env,'worst');assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.database.statements<=40);
  for(const table of ['hunt_account_trades','hunt_account_option_trades','hunt_exit_intents'])assert.ok(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,table);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_positions WHERE account_id='H250' AND symbol LIKE 'TEST%'").get().n);
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

test('research firsts and excursions survive later cycles; migration never resets capital',()=>clocked(async advance=>{
  const {env,db}=await setup();provider();assert.equal((await runTick(env,'first')).ok,true);
  const cash=db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash;await ensureCapacitySchema(env.MEDS_DB);assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H250'").get().cash,cash);
  advance(300000);provider({price:5});assert.equal((await runTick(env,'later')).ok,true);
  const state=db.prepare('SELECT data FROM leader_research_shards').all().map(x=>JSON.parse(x.data)).find(x=>x.TEST0).TEST0;
  assert.equal(state.first_seen_at,'2026-09-18T15:00:00.000Z');assert.ok(state.high>state.first_price);assert.ok(state.entry||state.first_rejection);
  const res=await (await worker.fetch(new Request('https://test/status/hunt/research?symbol=TEST0'),env)).json();assert.equal(res.ok,true);assert.equal(res.rows.length,2);db.close();
},'2026-09-18T15:00:00Z'));

// CI requires real D1 metadata; SQLite mock zeros are not a row-capacity result.
test('real D1 metadata: maximum mixed full cycle',{skip:process.env.MEDS_REAL_D1!=='true',timeout:90000},async t=>{
  const {Miniflare,convertV4MiniflareOptions}=await import('miniflare');
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:['DB']}));
  try{const real=await mf.getD1Database('DB');await clocked(async()=>{
    const {env,db}=await setup();mixedBook(db);
    const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();
    for(const row of schema.filter(r=>r.type==='table'))await real.prepare(row.sql).run();
    for(const row of schema.filter(r=>r.type==='table'))for(const record of db.prepare('SELECT * FROM '+row.name).all()){
      const cols=Object.keys(record);await real.prepare(`INSERT INTO ${row.name}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).bind(...Object.values(record)).run();
    }
    for(const row of schema.filter(r=>r.type!=='table'))await real.prepare(row.sql).run();
    env.MEDS_DB=real;provider({mixed:true});const r=await runTick(env,'real-d1');assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.database.statements<=40);
    assert.ok(r.database.rows_read>0);assert.ok(r.database.rows_written>0);t.diagnostic('REAL_D1_CAPACITY '+JSON.stringify(r));
    assert.ok(r.database.rows_written*151<80000,'151 cycles/day must leave 20% write headroom');assert.ok(r.database.rows_read*151<4000000,'151 cycles/day must leave 20% read headroom');db.close();
  },'2026-09-18T15:00:00Z');}finally{await mf.dispose();}
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
