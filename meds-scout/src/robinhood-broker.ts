// Live broker adapter over Robinhood's Agentic Trading MCP tools.
//
// Tool arguments are mapped from each tool's own JSON input schema (captured
// at login) and responses are parsed defensively. The parsers are written
// against the envelopes Robinhood returned on 2026-09-29:
//   get_portfolio        {data:{cash,total_value,buying_power:{buying_power,unleveraged_buying_power}}}
//   get_equity_positions {data:{positions:[{symbol,quantity,shares_available_for_sells,average_buy_price,type}]}}
//   get_equity_quotes    {data:{results:[{quote:{symbol,bid_price,ask_price,venue_bid_time,venue_ask_time,state}}]}}
//   get_equity_orders    {data:{orders:[{id,symbol,side,type,state,quantity,cumulative_quantity,price,
//                         average_price,fees,created_at,last_transaction_at,executions:[{id,price,quantity,fees,timestamp}]}]}}
// Orders carry no client reference, so a lost submission is matched on
// symbol, side, quantity, limit price and time (see live-execution.ts).
//
// Anything the adapter cannot map or parse is an error: no order is ever sent
// with a guessed required field or an unconfirmed order type.

import type {McpTool,ToolResult} from './robinhood-mcp.ts';

export type LiveOrderState='SUBMITTED'|'PARTIALLY_FILLED'|'FILLED'|'CANCELED'|'REJECTED';
export type LiveExecution={id:string;quantity:number;price:number;fee:number;at:string|null};
export type LiveOrder={
  id:string;refId:string|null;symbol:string|null;side:'BUY'|'SELL'|null;orderType:string|null;state:LiveOrderState;rawState:string;
  quantity:number|null;filledQuantity:number;averagePrice:number|null;limitPrice:number|null;fees:number|null;
  createdAt:string|null;updatedAt:string|null;executions:LiveExecution[];rejectReason:string|null;placedAgent:string|null;
};
export type LiveAccount={accountId:string|null;cash:number|null;buyingPower:number;equity:number|null};
export type LivePosition={symbol:string;quantity:number;available:number|null;averagePrice:number|null};
export type LiveQuote={symbol:string;bid:number;ask:number;asOf:string|null};
export type LimitOrder={symbol:string;side:'BUY'|'SELL';quantity:number;limitPrice:number;refId:string;timeInForce:'ioc'|'gfd'};

export interface LiveBroker{
  readonly supportsIoc:boolean;
  readonly canLookupOrder:boolean;
  account():Promise<LiveAccount>;
  positions():Promise<LivePosition[]>;
  quotes(symbols:string[]):Promise<Map<string,LiveQuote>>;
  placeLimit(o:LimitOrder):Promise<LiveOrder>;
  order(id:string):Promise<LiveOrder|null>;
  recentOrders():Promise<LiveOrder[]>;
  // Orders for one symbol, following pagination back to `sinceMs` (bounded).
  ordersFor(symbol:string,sinceMs:number):Promise<LiveOrder[]>;
  cancel(id:string):Promise<void>;
}

// The order was refused. `placed` says whether it can have reached Robinhood:
// 'no' (refused before the place call, e.g. at review) or 'maybe' (the place
// call itself returned an error, so the order list is checked before giving up).
export class OrderRejected extends Error{
  placed:'no'|'maybe';
  constructor(message:string,placed:'no'|'maybe'='maybe'){super('ORDER_REJECTED:'+message.slice(0,300));this.placed=placed;}
}
// A call refused locally (subrequest budget or run deadline): it was never sent.
export class NotSent extends Error{
  constructor(reason:string){super('NOT_SENT:'+reason);}
}

// ---------------------------------------------------------------- JSON helpers

