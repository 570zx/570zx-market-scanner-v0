// End to end through the Worker entry point: console login against a fake
// Robinhood that serves the real 73-tool catalog and response envelopes, then
// consecutive cron minutes. Every D1 statement and every outbound request is
// counted against the Workers Free per-invocation limits (50 each).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{ensurePaperSchema} from '../src/index.ts';
import {ensureCapacitySchema,CAPACITY_VERSION} from '../src/leader-capacity.ts';
import {D1,fakeRobinhood,TOOLS} from './live-fakes.mjs';

// Tool names exactly as Robinhood's Agentic MCP listed them on 2026-09-29.
const ROBINHOOD_TOOL_NAMES=['add_option_to_watchlist','add_to_watchlist','cancel_crypto_order','cancel_equity_order','cancel_option_exercise','cancel_option_order',
  'create_alert','create_scan','create_watchlist','delete_alert','exercise_option','follow_watchlist','get_accounts','get_alert_log','get_alerts',
  'get_crypto_account_onboarding_info','get_crypto_orders','get_crypto_positions','get_crypto_quotes','get_currency_pairs','get_earnings_calendar',
  'get_earnings_results','get_equity_fundamentals','get_equity_historicals','get_equity_news','get_equity_orders','get_equity_positions','get_equity_price_book',
  'get_equity_quotes','get_equity_tax_lots','get_equity_technical_indicators','get_equity_tradability','get_financials','get_index_historicals','get_index_quotes',
  'get_indexes','get_limited_margin_upgrade_info','get_option_chains','get_option_historicals','get_option_instruments','get_option_level_upgrade_info',
  'get_option_orders','get_option_positions','get_option_quotes','get_option_watchlist','get_pnl_trade_history','get_popular_watchlists','get_portfolio',
  'get_realized_pnl','get_scanner_filter_specs','get_scans','get_sec_filing','get_sec_filing_facts','get_sec_filing_facts_catalog','get_sec_filing_index',
  'get_watchlist_items','get_watchlists','mark_alerts_read','place_crypto_order','place_equity_order','place_option_order','preview_crypto_order',
  'remove_from_watchlist','remove_option_from_watchlist','review_equity_order','review_option_order','run_scan','search','unfollow_watchlist','update_alert',
  'update_scan_config','update_scan_filters','update_watchlist'];
const byName=new Map(TOOLS.map(t=>[t.name,t]));
const CATALOG=ROBINHOOD_TOOL_NAMES.map(name=>byName.get(name)??{name,description:'Robinhood tool '+name,
  inputSchema:{type:'object',properties:{account_number:{type:'string'},symbol:{type:'string'},cursor:{type:'string'}}}});

async function clocked(fn,time){
  const NativeDate=Date,oldFetch=globalThis.fetch;let clock=NativeDate.parse(time);
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
  try{return await fn(ms=>{clock+=ms;});}finally{globalThis.Date=NativeDate;globalThis.fetch=oldFetch;}
}
async function setup(){
  const MEDS_DB=new D1();
  for(const m of ['0001_init.sql','0002_operations.sql','0003_tick_counter.sql','0004_autonomous.sql'])MEDS_DB.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  const env={MEDS_DB,TRADING_MODE:'shadow',SCOUT_ENABLED:'true',ADMIN_TOKEN:'t'.repeat(40),ALPACA_API_KEY:'fixture',ALPACA_API_SECRET:'fixture',
    ALERT_WEBHOOK_URL:'https://hooks.example.test/meds'};
  await ensurePaperSchema(env);await ensureCapacitySchema(MEDS_DB);env.LEADER_ONLY='true';env.PAPER_ENABLED='false';
  for(const m of ['0010_broker_boundary.sql','0011_broker_observation.sql','0013_live_execution.sql'])MEDS_DB.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  return {env,db:MEDS_DB};
}
const paperPosition=(db,symbol,price)=>db.db.prepare(`INSERT INTO hunt_account_positions(account_id,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,
  entry_score,entry_day_change_pct,opened_phase,features,status,version,remaining_qty,locked_realized_pnl,take200_done) VALUES('H250',?,?,?,?,?,?,?,?,?,60,5,'regular','{}','open',?,?,0,0)`)
  .run(symbol,new Date().toISOString(),price,10/price,10,price*.95,price*3,price,price,CAPACITY_VERSION,10/price);
