// Live check against the real NHTSA servers. Prints a markdown report to stdout.
import {NhtsaClient, buildReport} from '../src/nhtsa.js';
const client = new NhtsaClient();
const vins = ['1HGCM82633A004352', '5YJ3E1EA7KF317000', '1FTFW1ET5DFC10312', '3VWFE21C04M000001', '1G1YY22G965109876', 'WBAVB13506PT12345', 'NOTAVIN'];
let ok = 0;
for (const v of vins) {
  const t = Date.now();
  const {item, billable} = await buildReport(client, v, {maxComplaintsPerVehicle: 1});
  const ms = Date.now() - t;
  if (billable) ok++;
  console.log(`## ${v}  status=${item.status} billable=${billable} (${ms} ms)`);
  console.log(`${item.year} ${item.make} ${item.model} | recalls ${item.recallCount} (${JSON.stringify(item.recallsMatchedModels)}) | complaints ${item.complaintCount} (${JSON.stringify(item.complaintsMatchedModels)}) | NCAP ${item.overallSafetyRating} | warnings: ${JSON.stringify(item.warnings)}`);
}
console.log(`\nbillable ${ok} of ${vins.length}`);
if (ok < 2) process.exit(1);