export const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function num(v:unknown):number|null{
  if(v==null||v==='')return null;
  if(isObj(v)){if('amount' in v)return num(v.amount);if('value' in v)return num(v.value);return null;}
  const n=Number(v);return Number.isFinite(n)?n:null;
}
const str=(v:unknown)=>v==null||v===''||typeof v==='object'?null:String(v);
function scalarLike(v:unknown){return v!=null&&(!isObj(v)||'amount' in v||('value' in v&&!isObj(v.value)));}
export function pick(o:Record<string,unknown>,keys:string[]){
  const wanted=new Set(keys.map(norm));
  for(const [k,v] of Object.entries(o))if(wanted.has(norm(k)))return v;
  return undefined;
}
const has=(o:Record<string,unknown>,keys:string[])=>pick(o,keys)!==undefined;
// Breadth-first: the shallowest scalar under a matching key wins.
export function findValue(root:unknown,keys:string[],maxNodes=4000):unknown{
  const wanted=new Set(keys.map(norm)),queue:unknown[]=[root];let seen=0;
  while(queue.length&&seen++<maxNodes){
    const v=queue.shift();
    if(!v||typeof v!=='object')continue;
    if(isObj(v))for(const [k,x] of Object.entries(v))if(wanted.has(norm(k))&&scalarLike(x))return x;
    for(const x of Array.isArray(v)?v:Object.values(v))if(x&&typeof x==='object')queue.push(x);
  }
  return undefined;
}
function findArray(root:unknown,keys:string[],maxNodes=4000):unknown[]|null{
  const wanted=new Set(keys.map(norm)),queue:unknown[]=[root];let seen=0;
  while(queue.length&&seen++<maxNodes){
    const v=queue.shift();
    if(!v||typeof v!=='object')continue;
    if(isObj(v))for(const [k,x] of Object.entries(v))if(wanted.has(norm(k))&&Array.isArray(x))return x;
    for(const x of Array.isArray(v)?v:Object.values(v))if(x&&typeof x==='object')queue.push(x);
  }
  return null;
}
// First non-empty array (breadth-first) whose every element satisfies `match`.
function findRecords(root:unknown,match:(o:Record<string,unknown>)=>boolean,maxNodes=4000):Record<string,unknown>[]|null{
  const queue:unknown[]=[root];let seen=0;
  while(queue.length&&seen++<maxNodes){
    const v=queue.shift();
    if(Array.isArray(v)&&v.length&&v.every(x=>isObj(x)&&match(x)))return v as Record<string,unknown>[];
    if(v&&typeof v==='object')for(const x of Array.isArray(v)?v:Object.values(v))if(x&&typeof x==='object')queue.push(x);
  }
  return null;
}
// Visit every object breadth-first. `hint` is the nearest enclosing key that
// looks like a ticker, for responses keyed by symbol ({AAA:{bid,ask}}).
function walkObjects(root:unknown,visit:(o:Record<string,unknown>,hint:string|null)=>void,maxNodes=4000){
  const queue:[unknown,string|null][]=[[root,null]];let seen=0;
  while(queue.length&&seen++<maxNodes){
    const [v,hint]=queue.shift()!;
    if(Array.isArray(v)){for(const x of v)if(x&&typeof x==='object')queue.push([x,hint]);continue;}
    if(!isObj(v))continue;
    visit(v,hint);
    for(const [k,x] of Object.entries(v))if(x&&typeof x==='object')queue.push([x,/^[A-Z][A-Z0-9.\-]{0,9}$/.test(k)?k:hint]);
  }
}

