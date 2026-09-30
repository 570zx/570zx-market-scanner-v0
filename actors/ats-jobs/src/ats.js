import {decodeEntities, textFromHtml} from './shared/html.js';

// Public job-board APIs that applicant tracking systems provide so companies can embed their openings.
export const ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];

// "https://boards.greenhouse.io/airbnb" -> {ats:'greenhouse', slug:'airbnb'}; "airbnb" -> {ats:null, slug:'airbnb'}
export function parseCompany(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const pref = /^(greenhouse|lever|ashby|workable|smartrecruiters|recruitee)\s*:\s*([\w.-]+)$/i.exec(s);
  if (pref) return {ats: pref[1].toLowerCase(), slug: pref[2]};
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { u = null; }
  if (u && u.hostname.includes('.')) {
    const h = u.hostname.toLowerCase(), seg = u.pathname.split('/').filter(Boolean);
    if (/(^|\.)greenhouse\.io$/.test(h)) {
      const q = u.searchParams.get('for');
      if (q) return {ats: 'greenhouse', slug: q};
      if (seg[0] && !['embed', 'v1'].includes(seg[0])) return {ats: 'greenhouse', slug: seg[0]};
      if (seg[0] === 'v1' && seg[1] === 'boards' && seg[2]) return {ats: 'greenhouse', slug: seg[2]};
    }
    if (/(^|\.)lever\.co$/.test(h) && seg[0]) return {ats: 'lever', slug: seg[seg[0] === 'v0' ? 2 : 0]};
    if (/(^|\.)ashbyhq\.com$/.test(h) && seg[0]) return {ats: 'ashby', slug: seg[0]};
    if (/(^|\.)workable\.com$/.test(h)) { const sub = h.split('.')[0]; if (h.startsWith('apply.') && seg[0]) return {ats: 'workable', slug: seg[0]}; if (sub !== 'www' && sub !== 'apply') return {ats: 'workable', slug: sub}; }
    if (/(^|\.)smartrecruiters\.com$/.test(h) && seg[0]) return {ats: 'smartrecruiters', slug: seg[0]};
    if (/\.recruitee\.com$/.test(h)) return {ats: 'recruitee', slug: h.split('.')[0]};
  }
  if (/^[\w.-]{2,80}$/.test(s)) return {ats: null, slug: s};
  return null;
}

export function endpoint(ats, slug) {
  const e = encodeURIComponent(slug);
  return {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${e}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${e}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${e}?includeCompensation=true`,
    workable: `https://apply.workable.com/api/v1/widget/accounts/${e}`,
    smartrecruiters: `https://api.smartrecruiters.com/v1/companies/${e}/postings?limit=100`,
    recruitee: `https://${e}.recruitee.com/api/offers/`
  }[ats];
}

