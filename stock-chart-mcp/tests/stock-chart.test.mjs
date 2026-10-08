import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {D1,sessionBars,dailyBars,fakeAlpaca} from './fakes.mjs';
import {sma,ema,rsi,macd,vwap,lastCross,swingLevels} from '../src/indicators.ts';
import {analyze,table} from '../src/analyze.ts';
import {renderChart} from '../src/chart.ts';
import {trimToSessions,RANGES,normalizeSymbol,sessionOf} from '../src/alpaca.ts';
import {inSession,etParts} from '../src/time.ts';
import {chartToken} from '../src/auth.ts';
import {handle} from '../src/index.ts';
import {runWatch,detectEvents,parseLevels,levelEvents} from '../src/watch.ts';

const TOKEN='t'.repeat(32);
const DAY='2026-10-07',PREV='2026-10-06';
const book={
  AAPL:{intraday:[...sessionBars(PREV,{seed:3,extended:true}),...sessionBars(DAY,{seed:7,start:101,extended:true})],daily:dailyBars(['2026-10-02',PREV,DAY])},
  TSLA:{intraday:sessionBars(DAY,{seed:11,start:250,drift:-0.001}),daily:dailyBars([PREV,DAY],{start:260})},
};
const env=(extra={})=>({ALPACA_API_KEY:'k',ALPACA_API_SECRET:'s',MCP_TOKEN:TOKEN,DB:new D1(),...extra});
const NOW=new Date('2026-10-07T18:00:00Z'); // 14:00 ET; delayed SIP data ends 13:44 ET

async function rpc(e,method,params,now=NOW,fetcher=fakeAlpaca(book)){
  const res=await handle(new Request(`https://x.dev/mcp/${TOKEN}`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),e,fetcher,now);
  assert.equal(res.status,200);
  return (await res.json()).result;
}
const call=(e,name,args,now,fetcher)=>rpc(e,'tools/call',{name,arguments:args},now,fetcher);
const jsonBlock=(r,label)=>JSON.parse(r.content.find(c=>c.type==='text'&&c.text.startsWith(label+' (JSON):')).text.split('\n').slice(1).join('\n'));

test('indicators match hand-computed values',()=>{
  assert.deepEqual(sma([1,2,3,4],2),[null,1.5,2.5,3.5]);
  const e=ema([1,2,3,4,5],3);assert.equal(e[2],2);assert.equal(e[3],3);assert.equal(e[4],4);
  const up=rsi(Array.from({length:20},(_,i)=>i),14);assert.equal(up[19],100);
  const m=macd(Array.from({length:60},(_,i)=>100+i));assert.ok(m.line.at(-1)>0&&m.signal.at(-1)>0);
  const vw=vwap([{o:1,h:2,l:0,c:1,v:10},{o:1,h:4,l:2,c:3,v:10},{o:1,h:2,l:0,c:1,v:5}],i=>i<2?'a':'b');
  assert.equal(vw[1],2);assert.equal(vw[2],1);
  assert.deepEqual(lastCross([1,1,3],[2,2,2],3),{barsAgo:0,dir:'up'});
  assert.equal(lastCross([1,1,1],[2,2,2],3),null);
  const lv=swingLevels([1,2,3,9,3,2,1,2,3,9.1,3,2,1].map(h=>({o:h,h,l:h-0.5,c:h,v:1})),3,0.5);
  assert.ok(lv.some(l=>l.touches===2&&Math.abs(l.price-9.05)<1e-9));
});

