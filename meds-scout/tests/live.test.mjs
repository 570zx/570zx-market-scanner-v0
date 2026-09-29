import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runLiveStep,mirrorRequestsFromPlan,roundUpTick,roundDownTick,refIdFor,setLiveEnabled,setLiveLimits,clearLiveHalt,liveStatus,publicError,LIVE_SCHEMA} from '../src/live-execution.ts';
import {ROBINHOOD_SCHEMA,seal,unseal,vaultKey,pkcePair,parseCallback,parseSse,readSse,toolResult,startLogin,finishLogin,RobinhoodSession,loadToolCatalog,connectionStatus,timingSafeEqual,shapeOf} from '../src/robinhood-mcp.ts';
import {RobinhoodAgenticBroker,NotSent,OrderRejected,resolveTools,toolCapabilities,normalizeAccount,normalizePositions,normalizeQuotes,normalizeOrderResult,normalizeOrders,mapOrderState} from '../src/robinhood-broker.ts';
import {liveDb,fakeRobinhood,TOOLS,GUIDE} from './live-fakes.mjs';

// ---------------------------------------------------------------- fake broker (Robinhood-like: orders carry no client reference)

class FakeBroker {
  constructor(clock,{supportsIoc=true}={}){this.clock=clock;this.supportsIoc=supportsIoc;this.canLookupOrder=false;this.buyingPower=250;this.pos=new Map();this.available=new Map();
    this.quotesMap=new Map();this.quoteAge=new Map();this.orders=new Map();this.foreign=[];this.placed=[];this.cancels=[];this.fillMode='full';this.hideFromRecent=false;
    this.failNextPlace=null;this.dropNextPlace=null;this.hideEverywhere=false;this.toolErrorNext=null;this.notSentNext=false;this.accountError=null;this.seq=0;this.calls=0;this.onCall=null;this.lookups=[];}
  iso(){return this.clock.now().toISOString();}
  tick(){this.calls++;this.onCall?.(this.calls);}
  async account(){this.tick();if(this.accountError){const e=this.accountError;this.accountError=null;throw new Error(e);}return {accountId:'AGENT1',cash:this.buyingPower,buyingPower:this.buyingPower,equity:this.buyingPower};}
  async positions(){this.tick();return [...this.pos].filter(([,q])=>q>0).map(([symbol,quantity])=>({symbol,quantity,available:this.available.get(symbol)??quantity,averagePrice:null}));}
  async quotes(symbols){this.tick();return new Map(symbols.filter(s=>this.quotesMap.has(s)).map(s=>[s,{symbol:s,...this.quotesMap.get(s),
    asOf:new Date(this.clock.now().getTime()-(this.quoteAge.get(s)??0)).toISOString()}]));}
  fill(order,qty,px){
    order.executions.push({id:order.id+'-x'+order.executions.length,quantity:qty,price:px,fee:0,at:this.iso()});
    order.filledQuantity+=qty;order.averagePrice=px;
    order.state=order.filledQuantity>=order.quantity-1e-9?'FILLED':'PARTIALLY_FILLED';order.rawState=order.state.toLowerCase();
    const q=this.pos.get(order.symbol)??0;this.pos.set(order.symbol,order.side==='BUY'?q+qty:q-qty);
    this.buyingPower+=order.side==='BUY'?-qty*px:qty*px;
  }
  async placeLimit(o){
    this.tick();
    if(this.notSentNext){this.notSentNext=false;throw new NotSent('SUBREQUEST_BUDGET');}
    if(this.toolErrorNext){const t=this.toolErrorNext;this.toolErrorNext=null;throw new OrderRejected(t,'maybe');}
    if(this.dropNextPlace){const e=this.dropNextPlace;this.dropNextPlace=null;throw e;} // the request never reached Robinhood
    this.placed.push(o);
    const id='ord-'+(++this.seq),q=this.quotesMap.get(o.symbol);
    const order={id,refId:null,symbol:o.symbol,side:o.side,orderType:'limit',state:'SUBMITTED',rawState:'queued',quantity:o.quantity,filledQuantity:0,averagePrice:null,
      limitPrice:o.limitPrice,fees:0,createdAt:this.iso(),updatedAt:this.iso(),executions:[],rejectReason:null,placedAgent:'agent'};
    this.orders.set(id,order);
    if(this.fillMode==='full')this.fill(order,o.quantity,o.side==='BUY'?Math.min(o.limitPrice,q.ask):Math.max(o.limitPrice,q.bid));
    else if(this.fillMode==='reject'){order.state='REJECTED';order.rawState='rejected';order.rejectReason='insufficient buying power';}
    else if(o.timeInForce==='ioc'){order.state='CANCELED';order.rawState='cancelled';}
    if(this.failNextPlace){const e=this.failNextPlace;this.failNextPlace=null;throw e;}
    return structuredClone(order);
  }
  async order(){return null;}
  async recentOrders(){this.tick();return this.hideFromRecent||this.hideEverywhere?[]:[...this.orders.values(),...this.foreign].map(o=>structuredClone(o));}
  async ordersFor(symbol){this.tick();this.lookups.push(symbol);return this.hideEverywhere?[]:[...this.orders.values(),...this.foreign].filter(o=>o.symbol===symbol).map(o=>structuredClone(o));}
  async cancel(id){this.tick();this.cancels.push(id);const o=this.orders.get(id);if(o&&['SUBMITTED','PARTIALLY_FILLED'].includes(o.state)){o.state='CANCELED';o.rawState='cancelled';}}
}

function harness({ioc=true,phase='regular'}={}){
  const d1=liveDb();let t=Date.parse('2026-10-01T15:00:00Z');
  const clock={now:()=>new Date(t),advance:ms=>{t+=ms;}};
  const broker=new FakeBroker(clock,{supportsIoc:ioc});
  const h={d1,clock,broker,alerts:[],paperOpen:new Set(),connected:true,halted:false,phase,connectError:null,bucketSeq:0};
  h.deps=()=>({db:d1,now:clock.now,phase:h.phase,sessionDate:'2026-10-01',scoutEnabled:!h.halted,paperOpenSymbols:async()=>new Set(h.paperOpen),
    connect:async()=>{if(h.connectError)throw new Error(h.connectError);return h.connected?broker:null;},
    notify:async(text,key)=>{h.alerts.push({text,key});},sleep:async ms=>clock.advance(ms)});
  h.step=()=>runLiveStep(h.deps());
  h.audit=rows=>{const bucket=new Date(clock.now().getTime()+(++h.bucketSeq)).toISOString();
    d1.db.prepare('INSERT INTO leader_cycle_audit(bucket,created_at,version,payload) VALUES(?,?,?,?)').run(bucket,bucket,'v',JSON.stringify({live_mirror:rows.map(r=>({bucket,decided_at:clock.now().toISOString(),...r,request_id:`${bucket}|${r.action}|${r.symbol}`}))}));
    for(const r of rows)if(r.action==='ENTRY')h.paperOpen.add(r.symbol);else if(r.action==='EXIT_ALL')h.paperOpen.delete(r.symbol);};
  h.row=(sql,...a)=>{const r=d1.db.prepare(sql).get(...a);return r?{...r}:r;};
  h.rows=(sql,...a)=>d1.db.prepare(sql).all(...a).map(r=>({...r}));
  h.text=()=>h.alerts.map(a=>a.text).join('\n');
  return h;
}
const entry=(symbol,{price=2}={})=>({strategy_version:'leader-hunt-v8.6-exit-liquidity',symbol,action:'ENTRY',fraction:null,paper_notional:10,paper_price:price,reason:'paper_entry'});
const exitAll=symbol=>({strategy_version:'leader-hunt-v8.6-exit-liquidity',symbol,action:'EXIT_ALL',fraction:1,paper_notional:null,paper_price:null,reason:'stop'});
const exitPart=(symbol,fraction)=>({strategy_version:'leader-hunt-v8.6-exit-liquidity',symbol,action:'EXIT_FRACTION',fraction,paper_notional:null,paper_price:null,reason:'TAKE_200'});
async function ready(h,{enabled=true}={}){await h.step();if(enabled)await setLiveEnabled(h.d1,true);h.clock.advance(60_000);}
async function buy(h,symbol,{bid=1.99,ask=2.00}={}){h.broker.quotesMap.set(symbol,{bid,ask});h.audit([entry(symbol,{price:ask})]);const r=await h.step();h.clock.advance(60_000);return r;}

