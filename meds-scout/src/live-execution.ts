// MEDS live execution: mirrors committed H250 paper decisions into real
// Robinhood orders.
//
// Each run is its own Worker invocation on a minute the paper cycle does not
// use (Workers Free allows 50 D1 queries and 50 subrequests per invocation;
// a busy run uses about 30 of each).
//
//   1. claim the live lease; read control, sync state and today's risk
//   2. pull new mirror requests from committed paper cycle audits
//   3. read Robinhood: buying power, positions, quotes, recent orders
//   4. resolve in-flight orders and record fills in MEDS's own ledger
//   5. reconcile MEDS-owned shares against Robinhood
//   6. turn requests into limit orders under the operator's caps and submit
//   7. write everything in one fenced batch and release the lease
//
// Writes are fenced: a batch aborts if this run no longer holds the lease, so
// a slow run can never overwrite a newer run's state. Every order is written
// as an intent (SUBMITTING) before it is sent. An order whose response is lost
// is found again in Robinhood's order list and is never re-sent.
//
// MEDS manages only shares it bought itself. Other holdings in the account
// (for example positions opened from ChatGPT) are reported as unmanaged and
// never sold.

import {canonicalDecimal,decimalUnits,formatUnits} from './broker.ts';
import {ingest} from './leader-capacity.ts';
import {OrderRejected,NotSent,norm,type LiveBroker,type LiveOrder,type LiveQuote} from './robinhood-broker.ts';

export const LIVE_ACCOUNT='RH_AGENTIC';
export const LIVE_ENGINE='meds-live-mirror-v1';
const LEASE_MS=50_000;
const RUN_DEADLINE_MS=35_000;
const MAX_SUBMISSIONS_PER_RUN=3;
const MAX_CANCELS_PER_RUN=3;
const MAX_QUOTE_SYMBOLS=40;
const UNKNOWN_AFTER_MS=60_000;
const UNKNOWN_GIVE_UP_MS=3*60_000;
const NOT_VISIBLE_GIVE_UP_MS=15*60_000;
const MAX_SYMBOL_LOOKUPS=3;
const FILL_LAG_GRACE_MS=10*60_000;
const QUOTE_MAX_AGE_MS=120_000;
const FILL_SETTLE_MS=2_500;
const PENDING=['INTENDED','SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_REQUESTED','UNKNOWN'];
const OPEN_AT_BROKER=['SUBMITTED','PARTIALLY_FILLED'];

