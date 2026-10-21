// Checks for the forward paper test: it only reads data, logs the day's signals once, and skips non-sessions/early runs.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main, GO_LIVE, SYMBOLS} from './paper-forward.mjs';
import {readFileSync as rf} from 'node:fs';

let seed = 4; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const calls = [];
const fake = new Proxy({requests: 0, async calendar(start, end) { calls.push('calendar'); const d = new Date(start + 'T12:00:00Z').getUTCDay(); return [0, 6].includes(d) ? [] : [{date: start, open: '09:30', close: '16:00'}]; },
  async bars([sym], {start, end}) { calls.push('bars');
    const rows = []; let px = 100 + sym.length;
    for (let d = Date.parse(start.slice(0, 10)); d <= Date.parse(end.slice(0, 10)); d += 86400_000) {
      const day = new Date(d); if ([0, 6].includes(day.getUTCDay())) continue;
      const base = d + (13 * 60 + 30) * 60_000 + 3600_000; // 09:30 EDT in UTC for the dates used below (approximation is fine for plumbing)
      for (let i = 0; i < 78; i++) { const o = px, c = o * (1 + (rnd() - 0.5) * 0.004); rows.push({t: new Date(base + i * 300_000).toISOString(), o, h: Math.max(o, c) * 1.0005, l: Math.min(o, c) * 0.9995, c, v: 1000}); px = c; }
    } return {[sym]: rows}; }},
  {get(t, k) { if (k in t || k === 'then') return t[k]; throw new Error(`forward test touched an unexpected API: ${String(k)}`); }});

const state = mkdtempSync(join(tmpdir(), 'pf-'));
const day = '2026-10-22'; // a Thursday after go-live
// 1) Non-session (Saturday) does nothing and writes nothing.
let r = await main(['--state', state, '--today', '2026-10-24'], {alpacaImpl: fake});
assert.equal(r.skipped, 'no session'); assert.ok(!existsSync(join(state, 'signals')));
// 2) Too early on a session day (clock at 15:00 ET) skips without fetching bars.
const before = calls.length;
r = await main(['--state', state], {alpacaImpl: fake, now: Date.parse('2026-10-22T19:00:00Z')});
assert.equal(r.skipped, 'too early'); assert.ok(!calls.slice(before).includes('bars'));
// 3) A normal run writes the report, ledger and the day's signal record.
r = await main(['--state', state, '--today', day], {alpacaImpl: fake});
const sig = join(state, 'signals', `${day}.json`);
assert.ok(existsSync(sig)); assert.ok(existsSync(join(state, 'PAPER-FORWARD.md'))); assert.ok(existsSync(join(state, 'ledger.json')));
const report = readFileSync(join(state, 'PAPER-FORWARD.md'), 'utf8');
assert.ok(report.includes('Paper only: no orders are placed'));
// 4) The first signal record of a day is kept: a second run does not rewrite it.
const first = readFileSync(sig, 'utf8');
await main(['--state', state, '--today', day], {alpacaImpl: fake});
assert.equal(readFileSync(sig, 'utf8'), first);
// 5) Before go-live nothing is logged.
r = await main(['--state', state, '--today', '2026-10-20'], {alpacaImpl: fake});
assert.equal(r.skipped, 'before go-live');
// 6) The data client has no way to place orders: only GET helpers exist.
const src = rf(new URL('./lib/alpaca.mjs', import.meta.url), 'utf8');
assert.ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src), 'alpaca client must stay read-only');
assert.ok(!/\/v2\/orders/.test(rf(new URL('./paper-forward.mjs', import.meta.url), 'utf8')), 'paper test must not reference orders');
assert.equal(SYMBOLS.length, 9); assert.equal(GO_LIVE, '2026-10-21');
console.error('paper-forward selftest ok');
