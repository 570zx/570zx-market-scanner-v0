// Broker boundary scaffolding for MEDS real-capital readiness.
//
// IMPORTANT: production MEDS does not instantiate a brokerage adapter and this
// module deliberately has no LIVE mode. It provides durable intent,
// reconciliation and exact-decimal primitives that can be exercised against a
// fake broker or, later, a separately authorized paper/observe adapter.

export type BrokerMode='DISABLED'|'OBSERVE'|'PAPER';
export type IntentState='INTENDED'|'SUBMITTING'|'SUBMITTED'|'PARTIALLY_FILLED'|'FILLED'|'CANCEL_REQUESTED'|'CANCELED'|'REJECTED'|'UNKNOWN';
export type BrokerSide='BUY'|'SELL';
export type BrokerAssetType='equity'|'option';
export type SessionPhase='regular'|'premarket'|'postmarket'|'overnight'|'closed';

const DECIMAL=/^-?(?:(?:0|[1-9]\d*)(?:\.\d{1,8})?|\.\d{1,8})$/;
export function canonicalDecimal(value:string|number|bigint,scale=8):string{
  const raw=typeof value==='string'?value:typeof value==='bigint'?value.toString():String(value);
  if(!DECIMAL.test(raw))throw new Error('INVALID_DECIMAL');
  const neg=raw.startsWith('-'),unsigned=neg?raw.slice(1):raw,[wholeRaw,frac='']=unsigned.split('.'),whole=wholeRaw||'0';
  const padded=(frac+'0'.repeat(scale)).slice(0,scale);
  if(frac.length>scale)throw new Error('DECIMAL_SCALE_EXCEEDED');
  const body=scale?BigInt(whole).toString()+'.'+padded:BigInt(whole).toString();
  return (neg&&BigInt(whole+padded)!==0n?'-':'')+body;
}
export function decimalUnits(value:string|number|bigint,scale=8):bigint{
  const c=canonicalDecimal(value,scale),neg=c.startsWith('-'),u=neg?c.slice(1):c,[whole,frac='']=u.split('.');
  const n=BigInt(whole)*10n**BigInt(scale)+BigInt(frac||'0');
  return neg?-n:n;
}
export function formatUnits(units:bigint,scale=8):string{
  const neg=units<0n,n=neg?-units:units,base=10n**BigInt(scale),whole=n/base,frac=(n%base).toString().padStart(scale,'0');
  return (neg?'-':'')+whole.toString()+(scale?'.'+frac:'');
}
export const decimalEqual=(a:string|number|bigint,b:string|number|bigint,scale=8)=>decimalUnits(a,scale)===decimalUnits(b,scale);

export type BrokerAccountState={
  accountId:string;cash:string;buyingPower:string;equity:string;status:string;asOf:string;
};
export type BrokerPosition={
  symbol:string;assetType:BrokerAssetType;quantity:string;avgEntryPrice:string;marketValue?:string|null;
};
export type BrokerOrder={
  brokerOrderId:string;clientOrderId:string;symbol:string;side:BrokerSide;state:string;
  quantity?:string|null;filledQuantity?:string|null;limitPrice?:string|null;updatedAt:string;
};
export type BrokerFill={
  fillId:string;brokerOrderId:string;clientOrderId:string;symbol:string;side:BrokerSide;
  quantity:string;price:string;fee?:string|null;filledAt:string;
};
export type AssetCapabilities={
  symbol:string;assetType:BrokerAssetType;status:string;tradable:boolean;fractionable:boolean;
  extendedHours:boolean;overnight:boolean;halted:boolean;
};
export type BrokerClock={phase:SessionPhase;tradingDay:boolean;asOf:string};
export type ExecutionQuote={symbol:string;bid:string;ask:string;asOf:string;authoritative:boolean};
export type SubmitOrder={
  clientOrderId:string;symbol:string;assetType:BrokerAssetType;side:BrokerSide;orderType:'MARKET'|'LIMIT';
  timeInForce:string;quantity?:string|null;notional?:string|null;limitPrice?:string|null;
};

