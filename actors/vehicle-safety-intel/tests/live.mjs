// Live check against the real NHTSA servers. Prints a markdown report to stdout.
import {NhtsaClient, buildReport} from '../src/nhtsa.js';
const client = new NhtsaClient();
const vins = ['1HGCM82633A004352', '5YJ3E1EA7KF317000', '1FTFW1ET5DFC10312', '3VWFE21C04M000001', 'NOTAVIN'];
let ok = 0;
for (const v of vins) {
  const t = Date.now();
  const {item, billable} = await buildReport(client, v, {maxComplaintsPerVehicle: 1});
  const ms = Date.now() - t;
  if (billable) ok++;
  console.log(`## ${v}  status=${item.status} billable=${billable} (${ms} ms)`);
  console.log('```json\n' + JSON.stringify({...item, recalls: item.recalls?.slice(0, 1), safetyRatings: item.safetyRatings?.slice(0, 1)}, null, 1).slice(0, 3500) + '\n```');
}
console.log(`\nbillable ${ok} of ${vins.length}`);
if (ok < 2) process.exit(1);