// ---------------------------------------------------------------- schema and pure helpers

test('migration 0013 creates exactly the tables and triggers the code defines',()=>{
  const a=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');
  a.exec(readFileSync(new URL('../migrations/0013_live_execution.sql',import.meta.url),'utf8'));
  for(const s of [...ROBINHOOD_SCHEMA,...LIVE_SCHEMA])b.exec(s);
  const dump=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.type+':'+r.name+':'+String(r.sql).replace(/\s+/g,' '));
  assert.deepEqual(dump(a),dump(b));
  assert.ok(dump(a).some(x=>x.startsWith('trigger:live_fence_v1')));
  assert.equal(a.prepare('SELECT enabled FROM live_control').get().enabled,0,'live starts OFF');
});

test('price ticks round in the safe direction',()=>{
  assert.equal(roundUpTick(2.0001),2.01);assert.equal(roundUpTick(2.02),2.02);assert.equal(roundDownTick(2.156),2.15);
  assert.equal(roundUpTick(0.51234),0.5124);assert.equal(roundDownTick(0.51239),0.5123);
});

test('outbox mirrors entries, full exits, liquidity-limited exits (as full) and genuine partial exits; never options',()=>{
  const plan={
    positions:[
      {id:1,kind:'equity',symbol:'AAA',status:'closed',remaining_qty:0},
      {id:2,kind:'equity',symbol:'BBB',status:'open',remaining_qty:7.5},
      {id:3,kind:'equity',symbol:'CCC',status:'open',remaining_qty:4},
      {id:4,kind:'option',symbol:'OPT',status:'closed',remaining_qty:0},
      {id:5,kind:'equity',symbol:'EEE',status:'open',remaining_qty:6},
    ],
    newPositions:[{kind:'equity',symbol:'DDD',entry_notional:9.5,entry_price:3.1},{kind:'option',symbol:'X260925C1',underlying:'X',entry_notional:20,entry_price:.2}],
    trades:[{id:1,kind:'equity',exit_reason:'stop',exit_price:1.9},{id:4,kind:'option',exit_reason:'time',exit_price:.1}],
    events:[{kind:'equity',position_id:2,event_type:'TAKE_200',price:2.5},
      {kind:'equity',position_id:5,event_type:'PARTIAL_EXIT_2026-10-01T15:00:00.000Z',price:1.5,details:JSON.stringify({reason:'stop',liquidity_limited:true})}],
  };
  const before=new Map([['equity:1',4],['equity:2',10],['equity:3',4],['equity:4',1],['equity:5',10]]);
  const rows=mirrorRequestsFromPlan(plan,before,'B','T','v');
  assert.deepEqual(rows.map(r=>[r.action,r.symbol,r.fraction,r.reason]),
    [['EXIT_ALL','AAA',1,'stop'],['EXIT_FRACTION','BBB',.25,'TAKE_200'],['EXIT_ALL','EEE',1,'stop'],['ENTRY','DDD',null,'paper_entry']]);
  assert.equal(rows[3].paper_notional,9.5);assert.equal(rows[3].paper_price,3.1);
});

// ---------------------------------------------------------------- live step

test('first run never replays history; a new paper entry becomes one IOC limit buy sized to the per-order limit',async()=>{
  const h=harness();
  h.audit([entry('OLD')]);
  await ready(h);
  assert.equal(h.broker.placed.length,0,'history before the first run is never traded');
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.audit([entry('AAA',{price:2.00})]);
  const r=await h.step();
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(h.broker.placed.length,1);
  const o=h.broker.placed[0];
  assert.deepEqual({side:o.side,qty:o.quantity,limit:o.limitPrice,tif:o.timeInForce},{side:'BUY',qty:5,limit:2.02,tif:'ioc'},'floor($12 / 2.02) = 5 shares');
  assert.match(o.refId,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(h.row("SELECT quantity,cost_basis FROM live_positions WHERE symbol='AAA'"),{quantity:'5.00000000',cost_basis:'10.00000000'});
  assert.equal(h.row("SELECT state FROM broker_order_intents").state,'FILLED');
  assert.equal(h.row("SELECT state FROM live_mirror_requests WHERE symbol='AAA'").state,'ORDERED');
  assert.match(h.text(),/bought 5 AAA @ 2\.0000/);
  assert.equal(h.alerts.length,1,'one webhook message per run');
  await h.step();assert.equal(h.broker.placed.length,1,'nothing is re-sent');
});

test('live OFF skips new buys but still exits what MEDS bought',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  await setLiveEnabled(h.d1,false);
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5})]);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='BBB'").detail,'LIVE_DISABLED');
  h.broker.quotesMap.set('AAA',{bid:2.20,ask:2.21});h.audit([exitAll('AAA')]);await h.step();
  const sell=h.broker.placed.at(-1);
  assert.deepEqual({side:sell.side,qty:sell.quantity,limit:sell.limitPrice},{side:'SELL',qty:5,limit:2.15});
  assert.deepEqual(h.row("SELECT quantity,cost_basis,realized_pnl FROM live_positions WHERE symbol='AAA'"),
    {quantity:'0.00000000',cost_basis:'0.00000000',realized_pnl:'1.00000000'},'sold 5 @ 2.20 against 10.00 cost');
});

test('partial exits sell whole shares only; below one share is skipped',async()=>{
  const h=harness();await ready(h);
  await setLiveLimits(h.d1,{max_order_notional:25});
  await buy(h,'AAA');
  assert.equal(h.row("SELECT quantity FROM live_positions").quantity,'12.00000000','floor(25/2.02)');
  h.audit([exitPart('AAA',.25)]);await h.step();
  assert.equal(h.broker.placed.at(-1).quantity,3,'floor(12*0.25)');
  h.clock.advance(60_000);h.audit([exitPart('AAA',.05)]);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE action='EXIT_FRACTION' ORDER BY decided_at DESC").detail,'FRACTION_BELOW_ONE_SHARE');
});

