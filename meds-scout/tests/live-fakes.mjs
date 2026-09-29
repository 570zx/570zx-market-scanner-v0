// Shared fakes for the live-trading tests: a statement-counting D1 adapter and
// a fake Robinhood (OAuth + MCP) that answers with Robinhood's real response
// envelopes. Not a test file itself.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {b64url} from '../src/robinhood-mcp.ts';

// ---------------------------------------------------------------- D1 adapter (node:sqlite), counting every statement

export class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.queries=0;}
  prepare(sql){const owner=this,db=this.db;return {sql,args:[],bind(...a){const s=owner.prepare(sql);s.args=a;return s;},
    _run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes),rows_read:0,rows_written:Number(r.changes)}};},
    async run(){owner.queries++;return this._run();},
    async all(){owner.queries++;return {success:true,meta:{rows_read:0,rows_written:0},results:db.prepare(sql).all(...this.args).map(r=>({...r}))};},
    async first(){owner.queries++;const r=db.prepare(sql).get(...this.args);return r?{...r}:null;},
    async raw(){owner.queries++;return db.prepare(sql).all(...this.args).map(r=>Object.values(r));}};}
  async batch(ss){this.queries+=ss.length;this.db.exec('BEGIN');try{const r=ss.map(s=>s._run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
export const SERVICE_STATE="CREATE TABLE service_state (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0, last_tick_at TEXT, last_success_at TEXT, last_source TEXT, last_result TEXT, last_error TEXT, lock_owner TEXT, lock_until INTEGER); INSERT INTO service_state(id,paused) VALUES(1,0);";
export function liveDb(){
  const d1=new D1();
  d1.db.exec(SERVICE_STATE);
  for(const m of ['0010_broker_boundary.sql','0011_broker_observation.sql','0013_live_execution.sql'])d1.db.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  d1.db.exec('CREATE TABLE IF NOT EXISTS leader_cycle_audit(bucket TEXT PRIMARY KEY,created_at TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL)');
  return d1;
}

export const TOOLS=[
  {name:'get_accounts',inputSchema:{type:'object',properties:{}}},
  {name:'get_portfolio',inputSchema:{type:'object',properties:{account_number:{type:'string'}},required:['account_number']}},
  {name:'get_equity_positions',inputSchema:{type:'object',properties:{account_number:{type:'string'}},required:['account_number']}},
  {name:'get_equity_quotes',inputSchema:{type:'object',properties:{symbols:{type:'array',items:{type:'string'}}},required:['symbols']}},
  {name:'place_equity_order',inputSchema:{type:'object',properties:{account_number:{type:'string'},symbol:{type:'string'},side:{type:'string',enum:['buy','sell']},
    type:{type:'string',enum:['market','limit']},quantity:{type:'string'},limit_price:{type:'string'},time_in_force:{type:'string',enum:['gfd','gtc','ioc']},
    market_hours:{type:'string',enum:['regular_hours','extended_hours','all_day_hours']},ref_id:{type:'string'}},required:['account_number','symbol','side','type','quantity','time_in_force']}},
  {name:'review_equity_order',inputSchema:{type:'object',properties:{account_number:{type:'string'},symbol:{type:'string'},side:{type:'string'},quantity:{type:'string'}}}},
  {name:'cancel_equity_order',inputSchema:{type:'object',properties:{order_id:{type:'string'}},required:['order_id']}},
  {name:'get_equity_orders',inputSchema:{type:'object',properties:{account_number:{type:'string'},cursor:{type:'string'},symbol:{type:'string'}},required:['account_number']}},
];
export const GUIDE='Present the relevant fields.';
// Response envelopes exactly as Robinhood returned them on 2026-09-29 (values changed).
export function robinhoodResponse(name,args,state){
  if(name==='get_accounts')return {data:{accounts:[{account_number:'5QR11111',type:'margin',unsettled_funds:'0.00'}]},guide:GUIDE};
  if(name==='get_portfolio')return {data:{total_value:'150.00',equity_value:'26.55',options_value:'0',futures_value:'0',event_contracts_value:'0',crypto_value:'0',
    cash:'123.45',pending_deposits:'0',mutual_funds_value:'0',fixed_income_value:'0',currency:'USD',
    buying_power:{buying_power:String(state.buyingPower.toFixed(2)),unleveraged_buying_power:String(state.buyingPower.toFixed(2)),display_currency:'USD'},crypto_buying_power:{buying_power:'0'}},guide:GUIDE};
  if(name==='get_equity_positions')return {data:{positions:[...state.positions].filter(([,q])=>q>0).map(([symbol,q])=>({symbol,quantity:q.toFixed(6),intraday_quantity:'0.000000',
    average_buy_price:'2.0000',shares_available_for_sells:q.toFixed(6),shares_held_for_sells:'0.000000',shares_held_for_stock_grants:'0.000000',
    shares_held_for_options_events:'0.000000',shares_held_for_asset_transfer:'0.000000',shares_pending_from_options_events:'0.000000',type:'long'}))},guide:GUIDE};
  if(name==='get_equity_quotes')return {data:{results:args.symbols.filter(s=>state.quotes[s]).map(s=>({
    quote:{symbol:s,last_trade_price:String(state.quotes[s].bid),venue_last_trade_time:state.now(),last_non_reg_trade_price:'0',adjusted_previous_close:'1.90',previous_close:'1.90',
      previous_close_date:'2026-09-30',bid_price:String(state.quotes[s].bid),venue_bid_time:state.now(),ask_price:String(state.quotes[s].ask),venue_ask_time:state.now(),has_traded:true,state:state.quotes[s].state??'active'},
    close:{symbol:s,date:'2026-09-30',price:'1.90',interpolated:false,source:'sip-list-exchange-close'}}))},guide:GUIDE};
  if(name==='place_equity_order'){
    const id='rh-'+(++state.seq),q=state.quotes[args.symbol],qty=Number(args.quantity),limit=Number(args.limit_price),buy=args.side==='buy';
    const px=buy?q.ask:q.bid,marketable=buy?limit>=q.ask:limit<=q.bid;
    const order={id,instrument_id:'i-'+args.symbol,symbol:args.symbol,side:args.side,type:args.type,state:'queued',quantity:qty.toFixed(6),cumulative_quantity:'0.000000',
      price:args.limit_price,stop_price:null,average_price:null,fees:'0',dollar_based_amount:null,time_in_force:args.time_in_force,market_hours:args.market_hours,
      trigger:'immediate',placed_agent:'agent',created_at:state.now(),last_transaction_at:state.now(),executions:[]};
    if(marketable){
      order.state='filled';order.cumulative_quantity=qty.toFixed(6);order.average_price=String(px);
      order.executions=[{id:id+'-x',price:String(px),quantity:qty.toFixed(6),timestamp:state.now(),fees:buy?'0':'0.01'}];
      state.positions.set(args.symbol,(state.positions.get(args.symbol)??0)+(buy?qty:-qty));state.buyingPower+=buy?-qty*px:qty*px;
    }else if(args.time_in_force==='ioc')order.state='cancelled';
    state.orders.unshift(order);
    return {data:{order},guide:GUIDE};
  }
  if(name==='get_equity_orders')return {data:{orders:state.orders.slice(0,20)},next:null,guide:GUIDE};
  if(name==='cancel_equity_order')return {data:{ok:true},guide:GUIDE};
  return {data:{},guide:GUIDE};
}

export function fakeRobinhood({sse=false,tools=TOOLS,origin='https://agent.robinhood.test'}={}){
  const login='https://login.robinhood.test';
  const s={access:'acc-1',refresh:'ref-1',n:1,refreshes:0,challenge:null,sessions:0,tools,calls:[],
    buyingPower:500,positions:new Map([['OBIO',3],['CLOV',12]]),quotes:{},orders:[],seq:0,now:()=>new Date().toISOString()};
  const reply=(id,result,extra={})=>sse
    ?new Response(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id,result})}\n\n`,{headers:{'content-type':'text/event-stream',...extra}})
    :Response.json({jsonrpc:'2.0',id,result},{headers:extra});
  const fetchImpl=async(url,init={})=>{
    const u=new URL(url),h=Object.fromEntries(Object.entries(init.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
    if(u.origin===origin&&u.pathname==='/mcp/trading'){
      if(!h.authorization)return new Response('',{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/trading"`}});
      if(h.authorization!=='Bearer '+s.access)return new Response('',{status:401});
      const body=JSON.parse(init.body);
      if(body.method==='initialize'){s.sessions++;return reply(body.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}}},{'mcp-session-id':'sess-'+s.sessions});}
      if(h['mcp-session-id']!=='sess-'+s.sessions)return new Response('',{status:404});
      if(body.method==='notifications/initialized')return new Response(null,{status:202});
      if(body.method==='tools/list'){const size=40,page=Number(body.params?.cursor??0);return reply(body.id,{tools:s.tools.slice(page,page+size),...(page+size<s.tools.length?{nextCursor:String(page+size)}:{})});}
      if(body.method==='tools/call'){
        const {name,arguments:args}=body.params;s.calls.push([name,args]);
        return reply(body.id,{content:[{type:'text',text:JSON.stringify(robinhoodResponse(name,args,s))}]});
      }
    }
    if(url===`${origin}/.well-known/oauth-protected-resource/mcp/trading`)return Response.json({resource:`${origin}/mcp/trading`,authorization_servers:[login],scopes_supported:['trading']});
    if(url===`${login}/.well-known/oauth-authorization-server`)return Response.json({issuer:login,authorization_endpoint:`${login}/authorize`,token_endpoint:`${login}/token`,registration_endpoint:`${login}/register`});
    if(url===`${login}/register`){const b=JSON.parse(init.body);assert.deepEqual(b.redirect_uris,['http://localhost:8765/callback']);assert.equal(b.token_endpoint_auth_method,'none');return Response.json({client_id:'client-123'});}
    if(url===`${login}/token`){
      const p=new URLSearchParams(init.body);
      assert.equal(p.get('client_id'),'client-123');assert.equal(p.get('resource'),`${origin}/mcp/trading`);
      if(p.get('grant_type')==='authorization_code'){
        assert.equal(p.get('code'),'code-xyz');
        const digest=b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p.get('code_verifier')))));
        assert.equal(digest,s.challenge,'PKCE verifier must match the challenge');
        return Response.json({access_token:s.access,refresh_token:s.refresh,expires_in:3600,token_type:'Bearer'});
      }
      if(p.get('grant_type')==='refresh_token'){
        if(p.get('refresh_token')!==s.refresh)return Response.json({error:'invalid_grant'},{status:400});
        s.refreshes++;s.n++;s.access='acc-'+s.n;s.refresh='ref-'+s.n;
        return Response.json({access_token:s.access,refresh_token:s.refresh,expires_in:3600});
      }
    }
    return new Response('not found',{status:404});
  };
  return {s,fetchImpl,mcpUrl:`${origin}/mcp/trading`};
}
