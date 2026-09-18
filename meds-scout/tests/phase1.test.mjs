import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validQuote,equityExit,optionQuote,riskCapacity,SIM_VERSION,EXEC_VERSION} from '../src/paper-accounting.ts';
import {ensurePaperSchema,valueLedger,markLedger,manageEquityPositions,manageOptionPositions,enterEquityProposal,enterOptionsForCandidate,scanTick,leaderHuntEligible,runLeaderHunt,manageLeaderHuntPositions,HUNT_VERSION} from '../src/index.ts';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;return {args:[],bind(...a){this.args=a;return this;},async run(){const r=db.prepare(sql).run(...this.args);return {meta:{changes:Number(r.changes)}};},async all(){return {results:db.prepare(sql).all(...this.args)};},async first(){return db.prepare(sql).get(...this.args)??null;}};}
 async batch(ss){this.db.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const quote=(bp=100,ap=100.1,age=0)=>({bp,ap,bs:100,as:100,t:new Date(Date.now()-age).toISOString()});
async function setup(){const MEDS_DB=new D1();const env={MEDS_DB};await ensurePaperSchema(env);const ledger=MEDS_DB.db.prepare("SELECT * FROM paper_ledgers WHERE ledger_id='C'").get();return {env,ledger,db:MEDS_DB.db};}
function position(db,symbol='TEST',qty=2){db.prepare("INSERT INTO paper_positions(ledger_id,lane,symbol,direction,strategy,opened_at,entry_price,quantity,stop_price,target_price,initial_risk,highest_price,lowest_price,status) VALUES('C','PRIMARY',?,'long','catalyst_momentum',?,100,?,97.5,105,?,100,100,'open')").run(symbol,new Date().toISOString(),qty,qty*2.5);db.prepare("UPDATE paper_ledgers SET cash=cash-? WHERE ledger_id='C'").run(qty*100);}
const candidate={symbol:'TEST',price:100,bid:100,ask:100.1,spreadPct:.1,minuteVolume:100000,dayChangePct:2,catalystScore:22,volumeAccel:.1,score:90,consecutiveHits:3};
const proposal={symbol:'TEST',strategy:'catalyst_momentum',direction:'long',quality:98,stopPct:.025,rewardRisk:2.2,reason:'fixture'};
test('quote validation fails closed for missing, stale, future, crossed and nonfinite quotes',()=>{
 assert.equal(validQuote(undefined),false);assert.equal(validQuote(quote(100,101,90001)),false);
 assert.equal(validQuote(quote(100,101,-1000)),false);assert.equal(validQuote(quote(101,100)),false);
 assert.equal(validQuote(quote(NaN,101)),false);assert.equal(validQuote(quote()),true);
});
test('gap-through-stop uses observed bid less adverse slippage, never stop price',()=>{
 const x=equityExit(quote(80,81),'long',97.5,2);
 assert.equal(x.modeled_fill,79.984);assert.equal(x.trigger_price,97.5);assert.equal(x.execution_version,EXEC_VERSION);
 assert.equal(equityExit(quote(80,81,100000),'long',97.5,2),null);
 assert.ok(equityExit(quote(120,121),'short',103,2).modeled_fill>121);
});
test('option legs must both exist, be fresh, synchronized, and respect spread width',()=>{
 assert.equal(optionQuote(quote(2,2.1),undefined,5),null);
 assert.equal(optionQuote(quote(2,2.1),quote(1,1.1,91000),5),null);
 assert.equal(optionQuote(quote(2,2.1),quote(1,1.1,20000),5),null);
 assert.equal(optionQuote(quote(2,2.1),quote(1,1.1),1),null);
 const x=optionQuote(quote(2,2.1),quote(1,1.1),5);assert.ok(x);assert.ok(Math.abs(x.liquidation-.9)<1e-8);
});
test('aggregate capacity includes both lanes, options and unrealized losses',()=>{
 assert.deepEqual(riskCapacity(1000,[],'TEST'),{risk:10,allocation:250});
 assert.equal(riskCapacity(1000,[{underlying:'TEST',risk:6,notional:100,unrealized:-4}],'TEST').risk,0);
 assert.equal(riskCapacity(1000,[{underlying:'OTHER',risk:50,notional:100,unrealized:0}],'TEST').risk,0);
});
test('migration preserves historical trades and drawdown, and is idempotent',async()=>{
 const {env,db}=await setup();
 db.exec("UPDATE paper_ledgers SET max_drawdown_pct=.51 WHERE ledger_id='C'");
 const trades=JSON.stringify(db.prepare('SELECT * FROM paper_trades').all());
 await ensurePaperSchema(env);await ensurePaperSchema(env);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM paper_trades').all()),trades);
 assert.equal(db.prepare("SELECT max_drawdown_pct AS dd FROM paper_ledgers WHERE ledger_id='C'").get().dd,.51);
 assert.equal(db.prepare('SELECT version FROM paper_meta').get().version,4);
 assert.equal(db.prepare('SELECT simulator_version FROM paper_trades').get().simulator_version,'legacy-untrusted');
 db.close();
});
test('incomplete valuation cannot create or update drawdown and blocks entry',async()=>{
 const {env,ledger,db}=await setup();position(db);
 const ctx={stocks:{},options:{}};const v=await markLedger(env,ledger,ctx);
 assert.equal(v.complete,false);assert.equal(v.equity,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM paper_metric_epochs').get().n,0);
 ctx.stocks.TEST={latestQuote:quote(100,100.1)};await markLedger(env,ledger,ctx);
 const before=JSON.stringify(db.prepare('SELECT * FROM paper_metric_epochs').all());ctx.stocks.TEST.latestQuote=quote(1,2,100000);await markLedger(env,ledger,ctx);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM paper_metric_epochs').all()),before);
 ctx.stocks.OTHER={latestQuote:quote()};
 const result=await enterEquityProposal(env,ledger,'PRIMARY',{...candidate,symbol:'OTHER'},{...proposal,symbol:'OTHER'},'bucket',ctx);
 assert.equal(result.reason,'incomplete ledger valuation');db.close();
});
test('duplicate underlying across lanes/strategies rejected; unsupported shorts rejected',async()=>{
 const {env,ledger,db}=await setup();const ctx={stocks:{TEST:{latestQuote:quote()}},options:{}};
 assert.equal((await enterEquityProposal(env,ledger,'PRIMARY',candidate,proposal,'bucket',ctx)).entered,true);
 assert.equal((await enterEquityProposal(env,ledger,'SHADOW',candidate,{...proposal,strategy:'another'},'bucket',ctx)).reason,'already open');
 assert.match((await enterEquityProposal(env,ledger,'SHADOW',candidate,{...proposal,direction:'short'},'bucket',ctx)).reason,/unsupported short/);
 db.close();
});
test('exit cash, P&L, audit and version reconcile, stale quotes cannot close',async()=>{
 const {env,db}=await setup();position(db);const old=db.prepare("SELECT cash FROM paper_ledgers WHERE ledger_id='C'").get().cash;
 assert.equal(await manageEquityPositions(env,{TEST:{latestQuote:quote(80,81,100000)}}),0);
 assert.equal(await manageEquityPositions(env,{TEST:{latestQuote:quote(80,81)}}),1);
 const t=db.prepare("SELECT * FROM paper_trades WHERE symbol='TEST'").get();
 assert.ok(Math.abs(t.realized_pnl-(t.exit_price-t.entry_price)*t.quantity)<1e-8);
 assert.ok(Math.abs(db.prepare("SELECT cash FROM paper_ledgers WHERE ledger_id='C'").get().cash-old-t.exit_price*2)<1e-8);
 assert.equal(t.simulator_version,SIM_VERSION);assert.equal(t.execution_version,EXEC_VERSION);
 const e=JSON.parse(t.notes).execution;assert.equal(e.observed_bid,80);assert.equal(e.trigger_price,97.5);assert.equal(e.modeled_fill,t.exit_price);
 assert.equal(await manageEquityPositions(env,{TEST:{latestQuote:quote(80,81)}}),0);db.close();
});
test('concurrent portfolio change aborts entry batch without cash/position mutation',async()=>{
 const {env,ledger,db}=await setup();const v=await valueLedger(env,ledger,{stocks:{},options:{}});
 db.exec("UPDATE paper_ledgers SET cash=cash+1 WHERE ledger_id='C'");
 await assert.rejects(env.MEDS_DB.batch([env.MEDS_DB.prepare('INSERT OR REPLACE INTO paper_risk_guards VALUES(?,?)').bind('C',v.revision),env.MEDS_DB.prepare("UPDATE paper_ledgers SET cash=0 WHERE ledger_id='C'")]),/concurrent portfolio/);
 assert.equal(db.prepare("SELECT cash FROM paper_ledgers WHERE ledger_id='C'").get().cash,5001);db.close();
});
test('legacy v2 upgrade leaves every existing value unchanged',async()=>{
 const MEDS_DB=new D1();const env={MEDS_DB};
 MEDS_DB.db.exec(readFileSync(new URL('./fixtures/phase1-legacy.sql',import.meta.url),'utf8'));
 MEDS_DB.db.exec("UPDATE paper_ledgers SET max_drawdown_pct=.51 WHERE ledger_id='A'");
 const legacy=MEDS_DB.db.prepare('SELECT * FROM paper_trades').all();const ledgers=MEDS_DB.db.prepare('SELECT * FROM paper_ledgers').all();
 await ensurePaperSchema(env);
 for(const old of legacy){const row=MEDS_DB.db.prepare('SELECT * FROM paper_trades WHERE id=?').get(old.id);for(const [k,v] of Object.entries(old))assert.equal(row[k],v);assert.equal(row.simulator_version,'legacy-untrusted');}
 assert.deepEqual(MEDS_DB.db.prepare('SELECT * FROM paper_ledgers').all(),ledgers);
 await ensurePaperSchema(env);assert.deepEqual(MEDS_DB.db.prepare('SELECT * FROM paper_ledgers').all(),ledgers);MEDS_DB.db.close();
});
test('missing or stale option leg leaves position open and valuation incomplete; valid exit reconciles',async()=>{
 const NativeDate=Date;const clock=NativeDate.parse('2026-09-17T14:00:00Z');
 globalThis.Date=class extends NativeDate {constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
 const {env,ledger,db}=await setup();
 const long='TEST260925C00100000',short='TEST260925C00105000';
 db.prepare("INSERT INTO paper_option_positions(ledger_id,lane,underlying,strategy,opened_at,long_symbol,short_symbol,quantity,entry_debit,stop_debit,target_debit,initial_risk,highest_mark,lowest_mark,current_mark,status) VALUES('C','SHADOW','TEST','call_debit_spread',?,?,?,1,1.1,.66,1.65,110,1.1,1.1,1.1,'open')").run(new Date().toISOString(),long,short);
 db.exec("UPDATE paper_ledgers SET cash=cash-110 WHERE ledger_id='C'");
 try{
  const options={[long]:{latestQuote:quote(1,1.1)}};
  assert.equal(await manageOptionPositions(env,options),0);assert.equal((await valueLedger(env,ledger,{stocks:{},options})).complete,false);
  options[short]={latestQuote:quote(.7,.8,100000)};assert.equal(await manageOptionPositions(env,options),0);
  options[short]={latestQuote:quote(.7,.8)};assert.equal(await manageOptionPositions(env,options),1);
  const t=db.prepare("SELECT * FROM paper_trades WHERE asset_type='option'").get();
  assert.ok(Math.abs(t.realized_pnl-(t.exit_price-t.entry_price)*100*t.quantity)<1e-8);
  const x=JSON.parse(t.notes).execution;assert.equal(x.long_bid,1);assert.equal(x.short_ask,.8);assert.equal(x.execution_version,EXEC_VERSION);
 }finally{globalThis.Date=NativeDate;db.close();}
});
test('new options require setup and reject missing liquidity or excessive combined friction',async()=>{
 const NativeDate=Date,oldFetch=fetch;const clock=NativeDate.parse('2026-09-17T14:00:00Z');
 globalThis.Date=class extends NativeDate {constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
 const {env,ledger,db}=await setup();const ctx={stocks:{TEST:{latestQuote:quote()}},options:{}};
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({snapshots:{TEST260925C00100000:{latestQuote:quote(.7,.9)},TEST260925C00105000:{latestQuote:quote(.1,.3)}}});};
 try{
  assert.equal(await enterOptionsForCandidate(env,ledger,{...candidate,volumeAccel:-.9},'bucket',ctx),0);assert.equal(calls,0);
  assert.equal(await enterOptionsForCandidate(env,ledger,candidate,'bucket',ctx),0);
  assert.ok(db.prepare("SELECT * FROM paper_decisions WHERE reason LIKE '%combined friction%'").all().length>0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM paper_option_positions').get().n,0);
  globalThis.fetch=async()=>Response.json({snapshots:{TEST260925C00100000:{latestQuote:{...quote(.29,.3),as:undefined}}}});
  assert.equal(await enterOptionsForCandidate(env,ledger,candidate,'bucket',ctx),0);
  assert.ok(db.prepare("SELECT * FROM paper_decisions WHERE reason='data quality: missing executable option size'").all().length>0);
 }finally{globalThis.Date=NativeDate;globalThis.fetch=oldFetch;db.close();}
});
test('scanner retrieves held paper symbols even if discovery omits them',async()=>{
 const NativeDate=Date,oldFetch=fetch;const clock=NativeDate.parse('2026-09-17T14:00:00Z');
 globalThis.Date=class extends NativeDate {constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
 const {env,db}=await setup();
 for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 position(db,'HELD');let requested=[];
 globalThis.fetch=async(url)=>{url=String(url);if(url.includes('/snapshots?')){requested=new URL(url).searchParams.get('symbols').split(',');return Response.json({});}if(url.includes('/news'))return Response.json({news:[]});return Response.json({most_actives:[],gainers:[],losers:[]});};
 try {await scanTick({...env,PAPER_ENABLED:'false'});assert.ok(requested.includes('HELD'));}
 finally{globalThis.Date=NativeDate;globalThis.fetch=oldFetch;db.close();}
});


test('leader hunt enters early candidates independently and records target outcomes',async()=>{
 const {env,db}=await setup();
 const c={...candidate,dayChangePct:4,dayVolume:1000,previousDayVolume:1000,spreadPct:.1,volumeAccel:.10,consecutiveHits:3,catalystScore:0,catalystSummary:'',score:60,reasons:['fixture']};
 assert.equal(leaderHuntEligible(c),true);
 assert.equal(leaderHuntEligible({...c,dayChangePct:10.01}),false);
 const snaps={TEST:{latestQuote:quote(100,100.1)}};
 const run=await runLeaderHunt(env,[c],snaps);
 assert.equal(run.entries,1);assert.equal(run.open,1);assert.equal(run.version,HUNT_VERSION);
 assert.equal(db.prepare("SELECT status FROM hunt_observations WHERE symbol='TEST'").get().status,'ENTERED');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM paper_positions").get().n,0);
 snaps.TEST.latestQuote=quote(113,113.1);
 assert.equal(await manageLeaderHuntPositions(env,snaps),1);
 const t=db.prepare("SELECT * FROM hunt_trades WHERE symbol='TEST'").get();
 assert.equal(t.exit_reason,'target');assert.ok(t.return_pct>10);assert.equal(t.version,HUNT_VERSION);
 db.close();
});