test('entries are skipped when price ran, spread is wide, quote is stale, capital is used up, or the decision is stale',async()=>{
  const h=harness();await ready(h);
  await setLiveLimits(h.d1,{max_capital:5});
  h.broker.quotesMap.set('RUN',{bid:2.09,ask:2.10});
  h.broker.quotesMap.set('WIDE',{bid:1.80,ask:2.00});
  h.broker.quotesMap.set('OLDQ',{bid:1.99,ask:2.00});h.broker.quoteAge.set('OLDQ',150_000);
  h.broker.quotesMap.set('OK1',{bid:1.99,ask:2.00});
  h.broker.quotesMap.set('OK2',{bid:1.99,ask:2.00});
  h.audit([entry('RUN'),entry('WIDE'),entry('OLDQ'),entry('OK1'),entry('OK2')]);
  await h.step();
  const detail=s=>h.row('SELECT state,detail FROM live_mirror_requests WHERE symbol=?',s);
  assert.equal(detail('RUN').detail,'PRICE_MOVED_AWAY');
  assert.equal(detail('WIDE').detail,'SPREAD_TOO_WIDE');
  assert.equal(detail('OLDQ').detail,'LIVE_QUOTE_STALE');
  assert.equal(detail('OK1').state,'ORDERED');
  assert.equal(h.broker.placed[0].quantity,2,'max capital 5 allows 2 shares at 2.02');
  assert.equal(detail('OK2').detail,'MAX_CAPITAL_REACHED');
  h.broker.quotesMap.set('LATE',{bid:1.99,ask:2.00});
  h.audit([entry('LATE')]);h.clock.advance(181_000);await h.step();
  assert.deepEqual(detail('LATE'),{state:'EXPIRED',detail:'REQUEST_TOO_OLD'});
});

test('a lost submit response is matched in the order list (never re-sent); a ChatGPT market order is never mistaken for it',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.broker.failNextPlace=new Error('network timeout');
  h.broker.foreign.push({id:'chatgpt-1',refId:null,symbol:'AAA',side:'BUY',orderType:'market',state:'FILLED',rawState:'filled',quantity:5,filledQuantity:5,
    averagePrice:2,limitPrice:null,fees:0,createdAt:h.clock.now().toISOString(),updatedAt:null,executions:[{id:'cg-x',quantity:5,price:2,fee:0,at:null}],rejectReason:null,placedAgent:'chatgpt'});
  h.audit([entry('AAA')]);
  const r=await h.step();
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'UNKNOWN');
  h.clock.advance(30_000);h.audit([entry('AAA')]);await h.step();
  assert.equal(h.broker.placed.length,1,'never re-sent, and the symbol is not bought twice');
  assert.deepEqual(h.row('SELECT state,broker_order_id FROM broker_order_intents'),{state:'FILLED',broker_order_id:'ord-1'});
  assert.equal(h.row("SELECT quantity FROM live_positions WHERE symbol='AAA'").quantity,'5.00000000','only MEDS\'s own 5 shares');
});

test('an ambiguous match is never guessed: the order stays unresolved',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.broker.failNextPlace=new Error('network timeout');
  h.broker.foreign.push({id:'twin',refId:null,symbol:'AAA',side:'BUY',orderType:'limit',state:'FILLED',rawState:'filled',quantity:5,filledQuantity:5,
    averagePrice:2,limitPrice:2.02,fees:0,createdAt:h.clock.now().toISOString(),updatedAt:null,executions:[],rejectReason:null,placedAgent:'chatgpt'});
  h.audit([entry('AAA')]);await h.step();
  h.clock.advance(30_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'UNKNOWN');
  assert.equal(h.row('SELECT COUNT(*) n FROM live_positions').n,0);
  h.clock.advance(4*60_000);await h.step();
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents'),{state:'CANCELED',last_error:'UNRESOLVED_BUY'});
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,'UNRESOLVED_ORDER:BUY AAA');
  assert.match(h.text(),/more than one Robinhood order matches it/);
});

test('a buy that cannot be found after three minutes is released and new buys halt for a check',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.broker.dropNextPlace=new Error('socket hang up');
  h.audit([entry('AAA')]);await h.step();
  h.clock.advance(30_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'UNKNOWN');
  assert.deepEqual(h.broker.lookups,['AAA'],'looked up by symbol before giving up');
  h.clock.advance(4*60_000);await h.step();
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents'),{state:'CANCELED',last_error:'UNRESOLVED_BUY'});
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,'UNRESOLVED_ORDER:BUY AAA');
  assert.match(h.text(),/cannot be found in Robinhood's order history/);
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5})]);h.clock.advance(60_000);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='BBB'").detail,'HALTED');
});

test('reviewer scenario: a lost sell with another agent\'s shares in the same stock never sells shares twice',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  h.broker.pos.set('AAA',15); // another agent bought 10 AAA after MEDS
  h.broker.quotesMap.set('AAA',{bid:2.10,ask:2.11});
  h.broker.failNextPlace=new Error('network timeout'); // the sell executes, its response is lost
  h.audit([exitAll('AAA')]);await h.step();
  assert.equal(h.broker.pos.get('AAA'),10);
  h.broker.hideEverywhere=true; // and it can never be found again
  for(let i=0;i<5;i++){h.clock.advance(60_000);await h.step();}
  assert.equal(h.broker.placed.filter(o=>o.side==='SELL').length,1,'exactly one sell was ever sent');
  assert.equal(h.broker.pos.get('AAA'),10,'the other agent\'s 10 shares are untouched');
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents WHERE side=\'SELL\''),{state:'CANCELED',last_error:'UNRESOLVED_ASSUMED_SOLD'});
  assert.equal(h.row("SELECT quantity FROM live_positions WHERE symbol='AAA'").quantity,'0.00000000');
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,'UNRESOLVED_ORDER:SELL AAA');
  assert.match(h.text(),/assumes it sold and stopped counting those shares/);
});

test('a lost order pushed off the first page of the order list is found by symbol',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.broker.failNextPlace=new Error('network timeout');h.broker.hideFromRecent=true;
  h.audit([entry('AAA')]);await h.step();
  h.clock.advance(30_000);await h.step();
  assert.deepEqual(h.row('SELECT state,broker_order_id FROM broker_order_intents'),{state:'FILLED',broker_order_id:'ord-1'});
  assert.equal(h.row("SELECT quantity FROM live_positions WHERE symbol='AAA'").quantity,'5.00000000');
});

test('MEDS never buys a stock the account already holds another way',async()=>{
  const h=harness();await ready(h);
  h.broker.pos.set('CLOV',12);h.broker.quotesMap.set('CLOV',{bid:1.99,ask:2.00});
  h.audit([entry('CLOV')]);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='CLOV'").detail,'SYMBOL_HELD_OUTSIDE_MEDS');
  assert.equal(h.broker.placed.length,0);
});

test('a rejected order is recorded and alerted, and creates no position',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.broker.fillMode='reject';
  h.audit([entry('AAA')]);await h.step();
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents'),{state:'REJECTED',last_error:'insufficient buying power'});
  assert.equal(h.row('SELECT COUNT(*) n FROM live_positions').n,0);
  assert.match(h.text(),/rejected \(insufficient buying power\)/);
});