test('session clock, session labels and trimming',()=>{
  assert.equal(inSession(new Date('2026-10-07T13:29:00Z')),false);
  assert.equal(inSession(new Date('2026-10-07T13:30:00Z')),true);
  assert.equal(inSession(new Date('2026-12-07T14:31:00Z')),true); // EST
  assert.equal(inSession(new Date('2026-10-10T15:00:00Z')),false); // Saturday
  assert.equal(inSession(new Date('2026-10-07T23:59:00Z'),true),true); // 19:59 ET after-hours
  const spec=RANGES['1d'];
  assert.equal(sessionOf('2026-10-07T13:25:00Z',spec),'pre');
  assert.equal(sessionOf('2026-10-07T13:30:00Z',spec),'regular');
  assert.equal(sessionOf('2026-10-07T19:55:00Z',spec),'regular');
  assert.equal(sessionOf('2026-10-07T20:00:00Z',spec),'post');
  assert.equal(sessionOf('2026-10-07T04:00:00Z',RANGES['1y']),'daily');
  const regular=trimToSessions(book.AAPL.intraday,spec,false);
  assert.equal(regular.length,78);assert.ok(regular.every(b=>etParts(b.t).date===DAY));
  assert.equal(trimToSessions(book.AAPL.intraday,spec,true).length,66+78+48);
  assert.equal(normalizeSymbol(' $brk.b '),'BRK.B');
  assert.throws(()=>normalizeSymbol('DROP TABLE'));
});

test('analysis labels sessions; VWAP and relative volume use the regular session',async()=>{
  const bars=trimToSessions(book.AAPL.intraday,RANGES['1d'],true);
  const a=analyze('AAPL','1d',bars,{prevClose:100});
  assert.equal(a.sessions[0],'pre');assert.equal(a.sessions.at(-1),'post');
  assert.equal(a.last_bar_session,'post');
  assert.ok(a.signals.some(s=>s.key==='post_market'));
  assert.equal(a.series.vwap[0],null,'no VWAP in premarket');
  assert.equal(a.series.vwap.at(-1),null,'no VWAP after hours');
  assert.ok(a.series.vwap[66]>0);
  assert.equal(a.session_volume.pre.bars,66);assert.equal(a.session_volume.regular.bars,78);assert.equal(a.session_volume.post.bars,48);
  // After-hours bar compared with after-hours bars, not regular ones.
  assert.ok(a.indicators.relative_volume>0.2&&a.indicators.relative_volume<5);
  const t=table(a,bars);
  assert.equal(t.rows.length,bars.length);
  const col=n=>t.columns.indexOf(n);
  assert.equal(t.rows[0][col('session')],'pre');assert.equal(t.rows[0][col('time_et')],'2026-10-07 04:00');
  assert.equal(t.rows[70][col('session')],'regular');assert.ok(t.rows[70][col('vwap')]>0);
  const png=await renderChart(a,bars,'SIP DELAYED 15 MIN');
  assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const dv=new DataView(png.buffer);assert.equal(dv.getUint32(16),960);assert.equal(dv.getUint32(20),600);
  let o=8,idat=[];while(o<png.length){const len=dv.getUint32(o),type=String.fromCharCode(...png.slice(o+4,o+8));if(type==='IDAT')idat.push(png.slice(o+8,o+8+len));o+=12+len;}
  assert.equal(inflateSync(Buffer.concat(idat)).length,600*481); // 4-bit rows: 1 filter byte + 480
});

