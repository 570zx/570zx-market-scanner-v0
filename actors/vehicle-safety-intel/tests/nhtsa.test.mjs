import test from 'node:test';
import assert from 'node:assert/strict';
import {NhtsaClient, buildReport, pickModels, checkDigitOk, normalizeVin, VIN_RE, parseNhtsaDate, summarizeComplaints, decodeStatus} from '../src/nhtsa.js';

const jres = (obj, status = 200) => ({status, ok: status < 400, text: async () => JSON.stringify(obj)});

test('normalize and shape', () => {
  assert.equal(normalizeVin(' 1hgcm826-33a004352 '), '1HGCM82633A004352');
  assert.ok(VIN_RE.test('1HGCM82633A004352'));
  assert.ok(!VIN_RE.test('1HGCM82633A00435I')); // I not allowed
  assert.ok(!VIN_RE.test('SHORT'));
});

test('check digit: known-good VIN passes, altered fails', () => {
  assert.ok(checkDigitOk('1HGCM82633A004352'));
  assert.ok(!checkDigitOk('1HGCM82634A004352'));
  assert.ok(checkDigitOk('11111111111111111')); // classic all-ones test vector
});

test('dates', () => {
  assert.equal(parseNhtsaDate('27/06/2024'), Date.UTC(2024, 5, 27));
  assert.equal(parseNhtsaDate('bad'), 0);
});

test('decodeStatus', () => {
  assert.equal(decodeStatus({ErrorCode: '0', Make: 'HONDA', Model: 'Accord', ModelYear: '2003'}).level, 'full');
  assert.equal(decodeStatus({ErrorCode: '6,7', Make: 'HONDA', Model: 'Accord', ModelYear: '2003'}).level, 'partial');
  assert.equal(decodeStatus({ErrorCode: '11', Make: '', Model: '', ModelYear: ''}).ok, false);
});

test('complaint summary counts components, crashes, sorts recent', () => {
  const s = summarizeComplaints([
    {components: 'AIR BAGS', crash: true, numberOfInjuries: 2, dateComplaintFiled: '01/02/2020', odiNumber: 1},
    {components: 'AIR BAGS,STEERING', fire: true, dateComplaintFiled: '01/03/2021', odiNumber: 2},
    {components: 'STEERING', dateComplaintFiled: '05/03/2021', odiNumber: 3, numberOfDeaths: 1}
  ], 2);
  assert.equal(s.total, 3);
  assert.equal(s.crashes, 1); assert.equal(s.fires, 1); assert.equal(s.injuries, 2); assert.equal(s.deaths, 1);
  assert.deepEqual(s.topComponents.map(x => [x.component, x.count]), [['AIR BAGS', 2], ['STEERING', 2]]);
  assert.deepEqual(s.recent.map(x => x.odiNumber), [3, 2]);
});

function fakeFetch(routes) {
  const calls = [];
  const f = async url => {
    calls.push(url);
    for (const [frag, val] of routes) if (url.includes(frag)) return typeof val === 'function' ? val(url) : jres(val);
    return jres({}, 404);
  };
  f.calls = calls;
  return f;
}
const fast = f => new NhtsaClient({fetchImpl: f, sleep: async () => {}, baseDelayMs: 0});

test('full report: specs, recalls, complaints, ratings; billable', async () => {
  const f = fakeFetch([
    ['DecodeVinValues', {Results: [{ErrorCode: '0', ErrorText: '0 - VIN decoded clean', Make: 'HONDA', Model: 'Accord', ModelYear: '2003', BodyClass: 'Sedan/Saloon', Doors: '4', DisplacementL: '2.4', EngineNumberofCylinders: '4', Trim: ''}]}],
    ['products/vehicle/models', {results: [{model: 'Accord'}]}],
    ['recallsByVehicle', {Count: 1, results: [{NHTSACampaignNumber: '23V001000', Component: 'AIR BAGS', Summary: 's', Consequence: 'c', Remedy: 'r', ReportReceivedDate: '01/01/2023', parkIt: true}]}],
    ['complaintsByVehicle', {Count: 2, results: [{components: 'AIR BAGS', dateComplaintFiled: '01/01/2022', odiNumber: 9}, {components: 'ENGINE', dateComplaintFiled: '02/01/2022', odiNumber: 10}]}],
    ['SafetyRatings/modelyear', {Count: 1, Results: [{VehicleId: 555, VehicleDescription: '2003 Honda Accord 4-DR'}]}],
    ['SafetyRatings/VehicleId/555', {Results: [{VehicleId: 555, OverallRating: '5', OverallFrontCrashRating: '5', OverallSideCrashRating: '4', RolloverRating: '4', ComplaintsCount: 2, RecallsCount: 1}]}]
  ]);
  const {item, billable} = await buildReport(fast(f), '1hgcm82633a004352', {});
  assert.ok(billable);
  assert.equal(item.status, 'ok');
  assert.equal(item.make, 'HONDA'); assert.equal(item.year, 2003); assert.equal(item.doors, 4); assert.equal(item.trim, null);
  assert.equal(item.recallCount, 1); assert.equal(item.recalls[0].parkIt, true);
  assert.equal(item.complaintCount, 2); assert.equal(item.recentComplaints.length, 2);
  assert.equal(item.overallSafetyRating, '5');
  assert.deepEqual(item.warnings, []);
});