export interface BrokerAdapter{
  readonly mode:BrokerMode;
  getAccount():Promise<BrokerAccountState>;
  getClock():Promise<BrokerClock>;
  getAsset(symbol:string):Promise<AssetCapabilities>;
  getExecutionQuote(symbol:string):Promise<ExecutionQuote>;
  listPositions():Promise<BrokerPosition[]>;
  listOpenOrders():Promise<BrokerOrder[]>;
  listFills(since:string):Promise<BrokerFill[]>;
  getOrderByClientId(clientOrderId:string):Promise<BrokerOrder|null>;
  submitOrder(order:SubmitOrder):Promise<BrokerOrder>;
  cancelOrder(brokerOrderId:string):Promise<BrokerOrder>;
}

export class DisabledBrokerAdapter implements BrokerAdapter{
  readonly mode:BrokerMode='DISABLED';
  private disabled():never{throw new Error('BROKER_CONNECTION_DISABLED');}
  async getAccount(){return this.disabled();}
  async getClock(){return this.disabled();}
  async getAsset(_symbol:string){return this.disabled();}
  async getExecutionQuote(_symbol:string){return this.disabled();}
  async listPositions(){return this.disabled();}
  async listOpenOrders(){return this.disabled();}
  async listFills(_since:string){return this.disabled();}
  async getOrderByClientId(_clientOrderId:string){return this.disabled();}
  async submitOrder(_order:SubmitOrder):Promise<BrokerOrder>{throw new Error('BROKER_EXECUTION_DISABLED');}
  async cancelOrder(_brokerOrderId:string):Promise<BrokerOrder>{throw new Error('BROKER_EXECUTION_DISABLED');}
}

export type ExecutionEligibilityRequest={
  phase:SessionPhase;fractional:boolean;asset:AssetCapabilities;quote:ExecutionQuote;clock:BrokerClock;
};
export function executionEligibility(x:ExecutionEligibilityRequest){
  const reasons:string[]=[];
  if(!x.clock.tradingDay||x.phase==='closed')reasons.push('MARKET_SESSION_CLOSED');
  if(x.asset.status!=='active')reasons.push('ASSET_NOT_ACTIVE');
  if(!x.asset.tradable)reasons.push('ASSET_NOT_TRADABLE');
  if(x.asset.halted)reasons.push('ASSET_HALTED');
  if(x.fractional&&!x.asset.fractionable)reasons.push('ASSET_NOT_FRACTIONABLE');
  if(['premarket','postmarket'].includes(x.phase)&&!x.asset.extendedHours)reasons.push('ASSET_NOT_EXTENDED_HOURS_ELIGIBLE');
  if(x.phase==='overnight'&&!x.asset.overnight)reasons.push('ASSET_NOT_OVERNIGHT_ELIGIBLE');
  if(!x.quote.authoritative)reasons.push('EXECUTION_QUOTE_NOT_AUTHORITATIVE');
  const bid=decimalUnits(x.quote.bid),ask=decimalUnits(x.quote.ask);
  if(bid<=0n||ask<bid)reasons.push('EXECUTION_QUOTE_INVALID');
  return {eligible:reasons.length===0,reasons};
}

export type IntentDraft={
  accountId:string;strategyVersion:string;cycleBucket:string;symbol:string;assetType:BrokerAssetType;
  side:BrokerSide;orderType:'MARKET'|'LIMIT';timeInForce:string;quantity?:string|null;notional?:string|null;
  limitPrice?:string|null;purpose:string;
};
const enc=new TextEncoder();
export async function deterministicClientOrderId(x:IntentDraft){
  const material=[x.accountId,x.strategyVersion,x.cycleBucket,x.symbol,x.assetType,x.side,x.orderType,x.timeInForce,x.quantity??'',x.notional??'',x.limitPrice??'',x.purpose].join('|');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(material)));
  const hex=[...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
  return 'meds-'+hex.slice(0,40);
}

