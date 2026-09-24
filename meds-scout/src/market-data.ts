import {validQuote,type Quote} from './paper-accounting.ts';

type Credentials={ALPACA_API_KEY:string;ALPACA_API_SECRET:string};
export class MarketDataCycle {
  requests=0;
  cacheHits=0;
  retries=0;
  budgetExhausted=false;
  failures:{endpoint:string;status:number|null;reason:string}[]=[];
  latencyMs=0;
  peakConcurrent=0;
  private cache=new Map<string,{at:number;promise:Promise<any>}>();
  private active=0;private waiters:Array<()=>void>=[];
  readonly credentials:Credentials;
  readonly limit:number;readonly maxConcurrent:number;
  constructor(credentials:Credentials,limit=36,maxConcurrent=5){this.credentials=credentials;this.limit=limit;this.maxConcurrent=maxConcurrent;}
  private async acquire(){if(this.active>=this.maxConcurrent)await new Promise<void>(resolve=>this.waiters.push(resolve));this.active++;this.peakConcurrent=Math.max(this.peakConcurrent,this.active);}
  private release(){this.active--;this.waiters.shift()?.();}
  async json(path:string,ttlMs=15_000):Promise<any>{
    const prior=this.cache.get(path);
    if(prior&&Date.now()-prior.at<ttlMs){this.cacheHits++;return prior.promise;}
    const promise=this.request(path);
    this.cache.set(path,{at:Date.now(),promise});
    return promise;
  }
  private async request(path:string){
    if(this.requests>=this.limit){this.budgetExhausted=true;throw new Error('DATA_REQUEST_BUDGET_EXHAUSTED');}
    this.requests++;await this.acquire();
    const start=Date.now(),endpoint=path.split('?')[0];
    let status:number|null=null;
    try{
      const response=await fetch('https://data.alpaca.markets'+path,{
        headers:{'APCA-API-KEY-ID':this.credentials.ALPACA_API_KEY,'APCA-API-SECRET-KEY':this.credentials.ALPACA_API_SECRET},
        redirect:'manual',signal:AbortSignal.timeout(5000),
      });
      status=response.status;
      if(!response.ok) throw new Error('DATA_PROVIDER_HTTP_'+status);
      return await response.json();
    }catch(error){
      this.failures.push({endpoint,status,reason:error instanceof Error?error.message.slice(0,120):'DATA_PROVIDER_FAILURE'});
      throw error;
    }finally{this.latencyMs+=Date.now()-start;this.release();}
  }
  metrics(){return {requests:this.requests,request_limit:this.limit,max_concurrent:this.maxConcurrent,peak_concurrent:this.peakConcurrent,budget_exhausted:this.budgetExhausted,cache_hits:this.cacheHits,retries:this.retries,provider_latency_ms:this.latencyMs,failures:this.failures};}
}

export function mandatoryUniverse(held:string[],discovered:string[],continuity:string[],cap:number){
  const must=[...new Set(held)];
  const seen=new Set(must);
  const optional=[...discovered,...continuity].filter(s=>{if(seen.has(s))return false;seen.add(s);return true;});
  // A research cap can never remove a held asset from management.
  return [...must,...optional.slice(0,Math.max(0,cap-must.length))];
}

export async function refreshHeldQuotes(db:D1Database,client:MarketDataCycle,stocks:Record<string,any>,symbols:string[],feed:string){
  const stale=[...new Set(symbols)].filter(s=>!validQuote(stocks[s]?.latestQuote));
  for(let i=0;i<stale.length;i+=50){
    const batch=stale.slice(i,i+50);client.retries++;
    try{
      const result=await client.json('/v2/stocks/quotes/latest?'+new URLSearchParams({symbols:batch.join(','),feed}),0);
      for(const symbol of batch){
        const q=result.quotes?.[symbol];
        if(validQuote(q)) stocks[symbol]={...stocks[symbol],latestQuote:q};
      }
    }catch{/* Other symbols and position managers can continue safely. */}
  }
  await retainQuotes(db,'equity',stocks,symbols,feed,stale);
  return stale.length;
}

export async function retainQuotes(db:D1Database,asset:string,snaps:Record<string,any>,symbols:string[],feed:string,retried:string[]=[]){
  const now=new Date(),statements:D1PreparedStatement[]=[];
  for(const symbol of new Set(symbols)){
    const q:Quote|undefined=snaps[symbol]?.latestQuote;
    const t=Date.parse(q?.t??'');
    const shaped=q&&q.bp!>0&&q.ap!>=q.bp!&&Number.isFinite(t)&&t<=now.getTime();
    if(shaped) statements.push(db.prepare(`INSERT INTO quote_cache VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(asset,symbol) DO UPDATE SET
      feed=excluded.feed,quote_at=excluded.quote_at,bid=excluded.bid,ask=excluded.ask,bid_size=excluded.bid_size,ask_size=excluded.ask_size,retrieved_at=excluded.retrieved_at
      WHERE excluded.quote_at>=quote_cache.quote_at`).bind(asset,symbol,feed,q!.t!,q!.bp!,q!.ap!,q!.bs??null,q!.as??null,now.toISOString()));
    const state=validQuote(q)?'FRESH':shaped?'MARK_STALE':'EXECUTION_UNAVAILABLE';
    statements.push(db.prepare(`INSERT INTO quote_health VALUES(?,?,?,?,?,?,?) ON CONFLICT(asset,symbol) DO UPDATE SET
      state=excluded.state,quote_at=excluded.quote_at,last_attempt_at=excluded.last_attempt_at,attempts=excluded.attempts,error=excluded.error`)
      .bind(asset,symbol,state,shaped?q!.t!:null,now.toISOString(),retried.includes(symbol)?2:1,state==='FRESH'?null:'MARK_RETRYING: bounded retry on next engine cycle'));
  }
  for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
}

// Retained quotes are for explicitly dated reporting, never an execution feed.
export async function retainedQuoteMap(db:D1Database){
  const rows=await db.prepare('SELECT * FROM quote_cache').all<any>();
  return new Map((rows.results??[]).map(r=>[r.asset+':'+r.symbol,{bp:r.bid,ap:r.ask,bs:r.bid_size,as:r.ask_size,t:r.quote_at} as Quote]));
}
