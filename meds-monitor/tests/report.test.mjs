import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderReport,fetchReport} from '../scripts/render-github-report.mjs';

test('report distinguishes paused, degraded valuations, legacy performance, and request failures',()=>{
  const report=renderReport({status:{health:'PAUSED',mode:'shadow',live_execution:false,engine:{version:'v8'},
    leader_hunt:{version:'v8',accounts:[{label:'$100',cash:90,current_equity:null,reporting_equity:95,valuation_state:'PORTFOLIO_PARTIALLY_VALUED'}]},
    valuations:[{account_id:'H100',marks:[{symbol:'OLD',state:'MARK_STALE',age_seconds:600}]}],
    decisions_latest:[{lane:'RUNNER',reasons:['CAPITAL_RESERVE_BLOCK'],count:1}]},
    performance:{summary:{trades:4,median_return:-3}},previous:{summary:{trades:100,median_return:2}},
    errors:['/status/hunt/gainers: HTTP 503']},new Date('2026-09-18T12:00:00Z'));
  assert.match(report,/Engine state:\*\* PAUSED/);assert.match(report,/Live execution:\*\* false/);
  assert.match(report,/MARK_STALE \(600s\)/);assert.match(report,/CAPITAL_RESERVE_BLOCK/);
  assert.match(report,/Current version \| 4/);assert.match(report,/v7 \| 100/);
  assert.match(report,/HTTP 503/);assert.match(report,/manual until/);
  assert.doesNotMatch(report,/refreshes every five minutes/i);
});

test('report fetch uses only public GETs and preserves partial retrieval failures',async()=>{
  const oldFetch=fetch,paths=[];
  globalThis.fetch=async (url,options)=>{
    assert.equal(options.method??'GET','GET');assert.equal(options.headers.authorization,undefined);
    paths.push(new URL(url).pathname);
    return String(url).endsWith('/status')?Response.json({health:'PAUSED'}):new Response('down',{status:503});
  };
  try{
    const result=await fetchReport('https://fixture.invalid');assert.equal(result.status.health,'PAUSED');
    assert.equal(result.errors.length,4);assert.equal(paths.length,5);assert.ok(paths.every(p=>p.startsWith('/status')));
    assert.match(renderReport(result),/Retrieval errors/);
  }finally{globalThis.fetch=oldFetch;}
});
