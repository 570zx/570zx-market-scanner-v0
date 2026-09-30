import {Fetcher, readUrls, isHtml} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {extract} from './extract.js';

main(async input => {
  const {urls, invalid, overLimit} = readUrls(input, 'urls', 10000);
  if (!urls.length) throw userError('Add at least one page URL to "Page URLs".');
  const includeRaw = input.includeRawJsonLd !== false;
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 5_000_000});
  const work = async url => {
    const base = {url, checkedAt: new Date().toISOString()};
    let r;
    try { r = await fetcher.get(url); } catch (e) {
      return {billable: false, item: {...base, status: e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', error: e.message}};
    }
    if (r.status >= 400) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'http_error', error: `The page answered HTTP ${r.status}`}};
    if (!isHtml(r.contentType)) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'not_html', error: `Content type is ${r.contentType}`}};
    const data = extract(r.body, r.finalUrl);
    if (!includeRaw) delete data.jsonLd;
    const product = data.products[0] ?? {};
    return {billable: true, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'ok',
      productName: product.name ?? null, price: product.price ?? null, currency: product.currency ?? null, availability: product.availability ?? null, ...data}};
  };
  return runItems({items: urls, concurrency: 8, event: 'page', work, label: 'pages',
    summaryExtra: () => [invalid.length ? `${invalid.length} invalid URLs skipped.` : '', overLimit ? `${overLimit} URLs over the per-run limit skipped.` : ''].filter(Boolean)});
});
