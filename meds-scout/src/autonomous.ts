import {validQuote, SIM_VERSION, EXEC_VERSION, type Quote} from './paper-accounting.ts';

export const ENGINE_VERSION = 'meds-v8.1-leader250-capacity';
export const LEADER_VERSION = 'leader-hunt-v8.1-leader250-capacity';
export const SCHEMA_VERSION = 11;
export const LEASE_MS = 6 * 60_000;

// Additive, replayable migration. Existing trades, versions, cash and peaks
// are never rewritten. SQL is also emitted to migrations/0004_autonomous.sql.
export const AUTONOMOUS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS engine_write_guard(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, checked_at INTEGER NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS engine_fence_v8 BEFORE INSERT ON engine_write_guard
    WHEN NOT EXISTS(SELECT 1 FROM service_state WHERE id=1 AND paused=0 AND lock_owner=NEW.owner AND lock_until>NEW.checked_at)
    BEGIN SELECT RAISE(ABORT,'engine lease lost or paused'); END`,
  `CREATE TABLE IF NOT EXISTS engine_cycles(bucket TEXT PRIMARY KEY,started_at TEXT NOT NULL,completed_at TEXT,management_at TEXT,state TEXT NOT NULL,metrics TEXT NOT NULL DEFAULT '{}',version TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quote_cache(asset TEXT NOT NULL,symbol TEXT NOT NULL,feed TEXT NOT NULL,quote_at TEXT NOT NULL,bid REAL NOT NULL,ask REAL NOT NULL,bid_size REAL,ask_size REAL,retrieved_at TEXT NOT NULL,PRIMARY KEY(asset,symbol))`,
  `CREATE TABLE IF NOT EXISTS quote_health(asset TEXT NOT NULL,symbol TEXT NOT NULL,state TEXT NOT NULL,quote_at TEXT,last_attempt_at TEXT NOT NULL,attempts INTEGER NOT NULL,error TEXT,PRIMARY KEY(asset,symbol))`,
  `CREATE TABLE IF NOT EXISTS portfolio_valuation_state(account_id TEXT PRIMARY KEY,created_at TEXT NOT NULL,cash REAL NOT NULL,live_equity REAL,known_value REAL NOT NULL,reporting_value REAL,complete INTEGER NOT NULL,marks TEXT NOT NULL,version TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS candidate_decisions(bucket TEXT NOT NULL,created_at TEXT NOT NULL,symbol TEXT NOT NULL,lane TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',stage TEXT NOT NULL,outcome TEXT NOT NULL,reasons TEXT NOT NULL,features TEXT NOT NULL,version TEXT NOT NULL,PRIMARY KEY(bucket,symbol,lane,account_id,stage,version))`,
  `CREATE INDEX IF NOT EXISTS idx_candidate_decision_symbol ON candidate_decisions(symbol,created_at)`,
  `CREATE TABLE IF NOT EXISTS research_outcomes(session_date TEXT NOT NULL,symbol TEXT NOT NULL,version TEXT NOT NULL,first_provider_at TEXT,first_seen_at TEXT,first_price REAL,first_change REAL,source TEXT,instrument_type TEXT NOT NULL,shortlisted_at TEXT,runner_at TEXT,executable_at TEXT,last_seen_at TEXT NOT NULL,high REAL,low REAL,latest_features TEXT NOT NULL,PRIMARY KEY(session_date,symbol,version))`,
  `CREATE TABLE IF NOT EXISTS mover_audits(bucket TEXT NOT NULL,symbol TEXT NOT NULL,session_date TEXT NOT NULL,phase TEXT NOT NULL,rank INTEGER NOT NULL,summary TEXT NOT NULL,version TEXT NOT NULL,PRIMARY KEY(bucket,symbol,version))`,
  `CREATE INDEX IF NOT EXISTS idx_mover_audit_session ON mover_audits(session_date,bucket,rank)`,
  `CREATE TABLE IF NOT EXISTS leader_runtime_accounts(account_id TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 1,role TEXT NOT NULL DEFAULT 'leader',created_at TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('H250','$250',250,250,250,0,250,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `INSERT OR REPLACE INTO leader_runtime_accounts(account_id,active,role,created_at) VALUES('H250',1,'leader',COALESCE((SELECT created_at FROM leader_runtime_accounts WHERE account_id='H250'),strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS hunt_revisions(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO hunt_revisions SELECT account_id,0 FROM hunt_accounts`,
  `CREATE TABLE IF NOT EXISTS hunt_risk_guards(account_id TEXT PRIMARY KEY,expected_revision INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hunt_exit_intents(kind TEXT NOT NULL,position_id INTEGER NOT NULL,reason TEXT NOT NULL,requested_at TEXT NOT NULL,PRIMARY KEY(kind,position_id))`,
  `CREATE TRIGGER IF NOT EXISTS hunt_revision_guard_v8 BEFORE INSERT ON hunt_risk_guards WHEN NOT EXISTS(SELECT 1 FROM hunt_revisions WHERE account_id=NEW.account_id AND revision=NEW.expected_revision) BEGIN SELECT RAISE(ABORT,'concurrent Leader portfolio change'); END`,
  `CREATE TRIGGER IF NOT EXISTS hunt_cash_revision_v8 AFTER UPDATE OF cash ON hunt_accounts BEGIN UPDATE hunt_revisions SET revision=revision+1 WHERE account_id=NEW.account_id; END`,
  `CREATE TRIGGER IF NOT EXISTS hunt_cash_nonnegative_v8 BEFORE UPDATE OF cash ON hunt_accounts WHEN NEW.cash < -0.000001 AND NEW.cash < OLD.cash BEGIN SELECT RAISE(ABORT,'Leader cash cannot be negative'); END`,
  ...['hunt_account_positions','hunt_account_option_positions'].flatMap(table => [
    `CREATE TRIGGER IF NOT EXISTS ${table}_closed_v8 BEFORE UPDATE ON ${table} WHEN OLD.status='closed' BEGIN SELECT RAISE(ABORT,'Leader position already closed'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_quantity_v8 BEFORE UPDATE OF remaining_qty ON ${table} WHEN NEW.remaining_qty < -0.00000001 OR NEW.remaining_qty > OLD.remaining_qty+0.00000001 BEGIN SELECT RAISE(ABORT,'invalid remaining quantity'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_reserve_v8 BEFORE INSERT ON ${table} WHEN NEW.entry_notional > (SELECT cash-starting_equity*0.12+0.00000001 FROM hunt_accounts WHERE account_id=NEW.account_id) BEGIN SELECT RAISE(ABORT,'Leader capital reserve'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_cap_v8 BEFORE INSERT ON ${table} WHEN (SELECT COUNT(*) FROM hunt_account_positions WHERE account_id=NEW.account_id AND status='open')+(SELECT COUNT(*) FROM hunt_account_option_positions WHERE account_id=NEW.account_id AND status='open')>=32 BEGIN SELECT RAISE(ABORT,'Leader open position cap'); END`,
  ]),
  ...['hunt_account_events','hunt_account_option_events'].map(table =>
    `CREATE TRIGGER IF NOT EXISTS ${table}_once_v8 BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE position_id=NEW.position_id AND event_type=NEW.event_type) BEGIN SELECT RAISE(ABORT,'Leader lifecycle event already applied'); END`),
  `CREATE TRIGGER IF NOT EXISTS hunt_equity_duplicate_v8 BEFORE INSERT ON hunt_account_positions WHEN EXISTS(SELECT 1 FROM hunt_account_option_positions WHERE account_id=NEW.account_id AND underlying=NEW.symbol AND status='open') BEGIN SELECT RAISE(ABORT,'duplicate Leader underlying'); END`,
  `CREATE TRIGGER IF NOT EXISTS hunt_option_duplicate_v8 BEFORE INSERT ON hunt_account_option_positions WHEN EXISTS(SELECT 1 FROM hunt_account_positions WHERE account_id=NEW.account_id AND symbol=NEW.underlying AND status='open') OR EXISTS(SELECT 1 FROM hunt_account_option_positions WHERE account_id=NEW.account_id AND underlying=NEW.underlying AND status='open') BEGIN SELECT RAISE(ABORT,'duplicate Leader underlying'); END`,
  `CREATE TRIGGER IF NOT EXISTS hunt_option_whole_v8 BEFORE INSERT ON hunt_account_option_positions WHEN NEW.quantity<1 OR NEW.quantity!=CAST(NEW.quantity AS INTEGER) BEGIN SELECT RAISE(ABORT,'whole option contracts required'); END`,
  `DROP TRIGGER IF EXISTS paper_trade_version_v3`,
  `DROP TRIGGER IF EXISTS paper_cycle_version_v3`,
  `CREATE TRIGGER IF NOT EXISTS paper_trade_version_v8 AFTER INSERT ON paper_trades BEGIN UPDATE paper_trades SET simulator_version='${SIM_VERSION}',execution_version='${EXEC_VERSION}' WHERE id=NEW.id; END`,
  `CREATE TRIGGER IF NOT EXISTS paper_cycle_version_v8 AFTER INSERT ON paper_cycles BEGIN UPDATE paper_cycles SET simulator_version='${SIM_VERSION}',execution_version='${EXEC_VERSION}' WHERE bucket=NEW.bucket; END`,
  `UPDATE paper_meta SET version=11 WHERE id=1`,
];

export async function ensureAutonomousSchema(db:D1Database) {
  await db.batch(AUTONOMOUS_SCHEMA.map(sql=>db.prepare(sql)));
}

// Every runtime mutation, including an entire cash/position/event batch, has
// its lease checked inside the same D1 transaction. An expired invocation can
// never write after a new owner takes over. Reads do not renew the lease.
export type DatabaseUsage={calls:number;statements:number;rows_read:number;rows_written:number};
export function fencedDatabase(db:D1Database, owner:string,usage:DatabaseUsage={calls:0,statements:0,rows_read:0,rows_written:0}):D1Database {
  const underlying=new WeakMap<object,D1PreparedStatement>();
  const batch=async(statements:D1PreparedStatement[])=>{
    const now=Date.now();
    usage.calls++;usage.statements+=statements.length+2;
    const results=await db.batch([
      db.prepare('INSERT OR REPLACE INTO engine_write_guard VALUES(1,?,?)').bind(owner,now),
      ...statements.map(s=>underlying.get(s)??s),
      db.prepare('UPDATE service_state SET lock_until=? WHERE id=1 AND lock_owner=?').bind(now+LEASE_MS,owner),
    ]);
    for(const r of results){usage.rows_read+=Number(r.meta?.rows_read??0);usage.rows_written+=Number(r.meta?.rows_written??0);}
    return results.slice(1,-1);
  };
  const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>{
    const p=new Proxy(statement,{get(target,key){
      if(key==='bind') return (...args:unknown[])=>wrap(target.bind(...args));
      if(key==='run') return async()=> (await batch([target]))[0];
      if(key==='first'||key==='all'||key==='raw') return async(...args:any[])=>{
        usage.calls++;usage.statements++;
        const result=await (target[key] as any)(...args);
        usage.rows_read+=Number(result?.meta?.rows_read??0);
        return result;
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    underlying.set(p,statement);return p;
  };
  return new Proxy(db,{get(target,key){
    if(key==='prepare') return (sql:string)=>wrap(target.prepare(sql));
    if(key==='batch') return batch;
    if(key==='exec') return ()=>{throw new Error('unfenced exec is not supported');};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}

export type MarkState={symbol:string;asset:string;state:string;value:number|null;reporting_value:number|null;quote_at:string|null;age_seconds:number|null};
export function markState(symbol:string,asset:string,quote:Quote|undefined,qty:number,side:'bid'|'ask'='bid',now=Date.now(),marketOpen=true):MarkState {
  const t=Date.parse(quote?.t??'');
  const wellFormed=!!quote && Number.isFinite(quote.bp)&&Number.isFinite(quote.ap)&&quote.bp!>0&&quote.ap!>=quote.bp!&&Number.isFinite(t)&&t<=now;
  const fresh=marketOpen&&validQuote(quote,now);
  const value=wellFormed?Number(side==='bid'?quote!.bp:quote!.ap)*qty:null;
  return {symbol,asset,state:fresh?'FRESH':wellFormed?'MARK_STALE':'EXECUTION_UNAVAILABLE',value:fresh?value:null,
    reporting_value:value,quote_at:wellFormed?quote!.t!:null,age_seconds:wellFormed?Math.floor((now-t)/1000):null};
}
export async function saveValuation(db:D1Database,account:string,cash:number,marks:MarkState[],version:string,now=new Date(),critical=false){
  const complete=!critical&&Number.isFinite(cash)&&marks.every(m=>m.state==='FRESH');
  const known=cash+marks.reduce((n,m)=>n+(m.value??0),0);
  const reporting=marks.every(m=>m.reporting_value!==null)?cash+marks.reduce((n,m)=>n+m.reporting_value!,0):null;
  await db.prepare(`INSERT INTO portfolio_valuation_state VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
    created_at=excluded.created_at,cash=excluded.cash,live_equity=excluded.live_equity,known_value=excluded.known_value,
    reporting_value=excluded.reporting_value,complete=excluded.complete,marks=excluded.marks,version=excluded.version`)
    .bind(account,now.toISOString(),cash,complete?known:null,known,reporting,complete?1:0,JSON.stringify(marks),version).run();
  return {complete,equity:complete?known:null,known_value:known,reporting_value:reporting,marks};
}

export function healthState(enabled:boolean,active:boolean,lastSuccess:string|null,error:string|null,degraded:boolean,cadenceMinutes=5,now=Date.now()){
  if(!enabled) return 'PAUSED';
  if(error) return 'ENGINE_CRITICAL';
  if(!active) return 'MARKET_CLOSED';
  const age=now-Date.parse(lastSuccess??'');
  if(!Number.isFinite(age)||age>(cadenceMinutes+2)*60_000) return 'ENGINE_STALE';
  return degraded?'DEGRADED':'HEALTHY';
}

export function plannedCadence(phase:string){return phase==='regular'?5:phase==='overnight'?30:phase==='closed'?0:10;}
