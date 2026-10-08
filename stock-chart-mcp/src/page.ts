// Live chart page served by the Worker. Polls the analysis API every minute
// and draws price (candles, VWAP, EMA 21, Bollinger), volume and RSI with
// TradingView Lightweight Charts (pinned version).

const LIB = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';

export function livePage(symbol: string, range: string, ext: boolean) {
  const cfg = JSON.stringify({ symbol, range, ext });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${symbol} live chart</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--ink:#0b0b0b;--muted:#52514e;--grid:#ebeae6;--up:#2a78d6;--down:#e34948;--vwap:#eb6834;--ema:#4a3aa7;--band:#b7b6b0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface:#1a1a19;--ink:#ffffff;--muted:#c3c2b7;--grid:#2c2c2a;--up:#3987e5;--down:#e66767;--vwap:#d95926;--ema:#9085e9;--band:#6f6e69}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--ink:#ffffff;--muted:#c3c2b7;--grid:#2c2c2a;--up:#3987e5;--down:#e66767;--vwap:#d95926;--ema:#9085e9;--band:#6f6e69}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline}
h1{margin:0;font-size:24px}#chg{font-weight:600}.muted{color:var(--muted)}
nav{display:flex;gap:4px;flex-wrap:wrap;margin:12px 0}
nav a{padding:4px 10px;border-radius:6px;border:1px solid var(--grid);color:var(--ink);text-decoration:none;font-size:13px}
nav a[aria-current]{background:var(--ink);color:var(--surface)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:4px}
.legend i{display:inline-block;width:16px;height:2px;vertical-align:middle;margin-right:6px}
#price{height:420px}#vol{height:90px}#rsi{height:130px}.panel-label{font-size:12px;color:var(--muted);margin-top:8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}@media (max-width:700px){.grid{grid-template-columns:1fr}}
ul{margin:4px 0;padding-left:18px}table{border-collapse:collapse;font-size:13px}td{padding:2px 12px 2px 0}
</style></head><body><main>
<header><h1 id="sym"></h1><span id="px" style="font-size:22px"></span><span id="chg"></span><span id="meta" class="muted"></span></header>
<nav id="ranges"></nav>
<div class="legend"><span><i style="background:var(--vwap)"></i>VWAP</span><span><i style="background:var(--ema)"></i>EMA 21</span><span><i style="background:var(--band)"></i>Bollinger 20,2</span></div>
<div id="price"></div><div class="panel-label">Volume</div><div id="vol"></div><div class="panel-label">RSI 14</div><div id="rsi"></div>
<div class="grid"><section><h3>Signals</h3><ul id="signals"></ul></section><section><h3>Levels &amp; indicators</h3><table id="ind"></table></section></div>
<p class="muted" id="status"></p>
</main>
<script src="${LIB}"></script>
<script>
const CFG=${cfg};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $=id=>document.getElementById(id);
$('sym').textContent=CFG.symbol;
for(const r of ['1d','5d','1mo','3mo','6mo','1y','5y']){const a=document.createElement('a');a.textContent=r;a.href='?range='+r+(CFG.ext?'&ext=1':'');if(r===CFG.range)a.setAttribute('aria-current','page');$('ranges').append(a);}
const intraday=['1d','5d','1mo'].includes(CFG.range);
// Lightweight Charts formats times as UTC, so bars are given ET wall-clock seconds.
const etFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const ts=t=>{const p={};for(const x of etFmt.formatToParts(new Date(t)))p[x.type]=+x.value;return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute)/1000;};
const base=(logo)=>({autoSize:true,layout:{background:{color:css('--surface')},textColor:css('--muted'),attributionLogo:logo},grid:{vertLines:{color:css('--grid')},horzLines:{color:css('--grid')}},
  timeScale:{timeVisible:intraday,secondsVisible:false,borderColor:css('--grid')},rightPriceScale:{borderColor:css('--grid'),minimumWidth:84},crosshair:{mode:0},
  localization:{locale:'en-US'}});
