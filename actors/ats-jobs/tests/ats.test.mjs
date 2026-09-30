import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCompany, endpoint, normalize, filterJobs} from '../src/ats.js';

test('parseCompany recognises each ATS URL and plain names', () => {
  assert.deepEqual(parseCompany('https://boards.greenhouse.io/airbnb'), {ats: 'greenhouse', slug: 'airbnb'});
  assert.deepEqual(parseCompany('https://job-boards.greenhouse.io/embed/job_board?for=stripe'), {ats: 'greenhouse', slug: 'stripe'});
  assert.deepEqual(parseCompany('jobs.lever.co/netflix/abc-123'), {ats: 'lever', slug: 'netflix'});
  assert.deepEqual(parseCompany('https://jobs.ashbyhq.com/openai'), {ats: 'ashby', slug: 'openai'});
  assert.deepEqual(parseCompany('https://apply.workable.com/huggingface/'), {ats: 'workable', slug: 'huggingface'});
  assert.deepEqual(parseCompany('https://careers.smartrecruiters.com/Visa1'), {ats: 'smartrecruiters', slug: 'Visa1'});
  assert.deepEqual(parseCompany('https://acme.recruitee.com/o/dev'), {ats: 'recruitee', slug: 'acme'});
  assert.deepEqual(parseCompany('lever:spotify'), {ats: 'lever', slug: 'spotify'});
  assert.deepEqual(parseCompany('notion'), {ats: null, slug: 'notion'});
  assert.equal(parseCompany(''), null);
  assert.ok(endpoint('greenhouse', 'a b').includes('a%20b'));
});

test('normalize Greenhouse (escaped HTML content)', () => {
  const j = normalize('greenhouse', 'acme', {jobs: [{id: 1, title: 'Senior Engineer', location: {name: 'Remote - UK'}, absolute_url: 'https://x/1', updated_at: '2026-09-01T10:00:00-04:00',
    departments: [{name: 'Engineering'}], content: '&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;'}]})[0];
  assert.equal(j.title, 'Senior Engineer'); assert.equal(j.remote, true); assert.equal(j.department, 'Engineering');
  assert.equal(j.descriptionText, 'Build & ship'); assert.equal(j.postedAt, '2026-09-01T14:00:00.000Z');
});

test('normalize Lever, Ashby, Workable, SmartRecruiters, Recruitee', () => {
  const l = normalize('lever', 'n', [{id: 'a', text: 'Designer', categories: {location: 'London', team: 'Brand', department: 'Design', commitment: 'Full-time'}, hostedUrl: 'h', applyUrl: 'ap', createdAt: 1767225600000, descriptionPlain: 'Plain', workplaceType: 'hybrid'}])[0];
  assert.equal(l.department, 'Design / Brand'); assert.equal(l.employmentType, 'Full-time'); assert.equal(l.postedAt, '2026-01-01T00:00:00.000Z'); assert.equal(l.remote, false);
  const a = normalize('ashby', 'o', {jobs: [{id: 'x', title: 'ML', location: 'SF', isRemote: true, jobUrl: 'u', publishedAt: '2026-05-01T00:00:00Z', compensation: {compensationTierSummary: '$200K – $300K'}}, {id: 'y', title: 'Hidden', isListed: false}]});
  assert.equal(a.length, 1); assert.equal(a[0].salary, '$200K – $300K'); assert.ok(a[0].remote);
  const w = normalize('workable', 'h', {name: 'HF', jobs: [{title: 'Eng', shortcode: 'S1', city: 'Paris', country: 'France', telecommuting: true, url: 'u', published_on: '2026-02-02'}]})[0];
  assert.equal(w.location, 'Paris, France'); assert.ok(w.remote);
  const s = normalize('smartrecruiters', 'Visa', {content: [{id: '9', name: 'Analyst', location: {city: 'Austin', region: 'TX', country: 'us', remote: false}, department: {label: 'Finance'}, releasedDate: '2026-03-03T00:00:00Z'}]})[0];
  assert.equal(s.location, 'Austin, TX, US'); assert.equal(s.url, 'https://jobs.smartrecruiters.com/Visa/9');
  const r = normalize('recruitee', 'acme', {offers: [{id: 5, title: 'Support', city: 'Berlin', country: 'Germany', remote: false, careers_url: 'c', published_at: '2026-04-04 10:00:00 UTC', description: '<p>Hi</p>'}]})[0];
  assert.equal(r.location, 'Berlin, Germany'); assert.equal(r.descriptionText, 'Hi');
});

test('filters', () => {
  const now = Date.parse('2026-09-30T00:00:00Z');
  const jobs = [{title: 'Senior Engineer', location: 'London', remote: false, postedAt: '2026-09-25T00:00:00Z'}, {title: 'Sales Lead', location: 'Remote', remote: true, postedAt: '2026-01-01T00:00:00Z'}];
  assert.equal(filterJobs(jobs, {keywords: ['engineer']}).length, 1);
  assert.equal(filterJobs(jobs, {locations: ['remote']}).length, 1);
  assert.equal(filterJobs(jobs, {remoteOnly: true})[0].title, 'Sales Lead');
  assert.equal(filterJobs(jobs, {postedWithinDays: 30, now}).length, 1);
});
