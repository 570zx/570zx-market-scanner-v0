import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {validQuote,equityExit,optionQuote,riskCapacity,SIM_VERSION,EXEC_VERSION} from '../src/paper-accounting.ts';
import worker,{ensurePaperSchema,valueLedger,markLedger,manageEquityPositions,manageOptionPositions,enterEquityProposal,enterOptionsForCandidate,scanTick,leaderHuntEligible,leaderEquityRunnerEligible,leaderEquityRunnerScore,runLeaderHunt,manageHuntAccountPositions,markHuntAccounts,enterLeaderHuntOptions,manageHuntOptionPositions,HUNT_VERSION} from '../src/index.ts';
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
 assert.equal(db.prepare('SELECT version FROM paper_meta').get().version,9);
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


test('leader v7 reserves equity entries for asymmetric runner candidates',()=>{
 const cheap={...candidate,price:4.5,bid:4.49,ask:4.51,spreadPct:.45,dayChangePct:3.5,dayVolume:900000,previousDayVolume:400000,minuteVolume:50000,volumeAccel:.18,consecutiveHits:2,catalystScore:0,catalystSummary:'',score:52,reasons:['fixture'],executionFresh:true,discoverySource:'top_gainer',discoveryRank:8};
 const bluechip={...cheap,symbol:'BLUE',price:280,bid:279.9,ask:280.1,spreadPct:.07,score:80,discoverySource:'most_active_volume'};
 assert.equal(leaderHuntEligible(cheap),true);
 assert.equal(leaderEquityRunnerEligible(cheap),true);
 assert.equal(leaderHuntEligible(bluechip),true);
 assert.equal(leaderEquityRunnerEligible(bluechip),false);
 assert.ok(leaderEquityRunnerScore(cheap)>leaderEquityRunnerScore({...cheap,price:20,discoverySource:'most_active_volume',volumeAccel:.08}));
 assert.equal(leaderEquityRunnerEligible({...cheap,catalystScore:-22}),false);
 assert.equal(leaderEquityRunnerEligible({...cheap,dayChangePct:-4}),false);
});