export const BROKER_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS broker_runtime_config(
    id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN('DISABLED','OBSERVE','PAPER')),
    live_execution INTEGER NOT NULL DEFAULT 0 CHECK(live_execution=0),account_id TEXT,updated_at TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO broker_runtime_config(id,mode,live_execution,account_id,updated_at)
    VALUES(1,'DISABLED',0,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `CREATE TABLE IF NOT EXISTS broker_order_intents(
    intent_id TEXT PRIMARY KEY,client_order_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    account_id TEXT NOT NULL,strategy_version TEXT NOT NULL,cycle_bucket TEXT NOT NULL,symbol TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK(asset_type IN('equity','option')),side TEXT NOT NULL CHECK(side IN('BUY','SELL')),
    order_type TEXT NOT NULL CHECK(order_type IN('MARKET','LIMIT')),time_in_force TEXT NOT NULL,
    quantity TEXT,notional TEXT,limit_price TEXT,purpose TEXT NOT NULL,state TEXT NOT NULL,
    broker_order_id TEXT,last_error TEXT,revision INTEGER NOT NULL DEFAULT 0,
    CHECK((quantity IS NULL) <> (notional IS NULL)))`,
  `CREATE INDEX IF NOT EXISTS idx_broker_intent_state ON broker_order_intents(state,updated_at)`,
  `CREATE TABLE IF NOT EXISTS broker_transition_guard(id INTEGER PRIMARY KEY CHECK(id=1),client_order_id TEXT NOT NULL,expected_state TEXT NOT NULL,checked_at TEXT NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS broker_transition_state_guard BEFORE INSERT ON broker_transition_guard
    WHEN NOT EXISTS(SELECT 1 FROM broker_order_intents WHERE client_order_id=NEW.client_order_id AND state=NEW.expected_state)
    BEGIN SELECT RAISE(ABORT,'broker intent state conflict'); END`,
  `CREATE TABLE IF NOT EXISTS broker_order_events(
    event_key TEXT PRIMARY KEY,intent_id TEXT NOT NULL,created_at TEXT NOT NULL,event_type TEXT NOT NULL,payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_orders(
    broker_order_id TEXT PRIMARY KEY,client_order_id TEXT NOT NULL UNIQUE,symbol TEXT NOT NULL,side TEXT NOT NULL,
    state TEXT NOT NULL,quantity TEXT,filled_quantity TEXT,limit_price TEXT,updated_at TEXT NOT NULL,raw_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_fills(
    fill_id TEXT PRIMARY KEY,broker_order_id TEXT NOT NULL,client_order_id TEXT NOT NULL,symbol TEXT NOT NULL,side TEXT NOT NULL,
    quantity TEXT NOT NULL,price TEXT NOT NULL,fee TEXT NOT NULL DEFAULT '0.00000000',filled_at TEXT NOT NULL,raw_json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_broker_fill_client ON broker_fills(client_order_id,filled_at)`,
  `CREATE TABLE IF NOT EXISTS broker_account_snapshots(
    snapshot_at TEXT PRIMARY KEY,account_id TEXT NOT NULL,cash TEXT NOT NULL,buying_power TEXT NOT NULL,equity TEXT NOT NULL,status TEXT NOT NULL,raw_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_position_snapshots(
    snapshot_at TEXT NOT NULL,symbol TEXT NOT NULL,asset_type TEXT NOT NULL,quantity TEXT NOT NULL,avg_entry_price TEXT NOT NULL,market_value TEXT,raw_json TEXT NOT NULL,
    PRIMARY KEY(snapshot_at,symbol))`,
  `CREATE TABLE IF NOT EXISTS broker_asset_cache(
    symbol TEXT PRIMARY KEY,checked_at TEXT NOT NULL,asset_type TEXT NOT NULL,status TEXT NOT NULL,tradable INTEGER NOT NULL,fractionable INTEGER NOT NULL,
    extended_hours INTEGER NOT NULL,overnight INTEGER NOT NULL,halted INTEGER NOT NULL,raw_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_reconciliations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('MATCH','MISMATCH','UNAVAILABLE')),
    cash_match INTEGER NOT NULL,positions_match INTEGER NOT NULL,orders_match INTEGER NOT NULL,mismatches TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_observation_cycles(
    created_at TEXT PRIMARY KEY,mode TEXT NOT NULL,phase TEXT NOT NULL,trading_day INTEGER NOT NULL,
    reconciliation_state TEXT NOT NULL,positions INTEGER NOT NULL,open_orders INTEGER NOT NULL,fills INTEGER NOT NULL,assets_checked INTEGER NOT NULL)`,
];