test('requests: read-only, SIP, split-adjusted, capped at the 15-minute delay',async()=>{
  const log=[];
  const r=await call(env(),'analyze_stock',{symbol:'AAPL',range:'1d'},NOW,fakeAlpaca(book,log));
  assert.equal(r.isError,undefined);
  assert.ok(log.length>=2);
  for(const {url,method} of log){
    const u=new URL(url);
    assert.equal(method,'GET');assert.equal(u.origin,'https://data.alpaca.markets');assert.match(u.pathname,/^\/v2\/stocks\//);
    if(u.pathname==='/v2/stocks/bars'){
      assert.equal(u.searchParams.get('feed'),'sip');
      assert.equal(u.searchParams.get('adjustment'),'split');
      assert.equal(u.searchParams.get('end'),'2026-10-07T17:44:00.000Z');
    }
  }
  assert.match(r.content[0].text,/^Data: SIP \(all US exchanges, full volume\), delayed 15 min\. Prices split-adjusted\. Latest bar 2026-10-07 13:40 ET \(regular\)/);
  const data=jsonBlock(r,'analysis');
  assert.equal(data.feed.used,'sip');assert.equal(data.feed.delay_minutes,15);assert.equal(data.adjustment,'split');
  assert.equal(data.extended_hours,true);
  assert.equal(data.bars.rows.at(-1)[1],'2026-10-07 13:40');
  assert.equal(data.series,undefined);
  // Previous close comes from adjusted daily bars, not the unadjusted snapshot.
  assert.equal(data.change_basis,'previous close');
  assert.ok(Math.abs(data.change_pct)<20,`change ${data.change_pct}% should not reflect a 60x unadjusted close`);
});

test('falls back to IEX when SIP is refused, and says so',async()=>{
  const r=await call(env(),'analyze_stock',{symbol:'AAPL'},NOW,fakeAlpaca(book,[],{refuseSip:true}));
  assert.match(r.content[0].text,/^Data: IEX only \(one exchange: volume and VWAP understated/);
  assert.match(r.content[0].text,/SIP refused \(HTTP 403\); fell back to IEX/);
  const data=jsonBlock(r,'analysis');assert.equal(data.feed.used,'iex');assert.equal(data.feed.requested,'sip');
  assert.equal(data.bars.rows.at(-1)[1],'2026-10-07 14:00','IEX is real time');
  const paid=await call(env({ALPACA_SIP_DELAY_MINUTES:'0'}),'analyze_stock',{symbol:'AAPL'},NOW);
  assert.match(paid.content[0].text,/^Data: SIP \(all US exchanges, full volume\), real time/);
});

test('get_quote: adjusted previous close, as-of time, JSON; works without snapshots',async()=>{
  const q=await call(env(),'get_quote',{symbol:'TSLA'});
  const d=jsonBlock(q,'quote');
  assert.equal(d.prev_close,book.TSLA.daily[0].c);assert.equal(d.source,'latest trade');
  assert.equal(d.feed.used,'sip');assert.equal(d.session,'regular');
  assert.match(q.content[0].text,/As of 2026-10-07 15:55 ET \(regular session\)/);
  const log=[];
  const q2=await call(env(),'get_quote',{symbol:'TSLA'},NOW,fakeAlpaca(book,log,{noSnapshot:true}));
  const d2=jsonBlock(q2,'quote');
  assert.equal(d2.source,'last 1-minute bar close');assert.equal(d2.as_of_et,'2026-10-07 13:40 ET');
  assert.ok(log.some(({url})=>url.includes('feed=delayed_sip')));
});

test('MCP handshake, tools, and authentication',async()=>{
  const e=env();
  const init=await rpc(e,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}});
  assert.equal(init.protocolVersion,'2025-06-18');assert.ok(init.capabilities.tools);
  const tools=(await rpc(e,'tools/list',{})).tools.map(t=>t.name);
  assert.deepEqual(tools,['get_quote','analyze_stock','watch_stock','unwatch_stock','list_watchlist','get_intraday_log','get_alerts']);
  const note=await handle(new Request(`https://x.dev/mcp/${TOKEN}`,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}),e);
  assert.equal(note.status,202);
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'});
  const bearer=await handle(new Request('https://x.dev/mcp',{method:'POST',headers:{authorization:`Bearer ${TOKEN}`},body}),e);
  assert.equal(bearer.status,200);
  for(const [url,headers] of [['https://x.dev/mcp',{}],['https://x.dev/mcp/wrong-token-wrong-token-wrong',{}],['https://x.dev/mcp',{authorization:'Bearer nope'}]])
    assert.equal((await handle(new Request(url,{method:'POST',headers,body}),e)).status,404);
  assert.equal((await handle(new Request('https://x.dev/mcp/short',{method:'POST',body}),{...e,MCP_TOKEN:'short'})).status,404);
  // Chart links carry a separate view-only token.
  const ct=await chartToken(e);
  assert.notEqual(ct,TOKEN);
  assert.equal((await handle(new Request(`https://x.dev/mcp/${ct}`,{method:'POST',body}),e)).status,404);
  assert.equal((await handle(new Request(`https://x.dev/chart/${TOKEN}/AAPL`),e)).status,404);
  assert.equal((await handle(new Request(`https://x.dev/chart/${ct}/AAPL`),e,fakeAlpaca(book),NOW)).status,200);
});