const SYMBOL_KEYS=['symbol','ticker','instrument_symbol'];
const QTY_KEYS=['quantity','shares','qty','quantity_owned','share_quantity'];
const AVAILABLE_KEYS=['shares_available_for_sells','shares_available_for_sale','sellable_quantity','available_quantity','quantity_available'];
const AVG_KEYS=['average_buy_price','average_price','avg_price','average_cost','avg_cost','cost_basis_per_share','average_cost_basis'];
const BID_KEYS=['bid_price','bid','best_bid'];
const ASK_KEYS=['ask_price','ask','best_ask'];
const BID_TIME_KEYS=['venue_bid_time','bid_time','bid_updated_at'];
const ASK_TIME_KEYS=['venue_ask_time','ask_time','ask_updated_at'];
const TIME_KEYS=['updated_at','timestamp','quote_time','as_of','time','last_updated'];
const ID_KEYS=['id','order_id','orderid'];
const STATE_KEYS=['state','status','order_state','order_status'];
const SIDE_KEYS=['side','direction','action'];
const FILLED_KEYS=['cumulative_quantity','filled_quantity','filled_qty','executed_quantity','quantity_filled','filled_shares'];
const FILL_PRICE_KEYS=['average_price','average_fill_price','avg_fill_price','filled_avg_price','executed_price'];
const ACCOUNT_KEYS=['account_number','account_id','accountnumber'];

function recordSymbol(o:Record<string,unknown>):string|null{
  const direct=str(pick(o,SYMBOL_KEYS));
  if(direct)return direct.toUpperCase();
  for(const v of Object.values(o))if(isObj(v)){const s=str(pick(v,SYMBOL_KEYS));if(s)return s.toUpperCase();}
  return null;
}
const orderLike=(o:Record<string,unknown>)=>has(o,ID_KEYS)&&has(o,STATE_KEYS)&&(has(o,SIDE_KEYS)||has(o,QTY_KEYS)||has(o,FILLED_KEYS));

// ---------------------------------------------------------------- normalizers

export function normalizeAccount(data:unknown):LiveAccount{
  const buyingPower=num(findValue(data,['buying_power','buyingpower','equity_buying_power','cash_available_for_trading','available_to_trade','purchasing_power']));
  if(buyingPower==null)throw new Error('ACCOUNT_BUYING_POWER_UNPARSEABLE');
  // Margin borrowing is disabled on Agentic accounts, so these agree; take the
  // lower if they ever differ.
  const unleveraged=num(findValue(data,['unleveraged_buying_power']));
  return {
    accountId:str(findValue(data,ACCOUNT_KEYS)),
    cash:num(findValue(data,['cash','cash_balance','cash_available','settled_cash','withdrawable_amount'])),
    buyingPower:unleveraged!=null?Math.min(buyingPower,unleveraged):buyingPower,
    equity:num(findValue(data,['equity','total_equity','portfolio_value','total_value','net_liquidation_value','account_value'])),
  };
}

export function normalizePositions(data:unknown):LivePosition[]{
  const recs=findRecords(data,o=>has(o,QTY_KEYS)&&recordSymbol(o)!==null);
  if(recs){
    return recs.filter(o=>norm(String(pick(o,['type','position_type'])??'long'))!=='short')
      .map(o=>({symbol:recordSymbol(o)!,quantity:num(pick(o,QTY_KEYS))??0,available:num(pick(o,AVAILABLE_KEYS)),averagePrice:num(pick(o,AVG_KEYS))}))
      .filter(p=>Math.abs(p.quantity)>1e-9);
  }
  if(Array.isArray(data)&&data.length===0)return [];
  const list=findArray(data,['results','positions','equity_positions','holdings','items','data']);
  if(list&&list.length===0)return [];
  throw new Error('POSITIONS_UNPARSEABLE');
}

