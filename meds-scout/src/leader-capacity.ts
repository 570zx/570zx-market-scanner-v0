import {validQuote} from './paper-accounting.ts';
import {equityExitCapacity} from './position-liquidity.ts';
import {runnerReasons,optionDirection,candidateLane,preservedMaxHold} from './leader-policy.ts';
import {markState,LEASE_MS} from './autonomous.ts';
import {cycleBucket,sessionDate,moverMiss} from './research-audit.ts';

export const CAPACITY_ENGINE='meds-v8.1-leader250-capacity';
export const CAPACITY_VERSION='leader-hunt-v8.5-account-risk-governor';
export const ACTIVE_ACCOUNT='H250';
export const ACTIVE_LEADER_RISK_POLICY=Object.freeze({
  starting_equity:250,
  protected_cash_reserve:30,
  target_entry_notional:10,
  max_open_positions:32,
  max_equity_entries_per_cycle:6,
  max_option_entries_per_cycle:3,
  max_minute_participation:0.05,
  equity_stop_loss_pct:0.05,
  option_stop_loss_pct:0.35,
  reentry_cooldown_minutes:15,
  max_quote_age_seconds:90,
  max_rotations_per_cycle:1,
  max_rotations_per_session:2,
  rotation_account_cooldown_minutes:30,
  rotation_min_victim_age_minutes:15,
  rotation_min_score_improvement:15,
  max_session_realized_loss_pct:0.04,
  max_session_drawdown_pct:0.06,
  max_entries_per_session:20,
  max_entry_notional_multiple_per_session:0.8,
  live_execution:false,
});
export const CAPACITY_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS leader_runtime_config(id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT NOT NULL,version TEXT NOT NULL,normal_enabled INTEGER NOT NULL CHECK(normal_enabled=0))`,
  `INSERT INTO leader_runtime_config VALUES(1,'${ACTIVE_ACCOUNT}','${CAPACITY_VERSION}',0) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,version=excluded.version,normal_enabled=0`,
  `INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('${ACTIVE_ACCOUNT}','$250',250,250,250,0,250,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `INSERT OR IGNORE INTO hunt_revisions VALUES('${ACTIVE_ACCOUNT}',0)`,
  `CREATE TABLE IF NOT EXISTS leader_cycle_audit(bucket TEXT PRIMARY KEY,created_at TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leader_research_shards(session_date TEXT NOT NULL,shard INTEGER NOT NULL,version TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(session_date,shard,version))`,
  `CREATE TABLE IF NOT EXISTS leader_research_archive(session_date TEXT NOT NULL,symbol TEXT NOT NULL,version TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(session_date,symbol,version))`,
  `CREATE TABLE IF NOT EXISTS leader_session_summary(session_date TEXT NOT NULL,version TEXT NOT NULL,cycles INTEGER NOT NULL,audit_bytes INTEGER NOT NULL,compacted_at TEXT NOT NULL,PRIMARY KEY(session_date,version))`,
  `CREATE TABLE IF NOT EXISTS leader_maintenance_state(id INTEGER PRIMARY KEY CHECK(id=1),last_maintenance_date TEXT)`,
  `INSERT OR IGNORE INTO leader_maintenance_state(id,last_maintenance_date) VALUES(1,NULL)`,
  `CREATE TABLE IF NOT EXISTS leader_control_state(id INTEGER PRIMARY KEY CHECK(id=1),reduce_only INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO leader_control_state(id,reduce_only) VALUES(1,0)`,
  `CREATE TABLE IF NOT EXISTS leader_daily_risk(session_date TEXT NOT NULL,account_id TEXT NOT NULL,rotations INTEGER NOT NULL DEFAULT 0,last_rotation_at TEXT,session_start_equity REAL,session_start_realized_pnl REAL,realized_pnl REAL NOT NULL DEFAULT 0,max_drawdown_pct REAL NOT NULL DEFAULT 0,entries INTEGER NOT NULL DEFAULT 0,entry_notional REAL NOT NULL DEFAULT 0,risk_state TEXT NOT NULL DEFAULT 'NORMAL',breach_reason TEXT,updated_at TEXT,PRIMARY KEY(session_date,account_id))`,
  `CREATE TABLE IF NOT EXISTS leader_execution_guard(id INTEGER PRIMARY KEY CHECK(id=1),deadline_ms REAL NOT NULL,checked_at_ms REAL NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS leader_execution_deadline_v84 BEFORE INSERT ON leader_execution_guard WHEN NEW.checked_at_ms > NEW.deadline_ms BEGIN SELECT RAISE(ABORT,'execution quote expired at commit'); END`,
  `CREATE INDEX IF NOT EXISTS idx_hunt_account_event_position ON hunt_account_events(account_id,position_id,event_type)`,
  `DROP INDEX IF EXISTS idx_hunt_account_event_time`,
  `DROP TRIGGER IF EXISTS hunt_account_events_once_v8`,
  `CREATE TRIGGER hunt_account_events_once_v8 BEFORE INSERT ON hunt_account_events WHEN EXISTS(SELECT 1 FROM hunt_account_events WHERE account_id=NEW.account_id AND position_id=NEW.position_id AND event_type=NEW.event_type) BEGIN SELECT RAISE(ABORT,'Leader lifecycle event already applied'); END`,
  `CREATE INDEX IF NOT EXISTS idx_hunt_option_event_position ON hunt_account_option_events(account_id,position_id,event_type)`,
  `DROP INDEX IF EXISTS idx_hunt_option_event_time`,
  `DROP TRIGGER IF EXISTS hunt_account_option_events_once_v8`,
  `CREATE TRIGGER hunt_account_option_events_once_v8 BEFORE INSERT ON hunt_account_option_events WHEN EXISTS(SELECT 1 FROM hunt_account_option_events WHERE account_id=NEW.account_id AND position_id=NEW.position_id AND event_type=NEW.event_type) BEGIN SELECT RAISE(ABORT,'Leader lifecycle event already applied'); END`,
  `UPDATE paper_meta SET version=13 WHERE id=1`,
];
export async function ensureCapacitySchema(db:D1Database){await db.batch(CAPACITY_SCHEMA.map(s=>db.prepare(s)));}
export type Row=Record<string,any>;
export type Usage={calls:number;statements:number;rows_read:number;rows_written:number;row_metrics_available:boolean;by_query:Record<string,number>};
export class CycleDB {
  db:D1Database;usage:Usage={calls:0,statements:0,rows_read:0,rows_written:0,row_metrics_available:true,by_query:{}};
  private reads=0;private waiters:Array<()=>void>=[];
  constructor(db:D1Database){this.db=db;}
  private count(n:number,label:string){this.usage.calls++;this.usage.statements+=n;this.usage.by_query[label]=(this.usage.by_query[label]??0)+n;}
  private meta(r:any){if(r.meta?.rows_read==null||r.meta?.rows_written==null)this.usage.row_metrics_available=false;this.usage.rows_read+=Number(r.meta?.rows_read??0);this.usage.rows_written+=Number(r.meta?.rows_written??0);}
  async all(sql:string,args:any[]=[],label='read'){if(this.reads>=6)await new Promise<void>(resolve=>this.waiters.push(resolve));this.reads++;try{this.count(1,label);const r=await this.db.prepare(sql).bind(...args).all<Row>();this.meta(r);return r.results??[];}finally{this.reads--;this.waiters.shift()?.();}}
  async run(sql:string,args:any[]=[],label='control'){this.count(1,label);const r=await this.db.prepare(sql).bind(...args).run();this.meta(r);return r;}
  async batch(ss:D1PreparedStatement[]){this.count(ss.length,'atomic_cycle');const r=await this.db.batch(ss);r.forEach(x=>this.meta(x));return r;}
}

