// Renders sample-1d.png and sample-5d.png from synthetic data (no API keys
// needed), to eyeball the chart layout.
import {writeFileSync} from 'node:fs';
import {sessionBars} from '../tests/fakes.mjs';
import {analyze} from '../src/analyze.ts';
import {renderChart} from '../src/chart.ts';
const days=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07'];
const all=days.flatMap((d,i)=>sessionBars(d,{seed:i*13+5,start:100+i*1.5}));
for(const [range,bars] of [['1d',all.slice(-78)],['5d',all.filter((_,i)=>i%3===0)]]){
  const a=analyze('DEMO',range,bars,{prevClose:range==='1d'?all.at(-79).c:null});
  writeFileSync(`sample-${range}.png`,await renderChart(a,bars));
  console.log(`sample-${range}.png`,a.trend,a.signals.map(s=>s.key).join(','));
}