test('a tool error on place is alerted at once, checked against the order list, then written off quietly',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.broker.toolErrorNext='Order could not be placed';
  h.audit([entry('AAA')]);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'UNKNOWN','it may still exist at Robinhood');
  assert.match(h.text(),/not accepted \(ORDER_REJECTED:Order could not be placed\)/);
  const before=h.alerts.length;
  h.clock.advance(4*60_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'CANCELED');
  assert.match(h.row('SELECT last_error FROM broker_order_intents').last_error,/^ORDER_REJECTED/);
  assert.ok(!h.alerts.slice(before).some(a=>/unresolved/.test(a.text)),'no second alert for the same order');
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,null,'an explicit refusal with no order found does not halt');
});

test('an order refused locally (budget) is never sent and its paper decision is retried next minute',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.broker.notSentNext=true;
  h.audit([entry('AAA')]);await h.step();
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents'),{state:'CANCELED',last_error:'NOT_SENT:NOT_SENT:SUBREQUEST_BUDGET'});
  assert.deepEqual(h.row("SELECT state,detail FROM live_mirror_requests WHERE symbol='AAA'"),{state:'NEW',detail:'RETRY_NOT_SENT'});
  h.clock.advance(60_000);await h.step();
  assert.equal(h.broker.placed.length,1);
  assert.equal(h.row("SELECT quantity FROM live_positions").quantity,'5.00000000');
});

test('two consecutive reconciliation shortfalls halt new buys; exits still run; clearing accepts Robinhood\'s counts',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  h.broker.pos.set('AAA',1); // someone sold 4 of MEDS's 5 shares
  await h.step();
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,null,'one lagging snapshot never halts');
  h.clock.advance(60_000);await h.step();
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,'RECONCILIATION_MISMATCH:AAA');
  assert.match(h.text(),/HALTED new buys/);
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5})]);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='BBB'").detail,'HALTED');
  h.clock.advance(60_000);h.audit([exitAll('AAA')]);await h.step();
  assert.deepEqual({side:h.broker.placed.at(-1).side,qty:h.broker.placed.at(-1).quantity},{side:'SELL',qty:1},'sells only what Robinhood holds');
  h.clock.advance(60_000);await h.step(); // sync sees 0 shares
  assert.deepEqual(await clearLiveHalt(h.d1,h.clock.now()),['AAA']);
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,null);
  assert.equal(h.row("SELECT quantity FROM live_positions WHERE symbol='AAA'").quantity,'0.00000000');
  h.clock.advance(60_000);const r=await h.step();
  assert.deepEqual(r.mismatches,[]);
});

test('daily loss limit blocks new buys for the day and alerts once',async()=>{
  const h=harness();await ready(h);
  await setLiveLimits(h.d1,{max_order_notional:60,max_capital:100});
  await buy(h,'AAA');
  assert.equal(h.row("SELECT quantity FROM live_positions").quantity,'29.00000000');
  h.broker.quotesMap.set('AAA',{bid:1.30,ask:1.31});await h.step();
  assert.equal((await liveStatus(h.d1,false)).buys_blocked,'DAILY_LOSS_LIMIT');
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5})]);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='BBB'").detail,'DAILY_LOSS_LIMIT');
  assert.equal(h.alerts.filter(a=>a.text.includes('daily loss limit')).length,1);
});

test('a missing quote is not a gain or a loss: the daily limit waits for a complete valuation',async()=>{
  const h=harness();await ready(h);
  await setLiveLimits(h.d1,{daily_loss_limit:3});
  await buy(h,'AAA');await buy(h,'BBB');
  h.broker.quotesMap.delete('AAA');h.broker.quotesMap.set('BBB',{bid:1.00,ask:1.01});await h.step();
  assert.equal((await liveStatus(h.d1,false)).buys_blocked,null,'AAA unpriced: no measurement');
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.clock.advance(60_000);await h.step();
  assert.equal((await liveStatus(h.d1,false)).buys_blocked,'DAILY_LOSS_LIMIT');
});

test('after a failed run, exits still run but new buys wait for a clean run',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  h.broker.accountError='portfolio unavailable';
  const failed=await h.step();assert.equal(failed.ok,false);
  assert.match(h.text(),/MEDS live error: portfolio unavailable/);
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5}),exitAll('AAA')]);
  h.clock.advance(60_000);await h.step();
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='BBB'").detail,'PREVIOUS_RUN_FAILED');
  assert.equal(h.broker.placed.at(-1).side,'SELL');
});

test('a run that lost its lease cannot write or place anything',async()=>{
  const h=harness();await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.audit([entry('AAA')]);
  const base=h.broker.calls; // account, positions, quotes: the lease is lost before any order is written
  h.broker.onCall=n=>{if(n===base+3)h.d1.db.prepare("UPDATE live_control SET lease_owner='other-run'").run();};
  const r=await h.step();
  assert.equal(r.ok,false);assert.match(r.error,/lease lost/);
  assert.equal(h.broker.placed.length,0);
  assert.equal(h.row('SELECT COUNT(*) n FROM broker_order_intents').n,0);
  assert.equal(h.row("SELECT state FROM live_mirror_requests WHERE symbol='AAA'").state,'NEW');
});

test('positions the paper account no longer holds are sold (orphan convergence)',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  h.paperOpen.clear();await h.step();
  const sell=h.broker.placed.at(-1);
  assert.deepEqual({side:sell.side,qty:sell.quantity},{side:'SELL',qty:5});
  assert.ok(h.row("SELECT request_id FROM live_mirror_requests WHERE reason='orphan_no_paper_position'"));
});

test('unmanaged holdings (bought by another agent) are reported but never sold',async()=>{
  const h=harness();await ready(h);
  h.broker.pos.set('TSLA',3);h.broker.quotesMap.set('TSLA',{bid:200,ask:200.1});
  const r=await h.step();
  assert.deepEqual(r.unmanaged,['TSLA']);assert.equal(h.broker.placed.length,0);
});

test('sells never exceed Robinhood\'s shares available for sale',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');
  h.broker.available.set('AAA',2);
  h.audit([exitAll('AAA')]);await h.step();
  assert.equal(h.broker.placed.at(-1).quantity,2);
});

test('day orders are cancelled after the TTL; a halt cancels open orders and places nothing',async()=>{
  const h=harness({ioc:false});await ready(h);
  h.broker.fillMode='none';h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.audit([entry('AAA')]);await h.step();
  assert.equal(h.broker.placed[0].timeInForce,'gfd');
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'SUBMITTED');
  h.clock.advance(100_000);await h.step();
  assert.equal(h.broker.cancels.length,1);
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'CANCEL_REQUESTED');
  h.clock.advance(60_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'CANCELED');
  h.broker.quotesMap.set('BBB',{bid:4.99,ask:5.00});h.audit([entry('BBB',{price:5})]);await h.step();
  assert.equal(h.row("SELECT state FROM broker_order_intents WHERE symbol='BBB'").state,'SUBMITTED');
  h.halted=true;h.audit([entry('CCC')]);h.broker.quotesMap.set('CCC',{bid:1,ask:1.01});await h.step();
  assert.equal(h.row("SELECT state FROM broker_order_intents WHERE symbol='BBB'").state,'CANCEL_REQUESTED','halt cancels open orders');
  assert.equal(h.broker.placed.filter(o=>o.symbol==='CCC').length,0);
  assert.equal(h.row("SELECT detail FROM live_mirror_requests WHERE symbol='CCC'").detail,'ENGINE_HALTED');
});

