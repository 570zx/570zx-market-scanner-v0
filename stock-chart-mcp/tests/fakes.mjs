import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

// D1 over node:sqlite, with the migrations applied.
export class D1 {
  constructor(){
    this.db=new DatabaseSync(':memory:');
    const dir=new URL('../migrations/',import.meta.url);
    for(const f of readdirSync(dir).sort())this.db.exec(readFileSync(new URL(f,dir),'utf8'));
  }
  prepare(sql){const db=this.db;return {args:[],bind(...a){this.args=a;return this;},
    async run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};},
    async all(){return {results:db.prepare(sql).all(...this.args)};},
    async first(){return db.prepare(sql).get(...this.args)??null;}};}
  async batch(st){this.db.exec('BEGIN');try{const r=[];for(const s of st)r.push(await s.run());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}

// Deterministic random walk of 5-minute bars for one ET session (EDT, UTC-4).
export function sessionBars(date,{start=100,seed=1,count=78,drift=0.0004}={}){
  let x=seed,p=start;const rnd=()=>((x=(x*16807)%2147483647)/2147483647);
  const open=Date.parse(date+'T13:30:00Z'),bars=[];
  for(let i=0;i<count;i++){
    const o=p,c=Math.max(1,o*(1+drift+(rnd()-0.5)*0.006));
    const h=Math.max(o,c)*(1+rnd()*0.002),l=Math.min(o,c)*(1-rnd()*0.002);
    bars.push({t:new Date(open+i*300_000).toISOString(),o:+o.toFixed(2),h:+h.toFixed(2),l:+l.toFixed(2),c:+c.toFixed(2),v:Math.round(5000+rnd()*20000)});
    p=c;
  }
  return bars;
}
export function dailyBars(days,{start=95}={}){
  return days.map((d,i)=>({t:d+'T04:00:00Z',o:start+i,h:start+i+2,l:start+i-1,c:start+i+1,v:1e6}));
}

// Fake Alpaca data API. `book` maps symbol -> {intraday, daily}.
export function fakeAlpaca(book,log=[]){
  return async(url,init)=>{
    log.push(url);
    const u=new URL(url);
    if(u.hostname!=='data.alpaca.markets')return new Response('ok');
    const snap=u.pathname.match(/^\/v2\/stocks\/([^/]+)\/snapshot$/);
    if(snap){
      const b=book[snap[1]];if(!b)return new Response('{}',{status:404});
      const last=b.intraday.at(-1),daily=b.daily;
      return Response.json({latestTrade:{t:last.t,p:last.c},latestQuote:{t:last.t,bp:last.c-0.01,ap:last.c+0.01},
        dailyBar:{...daily.at(-1),c:last.c},prevDailyBar:daily.at(-2)});
    }
    if(u.pathname==='/v2/stocks/bars'){
      const tf=u.searchParams.get('timeframe'),startMs=Date.parse(u.searchParams.get('start'));
      const bars={};
      for(const s of u.searchParams.get('symbols').split(',')){
        const b=book[s];if(!b)continue;
        bars[s]=(tf==='1Day'||tf==='1Week'?b.daily:b.intraday).filter(x=>Date.parse(x.t)>=startMs);
      }
      return Response.json({bars,next_page_token:null});
    }
    return new Response('not found',{status:404});
  };
}