const iso = v => { if (v == null || v === '') return null; const d = new Date(typeof v === 'number' ? v : String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const clean = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
const text = html => (html ? textFromHtml(decodeEntities(String(html))) : null);
const remoteFrom = (...vals) => vals.some(v => v === true || /remote/i.test(String(v ?? '')));

// Normalise each ATS's JSON to one job shape.
export function normalize(ats, slug, json) {
  const base = {ats, company: slug};
  switch (ats) {
    case 'greenhouse': return (json.jobs ?? []).map(j => ({...base, jobId: String(j.id), title: clean(j.title), location: clean(j.location?.name),
      department: clean(j.departments?.map(d => d.name).join(', ')), employmentType: null, remote: remoteFrom(j.location?.name, j.title),
      url: j.absolute_url ?? null, applyUrl: j.absolute_url ?? null, postedAt: iso(j.first_published ?? j.updated_at), updatedAt: iso(j.updated_at),
      salary: null, descriptionText: text(j.content)}));
    case 'lever': return (Array.isArray(json) ? json : []).map(j => ({...base, jobId: j.id, title: clean(j.text), location: clean(j.categories?.location ?? j.categories?.allLocations?.join(', ')),
      department: clean([j.categories?.department, j.categories?.team].filter(Boolean).join(' / ')), employmentType: clean(j.categories?.commitment),
      remote: remoteFrom(j.workplaceType === 'remote', j.categories?.location), url: j.hostedUrl ?? null, applyUrl: j.applyUrl ?? null,
      postedAt: iso(j.createdAt), updatedAt: null, salary: j.salaryRange ? `${j.salaryRange.min ?? ''}-${j.salaryRange.max ?? ''} ${j.salaryRange.currency ?? ''} ${j.salaryRange.interval ?? ''}`.trim() : null,
      descriptionText: clean(j.descriptionPlain) ?? text(j.description)}));
    case 'ashby': return (json.jobs ?? []).filter(j => j.isListed !== false).map(j => ({...base, jobId: j.id, title: clean(j.title), location: clean(j.location),
      department: clean([j.department, j.team].filter(Boolean).join(' / ')), employmentType: clean(j.employmentType), remote: remoteFrom(j.isRemote, j.location, j.workplaceType),
      url: j.jobUrl ?? null, applyUrl: j.applyUrl ?? null, postedAt: iso(j.publishedAt), updatedAt: null,
      salary: clean(j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary), descriptionText: clean(j.descriptionPlain) ?? text(j.descriptionHtml)}));
    case 'workable': return (json.jobs ?? []).map(j => ({...base, jobId: j.shortcode ?? j.id ?? null, title: clean(j.title),
      location: clean([j.city, j.state, j.country].filter(Boolean).join(', ')), department: clean(j.department), employmentType: clean(j.employment_type),
      remote: remoteFrom(j.telecommuting, j.remote), url: j.url ?? j.shortlink ?? null, applyUrl: j.application_url ?? null, postedAt: iso(j.published_on ?? j.created_at), updatedAt: null,
      salary: null, descriptionText: text(j.description)}));
    case 'smartrecruiters': return (json.content ?? []).map(j => ({...base, jobId: j.id, title: clean(j.name),
      location: clean([j.location?.city, j.location?.region, j.location?.country?.toUpperCase?.()].filter(Boolean).join(', ')), department: clean(j.department?.label),
      employmentType: clean(j.typeOfEmployment?.label), remote: remoteFrom(j.location?.remote, j.location?.fullyRemote),
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`, applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
      postedAt: iso(j.releasedDate), updatedAt: null, salary: null, descriptionText: null}));
    case 'recruitee': return (json.offers ?? []).map(j => ({...base, jobId: String(j.id), title: clean(j.title),
      location: clean(j.location ?? [j.city, j.country].filter(Boolean).join(', ')), department: clean(j.department), employmentType: clean(j.employment_type_code),
      remote: remoteFrom(j.remote), url: j.careers_url ?? null, applyUrl: j.careers_apply_url ?? j.careers_url ?? null, postedAt: iso(j.published_at ?? j.created_at), updatedAt: null,
      salary: j.salary?.min ? `${j.salary.min}-${j.salary.max ?? ''} ${j.salary.currency ?? ''} ${j.salary.period ?? ''}`.trim() : null, descriptionText: text(j.description)}));
    default: return [];
  }
}

export function companyName(ats, json) {
  if (ats === 'workable') return clean(json?.name);
  return null;
}

export function filterJobs(jobs, {keywords = [], locations = [], remoteOnly = false, postedWithinDays = 0, now = Date.now()} = {}) {
  const kw = keywords.map(k => k.toLowerCase()).filter(Boolean), loc = locations.map(l => l.toLowerCase()).filter(Boolean);
  return jobs.filter(j => {
    if (kw.length && !kw.some(k => (j.title ?? '').toLowerCase().includes(k))) return false;
    if (loc.length && !loc.some(l => (j.location ?? '').toLowerCase().includes(l) || (l === 'remote' && j.remote))) return false;
    if (remoteOnly && !j.remote) return false;
    if (postedWithinDays > 0 && j.postedAt && now - Date.parse(j.postedAt) > postedWithinDays * 86400000) return false;
    return true;
  });
}