export function normalizeQuotes(data:unknown,symbols:string[]):Map<string,LiveQuote>{
  const out=new Map<string,LiveQuote>(),single=symbols.length===1?symbols[0].toUpperCase():null;
  walkObjects(data,(o,hint)=>{
    if(!has(o,BID_KEYS)||!has(o,ASK_KEYS))return;
    const symbol=(recordSymbol(o)??hint??single)?.toUpperCase();
    if(!symbol||out.has(symbol))return;
    // Robinhood marks tradable quotes state='active'; anything else (halted,
    // inactive) is treated as no executable quote.
    const state=str(pick(o,['state','trading_state']));
    if(state&&!['active','tradable','open'].includes(norm(state)))return;
    if(pick(o,['trading_halted','halted'])===true)return;
    const bid=num(pick(o,BID_KEYS)),ask=num(pick(o,ASK_KEYS));
    if(bid==null||ask==null||!(bid>0)||!(ask>=bid))return;
    const times=[str(pick(o,BID_TIME_KEYS)),str(pick(o,ASK_TIME_KEYS))].map(t=>Date.parse(t??'')).filter(Number.isFinite);
    const asOf=times.length?new Date(Math.min(...times)).toISOString():str(pick(o,TIME_KEYS));
    out.set(symbol,{symbol,bid,ask,asOf});
  });
  return out;
}

export function mapOrderState(raw:string):LiveOrderState{
  const s=norm(raw);
  if(['filled','executed','complete','completed'].includes(s))return 'FILLED';
  if(s.includes('partial'))return 'PARTIALLY_FILLED';
  // Only a finished cancel is final; anything like pending_cancel is still live.
  if(['cancelled','canceled','expired','voided'].includes(s))return 'CANCELED';
  if(['rejected','failed','error','denied'].includes(s))return 'REJECTED';
  return 'SUBMITTED';
}
export function normalizeOrder(o:Record<string,unknown>):LiveOrder|null{
  const id=str(pick(o,ID_KEYS));
  if(!id)return null;
  const rawState=String(pick(o,STATE_KEYS)??'unknown');
  const rawExecs=pick(o,['executions','fills']);
  const execs=(Array.isArray(rawExecs)?rawExecs:[]).filter(isObj).map((e,i)=>({
    id:str(pick(e,['id','execution_id','fill_id']))??`${id}:${i}`,
    quantity:num(pick(e,QTY_KEYS))??0,price:num(pick(e,['price','fill_price','execution_price','average_price']))??0,
    fee:num(pick(e,['fees','fee']))??0,at:str(pick(e,['timestamp','executed_at','time','created_at']))}))
    .filter(e=>e.quantity>0);
  const filled=num(pick(o,FILLED_KEYS))??execs.reduce((n,e)=>n+e.quantity,0);
  const side=str(pick(o,SIDE_KEYS))?.toUpperCase();
  const type=str(pick(o,['type','order_type']));
  return {
    id,refId:str(pick(o,['ref_id','client_order_id','clientorderid','idempotency_key'])),symbol:recordSymbol(o),
    side:side==='BUY'||side==='SELL'?side:null,orderType:type?norm(type):null,state:mapOrderState(rawState),rawState,
    quantity:num(pick(o,QTY_KEYS)),filledQuantity:filled,averagePrice:num(pick(o,FILL_PRICE_KEYS)),
    limitPrice:num(pick(o,['limit_price','price'])),fees:num(pick(o,['fees','fee'])),
    createdAt:str(pick(o,['created_at','submitted_at','placed_at'])),
    updatedAt:str(pick(o,['last_transaction_at','updated_at'])),executions:execs,
    rejectReason:str(pick(o,['reject_reason','rejection_reason','reason','message'])),placedAgent:str(pick(o,['placed_agent'])),
  };
}
export function normalizeOrderResult(data:unknown):LiveOrder|null{
  let found:LiveOrder|null=null;
  walkObjects(data,o=>{if(!found&&orderLike(o))found=normalizeOrder(o);});
  return found;
}
export function normalizeOrders(data:unknown):LiveOrder[]{
  const recs=findRecords(data,orderLike);
  if(recs)return recs.map(normalizeOrder).filter((o):o is LiveOrder=>!!o);
  if(Array.isArray(data)&&!data.length)return [];
  const list=findArray(data,['results','orders','items','data']);
  if(list&&!list.length)return [];
  throw new Error('ORDERS_UNPARSEABLE');
}