test('leader hunt ladders small profits, takes 85% at +200%, then peak-tests a 5% runner',async()=>{
 const {env,db}=await setup();
 const accounts=db.prepare("SELECT label,starting_equity,cash FROM hunt_accounts ORDER BY starting_equity").all();
 assert.deepEqual(accounts.map(x=>x.starting_equity),[100,1000,10000,100000,500000]);
 const c={...candidate,dayChangePct:4,dayVolume:100000,previousDayVolume:100000,minuteVolume:100000,spreadPct:.1,volumeAccel:.10,consecutiveHits:3,catalystScore:0,catalystSummary:'',score:60,reasons:['fixture'],executionFresh:true};
 assert.equal(leaderHuntEligible(c),true);
 assert.equal(leaderHuntEligible({...c,dayChangePct:10.01}),false);
 const snaps={TEST:{latestQuote:quote(100,100.1),minuteBar:{o:100,h:100.2,l:99.9,c:100.1,v:100000,t:new Date().toISOString()}}};
 const run=await runLeaderHunt(env,[c],snaps);
 assert.equal(run.signals_entered,1);assert.equal(run.account_entries,5);assert.equal(run.open,5);assert.equal(run.version,HUNT_VERSION);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_positions WHERE status='open'").get().n,5);

 for(const [bp,ap,event] of [[126,126.1,'LADDER_25'],[151,151.1,'LADDER_50'],[202,202.1,'LADDER_100']]){
  snaps.TEST.latestQuote=quote(bp,ap);
  const m=await manageHuntAccountPositions(env,snaps);
  assert.equal(m.ladderSells,5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_events WHERE event_type=?").get(event).n,5);
 }
 const before200=db.prepare("SELECT quantity,remaining_qty FROM hunt_account_positions WHERE account_id='H1K'").get();
 assert.ok(Math.abs(before200.remaining_qty-before200.quantity*.90)<1e-8);

 snaps.TEST.latestQuote=quote(303,303.1);
 const take=await manageHuntAccountPositions(env,snaps);
 assert.equal(take.take200s,5);
 const runner=db.prepare("SELECT quantity,remaining_qty,take200_done,locked_realized_pnl FROM hunt_account_positions WHERE account_id='H1K'").get();
 assert.equal(runner.take200_done,1);assert.ok(Math.abs(runner.remaining_qty-runner.quantity*.05)<1e-8);assert.ok(runner.locked_realized_pnl>0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_events WHERE event_type='TAKE_200'").get().n,5);

 snaps.TEST.latestQuote=quote(350,350.1);let hold=await manageHuntAccountPositions(env,snaps);
 assert.equal(hold.exits,0);
 snaps.TEST.latestQuote=quote(295,295.1);const close=await manageHuntAccountPositions(env,snaps);
 assert.equal(close.exits,5);
 const trades=db.prepare("SELECT * FROM hunt_account_trades WHERE symbol='TEST' ORDER BY entry_notional").all();
 assert.equal(trades.length,5);
 assert.ok(trades.every(t=>t.exit_reason==='runner_peak_retrace'&&t.take200_hit===1&&t.realized_pnl>0&&t.return_pct>150&&t.peak_gap_pct>=15&&t.version===HUNT_VERSION));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_events WHERE event_type='RUNNER_EXIT'").get().n,5);
 const after=db.prepare("SELECT starting_equity,current_equity,realized_pnl FROM hunt_accounts ORDER BY starting_equity").all();
 assert.ok(after.every(a=>a.realized_pnl>0&&a.current_equity>a.starting_equity));
 db.close();
});


test('leader hunt records compounding milestones once at first observed crossing',async()=>{
 const {env,db}=await setup();
 db.prepare("UPDATE hunt_accounts SET cash=250,current_equity=100,max_equity=100,max_drawdown_pct=0 WHERE account_id='H100'").run();
 const t1=new Date('2026-09-18T03:00:00Z');
 await markHuntAccounts(env,{},t1);
 let rows=db.prepare("SELECT * FROM hunt_account_milestones WHERE account_id='H100' ORDER BY multiple").all();
 assert.deepEqual(rows.map(x=>x.multiple),[2]);
 assert.equal(rows[0].reached_at,t1.toISOString());
 assert.ok(rows[0].equity>=200);

 db.prepare("UPDATE hunt_accounts SET cash=12000 WHERE account_id='H100'").run();
 const t2=new Date('2026-09-18T04:00:00Z');
 await markHuntAccounts(env,{},t2);
 rows=db.prepare("SELECT * FROM hunt_account_milestones WHERE account_id='H100' ORDER BY multiple").all();
 assert.deepEqual(rows.map(x=>x.multiple),[2,5,10,25,50,100]);
 assert.equal(rows[0].reached_at,t1.toISOString(),'first milestone time must be immutable');
 assert.ok(rows.slice(1).every(x=>x.reached_at===t2.toISOString()));
 db.close();
});


test('leader hunt includes true penny stocks without loosening execution discipline',async()=>{
 const {env,db}=await setup();
 const penny={...candidate,symbol:'PENNY',price:.20,bid:.195,ask:.205,spreadPct:5,dayChangePct:3,score:55,catalystScore:0,volumeAccel:.1,executionFresh:true};
 assert.equal(leaderHuntEligible(penny),true);
 assert.equal(leaderHuntEligible({...penny,price:.09}),false);
 assert.equal(leaderHuntEligible({...penny,spreadPct:8.1}),false);
 assert.equal(db.prepare("SELECT version FROM paper_meta WHERE id=1").get().version,9);
 db.close();
});

test('leader hunt options share account cash, use whole contracts and follow +200 lifecycle',async()=>{
 const {env,db}=await setup();
 const NativeFetch=globalThis.fetch;
 const now=new Date('2026-09-18T15:00:00Z');
 const optionSymbol='TEST260925C00005000';
 globalThis.fetch=async(url)=>{
   url=String(url);
   if(url.includes('/v1beta1/options/snapshots/TEST')){
     return Response.json({snapshots:{[optionSymbol]:{latestQuote:{bp:.45,ap:.50,bs:50,as:50,t:now.toISOString()}}}});
   }
   throw new Error('unexpected '+url);
 };
 const huntEnv={...env,ALPACA_API_KEY:'test',ALPACA_API_SECRET:'test'};
 const c={...candidate,price:5,bid:4.99,ask:5.01,spreadPct:.4,dayChangePct:2,catalystScore:22,volumeAccel:.2,score:80,
   dayVolume:100000,previousDayVolume:50000,minuteVolume:10000,catalystSummary:'fixture',reasons:['fixture'],executionFresh:true};
 try{
   const marks={};
   const entered=await enterLeaderHuntOptions(huntEnv,[c],now,marks);
   assert.equal(entered.signals_entered,1);
   assert.equal(entered.account_entries,3,'$100 and $1K tiers should skip contracts they cannot afford at 4% sizing');
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_positions WHERE status='open'").get().n,3);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_positions WHERE quantity!=CAST(quantity AS INTEGER)").get().n,0,
     'option sizing must remain whole-contract');

   marks[optionSymbol]={latestQuote:{bp:1.55,ap:1.60,bs:50,as:50,t:new Date(now.getTime()+5*60000).toISOString()}};
   const hit=await manageHuntOptionPositions(huntEnv,marks,new Date(now.getTime()+5*60000));
   assert.ok(hit.take200s>=3);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_trades WHERE exit_reason='take_200'").get().n,1,
     'smaller whole-contract position closes fully at +200 when a 5% runner is impossible');
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_positions WHERE status='open' AND take200_done=1").get().n,2);

   marks[optionSymbol]={latestQuote:{bp:1.25,ap:1.30,bs:50,as:50,t:new Date(now.getTime()+10*60000).toISOString()}};
   const runner=await manageHuntOptionPositions(huntEnv,marks,new Date(now.getTime()+10*60000));
   assert.equal(runner.exits,2);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_account_option_trades").get().n,3);
   assert.ok(db.prepare("SELECT MIN(realized_pnl) AS n FROM hunt_account_option_trades").get().n>0);
 }finally{
   globalThis.fetch=NativeFetch;db.close();
 }
});