export const LIVE_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS live_control(
    id INTEGER PRIMARY KEY CHECK(id=1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
    halted_reason TEXT,
    max_capital REAL NOT NULL DEFAULT 250 CHECK(max_capital>0),
    max_order_notional REAL NOT NULL DEFAULT 12 CHECK(max_order_notional>0),
    max_orders_per_day INTEGER NOT NULL DEFAULT 40 CHECK(max_orders_per_day>=0),
    daily_loss_limit REAL NOT NULL DEFAULT 15 CHECK(daily_loss_limit>0),
    order_ttl_seconds INTEGER NOT NULL DEFAULT 90 CHECK(order_ttl_seconds>=15),
    buy_limit_buffer_pct REAL NOT NULL DEFAULT 0.01 CHECK(buy_limit_buffer_pct>=0 AND buy_limit_buffer_pct<=0.05),
    sell_limit_buffer_pct REAL NOT NULL DEFAULT 0.02 CHECK(sell_limit_buffer_pct>=0 AND sell_limit_buffer_pct<=0.10),
    max_chase_pct REAL NOT NULL DEFAULT 0.02 CHECK(max_chase_pct>=0 AND max_chase_pct<=0.10),
    max_spread_pct REAL NOT NULL DEFAULT 0.03 CHECK(max_spread_pct>0 AND max_spread_pct<=0.20),
    request_ttl_seconds INTEGER NOT NULL DEFAULT 180 CHECK(request_ttl_seconds>=60),
    last_mirror_bucket TEXT,
    agent_label TEXT,
    lease_owner TEXT,
    lease_until INTEGER,
    updated_at TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO live_control(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `CREATE TABLE IF NOT EXISTS live_write_guard(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,checked_at INTEGER NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS live_fence_v1 BEFORE INSERT ON live_write_guard
    WHEN NOT EXISTS(SELECT 1 FROM live_control WHERE id=1 AND lease_owner=NEW.owner AND lease_until>NEW.checked_at)
    BEGIN SELECT RAISE(ABORT,'live lease lost'); END`,
  `CREATE TABLE IF NOT EXISTS live_mirror_requests(
    request_id TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN('ENTRY','EXIT_FRACTION','EXIT_ALL')),
    fraction REAL,
    paper_notional REAL,
    paper_price REAL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN('NEW','ORDERED','SKIPPED','EXPIRED')),
    detail TEXT,
    client_order_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_live_mirror_state ON live_mirror_requests(state,decided_at)`,
  `CREATE TABLE IF NOT EXISTS live_positions(
    symbol TEXT PRIMARY KEY,
    quantity TEXT NOT NULL,
    cost_basis TEXT NOT NULL,
    realized_pnl TEXT NOT NULL DEFAULT '0.00000000',
    opened_at TEXT,
    updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_daily(
    session_date TEXT PRIMARY KEY,
    pnl_start REAL,
    pnl_last REAL,
    orders INTEGER NOT NULL DEFAULT 0,
    buys_blocked TEXT,
    updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS live_sync(
    id INTEGER PRIMARY KEY CHECK(id=1),
    synced_at TEXT,
    ok INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    error TEXT,
    buying_power REAL,
    cash REAL,
    equity REAL,
    owned TEXT,
    broker_positions TEXT,
    reconciliation TEXT,
    mismatch_symbols TEXT,
    day_pnl REAL,
    total_pnl REAL,
    last_result TEXT)`,
  `INSERT OR IGNORE INTO live_sync(id) VALUES(1)`,
];
export async function ensureLiveSchema(db:D1Database){await db.batch(LIVE_SCHEMA.map(s=>db.prepare(s)));}

// ---------------------------------------------------------------- outbox (runs inside the paper cycle)

export type MirrorRow={request_id:string;bucket:string;decided_at:string;strategy_version:string;symbol:string;
  action:'ENTRY'|'EXIT_FRACTION'|'EXIT_ALL';fraction:number|null;paper_notional:number|null;paper_price:number|null;reason:string};
type PlanLike={positions:any[];newPositions:any[];trades:any[];events:any[]};

// Pure: derive what live should do from what the paper plan just did.
// `before` maps 'equity:<id>' to the paper remaining quantity at cycle start.
export function mirrorRequestsFromPlan(plan:PlanLike,before:Map<string,number>,bucket:string,decidedAt:string,version:string):MirrorRow[]{
  const out:MirrorRow[]=[];
  for(const p of plan.positions){
    if(p.kind!=='equity')continue;
    const start=before.get('equity:'+p.id);
    if(!(start&&start>0))continue;
    const after=p.status==='closed'?0:Number(p.remaining_qty??start);
    if(!(after<start-1e-12))continue;
    const trade=plan.trades.find(t=>t.kind==='equity'&&Number(t.id)===Number(p.id));
    const events=plan.events.filter(e=>e.kind==='equity'&&Number(e.position_id)===Number(p.id));
    const types=events.map(e=>String(e.event_type).replace(/_\d{4}-\d\d-\d\dT.*$/,''));
    // A liquidity-limited stop/time/runner exit is still an intent to leave the
    // whole position; live (small, whole-share size) leaves it at once.
    const liquidityLimited=types.includes('PARTIAL_EXIT');
    const full=after<=1e-12||liquidityLimited;
    const detailReason=events.map(e=>{try{return JSON.parse(e.details??'{}').reason;}catch{return undefined;}}).find(Boolean);
    const reason=trade?String(trade.exit_reason):liquidityLimited?String(detailReason??'liquidity_limited_exit'):types.join('+')||'paper_exit';
    const price=trade?Number(trade.exit_price):events.length?Number(events[events.length-1].price):NaN;
    const action=full?'EXIT_ALL':'EXIT_FRACTION';
    out.push({request_id:`${bucket}|${action}|${p.symbol}`,bucket,decided_at:decidedAt,strategy_version:version,symbol:String(p.symbol).toUpperCase(),
      action,fraction:full?1:1-after/start,paper_notional:null,paper_price:Number.isFinite(price)?price:null,reason});
  }
  for(const p of plan.newPositions){
    if(p.kind!=='equity')continue;
    out.push({request_id:`${bucket}|ENTRY|${p.symbol}`,bucket,decided_at:decidedAt,strategy_version:version,symbol:String(p.symbol).toUpperCase(),
      action:'ENTRY',fraction:null,paper_notional:Number(p.entry_notional),paper_price:Number(p.entry_price),reason:'paper_entry'});
  }
  return out;
}

// ---------------------------------------------------------------- money and price helpers (8-dp decimals)

const SCALE=100_000_000n;
const dec=(n:number|string)=>typeof n==='string'?canonicalDecimal(n):canonicalDecimal(Number(n).toFixed(8));
const units=(n:number|string)=>decimalUnits(dec(n));
const mul=(a:bigint,b:bigint)=>a*b/SCALE;
const div=(a:bigint,b:bigint)=>b===0n?0n:a*SCALE/b;
const toNum=(u:bigint)=>Number(formatUnits(u));
const maxBig=(a:bigint,b:bigint)=>a>b?a:b;
const tickFor=(p:number)=>p>=1?0.01:0.0001;
export const roundUpTick=(p:number)=>{const t=tickFor(p);return Number((Math.ceil(p/t-1e-9)*t).toFixed(p>=1?2:4));};
export const roundDownTick=(p:number)=>{const t=tickFor(p);return Number((Math.floor(p/t+1e-9)*t).toFixed(p>=1?2:4));};

async function sha256Hex(text:string){
  const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  return [...d].map(b=>b.toString(16).padStart(2,'0')).join('');
}
// Deterministic UUID-shaped reference derived from the client order id.
export async function refIdFor(clientOrderId:string){
  const h=(await sha256Hex('ref|'+clientOrderId)).slice(0,32).split('');
  h[12]='5';h[16]=((parseInt(h[16],16)&0x3)|0x8).toString(16);
  const s=h.join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20,32)}`;
}
// Unique per submission attempt: a retry of the same paper decision is a new intent.
export async function clientOrderIdFor(requestId:string,side:string,qty:number,limit:number,stamp:string){
  return 'meds-live-'+(await sha256Hex(['live',LIVE_ACCOUNT,requestId,side,qty,limit,stamp].join('|'))).slice(0,32);
}
const msg=(e:unknown)=>String(e instanceof Error?e.message:e).slice(0,300);

// ---------------------------------------------------------------- live step

export type LiveControl={
  enabled:number;halted_reason:string|null;max_capital:number;max_order_notional:number;max_orders_per_day:number;
  daily_loss_limit:number;order_ttl_seconds:number;buy_limit_buffer_pct:number;sell_limit_buffer_pct:number;
  max_chase_pct:number;max_spread_pct:number;request_ttl_seconds:number;last_mirror_bucket:string|null;
};
export type LiveDeps={
  db:D1Database;
  now:()=>Date;
  phase:string;            // session phase (America/New_York)
  sessionDate:string;      // YYYY-MM-DD (America/New_York)
  scoutEnabled:boolean;    // SCOUT_ENABLED; with service_state.paused this is the halt switch
  paperOpenSymbols:()=>Promise<Set<string>>;
  connect:()=>Promise<LiveBroker|null>;
  notify:(text:string,key:string)=>Promise<void>;
  sleep:(ms:number)=>Promise<void>;
  flush?:()=>D1PreparedStatement[]; // extra statements (captured tool shapes) for the final batch
};
type Owned={symbol:string;quantity:bigint;cost:bigint;realized:bigint;opened_at:string|null};
export type Intent={client_order_id:string;created_at:string;symbol:string;side:'BUY'|'SELL';time_in_force:string;
  quantity:string;limit_price:string;state:string;broker_order_id:string|null;last_error?:string|null};
type Planned={request:any;symbol:string;side:'BUY'|'SELL';quantity:number;limitPrice:number;clientOrderId:string};
type Transition={client_order_id:string;from:string;state:string;broker_order_id:string|null;last_error:string|null};
type Run={
  d:LiveDeps;db:D1Database;broker:LiveBroker;control:LiveControl;owner:string;started:number;
  owned:Map<string,Owned>;touched:Set<string>;alerts:string[];
  fills:any[];orders:Map<string,any>;transitions:Map<string,Transition>;
  recorded:Map<string,{qty:bigint;notional:bigint;fees:bigint}>;linked:Set<string>;cancels:number;fillCount:number;
  agentLabel:string|null;newAgentLabel:string|null;halts:string[];symbolLists:Map<string,LiveOrder[]|null>;lookups:number;
};

function transition(run:Run,id:string,dbState:string,state:string,brokerOrderId:string|null,lastError:string|null){
  const t=run.transitions.get(id);
  if(t){t.state=state;t.broker_order_id=t.broker_order_id??brokerOrderId;t.last_error=lastError;}
  else run.transitions.set(id,{client_order_id:id,from:dbState,state,broker_order_id:brokerOrderId,last_error:lastError});
}
const fence=(db:D1Database,owner:string)=>db.prepare('INSERT OR REPLACE INTO live_write_guard VALUES(1,?,?)').bind(owner,Date.now());

export async function runLiveStep(d:LiveDeps){
  const db=d.db,now=d.now(),stamp=now.toISOString(),owner=crypto.randomUUID(),started=Date.now();
  const claim=await db.prepare('UPDATE live_control SET lease_owner=?,lease_until=? WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)')
    .bind(owner,started+LEASE_MS,started).run();
  if(!claim.meta.changes)return {ok:true,skipped:'live step already running'};
  const alerts:string[]=[];
  const release=()=>db.prepare('UPDATE live_control SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?').bind(owner);
  const finish=async(statements:D1PreparedStatement[])=>{
    await db.batch([fence(db,owner),...statements,...(d.flush?.()??[]),release()]);
    // One message per run; identical text repeats at most once per day.
    if(alerts.length)await d.notify(alerts.slice(0,8).join('\n').slice(0,1800),'live-'+d.sessionDate+'-'+(await sha256Hex(alerts.join('|'))).slice(0,24)).catch(()=>{});
  };
  const result:Record<string,unknown>={ok:true,engine:LIVE_ENGINE};
  let head:any=null;
  try{
    head=await db.prepare(`SELECT c.*,COALESCE((SELECT paused FROM service_state WHERE id=1),0) AS service_paused,
        s.state AS sync_state,s.error AS sync_error,s.mismatch_symbols AS sync_mismatch,
        dd.pnl_start AS day_pnl_start,dd.pnl_last AS day_pnl_last,dd.orders AS day_orders,dd.buys_blocked AS day_buys_blocked
      FROM live_control c LEFT JOIN live_sync s ON s.id=1 LEFT JOIN live_daily dd ON dd.session_date=? WHERE c.id=1`).bind(d.sessionDate).first<any>();
    if(!head)throw new Error('LIVE_CONTROL_MISSING');
    const control=head as LiveControl;
    const paused=!d.scoutEnabled||!!Number(head.service_paused);
    result.ingested=await ingestMirror(db,control,now);

    // ---- connect
    let connectError:string|null=null;
    const broker=await d.connect().catch(e=>{connectError=msg(e);return null;});
    if(!broker){
      if(connectError&&control.enabled&&head.sync_state!=='CONNECTION_ERROR')alerts.push(`MEDS live: Robinhood connection failed (${connectError}). No orders are being placed.`);
      const state=connectError?'CONNECTION_ERROR':'NOT_CONNECTED';
      await finish([
        db.prepare(`UPDATE live_mirror_requests SET state='SKIPPED',detail='NOT_CONNECTED',updated_at=? WHERE state='NEW' AND decided_at<?`)
          .bind(stamp,new Date(now.getTime()-control.request_ttl_seconds*1000).toISOString()),
        db.prepare('UPDATE live_sync SET synced_at=?,ok=0,state=?,error=? WHERE id=1').bind(stamp,state,connectError),
      ]);
      return {...result,state,error:connectError};
    }

    // ---- read Robinhood and the MEDS ledger
    const account=await broker.account();
    const brokerPositions=await broker.positions();
    const [ownedRows,pendingRows,requestRows]=await Promise.all([
      db.prepare('SELECT * FROM live_positions').all<any>().then(r=>r.results??[]),
      db.prepare(`SELECT client_order_id,created_at,symbol,side,time_in_force,quantity,limit_price,state,broker_order_id,last_error FROM broker_order_intents
        WHERE account_id=? AND state IN('INTENDED','SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_REQUESTED','UNKNOWN') ORDER BY created_at`).bind(LIVE_ACCOUNT).all<Intent>().then(r=>r.results??[]),
      db.prepare(`SELECT * FROM live_mirror_requests WHERE state='NEW' ORDER BY decided_at LIMIT 40`).all<any>().then(r=>r.results??[]),
    ]);
    const run:Run={d,db,broker,control,owner,started,
      owned:new Map(ownedRows.map((r:any)=>[r.symbol,{symbol:r.symbol,quantity:units(r.quantity),cost:units(r.cost_basis),realized:units(r.realized_pnl),opened_at:r.opened_at}])),
      touched:new Set(),alerts,fills:[],orders:new Map(),transitions:new Map(),recorded:new Map(),linked:new Set(),cancels:0,fillCount:0,
      agentLabel:head.agent_label??null,newAgentLabel:null,halts:[],symbolLists:new Map(),lookups:0};
    const brokerPos=new Map(brokerPositions.map(p=>[p.symbol,p]));

    // ---- resolve in-flight orders (a halt cancels everything still open)
    if(pendingRows.length){
      const rows=(await db.prepare(`SELECT 'fill' AS kind,client_order_id AS k,quantity AS q,price AS p,fee AS f FROM broker_fills
          WHERE client_order_id IN (SELECT value FROM json_each(?1))
        UNION ALL SELECT 'linked',broker_order_id,NULL,NULL,NULL FROM broker_order_intents
          WHERE account_id=?2 AND broker_order_id IS NOT NULL AND created_at>=?3`)
        .bind(JSON.stringify(pendingRows.map(r=>r.client_order_id)),LIVE_ACCOUNT,new Date(now.getTime()-3*86400000).toISOString()).all<any>()).results??[];
      for(const r of rows){
        if(r.kind==='linked'){run.linked.add(String(r.k));continue;}
        const x=run.recorded.get(r.k)??{qty:0n,notional:0n,fees:0n};
        x.qty+=units(r.q);x.notional+=mul(units(r.q),units(r.p));x.fees+=units(r.f??'0');run.recorded.set(r.k,x);
      }
    }
    const pending=await resolve(run,pendingRows,now,paused);

    // ---- reconcile: Robinhood must hold at least what MEDS bought
    const inFlight=new Set(pending.filter(i=>PENDING.includes(i.state)).map(i=>i.symbol));
    const prevMismatch=new Set<string>(JSON.parse(head.sync_mismatch||'[]'));
    const mismatches:string[]=[],unmanaged:string[]=[];
    for(const o of run.owned.values()){
      if(o.quantity<=0n||inFlight.has(o.symbol))continue;
      if(units(brokerPos.get(o.symbol)?.quantity??0)<o.quantity)mismatches.push(o.symbol);
    }
    for(const p of brokerPositions)if((run.owned.get(p.symbol)?.quantity??0n)<=0n)unmanaged.push(p.symbol);
    let halted=control.halted_reason;
    const extra:D1PreparedStatement[]=[];
    const confirmed=mismatches.filter(s=>prevMismatch.has(s)); // two consecutive syncs: a lagging snapshot never halts
    if(confirmed.length&&!halted){
      halted='RECONCILIATION_MISMATCH:'+confirmed.join(',');
      extra.push(db.prepare('UPDATE live_control SET halted_reason=?,updated_at=? WHERE id=1').bind(halted,stamp));
      alerts.push(`MEDS live HALTED new buys: Robinhood holds fewer shares than MEDS bought for ${confirmed.join(', ')}. Check the account, then press Clear halt in the console.`);
    }
    if(run.halts.length&&!halted){
      halted=run.halts.join('; ');
      extra.push(db.prepare('UPDATE live_control SET halted_reason=?,updated_at=? WHERE id=1').bind(halted,stamp));
    }

    // ---- quotes and daily P&L on MEDS-owned positions
    const held=[...run.owned.values()].filter(o=>o.quantity>0n);
    const quoteSymbols=[...new Set([...requestRows.map((r:any)=>String(r.symbol)),...held.map(o=>o.symbol)])].slice(0,MAX_QUOTE_SYMBOLS);
    let quotes=new Map<string,LiveQuote>();
    try{quotes=await broker.quotes(quoteSymbols);}catch(e){result.quote_error=msg(e);}
    let realized=0n,unrealized=0n;
    for(const o of run.owned.values())realized+=o.realized;
    const valued=held.every(o=>quotes.has(o.symbol));
    for(const o of held){const q=quotes.get(o.symbol);if(q)unrealized+=mul(o.quantity,units(q.bid))-o.cost;}
    // P&L is only measured when every MEDS position has a quote; otherwise the
    // last complete measurement stands (a missing quote is not a gain or loss).
    const totalPnl=valued?toNum(realized+unrealized):null;
    const pnlStart=head.day_pnl_start==null?totalPnl:Number(head.day_pnl_start);
    const dayPnl=totalPnl!=null&&pnlStart!=null?totalPnl-pnlStart:head.day_pnl_last!=null&&pnlStart!=null?Number(head.day_pnl_last)-pnlStart:null;
    let ordersToday=Number(head.day_orders??0);
    let buysBlocked:string|null=head.day_buys_blocked??null;
    // If the previous run failed partway, its orders may not be fully recorded
    // yet: exits still run, but no new buys until a run completes cleanly.
    const previousRunFailed=head.sync_state==='ERROR';
    if(!buysBlocked&&dayPnl!=null&&dayPnl<=-control.daily_loss_limit){
      buysBlocked='DAILY_LOSS_LIMIT';
      alerts.push(`MEDS live: daily loss limit hit (${dayPnl.toFixed(2)} vs -${control.daily_loss_limit}). No new buys until tomorrow; exits continue.`);
    }

    // ---- decide
    const regular=d.phase==='regular';
    const planned:Planned[]=[],requestUpdates:any[]=[];
    const pendingSell=new Set(pending.filter(i=>PENDING.includes(i.state)&&i.side==='SELL').map(i=>i.symbol));
    const pendingBuy=new Set(pending.filter(i=>PENDING.includes(i.state)&&i.side==='BUY').map(i=>i.symbol));
    let exposure=0;
    for(const o of held)exposure+=toNum(o.cost);
    for(const i of pending)if(PENDING.includes(i.state)&&i.side==='BUY')exposure+=Number(i.quantity)*Number(i.limit_price);
    let buyingPower=account.buyingPower;
    const requests:any[]=[...requestRows];
    if(regular&&!paused){
      // Converge: anything MEDS owns that the paper account no longer holds is sold.
      const paperOpen=await d.paperOpenSymbols();
      for(const o of held){
        if(paperOpen.has(o.symbol)||pendingSell.has(o.symbol)||requests.some(r=>r.symbol===o.symbol&&r.action!=='ENTRY'))continue;
        requests.push({request_id:`orphan|${stamp}|${o.symbol}`,bucket:d.sessionDate,symbol:o.symbol,action:'EXIT_ALL',fraction:1,
          reason:'orphan_no_paper_position',decided_at:stamp,strategy_version:LIVE_ENGINE,orphan:true});
      }
    }
    requests.sort((a,b)=>(a.action==='ENTRY'?1:0)-(b.action==='ENTRY'?1:0)); // exits first
    for(const r of requests){
      const age=now.getTime()-Date.parse(r.decided_at);
      const skip=(detail:string,state='SKIPPED')=>{if(!r.orphan)requestUpdates.push({request_id:r.request_id,from:'NEW',state,detail,client_order_id:null});};
      if(!r.orphan&&age>control.request_ttl_seconds*1000){skip('REQUEST_TOO_OLD','EXPIRED');continue;}
      if(!regular)continue; // wait for the regular session (or expire)
      if(paused){skip('ENGINE_HALTED');continue;}
      if(planned.length>=MAX_SUBMISSIONS_PER_RUN)continue; // next minute
      const q=quotes.get(r.symbol);
      if(r.action==='ENTRY'){
        if(!control.enabled){skip('LIVE_DISABLED');continue;}
        if(halted){skip('HALTED');continue;}
        if(buysBlocked){skip(buysBlocked);continue;}
        if(previousRunFailed){skip('PREVIOUS_RUN_FAILED');continue;}
        if(ordersToday>=control.max_orders_per_day){skip('MAX_ORDERS_PER_DAY');continue;}
        if((run.owned.get(r.symbol)?.quantity??0n)>0n||pendingBuy.has(r.symbol)){skip('ALREADY_HELD_OR_PENDING');continue;}
        // Never mix MEDS's shares with shares held another way in the same stock:
        // reconciliation could not tell them apart.
        if((brokerPos.get(r.symbol)?.quantity??0)>1e-9){skip('SYMBOL_HELD_OUTSIDE_MEDS');continue;}
        if(!q){skip('NO_LIVE_QUOTE');continue;}
        if(!q.asOf||!Number.isFinite(Date.parse(q.asOf))||now.getTime()-Date.parse(q.asOf)>QUOTE_MAX_AGE_MS){skip('LIVE_QUOTE_STALE');continue;}
        if((q.ask-q.bid)/q.ask>control.max_spread_pct){skip('SPREAD_TOO_WIDE');continue;}
        if(Number(r.paper_price)>0&&q.ask>Number(r.paper_price)*(1+control.max_chase_pct)){skip('PRICE_MOVED_AWAY');continue;}
        const limit=roundUpTick(q.ask*(1+control.buy_limit_buffer_pct));
        const budget=Math.min(control.max_order_notional,control.max_capital-exposure,buyingPower*0.98);
        const qty=Math.floor(budget/limit);
        if(qty<1){skip(control.max_capital-exposure<limit?'MAX_CAPITAL_REACHED':buyingPower*0.98<limit?'INSUFFICIENT_BUYING_POWER':'PRICE_ABOVE_ORDER_CAP');continue;}
        exposure+=qty*limit;buyingPower-=qty*limit;ordersToday++;pendingBuy.add(r.symbol);
        planned.push({request:r,symbol:r.symbol,side:'BUY',quantity:qty,limitPrice:limit,clientOrderId:await clientOrderIdFor(r.request_id,'BUY',qty,limit,stamp)});
      }else{
        const pos=brokerPos.get(r.symbol);
        const mine=run.owned.get(r.symbol)?.quantity??0n,sellableAtBroker=units(pos?.available??pos?.quantity??0);
        const sellable=mine<sellableAtBroker?mine:sellableAtBroker;
        if(sellable<=0n){skip('NO_LIVE_POSITION');continue;}
        if(pendingSell.has(r.symbol)){skip('SELL_ALREADY_PENDING');continue;}
        if(!q){if(!r.orphan&&age>control.request_ttl_seconds*500)skip('NO_LIVE_QUOTE');continue;}
        const whole=Math.floor(toNum(sellable)+1e-9);
        const qty=r.action==='EXIT_ALL'?whole:Math.min(whole,Math.floor(toNum(mine)*Number(r.fraction)+1e-9));
        if(qty<1){skip('FRACTION_BELOW_ONE_SHARE');continue;}
        const limit=roundDownTick(q.bid*(1-control.sell_limit_buffer_pct));
        if(!(limit>0)){skip('NO_VALID_BID');continue;}
        ordersToday++;pendingSell.add(r.symbol);
        planned.push({request:r,symbol:r.symbol,side:'SELL',quantity:qty,limitPrice:limit,clientOrderId:await clientOrderIdFor(r.request_id,'SELL',qty,limit,stamp)});
      }
    }

    // ---- persist intents before anything is sent
    const tif=broker.supportsIoc?'ioc':'gfd';
    let skipped=requestUpdates.length;
    if(planned.length){
      const intentRows=planned.map(p=>({intent_id:p.clientOrderId,client_order_id:p.clientOrderId,created_at:stamp,updated_at:stamp,account_id:LIVE_ACCOUNT,
        strategy_version:String(p.request.strategy_version??LIVE_ENGINE),cycle_bucket:String(p.request.bucket??d.sessionDate),symbol:p.symbol,
        asset_type:'equity',side:p.side,order_type:'LIMIT',time_in_force:tif,quantity:dec(p.quantity),limit_price:dec(p.limitPrice),
        purpose:String(p.request.request_id),state:'SUBMITTING'}));
      const orphans=planned.filter(p=>p.request.orphan).map(p=>({request_id:p.request.request_id,bucket:d.sessionDate,decided_at:stamp,strategy_version:LIVE_ENGINE,
        symbol:p.symbol,action:'EXIT_ALL',fraction:1,reason:p.request.reason,state:'ORDERED',client_order_id:p.clientOrderId,created_at:stamp,updated_at:stamp}));
      for(const p of planned)if(!p.request.orphan)requestUpdates.push({request_id:p.request.request_id,from:'NEW',state:'ORDERED',detail:null,client_order_id:p.clientOrderId});
      skipped=requestUpdates.filter(u=>u.state!=='ORDERED').length;
      await db.batch([
        fence(db,owner),db.prepare('UPDATE live_control SET lease_until=? WHERE id=1 AND lease_owner=?').bind(Date.now()+LEASE_MS,owner),
        ingest(db,'broker_order_intents',intentRows,Object.keys(intentRows[0]),'ON CONFLICT DO NOTHING'),
        ...(orphans.length?[ingest(db,'live_mirror_requests',orphans,Object.keys(orphans[0]),'ON CONFLICT DO NOTHING')]:[]),
        requestUpdateStatement(db,requestUpdates.splice(0),stamp),
        db.prepare(`INSERT INTO live_daily(session_date,pnl_start,pnl_last,orders,buys_blocked,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(session_date) DO UPDATE SET orders=live_daily.orders+excluded.orders,updated_at=excluded.updated_at`)
          .bind(d.sessionDate,pnlStart,totalPnl,planned.length,buysBlocked,stamp),
      ]);
    }

    // ---- submit
    const toPoll:Intent[]=[];
    for(const p of planned){
      const id=p.clientOrderId,base:Intent={client_order_id:id,created_at:stamp,symbol:p.symbol,side:p.side,time_in_force:tif,
        quantity:dec(p.quantity),limit_price:dec(p.limitPrice),state:'SUBMITTING',broker_order_id:null};
      const notSent=(reason:string)=>{
        transition(run,id,'SUBMITTING','CANCELED',null,'NOT_SENT:'+reason);
        if(!p.request.orphan)requestUpdates.push({request_id:p.request.request_id,from:'ORDERED',state:'NEW',detail:'RETRY_NOT_SENT',client_order_id:null});
      };
      if(Date.now()-started>RUN_DEADLINE_MS){notSent('RUN_DEADLINE');continue;}
      try{
        const order=await broker.placeLimit({symbol:p.symbol,side:p.side,quantity:p.quantity,limitPrice:p.limitPrice,refId:await refIdFor(id),timeInForce:tif});
        if(order.state==='REJECTED'){
          transition(run,id,'SUBMITTING','REJECTED',order.id,order.rejectReason??'REJECTED');
          alerts.push(`MEDS live: ${p.side} ${p.quantity} ${p.symbol} @ ${p.limitPrice} rejected (${order.rejectReason??'no reason given'}).`);
        }else{
          transition(run,id,'SUBMITTING','SUBMITTED',order.id,null);run.linked.add(order.id);
          if(order.placedAgent&&norm(order.placedAgent)!=='user')run.newAgentLabel=order.placedAgent;
          toPoll.push({...base,state:'SUBMITTED',broker_order_id:order.id});
        }
      }catch(e){
        if(e instanceof NotSent){notSent(e.message);continue;}
        if(e instanceof OrderRejected&&e.placed==='no'){
          transition(run,id,'SUBMITTING','REJECTED',null,msg(e));
          alerts.push(`MEDS live: ${p.side} ${p.quantity} ${p.symbol} @ ${p.limitPrice} was refused before sending (${msg(e)}).`);
          continue;
        }
        // The place call errored or its response was lost: the order may exist.
        // It stays UNKNOWN (blocking this symbol) until found or ruled out.
        transition(run,id,'SUBMITTING','UNKNOWN',null,msg(e));
        if(e instanceof OrderRejected)alerts.push(`MEDS live: ${p.side} ${p.quantity} ${p.symbol} @ ${p.limitPrice} not accepted (${msg(e)}). Checking Robinhood's order list before writing it off.`);
      }
    }

    // ---- read fast fills back (immediate-or-cancel orders resolve at once)
    if(toPoll.length&&Date.now()-started<RUN_DEADLINE_MS){await d.sleep(FILL_SETTLE_MS);await resolve(run,toPoll,d.now(),false);}

    // ---- write everything and release
    const ownedOut=[...run.owned.values()].filter(o=>o.quantity>0n||o.realized!==0n)
      .map(o=>({symbol:o.symbol,quantity:formatUnits(o.quantity),cost_basis:formatUnits(o.cost),realized_pnl:formatUnits(o.realized)}));
    const state=halted?'HALTED':buysBlocked?'BUYS_BLOCKED':control.enabled?'LIVE':'OBSERVING';
    const submitted=[...run.transitions.values()].filter(t=>t.from==='SUBMITTING'&&!String(t.last_error??'').startsWith('NOT_SENT')).length;
    Object.assign(result,{state,orders_submitted:submitted,fills:run.fillCount,skipped,mismatches,unmanaged});
    const statements=[...extra,...ledgerStatements(run,stamp)];
    if(run.newAgentLabel&&run.newAgentLabel!==head.agent_label)statements.push(db.prepare('UPDATE live_control SET agent_label=? WHERE id=1').bind(run.newAgentLabel));
    if(requestUpdates.length)statements.push(requestUpdateStatement(db,requestUpdates,stamp));
    statements.push(
      db.prepare(`UPDATE live_sync SET synced_at=?,ok=1,state=?,error=NULL,buying_power=?,cash=?,equity=?,owned=?,broker_positions=?,reconciliation=?,
        mismatch_symbols=?,day_pnl=?,total_pnl=?,last_result=? WHERE id=1`)
        .bind(stamp,state,account.buyingPower,account.cash,account.equity,JSON.stringify(ownedOut),
          JSON.stringify(brokerPositions.map(p=>({symbol:p.symbol,quantity:p.quantity,available:p.available}))),
          JSON.stringify({state:mismatches.length?'MISMATCH':'MATCH',mismatches,unmanaged}),JSON.stringify(mismatches),dayPnl,totalPnl,JSON.stringify(result)),
      db.prepare(`INSERT INTO live_daily(session_date,pnl_start,pnl_last,orders,buys_blocked,updated_at) VALUES(?,?,?,0,?,?)
        ON CONFLICT(session_date) DO UPDATE SET pnl_start=COALESCE(live_daily.pnl_start,excluded.pnl_start),pnl_last=COALESCE(excluded.pnl_last,live_daily.pnl_last),
        buys_blocked=COALESCE(live_daily.buys_blocked,excluded.buys_blocked),updated_at=excluded.updated_at`).bind(d.sessionDate,pnlStart,totalPnl,buysBlocked,stamp),
    );
    await finish(statements);
    return {...result,day_pnl:dayPnl,total_pnl:totalPnl,buying_power:account.buyingPower};
  }catch(e){
    const message=msg(e);
    if(!(head?.sync_state==='ERROR'&&head?.sync_error===message))alerts.push(`MEDS live error: ${message}. Orders pause until the next successful sync.`);
    await finish([db.prepare(`UPDATE live_sync SET synced_at=?,ok=0,state='ERROR',error=? WHERE id=1`).bind(stamp,message)]).catch(()=>{});
    return {ok:false,error:message};
  }
}

