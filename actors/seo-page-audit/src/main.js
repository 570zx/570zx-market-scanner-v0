import {Fetcher, readUrls, isHtml} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {audit} from './audit.js';

main(async input => {
  const {urls, invalid, overLimit} = readUrls(input, 'urls', 10000);
  if (!urls.length) throw userError('Add at least one page URL to "Page URLs".');
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 8_000_000, retries: 1});
  const work = async url => {
    const base = {url, checkedAt: new Date().toISOString()};
    let r;
    try { r = await fetcher.get(url); } catch (e) {
      return {billable: false, item: {...base, status: e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', error: e.message}};
    }
    if (!isHtml(r.contentType)) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'not_html', error: `Content type is ${r.contentType}`}};
    // A 404 or 500 page is still a valid audit result (the audit reports it as an error), so it is charged.
    return {billable: true, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'ok', ...audit(r, url)}};
  };
  return runItems({items: urls, concurrency: 6, event: 'page', work, label: 'pages',
    summaryExtra: () => [invalid.length ? `${invalid.length} invalid URLs skipped.` : '', overLimit ? `${overLimit} URLs over the per-run limit skipped.` : ''].filter(Boolean)});
});
