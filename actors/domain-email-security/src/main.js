import {main, runItems, userError} from './shared/kit.js';
import {checkDomain, normalizeDomain} from './check.js';

main(async input => {
  const raw = Array.isArray(input.domains) ? input.domains : String(input.domains ?? '').split(/[\s,;]+/);
  const seen = new Set(), domains = [];
  for (const d of raw) {
    const s = String(d ?? '').trim();
    if (!s) continue;
    const key = normalizeDomain(s) ?? s;
    if (seen.has(key)) continue;
    seen.add(key); domains.push(s);
  }
  if (!domains.length) throw userError('Add at least one domain to "Domains".');
  const list = domains.slice(0, 20000);
  return runItems({items: list, concurrency: 10, event: 'domain', work: d => checkDomain(d), label: 'domains',
    summaryExtra: () => [domains.length > list.length ? `${domains.length - list.length} domains over the 20,000 per-run limit skipped.` : ''].filter(Boolean)});
});