// One JSON bind and one SQL statement for every set, independently of row count.
// Column names and clauses are internal constants, never provider/user input.
export function ingest(db:D1Database,table:string,rows:Row[],columns:string[],suffix=''){
  const payload=JSON.stringify(rows);
  if(new TextEncoder().encode(payload).length>1_800_000)throw Error('AUDIT_PAYLOAD_CAPACITY: no rows discarded');
  return db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE 1 ${suffix}`).bind(payload);
}
export function patchRows(db:D1Database,table:string,rows:Row[],columns:string[]){
  return db.prepare(`UPDATE ${table} SET ${columns.map(c=>`${c}=json_extract(j.value,'$.${c}')`).join(',')} FROM json_each(?) j WHERE ${table}.id=json_extract(j.value,'$.id') AND ${table}.account_id='${ACTIVE_ACCOUNT}' AND ${table}.status='open'`).bind(JSON.stringify(rows));
}
const TABLES={equity:'hunt_account_positions',option:'hunt_account_option_positions'};
const rungPolicy=[['LADDER_25',.25,.025],['LADDER_50',.5,.025],['LADDER_100',1,.05]] as const;
export class LeaderPlan {
  account:Row;positions:Row[];events:Row[]=[];trades:Row[]=[];newPositions:Row[]=[];decisions:Row[]=[];intents:Row[]=[];
  touched:Row[]=[];cooldown:Set<string>;priorEvents:Row[];priorIntents:Row[];now:Date;phase:string;strengthBySymbol:Map<string,number>;
  cashCredit=0;cashDebit=0;pnlDelta=0;executionDeadline=Infinity;rotations=0;
  rotationCountToday=0;lastRotationAt:string|null=null;rotationRiskDirty=false;
  private equityLiquidityRemaining=new Map<string,number>();
  constructor(account:Row,positions:Row[],events:Row[],intents:Row[],cooldown:string[],now:Date,phase:string,strengthBySymbol:Map<string,number>=new Map()){
    this.account={...account};this.positions=positions.map(p=>({...p}));this.priorEvents=events;this.priorIntents=intents;this.cooldown=new Set(cooldown);this.now=now;this.phase=phase;this.strengthBySymbol=strengthBySymbol;
    this.rotationCountToday=Number(account.rotations_today??0);this.lastRotationAt=account.last_rotation_at??null;
  }
  fresh(q:any){return validQuote(q,Date.now());}
  usedQuote(q:any){this.executionDeadline=Math.min(this.executionDeadline,Date.parse(q.t)+90_000);}
  equityAvailable(symbol:string,snapshot:any){
    if(!this.equityLiquidityRemaining.has(symbol))this.equityLiquidityRemaining.set(symbol,equityExitCapacity(snapshot,Date.now()));
    return Math.max(0,this.equityLiquidityRemaining.get(symbol)??0);
  }
  consumeEquityLiquidity(symbol:string,qty:number){
    const remaining=this.equityLiquidityRemaining.get(symbol)??0;
    this.equityLiquidityRemaining.set(symbol,Math.max(0,remaining-qty));
  }
  get cash(){return Number(this.account.cash)+this.cashCredit-this.cashDebit;}
  get open(){return [...this.positions,...this.newPositions].filter(p=>p.status==='open');}
  reason(symbol:string){if(this.priorIntents.length||this.intents.length)return 'PENDING_EXIT_INTENT';if(this.open.some(p=>(p.underlying??p.symbol)===symbol))return 'DUPLICATE_POSITION';if(this.cooldown.has(symbol))return 'REENTRY_COOLDOWN';if(this.open.length>=32)return 'OPEN_POSITION_CAP';if(this.cash-30<=.01)return 'CAPITAL_RESERVE_BLOCK';return null;}
  decision(c:Row,lane:string,stage:string,reasons:string[],features:Row={},entered=false){this.decisions.push({bucket:cycleBucket(this.now),created_at:this.now.toISOString(),symbol:c.symbol,lane,account_id:ACTIVE_ACCOUNT,stage,outcome:entered?'ENTERED':reasons.length?'REJECTED':'ELIGIBLE',reasons,features:{...features,price:c.price,day_change_pct:c.dayChangePct,cash:this.cash},version:CAPACITY_VERSION});}
  event(p:Row,type:string,fill:number,qty:number,pnl:number,details:Row){this.events.push({kind:p.kind,account_id:ACTIVE_ACCOUNT,position_id:p.id,underlying:p.underlying,symbol:p.symbol,created_at:this.now.toISOString(),event_type:type,price:fill,quantity:qty,realized_pnl:pnl,details:JSON.stringify(details),version:p.version});}
  sell(p:Row,qty:number,fill:number,type:string|null,details:Row={}){
    const m=p.kind==='option'?100:1,pnl=(fill-p.entry_price)*qty*m;
    this.cashCredit+=fill*qty*m;this.pnlDelta+=pnl;p.remaining_qty-=qty;p.locked_realized_pnl+=pnl;
    if(type)this.event(p,type,fill,qty,pnl,details);return pnl;
  }
  close(p:Row,fill:number,reason:string,runnerQty=0){
    const total=p.locked_realized_pnl,peak=Number(p.runner_high??p.highest_price);
    this.trades.push({...p,closed_at:this.now.toISOString(),exit_price:fill,exit_value:p.entry_notional+total,realized_pnl:total,
      return_pct:total/p.entry_notional*100,mfe_pct:(p.highest_price/p.entry_price-1)*100,mae_pct:(p.lowest_price/p.entry_price-1)*100,
      minutes_held:(this.now.getTime()-Date.parse(p.opened_at))/60000,exit_reason:reason,take200_hit:p.take200_done,
      runner_quantity:runnerQty,peak_gap_pct:p.take200_done&&reason!=='take_200'?(peak-fill)/peak*100:null,data_quality:'indicative'});
    p.status='closed';p.remaining_qty=0;this.cooldown.add(p.underlying??p.symbol);
  }
  manage(stocks:Record<string,any>,options:Record<string,any>){
    for(const p of this.positions){
      const option=p.kind==='option';if(option&&this.phase!=='regular')continue;
      const snap=(option?options:stocks)[p.symbol],q=snap?.latestQuote;if(!this.fresh(q))continue;
      p.remaining_qty=Number(p.remaining_qty??p.quantity);p.locked_realized_pnl=Number(p.locked_realized_pnl??0);
      p.highest_price=Math.max(p.highest_price,q.bp);p.lowest_price=Math.min(p.lowest_price,q.bp);
      if(option){p.current_mark=q.bp;p.current_mark_at=q.t;}
      this.touched.push(p);
      const pending=this.priorIntents.find(i=>i.kind===p.kind&&i.position_id===p.id);
      let available=option?Math.max(0,Math.floor(q.bs??0)):this.equityAvailable(p.symbol,snap);
      const fill=(qty:number)=>q.bp*(1-(option?.005:Math.min(.01,Math.max(.0002,.0002+qty/Math.max(1,snap.minuteBar?.v??1)*.025))));
      if(!p.take200_done&&!pending){
        for(const [event,threshold,fraction] of rungPolicy){
          if(q.bp<p.entry_price*(1+threshold)||this.priorEvents.some(e=>e.kind===p.kind&&e.position_id===p.id&&e.event_type===event))continue;
          const qty=Math.min(p.remaining_qty,option?Math.floor(p.quantity*fraction):p.quantity*fraction);
          if(qty<=0||qty>available)continue;
          this.usedQuote(q);available-=qty;if(!option)this.consumeEquityLiquidity(p.symbol,qty);this.sell(p,qty,fill(qty),event,{threshold_return_pct:threshold,fraction,observed_bid:q.bp});
        }
      }
      if(!p.take200_done&&!pending&&q.bp>=p.entry_price*3){
        const runner=Math.min(p.remaining_qty,option?Math.floor(p.quantity*.05):p.quantity*.05),qty=p.remaining_qty-runner;
        if(qty>0&&qty<=available){this.usedQuote(q);if(!option)this.consumeEquityLiquidity(p.symbol,qty);const px=fill(qty);this.sell(p,qty,px,'TAKE_200',{remaining_qty:runner,observed_bid:q.bp});p.take200_done=1;p.take200_price=px;p.take200_at=this.now.toISOString();p.runner_high=runner?p.highest_price:null;if(!runner)this.close(p,px,'take_200');}
        continue;
      }
      let reason=pending?.reason;
      if(p.take200_done){
        p.runner_high=Math.max(p.runner_high??p.highest_price,p.highest_price);
        if(!reason&&1-q.bp/p.runner_high>=.15)reason='runner_peak_retrace';
        if(!reason&&(this.now.getTime()-Date.parse(p.take200_at))/60000>=1440)reason='runner_time';
      }else{
        if(!reason&&q.bp<=p.stop_price)reason='stop';
        if(!reason&&(this.now.getTime()-Date.parse(p.opened_at))/60000>=preservedMaxHold(p.version,p.kind,p.features))reason='time';
      }
      if(!reason)continue;
      const qty=Math.min(p.remaining_qty,available),remaining=p.remaining_qty;
      if(qty<remaining)this.intents.push({kind:p.kind,position_id:p.id,reason,requested_at:this.now.toISOString()});
      if(!qty)continue;
      this.usedQuote(q);if(!option)this.consumeEquityLiquidity(p.symbol,qty);const px=fill(qty);
      const finalPnl=this.sell(p,qty,px,qty<remaining?'PARTIAL_EXIT_'+this.now.toISOString():p.take200_done?'RUNNER_EXIT':null,{reason,liquidity_limited:qty<remaining});
      if(qty===remaining){this.close(p,px,reason,p.take200_done?remaining:0);p.locked_realized_pnl-=finalPnl;}
    }
  }
  rotateCapital(c:Row,stocks:Record<string,any>,baseFeatures:Row){
    if(this.rotations>=ACTIVE_LEADER_RISK_POLICY.max_rotations_per_cycle||candidateLane(c as any)!=='MOMENTUM_CONTINUATION')return null;
    if(this.rotationCountToday>=ACTIVE_LEADER_RISK_POLICY.max_rotations_per_session)return null;
    if(this.lastRotationAt&&this.now.getTime()-Date.parse(this.lastRotationAt)<ACTIVE_LEADER_RISK_POLICY.rotation_account_cooldown_minutes*60_000)return null;
    const candidateSnap=stocks[c.symbol],candidateQuote=candidateSnap?.latestQuote;
    if(!this.fresh(candidateQuote))return null;
    const currentMinuteVolume=Math.max(0,Number(candidateSnap?.minuteBar?.v??c.minuteVolume??0));
    const minuteLiquidity=currentMinuteVolume*ACTIVE_LEADER_RISK_POLICY.max_minute_participation;
    if(!(minuteLiquidity>0))return null;
    const relative=c.previousDayVolume>0?c.dayVolume/c.previousDayVolume:0;
    const elite=c.score>=55&&c.consecutiveHits>=2&&relative>=2&&c.spreadPct<=2.5&&(c.catalystScore>0||c.volumeAccel>=.2);
    if(!elite)return null;
    const choices=this.positions.filter(p=>{
      if(p.kind!=='equity'||p.status!=='open'||p.take200_done)return false;
      if(this.priorIntents.some(i=>i.kind==='equity'&&i.position_id===p.id)||this.intents.some(i=>i.kind==='equity'&&i.position_id===p.id))return false;
      if(this.now.getTime()-Date.parse(p.opened_at)<ACTIVE_LEADER_RISK_POLICY.rotation_min_victim_age_minutes*60_000)return false;
      return true;
    }).map(p=>{
      const snap=stocks[p.symbol],q=snap?.latestQuote;
      if(!this.fresh(q))return null;
      p.remaining_qty=Number(p.remaining_qty??p.quantity);p.locked_realized_pnl=Number(p.locked_realized_pnl??0);
      const available=this.equityAvailable(p.symbol,snap);
      if(!(p.remaining_qty>0)||available+1e-9<p.remaining_qty)return null;
      const ret=q.bp/p.entry_price-1,currentScore=Math.max(Number(p.entry_score??0),Number(this.strengthBySymbol.get(p.symbol)??0));
      if(ret>.03)return null;
      if(c.score-currentScore<ACTIVE_LEADER_RISK_POLICY.rotation_min_score_improvement)return null;
      return {p,snap,q,ret,currentScore};
    }).filter(Boolean) as {p:Row;snap:any;q:any;ret:number;currentScore:number}[];
    choices.sort((a,b)=>a.ret-b.ret||a.currentScore-b.currentScore||Date.parse(a.p.opened_at)-Date.parse(b.p.opened_at));
    const x=choices[0];if(!x)return null;
    const victimQty=x.p.remaining_qty,victimFill=x.q.bp*(1-Math.min(.01,Math.max(.0002,.0002+victimQty/Math.max(1,x.snap.minuteBar?.v??1)*.025)));
    const expectedCash=this.cash+victimFill*victimQty;
    const budget=Math.min(ACTIVE_LEADER_RISK_POLICY.target_entry_notional,Math.max(0,expectedCash-ACTIVE_LEADER_RISK_POLICY.protected_cash_reserve));
    let replacementQty=Math.min(budget/candidateQuote.ap,minuteLiquidity);
    const replacementFill=(n:number)=>candidateQuote.ap*(1+Math.min(.01,.0002+n/Math.max(1,currentMinuteVolume)*.025));
    if(replacementQty*replacementFill(replacementQty)>budget)replacementQty=budget/replacementFill(replacementQty);
    const replacementPx=replacementFill(replacementQty),replacementCost=replacementQty*replacementPx;
    if(!(replacementCost>.01)||!(replacementQty>0))return null;
    const replacementExit=candidateQuote.bp*(1-Math.min(.01,Math.max(.0002,.0002+replacementQty/Math.max(1,currentMinuteVolume)*.025)));
    if(1-replacementExit/replacementPx>ACTIVE_LEADER_RISK_POLICY.equity_stop_loss_pct)return null;
    // Both legs are fully preflighted before mutating the plan. In shadow mode
    // they commit atomically; a future broker adapter must still treat them as
    // sequential external effects and revalidate the replacement after the sell.
    this.usedQuote(x.q);this.usedQuote(candidateQuote);this.consumeEquityLiquidity(x.p.symbol,victimQty);
    const finalPnl=this.sell(x.p,victimQty,victimFill,'ROTATION_EXIT',{replacement_symbol:c.symbol,replacement_score:c.score,replacement_day_change_pct:c.dayChangePct,observed_bid:x.q.bp,management_policy_version:CAPACITY_VERSION});
    this.close(x.p,victimFill,'rotation_for_stronger_continuation');x.p.locked_realized_pnl-=finalPnl;
    const f={...baseFeatures,asset_type:'equity',max_hold_minutes:720,quantity:replacementQty,target_notional:budget,actual_notional:replacementCost,minute_participation:replacementQty/Math.max(1,currentMinuteVolume),fractional_paper:true,entry_slippage_pct:replacementPx/candidateQuote.ap-1,rotated_out:x.p.symbol};
    this.addPosition(c,'equity',c.symbol,replacementQty,replacementPx,replacementCost,f);
    this.rotations++;this.rotationCountToday++;this.lastRotationAt=this.now.toISOString();this.rotationRiskDirty=true;
    return {rotatedOut:x.p.symbol,features:f};
  }
  enterEquities(candidates:Row[],stocks:Record<string,any>,features:(c:any)=>Row){
    let signals=0;
    for(const c of candidates){
      const lane=candidateLane(c as any),q=stocks[c.symbol]?.latestQuote;
      const reasons=runnerReasons(c as any);if(reasons.length){this.decision(c,lane,'ENTRY',reasons,features(c));continue;}
      if(c.executionAuthority===false){this.decision(c,lane,'ENTRY',['EXECUTION_QUOTE_NOT_AUTHORITATIVE'],features(c));continue;}
      if(c.executionFresh!==true||!this.fresh(q)){this.decision(c,lane,'ENTRY',['EXECUTION_QUOTE_STALE'],features(c));continue;}
      const executionLiquidity=Math.max(0,Number(stocks[c.symbol]?.minuteBar?.v??c.minuteVolume??0));
      if(!(executionLiquidity>0)){this.decision(c,lane,'ENTRY',['MINUTE_LIQUIDITY_LIMIT'],features(c));continue;}
      const frictionBudget=ACTIVE_LEADER_RISK_POLICY.target_entry_notional;
      let frictionQty=Math.min(frictionBudget/q.ap,executionLiquidity*ACTIVE_LEADER_RISK_POLICY.max_minute_participation);
      const buyFill=(n:number)=>q.ap*(1+Math.min(.01,.0002+n/Math.max(1,executionLiquidity)*.025));
      if(frictionQty*buyFill(frictionQty)>frictionBudget)frictionQty=frictionBudget/buyFill(frictionQty);
      const frictionEntry=buyFill(frictionQty),frictionExit=q.bp*(1-Math.min(.01,Math.max(.0002,.0002+frictionQty/Math.max(1,executionLiquidity)*.025)));
      const immediateLoss=frictionQty>0?1-frictionExit/frictionEntry:Infinity;
      if(immediateLoss>ACTIVE_LEADER_RISK_POLICY.equity_stop_loss_pct){
        this.decision(c,lane,'ENTRY',['IMMEDIATE_LIQUIDATION_RISK'],{...features(c),modeled_immediate_loss_pct:immediateLoss*100});
        continue;
      }
      let reason=this.reason(c.symbol)??(signals>=ACTIVE_LEADER_RISK_POLICY.max_equity_entries_per_cycle?'SIGNAL_CYCLE_CAP':null);
      if((reason==='CAPITAL_RESERVE_BLOCK'||reason==='OPEN_POSITION_CAP')&&signals<ACTIVE_LEADER_RISK_POLICY.max_equity_entries_per_cycle){
        const rotated=this.rotateCapital(c,stocks,features(c));
        if(rotated){signals++;this.decision(c,lane,'ENTRY',[],rotated.features,true);continue;}
      }
      if(reason){this.decision(c,lane,'ENTRY',[reason],{...features(c),rotation_attempted:reason==='CAPITAL_RESERVE_BLOCK'||reason==='OPEN_POSITION_CAP'});continue;}
      const budget=Math.min(ACTIVE_LEADER_RISK_POLICY.target_entry_notional,Math.max(0,this.cash-ACTIVE_LEADER_RISK_POLICY.protected_cash_reserve)),liquidity=executionLiquidity;
      let qty=Math.min(budget/q.ap,liquidity*.05);
      const fill=(n:number)=>q.ap*(1+Math.min(.01,.0002+n/Math.max(1,liquidity)*.025));
      if(qty*fill(qty)>budget)qty=budget/fill(qty);
      const px=fill(qty),cost=qty*px;
      if(!(cost>.01)||!(qty>0)){this.decision(c,lane,'ENTRY',[liquidity?'POSITION_SIZE_ZERO':'MINUTE_LIQUIDITY_LIMIT'],features(c));continue;}
      const f={...features(c),asset_type:'equity',max_hold_minutes:720,quantity:qty,target_notional:budget,actual_notional:cost,minute_participation:qty/liquidity,fractional_paper:true,entry_slippage_pct:px/q.ap-1,rotated_out:null};
      this.addPosition(c,'equity',c.symbol,qty,px,cost,f);this.usedQuote(q);signals++;
      this.decision(c,lane,'ENTRY',[],f,true);
    }
  }
  addPosition(c:Row,kind:string,symbol:string,qty:number,px:number,cost:number,features:Row){
    this.cashDebit+=cost;
    this.newPositions.push({kind,account_id:ACTIVE_ACCOUNT,symbol,...(kind==='option'?{underlying:c.symbol,current_mark:px,current_mark_at:this.now.toISOString(),data_quality:'indicative'}:{}),
      opened_at:this.now.toISOString(),entry_price:px,quantity:qty,entry_notional:cost,stop_price:px*(kind==='option'?.65:.95),target_price:px*3,
      highest_price:px,lowest_price:px,entry_score:c.score,entry_day_change_pct:c.dayChangePct,opened_phase:this.phase,features:JSON.stringify(features),
      status:'open',version:CAPACITY_VERSION,remaining_qty:qty,locked_realized_pnl:0,take200_done:0,take200_price:null,take200_at:null,runner_high:null});
  }
  async enterOptions(candidates:Row[],stocks:Record<string,any>,marks:Record<string,any>,chain:(c:any,direction:'bull'|'bear')=>Promise<any[]>,features:(c:any)=>Row){
    if(this.phase!=='regular')return;
    let attempts=0,signals=0;
    for(const c of candidates){
      if(!(c.price>=.1&&c.dayChangePct>=-8&&c.dayChangePct<=10&&c.spreadPct<=(c.price<.5?8:6)&&c.score>=15))continue;
      const direction=optionDirection(c as any);if(!direction)continue;
      const reject=(reasons:string[],stage='ENTRY',extra:Row={})=>this.decision(c,'OPTIONS_MOMENTUM',stage,reasons,{...features(c),...extra});
      if(!this.fresh(stocks[c.symbol]?.latestQuote)){reject(['EXECUTION_QUOTE_STALE']);continue;}
      const reason=this.reason(c.symbol)??(signals>=3?'OPTION_SIGNAL_CYCLE_CAP':null);if(reason){reject([reason]);continue;}
      if(attempts>=8){reject(['OPTION_RESEARCH_BUDGET'],'OPTION_CHAIN');continue;}attempts++;
      let rows:any[];try{rows=await chain(c,direction);}catch{reject(['OPTION_CHAIN_UNAVAILABLE','DATA_PROVIDER_FAILURE'],'OPTION_CHAIN');continue;}
      const failures=new Set<string>();
      const usable=rows.filter(x=>{
        const q=x.s.latestQuote,m=x.meta;if(!m||!this.fresh(q)){failures.add('OPTION_QUOTE_STALE');return false;}
        if((q.ap-q.bp)/q.ap>.2){failures.add('OPTION_SPREAD_TOO_WIDE');return false;}
        if(!(Number(q.as)>=1&&Number(q.bs)>=1)){failures.add('OPTION_LIQUIDITY_INSUFFICIENT');return false;}
        const days=(Date.parse(m.expiration+'T20:00:00Z')-this.now.getTime())/86400000;
        if(days<6||days>46||Math.abs(m.strike/c.price-1)>.15){failures.add('OPTION_EXPIRY_OR_STRIKE_OUTSIDE_LANE');return false;}
        const delta=x.s.greeks?.delta;if(delta!=null&&(!Number.isFinite(delta)||Math.abs(delta)<.25||Math.abs(delta)>.75||(direction==='bull'?delta<=0:delta>=0))){failures.add('OPTION_DELTA_OUTSIDE_LANE');return false;}return true;
      }).sort((a,b)=>{const cost=(x:any)=>Math.abs(x.meta.strike/c.price-1)+(x.s.latestQuote.ap-x.s.latestQuote.bp)/x.s.latestQuote.ap;return cost(a)-cost(b)||a.meta.expiration.localeCompare(b.meta.expiration);});
      const x=usable[0];if(!x){reject(rows.length?[...failures]:['OPTION_CHAIN_UNAVAILABLE'],'OPTION_CHAIN');continue;}
      marks[x.symbol]=x.s;
      reject(['OPTION_EXECUTION_QUOTE_NOT_AUTHORITATIVE'],'ENTRY',{contract:x.symbol,feed:'indicative',research_usable:true});continue;
      const q=x.s.latestQuote,px=q.ap*1.005,budget=Math.min(10,this.cash-30),qty=Math.floor(Math.min(budget/(px*100),q.as));
      if(qty<1){reject(['OPTION_CONTRACT_TOO_EXPENSIVE'],'ENTRY',{premium:px,contract:x.symbol,target_notional:budget});continue;}
      const cost=qty*px*100,f={...features(c),asset_type:'option',max_hold_minutes:1440,option_type:x.meta.type,strike:x.meta.strike,expiration:x.meta.expiration,data_quality:'indicative',delta:x.s.greeks?.delta??null,quote_at:q.t,entry_slippage_pct:.005,target_notional:budget,actual_notional:cost,whole_contracts:true};
      this.addPosition(c,'option',x.symbol,qty,px,cost,f);marks[x.symbol]=x.s;Object.assign(this.newPositions[this.newPositions.length-1],{current_mark:q.bp,current_mark_at:q.t});this.usedQuote(q);signals++;this.decision(c,'OPTIONS_MOMENTUM','ENTRY',[],f,true);
    }
  }
}

const positionColumns='account_id,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,entry_score,entry_day_change_pct,opened_phase,features,status,version,remaining_qty,locked_realized_pnl,take200_done,take200_price,take200_at,runner_high'.split(',');
const patchColumns='status,remaining_qty,locked_realized_pnl,take200_done,take200_price,take200_at,runner_high,highest_price,lowest_price'.split(',');
const tradeColumns='account_id,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct'.split(',');
const eventColumns='account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version'.split(',');
export function accountingStatements(db:D1Database,plan:LeaderPlan){
  const ss:D1PreparedStatement[]=[];
  ss.push(db.prepare('INSERT OR REPLACE INTO hunt_risk_guards VALUES(?,?)').bind(ACTIVE_ACCOUNT,plan.account.revision));
  if(plan.rotationRiskDirty)ss.push(db.prepare(`INSERT INTO leader_daily_risk(session_date,account_id,rotations,last_rotation_at) VALUES(?,?,?,?) ON CONFLICT(session_date,account_id) DO UPDATE SET rotations=excluded.rotations,last_rotation_at=excluded.last_rotation_at`).bind(sessionDate(plan.now),ACTIVE_ACCOUNT,plan.rotationCountToday,plan.lastRotationAt));
  // Credit exits before inserting entries; reserve and cap triggers see the post-exit account.
  if(plan.cashCredit)ss.push(db.prepare('UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+? WHERE account_id=?').bind(plan.cashCredit,plan.pnlDelta,ACTIVE_ACCOUNT));
  for(const kind of ['equity','option'] as const){
    const option=kind==='option',table=TABLES[kind],updated=plan.touched.filter(p=>p.kind===kind),trades=plan.trades.filter(p=>p.kind===kind),events=plan.events.filter(p=>p.kind===kind);
    if(updated.length)ss.push(patchRows(db,table,updated,[...patchColumns,...(option?['current_mark','current_mark_at']:[])]));
    if(trades.length)ss.push(ingest(db,option?'hunt_account_option_trades':'hunt_account_trades',trades,[...tradeColumns,...(option?['underlying','data_quality']:[])]));
    if(events.length)ss.push(ingest(db,option?'hunt_account_option_events':'hunt_account_events',events,[...eventColumns,...(option?['underlying']:[])]));
  }
  for(const kind of ['equity','option'] as const){const rows=plan.newPositions.filter(p=>p.kind===kind);if(rows.length)ss.push(ingest(db,TABLES[kind],rows,[...positionColumns,...(kind==='option'?['underlying','current_mark','current_mark_at','data_quality']:[])]));}
  if(plan.cashDebit)ss.push(db.prepare('UPDATE hunt_accounts SET cash=cash-? WHERE account_id=?').bind(plan.cashDebit,ACTIVE_ACCOUNT));
  if(plan.intents.length)ss.push(ingest(db,'hunt_exit_intents',plan.intents,['kind','position_id','reason','requested_at'],'ON CONFLICT(kind,position_id) DO NOTHING'));
  return ss;
}

export function valuation(plan:LeaderPlan,stocks:Row,options:Row,retained:Row[]){
  const marks=plan.open.map(p=>{
    const q=(p.kind==='option'?options:stocks)[p.symbol]?.latestQuote,qty=p.remaining_qty*(p.kind==='option'?100:1);
    const m=markState(p.symbol,p.kind,q,qty,'bid',Date.now(),p.kind!=='option'||plan.phase==='regular');
    if(m.reporting_value!==null)return m;
    const old=retained.find(r=>r.symbol===p.symbol&&r.asset===p.kind);
    const oldMark=markState(p.symbol,p.kind,old?{bp:old.bid,ap:old.ask,t:old.quote_at}:undefined,qty,'bid',Date.now(),false);
    return {...oldMark,state:oldMark.reporting_value===null?'EXECUTION_UNAVAILABLE':'MARK_STALE'};
  });
  const complete=marks.every(m=>m.state==='FRESH'),known=plan.cash+marks.reduce((s,m)=>s+(m.value??0),0);
  return {account_id:ACTIVE_ACCOUNT,created_at:plan.now.toISOString(),cash:plan.cash,live_equity:complete?known:null,known_value:known,
    reporting_value:marks.every(m=>m.reporting_value!==null)?plan.cash+marks.reduce((s,m)=>s+m.reporting_value!,0):null,complete:complete?1:0,marks:JSON.stringify(marks),version:CAPACITY_VERSION};
}
