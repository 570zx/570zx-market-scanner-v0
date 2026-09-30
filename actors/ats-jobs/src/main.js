import {Actor} from 'apify';
import {Fetcher, pool} from './shared/web.js';
import {main, userError} from './shared/kit.js';
import {ATS, parseCompany, endpoint, normalize, companyName, filterJobs} from './ats.js';

const list = v => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,]+/)).map(s => String(s).trim()).filter(Boolean);

main(async input => {
  const companies = [];
  const seen = new Set();
  for (const raw of list(input.companies)) {
    const c = parseCompany(raw);
    const key = c ? `${c.ats ?? '?'}:${c.slug.toLowerCase()}` : raw;
    if (seen.has(key)) continue;
    seen.add(key); companies.push({raw, c});
  }
  if (!companies.length) throw userError('Add at least one company careers URL or company name to "Companies".');
  const filters = {keywords: list(input.titleKeywords), locations: list(input.locations), remoteOnly: input.remoteOnly === true, postedWithinDays: Number(input.postedWithinDays) || 0};
  const withDesc = input.includeDescription !== false;
  const fetcher = new Fetcher({respectRobots: false, retries: 2, timeoutMs: 30000, maxBytes: 40_000_000});

  const load = async (ats, slug) => {
    let url = endpoint(ats, slug);
    let r;
    try { r = await fetcher.get(url, {accept: 'application/json'}); } catch { return null; }
    if (r.status !== 200) return null;
    let json;
    try { json = JSON.parse(r.body); } catch { return null; }
    if (ats === 'smartrecruiters') {
      const all = [...(json.content ?? [])];
      const total = json.totalFound ?? all.length;
      for (let off = all.length; off < Math.min(total, 5000); off += 100) {
        try {
          const p = await fetcher.get(`${url}&offset=${off}`, {accept: 'application/json'});
          if (p.status !== 200) break;
          const more = JSON.parse(p.body).content ?? [];
          if (!more.length) break;
          all.push(...more);
        } catch { break; }
      }
      json = {...json, content: all};
      if (!all.length) return null; // SmartRecruiters answers 200 even for unknown companies
    }
    if (ats === 'recruitee' && !(json.offers ?? []).length) return null;
    return json;
  };

  let charged = 0, limitReached = false, done = 0;
  await pool(companies, 4, async ({raw, c}, i, stop) => {
    if (limitReached) return;
    if (!c) { await Actor.pushData({input: raw, status: 'invalid_input', error: 'Not a careers URL or company name'}); return; }
    const tryList = c.ats ? [c.ats] : ATS;
    let found = null;
    for (const ats of tryList) {
      const json = await load(ats, c.slug);
      if (json) { found = {ats, json}; break; }
    }
    if (!found) {
      await Actor.pushData({input: raw, company: c.slug, status: 'no_job_board_found', error: c.ats ? `No public ${c.ats} job board for "${c.slug}"` : `No public job board found for "${c.slug}" on ${ATS.join(', ')}`});
      return;
    }
    const name = companyName(found.ats, found.json);
    let jobs = filterJobs(normalize(found.ats, c.slug, found.json), filters);
    jobs = jobs.map(j => ({input: raw, status: 'ok', companyName: name, ...j, descriptionText: withDesc && j.descriptionText ? j.descriptionText.slice(0, 20000) : undefined}));
    for (let k = 0; k < jobs.length && !limitReached; k += 200) {
      const batch = jobs.slice(k, k + 200);
      await Actor.pushData(batch);
      const r = await Actor.charge({eventName: 'job', count: batch.length});
      charged += batch.length;
      if (r?.eventChargeLimitReached) { limitReached = true; stop(); }
    }
    if (!jobs.length) await Actor.pushData({input: raw, company: c.slug, ats: found.ats, status: 'no_matching_jobs', error: 'The board has no open jobs matching your filters'});
    done++;
    await Actor.setStatusMessage(`Companies ${done}/${companies.length}, jobs ${charged}`);
  });
  return `Read ${done} job boards, ${charged} jobs returned.${limitReached ? ' Stopped early: the maximum cost per run you set was reached.' : ''}`;
});