export async function ensureBrokerSchema(db:D1Database){await db.batch(BROKER_SCHEMA.map(sql=>db.prepare(sql)));}

function validateIntent(d:IntentDraft){
  if((d.quantity==null)===(d.notional==null))throw new Error('INTENT_REQUIRES_EXACTLY_ONE_OF_QUANTITY_OR_NOTIONAL');
  if(d.quantity!=null&&decimalUnits(d.quantity)<=0n)throw new Error('INTENT_QUANTITY_INVALID');
  if(d.notional!=null&&decimalUnits(d.notional)<=0n)throw new Error('INTENT_NOTIONAL_INVALID');
  if(d.limitPrice!=null&&decimalUnits(d.limitPrice)<=0n)throw new Error('INTENT_LIMIT_INVALID');
}
export async function createOrderIntent(db:D1Database,draft:IntentDraft,now=new Date()){
  validateIntent(draft);
  const clientOrderId=await deterministicClientOrderId(draft),stamp=now.toISOString();
  const quantity=draft.quantity==null?null:canonicalDecimal(draft.quantity),notional=draft.notional==null?null:canonicalDecimal(draft.notional);
  const limitPrice=draft.limitPrice==null?null:canonicalDecimal(draft.limitPrice);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO broker_order_intents(intent_id,client_order_id,created_at,updated_at,account_id,strategy_version,cycle_bucket,symbol,asset_type,side,order_type,time_in_force,quantity,notional,limit_price,purpose,state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(clientOrderId,clientOrderId,stamp,stamp,draft.accountId,draft.strategyVersion,draft.cycleBucket,draft.symbol,draft.assetType,draft.side,draft.orderType,draft.timeInForce,quantity,notional,limitPrice,draft.purpose,'INTENDED'),
    db.prepare('INSERT OR IGNORE INTO broker_order_events(event_key,intent_id,created_at,event_type,payload) VALUES(?,?,?,?,?)')
      .bind(clientOrderId+':INTENDED',clientOrderId,stamp,'INTENDED',JSON.stringify({draft:{...draft,quantity,notional,limitPrice}})),
  ]);
  return db.prepare('SELECT * FROM broker_order_intents WHERE client_order_id=?').bind(clientOrderId).first<any>();
}

