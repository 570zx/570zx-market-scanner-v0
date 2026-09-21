import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import worker,{runTick,inScanWindow,heuristicCatalyst} from '../src/index.ts';
class D1 {
  constructor(path){this.path=path;this.db=new DatabaseSync(path);}
  prepare(sql){const db=this.db;return {args:[],bind(...args){this.args=args;return this;},async run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};},async all(){return {results:db.prepare(sql).all(...this.args)};},async first(){return db.prepare(sql).get(...this.args)??null;}};}
  async batch(statements){this.db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
test('24/5 market windows are DST aware',()=>{
 assert.equal(inScanWindow(new Date('2026-09-17T08:00:00Z')),true);
 assert.equal(inScanWindow(new Date('2026-09-18T00:00:00Z')),true);
 assert.equal(inScanWindow(new Date('2026-09-19T14:00:00Z')),false);
 assert.equal(inScanWindow(new Date('2026-09-20T23:59:00Z')),false);
 assert.equal(inScanWindow(new Date('2026-09-21T00:00:00Z')),true);
 assert.equal(inScanWindow(new Date('2026-12-17T08:59:00Z')),true);
 assert.equal(inScanWindow(new Date('2026-12-17T09:00:00Z')),true);
});
test('headline classifier flags dilution',()=>{
 assert.ok(heuristicCatalyst([{symbols:['FRGT'],headline:'Registered direct offering'}],'FRGT').score<0);
});
test('simulated cron, persistent SQL, exact +20%, runner, dedupe, auth, pause and execution lock',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'meds-test-'));const file=join(dir,'state.sqlite');
 let db=new D1(file);for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])db.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 const NativeDate=globalThis.Date;const nativeFetch=globalThis.fetch;
 let clock=NativeDate.parse('2026-09-17T14:00:00Z');
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 let price=1,minuteVol=100,alertCount=0;const requests=[];
 globalThis.fetch=async(url,init={})=>{
  url=String(url);requests.push({url,method:init.method??'GET'});
  if(url==='https://discord.com/api/webhooks/test'){alertCount++;return new Response(null,{status:204});}
  assert.equal(init.method??'GET','GET','No non-webhook POST permitted');
  assert.ok(url.startsWith('https://data.alpaca.markets/'),'Data host only');
  if(url.includes('most-actives'))return Response.json({most_actives:[{symbol:'TEST'}]});
  if(url.includes('/movers'))return Response.json({gainers:[],losers:[]});
  if(url.includes('/news'))return Response.json({news:[{symbols:['TEST'],headline:'FDA approval and new contract award'}]});
  if(url.includes('/options/snapshots'))return Response.json({snapshots:{}});
  if(url.includes('/snapshots')){
   const q=new URL(url).searchParams.get('symbols').split(',');const result={};
   for(const symbol of q)result[symbol]={latestTrade:{p:symbol==='FRGT'?price:1,t:new Date().toISOString()},latestQuote:{bp:symbol==='FRGT'?price/(1-.0002):.995,ap:symbol==='FRGT'?price/(1-.0002)+.01:1.005,t:new Date().toISOString()},minuteBar:{c:1,v:minuteVol,t:new Date().toISOString()},dailyBar:{v:20000},prevDailyBar:{c:1,v:10000}};
   return Response.json(result);
  }
  throw Error('Unexpected URL');
 };
 const env={MEDS_DB:db,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',ADMIN_TOKEN:'test-only',ALPACA_API_KEY:'test-only',ALPACA_API_SECRET:'test-only',ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/test'};
 const request=(path,body,auth=true)=>new Request('https://test'+path,{method:body?'POST':'GET',headers:{...(auth?{authorization:'Bearer test-only'}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await worker.fetch(request('/shadow/open',{symbol:'FRGT',entry_price:1,quantity:100},false),env)).status,401);
  assert.equal((await worker.fetch(request('/shadow/open',{symbol:'FRGT',entry_price:1,quantity:100}),env)).status,200);
  assert.equal((await worker.fetch(request('/shadow/open',{symbol:'FRGT',entry_price:2,quantity:200}),env)).status,409);
  let pending;await worker.scheduled({},env,{waitUntil(p){pending=p;}});await pending;
  assert.equal(db.db.prepare('SELECT last_source FROM service_state').get().last_source,'cron');
  assert.equal(db.db.prepare('SELECT consecutive_hits FROM symbol_state WHERE symbol=?').get('TEST').consecutive_hits,1);
  const initialTestSignals=db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'signal:TEST:%'").get().n;
  const initialPositionAlerts=db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'FRGT:%'").get().n;
  clock+=300000;minuteVol=150;price=1.2;
  {const tick=await runTick(env,'cron');assert.equal(tick.ok,true,JSON.stringify(tick));}
  let p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');
  assert.equal(p.first_tp_done,1);assert.equal(p.remaining_qty,30);assert.ok(Math.abs(p.realized_pnl-14)<1e-8);
  assert.equal(db.db.prepare('SELECT consecutive_hits FROM symbol_state WHERE symbol=?').get('TEST').consecutive_hits,2);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'signal:TEST:%'").get().n,initialTestSignals,
    'TEST signal must respect cooldown');
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'FRGT:%'").get().n,initialPositionAlerts+1,
    'first take-profit must produce one position alert');
  const beforePositionAlerts=db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'FRGT:%'").get().n;
  clock+=300000;await runTick(env,'cron');
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM alert_delivery WHERE event_key LIKE 'FRGT:%'").get().n,beforePositionAlerts,
    'No duplicate position alert');
  db.db.close();
  const restart=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(d.prepare("SELECT remaining_qty,first_tp_done FROM shadow_positions WHERE symbol='FRGT'").get()));`,file],{encoding:'utf8'});
  assert.equal(restart.status,0);assert.deepEqual(JSON.parse(restart.stdout),{remaining_qty:30,first_tp_done:1});
  db=new D1(file);env.MEDS_DB=db;
  clock+=300000;price=1.3;await runTick(env,'cron');p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');assert.equal(p.remaining_qty,15);assert.equal(p.second_tp_done,1);
  clock+=300000;price=1.1;await runTick(env,'cron');p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');assert.equal(p.status,'closed');assert.equal(p.remaining_qty,0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM position_events').get().n,3);
  await worker.fetch(request('/control/pause',{}),env);assert.equal((await runTick(env,'cron')).skipped,'disabled');
  await worker.fetch(request('/control/resume',{}),env);
  await assert.rejects(runTick({...env,TRADING_MODE:'live'},'cron'),/Only shadow/);
  assert.equal((await worker.fetch(request('/orders',{}),env)).status,404);
  const h=await (await worker.fetch(request('/health'),env)).json();assert.equal(h.live_execution,false);assert.ok(h.last_success_at);
  const statusResponse=await worker.fetch(request('/status',undefined,false),env);
  assert.equal(statusResponse.status,200);
  const status=await statusResponse.json();
  assert.equal(status.live_execution,false);assert.equal(status.mode,'shadow');
  assert.equal(status.scanner.healthy,true);assert.equal(status.paper.healthy,true);
  assert.deepEqual(status.ledgers.map(l=>l.id),['MICRO','SMALL','GROWTH','SCALE']);
  assert.ok(status.ledgers.every(l=>l.cash>=-1e-8),'Paper entries must never make ledger cash negative');
  await assert.rejects(
   db.prepare('UPDATE paper_ledgers SET cash=cash-100000 WHERE ledger_id=?').bind('A').run(),
   /paper ledger cash cannot be reduced below zero/,
   'Database invariant must reject negative paper cash'
  );
  assert.ok(status.paper.cycle_count>=1);assert.ok(status.paper.decision_count>=1);
  assert.deepEqual(status.leader_hunt.session_breakdown.map(x=>x.phase),['overnight','premarket','regular','postmarket']);
  assert.deepEqual(status.leader_hunt.compounding_milestones,[2,5,10,25,50,100]);
  assert.equal(status.leader_hunt.compounding_scoreboard.length,1);assert.equal(status.leader_hunt.compounding_scoreboard[0].account_id,'H250');
  assert.ok(status.leader_hunt.session_breakdown.every(x=>Number.isInteger(x.open_signals)&&Number.isInteger(x.open_account_positions)));
  assert.equal((await worker.fetch(request('/paper/cycles',undefined,false),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://test/status',{method:'POST'}),env)).status,401);
  const rowCountsBefore={
   trades:db.db.prepare('SELECT COUNT(*) AS n FROM paper_trades').get().n,
   positions:db.db.prepare("SELECT COUNT(*) AS n FROM paper_positions WHERE status='open'").get().n,
   decisions:db.db.prepare('SELECT COUNT(*) AS n FROM paper_decisions').get().n,
  };
  for(const path of ['/status/trades','/status/positions','/status/decisions','/status/hunt','/status/hunt/positions']){
   const response=await worker.fetch(request(path+'?limit=2&offset=0',undefined,false),env);
   assert.equal(response.status,200);const page=await response.json();
   assert.equal(page.ok,true);assert.equal(page.read_only,true);assert.ok(page.rows.length<=2);
  }
  assert.deepEqual({
   trades:db.db.prepare('SELECT COUNT(*) AS n FROM paper_trades').get().n,
   positions:db.db.prepare("SELECT COUNT(*) AS n FROM paper_positions WHERE status='open'").get().n,
   decisions:db.db.prepare('SELECT COUNT(*) AS n FROM paper_decisions').get().n,
  },rowCountsBefore,'Public telemetry must not mutate paper state');
  assert.equal((await worker.fetch(new Request('https://test/status/trades',{method:'POST'}),env)).status,401);
  assert.equal((await worker.fetch(request('/paper/trades',undefined,false),env)).status,401);
  const missingDir=mkdtempSync(join(tmpdir(),'meds-status-missing-'));
  const missingDb=new D1(join(missingDir,'state.sqlite'));
  for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])missingDb.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  const missingStatus=await (await worker.fetch(request('/status',undefined,false),{...env,MEDS_DB:missingDb})).json();
  assert.equal(missingStatus.scanner.healthy,false);
  assert.equal(missingStatus.paper.schema_version,11);
  assert.equal(missingDb.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='hunt_observations'").get().n,1);
  assert.doesNotMatch(String(missingStatus.paper.paper_error??''),/missing tables/);
  missingDb.db.close();rmSync(missingDir,{recursive:true,force:true});
  assert.ok(requests.every(r=>r.method==='GET'||r.url==='https://discord.com/api/webhooks/test'));
 }finally{globalThis.Date=NativeDate;globalThis.fetch=nativeFetch;db.db.close();rmSync(dir,{recursive:true,force:true});}
});


test('Leader Hunt keeps its own positions in the snapshot universe and accepts quote-led premarket research',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'meds-hunt-continuity-'));const file=join(dir,'state.sqlite');
 const db=new D1(file);for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])db.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 const NativeDate=globalThis.Date;const nativeFetch=globalThis.fetch;
 let clock=NativeDate.parse('2026-09-18T12:00:00Z'); // 08:00 ET, premarket
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 const snapshotRequests=[];
 globalThis.fetch=async(url,init={})=>{
   url=String(url);
   if(url.includes('most-actives'))return Response.json({most_actives:[{symbol:'TEST'}]});
   if(url.includes('/movers'))return Response.json({gainers:[],losers:[]});
   if(url.includes('/news'))return Response.json({news:[]});
   if(url.includes('/options/snapshots'))return Response.json({snapshots:{}});
   if(url.includes('/stocks/snapshots')){
     const syms=new URL(url).searchParams.get('symbols').split(',');snapshotRequests.push(syms);
     const result={};
     for(const symbol of syms)result[symbol]={
       latestTrade:{p:1,t:new NativeDate(clock-10*60_000).toISOString()},
       latestQuote:{bp:.995,ap:1.005,t:new NativeDate(clock).toISOString()},
       minuteBar:{c:1,v:100,t:new NativeDate(clock).toISOString()},
       dailyBar:{v:20000},prevDailyBar:{c:1,v:10000}
     };
     return Response.json(result);
   }
   throw Error('Unexpected URL '+url);
 };
 const env={MEDS_DB:db,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',ALPACA_API_KEY:'test-only',ALPACA_API_SECRET:'test-only'};
 try{
   await worker.fetch(new Request('https://test/status'),env); // apply additive schema
   db.db.prepare(`INSERT INTO hunt_account_positions(account_id,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,entry_score,entry_day_change_pct,opened_phase,features,status,version,remaining_qty,locked_realized_pnl,take200_done)
     VALUES('H250','HOLD',?,1,1,1,.5,3,1,1,50,0,'overnight','{}','open','leader-hunt-v3-200-runner',1,0,0)`).run(new NativeDate(clock-60_000).toISOString());
   const result=await runTick(env,'cron');
   assert.equal(result.ok,true,JSON.stringify(result));
   assert.ok(snapshotRequests.some(batch=>batch.includes('HOLD')),'open Leader symbol must always be quoted');
   assert.ok(db.db.prepare("SELECT COUNT(*) AS n FROM hunt_observations WHERE symbol='TEST'").get().n>0,
     'fresh premarket quote must create research observation even when latest trade is stale');
 }finally{
   globalThis.Date=NativeDate;globalThis.fetch=nativeFetch;db.db.close();rmSync(dir,{recursive:true,force:true});
 }
});

test('Leader Hunt can record quiet overnight research without treating a stale quote as executable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'meds-hunt-quiet-'));const file=join(dir,'state.sqlite');
 const db=new D1(file);for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])db.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 const NativeDate=globalThis.Date;const nativeFetch=globalThis.fetch;
 let clock=NativeDate.parse('2026-09-18T05:00:00Z'); // 01:00 ET, overnight
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 globalThis.fetch=async(url,init={})=>{
   url=String(url);
   if(url.includes('most-actives'))return Response.json({most_actives:[{symbol:'QUIET'}]});
   if(url.includes('/movers'))return Response.json({gainers:[],losers:[]});
   if(url.includes('/news'))return Response.json({news:[]});
   if(url.includes('/options/snapshots'))return Response.json({snapshots:{}});
   if(url.includes('/stocks/snapshots')){
     const syms=new URL(url).searchParams.get('symbols').split(',');const result={};
     for(const symbol of syms)result[symbol]={
       latestTrade:{p:1,t:new NativeDate(clock-10*60_000).toISOString()},
       latestQuote:{bp:.995,ap:1.005,t:new NativeDate(clock-30*60_000).toISOString()},
       minuteBar:{c:1,v:100,t:new NativeDate(clock-10*60_000).toISOString()},
       dailyBar:{v:20000},prevDailyBar:{c:1,v:10000}
     };
     return Response.json(result);
   }
   throw Error('Unexpected URL '+url);
 };
 const env={MEDS_DB:db,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',ALPACA_API_KEY:'test-only',ALPACA_API_SECRET:'test-only'};
 try{
   const result=await runTick(env,'cron');
   assert.equal(result.ok,true,JSON.stringify(result));
   assert.ok(db.db.prepare("SELECT COUNT(*) AS n FROM hunt_observations WHERE symbol='QUIET'").get().n>0,
     'fresh overnight trade/bar should keep research alive even when quote is too old');
   assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions").get().n,0,
     'quote older than execution freshness limit must never create a paper position');
 }finally{
   globalThis.Date=NativeDate;globalThis.fetch=nativeFetch;db.db.close();rmSync(dir,{recursive:true,force:true});
 }
});