const LW=LightweightCharts;
const price=LW.createChart($('price'),base(true)),vol=LW.createChart($('vol'),base(false)),rsiC=LW.createChart($('rsi'),base(false));
const candles=price.addCandlestickSeries({upColor:css('--up'),downColor:css('--down'),borderVisible:false,wickUpColor:css('--up'),wickDownColor:css('--down')});
const line=(c,w=2)=>price.addLineSeries({color:css(c),lineWidth:w,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
const bbU=line('--band',1),bbL=line('--band',1),ema=line('--ema'),vwap=line('--vwap');
const volS=vol.addHistogramSeries({priceFormat:{type:'volume'},priceLineVisible:false});
const rsiS=rsiC.addLineSeries({color:css('--ema'),lineWidth:2,priceLineVisible:false});
for(const lvl of [30,70])rsiS.createPriceLine({price:lvl,color:css('--band'),lineStyle:2,lineWidth:1,axisLabelVisible:true});
// Keep the three panels scrolled together.
const charts=[price,vol,rsiC];let syncing=false;
charts.forEach(c=>c.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(syncing||!r)return;syncing=true;charts.forEach(o=>o!==c&&o.timeScale().setVisibleLogicalRange(r));syncing=false;}));
let levelLines=[],first=true;
const pts=(bars,s)=>s.map((v,i)=>v==null?{time:ts(bars[i].t)}:{time:ts(bars[i].t),value:v});
async function load(){
  try{
    const r=await fetch('/api/'+location.pathname.split('/')[2]+'/analysis/'+CFG.symbol+'?range='+CFG.range+(CFG.ext?'&ext=1':''),{cache:'no-store'});
    const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);
    const {bars,series,analysis:a}=j;
    candles.setData(bars.map(b=>({time:ts(b.t),open:b.o,high:b.h,low:b.l,close:b.c})));
    volS.setData(bars.map(b=>({time:ts(b.t),value:b.v,color:b.c>=b.o?css('--up')+'66':css('--down')+'66'})));
    ema.setData(pts(bars,series.ema21));bbU.setData(pts(bars,series.bb_upper));bbL.setData(pts(bars,series.bb_lower));
    vwap.setData(series.vwap?pts(bars,series.vwap).map((p,i)=>i<bars.length-1&&Math.floor(p.time/86400)!==Math.floor(ts(bars[i+1].t)/86400)&&'value' in p?{...p,color:'rgba(0,0,0,0)'}:p):[]);rsiS.setData(pts(bars,series.rsi));
    levelLines.forEach(l=>candles.removePriceLine(l));
    levelLines=[...a.levels.resistance.map(l=>[l,'R']),...a.levels.support.map(l=>[l,'S'])].map(([l,k])=>candles.createPriceLine({price:l.price,color:css('--muted'),lineStyle:3,lineWidth:1,axisLabelVisible:true,title:k}));
    if(first){charts.forEach(c=>c.timeScale().fitContent());first=false;}
    $('px').textContent=a.price;const up=a.change_pct>=0;
    $('chg').textContent=(up?'+':'')+a.change+' ('+(up?'+':'')+a.change_pct+'%)';$('chg').style.color=css(up?'--up':'--down');
    $('meta').textContent=a.range+' · '+a.timeframe+' · '+a.trend+' · vs '+a.change_basis;
    $('signals').innerHTML='';(a.signals.length?a.signals.map(s=>s.text):['Nothing notable on the latest bars']).forEach(t=>{const li=document.createElement('li');li.textContent=t;$('signals').append(li);});
    const i=a.indicators,rows=[['RSI 14',i.rsi14],['VWAP',i.vwap],['EMA 9 / 21',i.ema9+' / '+i.ema21],['SMA 20 / 50',i.sma20+' / '+i.sma50],
      ['MACD (hist)',i.macd.histogram],['ATR 14',i.atr14+' ('+i.atr_pct+'%)'],['Rel. volume',i.relative_volume],
      ['Resistance',a.levels.resistance.map(l=>l.price).join(', ')||'—'],['Support',a.levels.support.map(l=>l.price).join(', ')||'—']];
    $('ind').innerHTML='';rows.forEach(([k,v])=>{const tr=document.createElement('tr');tr.innerHTML='<td class="muted"></td><td></td>';tr.cells[0].textContent=k;tr.cells[1].textContent=v??'n/a';$('ind').append(tr);});
    $('status').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 60s · times ET · data: Alpaca';
  }catch(e){$('status').textContent='Update failed: '+e.message+' (retrying in 60s)';}
}
load();setInterval(load,60000);
</script></body></html>`;
}