test('analyze_stock returns read-out, view-only link, chart image and JSON',async()=>{
  const e=env(),ct=await chartToken(e);
  const r=await call(e,'analyze_stock',{symbol:'aapl',range:'1d'});
  assert.match(r.content[0].text,/AAPL · 1d · 5Min/);
  assert.match(r.content[0].text,new RegExp(`https://x.dev/chart/${ct}/AAPL\\?range=1d`));
  assert.ok(!r.content.some(c=>c.type==='text'&&c.text.includes(TOKEN)),'connector token never appears in output');
  assert.equal(r.content[1].type,'image');assert.equal(r.content[1].mimeType,'image/png');
  const data=jsonBlock(r,'analysis');
  assert.ok(data.bars.columns.includes('session'));
  assert.deepEqual([...new Set(data.bars.rows.map(x=>x[2]))],['pre','regular']);
  const lean=await call(e,'analyze_stock',{symbol:'AAPL',chart:false,include_data:false,extended_hours:false});
  assert.equal(lean.content.length,1);
  const bad=await call(e,'analyze_stock',{symbol:'ZZZZ'});
  assert.equal(bad.isError,true);assert.match(bad.content[0].text,/No 1d price data/);
});

test('levels and zones: parsing, crossings, tests',()=>{
  const lv=parseLevels(['0.96','1.44','$1.58 - $1.65','1.85–1.95',2.18]);
  assert.deepEqual(lv.map(l=>l.label),['$0.96','$1.44','$1.58–$1.65','$1.85–$1.95','$2.18']);
  assert.deepEqual(parseLevels('1.44, 1.58-1.65').map(l=>[l.low,l.high]),[[1.44,1.44],[1.58,1.65]]);
  assert.throws(()=>parseLevels(['abc']));
  const bar=(h,l)=>({t:'',o:0,h,l,c:0,v:0});
  const msgs=(prev,price,bars,tag='')=>levelEvents('SRXH',lv,prev,price,bars,tag).map(e=>e.message);
  assert.deepEqual(msgs(null,1.5,[]),[],'no prior snapshot, nothing crossed');
  assert.deepEqual(msgs(1.40,1.47,[bar(1.48,1.40)]),['SRXH crossed above $1.44 at 1.47']);
  assert.deepEqual(msgs(1.55,1.60,[bar(1.61,1.55)],'after-hours'),['SRXH entered the $1.58–$1.65 zone from below at 1.60 [after-hours]']);
  assert.deepEqual(msgs(1.60,1.70,[bar(1.70,1.60)]),['SRXH broke out above the $1.58–$1.65 zone at 1.70']);
  assert.deepEqual(msgs(1.50,1.52,[bar(1.59,1.49)]),['SRXH tested the $1.58–$1.65 zone (high 1.59) but is back below at 1.52']);
  assert.deepEqual(msgs(2.20,2.25,[bar(2.26,2.17)]),['SRXH dipped to $2.18 (low 2.17) but is back above at 2.25']);
  assert.deepEqual(msgs(1.70,1.40,[bar(1.70,1.38)]),['SRXH crossed below $1.44 at 1.40','SRXH fell through the $1.58–$1.65 zone, now below at 1.40']);
});