function audit(db,rows){
  const bucket=new Date(Date.now()+30_000).toISOString(),decided=new Date(Date.now()+30_000).toISOString();
  db.db.prepare('INSERT INTO leader_cycle_audit(bucket,created_at,version,payload) VALUES(?,?,?,?)').run(bucket,bucket,CAPACITY_VERSION,
    JSON.stringify({live_mirror:rows.map(r=>({bucket,decided_at:decided,strategy_version:CAPACITY_VERSION,fraction:null,paper_notional:10,paper_price:null,reason:'paper',...r,request_id:`${bucket}|${r.action}|${r.symbol}`}))}));
}

test('end to end: console login with 73 tools, then live minutes stay inside the Free plan limits and trade correctly',t=>clocked(async(advance)=>{
  const {env,db}=await setup();
  const rh=fakeRobinhood({origin:'https://agent.robinhood.com',tools:CATALOG});
  let subrequests=0;const webhooks=[];
  globalThis.fetch=async(input,init={})=>{
    subrequests++;
    const url=String(input instanceof Request?input.url:input);
    if(url.startsWith('https://hooks.example.test/')){webhooks.push(JSON.parse(init.body).text??JSON.parse(init.body).content);return new Response(null,{status:204});}
    return rh.fetchImpl(url,init);
  };
  const call=(path,init)=>worker.fetch(new Request('https://meds.test'+path,init),env);
  const form=f=>({method:'POST',body:new URLSearchParams(f)});
  const cron=async()=>{const waits=[];await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},env,{waitUntil:p=>waits.push(p)});return (await Promise.all(waits))[0];};
  const measure=async fn=>{db.queries=0;subrequests=0;const r=await fn();return {r,queries:db.queries,subrequests};};

  // Login from the console.
  const start=await call('/live',form({admin_token:env.ADMIN_TOKEN,action:'start_login'}));
  assert.equal(start.status,303);
  const auth=new URL(start.headers.get('location'));
  rh.s.challenge=auth.searchParams.get('code_challenge');
  const login=await measure(async()=>(await call('/live',form({admin_token:env.ADMIN_TOKEN,action:'finish_login',
    callback:`http://localhost:8765/callback?code=code-xyz&state=${auth.searchParams.get('state')}`}))).text());
  assert.match(login.r,/Connected to Robinhood\.<\/b> 73 tools found\. Everything MEDS needs to trade is available\./);
  t.diagnostic(JSON.stringify({step:'finish login',queries:login.queries,subrequests:login.subrequests}));
  assert.ok(login.queries<=25&&login.subrequests<=20,JSON.stringify(login));
  const tools=await (await call('/status/broker/tools')).json();
  assert.equal(tools.count,73);assert.equal(tools.capabilities.can_trade,true);assert.deepEqual(tools.capabilities.time_in_force_options,['gfd','gtc','ioc']);
  assert.match(await (await call('/live',form({admin_token:env.ADMIN_TOKEN,action:'enable'}))).text(),/Live trading is ON/);

  // 11:01 ET: first live minute starts the mirror from now and syncs.
  advance(60_000);
  const first=await measure(cron);
  assert.equal(first.r.ok,true,JSON.stringify(first.r));assert.equal(first.r.state,'LIVE');
  assert.deepEqual(first.r.unmanaged.sort(),['CLOV','OBIO'],'positions opened elsewhere are never managed');

  // The paper cycle commits three entries.
  rh.s.quotes={AAA:{bid:1.99,ask:2.00},BBB:{bid:2.99,ask:3.00},CCC:{bid:0.90,ask:0.901},DDD:{bid:3.99,ask:4.00},EEE:{bid:0.99,ask:1.00}};
  for(const [s,p] of [['AAA',2],['BBB',3],['CCC',0.901]])paperPosition(db,s,p);
  audit(db,[{symbol:'AAA',action:'ENTRY',paper_price:2.00},{symbol:'BBB',action:'ENTRY',paper_price:3.00},{symbol:'CCC',action:'ENTRY',paper_price:0.901}]);
  advance(60_000);
  const buys=await measure(cron);
  assert.equal(buys.r.ok,true,JSON.stringify(buys.r));
  assert.equal(buys.r.orders_submitted,3);assert.equal(buys.r.fills,3);
  t.diagnostic(JSON.stringify({step:'three buys',queries:buys.queries,subrequests:buys.subrequests}));
  assert.ok(buys.queries<=40&&buys.subrequests<=40,JSON.stringify(buys));
  const placed=rh.s.calls.filter(c=>c[0]==='place_equity_order').map(c=>c[1]);
  assert.deepEqual(placed.map(a=>[a.symbol,a.side,a.type,a.quantity,a.limit_price,a.time_in_force,a.market_hours,a.account_number]),
    [['AAA','buy','limit','5','2.02','ioc','regular_hours','5QR11111'],['BBB','buy','limit','3','3.03','ioc','regular_hours','5QR11111'],['CCC','buy','limit','13','0.9101','ioc','regular_hours','5QR11111']]);

  // The paper cycle exits AAA, takes half of BBB, and enters DDD and EEE.
  rh.s.quotes.AAA={bid:2.10,ask:2.11};
  db.db.prepare("UPDATE hunt_account_positions SET status='closed' WHERE symbol='AAA'").run();
  for(const [s,p] of [['DDD',4],['EEE',1]])paperPosition(db,s,p);
  audit(db,[{symbol:'AAA',action:'EXIT_ALL',fraction:1},{symbol:'BBB',action:'EXIT_FRACTION',fraction:0.5},
    {symbol:'DDD',action:'ENTRY',paper_price:4.00},{symbol:'EEE',action:'ENTRY',paper_price:1.00}]);
  advance(60_000);
  const busy=await measure(cron);
  assert.equal(busy.r.ok,true,JSON.stringify(busy.r));
  t.diagnostic(JSON.stringify({step:'two exits and a buy (busiest minute)',queries:busy.queries,subrequests:busy.subrequests}));
  assert.ok(busy.queries<=40&&busy.subrequests<=40,JSON.stringify(busy));
  assert.equal(busy.r.orders_submitted,3,'three orders per minute; EEE waits');
  advance(60_000);
  const last=await measure(cron);
  assert.equal(last.r.orders_submitted,1);

  const detail=await (await call('/control/live/detail',{headers:{authorization:'Bearer '+env.ADMIN_TOKEN}})).json();
  const owned=Object.fromEntries(detail.owned.map(o=>[o.symbol,[o.quantity,o.realized_pnl]]));
  assert.deepEqual(owned,{
    AAA:['0.00000000','0.49000000'],   // 5 @ 2.00 -> 5 @ 2.10, 0.01 fee
    BBB:['2.00000000','-0.02000000'],  // sold 1 of 3 @ 2.99, 0.01 fee
    CCC:['13.00000000','0.00000000'],DDD:['2.00000000','0.00000000'],EEE:['11.00000000','0.00000000']}); // floor(12/1.01)
  const heldAtRobinhood=Object.fromEntries([...rh.s.positions].filter(([,q])=>q>0));
  assert.deepEqual(heldAtRobinhood,{OBIO:3,CLOV:12,BBB:2,CCC:13,DDD:2,EEE:11},'Robinhood agrees; other holdings untouched');
  assert.equal(detail.reconciliation_detail.state,'MATCH');
  assert.deepEqual(webhooks,[
    'MEDS live bought 5 AAA @ 2.0000\nMEDS live bought 3 BBB @ 3.0000\nMEDS live bought 13 CCC @ 0.9010',
    'MEDS live sold 5 AAA @ 2.1000\nMEDS live sold 1 BBB @ 2.9900\nMEDS live bought 2 DDD @ 4.0000',
    'MEDS live bought 11 EEE @ 1.0000'],'one webhook message per trading minute');

  // 11:05 ET is a paper minute; the paper cycle fails here (no Alpaca in this test).
  advance(60_000);
  const syncedBefore=db.db.prepare('SELECT synced_at FROM live_sync').get().synced_at;
  await cron();
  assert.equal(db.db.prepare('SELECT synced_at FROM live_sync').get().synced_at,syncedBefore,'no live step on a paper minute');
  // 11:06 ET: the live step still runs while the paper cycle is failing.
  advance(60_000);
  const after=await cron();
  assert.equal(after.ok,true,JSON.stringify(after));
  assert.equal(db.db.prepare('SELECT synced_at FROM live_sync').get().synced_at,new Date().toISOString());
  // Outside the regular session the live step runs every ten minutes.
  advance(6*3600_000); // 17:06 ET
  assert.match((await cron()).skipped,/every ten minutes/);
},'2026-10-01T15:00:00Z'));
