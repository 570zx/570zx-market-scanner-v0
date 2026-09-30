import {Fetcher} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {BOOTSTRAP_URL, normalizeDomain, parseBootstrap, serverFor, registrable, summarize} from './rdap.js';

main(async input => {
  const raw = Array.isArray(input.domains) ? input.domains : String(input.domains ?? '').split(/[\s,;]+/);
  const seen = new Set(), items = [];
  for (const r of raw) {
    const s = String(r ?? '').trim();
    if (!s) continue;
    const n = normalizeDomain(s);
    const d = n ? registrable(n) : null;
    const key = d ?? s;
    if (seen.has(key)) continue;
    seen.add(key); items.push({raw: s, domain: d});
  }
  if (!items.length) throw userError('Add at least one domain to "Domains".');
  const fetcher = new Fetcher({respectRobots: false, retries: 3, timeoutMs: 30000});
  const boot = await fetcher.get(BOOTSTRAP_URL, {accept: 'application/json'});
  if (boot.status !== 200) throw new Error(`Could not load the IANA RDAP bootstrap file (HTTP ${boot.status})`);
  const map = parseBootstrap(JSON.parse(boot.body));
  const work = async ({raw, domain}) => {
    const base = {input: raw, checkedAt: new Date().toISOString()};
    if (!domain) return {billable: false, item: {...base, status: 'invalid_domain', error: 'Not a valid domain name'}};
    const srv = serverFor(domain, map);
    if (!srv) return {billable: false, item: {...base, domain, status: 'rdap_not_available', error: `The .${domain.split('.').pop()} registry does not publish RDAP data`}};
    let r;
    try { r = await fetcher.get(`${srv.base}domain/${encodeURIComponent(domain)}`, {accept: 'application/rdap+json, application/json'}); } catch (e) {
      return {billable: false, item: {...base, domain, status: 'lookup_failed', error: e.message}};
    }
    if (r.status === 404) return {billable: true, item: {...base, domain, status: 'ok', registered: false, note: 'Not found in the registry: the domain is probably available to register (some registries also hide reserved names).'}};
    if (r.status !== 200) return {billable: false, item: {...base, domain, status: 'lookup_failed', error: `Registry answered HTTP ${r.status}`}};
    let json;
    try { json = JSON.parse(r.body); } catch { return {billable: false, item: {...base, domain, status: 'lookup_failed', error: 'Registry returned invalid JSON'}}; }
    return {billable: true, item: {...base, rdapServer: srv.base, ...summarize(domain, json)}};
  };
  return runItems({items: items.slice(0, 20000), concurrency: 6, event: 'domain', work, label: 'domains'});
});
