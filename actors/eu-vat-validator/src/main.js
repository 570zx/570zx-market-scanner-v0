import {Fetcher} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {parseVat, checkVies} from './vat.js';

main(async input => {
  const raw = (Array.isArray(input.vatNumbers) ? input.vatNumbers : String(input.vatNumbers ?? '').split(/[\n,;]+/)).map(s => String(s).trim()).filter(Boolean);
  if (!raw.length) throw userError('Add at least one VAT number to "VAT numbers".');
  const def = /^[A-Za-z]{2}$/.test(input.defaultCountry ?? '') ? input.defaultCountry : null;
  const seen = new Set(), items = [];
  for (const r of raw) { const k = r.toUpperCase().replace(/[\s.\-/]/g, ''); if (!seen.has(k)) { seen.add(k); items.push(r); } }
  const fetcher = new Fetcher({respectRobots: false, retries: 1, timeoutMs: 30000});
  const fetchJson = async url => {
    const r = await fetcher.get(url, {accept: 'application/json'});
    if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(r.body);
  };
  const work = async v => {
    const base = {input: v, checkedAt: new Date().toISOString()};
    const p = parseVat(v, def);
    if (!p.ok) return {billable: true, item: {...base, status: 'ok', valid: false, country: p.country ?? null, vatNumber: p.number ?? null, reason: p.reason, source: 'format check'}};
    const res = await checkVies(p, {fetchJson});
    if (res.state === 'unavailable') return {billable: false, item: {...base, status: 'vies_unavailable', country: p.country, vatNumber: p.number, error: res.error}};
    return {billable: true, item: {...base, status: 'ok', valid: res.state === 'valid', country: p.country, vatNumber: p.number, fullVatNumber: p.country + p.number,
      companyName: res.name ?? null, companyAddress: res.address ?? null, viesRequestDate: res.requestDate ?? null, reason: res.state === 'valid' ? null : (res.note ?? 'Not registered for intra-EU trade in VIES'), source: 'VIES'}};
  };
  return runItems({items: items.slice(0, 20000), concurrency: 4, event: 'vat-check', work, label: 'VAT numbers'});
});