function requestUpdateStatement(db:D1Database,rows:any[],stamp:string){
  return db.prepare(`UPDATE live_mirror_requests SET state=json_extract(j.value,'$.state'),detail=json_extract(j.value,'$.detail'),
    client_order_id=json_extract(j.value,'$.client_order_id'),updated_at=? FROM json_each(?) j
    WHERE live_mirror_requests.request_id=json_extract(j.value,'$.request_id') AND live_mirror_requests.state=json_extract(j.value,'$.from')`)
    .bind(stamp,JSON.stringify(rows));
}

// Fills, positions, order snapshots and intent transitions: four statements.
function ledgerStatements(run:Run,stamp:string){
  const db=run.db,ss:D1PreparedStatement[]=[];
  if(run.fills.length)ss.push(ingest(db,'broker_fills',run.fills,Object.keys(run.fills[0]),'ON CONFLICT DO NOTHING'));
  if(run.touched.size){
    const rows=[...run.touched].map(s=>run.owned.get(s)!).map(o=>({symbol:o.symbol,quantity:formatUnits(o.quantity),cost_basis:formatUnits(o.cost),
      realized_pnl:formatUnits(o.realized),opened_at:o.opened_at,updated_at:stamp}));
    ss.push(ingest(db,'live_positions',rows,Object.keys(rows[0]),'ON CONFLICT(symbol) DO UPDATE SET quantity=excluded.quantity,cost_basis=excluded.cost_basis,realized_pnl=excluded.realized_pnl,opened_at=excluded.opened_at,updated_at=excluded.updated_at'));
  }
  if(run.orders.size){
    // A journal of Robinhood's view; REPLACE can never fail on either unique key.
    const rows=[...run.orders.values()],cols=Object.keys(rows[0]);
    ss.push(db.prepare(`INSERT OR REPLACE INTO broker_orders(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE 1`).bind(JSON.stringify(rows)));
  }
  if(run.transitions.size){
    ss.push(db.prepare(`UPDATE broker_order_intents SET state=json_extract(j.value,'$.state'),
      broker_order_id=COALESCE(broker_order_intents.broker_order_id,json_extract(j.value,'$.broker_order_id')),last_error=json_extract(j.value,'$.last_error'),
      updated_at=?,revision=revision+1 FROM json_each(?) j
      WHERE broker_order_intents.client_order_id=json_extract(j.value,'$.client_order_id') AND broker_order_intents.state=json_extract(j.value,'$.from')`)
      .bind(stamp,JSON.stringify([...run.transitions.values()])));
  }
  return ss;
}

