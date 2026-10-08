import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {D1,sessionBars,dailyBars,fakeAlpaca} from './fakes.mjs';
import {sma,ema,rsi,macd,vwap,lastCross,swingLevels} from '../src/indicators.ts';
import {analyze} from '../src/analyze.ts';
import {renderChart} from '../src/chart.ts';
import {trimToSessions,RANGES,normalizeSymbol} from '../src/alpaca.ts';
import {inSession,etParts} from '../src/time.ts';
import {handle} from '../src/index.ts';
import {runWatch,detectEvents} from '../src/watch.ts';

const TOKEN='t'.repeat(32);
const DAY='2026-10-07',PREV='2026-10-06';
const book={
  AAPL:{intraday:[...sessionBars(PREV,{seed:3}),...sessionBars(DAY,{seed:7,start:101})],daily:dailyBars(['2026-10-02',PREV,DAY])},
  TSLA:{intraday:sessionBars(DAY,{seed:11,start:250,drift:-0.001}),daily:dailyBars([PREV,DAY],{start:260})},
};
const env=(extra={})=>({ALPACA_API_KEY:'k',ALPACA_API_SECRET:'s',MCP_TOKEN:TOKEN,DB:new D1(),...extra});
const NOW=new Date('2026-10-07T18:00:00Z'); // 14:00 ET

async function rpc(e,method,params,now=NOW,fetcher=fakeAlpaca(book)){
  const res=await handle(new Request(`https://x.dev/mcp/${TOKEN}`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),e,fetcher,now);
  assert.equal(res.status,200);
  return (await res.json()).result;
}

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

test('session clock is DST aware and trims to the regular session',()=>{
  assert.equal(inSession(new Date('2026-10-07T13:29:00Z')),false);
  assert.equal(inSession(new Date('2026-10-07T13:30:00Z')),true);
  assert.equal(inSession(new Date('2026-12-07T14:31:00Z')),true); // EST
  assert.equal(inSession(new Date('2026-10-10T15:00:00Z')),false); // Saturday
  const pre={t:'2026-10-07T12:00:00Z',o:1,h:1,l:1,c:1,v:1};
  const kept=trimToSessions([pre,...book.AAPL.intraday],RANGES['1d'],false);
  assert.equal(kept.length,78);assert.ok(kept.every(b=>etParts(b.t).date===DAY));
  assert.equal(normalizeSymbol(' $brk.b '),'BRK.B');
  assert.throws(()=>normalizeSymbol('DROP TABLE'));
});

test('analysis summarises trend, levels and signals; chart is a valid PNG',async()=>{
  const bars=trimToSessions(book.AAPL.intraday,RANGES['1d'],false);
  const a=analyze('AAPL','1d',bars,{prevClose:100});
  assert.equal(a.change_basis,'previous close');
  assert.equal(a.price,bars.at(-1).c);
  assert.ok(['uptrend','downtrend','sideways / mixed'].includes(a.trend));
  assert.ok(a.indicators.vwap>0&&a.indicators.rsi14>=0&&a.indicators.rsi14<=100);
  const png=await renderChart(a,bars);
  assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
  const dv=new DataView(png.buffer);assert.equal(dv.getUint32(16),960);assert.equal(dv.getUint32(20),600);
  // IDAT decompresses to height * (width + 1) bytes.
  let o=8,idat=[];while(o<png.length){const len=dv.getUint32(o),type=String.fromCharCode(...png.slice(o+4,o+8));if(type==='IDAT')idat.push(png.slice(o+8,o+8+len));o+=12+len;}
  assert.equal(inflateSync(Buffer.concat(idat)).length,600*961);
});

test('MCP handshake, tool list and auth',async()=>{
  const e=env();
  const init=await rpc(e,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}});
  assert.equal(init.protocolVersion,'2025-06-18');assert.ok(init.capabilities.tools);
  const tools=(await rpc(e,'tools/list',{})).tools.map(t=>t.name);
  assert.deepEqual(tools,['get_quote','analyze_stock','watch_stock','unwatch_stock','list_watchlist','get_intraday_log','get_alerts']);
  const note=await handle(new Request(`https://x.dev/mcp/${TOKEN}`,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})}),e);
  assert.equal(note.status,202);
  const bad=await handle(new Request('https://x.dev/mcp/wrong-token-wrong-token-wrong',{method:'POST',body:'{}'}),e);
  assert.equal(bad.status,404);
  const weak=await handle(new Request('https://x.dev/mcp/short',{method:'POST',body:'{}'}),{...e,MCP_TOKEN:'short'});
  assert.equal(weak.status,404);
});

