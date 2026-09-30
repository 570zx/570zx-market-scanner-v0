import {Actor} from 'apify';
import {Fetcher} from './shared/web.js';
import {main, userError} from './shared/kit.js';
import {parseApp, lookupUrl, searchUrl, reviewsUrl, appDetails, parseReviews, Spacer} from './appstore.js';

const list = v => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]+/)).map(s => String(s).trim()).filter(Boolean);

main(async input => {
  const apps = list(input.apps).map(raw => ({raw, p: parseApp(raw)}));
  if (!apps.length) throw userError('Add at least one App Store URL, app ID or app name to "Apps".');
  const countries = list(input.countries).map(c => c.toLowerCase()).filter(c => /^[a-z]{2}$/.test(c));
  const maxReviews = Math.max(0, Math.min(500, Number(input.maxReviewsPerApp ?? 100)));
  const withDetails = input.includeAppDetails !== false;
  const fetcher = new Fetcher({respectRobots: false, retries: 3, timeoutMs: 30000});
  const spacer = new Spacer(3200);
  const getJson = async url => {
    await spacer.wait();
    const r = await fetcher.get(url, {accept: 'application/json'});
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`Apple answered HTTP ${r.status}`);
    try { return JSON.parse(r.body); } catch { return null; }
  };
  let reviewsOut = 0, appsOut = 0, limitReached = false;
  const charge = async (eventName, count) => {
    if (count <= 0) return;
    const c = await Actor.charge({eventName, count});
    if (c?.eventChargeLimitReached) limitReached = true;
  };
  for (const {raw, p} of apps.slice(0, 500)) {
    if (limitReached) break;
    for (const cc of (countries.length ? countries : [p?.country ?? 'us']).slice(0, 20)) {
      if (limitReached) break;
      const base = {input: raw, country: cc, checkedAt: new Date().toISOString()};
      if (!p) { await Actor.pushData({...base, type: 'error', status: 'invalid_input'}); break; }
      let rec;
      try {
        const j = await getJson(p.id ? lookupUrl(p.id, cc) : searchUrl(p.term, cc));
        rec = j?.results?.find(r => r.kind === 'software' || r.wrapperType === 'software') ?? null;
      } catch (e) { await Actor.pushData({...base, type: 'error', status: 'lookup_failed', error: e.message}); continue; }
      if (!rec) { await Actor.pushData({...base, type: 'error', status: 'app_not_found', error: `No app found in the ${cc.toUpperCase()} App Store`}); continue; }
      const details = appDetails(rec, cc);
      if (withDetails) { await Actor.pushData({...base, type: 'app', status: 'ok', ...details}); appsOut++; await charge('app', 1); }
      let got = 0;
      for (let page = 1; page <= 10 && got < maxReviews && !limitReached; page++) {
        let reviews;
        try { reviews = parseReviews(await getJson(reviewsUrl(details.appId, cc, page))); } catch (e) {
          await Actor.pushData({...base, type: 'error', status: 'reviews_failed', appId: details.appId, error: e.message}); break;
        }
        if (!reviews.length) break;
        const take = reviews.slice(0, maxReviews - got).map(r => ({input: raw, type: 'review', status: 'ok', appId: details.appId, appName: details.name, country: cc, ...r}));
        await Actor.pushData(take);
        got += take.length; reviewsOut += take.length;
        await charge('review', take.length);
        if (reviews.length < 50) break;
      }
      await Actor.setStatusMessage(`Apps ${appsOut}, reviews ${reviewsOut}`);
    }
  }
  return `Returned ${appsOut} app records and ${reviewsOut} reviews.${limitReached ? ' Stopped early: the maximum cost per run you set was reached.' : ''}`;
});
