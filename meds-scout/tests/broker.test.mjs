import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  BROKER_SCHEMA,DisabledBrokerAdapter,canonicalDecimal,decimalUnits,formatUnits,decimalEqual,
  createOrderIntent,transitionIntent,recordBrokerOrder,recordBrokerFill,filledQuantity,pendingBrokerIntents,
  deterministicClientOrderId,executionEligibility,reconcileBrokerState,
} from '../src/broker.ts';

class D1{
  constructor(){this.db=new DatabaseSync(':memory:');}
  prepare(sql){const owner=this,db=this.db;return {args:[],bind(...args){const s=owner.prepare(sql);s.args=args;return s;},
    async run(){const r=db.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};},
    async all(){return {results:db.prepare(sql).all(...this.args)};},
    async first(){return db.prepare(sql).get(...this.args)??null;}};}
  async batch(ss){this.db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function setup(){const d=new D1();for(const sql of BROKER_SCHEMA)d.db.exec(sql);return d;}
const draft=(overrides={})=>({
  accountId:'paper-1',strategyVersion:'leader-hunt-v8.5-account-risk-governor',cycleBucket:'2026-09-24T15:00:00.000Z',
  symbol:'TEST',assetType:'equity',side:'BUY',orderType:'LIMIT',timeInForce:'day',quantity:'1.25000000',
  notional:null,limitPrice:'10.01000000',purpose:'ENTRY',...overrides
});

test('broker decimal primitives conserve exact values and reject ambiguous notation',()=>{
  assert.equal(canonicalDecimal('1.2'),'1.20000000');
  assert.equal(formatUnits(decimalUnits('0.1')+decimalUnits('0.2')),'0.30000000');
  assert.equal(decimalEqual('10.01000000','10.01'),true);
  assert.throws(()=>canonicalDecimal('1e-3'),/INVALID_DECIMAL/);
  assert.throws(()=>canonicalDecimal('1.123456789'),/INVALID_DECIMAL|DECIMAL_SCALE_EXCEEDED/);
});

test('production broker config cannot represent live execution',async()=>{
  const d=await setup();
  assert.throws(()=>d.db.prepare("UPDATE broker_runtime_config SET mode='LIVE' WHERE id=1").run(),/CHECK constraint/);
  assert.throws(()=>d.db.prepare("UPDATE broker_runtime_config SET live_execution=1 WHERE id=1").run(),/CHECK constraint/);
  const row=d.db.prepare('SELECT mode,live_execution FROM broker_runtime_config WHERE id=1').get();
  assert.equal(row.mode,'DISABLED');assert.equal(row.live_execution,0);
  d.db.close();
});

test('disabled adapter has no order submission or cancellation path',async()=>{
  const broker=new DisabledBrokerAdapter();
  await assert.rejects(broker.submitOrder({clientOrderId:'x',symbol:'TEST',assetType:'equity',side:'BUY',orderType:'MARKET',timeInForce:'day',quantity:'1'}),/BROKER_EXECUTION_DISABLED/);
  await assert.rejects(broker.cancelOrder('x'),/BROKER_EXECUTION_DISABLED/);
  await assert.rejects(broker.getAccount(),/BROKER_CONNECTION_DISABLED/);
});

test('asset session and quote authority all have to pass before execution eligibility',()=>{
  const asset={symbol:'TEST',assetType:'equity',status:'active',tradable:true,fractionable:true,extendedHours:true,overnight:false,halted:false};
  const quote={symbol:'TEST',bid:'10.00',ask:'10.01',asOf:'2026-09-24T15:00:00Z',authoritative:true};
  const clock={phase:'regular',tradingDay:true,asOf:'2026-09-24T15:00:00Z'};
  assert.equal(executionEligibility({phase:'regular',fractional:true,asset,quote,clock}).eligible,true);
  assert.deepEqual(executionEligibility({phase:'overnight',fractional:true,asset,quote,clock:{...clock,phase:'overnight'}}).reasons,['ASSET_NOT_OVERNIGHT_ELIGIBLE']);
  assert.deepEqual(executionEligibility({phase:'regular',fractional:true,asset:{...asset,halted:true},quote,clock}).reasons,['ASSET_HALTED']);
  assert.deepEqual(executionEligibility({phase:'regular',fractional:true,asset,quote:{...quote,authoritative:false},clock}).reasons,['EXECUTION_QUOTE_NOT_AUTHORITATIVE']);
  assert.deepEqual(executionEligibility({phase:'regular',fractional:true,asset:{...asset,fractionable:false},quote,clock}).reasons,['ASSET_NOT_FRACTIONABLE']);
});

test('deterministic intent id makes retries idempotent and state transitions optimistic',async()=>{
  const d=await setup(),x=draft(),id=await deterministicClientOrderId(x);
  const first=await createOrderIntent(d,x),second=await createOrderIntent(d,x);
  assert.equal(first.client_order_id,id);assert.equal(second.client_order_id,id);
  assert.equal(d.db.prepare('SELECT COUNT(*) n FROM broker_order_intents').get().n,1);
  await transitionIntent(d,id,'INTENDED','SUBMITTING');
  await assert.rejects(transitionIntent(d,id,'INTENDED','SUBMITTING'),/INTENT_STATE_CONFLICT/);
  await transitionIntent(d,id,'SUBMITTING','SUBMITTED',{brokerOrderId:'bo-1'});
  assert.equal((await pendingBrokerIntents(d)).length,1);
  d.db.close();
});

test('partial fills are idempotent and exact across restart-style replay',async()=>{
  const d=await setup(),x=draft(),intent=await createOrderIntent(d,x),id=intent.client_order_id;
  await transitionIntent(d,id,'INTENDED','SUBMITTING');
  await transitionIntent(d,id,'SUBMITTING','SUBMITTED',{brokerOrderId:'bo-1'});
  await recordBrokerOrder(d,{brokerOrderId:'bo-1',clientOrderId:id,symbol:'TEST',side:'BUY',state:'partially_filled',quantity:'1.25',filledQuantity:'.5',limitPrice:'10.01',updatedAt:'2026-09-24T15:00:01Z'});
  const f1={fillId:'f1',brokerOrderId:'bo-1',clientOrderId:id,symbol:'TEST',side:'BUY',quantity:'0.5',price:'10.01',fee:'0',filledAt:'2026-09-24T15:00:02Z'};
  await recordBrokerFill(d,f1);await recordBrokerFill(d,f1);
  assert.equal(d.db.prepare('SELECT COUNT(*) n FROM broker_fills').get().n,1);
  await transitionIntent(d,id,'SUBMITTED','PARTIALLY_FILLED');
  await recordBrokerFill(d,{...f1,fillId:'f2',quantity:'0.75',filledAt:'2026-09-24T15:00:03Z'});
  assert.equal(await filledQuantity(d,id),'1.25000000');
  await transitionIntent(d,id,'PARTIALLY_FILLED','FILLED');
  assert.equal((await pendingBrokerIntents(d)).length,0);
  d.db.close();
});

test('unknown submission remains recoverable instead of being blindly retried',async()=>{
  const d=await setup(),intent=await createOrderIntent(d,draft()),id=intent.client_order_id;
  await transitionIntent(d,id,'INTENDED','SUBMITTING');
  await transitionIntent(d,id,'SUBMITTING','UNKNOWN',{error:'timeout after submit'});
  const pending=await pendingBrokerIntents(d);
  assert.equal(pending.length,1);assert.equal(pending[0].state,'UNKNOWN');assert.equal(pending[0].client_order_id,id);
  // Recovery must query by deterministic client ID before any new submission.
  assert.equal(await deterministicClientOrderId(draft()),id);
  d.db.close();
});

test('reconciliation detects cash positions and unknown orders independently',()=>{
  const expected={cash:'100.00000000',positions:[{symbol:'TEST',assetType:'equity',quantity:'1.25',avgEntryPrice:'10.01'}],openClientOrderIds:['meds-a']};
  const observed={cash:'99.99000000',positions:[{symbol:'TEST',assetType:'equity',quantity:'1.00',avgEntryPrice:'10.01'}],
    openOrders:[{brokerOrderId:'b',clientOrderId:'meds-b',symbol:'TEST',side:'BUY',state:'new',quantity:'1',updatedAt:'2026-09-24T15:00:00Z'}]};
  const r=reconcileBrokerState(expected,observed);
  assert.equal(r.state,'MISMATCH');assert.equal(r.cashMatch,false);assert.equal(r.positionsMatch,false);assert.equal(r.ordersMatch,false);
  assert.ok(r.mismatches.includes('CASH_MISMATCH'));assert.ok(r.mismatches.includes('POSITION_MISMATCH:TEST'));
  assert.ok(r.mismatches.includes('ORDER_MISMATCH:meds-a'));assert.ok(r.mismatches.includes('ORDER_MISMATCH:meds-b'));
});