// ---------------------------------------------------------------- argument mapping

export type Want={value:unknown;aliases:string[];synonyms?:Record<string,string[]>};
export function effectiveSchema(schema:any){
  if(schema&&!schema.type&&Array.isArray(schema.anyOf??schema.oneOf))
    return (schema.anyOf??schema.oneOf).find((s:any)=>s?.type!=='null')??schema;
  return schema??{};
}
function coerce(rawSchema:any,value:unknown,synonyms?:Record<string,string[]>):unknown{
  const schema=effectiveSchema(rawSchema);
  const type=Array.isArray(schema.type)?schema.type.find((t:string)=>t!=='null'):schema.type;
  if(Array.isArray(schema.enum)){
    const options=[String(value),...(synonyms?.[String(value)]??[])].map(norm);
    return schema.enum.find((e:unknown)=>options.includes(norm(String(e))));
  }
  if(type==='array'){
    const items=(Array.isArray(value)?value:[value]).map(x=>coerce(schema.items??{},x,synonyms));
    return items.some(x=>x===undefined)?undefined:items;
  }
  if(type==='string')return typeof value==='string'?value:String(value);
  if(type==='number'||type==='integer'){
    const n=Number(value);
    if(!Number.isFinite(n)||(type==='integer'&&!Number.isInteger(n)))return undefined;
    return n;
  }
  if(type==='boolean')return typeof value==='boolean'?value:value==='true'?true:value==='false'?false:undefined;
  return value;
}
export function buildArgs(tool:McpTool,wants:Record<string,Want|undefined>){
  const props:Record<string,any>=tool.inputSchema?.properties??{};
  const required:string[]=Array.isArray(tool.inputSchema?.required)?tool.inputSchema.required:[];
  const args:Record<string,unknown>={},used=new Set<string>(),unmatched:string[]=[];
  for(const [key,want] of Object.entries(wants)){
    if(!want||want.value==null)continue;
    const prop=Object.keys(props).find(p=>!used.has(p)&&want.aliases.some(a=>norm(a)===norm(p)));
    if(!prop){unmatched.push(key);continue;}
    const value=coerce(props[prop],want.value,want.synonyms);
    if(value===undefined){unmatched.push(key);continue;}
    args[prop]=value;used.add(prop);
  }
  return {args,missing:required.filter(r=>!(r in args)),unmatched,properties:Object.keys(props)};
}

const TOOL_NAMES={
  account:['get_portfolio','get_account','get_account_info','get_buying_power','get_accounts'],
  accounts:['get_accounts','get_account'],
  positions:['get_equity_positions','get_positions','get_stock_positions','get_holdings'],
  quotes:['get_equity_quotes','get_equity_quote','get_quotes','get_quote','get_stock_quotes'],
  place:['place_equity_order','place_stock_order','place_order'],
  review:['review_equity_order','preview_equity_order','review_order'],
  cancel:['cancel_equity_order','cancel_stock_order','cancel_order'],
  orders:['get_equity_orders','list_equity_orders','get_orders','get_order_history','get_equity_order_history','get_recent_orders','get_stock_orders'],
  orderById:['get_equity_order','get_order','get_order_status','get_equity_order_status'],
} as const;
export type ToolRole=keyof typeof TOOL_NAMES;
// Every tool name the live layer may use; the runtime loads only these schemas.
export function relevantToolNames(){return [...new Set(Object.values(TOOL_NAMES).flat())];}
export function resolveTools(catalog:McpTool[]){
  const byName=new Map(catalog.map(t=>[t.name,t]));
  const out={} as Record<ToolRole,McpTool|null>;
  for(const role of Object.keys(TOOL_NAMES) as ToolRole[])out[role]=TOOL_NAMES[role].map(n=>byName.get(n)).find(Boolean)??null;
  // A single-order tool needs an id; a list tool must not.
  const needsId=(t:McpTool|null)=>!!t&&(t.inputSchema?.required??[]).some((r:string)=>['orderid','id'].includes(norm(r)));
  if(out.orders&&needsId(out.orders)){out.orderById=out.orderById??out.orders;out.orders=null;}
  if(out.orderById&&!needsId(out.orderById)){out.orders=out.orders??out.orderById;out.orderById=null;}
  out.orders=out.orders??TOOL_NAMES.orders.map(n=>byName.get(n)).find(t=>!!t&&!needsId(t))??null;
  return out;
}
export function toolCapabilities(catalog:McpTool[]){
  const t=resolveTools(catalog);
  const tif=t.place?.inputSchema?.properties?Object.entries(t.place.inputSchema.properties as Record<string,any>).find(([k])=>['timeinforce','tif','duration'].includes(norm(k)))?.[1]:null;
  return {
    tools:Object.fromEntries(Object.entries(t).map(([k,v])=>[k,v?.name??null])),
    can_observe:!!(t.account&&t.positions),
    can_trade:!!(t.account&&t.positions&&t.quotes&&t.place&&t.cancel&&(t.orders||t.orderById)),
    time_in_force_options:Array.isArray(effectiveSchema(tif).enum)?effectiveSchema(tif).enum:null,
  };
}

