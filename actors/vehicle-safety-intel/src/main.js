import {Actor} from 'apify';
import {NhtsaClient, buildReport, normalizeVin} from './nhtsa.js';

const MAX_VINS = 1000;
const CONCURRENCY = 4; // gentle on a free public API
const EVENT = 'vehicle-report';

await Actor.init();
try {
  const input = (await Actor.getInput()) ?? {};
  const raw = Array.isArray(input.vins) ? input.vins : String(input.vins ?? '').split(/[\s,;]+/);
  const seen = new Set(), vins = [];
  for (const v of raw) {
    const n = normalizeVin(v);
    if (!n || seen.has(n)) continue;
    seen.add(n); vins.push(n);
  }
  if (!vins.length) {
    await Actor.fail('No VINs given. Add at least one 17-character VIN to the "VINs" input.');
  } else {
    const list = vins.slice(0, MAX_VINS);
    const skipped = vins.length - list.length;
    const client = new NhtsaClient();
    const opts = {
      includeRecalls: input.includeRecalls !== false,
      includeComplaints: input.includeComplaints !== false,
      includeRatings: input.includeRatings !== false,
      maxComplaintsPerVehicle: Number.isInteger(input.maxComplaintsPerVehicle) ? Math.max(0, Math.min(50, input.maxComplaintsPerVehicle)) : 5
    };
    let done = 0, charged = 0, failed = 0, limitReached = false;
    for (let i = 0; i < list.length && !limitReached; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      const reports = await Promise.all(chunk.map(v => buildReport(client, v, opts)));
      for (const r of reports) {
        if (limitReached) break;
        // Charge for delivered results only; invalid VINs and failed lookups are free.
        await Actor.pushData(r.item);
        done++;
        if (r.billable) {
          const c = await Actor.charge({eventName: EVENT});
          charged++;
          if (c?.eventChargeLimitReached) limitReached = true;
        } else failed++;
      }
      await Actor.setStatusMessage(`Checked ${done} of ${list.length} VINs`);
    }
    const parts = [`Checked ${done} VINs: ${charged} reports delivered, ${failed} not decodable or invalid (not charged).`];
    if (skipped) parts.push(`${skipped} VINs over the ${MAX_VINS} per-run limit were not processed.`);
    if (limitReached) parts.push('Stopped early because the maximum cost per run you set was reached.');
    await Actor.exit(parts.join(' '));
  }
} catch (e) {
  await Actor.fail(`Run failed: ${e?.message ?? e}`);
}