test('a known order off the first page is still tracked by symbol; one that vanishes is released after 15 minutes with a halt',async()=>{
  const h=harness({ioc:false});await ready(h);
  h.broker.fillMode='none';h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.audit([entry('AAA')]);await h.step();
  h.broker.hideFromRecent=true;h.clock.advance(100_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'CANCEL_REQUESTED','found by symbol and cancelled after its TTL');
  h.broker.hideEverywhere=true;h.clock.advance(15*60_000);await h.step();
  assert.deepEqual(h.row('SELECT state,last_error FROM broker_order_intents'),{state:'CANCELED',last_error:'UNRESOLVED_BUY'});
  assert.match(h.text(),/no longer appears in Robinhood's order history/);
});

test('a FILLED state reported before its filled quantity catches up is polled again',async()=>{
  const h=harness({ioc:false});await ready(h);
  await setLiveLimits(h.d1,{max_order_notional:10});
  h.broker.fillMode='none';h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.audit([entry('AAA')]);await h.step();
  const order=[...h.broker.orders.values()][0];
  order.state='FILLED';order.rawState='filled';order.filledQuantity=2;order.averagePrice=2.00;
  h.clock.advance(20_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'PARTIALLY_FILLED');
  order.filledQuantity=4;
  h.clock.advance(20_000);await h.step();
  assert.equal(h.row('SELECT state FROM broker_order_intents').state,'FILLED');
  assert.equal(h.row("SELECT quantity FROM live_positions").quantity,'4.00000000');
  assert.equal(h.broker.cancels.length,0,'a filled order is never cancelled');
});

test('clear halt waits for a running live step, needs a recent sync, and only adjusts symbols that were short',async()=>{
  const h=harness();await ready(h);
  await buy(h,'AAA');await buy(h,'BBB');
  h.broker.pos.set('AAA',2);await h.step();h.clock.advance(60_000);await h.step();
  assert.equal(h.row('SELECT halted_reason FROM live_control').halted_reason,'RECONCILIATION_MISMATCH:AAA');
  h.d1.db.prepare('UPDATE live_control SET lease_owner=?,lease_until=?').run('running',Date.now()+30_000);
  await assert.rejects(()=>clearLiveHalt(h.d1,h.clock.now()),/live step is running/);
  h.d1.db.prepare('UPDATE live_control SET lease_owner=NULL,lease_until=NULL').run();
  await assert.rejects(()=>clearLiveHalt(h.d1,new Date(h.clock.now().getTime()+11*60_000)),/No successful sync/);
  assert.deepEqual(await clearLiveHalt(h.d1,h.clock.now()),['AAA']);
  assert.deepEqual(h.rows('SELECT symbol,quantity FROM live_positions ORDER BY symbol'),[{symbol:'AAA',quantity:'2.00000000'},{symbol:'BBB',quantity:'5.00000000'}]);
});

test('fills are recorded from the cumulative quantity, so a later executions list cannot double count',async()=>{
  const h=harness({ioc:false});await ready(h);
  await setLiveLimits(h.d1,{max_order_notional:10});
  h.broker.fillMode='none';h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});
  h.audit([entry('AAA')]);await h.step();
  const order=[...h.broker.orders.values()][0];
  order.filledQuantity=2;order.averagePrice=2.00;order.state='PARTIALLY_FILLED';order.rawState='partially_filled';
  h.clock.advance(20_000);await h.step();
  assert.equal(h.row("SELECT quantity FROM live_positions").quantity,'2.00000000');
  order.executions=[{id:'e1',quantity:2,price:2.00,fee:0,at:null},{id:'e2',quantity:2,price:2.02,fee:0.01,at:null}];
  order.filledQuantity=4;order.averagePrice=2.01;order.state='FILLED';order.rawState='filled';
  h.clock.advance(20_000);await h.step();
  assert.deepEqual(h.row("SELECT quantity,cost_basis FROM live_positions"),{quantity:'4.00000000',cost_basis:'8.05000000'},'2@2.00 + 2@2.02 + 0.01 fee');
  h.clock.advance(20_000);await h.step();
  assert.equal(h.rows('SELECT * FROM broker_fills').length,2);
});

test('not connected: nothing is traded and stale requests are closed out',async()=>{
  const h=harness();await ready(h);
  h.connected=false;h.audit([entry('AAA')]);h.clock.advance(200_000);
  const r=await h.step();
  assert.equal(r.state,'NOT_CONNECTED');
  assert.deepEqual(h.row("SELECT state,detail FROM live_mirror_requests"),{state:'SKIPPED',detail:'NOT_CONNECTED'});
  h.connected=true;h.connectError='ROBINHOOD_RELOGIN_REQUIRED';
  const e=await h.step();assert.equal(e.state,'CONNECTION_ERROR');
  assert.match(h.text(),/connection failed \(ROBINHOOD_RELOGIN_REQUIRED\)/);
  const before=h.alerts.length;await h.step();assert.equal(h.alerts.length,before,'alerted once, not every minute');
});

test('only one live step runs at a time',async()=>{
  const h=harness();await ready(h);
  h.d1.db.prepare('UPDATE live_control SET lease_owner=?,lease_until=?').run('other',Date.now()+30_000);
  const r=await h.step();assert.equal(r.skipped,'live step already running');
});

test('outside the regular session requests wait and then expire; no orders are sent',async()=>{
  const h=harness({phase:'premarket'});await ready(h);
  h.broker.quotesMap.set('AAA',{bid:1.99,ask:2.00});h.audit([entry('AAA')]);await h.step();
  assert.equal(h.broker.placed.length,0);
  assert.equal(h.row('SELECT state FROM live_mirror_requests').state,'NEW');
  h.clock.advance(200_000);await h.step();
  assert.equal(h.row('SELECT state FROM live_mirror_requests').state,'EXPIRED');
});

test('public status masks account-like numbers in errors',()=>{
  assert.equal(publicError('ROBINHOOD_TOOL_ERROR:get_portfolio:account 5QR1234567 not found'),'ROBINHOOD_TOOL_ERROR:get_portfolio:account 5QR# not found');
  assert.equal(publicError(null),null);
});

// ---------------------------------------------------------------- Robinhood OAuth + MCP

const ENV={ADMIN_TOKEN:'x'.repeat(40)};
async function loggedIn(opts){
  const d1=liveDb(),rh=fakeRobinhood(opts);
  const {authorizeUrl}=await startLogin(d1,ENV,rh.fetchImpl,new Date(),rh.mcpUrl);
  const u=new URL(authorizeUrl);rh.s.challenge=u.searchParams.get('code_challenge');
  await finishLogin(d1,ENV,rh.fetchImpl,`http://localhost:8765/callback?code=code-xyz&state=${u.searchParams.get('state')}`);
  return {d1,rh,u};
}

test('token vault seals with AES-GCM and rejects the wrong key',async()=>{
  const k1=await vaultKey(ENV),k2=await vaultKey({ADMIN_TOKEN:'y'.repeat(40)});
  const sealed=await seal(k1,'secret-token');
  assert.ok(!sealed.includes('secret'));assert.equal(await unseal(k1,sealed),'secret-token');
  await assert.rejects(()=>unseal(k2,sealed));
  await assert.rejects(()=>vaultKey({BROKER_TOKEN_KEY:'c2hvcnQ='}),/32_BYTES/);
  const raw=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  assert.equal(await unseal(await vaultKey({BROKER_TOKEN_KEY:raw}),await seal(await vaultKey({BROKER_TOKEN_KEY:raw}),'x')),'x');
  assert.equal(timingSafeEqual('abc','abc'),true);assert.equal(timingSafeEqual('abc','abd'),false);assert.equal(timingSafeEqual('abc','ab'),false);
});