async function ingestMirror(db:D1Database,control:LiveControl,now:Date){
  if(!control.last_mirror_bucket){
    // First run: start from the latest committed cycle; never replay history into real orders.
    const latest=await db.prepare('SELECT MAX(bucket) b FROM leader_cycle_audit').first<any>();
    await db.prepare('UPDATE live_control SET last_mirror_bucket=? WHERE id=1').bind(latest?.b??now.toISOString()).run();
    return 0;
  }
  const rows=(await db.prepare(`SELECT bucket,json_extract(payload,'$.live_mirror') lm FROM leader_cycle_audit WHERE bucket>? ORDER BY bucket LIMIT 12`)
    .bind(control.last_mirror_bucket).all<any>()).results??[];
  if(!rows.length)return 0;
  const stamp=now.toISOString();
  const reqs:MirrorRow[]=rows.flatMap((r:any)=>{try{return JSON.parse(r.lm??'[]')??[];}catch{return [];}});
  const ss=[db.prepare('UPDATE live_control SET last_mirror_bucket=? WHERE id=1').bind(rows[rows.length-1].bucket)];
  if(reqs.length)ss.push(ingest(db,'live_mirror_requests',reqs.map(r=>({...r,state:'NEW',created_at:stamp,updated_at:stamp})),
    ['request_id','bucket','decided_at','strategy_version','symbol','action','fraction','paper_notional','paper_price','reason','state','created_at','updated_at'],
    'ON CONFLICT DO NOTHING'));
  await db.batch(ss);
  return reqs.length;
}

