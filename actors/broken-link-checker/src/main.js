import {Actor} from 'apify';
import {Fetcher, readUrls, isHtml, pool} from './shared/web.js';
import {main, userError} from './shared/kit.js';
import {extractLinks, HostLimiter, checkUrl} from './links.js';

main(async input => {
  const {urls: pages, invalid} = readUrls(input, 'urls', 1000);
  if (!pages.length) throw userError('Add at least one page URL to "Pages to check".');
  const maxLinks = Math.max(1, Math.min(2000, Number(input.maxLinksPerPage) || 300));
  const onlyBroken = input.onlyBroken === true;
  const respect = input.respectRobotsTxt !== false;
  const fetcher = new Fetcher({respectRobots: respect, maxBytes: 8_000_000});
  const limiter = new HostLimiter(2);
  const cache = new Map(); // url -> promise of result (a link on many pages is checked once per run)
  let checked = 0, broken = 0, limitReached = false, pagesDone = 0;

  await pool(pages, 2, async (page, i, stopPages) => {
    if (limitReached) return;
    let r;
    try { r = await fetcher.get(page); } catch (e) {
      await Actor.pushData({page, status: e.code === 'ROBOTS' ? 'page_blocked_by_robots_txt' : 'page_unreachable', error: e.message});
      return;
    }
    if (r.status >= 400 || !isHtml(r.contentType)) {
      await Actor.pushData({page, status: 'page_error', httpStatus: r.status, error: r.status >= 400 ? `Page answered HTTP ${r.status}` : `Not an HTML page (${r.contentType})`});
      return;
    }
    const links = extractLinks(r.body, r.finalUrl, {includeAssets: input.includeAssets === true}).slice(0, maxLinks);
    await pool(links, 8, async (l, j, stopLinks) => {
      if (limitReached) return;
      if (respect && !(await fetcher.allowed(l.url))) {
        if (!onlyBroken) await Actor.pushData({page, status: 'skipped_robots_txt', link: l.url, linkText: l.text, kind: l.kind, internal: l.internal});
        return;
      }
      const host = new URL(l.url).hostname;
      if (!cache.has(l.url)) cache.set(l.url, limiter.run(host, () => checkUrl(l.url)));
      const res = await cache.get(l.url);
      const row = {page, status: 'ok', link: l.url, linkText: l.text, kind: l.kind, internal: l.internal, ...res};
      if (!onlyBroken || res.broken) await Actor.pushData(row);
      checked++; if (res.broken) broken++;
      const c = await Actor.charge({eventName: 'link'});
      if (c?.eventChargeLimitReached) { limitReached = true; stopLinks(); stopPages(); }
    });
    pagesDone++;
    await Actor.setStatusMessage(`Pages ${pagesDone}/${pages.length}, links checked ${checked}, broken ${broken}`);
  });
  const parts = [`Checked ${checked} links on ${pagesDone} pages: ${broken} broken.`];
  if (invalid.length) parts.push(`${invalid.length} invalid URLs skipped.`);
  if (limitReached) parts.push('Stopped early: the maximum cost per run you set was reached.');
  return parts.join(' ');
});