test('watcher: levels through pre/regular/after-hours on the delayed clock',async()=>{
  // SRXH grinds from 1.40 premarket to 1.70 after hours: crosses 1.44, then the 1.58-1.65 zone.
  const t0=Date.parse('2026-10-07T08:00:00Z'); // 04:00 ET
  const path=[];for(let i=0;i<192;i++)path.push(1.40+0.30*i/191);
  const srxh=path.map((c,i)=>({t:new Date(t0+i*300_000).toISOString(),o:+(c-0.001).toFixed(4),h:+(c+0.002).toFixed(4),l:+(c-0.003).toFixed(4),c:+c.toFixed(4),v:1000}));
  const b2={SRXH:{intraday:srxh,daily:dailyBars([PREV,DAY],{start:1.3})}};
  const e=env(),sent=[],f=fakeAlpaca(b2,sent);
  const w=await call(e,'watch_stock',{symbol:'SRXH',note:'briefing levels',levels:['0.96','1.44','1.58-1.65','1.85-1.95','2.18']},NOW,f);
  assert.deepEqual(jsonBlock(w,'watch').levels.map(l=>l.label),['$0.96','$1.44','$1.58–$1.65','$1.85–$1.95','$2.18']);
  // 04:10 wall clock = 03:54 on the data clock: not yet.
  assert.equal((await runWatch(e,new Date('2026-10-07T08:10:00Z'),f)).ran,false);
  const passes=['2026-10-07T08:30:00Z','2026-10-07T13:00:00Z','2026-10-07T17:00:00Z','2026-10-07T21:00:00Z','2026-10-08T00:10:00Z'];
  for(const p of passes){const r=await runWatch(e,new Date(p),f);assert.equal(r.ran,true,p);assert.equal(r.feed,'sip');}
  // 20:16 ET wall clock: data clock is past 20:00, watcher stops.
  assert.equal((await runWatch(e,new Date('2026-10-08T00:16:00Z'),f)).ran,false);
  const alerts=(await e.DB.prepare("SELECT message FROM alerts WHERE kind LIKE 'level_%' ORDER BY id").all()).results.map(r=>r.message);
  assert.equal(alerts.length,3,alerts.join('\n'));
  assert.match(alerts[0],/^SRXH crossed above \$1\.44 at 1\.4\d+ \[premarket\]$/);
  assert.match(alerts[1],/^SRXH entered the \$1\.58–\$1\.65 zone from below at 1\.6\d+ \[after-hours\]$/);
  assert.match(alerts[2],/^SRXH broke out above the \$1\.58–\$1\.65 zone at 1\.\d+ \[after-hours\]$/);
  const log=await call(e,'get_intraday_log',{symbol:'SRXH',date:DAY},NOW,f);
  assert.match(log.content[0].text,/SRXH watcher log for 2026-10-07: 5 snapshots/);
  assert.match(log.content[0].text,/Data: SIP \(all US exchanges, full volume\), delayed 15 min/);
  const lj=jsonBlock(log,'log');
  assert.deepEqual(lj.snapshots.map(s=>s.session),['pre','pre','regular','post','post']);
  assert.equal(lj.snapshots.at(-1).levels['$1.58–$1.65'],'above');
  assert.equal(lj.snapshots.at(-1).levels['$2.18'],'below');
  const list=await call(e,'list_watchlist',{},NOW,f);
  assert.match(list.content[0].text,/SRXH — briefing levels \[levels \$0\.96, \$1\.44/);
  // Re-adding without levels keeps them; passing [] clears them.
  await call(e,'watch_stock',{symbol:'SRXH'},NOW,f);
  assert.equal(jsonBlock(await call(e,'list_watchlist',{},NOW,f),'watchlist')[0].levels.length,5);
  await call(e,'watch_stock',{symbol:'SRXH',levels:[]},NOW,f);
  assert.equal(jsonBlock(await call(e,'list_watchlist',{},NOW,f),'watchlist')[0].levels.length,0);
  const ga=await call(e,'get_alerts',{hours:48},new Date('2026-10-08T01:00:00Z'),f);
  assert.ok(jsonBlock(ga,'alerts').length>=3);
  await call(e,'unwatch_stock',{symbol:'SRXH'},NOW,f);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM watchlist').first()).n,0);
});

test('webhook alerts carry the feed note',async()=>{
  const e=env({ALERT_WEBHOOK_URL:'https://hook.example/x'}),sent=[];
  const f=async(url,init={})=>{if(url.startsWith('https://hook.example'))sent.push(JSON.parse(init.body).content);return fakeAlpaca(book)(url,init);};
  await call(e,'watch_stock',{symbol:'TSLA',levels:['10000']},NOW,f);
  await runWatch(e,new Date('2026-10-07T15:00:00Z'),f);
  await e.DB.prepare("UPDATE snapshots SET price=20000").run(); // previous snapshot above the level
  await runWatch(e,new Date('2026-10-07T15:05:00Z'),f);
  assert.ok(sent.some(m=>/TSLA crossed below \$10000/.test(m)&&/data delayed 15 min, SIP/.test(m)),sent.join('\n'));
});

test('indicator state flips become alerts only when they change',()=>{
  const bars=trimToSessions(book.AAPL.intraday,RANGES['1d'],false);
  const a=analyze('AAPL','1d',bars,{prevClose:100});
  const flipped={...a.state,above_vwap:!a.state.above_vwap,macd_side:a.state.macd_side==='bull'?'bear':'bull'};
  const kinds=detectEvents(a,{state:flipped,signals:a.signals.map(s=>s.key)}).map(e=>e.kind);
  assert.ok(kinds.includes(a.state.above_vwap?'vwap_reclaim':'vwap_loss'));
  assert.ok(kinds.some(k=>k.startsWith('macd_')));
  assert.deepEqual(detectEvents(a,{state:a.state,signals:a.signals.map(s=>s.key)}),[]);
});

test('live chart page and JSON API use the view-only token',async()=>{
  const e=env(),f=fakeAlpaca(book),ct=await chartToken(e);
  const page=await handle(new Request(`https://x.dev/chart/${ct}/AAPL?range=5d`),e,f,NOW);
  assert.equal(page.status,200);assert.match(await page.text(),/lightweight-charts@4\.2\.0/);
  const api=await handle(new Request(`https://x.dev/api/${ct}/analysis/AAPL?range=1d`),e,f,NOW);
  const j=await api.json();
  assert.equal(j.feed.used,'sip');assert.equal(j.bars[0].session,'pre');assert.equal(j.series.rsi.length,j.bars.length);
  const png=await handle(new Request(`https://x.dev/api/${ct}/chart/AAPL.png`),e,f,NOW);
  assert.equal(png.headers.get('content-type'),'image/png');
  assert.equal((await handle(new Request(`https://x.dev/api/${ct}/analysis/AAPL?range=7y`),e,f,NOW)).status,400);
  assert.equal((await handle(new Request(`https://x.dev/api/${ct}/analysis/AAPL`,{method:'POST'}),e,f,NOW)).status,405);
});

// Workers' fetch throws "Illegal invocation" unless called with the global
// scope (or undefined) as `this`. This stand-in enforces the same rule.
function strictFetch(log){
  const inner=fakeAlpaca(book,log);
  return function(url,init){
    if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    return inner(url,init);
  };
}

test('fetch is never called with a non-global `this` (injected fetch)',async()=>{
  const e=env({ALERT_WEBHOOK_URL:'https://hook.example/x'}),log=[],f=strictFetch(log);
  for(const name of ['get_quote','analyze_stock']){
    const r=await call(e,name,{symbol:'AAPL'},NOW,f);
    assert.equal(r.isError,undefined,`${name}: ${r.content[0].text}`);
  }
  const ct=await chartToken(e);
  assert.equal((await handle(new Request(`https://x.dev/api/${ct}/analysis/AAPL`),e,f,NOW)).status,200);
  await call(e,'watch_stock',{symbol:'AAPL',levels:['1']},NOW,f);
  const r=await runWatch(e,new Date('2026-10-07T15:00:00Z'),f);
  assert.equal(r.ran,true);
  assert.ok(log.some(({url})=>url.startsWith('https://data.alpaca.markets')));
});

test('default fetch path (as deployed) calls the global fetch correctly',async()=>{
  const original=globalThis.fetch,log=[];
  globalThis.fetch=strictFetch(log);
  try{
    const e=env();
    const res=await handle(new Request(`https://x.dev/mcp/${TOKEN}`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_quote',arguments:{symbol:'AAPL'}}})}),e,undefined,NOW);
    const out=(await res.json()).result;
    assert.equal(out.isError,undefined,out.content[0].text);
    await call(e,'watch_stock',{symbol:'AAPL'},NOW,fakeAlpaca(book));
    const w=await runWatch(e,new Date('2026-10-07T15:00:00Z'));
    assert.equal(w.ran,true);
    assert.ok(log.length>=3,'default path went through globalThis.fetch');
  }finally{globalThis.fetch=original;}
});
