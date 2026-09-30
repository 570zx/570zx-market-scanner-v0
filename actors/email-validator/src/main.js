import {main, runItems, userError} from './shared/kit.js';
import {validate} from './validate.js';

main(async input => {
  const raw = Array.isArray(input.emails) ? input.emails : String(input.emails ?? '').split(/[\s,;]+/);
  const seen = new Set(), emails = [];
  for (const e of raw) {
    const s = String(e ?? '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); emails.push(s);
  }
  if (!emails.length) throw userError('Add at least one email address to "Email addresses".');
  const list = emails.slice(0, 100000);
  const cache = new Map();
  return runItems({items: list, concurrency: 20, event: 'email', work: e => validate(e, {cache}), label: 'emails',
    summaryExtra: () => [emails.length > list.length ? `${emails.length - list.length} addresses over the 100,000 per-run limit skipped.` : ''].filter(Boolean)});
});