const ALLOWED:Record<IntentState,IntentState[]>={
  INTENDED:['SUBMITTING','CANCELED'],SUBMITTING:['SUBMITTED','UNKNOWN','REJECTED'],SUBMITTED:['PARTIALLY_FILLED','FILLED','CANCEL_REQUESTED','REJECTED','UNKNOWN'],
  PARTIALLY_FILLED:['FILLED','CANCEL_REQUESTED','CANCELED','UNKNOWN'],FILLED:[],CANCEL_REQUESTED:['CANCELED','PARTIALLY_FILLED','FILLED','UNKNOWN'],
  CANCELED:[],REJECTED:[],UNKNOWN:['SUBMITTED','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED'],
};
export async function transitionIntent(db:D1Database,clientOrderId:string,from:IntentState,to:IntentState,patch:{brokerOrderId?:string|null;error?:string|null}={},now=new Date()){
  if(!ALLOWED[from].includes(to))throw new Error('INVALID_INTENT_TRANSITION');
  const stamp=now.toISOString(),eventKey=clientOrderId+':'+from+'>'+to+':'+stamp;
  try{
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO broker_transition_guard(id,client_order_id,expected_state,checked_at) VALUES(1,?,?,?)').bind(clientOrderId,from,stamp),
      db.prepare(`UPDATE broker_order_intents SET state=?,broker_order_id=COALESCE(?,broker_order_id),last_error=?,updated_at=?,revision=revision+1
        WHERE client_order_id=? AND state=?`).bind(to,patch.brokerOrderId??null,patch.error??null,stamp,clientOrderId,from),
      db.prepare('INSERT INTO broker_order_events(event_key,intent_id,created_at,event_type,payload) VALUES(?,?,?,?,?)')
        .bind(eventKey,clientOrderId,stamp,'STATE_TRANSITION',JSON.stringify({from,to,...patch})),
    ]);
  }catch(error){
    if(String(error).includes('broker intent state conflict'))throw new Error('INTENT_STATE_CONFLICT');
    throw error;
  }
}

export async function recordBrokerOrder(db:D1Database,o:BrokerOrder){
  await db.prepare(`INSERT INTO broker_orders(broker_order_id,client_order_id,symbol,side,state,quantity,filled_quantity,limit_price,updated_at,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(broker_order_id) DO UPDATE SET state=excluded.state,quantity=excluded.quantity,
    filled_quantity=excluded.filled_quantity,limit_price=excluded.limit_price,updated_at=excluded.updated_at,raw_json=excluded.raw_json`)
    .bind(o.brokerOrderId,o.clientOrderId,o.symbol,o.side,o.state,o.quantity==null?null:canonicalDecimal(o.quantity),
      o.filledQuantity==null?null:canonicalDecimal(o.filledQuantity),o.limitPrice==null?null:canonicalDecimal(o.limitPrice),o.updatedAt,JSON.stringify(o)).run();
}

