// Shared by all tools. Copied into each Actor's src/shared/ by actors/sync-shared.sh.
// A tiny runner: pushes one item per input, charges only billable items, stops at the user's spending cap.
import {Actor} from 'apify';
import {pool} from './web.js';

export async function runItems({items, concurrency = 5, event, work, label = 'items', summaryExtra = () => []}) {
  let done = 0, charged = 0, free = 0, limitReached = false;
  await pool(items, concurrency, async (item, idx, stop) => {
    if (limitReached) return;
    let out;
    try {
      out = await work(item, idx);
    } catch (e) {
      out = {billable: false, results: [{input: String(item), status: 'error', error: String(e?.message ?? e)}]};
    }
    const results = out.results ?? [out.item];
    for (const r of results) {
      if (limitReached) break;
      await Actor.pushData(r);
    }
    done++;
    const units = out.billable ? (out.units ?? 1) : 0;
    if (units > 0) {
      const c = await Actor.charge({eventName: event, count: units});
      charged += units;
      if (c?.eventChargeLimitReached) { limitReached = true; stop(); }
    } else free++;
    if (done % 5 === 0 || done === items.length) await Actor.setStatusMessage(`Processed ${done} of ${items.length} ${label}`);
  });
  const parts = [`Processed ${done} of ${items.length} ${label}. Charged ${charged}; ${free} not charged (errors, blocked or invalid).`, ...summaryExtra()];
  if (limitReached) parts.push('Stopped early: the maximum cost per run you set was reached.');
  return parts.join(' ');
}

export async function main(fn) {
  await Actor.init();
  try {
    const input = (await Actor.getInput()) ?? {};
    const msg = await fn(input);
    await Actor.exit(msg);
  } catch (e) {
    if (e?.userError) await Actor.fail(e.message);
    else await Actor.fail(`Run failed: ${e?.message ?? e}`);
  }
}

export function userError(message) {
  const e = new Error(message); e.userError = true; return e;
}
