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
   for(const symbol of q)result[symbol]={latestTrade:{p:symbol==='FRGT'?price:1,t:new Date().toISOString()},latestQuote:{bp:.995,ap:1.005,t:new Date().toISOString()},minuteBar:{c:1,v:minuteVol},dailyBar:{v:20000},prevDailyBar:{c:1,v:10000}};
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
  const initialAlerts=alertCount;
  clock+=60000;minuteVol=150;price=1.2;
  assert.equal((await runTick(env,'cron')).ok,true);
  let p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');
  assert.equal(p.first_tp_done,1);assert.equal(p.remaining_qty,30);assert.ok(Math.abs(p.realized_pnl-14)<1e-8);
  assert.equal(db.db.prepare('SELECT consecutive_hits FROM symbol_state WHERE symbol=?').get('TEST').consecutive_hits,2);
  assert.equal(alertCount,initialAlerts+1,'Only position alert, not repeated signal');
  const before=alertCount;clock+=60000;await runTick(env,'cron');assert.equal(alertCount,before,'No duplicate position alert');
  db.db.close();
  const restart=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(d.prepare("SELECT remaining_qty,first_tp_done FROM shadow_positions WHERE symbol='FRGT'").get()));`,file],{encoding:'utf8'});
  assert.equal(restart.status,0);assert.deepEqual(JSON.parse(restart.stdout),{remaining_qty:30,first_tp_done:1});
  db=new D1(file);env.MEDS_DB=db;
  clock+=60000;price=1.3;await runTick(env,'cron');p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');assert.equal(p.remaining_qty,15);assert.equal(p.second_tp_done,1);
  clock+=60000;price=1.1;await runTick(env,'cron');p=db.db.prepare('SELECT * FROM shadow_positions WHERE symbol=?').get('FRGT');assert.equal(p.status,'closed');assert.equal(p.remaining_qty,0);
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
  assert.equal(missingStatus.paper.schema_version,6);
  assert.equal(missingDb.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='hunt_observations'").get().n,1);
  assert.doesNotMatch(String(missingStatus.paper.paper_error??''),/missing tables/);
  missingDb.db.close();rmSync(missingDir,{recursive:true,force:true});
  assert.ok(requests.every(r=>r.method==='GET'||r.url==='https://discord.com/api/webhooks/test'));
 }finally{globalThis.Date=NativeDate;globalThis.fetch=nativeFetch;db.db.close();rmSync(dir,{recursive:true,force:true});}
});