// A lost submission is matched only by an unlinked Robinhood order with the
// same symbol, side, quantity and limit price placed around the same time,
// not placed manually or by a different agent, and only when exactly one
// order fits. Anything else stays unresolved.
async function matchLostOrder(run:Run,intent:Intent,list:LiveOrder[]){
  const ref=await refIdFor(intent.client_order_id);
  const byRef=list.find(o=>o.refId===ref);
  if(byRef)return {order:run.linked.has(byRef.id)?null:byRef,ambiguous:false};
  const created=Date.parse(intent.created_at),qty=Number(intent.quantity),limit=Number(intent.limit_price);
  const fits=new Map(list.filter(o=>!o.refId&&!run.linked.has(o.id)&&o.symbol===intent.symbol&&o.side===intent.side&&o.orderType!=='market'
    &&!(o.placedAgent&&norm(o.placedAgent)==='user')&&!(run.agentLabel&&o.placedAgent&&o.placedAgent!==run.agentLabel)
    &&o.quantity!=null&&Math.abs(o.quantity-qty)<1e-9&&o.limitPrice!=null&&Math.abs(o.limitPrice-limit)<1e-6
    &&(!o.createdAt||(Date.parse(o.createdAt)>=created-10_000&&Date.parse(o.createdAt)<=created+5*60_000))).map(o=>[o.id,o]));
  return fits.size===1?{order:[...fits.values()][0],ambiguous:false}:{order:null,ambiguous:fits.size>1};
}

