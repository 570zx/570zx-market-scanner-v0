import {validQuote} from './paper-accounting.ts';

// Any displayed bid is at least one share. Without this floor a fractional
// dust position in a thin name (no minute bar inside 3 minutes) has zero exit
// capacity forever, even while a fresh bid is being quoted. v8.6 lets up to
// one share exit against a fresh displayed bid; larger size stays capped at
// 5% of recent minute volume.
export const DISPLAYED_BID_FLOOR_SHARES=1;
export function equityExitCapacity(snapshot:any,now=Date.now()){
  const t=Date.parse(snapshot?.minuteBar?.t??'');
  const v=Number(snapshot?.minuteBar?.v);
  const minute=Number.isFinite(t)&&t<=now&&now-t<=180_000&&Number.isFinite(v)&&v>0?v*.05:0;
  const q=snapshot?.latestQuote;
  const displayed=validQuote(q,now)&&Number(q.bs)>0?DISPLAYED_BID_FLOOR_SHARES:0;
  return Math.max(minute,displayed);
}

// A stop is an intent to liquidate, not a promise that unlimited size filled.
// If only part is executable, retain the intent through a later price rebound.
export async function partialLeaderExit(db:D1Database,kind:'equity'|'option',p:any,qty:number,fill:number,reason:string,locked:number,now:Date){
  if(!(qty>0)){
    await db.prepare('INSERT OR IGNORE INTO hunt_exit_intents VALUES(?,?,?,?)').bind(kind,p.id,reason,now.toISOString()).run();
    return false;
  }
  const multiplier=kind==='option'?100:1;
  const remaining=Number(p.remaining_qty??p.quantity)-qty;
  const pnl=(fill-Number(p.entry_price))*qty*multiplier;
  const table=kind==='option'?'hunt_account_option_positions':'hunt_account_positions';
  const events=kind==='option'?'hunt_account_option_events':'hunt_account_events';
  const columns=kind==='option'?'account_id,position_id,underlying,symbol,created_at,event_type,price,quantity,realized_pnl,details,version':'account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version';
  const values=[p.account_id,p.id,...(kind==='option'?[p.underlying]:[]),p.symbol,now.toISOString(),'PARTIAL_EXIT_'+now.toISOString(),fill,qty,pnl,JSON.stringify({reason,remaining_qty:remaining,liquidity_limited:true}),p.version];
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO hunt_exit_intents VALUES(?,?,?,?)').bind(kind,p.id,reason,now.toISOString()),
    db.prepare(`UPDATE ${table} SET remaining_qty=?,locked_realized_pnl=?,highest_price=?,lowest_price=? WHERE id=?`).bind(remaining,locked+pnl,p.highest_price,p.lowest_price,p.id),
    db.prepare('UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?').bind(fill*qty*multiplier,pnl,now.toISOString(),p.account_id),
    db.prepare(`INSERT INTO ${events}(${columns}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values),
  ]);
  return true;
}
