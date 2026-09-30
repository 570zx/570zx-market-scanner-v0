import {Fetcher, readUrls, isHtml} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {detect, summarize} from './detect.js';

main(async input => {
  const {urls, invalid, overLimit} = readUrls(input, 'urls', 5000);
  if (!urls.length) throw userError('Add at least one website URL or domain to "Websites".');
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, timeoutMs: 30000, maxBytes: 3_000_000});
  const work = async url => {
    const base = {inputUrl: url, checkedAt: new Date().toISOString()};
    let r;
    try {
      r = await fetcher.get(url);
    } catch (e) {
      return {billable: false, item: {...base, status: e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', error: e.message}};
    }
    if (r.status >= 400) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'http_error', error: `The site answered HTTP ${r.status}`}};
    const techs = detect({headers: r.headers, html: isHtml(r.contentType) ? r.body : ''});
    return {billable: true, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'ok', domain: new URL(r.finalUrl).hostname, ...summarize(techs), technologies: techs}};
  };
  const msg = await runItems({items: urls, concurrency: 8, event: 'website', work, label: 'websites',
    summaryExtra: () => [invalid.length ? `${invalid.length} invalid URLs skipped.` : '', overLimit ? `${overLimit} URLs over the 5,000 per-run limit skipped.` : ''].filter(Boolean)});
  return msg;
});
