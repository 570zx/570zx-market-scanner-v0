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

// Deterministic random walk of 5-minute bars (EDT, UTC-4). By default one
// regular session; `extended` adds premarket 4:00-9:30 and after-hours
// 16:00-20:00 bars with thin volume.
export function sessionBars(date,{start=100,seed=1,count=78,drift=0.0004,extended=false}={}){
  let x=seed,p=start;const rnd=()=>((x=(x*16807)%2147483647)/2147483647);
  const open=Date.parse(date+'T13:30:00Z'),bars=[];
  const first=extended?-66:0,last=extended?count+48:count;
  for(let i=first;i<last;i++){
    const thin=i<0||i>=count;
    const o=p,c=Math.max(0.01,o*(1+drift+(rnd()-0.5)*0.006));
    const h=Math.max(o,c)*(1+rnd()*0.002),l=Math.min(o,c)*(1-rnd()*0.002);
    bars.push({t:new Date(open+i*300_000).toISOString(),o:+o.toFixed(4),h:+h.toFixed(4),l:+l.toFixed(4),c:+c.toFixed(4),v:Math.round((thin?50:5000)+rnd()*(thin?300:20000))});
    p=c;
  }
  return bars;
}
export function dailyBars(days,{start=95}={}){
  return days.map((d,i)=>({t:d+'T04:00:00Z',o:start+i,h:start+i+2,l:start+i-1,c:start+i+1,v:1e6}));
}

// Fake Alpaca market-data API. `book` maps symbol -> {intraday, daily}.
// opts.refuseSip: answer 403 to feed=sip. opts.noSnapshot: 400 on snapshots.
// Every call is recorded in `log` as {url, method}.
export function fakeAlpaca(book,log=[],opts={}){
  return async(url,init={})=>{
    log.push({url,method:init.method??'GET'});
    const u=new URL(url);
    if(u.hostname!=='data.alpaca.markets')return new Response('ok');
    const feed=u.searchParams.get('feed');
    if(opts.refuseSip&&(feed==='sip'||feed==='delayed_sip'))return Response.json({message:'subscription does not permit querying recent SIP data'},{status:403});
    const snap=u.pathname.match(/^\/v2\/stocks\/([^/]+)\/snapshot$/);
    if(snap){
      if(opts.noSnapshot)return new Response('{}',{status:400});
      const b=book[snap[1]];if(!b)return new Response('{}',{status:404});
      const last=b.intraday.at(-1),daily=b.daily;
      // Snapshots are not split-adjusted: prevDailyBar here is deliberately 60x.
      return Response.json({latestTrade:{t:last.t,p:last.c},latestQuote:{t:last.t,bp:last.c-0.01,ap:last.c+0.01},
        dailyBar:{...daily.at(-1),c:last.c},prevDailyBar:{...daily.at(-2),c:daily.at(-2).c*60}});
    }
    if(u.pathname==='/v2/stocks/bars'){
      const tf=u.searchParams.get('timeframe'),startMs=Date.parse(u.searchParams.get('start'));
      const endMs=u.searchParams.get('end')?Date.parse(u.searchParams.get('end')):Infinity;
      const bars={};
      for(const s of u.searchParams.get('symbols').split(',')){
        const b=book[s];if(!b)continue;
        const src=tf==='1Day'||tf==='1Week'?b.daily:b.intraday;
        bars[s]=src.filter(x=>Date.parse(x.t)>=startMs&&Date.parse(x.t)<=endMs);
      }
      return Response.json({bars,next_page_token:null});
    }
    return new Response('not found',{status:404});
  };
}