test('analyze_stock returns read-out, live link and chart image',async()=>{
  const r=await rpc(env(),'tools/call',{name:'analyze_stock',arguments:{symbol:'aapl',range:'1d'}});
  assert.equal(r.isError,undefined);
  assert.match(r.content[0].text,/AAPL · 1d · 5Min/);
  assert.match(r.content[0].text,/vs previous close/);
  assert.match(r.content[0].text,new RegExp(`https://x.dev/chart/${TOKEN}/AAPL\\?range=1d`));
  assert.equal(r.content[1].type,'image');assert.equal(r.content[1].mimeType,'image/png');
  assert.ok(Buffer.from(r.content[1].data,'base64').length>1000);
  const q=await rpc(env(),'tools/call',{name:'get_quote',arguments:{symbol:'TSLA'}});
  assert.match(q.content[0].text,/^TSLA \d+\.\d\d/);
  const bad=await rpc(env(),'tools/call',{name:'analyze_stock',arguments:{symbol:'ZZZZ'}});
  assert.equal(bad.isError,true);assert.match(bad.content[0].text,/No 1d price data/);
});

test('watcher snapshots through the day and records alerts',async()=>{
  const e=env();const sent=[];
  const fetcher=fakeAlpaca(book,sent);
  await rpc(e,'tools/call',{name:'watch_stock',arguments:{symbol:'AAPL',note:'earnings week',alert_above:1}},NOW,fetcher);
  await rpc(e,'tools/call',{name:'watch_stock',arguments:{symbol:'TSLA',alert_below:10000}},NOW,fetcher);
  const closed=await runWatch(e,new Date('2026-10-07T22:00:00Z'),fetcher);
  assert.equal(closed.ran,false);
  const r1=await runWatch({...e,ALERT_WEBHOOK_URL:'https://hook.example/x'},new Date('2026-10-07T15:00:00Z'),fetcher);
  assert.deepEqual([r1.ran,r1.symbols,r1.requests],[true,2,2]);
  assert.ok(r1.alerts>=2,'price-level alerts fire on first pass');
  assert.ok(sent.some(u=>u.startsWith('https://hook.example')));
  // Same prices again: level alerts must not repeat.
  const r2=await runWatch(e,new Date('2026-10-07T15:05:00Z'),fetcher);
  const levelAlerts=(await e.DB.prepare("SELECT COUNT(*) n FROM alerts WHERE kind LIKE 'price_%'").first()).n;
  assert.equal(levelAlerts,2);assert.equal(r2.ran,true);
  const log=await rpc(e,'tools/call',{name:'get_intraday_log',arguments:{symbol:'AAPL',date:DAY}},NOW,fetcher);
  assert.match(log.content[0].text,/AAPL watcher log for 2026-10-07 \(2 snapshots/);
  const list=await rpc(e,'tools/call',{name:'list_watchlist',arguments:{}},NOW,fetcher);
  assert.match(list.content[0].text,/AAPL — earnings week \[alert ≥ 1\]/);
  const alerts=await rpc(e,'tools/call',{name:'get_alerts',arguments:{hours:48}},NOW,fetcher);
  assert.match(alerts.content[0].text,/TSLA traded at\/below 10000/);
  await rpc(e,'tools/call',{name:'unwatch_stock',arguments:{symbol:'TSLA'}},NOW,fetcher);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM watchlist').first()).n,1);
});

test('state flips become alerts only within a session',()=>{
  const bars=trimToSessions(book.AAPL.intraday,RANGES['1d'],false);
  const a=analyze('AAPL','1d',bars,{prevClose:100});
  const w={symbol:'AAPL',note:null,alert_above:null,alert_below:null,added_at:''};
  const flipped={...a.state,above_vwap:!a.state.above_vwap,macd_side:a.state.macd_side==='bull'?'bear':'bull'};
  const kinds=detectEvents(a,w,{price:a.price,state:flipped,signals:a.signals.map(s=>s.key)}).map(e=>e.kind);
  assert.ok(kinds.includes(a.state.above_vwap?'vwap_reclaim':'vwap_loss'));
  assert.ok(kinds.some(k=>k.startsWith('macd_')));
  assert.deepEqual(detectEvents(a,w,{price:a.price,state:a.state,signals:a.signals.map(s=>s.key)}),[]);
});

test('live chart page and JSON API',async()=>{
  const e=env(),f=fakeAlpaca(book);
  const page=await handle(new Request(`https://x.dev/chart/${TOKEN}/AAPL?range=5d`),e,f,NOW);
  assert.equal(page.status,200);assert.match(await page.text(),/lightweight-charts@4\.2\.0/);
  const api=await handle(new Request(`https://x.dev/api/${TOKEN}/analysis/AAPL?range=1d`),e,f,NOW);
  const j=await api.json();assert.equal(j.bars.length,78);assert.equal(j.series.rsi.length,78);assert.equal(j.analysis.series,undefined);
  const png=await handle(new Request(`https://x.dev/api/${TOKEN}/chart/AAPL.png`),e,f,NOW);
  assert.equal(png.headers.get('content-type'),'image/png');
  const bad=await handle(new Request(`https://x.dev/api/${TOKEN}/analysis/AAPL?range=7y`),e,f,NOW);
  assert.equal(bad.status,400);
});
