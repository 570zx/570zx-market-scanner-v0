import {Actor} from 'apify';
import {Fetcher, readUrls, pool} from './shared/web.js';
import {main, userError} from './shared/kit.js';
import {collect, bufferToText} from './sitemap.js';

const EVENT = 'url';

main(async input => {
  const {urls: sites, invalid} = readUrls(input, 'websites', 500);
  if (!sites.length) throw userError('Add at least one domain or sitemap URL to "Websites".');
  const maxUrls = Math.max(1, Math.min(200000, Number(input.maxUrlsPerSite) || 5000));
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 60_000_000, timeoutMs: 60000});
  const fetchText = async url => {
    const r = await fetcher.get(url, {binary: true, accept: 'application/xml,text/xml,text/plain,*/*;q=0.5'});
    return {status: r.status, text: bufferToText(r.body)};
  };
  let charged = 0, limitReached = false, sitesDone = 0;
  await pool(sites, 3, async (site, i, stop) => {
    if (limitReached) return;
    const res = await collect({start: site, fetchText, maxUrls});
    const domain = new URL(site).hostname;
    if (!res.urls.length) {
      await Actor.pushData({site, domain, status: 'no_sitemap_found', sitemapsTried: res.tried, errors: res.errors.slice(0, 10)});
    } else {
      for (let k = 0; k < res.urls.length && !limitReached; k += 500) {
        const batch = res.urls.slice(k, k + 500).map(u => ({site, domain, status: 'ok', ...u}));
        await Actor.pushData(batch);
        const c = await Actor.charge({eventName: EVENT, count: batch.length});
        charged += batch.length;
        if (c?.eventChargeLimitReached) { limitReached = true; stop(); }
      }
    }
    sitesDone++;
    await Actor.setStatusMessage(`Sites done ${sitesDone}/${sites.length}, URLs found ${charged}`);
  });
  const parts = [`Read ${sitesDone} of ${sites.length} sites and found ${charged} URLs.`];
  if (invalid.length) parts.push(`${invalid.length} invalid inputs skipped.`);
  if (limitReached) parts.push('Stopped early: the maximum cost per run you set was reached.');
  return parts.join(' ');
});
