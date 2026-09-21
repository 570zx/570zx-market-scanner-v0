import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{ensurePaperSchema,runTick,runHuntAccounts,manageHuntAccountPositions,manageHuntOptionPositions,manageLeaderHuntPositions,valueLedger,markLedger,markHuntAccounts,HUNT_VERSION,selectLeaderOption,enterLeaderHuntOptions,scanTick} from '../src/index.ts';
import {fencedDatabase,healthState,plannedCadence,ENGINE_VERSION,AUTONOMOUS_SCHEMA} from '../src/autonomous.ts';
import {MarketDataCycle,mandatoryUniverse,refreshHeldQuotes,retainQuotes} from '../src/market-data.ts';
import {runnerReasons,optionDirection,orderedRunnerCandidates,preservedMaxHold} from '../src/leader-policy.ts';
import {persistResearch,auditMovers,performanceReport,recordDecision,moverMiss} from '../src/research-audit.ts';

class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.calls=0;this.statements=0;}
  prepare(sql){const owner=this,db=this.db;const args=[];return {args,bind(...a){return Object.assign(owner.prepare(sql),{args:a});},
    _run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};},
    async run(){owner.calls++;owner.statements++;return this._run();},async all(){owner.calls++;owner.statements++;return {results:db.prepare(sql).all(...this.args)};},async first(){owner.calls++;owner.statements++;return db.prepare(sql).get(...this.args)??null;}};}
  async batch(ss){this.calls++;this.statements+=ss.length;this.db.exec('BEGIN');try{const r=ss.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function setup({legacyTiers=true,leaderOnly=false}={}){
  const MEDS_DB=new D1();
  for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql','0004_autonomous.sql','0005_leader250_capacity.sql']) MEDS_DB.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  const env={MEDS_DB,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',PAPER_ENABLED:leaderOnly?'false':'true',LEADER_ONLY:leaderOnly?'true':'false',
    ADMIN_TOKEN:'test',ALPACA_API_KEY:'fixture',ALPACA_API_SECRET:'fixture'};
  await ensurePaperSchema(env);
  if(legacyTiers){
    MEDS_DB.db.exec("DELETE FROM leader_runtime_accounts; INSERT INTO leader_runtime_accounts(account_id,active,role,created_at) SELECT account_id,1,'test',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM hunt_accounts WHERE account_id!='H250';");
  }
  return {env,db:MEDS_DB.db};
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

test('runner gate diagnoses negatives, preserves blue-chip options, and refuses volume-contraction puts',()=>{
  assert.deepEqual(runnerReasons(candidate()),[]);
  assert.ok(runnerReasons(candidate({price:300})).includes('PRICE_ABOVE_RUNNER_LANE'));
  assert.equal(optionDirection(candidate({price:300})), 'bull');
  assert.ok(runnerReasons(candidate({catalystScore:-22})).includes('CATALYST_NEGATIVE'));
  assert.ok(runnerReasons(candidate({price:.09})).includes('PRICE_BELOW_MIN'));
  assert.ok(runnerReasons(candidate({dayChangePct:11})).includes('MOVE_ALREADY_EXTENDED'));
  assert.ok(runnerReasons(candidate({spreadPct:10})).includes('SPREAD_TOO_WIDE'));
  assert.equal(optionDirection(candidate({dayChangePct:-2,volumeAccel:-.2,dayVolume:1000})),null);
  assert.equal(optionDirection(candidate({dayChangePct:-2,catalystScore:-22})),'bear');
});

test('freshness precedes capacity and reserved discovery order survives entry selection',()=>{
  const early=candidate({symbol:'EARLY',score:20}),late=candidate({symbol:'LATE',score:99}),stale=candidate({symbol:'STALE'});
  assert.deepEqual(orderedRunnerCandidates([stale,early,late],c=>c.symbol!=='STALE').map(c=>c.symbol),['EARLY','LATE']);
  assert.deepEqual(mandatoryUniverse(['A','B','C'],['D'],[],2),['A','B','C']);
});

test('Leader reserve includes slippage, duplicate and cooldown reasons are durable, and tiers reconcile',()=>clocked(async advance=>{
  const {env,db}=await setup();
  db.exec("UPDATE hunt_accounts SET cash=13 WHERE account_id='H100'");
  const c=candidate(),snaps={EARLY:snapshot()};
  await runHuntAccounts(env,[c],snaps);
  assert.ok(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H100'").get().cash>=12-1e-8);
  const p=db.prepare("SELECT * FROM hunt_account_positions WHERE account_id='H100'").get();
  assert.ok(p.entry_notional<=1+1e-8);
  await runHuntAccounts(env,[c],snaps);
  assert.equal(db.prepare("SELECT outcome FROM candidate_decisions WHERE symbol='EARLY' AND account_id='H100' AND stage='ENTRY'").get().outcome,'ENTERED','a retry must not overwrite the committed entry decision');
  advance(300000);snaps.EARLY=snapshot();
  await runHuntAccounts(env,[c],snaps);
  assert.match(db.prepare("SELECT reasons FROM candidate_decisions WHERE symbol='EARLY' AND account_id='H100' AND stage='ENTRY' ORDER BY bucket DESC LIMIT 1").get().reasons,/DUPLICATE_POSITION/);
  snaps.EARLY=snapshot(2,2.01);
  await manageHuntAccountPositions(env,snaps);
  await runHuntAccounts(env,[c],{EARLY:snapshot()});
  assert.match(db.prepare("SELECT reasons FROM candidate_decisions WHERE symbol='EARLY' AND account_id='H100' AND stage='ENTRY' ORDER BY bucket DESC LIMIT 1").get().reasons,/REENTRY_COOLDOWN/);
  const a=db.prepare("SELECT cash,realized_pnl FROM hunt_accounts WHERE account_id='H100'").get();
  assert.ok(Math.abs(a.cash-13-a.realized_pnl)<1e-8);
  db.close();
}));

test('zero minute liquidity cannot invent fractional liquidity or consume an entry signal',()=>clocked(async()=>{
  const {env,db}=await setup();
  const zero=candidate({symbol:'ZERO',minuteVolume:0}),good=candidate();
  const result=await runHuntAccounts(env,[zero,good],{ZERO:snapshot(),EARLY:snapshot()});
  assert.equal(result.equity_signals_entered,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE symbol='ZERO'").get().n,0);
  assert.match(db.prepare("SELECT reasons FROM candidate_decisions WHERE symbol='ZERO' LIMIT 1").get().reasons,/MINUTE_LIQUIDITY_LIMIT/);
  db.close();
}));

test('stops partially fill under liquidity limits, remain pending through rebound, and reconcile total P&L',()=>clocked(async advance=>{
  const {env,db}=await setup();
  await runHuntAccounts(env,[candidate()],{EARLY:snapshot()});
  const original=db.prepare("SELECT * FROM hunt_account_positions WHERE account_id='H500K'").get();
  advance(300000);
  await manageHuntAccountPositions(env,{EARLY:snapshot(2,2.01,1000)});
  const partial=db.prepare("SELECT * FROM hunt_account_positions WHERE account_id='H500K'").get();
  assert.equal(partial.status,'open');assert.ok(Math.abs(partial.remaining_qty-original.quantity+50)<1e-8);
  advance(300000);
  await manageHuntAccountPositions(env,{EARLY:snapshot(4.5,4.51,1e7)});
  const trade=db.prepare("SELECT * FROM hunt_account_trades WHERE account_id='H500K'").get();
  assert.equal(trade.exit_reason,'stop');
  const a=db.prepare("SELECT * FROM hunt_accounts WHERE account_id='H500K'").get();
  assert.ok(Math.abs(a.cash-a.starting_equity-trade.realized_pnl)<1e-6);
  assert.ok(Math.abs(a.realized_pnl-trade.realized_pnl)<1e-6);
  db.close();
}));

test('held quote retry preserves original timestamp and last good reporting mark without allowing execution',()=>clocked(async advance=>{
  const {env,db}=await setup(),data=new MarketDataCycle(env);
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({quotes:{HELD:quote(10,10.1)}});};
  const snaps={};await refreshHeldQuotes(env.MEDS_DB,data,snaps,['HELD'],'iex');
  assert.equal(calls,1);assert.equal(snaps.HELD.latestQuote.bp,10);
  const recorded=db.prepare('SELECT quote_at FROM quote_cache').get().quote_at;
  advance(300000);globalThis.fetch=async()=>new Response('unavailable',{status:503});
  await refreshHeldQuotes(env.MEDS_DB,data,{},['HELD'],'iex');
  assert.equal(db.prepare('SELECT quote_at FROM quote_cache').get().quote_at,recorded);
  assert.equal(db.prepare('SELECT state FROM quote_health').get().state,'EXECUTION_UNAVAILABLE');
  assert.equal(data.requests,2);assert.equal(data.retries,2);
  db.close();
}));

test('partial normal valuation exposes known subtotal and stale reporting value, preserving fail-closed entry risk',()=>clocked(async advance=>{
  const {env,db}=await setup();
  db.prepare("INSERT INTO paper_positions(ledger_id,lane,symbol,direction,strategy,opened_at,entry_price,quantity,stop_price,target_price,initial_risk,highest_price,lowest_price) VALUES('C','PRIMARY','HELD','long','test',?,10,2,9,12,2,10,10)").run(new Date().toISOString());
  db.exec("UPDATE paper_ledgers SET cash=cash-20 WHERE ledger_id='C'");
  await retainQuotes(env.MEDS_DB,'equity',{HELD:{latestQuote:quote(11,11.1)}},['HELD'],'iex');advance(300000);
  const ledger=db.prepare("SELECT * FROM paper_ledgers WHERE ledger_id='C'").get();
  const valuation=await markLedger(env,ledger,{stocks:{},options:{}});
  assert.equal(valuation.complete,false);assert.equal(valuation.equity,null);
  const state=db.prepare("SELECT * FROM portfolio_valuation_state WHERE account_id='PAPER:C'").get();
  assert.equal(state.live_equity,null);assert.equal(state.known_value,4980);assert.equal(state.reporting_value,5002);
  assert.equal(JSON.parse(state.marks)[0].state,'MARK_STALE');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paper_metric_epochs').get().n,0);
  await markHuntAccounts(env,{});db.close();
}));

test('lease fence rejects old owners and pause, rolls back whole transactions, and cannot release replacement',()=>clocked(async()=>{
  const {env,db}=await setup();
  db.prepare('UPDATE service_state SET lock_owner=?,lock_until=?').run('old',Date.now()+360000);
  const fenced=fencedDatabase(env.MEDS_DB,'old');
  await fenced.prepare("UPDATE hunt_accounts SET cash=cash+1 WHERE account_id='H100'").run();
  db.prepare('UPDATE service_state SET lock_owner=?').run('new');
  await assert.rejects(fenced.batch([fenced.prepare("UPDATE hunt_accounts SET cash=0 WHERE account_id='H100'")]),/lease lost/);
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H100'").get().cash,101);
  const current=fencedDatabase(env.MEDS_DB,'new');db.exec('UPDATE service_state SET paused=1');
  await assert.rejects(current.prepare("UPDATE hunt_accounts SET cash=0 WHERE account_id='H100'").run(),/paused/);
  db.exec('UPDATE service_state SET paused=0');
  await assert.rejects(current.batch([current.prepare("UPDATE hunt_accounts SET cash=90 WHERE account_id='H100'"),current.prepare('INSERT INTO no_such_table VALUES(1)')]));
  assert.equal(db.prepare("SELECT cash FROM hunt_accounts WHERE account_id='H100'").get().cash,101);db.close();
}));

test('concurrent Leader entry snapshots cannot double debit cash',()=>clocked(async()=>{
  const {env,db}=await setup();
  const outcomes=await Promise.allSettled([runHuntAccounts(env,[candidate()],{EARLY:snapshot()}),runHuntAccounts(env,[candidate()],{EARLY:snapshot()})]);
  assert.ok(outcomes.some(x=>x.status==='fulfilled'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE account_id='H100'").get().n,1);
  const a=db.prepare("SELECT * FROM hunt_accounts WHERE account_id='H100'").get(),p=db.prepare("SELECT * FROM hunt_account_positions WHERE account_id='H100'").get();
  assert.ok(Math.abs(a.cash+p.entry_notional-a.starting_equity)<1e-8);db.close();
}));

test('v7 hold duration and entry versions survive v8; legacy equity management cannot modify options',()=>clocked(async()=>{
  const {env,db}=await setup();
  assert.equal(preservedMaxHold('leader-hunt-v7-asymmetric-runner','equity','{}'),720);
  assert.equal(preservedMaxHold(HUNT_VERSION,'option','{}'),1440);
  assert.equal(preservedMaxHold(HUNT_VERSION,'equity','{"max_hold_minutes":999}'),999);
  await runHuntAccounts(env,[candidate()],{EARLY:snapshot()});
  db.exec("UPDATE hunt_account_positions SET version='leader-hunt-v7-asymmetric-runner',opened_at='2026-09-18T09:00:00Z'");
  const before=JSON.stringify(db.prepare('SELECT * FROM hunt_account_positions').all());
  db.exec('UPDATE paper_meta SET version=9');await ensurePaperSchema(env);await ensurePaperSchema(env);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM hunt_account_positions').all()),before);
  await manageHuntAccountPositions(env,{EARLY:snapshot()});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE status='open'").get().n,5);
  db.prepare("INSERT INTO hunt_positions(symbol,opened_at,entry_price,stop_price,target_price,highest_price,lowest_price,entry_score,entry_day_change_pct,opened_phase,features,version) VALUES('OLD',?,4,3,12,4,4,50,1,'premarket','{}','v1')").run(new Date().toISOString());
  const options=JSON.stringify(db.prepare('SELECT * FROM hunt_account_option_positions').all());
  await manageLeaderHuntPositions(env,{OLD:snapshot()});
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM hunt_account_option_positions').all()),options);db.close();
}));

test('option chain rejects wide/stale quotes and bad delta, accepts quality liquid underlying setup',()=>clocked(async()=>{
  const {env,db}=await setup(),c=candidate({price:100,bid:99.9,ask:100.1,spreadPct:.2});
  const symbol='EARLY260925C00100000';let q=quote(1,2),delta=.5;
  globalThis.fetch=async()=>Response.json({snapshots:{[symbol]:{latestQuote:q,greeks:{delta}}}});
  assert.equal(await selectLeaderOption(env,c),null);
  q=quote(1,1.05,91000);assert.equal(await selectLeaderOption(env,c),null);
  q=quote(1,1.05);delta=.95;assert.equal(await selectLeaderOption(env,c),null);
  delta=.5;assert.equal((await selectLeaderOption(env,c)).symbol,symbol);
  const result=await enterLeaderHuntOptions(env,[c],new Date(),{});assert.ok(result.account_entries>0);
  const old=db.prepare('SELECT SUM(cash) AS cash FROM hunt_accounts').get().cash;
  await manageHuntOptionPositions(env,{[symbol]:{latestQuote:quote(.1,.2,91000)}});
  assert.equal(db.prepare('SELECT SUM(cash) AS cash FROM hunt_accounts').get().cash,old);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hunt_account_option_positions WHERE quantity!=CAST(quantity AS INTEGER)').get().n,0);db.close();
},'2026-09-18T15:00:00Z'));

test('final enriched audit persists exact account rejection and honest sampled excursions',()=>clocked(async advance=>{
  const {env,db}=await setup();const sources=new Map([['EARLY',{source:'fresh_news',rank:1}],['MISSING',{source:'top_gainer',rank:2}]]);
  const c=candidate({catalystScore:-22});
  await persistResearch(env.MEDS_DB,['EARLY','MISSING'],[c],sources,new Set(['EARLY']),'premarket',c=>c);
  assert.equal(db.prepare("SELECT runner_at FROM research_outcomes WHERE symbol='EARLY'").get().runner_at,null);
  assert.match(db.prepare("SELECT reasons FROM candidate_decisions WHERE symbol='EARLY'").get().reasons,/CATALYST_NEGATIVE/);
  advance(300000);const now=new Date(),bucket=now.toISOString();
  db.prepare('INSERT INTO hunt_gainer_board(bucket,session_date,created_at,phase,rank,symbol,price,percent_change,raw_json,version) VALUES(?,?,?,?,?,?,?,?,?,?)').run(bucket,'2026-09-18',bucket,'premarket',1,'EARLY',6,50,'{}',HUNT_VERSION);
  await persistResearch(env.MEDS_DB,['EARLY'],[candidate({price:6,dayChangePct:50})],sources,new Set(['EARLY']),'premarket',c=>c);
  await recordDecision(env.MEDS_DB,c,'ASYMMETRIC_EQUITY_RUNNER','ENTRY',['CAPITAL_RESERVE_BLOCK'],{},'H100');
  await auditMovers(env.MEDS_DB,'premarket');
  const a=JSON.parse(db.prepare('SELECT summary FROM mover_audits').get().summary);
  assert.equal(a.first_seen_price,4);assert.equal(a.sampled_mfe_pct,50);assert.equal(a.miss_reason,'CAPITAL_RESERVE_BLOCK');
  assert.equal(a.caught_before_10,false);assert.match(a.provider_time_basis,/poll/);db.close();
}));

test('performance default isolates current version, reports empty distribution honestly',()=>clocked(async()=>{
  const {env,db}=await setup();
  const r=await performanceReport(env.MEDS_DB,new URL('https://test/status/hunt/performance'));
  assert.equal(r.version,HUNT_VERSION);assert.equal(r.summary.trades,0);assert.equal(r.summary.median_return,null);
  assert.match(r.sample_unit,/correlated/);db.close();
}));

test('pause makes no data requests; resume cannot bypass deployment gate; health is session aware',()=>clocked(async()=>{
  const {env,db}=await setup();let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not call provider');};
  assert.equal((await runTick({...env,SCOUT_ENABLED:'false'},'cron')).skipped,'disabled');assert.equal(calls,0);
  const response=await worker.fetch(new Request('https://test/control/resume',{method:'POST',headers:{authorization:'Bearer test'}}),{...env,SCOUT_ENABLED:'false'});
  assert.equal((await response.json()).enabled,false);
  const status=await (await worker.fetch(new Request('https://test/status'),{...env,SCOUT_ENABLED:'false'})).json();
  assert.equal(status.health,'PAUSED');assert.equal(status.live_execution,false);
  assert.equal(status.paper.valuation_state,'NOT_YET_VALUED','bootstrap must not advertise a valuation before the first v8 mark');
  assert.equal(healthState(true,true,null,null,false),'ENGINE_STALE');
  assert.equal(healthState(true,true,new Date().toISOString(),null,true),'DEGRADED');
  assert.equal(healthState(true,true,new Date().toISOString(),'failure',false),'ENGINE_CRITICAL');
  assert.equal(plannedCadence('overnight'),30);assert.equal(plannedCadence('regular'),5);db.close();
}));

test('data budget and per-cycle memoization bound duplicate provider requests',()=>clocked(async()=>{
  const data=new MarketDataCycle({ALPACA_API_KEY:'test',ALPACA_API_SECRET:'test'},2);
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({ok:true});};
  await Promise.all([data.json('/same'),data.json('/same')]);await data.json('/other');
  await assert.rejects(data.json('/third'),/BUDGET/);assert.equal(calls,2);assert.equal(data.cacheHits,1);
}));

test('combined equity/option account cap blocks entry with an exact reason and database invariant',()=>clocked(async()=>{
  const {env,db}=await setup(),stamp=new Date().toISOString();
  const equity=db.prepare(`INSERT INTO hunt_account_positions(account_id,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,entry_score,entry_day_change_pct,opened_phase,features,version,remaining_qty)
    VALUES('H100',?,?,1,1,1,.5,3,1,1,50,2,'premarket','{}',?,1)`);
  for(let i=0;i<31;i++)equity.run('HELD'+i,stamp,HUNT_VERSION);
  db.prepare(`INSERT INTO hunt_account_option_positions(account_id,underlying,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,current_mark,current_mark_at,entry_score,entry_day_change_pct,opened_phase,features,version,remaining_qty)
    VALUES('H100','OPT','OPT260925C00001000',?,.01,1,1,.005,.03,.01,.01,.01,?,50,2,'premarket','{}',?,1)`).run(stamp,stamp,HUNT_VERSION);
  await runHuntAccounts(env,[candidate()],{EARLY:snapshot()});
  assert.match(db.prepare("SELECT reasons FROM candidate_decisions WHERE symbol='EARLY' AND account_id='H100' AND stage='ENTRY'").get().reasons,/OPEN_POSITION_CAP/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE account_id='H100'").get().n,31);
  assert.throws(()=>equity.run('EXTRA',stamp,HUNT_VERSION),/open position cap/);
  db.close();
}));

test('nonempty performance separates entry versions and calculates realized distribution and lifecycle counts',()=>clocked(async advance=>{
  const {env,db}=await setup();
  await runHuntAccounts(env,[candidate()],{EARLY:snapshot()});
  advance(300000);
  await manageHuntAccountPositions(env,{EARLY:snapshot(2,2.01,1e7)});
  const allTrades=db.prepare('SELECT * FROM hunt_account_trades').all();assert.equal(allTrades.length,5);
  db.prepare('UPDATE hunt_account_trades SET version=? WHERE id=?').run('leader-hunt-v7-asymmetric-runner',allTrades[0].id);
  const report=await performanceReport(env.MEDS_DB,new URL('https://test/status/hunt/performance'));
  const expected=allTrades.slice(1).map(r=>r.return_pct).sort((a,b)=>a-b);
  assert.equal(report.summary.trades,4);assert.equal(report.summary.winners,0);
  assert.equal(report.summary.median_return,(expected[1]+expected[2])/2);
  assert.equal(report.summary.worst,expected[0]);assert.equal(report.summary.best,expected[3]);
  assert.equal((await performanceReport(env.MEDS_DB,new URL('https://test/status/hunt/performance?version=previous'))).summary.trades,1);
  assert.equal((await performanceReport(env.MEDS_DB,new URL('https://test/status/hunt/performance?version=all'))).summary.trades,5);
  advance(25*60*60*1000);
  assert.equal((await performanceReport(env.MEDS_DB,new URL('https://test/status/hunt/performance?window=24h'))).summary.trades,0);
  db.close();
}));

test('production runtime activates only the $250 Leader account and preserves historical tiers',()=>clocked(async()=>{
  const {env,db}=await setup({legacyTiers:false,leaderOnly:true});
  const active=db.prepare("SELECT a.* FROM hunt_accounts a JOIN leader_runtime_accounts r USING(account_id) WHERE r.active=1").all();
  assert.equal(active.length,1);assert.equal(active[0].account_id,'H250');assert.equal(active[0].starting_equity,250);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_accounts WHERE account_id IN ('H100','H1K','H10K','H100K','H500K')").get().n,5);
  await runHuntAccounts(env,[candidate()],{EARLY:snapshot()});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE account_id='H250'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hunt_account_positions WHERE account_id!='H250'").get().n,0);
  db.close();
}));

test('broad synthetic cycle measures deployment usage and records controls without fabricating entries',t=>clocked(async()=>{
  const {env,db}=await setup({legacyTiers:false,leaderOnly:true});
  const symbols=Array.from({length:260},(_,i)=>'CTRL'+i);
  globalThis.fetch=async url=>{
    const u=new URL(String(url));
    if(u.pathname.endsWith('/movers'))return Response.json({gainers:symbols.slice(0,50).map(symbol=>({symbol,price:100,percent_change:0})),losers:[]});
    if(u.pathname.endsWith('/most-actives'))return Response.json({most_actives:symbols.map(symbol=>({symbol}))});
    if(u.pathname.includes('/news'))return Response.json({news:[]});
    if(u.pathname.includes('/stocks/snapshots'))return Response.json(Object.fromEntries(u.searchParams.get('symbols').split(',').map(s=>[s,{...snapshot(100,100.01),prevDailyBar:{c:100,v:100000}}])));
    if(u.pathname.includes('/options/'))return Response.json({snapshots:{}});
    throw Error('unexpected fixture URL '+u.pathname);
  };
  env.MEDS_DB.calls=0;env.MEDS_DB.statements=0;
  const result=await runTick(env,'fixture');
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hunt_account_positions').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate_decisions WHERE stage='RESEARCH'").get().n,260);
  const cycle=db.prepare('SELECT * FROM engine_cycles').get(),metrics=JSON.parse(cycle.metrics);
  assert.equal(cycle.state,'COMPLETE');assert.ok(metrics.requests<=36);assert.ok(metrics.database.calls>0);
  const callsBefore=env.MEDS_DB.calls,statementsBefore=env.MEDS_DB.statements;
  assert.ok(statementsBefore<=45,`expected meaningful headroom below 50 D1 queries, got ${statementsBefore}`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leader_runtime_accounts WHERE active=1 AND account_id='H250'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leader_runtime_accounts WHERE active=1 AND account_id!='H250'").get().n,0);
  assert.equal((await runTick(env,'fixture')).skipped,'cycle already complete');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM engine_cycles').get().n,1);
  t.diagnostic(JSON.stringify({fixture:'260 broad controls, Leader-only H250, no holdings',provider_requests:metrics.requests,
    d1_calls:callsBefore,sql_statements:statementsBefore,fenced_statements:metrics.database.statements,
    workers_free_gate:statementsBefore<=45?'PASS_WITH_HEADROOM':'NOT_READY'}));
  db.close();
}));