test('callback parsing accepts the pasted localhost address and surfaces denials',()=>{
  assert.deepEqual(parseCallback(' http://localhost:8765/callback?code=abc&state=xyz '),{code:'abc',state:'xyz'});
  assert.deepEqual(parseCallback('code=abc&state=xyz'),{code:'abc',state:'xyz'});
  assert.throws(()=>parseCallback('http://localhost:8765/callback?error=access_denied'),/DENIED/);
  assert.throws(()=>parseCallback('http://localhost:8765/callback'),/MISSING/);
});

for(const sse of [false,true])test(`login end to end: discovery, registration, PKCE, sealed tokens, paged catalog, refresh on 401, dead refresh stops (${sse?'SSE':'JSON'})`,async()=>{
  const d1=liveDb(),rh=fakeRobinhood({sse,tools:[...TOOLS,...Array.from({length:65},(_,i)=>({name:'extra_tool_'+i,inputSchema:{type:'object',properties:{}}}))]});
  const {authorizeUrl}=await startLogin(d1,ENV,rh.fetchImpl,new Date(),rh.mcpUrl);
  const u=new URL(authorizeUrl);
  assert.equal(u.origin+u.pathname,'https://login.robinhood.test/authorize');
  for(const [k,v] of Object.entries({response_type:'code',client_id:'client-123',redirect_uri:'http://localhost:8765/callback',code_challenge_method:'S256',resource:rh.mcpUrl,scope:'trading'}))assert.equal(u.searchParams.get(k),v,k);
  rh.s.challenge=u.searchParams.get('code_challenge');
  await assert.rejects(()=>finishLogin(d1,ENV,rh.fetchImpl,'http://localhost:8765/callback?code=code-xyz&state=forged'),/STATE_MISMATCH/);
  d1.queries=0;
  const done=await finishLogin(d1,ENV,rh.fetchImpl,`http://localhost:8765/callback?code=code-xyz&state=${u.searchParams.get('state')}`);
  assert.equal(done.tools,73,'paged tools/list');
  assert.ok(d1.queries<=10,'login stays far inside the 50-query limit: '+d1.queries);
  const creds=d1.db.prepare('SELECT * FROM broker_credentials').get();
  assert.ok(!creds.access_sealed.includes('acc-1')&&!creds.refresh_sealed.includes('ref-1'),'tokens are never stored in plain text');
  assert.equal((await loadToolCatalog(d1)).length,73);
  const status=await connectionStatus(d1);assert.equal(status.logged_in,true);assert.equal(status.has_refresh_token,true);

  // Access token revoked: one refresh, rotated tokens persisted, call retried.
  rh.s.access='revoked';
  const session=await RobinhoodSession.load(d1,ENV,rh.fetchImpl);
  const r=await session.client.callTool('get_accounts',{});
  assert.equal(r.data.data.accounts[0].account_number,'5QR11111');
  assert.equal(rh.s.refreshes,1,'exactly one refresh');
  assert.notEqual(d1.db.prepare('SELECT refresh_sealed FROM broker_credentials').get().refresh_sealed,creds.refresh_sealed,'rotated refresh token persisted');
  const next=await RobinhoodSession.load(d1,ENV,rh.fetchImpl);
  await next.client.callTool('get_accounts',{});
  assert.equal(rh.s.refreshes,1,'the next run uses the stored rotated token');
  // Refresh token rejected: recorded as needing a new login, and MEDS stops calling Robinhood.
  rh.s.access='revoked-again';rh.s.refresh='rotated-elsewhere';
  const dead=await RobinhoodSession.load(d1,ENV,rh.fetchImpl);
  await assert.rejects(()=>dead.client.callTool('get_accounts',{}),/MCP_UNAUTHORIZED/);
  const failed=await connectionStatus(d1);
  assert.equal(failed.relogin_required,true);assert.match(failed.last_error,/REFRESH_TOKEN_FAILED_400:invalid_grant/);
  await assert.rejects(()=>RobinhoodSession.load(d1,ENV,rh.fetchImpl),/ROBINHOOD_RELOGIN_REQUIRED/);
});

test('a rate-limited token refresh is retried next run; only a rejected grant needs a new login',async()=>{
  const {d1,rh}=await loggedIn();
  const realFetch=rh.fetchImpl;let limited=true;
  const fetchImpl=async(url,init)=>{if(limited&&String(url).endsWith('/token')){limited=false;return Response.json({error:'slow_down'},{status:429});}return realFetch(url,init);};
  rh.s.access='revoked';
  const s1=await RobinhoodSession.load(d1,ENV,fetchImpl);
  await assert.rejects(()=>s1.client.callTool('get_accounts',{}),/MCP_UNAUTHORIZED/);
  const status=await connectionStatus(d1);
  assert.equal(status.relogin_required,false);assert.match(status.last_error,/FAILED_429/);
  const s2=await RobinhoodSession.load(d1,ENV,fetchImpl);
  assert.equal((await s2.client.callTool('get_accounts',{})).data.data.accounts[0].account_number,'5QR11111','next run refreshes and continues');
});

test('a refresh never overwrites credentials from a newer login',async()=>{
  const {d1,rh}=await loggedIn();
  const old=await RobinhoodSession.load(d1,ENV,rh.fetchImpl);
  d1.db.prepare("UPDATE broker_credentials SET obtained_at='2030-01-01T00:00:00.000Z'").run(); // a new login happened
  const newer=d1.db.prepare('SELECT access_sealed FROM broker_credentials').get().access_sealed;
  rh.s.access='revoked';
  await old.client.callTool('get_accounts',{});
  assert.equal(d1.db.prepare('SELECT access_sealed FROM broker_credentials').get().access_sealed,newer);
});

test('SSE replies are read only until the matching message, even if the stream stays open',async()=>{
  const enc=new TextEncoder();
  const stream=new ReadableStream({start(c){c.enqueue(enc.encode('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'));
    c.enqueue(enc.encode('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n'));/* never closed */}});
  const m=await Promise.race([readSse(new Response(stream),7),new Promise((_,rej)=>setTimeout(()=>rej(new Error('stalled')),1000))]);
  assert.deepEqual(m.result,{ok:1});
  const split=new ReadableStream({start(c){c.enqueue(enc.encode('data: {"jsonrpc":"2.0","id":3,"res'));c.enqueue(enc.encode('ult":{"v":2}}\r\n\r\n'));c.close();}});
  assert.deepEqual((await readSse(new Response(split),3)).result,{v:2});
});