export async function recordBrokerFill(db:D1Database,f:BrokerFill){
  await db.prepare(`INSERT OR IGNORE INTO broker_fills(fill_id,broker_order_id,client_order_id,symbol,side,quantity,price,fee,filled_at,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(f.fillId,f.brokerOrderId,f.clientOrderId,f.symbol,f.side,canonicalDecimal(f.quantity),
      canonicalDecimal(f.price),canonicalDecimal(f.fee??'0'),f.filledAt,JSON.stringify(f)).run();
}
export async function filledQuantity(db:D1Database,clientOrderId:string){
  const rows=await db.prepare('SELECT quantity FROM broker_fills WHERE client_order_id=?').bind(clientOrderId).all<any>();
  return formatUnits((rows.results??[]).reduce((n,r)=>n+decimalUnits(r.quantity),0n));
}
export async function pendingBrokerIntents(db:D1Database){
  const r=await db.prepare(`SELECT * FROM broker_order_intents WHERE state IN('INTENDED','SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_REQUESTED','UNKNOWN') ORDER BY created_at`).all<any>();
  return r.results??[];
}

export type ReconciliationExpected={cash:string;positions:BrokerPosition[];openClientOrderIds:string[]};
export type ReconciliationObserved={cash:string;positions:BrokerPosition[];openOrders:BrokerOrder[]};
export function reconcileBrokerState(expected:ReconciliationExpected,observed:ReconciliationObserved){
  const mismatches:string[]=[];
  if(!decimalEqual(expected.cash,observed.cash))mismatches.push('CASH_MISMATCH');
  const e=new Map(expected.positions.map(p=>[p.symbol,p])),o=new Map(observed.positions.map(p=>[p.symbol,p]));
  for(const symbol of new Set([...e.keys(),...o.keys()])){
    const a=e.get(symbol),b=o.get(symbol);
    if(!a||!b||a.assetType!==b.assetType||!decimalEqual(a.quantity,b.quantity)||!decimalEqual(a.avgEntryPrice,b.avgEntryPrice))
      mismatches.push('POSITION_MISMATCH:'+symbol);
  }
  const expectedOrders=new Set(expected.openClientOrderIds),observedOrders=new Set(observed.openOrders.map(x=>x.clientOrderId));
  for(const id of new Set([...expectedOrders,...observedOrders]))if(expectedOrders.has(id)!==observedOrders.has(id))mismatches.push('ORDER_MISMATCH:'+id);
  return {state:mismatches.length?'MISMATCH':'MATCH',cashMatch:!mismatches.includes('CASH_MISMATCH'),
    positionsMatch:!mismatches.some(x=>x.startsWith('POSITION_MISMATCH:')),ordersMatch:!mismatches.some(x=>x.startsWith('ORDER_MISMATCH:')),mismatches};
}
export async function recordReconciliation(db:D1Database,result:ReturnType<typeof reconcileBrokerState>,now=new Date()){
  await db.prepare('INSERT INTO broker_reconciliations(created_at,state,cash_match,positions_match,orders_match,mismatches) VALUES(?,?,?,?,?,?)')
    .bind(now.toISOString(),result.state,result.cashMatch?1:0,result.positionsMatch?1:0,result.ordersMatch?1:0,JSON.stringify(result.mismatches)).run();
}


export type ObserveExpected={
  cash:string;
  positions:BrokerPosition[];
  openClientOrderIds:string[];
  since:string;
};

export async function observeAndReconcile(db:D1Database,broker:BrokerAdapter,expected:ObserveExpected,now=new Date()){
  if(broker.mode==='DISABLED')throw new Error('BROKER_OBSERVE_DISABLED');
  const [account,clock,positions,orders,fills]=await Promise.all([
    broker.getAccount(),broker.getClock(),broker.listPositions(),broker.listOpenOrders(),broker.listFills(expected.since),
  ]);
  const symbols=[...new Set([...positions.map(p=>p.symbol),...orders.map(o=>o.symbol)])];
  const assets=await Promise.all(symbols.map(symbol=>broker.getAsset(symbol)));
  const stamp=now.toISOString();
  const reconciliation=reconcileBrokerState(expected,{cash:account.cash,positions,openOrders:orders});
  const statements:D1PreparedStatement[]=[
    db.prepare(`INSERT OR REPLACE INTO broker_account_snapshots(snapshot_at,account_id,cash,buying_power,equity,status,raw_json) VALUES(?,?,?,?,?,?,?)`)
      .bind(stamp,account.accountId,canonicalDecimal(account.cash),canonicalDecimal(account.buyingPower),canonicalDecimal(account.equity),account.status,JSON.stringify(account)),
    db.prepare('INSERT INTO broker_reconciliations(created_at,state,cash_match,positions_match,orders_match,mismatches) VALUES(?,?,?,?,?,?)')
      .bind(stamp,reconciliation.state,reconciliation.cashMatch?1:0,reconciliation.positionsMatch?1:0,reconciliation.ordersMatch?1:0,JSON.stringify(reconciliation.mismatches)),
  ];
  for(const p of positions) statements.push(
    db.prepare(`INSERT OR REPLACE INTO broker_position_snapshots(snapshot_at,symbol,asset_type,quantity,avg_entry_price,market_value,raw_json) VALUES(?,?,?,?,?,?,?)`)
      .bind(stamp,p.symbol,p.assetType,canonicalDecimal(p.quantity),canonicalDecimal(p.avgEntryPrice),p.marketValue==null?null:canonicalDecimal(p.marketValue),JSON.stringify(p))
  );
  for(const a of assets) statements.push(
    db.prepare(`INSERT INTO broker_asset_cache(symbol,checked_at,asset_type,status,tradable,fractionable,extended_hours,overnight,halted,raw_json)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET checked_at=excluded.checked_at,asset_type=excluded.asset_type,status=excluded.status,
      tradable=excluded.tradable,fractionable=excluded.fractionable,extended_hours=excluded.extended_hours,overnight=excluded.overnight,halted=excluded.halted,raw_json=excluded.raw_json`)
      .bind(a.symbol,stamp,a.assetType,a.status,a.tradable?1:0,a.fractionable?1:0,a.extendedHours?1:0,a.overnight?1:0,a.halted?1:0,JSON.stringify(a))
  );
  statements.push(db.prepare(`INSERT INTO broker_observation_cycles(created_at,mode,phase,trading_day,reconciliation_state,positions,open_orders,fills,assets_checked)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(stamp,broker.mode,clock.phase,clock.tradingDay?1:0,reconciliation.state,positions.length,orders.length,fills.length,assets.length));
  await db.batch(statements);
  for(const o of orders) await recordBrokerOrder(db,o);
  for(const fill of fills) await recordBrokerFill(db,fill);
  return {mode:broker.mode,clock,reconciliation,observed:{positions:positions.length,openOrders:orders.length,fills:fills.length,assetsChecked:assets.length},asOf:stamp};
}