const TYPE_PROPS=['type','ordertype','kind','orderkind'];
const ACCOUNT_WANT=(id:string|null):Want|undefined=>id?{value:id,aliases:['account_number','account_id','account','accountnumber']}:undefined;
const needsAccount=(t:McpTool)=>(t.inputSchema?.required??[]).some((r:string)=>['accountnumber','accountid','account'].includes(norm(r)));

export class RobinhoodAgenticBroker implements LiveBroker{
  readonly supportsIoc:boolean;
  private t:Record<ToolRole,McpTool|null>;
  private call:(name:string,args:Record<string,unknown>)=>Promise<ToolResult>;
  private accountId:string|null=null;
  constructor(catalog:McpTool[],call:(name:string,args:Record<string,unknown>)=>Promise<ToolResult>){
    this.t=resolveTools(catalog);this.call=call;
    const tif=this.t.place?.inputSchema?.properties?Object.entries(this.t.place.inputSchema.properties as Record<string,any>)
      .find(([k])=>['timeinforce','tif','duration'].includes(norm(k)))?.[1]:null;
    const options=effectiveSchema(tif).enum;
    this.supportsIoc=Array.isArray(options)&&options.some((e:unknown)=>['ioc','immediateorcancel'].includes(norm(String(e))));
  }
  get canLookupOrder(){return !!this.t.orderById;}
  private need(role:ToolRole){const t=this.t[role];if(!t)throw new Error('ROBINHOOD_TOOL_MISSING:'+role);return t;}
  private async invoke(role:ToolRole,wants:Record<string,Want|undefined>){
    const tool=this.need(role);
    if(!this.accountId&&needsAccount(tool))await this.loadAccountId();
    const {args,missing}=buildArgs(tool,{...wants,account:ACCOUNT_WANT(this.accountId)});
    if(missing.length)throw new Error(`ROBINHOOD_ARGS_UNMAPPED:${tool.name}:${missing.join(',')}`);
    const r=await this.call(tool.name,args);
    if(r.isError)throw new Error(`ROBINHOOD_TOOL_ERROR:${tool.name}:${r.text.slice(0,200)}`);
    return r;
  }
  // The Agentic MCP is scoped to the Agentic account. If several accounts are
  // ever returned, only one that identifies itself as agentic is accepted.
  private async loadAccountId(){
    const tool=this.t.accounts??this.t.account;
    if(!tool)throw new Error('ROBINHOOD_ACCOUNT_ID_UNAVAILABLE');
    const r=await this.call(tool.name,{});
    if(r.isError)throw new Error('ROBINHOOD_TOOL_ERROR:'+tool.name+':'+r.text.slice(0,200));
    const found=new Map<string,Record<string,unknown>>();
    walkObjects(r.data,o=>{const id=str(pick(o,ACCOUNT_KEYS));if(id&&!found.has(id))found.set(id,o);});
    if(found.size===1){this.accountId=[...found.keys()][0];return;}
    // get_accounts marks exactly one account tradable with agentic_allowed=true;
    // the others carry agentic_allowed=false and are read-only. Only an explicit
    // true counts (the field's mere presence on every account does not).
    const agentic=[...found].filter(([,o])=>{const v=pick(o,['agentic_allowed','agenticallowed']);return v===true||String(v).toLowerCase()==='true';});
    if(agentic.length===1){this.accountId=agentic[0][0];return;}
    throw new Error(found.size?'ROBINHOOD_ACCOUNT_AMBIGUOUS:'+found.size:'ROBINHOOD_ACCOUNT_ID_UNAVAILABLE');
  }
  async account(){
    const a=normalizeAccount((await this.invoke('account',{})).data);
    if(a.accountId&&!this.accountId)this.accountId=a.accountId;
    return a;
  }
  async positions(){return normalizePositions((await this.invoke('positions',{})).data);}
  async quotes(symbols:string[]){
    if(!symbols.length)return new Map<string,LiveQuote>();
    const tool=this.need('quotes');
    const listProp=Object.entries(tool.inputSchema?.properties??{}).find(([k])=>['symbols','symbol','tickers','ticker'].includes(norm(k)));
    const propType=effectiveSchema(listProp?.[1]).type;
    const isList=propType==='array'||['symbols','tickers'].includes(norm(listProp?.[0]??''));
    if(isList||symbols.length===1){
      const value=isList?(propType==='string'?symbols.join(','):symbols):symbols[0];
      const r=await this.invoke('quotes',{symbols:{value,aliases:['symbols','symbol','tickers','ticker']}});
      return normalizeQuotes(r.data,symbols);
    }
    const out=new Map<string,LiveQuote>();
    for(const s of symbols.slice(0,5))for(const [k,v] of await this.quotes([s]))out.set(k,v);
    return out;
  }
  async placeLimit(o:LimitOrder){
    const place=this.need('place');
    if(!this.accountId&&needsAccount(place))await this.loadAccountId();
    const wants:Record<string,Want|undefined>={
      account:ACCOUNT_WANT(this.accountId),
      symbol:{value:o.symbol,aliases:['symbol','ticker','instrument_symbol']},
      side:{value:o.side.toLowerCase(),aliases:['side','direction','action'],synonyms:{buy:['BUY'],sell:['SELL']}},
      type:{value:'limit',aliases:['type','order_type','ordertype','kind','order_kind'],synonyms:{limit:['LIMIT','limit_order']}},
      trigger:{value:'immediate',aliases:['trigger'],synonyms:{immediate:['IMMEDIATE']}},
      quantity:{value:String(o.quantity),aliases:['quantity','qty','shares','share_quantity']},
      price:{value:String(o.limitPrice),aliases:['limit_price','price','limitprice']},
      tif:{value:o.timeInForce,aliases:['time_in_force','timeinforce','tif','duration'],synonyms:{gfd:['day','DAY','GFD','good_for_day'],ioc:['IOC','immediate_or_cancel']}},
      hours:{value:'regular_hours',aliases:['market_hours','trading_session','session'],synonyms:{regular_hours:['regular','REGULAR','REGULAR_HOURS']}},
      extended:{value:false,aliases:['extended_hours','extendedhours','extended_hours_trading']},
      ref:{value:o.refId,aliases:['ref_id','refid','client_order_id','clientorderid','idempotency_key','idempotencykey']},
      dryRun:{value:false,aliases:['dry_run','dryrun','preview_only','review_only','validate_only']},
    };
    const built=buildArgs(place,wants);
    const critical=['symbol','side','quantity','price'].filter(k=>built.unmatched.includes(k));
    if(critical.length)throw new Error('ORDER_TOOL_MAPPING_INCOMPLETE:'+critical.join(','));
    // The order must be an explicit limit order: every type-like field set to
    // limit, or (with no type field at all) a field that is a limit price.
    const typeKeys=built.properties.filter(p=>TYPE_PROPS.includes(norm(p)));
    for(const k of typeKeys)if(norm(String(built.args[k]??''))!=='limit')throw new Error('ORDER_TYPE_NOT_LIMIT:'+k);
    if(!typeKeys.length&&!Object.keys(built.args).some(k=>norm(k)==='limitprice'))throw new Error('ORDER_TYPE_UNCONFIRMED');
    let missing=built.missing;
    // A required yes/no acknowledgement is answered yes: the operator chose
    // autonomous execution for this dedicated account.
    for(const m of [...missing]){
      if(effectiveSchema(place.inputSchema?.properties?.[m]).type==='boolean'&&/confirm|acknowledg|agree|accept/i.test(m)){built.args[m]=true;missing=missing.filter(x=>x!==m);}
    }
    const reviewKey=missing.find(m=>/review|preview|confirm/i.test(m));
    if(reviewKey&&this.t.review){
      const rv=buildArgs(this.t.review,wants);
      const rr=await this.call(this.t.review.name,rv.args);
      if(rr.isError)throw new OrderRejected(rr.text,'no');
      const token=findValue(rr.data,[reviewKey,'review_id','preview_id','id','token']);
      if(token==null)throw new OrderRejected('ORDER_REVIEW_TOKEN_UNAVAILABLE','no');
      built.args[reviewKey]=token;missing=missing.filter(m=>m!==reviewKey);
    }
    if(missing.length)throw new Error('ORDER_TOOL_REQUIRED_FIELDS_UNMAPPED:'+missing.join(','));
    const r=await this.call(place.name,built.args);
    if(r.isError)throw new OrderRejected(r.text,'maybe');
    const order=normalizeOrderResult(r.data);
    if(!order)throw new Error('ORDER_RESPONSE_UNPARSEABLE');
    return order;
  }
  async order(id:string){
    if(!this.t.orderById)return null;
    return normalizeOrderResult((await this.invoke('orderById',{id:{value:id,aliases:['order_id','id','orderid']}})).data);
  }
  async recentOrders(){
    const r=await this.invoke('orders',{limit:{value:50,aliases:['limit','page_size','count','max_results']}});
    return normalizeOrders(r.data);
  }
  async ordersFor(symbol:string,sinceMs:number,maxPages=3){
    const tool=this.need('orders'),props=Object.keys(tool.inputSchema?.properties??{}).map(norm);
    const bySymbol=props.some(k=>['symbol','ticker'].includes(k)),paged=props.some(k=>['cursor','pagetoken'].includes(k));
    const out:LiveOrder[]=[];let cursor:string|null=null;
    for(let page=0;page<maxPages;page++){
      const r=await this.invoke('orders',{
        symbol:bySymbol?{value:symbol,aliases:['symbol','ticker']}:undefined,
        cursor:cursor?{value:cursor,aliases:['cursor','page_token']}:undefined,
        limit:{value:50,aliases:['limit','page_size','count','max_results']}});
      const orders=normalizeOrders(r.data);
      out.push(...orders.filter(o=>o.symbol===symbol||(bySymbol&&o.symbol==null)));
      cursor=str(findValue(r.data,['next','next_cursor','next_page_token']));
      const times=orders.map(o=>Date.parse(o.createdAt??'')).filter(Number.isFinite);
      if(!paged||!cursor||!orders.length||(times.length&&Math.min(...times)<sinceMs))break;
    }
    return out;
  }
  async cancel(id:string){await this.invoke('cancel',{id:{value:id,aliases:['order_id','id','orderid']}});}
}