// Robinhood's order list is paged; an order not on the first page is looked
// up by symbol (a few pages back), at most MAX_SYMBOL_LOOKUPS symbols per run.
async function symbolOrders(run:Run,symbol:string,sinceMs:number){
  if(run.symbolLists.has(symbol))return run.symbolLists.get(symbol)!;
  if(run.lookups>=MAX_SYMBOL_LOOKUPS)return null;
  run.lookups++;
  let list:LiveOrder[]|null=null;
  try{list=await run.broker.ordersFor(symbol,sinceMs-60_000);}catch{list=null;}
  run.symbolLists.set(symbol,list);
  return list;
}

async function resolve(run:Run,intents:Intent[],now:Date,cancelAll:boolean):Promise<Intent[]>{
  const out:Intent[]=[];
  if(!intents.length)return out;
  let list:LiveOrder[]|null=null;
  try{list=await run.broker.recentOrders();}catch{/* unresolved this run */}
  const byId=new Map((list??[]).map(o=>[o.id,o]));
  for(const intent of intents){
    const age=now.getTime()-Date.parse(intent.created_at),dbState=intent.state,since=Date.parse(intent.created_at);
    if(dbState==='INTENDED'){transition(run,intent.client_order_id,dbState,'CANCELED',null,'NEVER_SUBMITTED');continue;}
    if(!list){out.push(intent);continue;} // Robinhood's order list is unreadable this run
    let order:LiveOrder|null=null,ambiguous=false;
    if(intent.broker_order_id){
      order=byId.get(intent.broker_order_id)??null;
      if(!order&&run.broker.canLookupOrder){try{order=await run.broker.order(intent.broker_order_id);}catch{}}
      if(!order)order=(await symbolOrders(run,intent.symbol,since))?.find(o=>o.id===intent.broker_order_id)??null;
    }else{
      let m=await matchLostOrder(run,intent,list);
      if(!m.order){const bySymbol=await symbolOrders(run,intent.symbol,since);if(bySymbol){const again=await matchLostOrder(run,intent,bySymbol);if(again.order||again.ambiguous)m=again;}}
      order=m.order;ambiguous=m.ambiguous;
      if(order)run.linked.add(order.id);
    }
    if(order){
      const next=await applyOrder(run,intent,order,now,age,cancelAll);
      out.push({...intent,state:next,broker_order_id:order.id});
      continue;
    }
    unresolved(run,intent,age,ambiguous,out);
  }
  return out;
}

