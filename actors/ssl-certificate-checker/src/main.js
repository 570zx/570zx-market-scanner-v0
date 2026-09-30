import {main, runItems, userError} from './shared/kit.js';
import {parseTarget, fetchCertificate, analyse} from './ssl.js';

main(async input => {
  const raw = Array.isArray(input.hosts) ? input.hosts : String(input.hosts ?? '').split(/[\s,;]+/);
  const warnDays = Math.max(1, Math.min(365, Number(input.warnDays) || 30));
  const seen = new Set(), items = [];
  for (const r of raw) {
    const s = String(r ?? '').trim();
    if (!s) continue;
    const t = parseTarget(s);
    const key = t ? `${t.host}:${t.port}` : s;
    if (seen.has(key)) continue;
    seen.add(key); items.push({raw: s, target: t});
  }
  if (!items.length) throw userError('Add at least one domain or URL to "Hosts".');
  const list = items.slice(0, 20000);
  const work = async ({raw, target}) => {
    const base = {input: raw, checkedAt: new Date().toISOString()};
    if (!target) return {billable: false, item: {...base, status: 'invalid_host', error: 'Not a valid host name or URL'}};
    let conn;
    try { conn = await fetchCertificate(target); } catch (e) {
      const msg = e.code === 'ENOTFOUND' ? 'Host does not exist' : e.code === 'ECONNREFUSED' ? `Nothing is listening on port ${target.port}` : e.message;
      return {billable: false, item: {...base, host: target.host, port: target.port, status: 'unreachable', error: msg}};
    }
    return {billable: true, item: {...base, ...analyse(target, conn, {warnDays})}};
  };
  return runItems({items: list, concurrency: 20, event: 'host', work, label: 'hosts'});
});
