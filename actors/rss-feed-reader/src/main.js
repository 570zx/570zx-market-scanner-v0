import {Actor} from 'apify';
import {Fetcher, readUrls, pool, isHtml} from './shared/web.js';
import {main, userError} from './shared/kit.js';
import {parseFeed, discoverFeeds, looksLikeFeed} from './feed.js';

main(async input => {
  const {urls, invalid} = readUrls(input, 'feeds', 2000);
  if (!urls.length) throw userError('Add at least one feed URL or website to "Feeds or websites".');
  const maxItems = Math.max(1, Math.min(1000, Number(input.maxItemsPerFeed) || 50));
  const sinceDays = Math.max(0, Number(input.publishedWithinDays) || 0);
  const withContent = input.includeContent === true;
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 20_000_000});
  const seenFeeds = new Set();
  let charged = 0, limitReached = false, done = 0;
  await pool(urls, 5, async (url, i, stop) => {
    if (limitReached) return;
    const base = {input: url};
    const fail = async (status, error) => Actor.pushData({...base, status, error});
    let r;
    try { r = await fetcher.get(url, {accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5'}); } catch (e) {
      return fail(e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', e.message);
    }
    if (r.status >= 400) return fail('http_error', `Server answered HTTP ${r.status}`);
    let feedUrl = r.finalUrl, body = r.body;
    if (!looksLikeFeed(body) && isHtml(r.contentType)) {
      const found = discoverFeeds(body, r.finalUrl);
      if (!found.length) return fail('no_feed_found', 'The page is not a feed and does not link to one');
      try {
        const f = await fetcher.get(found[0], {accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5'});
        if (f.status >= 400) return fail('http_error', `Feed ${found[0]} answered HTTP ${f.status}`);
        feedUrl = f.finalUrl; body = f.body;
      } catch (e) { return fail('unreachable', e.message); }
    }
    if (seenFeeds.has(feedUrl)) return;
    seenFeeds.add(feedUrl);
    let feed;
    try { feed = parseFeed(body, feedUrl); } catch (e) { return fail('not_a_feed', e.message); }
    let items = feed.items;
    if (sinceDays) items = items.filter(it => !it.published || Date.now() - Date.parse(it.published) <= sinceDays * 86400000);
    items = items.slice(0, maxItems).map(it => ({...base, status: 'ok', feedUrl, feedTitle: feed.title, feedFormat: feed.format, ...it, contentHtml: withContent ? it.contentHtml : undefined}));
    if (!items.length) return fail('no_items', 'The feed has no items (within your date filter)');
    await Actor.pushData(items);
    const c = await Actor.charge({eventName: 'item', count: items.length});
    charged += items.length;
    if (c?.eventChargeLimitReached) { limitReached = true; stop(); }
    done++;
    await Actor.setStatusMessage(`Feeds ${done}/${urls.length}, items ${charged}`);
  });
  const parts = [`Read ${done} feeds, ${charged} items returned.`];
  if (invalid.length) parts.push(`${invalid.length} invalid URLs skipped.`);
  if (limitReached) parts.push('Stopped early: the maximum cost per run you set was reached.');
  return parts.join(' ');
});