// An order MEDS cannot find. While there is time it stays pending (blocking
// its symbol). After that it is never guessed in the direction that could
// sell shares MEDS does not own: a sell is assumed to have happened (MEDS
// stops counting those shares), a buy is assumed not to have happened, and
// in both cases new buys halt until the operator checks the account.
function unresolved(run:Run,intent:Intent,age:number,ambiguous:boolean,out:Intent[]){
  const id=intent.client_order_id,dbState=intent.state;
  const toolRefused=String(intent.last_error??'').startsWith('ORDER_REJECTED');
  if(!intent.broker_order_id&&dbState==='SUBMITTING'&&age>UNKNOWN_AFTER_MS){
    transition(run,id,dbState,'UNKNOWN',null,intent.last_error??'SUBMIT_OUTCOME_UNKNOWN');
    out.push({...intent,state:'UNKNOWN'});return;
  }
  const giveUp=intent.broker_order_id?age>NOT_VISIBLE_GIVE_UP_MS:dbState==='UNKNOWN'&&age>UNKNOWN_GIVE_UP_MS;
  if(!giveUp){out.push({...intent,state:run.transitions.get(id)?.state??dbState});return;}
  // Robinhood refused the buy outright and no such order exists: it was not placed.
  if(intent.side==='BUY'&&toolRefused&&!intent.broker_order_id&&!ambiguous){transition(run,id,dbState,'CANCELED',null,intent.last_error!);return;}
  const what=`${intent.side} ${Number(intent.quantity)} ${intent.symbol} @ ${Number(intent.limit_price)}`;
  const why=ambiguous?'more than one Robinhood order matches it':intent.broker_order_id?'it no longer appears in Robinhood\'s order history':'it cannot be found in Robinhood\'s order history';
  if(intent.side==='SELL'){
    const o=run.owned.get(intent.symbol);
    if(o&&o.quantity>0n){
      const q=units(intent.quantity),gone=q>o.quantity?o.quantity:q,basis=mul(gone,div(o.cost,o.quantity));
      o.cost-=basis;o.quantity-=gone;if(o.quantity<=0n){o.quantity=0n;o.cost=0n;o.opened_at=null;}
      run.touched.add(intent.symbol);
    }
    transition(run,id,dbState,'CANCELED',null,'UNRESOLVED_ASSUMED_SOLD');
    run.alerts.push(`MEDS live HALTED new buys: the order ${what} is unresolved (${why}). MEDS assumes it sold and stopped counting those shares, so it can never sell them twice. Check the order history, then press Clear halt.`);
  }else{
    transition(run,id,dbState,'CANCELED',null,'UNRESOLVED_BUY');
    run.alerts.push(`MEDS live HALTED new buys: the order ${what} is unresolved (${why}). If it filled, those shares are outside MEDS's count and MEDS will not sell them. Check the order history, then press Clear halt.`);
  }
  run.halts.push(`UNRESOLVED_ORDER:${intent.side} ${intent.symbol}`);
}

// Records new fill quantity as the difference between Robinhood's cumulative
// fill and what MEDS has already recorded for this intent, so the same shares
// can never be counted twice however Robinhood reports them.
async function applyOrder(run:Run,intent:Intent,order:LiveOrder,now:Date,age:number,cancelAll:boolean){
  const id=intent.client_order_id,stamp=now.toISOString();
  const rec=run.recorded.get(id)??{qty:0n,notional:0n,fees:0n};
  const execQty=order.executions.reduce((n,e)=>n+units(e.quantity),0n);
  const cum=maxBig(units(order.filledQuantity),execQty);
  if(cum>rec.qty){
    let cumNotional:bigint,source:string;
    if(order.executions.length&&execQty===cum&&order.executions.every(e=>e.price>0)){
      cumNotional=order.executions.reduce((n,e)=>n+mul(units(e.quantity),units(e.price)),0n);source='executions';
    }else if(order.averagePrice&&order.averagePrice>0){cumNotional=mul(cum,units(order.averagePrice));source='average_price';}
    else{cumNotional=mul(cum,units(intent.limit_price));source='limit_estimate';}
    const execFees=order.executions.reduce((n,e)=>n+units(e.fee),0n);
    const cumFees=maxBig(execFees,units(order.fees??0));
    const dq=cum-rec.qty,derived=div(cumNotional-rec.notional,dq),price=derived>0n?derived:units(intent.limit_price);
    const fee=cumFees>rec.fees?cumFees-rec.fees:0n;
    run.recorded.set(id,{qty:cum,notional:cumNotional,fees:maxBig(cumFees,rec.fees)});
    run.fills.push({fill_id:`${order.id}:${formatUnits(cum)}`,broker_order_id:order.id,client_order_id:id,symbol:intent.symbol,side:intent.side,
      quantity:formatUnits(dq),price:formatUnits(price),fee:formatUnits(fee),filled_at:order.updatedAt??stamp,
      raw_json:JSON.stringify({source,cumulative:formatUnits(cum),state:order.rawState})});
    run.fillCount++;run.touched.add(intent.symbol);
    const o=run.owned.get(intent.symbol)??{symbol:intent.symbol,quantity:0n,cost:0n,realized:0n,opened_at:null};
    if(intent.side==='BUY'){o.quantity+=dq;o.cost+=mul(dq,price)+fee;o.opened_at=o.opened_at??(order.updatedAt??stamp);}
    else{
      const sold=dq>o.quantity?o.quantity:dq,avg=o.quantity>0n?div(o.cost,o.quantity):0n,basis=mul(sold,avg);
      o.realized+=mul(sold,price)-basis-fee;o.cost-=basis;o.quantity-=sold;
      if(o.quantity<=0n){o.quantity=0n;o.cost=0n;o.opened_at=null;}
    }
    run.owned.set(intent.symbol,o);
    run.alerts.push(`MEDS live ${intent.side==='BUY'?'bought':'sold'} ${formatUnits(dq).replace(/\.?0+$/,'')} ${intent.symbol} @ ${toNum(price).toFixed(4)}`);
    if(source==='limit_estimate')run.alerts.push(`MEDS live: Robinhood did not report a fill price for ${intent.symbol}; recorded at the limit price ${Number(intent.limit_price)}.`);
  }
  // A FILLED state reported before its filled quantity catches up is kept
  // open (and polled again) for a while, so late fills are still recorded.
  const lagging=order.state==='FILLED'&&order.quantity!=null&&cum+1000n<units(order.quantity)&&age<FILL_LAG_GRACE_MS;
  let next:string=lagging?'PARTIALLY_FILLED':order.state;
  if(next==='SUBMITTED'&&cum>0n)next='PARTIALLY_FILLED';
  const open=OPEN_AT_BROKER.includes(next),cancellable=OPEN_AT_BROKER.includes(order.state);
  if(cancellable&&intent.state!=='CANCEL_REQUESTED'&&(cancelAll||age>run.control.order_ttl_seconds*1000)&&run.cancels<MAX_CANCELS_PER_RUN){
    try{await run.broker.cancel(order.id);run.cancels++;next='CANCEL_REQUESTED';}catch{/* retried next run */}
  }
  if(intent.state==='CANCEL_REQUESTED'&&open)next='CANCEL_REQUESTED';
  if(order.state==='REJECTED')run.alerts.push(`MEDS live: ${intent.side} ${intent.symbol} rejected by Robinhood (${order.rejectReason??'no reason given'}).`);
  transition(run,id,intent.state,next,order.id,order.state==='REJECTED'?(order.rejectReason??'REJECTED'):null);
  run.orders.set(order.id,{broker_order_id:order.id,client_order_id:id,symbol:intent.symbol,side:intent.side,state:order.rawState,
    quantity:intent.quantity,filled_quantity:formatUnits(cum),limit_price:intent.limit_price,updated_at:stamp,
    raw_json:JSON.stringify({state:order.rawState,filled:order.filledQuantity,avg:order.averagePrice,fees:order.fees,placed_agent:order.placedAgent,reject:order.rejectReason})});
  return next;
}

// ---------------------------------------------------------------- operator controls and status