test('invalid VIN is free and never calls the network', async () => {
  const f = fakeFetch([]);
  const {item, billable} = await buildReport(fast(f), 'NOT-A-VIN', {});
  assert.ok(!billable); assert.equal(item.status, 'invalid_vin'); assert.equal(f.calls.length, 0);
});

test('undecodable VIN is free', async () => {
  const f = fakeFetch([['DecodeVinValues', {Results: [{ErrorCode: '7', ErrorText: 'bad', Make: '', Model: '', ModelYear: ''}]}]]);
  const {item, billable} = await buildReport(fast(f), '1HGCM82633A004352', {});
  assert.ok(!billable); assert.equal(item.status, 'not_decodable');
});

test('a failing side lookup gives a partial (still billable) report with a warning', async () => {
  const f = fakeFetch([
    ['DecodeVinValues', {Results: [{ErrorCode: '0', Make: 'HONDA', Model: 'Accord', ModelYear: '2003'}]}],
    ['products/vehicle/models', {results: []}],
    ['recallsByVehicle', () => jres({}, 500)],
    ['complaintsByVehicle', {results: []}],
    ['SafetyRatings/modelyear', {Results: []}]
  ]);
  const {item, billable} = await buildReport(fast(f), '1HGCM82633A004352', {});
  assert.ok(billable); assert.equal(item.status, 'partial');
  assert.ok(item.warnings.some(w => /could not be fetched/.test(w)));
  assert.equal(item.complaintCount, 0);
});

test('retries on 429 then succeeds', async () => {
  let n = 0;
  const f = async () => (++n < 3 ? jres({}, 429) : jres({Results: [{ErrorCode: '0', Make: 'X', Model: 'Y', ModelYear: '2020'}]}));
  const c = new NhtsaClient({fetchImpl: f, sleep: async () => {}});
  assert.equal((await c.decode('1HGCM82633A004352')).Make, 'X');
  assert.equal(n, 3);
});

test('options switch off lookups', async () => {
  const f = fakeFetch([['DecodeVinValues', {Results: [{ErrorCode: '0', Make: 'A', Model: 'B', ModelYear: '2010'}]}]]);
  const {item} = await buildReport(fast(f), '1HGCM82633A004352', {includeRecalls: false, includeComplaints: false, includeRatings: false});
  assert.equal(f.calls.length, 1);
  assert.equal(item.recalls, undefined);
});

test('pickModels handles NHTSA spelling differences', () => {
  assert.deepEqual(pickModels(['F150', 'F250'], 'F-150'), ['F150']);
  assert.deepEqual(pickModels(['F-150 SUPERCAB', 'F-150 SUPERCREW', 'RANGER'], 'F-150'), ['F-150 SUPERCAB', 'F-150 SUPERCREW']);
  assert.deepEqual(pickModels(['NEW BEETLE', 'JETTA'], 'Beetle'), ['NEW BEETLE']);
  assert.deepEqual(pickModels(['MODEL 3', 'MODEL S'], 'Model 3'), ['MODEL 3']);
  assert.deepEqual(pickModels(['CIVIC'], 'Accord'), []);
  assert.deepEqual(pickModels([], 'Accord'), []);
  assert.deepEqual(pickModels(['ACCORD', 'ACCORD'], 'Accord'), ['ACCORD']);
});

test('resolved model name is used in the lookup and 400 means no records', async () => {
  const f = fakeFetch([
    ['DecodeVinValues', {Results: [{ErrorCode: '0', Make: 'FORD', Model: 'F-150', ModelYear: '2013'}]}],
    ['products/vehicle/models', {results: [{model: 'F150'}]}],
    ['recallsByVehicle', {results: [{NHTSACampaignNumber: 'X'}]}],
    ['complaintsByVehicle', () => jres({}, 400)],
    ['SafetyRatings/modelyear', {Results: []}]
  ]);
  const {item} = await buildReport(fast(f), '1HGCM82633A004352', {});
  assert.ok(f.calls.some(u => u.includes('recallsByVehicle') && u.includes('model=F150')));
  assert.equal(item.complaintCount, 0);
  assert.equal(item.recallCount, 1);
  assert.equal(item.status, 'ok');
});

test('several matching model names are merged without duplicates', async () => {
  const f = fakeFetch([
    ['DecodeVinValues', {Results: [{ErrorCode: '0', Make: 'FORD', Model: 'F-150', ModelYear: '2013'}]}],
    ['products/vehicle/models', {results: [{model: 'F-150 SUPERCAB'}, {model: 'F-150 SUPERCREW'}]}],
    ['recallsByVehicle', url => jres({results: url.includes('SUPERCAB') ? [{NHTSACampaignNumber: 'A'}, {NHTSACampaignNumber: 'B'}] : [{NHTSACampaignNumber: 'B'}, {NHTSACampaignNumber: 'C'}]})],
    ['complaintsByVehicle', {results: []}],
    ['SafetyRatings/modelyear', {Results: []}]
  ]);
  const {item} = await buildReport(fast(f), '1HGCM82633A004352', {});
  assert.equal(item.recallCount, 3);
  assert.deepEqual(item.recallsMatchedModels, ['F-150', 'F-150 SUPERCAB', 'F-150 SUPERCREW']);
});