test('Robinhood adapter works against Robinhood\'s real response envelopes and schema-maps the order exactly',async()=>{
  const {d1,rh}=await loggedIn();
  const session=await RobinhoodSession.load(d1,ENV,rh.fetchImpl);
  const broker=new RobinhoodAgenticBroker(await loadToolCatalog(d1),(n,a)=>session.client.callTool(n,a));
  assert.equal(broker.supportsIoc,true);assert.equal(broker.canLookupOrder,false);
  rh.s.buyingPower=123.45;
  assert.deepEqual(await broker.account(),{accountId:null,cash:123.45,buyingPower:123.45,equity:150});
  assert.deepEqual(rh.s.calls.slice(0,2).map(c=>c[0]),['get_accounts','get_portfolio'],'account number looked up because get_portfolio requires it');
  assert.deepEqual(await broker.positions(),[{symbol:'OBIO',quantity:3,available:3,averagePrice:2},{symbol:'CLOV',quantity:12,available:12,averagePrice:2}]);
  rh.s.quotes={AAA:{bid:1.99,ask:2.00},HALT:{bid:1,ask:1.1,state:'halted'}};
  const quotes=await broker.quotes(['AAA','HALT','ZZZ']);
  assert.deepEqual(rh.s.calls.at(-1),['get_equity_quotes',{symbols:['AAA','HALT','ZZZ']}]);
  assert.deepEqual([...quotes.keys()],['AAA'],'halted and missing symbols have no executable quote');
  assert.ok(Math.abs(Date.parse(quotes.get('AAA').asOf)-Date.now())<5000);
  const order=await broker.placeLimit({symbol:'AAA',side:'BUY',quantity:5,limitPrice:2.02,refId:'5b5c7f1e-0000-5000-8000-000000000000',timeInForce:'ioc'});
  assert.deepEqual(rh.s.calls.at(-1),['place_equity_order',{account_number:'5QR11111',symbol:'AAA',side:'buy',type:'limit',quantity:'5',limit_price:'2.02',
    time_in_force:'ioc',market_hours:'regular_hours',ref_id:'5b5c7f1e-0000-5000-8000-000000000000'}]);
  assert.deepEqual({id:order.id,state:order.state,filled:order.filledQuantity,avg:order.averagePrice,type:order.orderType},{id:'rh-1',state:'FILLED',filled:5,avg:2,type:'limit'});
  const list=await broker.recentOrders();
  assert.equal(list[0].id,'rh-1');assert.equal(list[0].limitPrice,2.02);assert.equal(list[0].executions[0].quantity,5);
  await broker.cancel('rh-1');assert.deepEqual(rh.s.calls.at(-1),['cancel_equity_order',{order_id:'rh-1'}]);
  assert.equal(toolCapabilities(await loadToolCatalog(d1)).can_trade,true);
});

test('adapter refuses to send an order it cannot express exactly as a limit order',async()=>{
  const never=async()=>{throw new Error('must not be called');};
  const noPrice={name:'place_equity_order',inputSchema:{type:'object',properties:{symbol:{type:'string'},side:{type:'string',enum:['buy','sell']},
    type:{type:'string',enum:['market']},quantity:{type:'string'}},required:['symbol','side','type','quantity']}};
  await assert.rejects(()=>new RobinhoodAgenticBroker([noPrice],never).placeLimit({symbol:'AAA',side:'BUY',quantity:1,limitPrice:2,refId:'r',timeInForce:'gfd'}),/MAPPING_INCOMPLETE:price/);
  const marketOnly={name:'place_equity_order',inputSchema:{type:'object',properties:{symbol:{type:'string'},side:{type:'string'},
    order_type:{type:'string',enum:['market']},quantity:{type:'string'},limit_price:{type:'string'}}}};
  await assert.rejects(()=>new RobinhoodAgenticBroker([marketOnly],never).placeLimit({symbol:'AAA',side:'BUY',quantity:1,limitPrice:2,refId:'r',timeInForce:'gfd'}),/ORDER_TYPE_NOT_LIMIT:order_type/);
  const ambiguousPrice={name:'place_equity_order',inputSchema:{type:'object',properties:{symbol:{type:'string'},side:{type:'string'},quantity:{type:'string'},price:{type:'string'}}}};
  await assert.rejects(()=>new RobinhoodAgenticBroker([ambiguousPrice],never).placeLimit({symbol:'AAA',side:'BUY',quantity:1,limitPrice:2,refId:'r',timeInForce:'gfd'}),/ORDER_TYPE_UNCONFIRMED/);
  const unknownRequired={name:'place_equity_order',inputSchema:{type:'object',properties:{symbol:{type:'string'},side:{type:'string'},quantity:{type:'number'},
    limit_price:{type:'number'},venue:{type:'string'}},required:['symbol','side','quantity','limit_price','venue']}};
  await assert.rejects(()=>new RobinhoodAgenticBroker([unknownRequired],never).placeLimit({symbol:'AAA',side:'BUY',quantity:1,limitPrice:2,refId:'r',timeInForce:'gfd'}),/REQUIRED_FIELDS_UNMAPPED:venue/);
  const twoAccounts={name:'get_accounts',inputSchema:{type:'object',properties:{}}},port={name:'get_portfolio',inputSchema:{type:'object',properties:{account_number:{type:'string'}},required:['account_number']}};
  const b=new RobinhoodAgenticBroker([twoAccounts,port],async()=>({isError:false,text:'',data:{data:{accounts:[{account_number:'A1',type:'cash'},{account_number:'A2',type:'margin'}]}}}));
  await assert.rejects(()=>b.account(),/ROBINHOOD_ACCOUNT_AMBIGUOUS:2/);
  // Four accounts, each with an agentic_allowed flag: only the one marked true is used.
  const four=[{account_number:'A1',agentic_allowed:false},{account_number:'A2',agentic_allowed:false},{account_number:'A3',agentic_allowed:true},{account_number:'A4',agentic_allowed:false}];
  const calls=[];
  const pick1=new RobinhoodAgenticBroker([twoAccounts,port],async(name,args)=>{calls.push([name,args]);
    return name==='get_accounts'?{isError:false,text:'',data:{data:{accounts:four}}}:{isError:false,text:'',data:{buying_power:'10'}};});
  await pick1.account();
  assert.deepEqual(calls.at(-1),['get_portfolio',{account_number:'A3'}]);
  // Two tradable accounts, or none, is still refused.
  const twoTrue=new RobinhoodAgenticBroker([twoAccounts,port],async()=>({isError:false,text:'',data:{data:{accounts:four.map(a=>({...a,agentic_allowed:a.account_number!=='A2'}))}}}));
  await assert.rejects(()=>twoTrue.account(),/ROBINHOOD_ACCOUNT_AMBIGUOUS:4/);
  const noneTrue=new RobinhoodAgenticBroker([twoAccounts,port],async()=>({isError:false,text:'',data:{data:{accounts:four.map(a=>({...a,agentic_allowed:false}))}}}));
  await assert.rejects(()=>noneTrue.account(),/ROBINHOOD_ACCOUNT_AMBIGUOUS:4/);
});

