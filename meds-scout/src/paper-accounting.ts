export const SIM_VERSION = 'paper-v2-resilient-valuation';
export const EXEC_VERSION = 'observed-side-v2-liquidity';
export type Quote = {bp?:number; ap?:number; bs?:number; as?:number; t?:string};
export const LIMITS = {totalRisk:0.05, underlyingRisk:0.01, underlyingAllocation:0.25, grossAllocation:1, maxAgeMs:90_000, optionFriction:0.20};
export function validQuote(q:Quote|undefined, now=Date.now()): q is Quote & {bp:number;ap:number;t:string} {
  const t=Date.parse(q?.t??'');
  return !!q && Number.isFinite(q.bp) && Number.isFinite(q.ap) && q.bp!>0 && q.ap!>=q.bp! && Number.isFinite(t) && t<=now && now-t<=LIMITS.maxAgeMs;
}
export function equityExit(q:Quote,direction:string,trigger:number,quantity:number,now=Date.now()) {
  if(!validQuote(q,now)) return null;
  const observed=direction==='long'?q.bp:q.ap;
  // Fixed adverse 2bp assumption, separate from the already-paid bid/ask spread.
  const slip=observed*0.0002;
  return {trigger_price:trigger,observed_bid:q.bp,observed_ask:q.ap,quote_at:q.t,
    modeled_fill:direction==='long'?observed-slip:observed+slip,
    slippage_per_unit:slip,slippage_total:slip*quantity,execution_version:EXEC_VERSION};
}
export function optionQuote(long:Quote|undefined,short:Quote|undefined,width:number|null,now=Date.now()) {
  if(!validQuote(long,now) || (width!==null && !validQuote(short,now))) return null;
  if(short && Math.abs(Date.parse(long.t)-Date.parse(short.t!))>15_000) return null;
  const entry=long.ap-(width===null?0:short!.bp!);
  const liquidation=long.bp-(width===null?0:short!.ap!);
  if(width!==null && (!(width>0)||entry>=width||liquidation>width)) return null;
  if(!(entry>0) || liquidation<0) return null;
  return {entry,liquidation,friction:(entry-liquidation)/entry,long_bid:long.bp,long_ask:long.ap,
    short_bid:width===null?null:short!.bp!,short_ask:width===null?null:short!.ap!,
    quote_at:long.t,short_quote_at:short?.t??null};
}
export type Exposure = {underlying:string;risk:number;notional:number;unrealized:number};
export function riskCapacity(equity:number,exposures:Exposure[],underlying:string) {
  if(!Number.isFinite(equity)||equity<=0) return {risk:0,allocation:0};
  const same=exposures.filter(x=>x.underlying===underlying);
  // Existing losses consume budget in addition to reserved planned risk.
  const risk=(xs:Exposure[])=>xs.reduce((n,x)=>n+x.risk+Math.max(0,-x.unrealized),0);
  const allocation=(xs:Exposure[])=>xs.reduce((n,x)=>n+x.notional,0);
  return {risk:Math.max(0,Math.min(equity*LIMITS.totalRisk-risk(exposures),equity*LIMITS.underlyingRisk-risk(same))),
    allocation:Math.max(0,Math.min(equity*LIMITS.grossAllocation-allocation(exposures),equity*LIMITS.underlyingAllocation-allocation(same)))};
}
