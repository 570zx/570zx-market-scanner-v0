export type ResearchCandidate={symbol:string;price:number;bid:number;ask:number;spreadPct:number;dayChangePct:number;score:number;
  catalystScore:number;volumeAccel:number;dayVolume:number;previousDayVolume:number;minuteVolume:number;consecutiveHits:number;
  executionFresh?:boolean;quoteAgeMs?:number;discoverySource?:string;discoveryRank?:number|null;dataWarnings?:string[]};

export function runnerReasons(c:ResearchCandidate):string[]{
  const reasons:string[]=[...(c.dataWarnings??[])];
  if(!(c.price>=.10)) reasons.push('PRICE_BELOW_MIN');
  if(c.price>25) reasons.push('PRICE_ABOVE_RUNNER_LANE');
  if(c.dayChangePct< -3) reasons.push('MOVE_TOO_NEGATIVE');
  if(!Number.isFinite(c.spreadPct)||c.spreadPct>(c.price<.5?8:6)) reasons.push('SPREAD_TOO_WIDE');
  if(c.catalystScore<0) reasons.push('CATALYST_NEGATIVE');
  if(!(c.score>=15)) reasons.push('SCORE_TOO_LOW');

  const relative=c.previousDayVolume>0?c.dayVolume/c.previousDayVolume:0;
  const hotSource=['top_gainer','fresh_news'].includes(c.discoverySource??'');
  const ignition=hotSource||c.catalystScore>0||c.volumeAccel>=.08||relative>=.6||c.consecutiveHits>=2;
  if(!ignition){
    reasons.push('NO_IGNITION_SIGNAL');
    if(relative<.6) reasons.push('RELATIVE_VOLUME_TOO_LOW');
    if(c.volumeAccel<.08) reasons.push('VOLUME_ACCEL_TOO_LOW');
  }

  // A move above +10% is no longer automatically "too late." Leader Hunt is
  // explicitly trying to capture asymmetric continuation. As the move gets
  // larger, demand progressively stronger independent evidence instead of
  // applying an arbitrary percentage ceiling.
  if(c.dayChangePct>10){
    const accelThreshold=c.dayChangePct>150?.20:c.dayChangePct>75?.12:.08;
    const relativeThreshold=c.dayChangePct>150?1.5:c.dayChangePct>75?1.0:.6;
    const evidence=[
      hotSource,
      c.catalystScore>0,
      c.volumeAccel>=accelThreshold,
      relative>=relativeThreshold,
      c.consecutiveHits>=2,
    ].filter(Boolean).length;
    const required=c.dayChangePct>150?4:c.dayChangePct>75?3:2;
    if(evidence<required) reasons.push('CONTINUATION_SIGNAL_WEAK');
    const continuationSpread=c.dayChangePct>75?3:c.dayChangePct>35?4:(c.price<.5?6:5);
    if(c.spreadPct>continuationSpread) reasons.push('CONTINUATION_SPREAD_TOO_WIDE');
  }
  return reasons;
}

export function executionReasons(c:ResearchCandidate){
  if(c.executionFresh===true) return [];
  return [Number.isFinite(c.quoteAgeMs)?'EXECUTION_QUOTE_STALE':'EXECUTION_QUOTE_MISSING'];
}

export function optionDirection(c:ResearchCandidate):'bull'|'bear'|null{
  const participation=c.volumeAccel>=.08||(c.previousDayVolume>0&&c.dayVolume/c.previousDayVolume>=.6);
  if(c.dataWarnings?.length||c.score<52||!participation||!(c.minuteVolume>0)||c.spreadPct>2.5) return null;
  if(c.dayChangePct>=.75&&c.dayChangePct<=10&&c.catalystScore>=0) return 'bull';
  if(c.dayChangePct<=-.75&&c.dayChangePct>=-8&&c.catalystScore<=0) return 'bear';
  return null;
}

export function candidateLane(c:ResearchCandidate){
  if(c.catalystScore<0||c.dayChangePct< -3) return 'NEGATIVE_CONTROL';
  if(c.price<=25&&c.dayChangePct>10) return 'MOMENTUM_CONTINUATION';
  if(c.price<1) return 'PENNY_RUNNER';
  if(c.price<=25) return 'ASYMMETRIC_EQUITY_RUNNER';
  return 'LIQUID_CONTROL';
}

export function orderedRunnerCandidates<T extends ResearchCandidate>(candidates:T[],fresh:(c:T)=>boolean):T[]{
  // The research shortlist already reserves early sources. Never score-sort
  // it again here. Filter with the actual current quote BEFORE filling slots.
  return candidates.filter(c=>runnerReasons(c).length===0&&fresh(c));
}

export function preservedMaxHold(version:string,asset:'equity'|'option',features:string){
  try{const n=Number(JSON.parse(features).max_hold_minutes);if(Number.isFinite(n)&&n>0)return n;}catch{}
  if(/^leader-hunt-v(?:7|8(?:\.(?:1|2|3|4))?)-/.test(version)) return asset==='option'?1440:720;
  return 120;
}