test('adapter handles uppercase enums, numeric fields, DAY time-in-force, confirmations and a review step',async()=>{
  const place={name:'place_equity_order',inputSchema:{type:'object',properties:{ticker:{type:'string'},action:{type:'string',enum:['BUY','SELL']},
    order_type:{type:'string',enum:['MARKET','LIMIT']},shares:{type:'number'},limit_price:{type:'number'},tif:{type:'string',enum:['DAY','GTC']},
    confirm:{type:'boolean'},review_id:{type:'string'}},required:['ticker','action','order_type','shares','confirm','review_id']}};
  const review={name:'review_equity_order',inputSchema:{type:'object',properties:{ticker:{type:'string'},action:{type:'string'},shares:{type:'number'},limit_price:{type:'number'}}}};
  const calls=[];
  const broker=new RobinhoodAgenticBroker([place,review],async(name,args)=>{calls.push([name,args]);
    return name==='review_equity_order'?{isError:false,text:'',data:{review:{review_id:'rv-9'}}}:{isError:false,text:'',data:{order:{id:'o-9',status:'confirmed',side:'sell'}}};});
  assert.equal(broker.supportsIoc,false);
  const o=await broker.placeLimit({symbol:'AAA',side:'SELL',quantity:3,limitPrice:2.15,refId:'r',timeInForce:'gfd'});
  assert.deepEqual(calls.at(-1),['place_equity_order',{ticker:'AAA',action:'SELL',order_type:'LIMIT',shares:3,limit_price:2.15,tif:'DAY',confirm:true,review_id:'rv-9'}]);
  assert.equal(o.state,'SUBMITTED');
  const rejecting=new RobinhoodAgenticBroker([place,review],async name=>name==='review_equity_order'?{isError:true,text:'Not enough shares',data:null}:null);
  await assert.rejects(()=>rejecting.placeLimit({symbol:'AAA',side:'SELL',quantity:3,limitPrice:2.15,refId:'r',timeInForce:'gfd'}),
    e=>e instanceof OrderRejected&&e.placed==='no'&&/Not enough shares/.test(e.message));
});

test('normalizers read Robinhood\'s envelopes and fail loudly on unreadable ones',()=>{
  const S=(o)=>({data:o,guide:GUIDE});
  const account=normalizeAccount(S({cash:'9',total_value:'12',buying_power:{buying_power:'10.5',unleveraged_buying_power:'10.0',display_currency:'USD'},crypto_buying_power:{buying_power:'99'}}));
  assert.deepEqual(account,{accountId:null,cash:9,buyingPower:10,equity:12},'nested buying power, never crypto, lower of leveraged/unleveraged');
  assert.throws(()=>normalizeAccount(S({hello:'world'})),/BUYING_POWER/);
  assert.deepEqual(normalizePositions(S({positions:[]})),[]);
  assert.deepEqual(normalizePositions(S({positions:[{symbol:'OBIO',quantity:'3.000000',average_buy_price:'1.5',shares_available_for_sells:'2.000000',type:'long'},
    {symbol:'ZERO',quantity:'0.000000',type:'long'},{symbol:'SHRT',quantity:'5',type:'short'}]})),[{symbol:'OBIO',quantity:3,available:2,averagePrice:1.5}]);
  assert.throws(()=>normalizePositions(S({message:'ok'})),/UNPARSEABLE/);
  const q=normalizeQuotes(S({results:[{quote:{symbol:'SPY',bid_price:'500.10',venue_bid_time:'2026-09-29T12:41:22.546198799Z',ask_price:'500.12',venue_ask_time:'2026-09-29T12:41:20.000000000Z',state:'active'},close:{symbol:'SPY',price:'499'}},
    {quote:{symbol:'NOBID',bid_price:'0',ask_price:'1',state:'active'}}]}),['SPY','NOBID']);
  assert.deepEqual(q.get('SPY'),{symbol:'SPY',bid:500.1,ask:500.12,asOf:'2026-09-29T12:41:20.000Z'},'older of the bid/ask times');
  assert.equal(q.has('NOBID'),false,'zero bid is not a quote');
  assert.equal(normalizeQuotes({AAA:{bid:1.1,ask:1.2}},['AAA','BBB']).get('AAA').bid,1.1,'symbol-keyed responses');
  const real=S({orders:[{id:'6aad4efc',instrument_id:'fb42804a',symbol:'FRSX',side:'sell',type:'market',state:'filled',quantity:'10.000000',cumulative_quantity:'10.000000',
    price:null,stop_price:null,average_price:'0.51',fees:'0.02',dollar_based_amount:null,time_in_force:'gfd',market_hours:'regular_hours',trigger:'immediate',placed_agent:'user',
    created_at:'2026-09-18T14:47:24.791258Z',last_transaction_at:'2026-09-18T14:47:24.899Z',
    executions:[{id:'549f',price:'0.51',quantity:'1.000000',timestamp:'2026-09-18T14:47:24.899Z',fees:'0.00'},{id:'a3d6',price:'0.51',quantity:'9.000000',timestamp:'2026-09-18T14:47:24.899Z',fees:'0.02'}]}]});
  const [o]=normalizeOrders(real);
  assert.deepEqual({id:o.id,symbol:o.symbol,side:o.side,type:o.orderType,state:o.state,qty:o.quantity,filled:o.filledQuantity,limit:o.limitPrice,avg:o.averagePrice,fees:o.fees,execs:o.executions.length,agent:o.placedAgent},
    {id:'6aad4efc',symbol:'FRSX',side:'SELL',type:'market',state:'FILLED',qty:10,filled:10,limit:null,avg:0.51,fees:0.02,execs:2,agent:'user'});
  assert.deepEqual(normalizeOrders(S({orders:[]})),[]);
  assert.throws(()=>normalizeOrders(S({text:'nope'})),/UNPARSEABLE/);
  assert.equal(normalizeOrderResult(S({instrument:{id:'i1',state:'active'},order:{id:'o1',state:'queued',side:'buy'}})).id,'o1','an instrument is never mistaken for the order');
  assert.equal(normalizeOrderResult({ok:true}),null);
  assert.deepEqual(['queued','unconfirmed','confirmed','pending_cancel','cancel_queued','filled','partially_filled','canceled','cancelled','expired','rejected','failed'].map(mapOrderState),
    ['SUBMITTED','SUBMITTED','SUBMITTED','SUBMITTED','SUBMITTED','FILLED','PARTIALLY_FILLED','CANCELED','CANCELED','CANCELED','REJECTED','REJECTED']);
});

test('tool resolution distinguishes order-list from single-order tools',()=>{
  const t=resolveTools([{name:'get_equity_orders',inputSchema:{properties:{order_id:{type:'string'}},required:['order_id']}},{name:'list_equity_orders',inputSchema:{properties:{}}}]);
  assert.equal(t.orderById.name,'get_equity_orders');assert.equal(t.orders.name,'list_equity_orders');
  assert.equal(toolCapabilities([]).can_trade,false);
});

test('SSE parsing, tool results and response shapes',()=>{
  const m=parseSse('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":8,"result":{"ok":2}}\n\n',7);
  assert.deepEqual(m.result,{ok:1});
  assert.deepEqual(toolResult({content:[{type:'text',text:'{"a":1}'}]}).data,{a:1});
  assert.deepEqual(toolResult({structuredContent:{b:2},content:[]}).data,{b:2});
  assert.deepEqual(shapeOf({cash:'1.00',positions:[{symbol:'A',qty:1}],n:null}),{cash:'string',positions:[{symbol:'string',qty:'number'}],n:'null'});
});

test('refIdFor is deterministic and UUID shaped',async()=>{
  assert.equal(await refIdFor('meds-live-1'),await refIdFor('meds-live-1'));
  assert.notEqual(await refIdFor('meds-live-1'),await refIdFor('meds-live-2'));
  const {verifier,challenge}=await pkcePair();assert.ok(verifier.length>=43&&challenge.length===43);
});