export const LIVE_LIMIT_FIELDS=['max_capital','max_order_notional','max_orders_per_day','daily_loss_limit','order_ttl_seconds',
  'buy_limit_buffer_pct','sell_limit_buffer_pct','max_chase_pct','max_spread_pct','request_ttl_seconds'] as const;
export async function setLiveEnabled(db:D1Database,enabled:boolean,now=new Date()){
  await db.prepare('UPDATE live_control SET enabled=?,updated_at=? WHERE id=1').bind(enabled?1:0,now.toISOString()).run();
}
// Clearing a halt accepts Robinhood's share counts from the latest sync for
// the symbols that sync found short: MEDS's recorded quantity is lowered to
// what Robinhood actually holds (cost basis reduced proportionally), so a
// position sold outside MEDS stops re-halting. It takes the live lease, so it
// never races a running live step, and needs a successful sync from the last
// ten minutes.
export async function clearLiveHalt(db:D1Database,now=new Date()){
  const owner=crypto.randomUUID(),at=Date.now();
  const claim=await db.prepare('UPDATE live_control SET lease_owner=?,lease_until=? WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)').bind(owner,at+LEASE_MS,at).run();
  if(!claim.meta.changes)throw new Error('A live step is running; try again in a minute.');
  const release=db.prepare('UPDATE live_control SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?').bind(owner);
  try{
    const [sync,owned]=await Promise.all([
      db.prepare('SELECT synced_at,ok,broker_positions,mismatch_symbols FROM live_sync WHERE id=1').first<any>(),
      db.prepare('SELECT * FROM live_positions').all<any>().then(r=>r.results??[]),
    ]);
    if(!sync?.ok||!(now.getTime()-Date.parse(sync.synced_at??'')<10*60_000))throw new Error('No successful sync in the last ten minutes; run a live step first.');
    const short=new Set<string>(JSON.parse(sync.mismatch_symbols||'[]'));
    const broker=new Map<string,number>((JSON.parse(sync.broker_positions||'[]') as any[]).map(p=>[String(p.symbol),Number(p.quantity)]));
    const stamp=now.toISOString(),adjusted:any[]=[];
    for(const o of owned){
      if(!short.has(o.symbol))continue;
      const mine=units(o.quantity),held=units(broker.get(o.symbol)??0);
      if(mine>0n&&held<mine){
        const cost=units(o.cost_basis),kept=held>0n?div(mul(cost,held),mine):0n;
        adjusted.push({symbol:o.symbol,quantity:formatUnits(held),cost_basis:formatUnits(kept),realized_pnl:o.realized_pnl,opened_at:held>0n?o.opened_at:null,updated_at:stamp});
      }
    }
    await db.batch([
      fence(db,owner),
      db.prepare('UPDATE live_control SET halted_reason=NULL,updated_at=? WHERE id=1').bind(stamp),
      db.prepare(`UPDATE live_sync SET mismatch_symbols='[]' WHERE id=1`),
      ...(adjusted.length?[ingest(db,'live_positions',adjusted,Object.keys(adjusted[0]),'ON CONFLICT(symbol) DO UPDATE SET quantity=excluded.quantity,cost_basis=excluded.cost_basis,opened_at=excluded.opened_at,updated_at=excluded.updated_at')]:[]),
      release,
    ]);
    return adjusted.map(a=>a.symbol);
  }catch(e){
    await release.run().catch(()=>{});
    throw e;
  }
}
export async function setLiveLimits(db:D1Database,input:Record<string,unknown>,now=new Date()){
  const sets:string[]=[],args:unknown[]=[];
  for(const f of LIVE_LIMIT_FIELDS){
    if(input[f]==null||input[f]==='')continue;
    const n=Number(input[f]);
    if(!Number.isFinite(n))throw new Error('INVALID_'+f.toUpperCase());
    sets.push(f+'=?');args.push(n);
  }
  if(!sets.length)return 0;
  await db.prepare(`UPDATE live_control SET ${sets.join(',')},updated_at=? WHERE id=1`).bind(...args,now.toISOString()).run();
  return sets.length;
}
// Error text for public pages: long digit runs (account or order numbers) are masked.
export const publicError=(e:unknown)=>e==null?null:String(e).replace(/\d{5,}/g,'#').slice(0,160);
export async function liveStatus(db:D1Database,detail:boolean){
  const [control,sync,daily,counts]=await Promise.all([
    db.prepare('SELECT * FROM live_control WHERE id=1').first<any>(),
    db.prepare('SELECT * FROM live_sync WHERE id=1').first<any>(),
    db.prepare('SELECT * FROM live_daily ORDER BY session_date DESC LIMIT 1').first<any>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM broker_order_intents WHERE account_id=?1 AND state IN('INTENDED','SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_REQUESTED','UNKNOWN')) pending,
      (SELECT COUNT(*) FROM broker_order_intents WHERE account_id=?1 AND state='UNKNOWN') unknown_orders,
      (SELECT COUNT(*) FROM broker_fills f JOIN broker_order_intents i USING(client_order_id) WHERE i.account_id=?1) fills,
      (SELECT COUNT(*) FROM live_positions WHERE CAST(quantity AS REAL)>0) open_positions`).bind(LIVE_ACCOUNT).first<any>(),
  ]);
  let reconciliation:string|null=null;
  try{reconciliation=JSON.parse(sync?.reconciliation??'null')?.state??null;}catch{}
  const base={
    live_execution:!!control?.enabled,state:sync?.state??'NOT_CONNECTED',halted_reason:control?.halted_reason??null,
    last_sync_at:sync?.synced_at??null,last_sync_ok:!!sync?.ok,last_error:detail?sync?.error??null:publicError(sync?.error),
    session_date:daily?.session_date??null,orders_today:Number(daily?.orders??0),buys_blocked:daily?.buys_blocked??null,
    pending_orders:Number(counts?.pending??0),unknown_orders:Number(counts?.unknown_orders??0),fills:Number(counts?.fills??0),
    open_positions:Number(counts?.open_positions??0),reconciliation,
    limits:control?Object.fromEntries(LIVE_LIMIT_FIELDS.map(f=>[f,control[f]])):null,
  };
  if(!detail)return base;
  const recent=(await db.prepare(`SELECT i.created_at,i.symbol,i.side,i.quantity,i.limit_price,i.time_in_force,i.state,i.last_error,i.purpose,
      (SELECT SUM(CAST(quantity AS REAL)) FROM broker_fills f WHERE f.client_order_id=i.client_order_id) filled,
      (SELECT SUM(CAST(quantity AS REAL)*CAST(price AS REAL))/SUM(CAST(quantity AS REAL)) FROM broker_fills f WHERE f.client_order_id=i.client_order_id) avg_fill
      FROM broker_order_intents i WHERE i.account_id=? ORDER BY i.created_at DESC LIMIT 25`).bind(LIVE_ACCOUNT).all<any>()).results??[];
  const requests=(await db.prepare('SELECT decided_at,symbol,action,reason,state,detail,paper_price FROM live_mirror_requests ORDER BY decided_at DESC LIMIT 25').all<any>()).results??[];
  return {...base,buying_power:sync?.buying_power??null,cash:sync?.cash??null,equity:sync?.equity??null,day_pnl:sync?.day_pnl??null,total_pnl:sync?.total_pnl??null,
    owned:JSON.parse(sync?.owned||'[]'),broker_positions:JSON.parse(sync?.broker_positions||'[]'),reconciliation_detail:JSON.parse(sync?.reconciliation||'null'),
    recent_orders:recent,recent_requests:requests};
}