test('top-gainer audit records broad discovery and explains late discovery',async()=>{
 const NativeDate=Date,oldFetch=globalThis.fetch;const clock=NativeDate.parse('2026-09-18T15:00:00Z');
 globalThis.Date=class extends NativeDate {constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
 const {env,db}=await setup();
 for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql'])db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
 globalThis.fetch=async(url)=>{
   url=String(url);
   if(url.includes('most-actives')) return Response.json({most_actives:[]});
   if(url.includes('/movers')) return Response.json({gainers:[{symbol:'MOON',price:2,change:1,percent_change:100}],losers:[]});
   if(url.includes('/stocks/snapshots')){
     return Response.json({MOON:{
       latestQuote:{bp:1.99,ap:2.01,bs:100,as:100,t:new Date(clock).toISOString()},
       latestTrade:{p:2,t:new Date(clock).toISOString()},
       minuteBar:{o:1.95,h:2.05,l:1.9,c:2,v:50000,t:new Date(clock).toISOString()},
       dailyBar:{v:500000},prevDailyBar:{c:1,v:100000}
     }});
   }
   if(url.includes('/news')) return Response.json({news:[]});
   if(url.includes('/options/')) return Response.json({snapshots:{}});
   throw new Error('unexpected '+url);
 };
 try{
   await scanTick({...env,PAPER_ENABLED:'false'});
   assert.equal(db.prepare("SELECT COUNT(*) n FROM hunt_gainer_board WHERE symbol='MOON'").get().n,1);
   const d=db.prepare("SELECT * FROM hunt_discovery_observations WHERE symbol='MOON'").get();
   assert.equal(Math.round(d.day_change_pct),100);
   assert.equal(d.shortlisted,0);
   const res=await worker.fetch(new Request('https://test/status/hunt/gainers?limit=10'),env);
   assert.equal(res.status,200);
   const body=await res.json();
   assert.equal(body.rows[0].symbol,'MOON');
   assert.equal(body.rows[0].miss_reason,'DISCOVERED_AFTER_10');
   assert.equal(body.rows[0].caught_before_10,false);
 }finally{globalThis.Date=NativeDate;globalThis.fetch=oldFetch;db.close();}
});