export type BrokerReadinessInput={
  mode:BrokerMode;liveExecution:boolean;
  pendingIntents:number;unknownIntents:number;
  latestReconciliationState:string|null;latestReconciliationAt:string|null;
  currentVersionTrades:number;currentVersionSessions:number;
  cpuEvidence:boolean;branchProtectionEvidence:boolean;
};
export function brokerReadiness(input:BrokerReadinessInput,now=Date.now()){
  const recAge=input.latestReconciliationAt?Math.max(0,now-Date.parse(input.latestReconciliationAt)):Infinity;
  const gates=[
    {id:'LIVE_EXECUTION_DISABLED',pass:input.liveExecution===false,detail:'Live brokerage execution remains hard-disabled'},
    {id:'BROKER_OBSERVE_CONNECTED',pass:input.mode!=='DISABLED',detail:input.mode==='DISABLED'?'No broker observe/paper adapter is connected':input.mode},
    {id:'RECONCILIATION_MATCH',pass:input.latestReconciliationState==='MATCH'&&recAge<=5*60_000,detail:input.latestReconciliationState??'NO_RECONCILIATION'},
    {id:'NO_UNKNOWN_INTENTS',pass:input.unknownIntents===0,detail:String(input.unknownIntents)},
    {id:'NO_PENDING_INTENTS',pass:input.pendingIntents===0,detail:String(input.pendingIntents)},
    {id:'STRATEGY_CLOSED_TRADES',pass:input.currentVersionTrades>=200,detail:`${input.currentVersionTrades}/200`},
    {id:'STRATEGY_FULL_SESSIONS',pass:input.currentVersionSessions>=60,detail:`${input.currentVersionSessions}/60`},
    {id:'CLOUDFLARE_CPU_EVIDENCE',pass:input.cpuEvidence,detail:input.cpuEvidence?'verified':'production CPU evidence required'},
    {id:'PRODUCTION_BRANCH_PROTECTION',pass:input.branchProtectionEvidence,detail:input.branchProtectionEvidence?'verified':'external GitHub protection evidence required'},
  ];
  return {
    ready_for_live_capital:false,
    live_execution:false,
    engineering_gate_pass:gates.every(g=>g.pass),
    gates,
    blockers:gates.filter(g=>!g.pass).map(g=>g.id),
    note:'Passing engineering gates is necessary but does not itself authorize or enable live execution.',
  };
}
