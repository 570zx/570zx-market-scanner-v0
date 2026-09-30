import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLinks, HostLimiter, checkUrl} from '../src/links.js';

test('extractLinks: absolute, dedup, skips mailto/js/anchors, marks internal, optional assets', () => {
  const html = `<a href="/about">About us</a><a href="/about#team">Team</a><a href="https://www.site.com/x">X</a><a href="https://other.org/y" title="Other">
  </a><a href="mailto:a@b.c">mail</a><a href="javascript:void(0)">js</a><a href="#top">top</a><img src="/i.png" alt="pic"><script src="/app.js"></script>
  <link rel="stylesheet" href="/s.css"><!-- <a href="/commented">no</a> -->`;
  const l = extractLinks(html, 'https://site.com/page');
  assert.deepEqual(l.map(x => x.url), ['https://site.com/about', 'https://www.site.com/x', 'https://other.org/y']);
  assert.equal(l[0].text, 'About us'); assert.ok(l[0].internal); assert.ok(l[1].internal); assert.ok(!l[2].internal); assert.equal(l[2].text, 'Other');
  const a = extractLinks(html, 'https://site.com/page', {includeAssets: true});
  assert.deepEqual(a.filter(x => x.kind !== 'link').map(x => x.kind).sort(), ['image', 'script', 'stylesheet']);
});

test('HostLimiter caps concurrency per host', async () => {
  const lim = new HostLimiter(2); let active = 0, peak = 0;
  await Promise.all(Array.from({length: 6}, () => lim.run('h', async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 3)); active--; })));
  assert.equal(peak, 2);
});

const res = (status, url) => ({status, url, body: {cancel: async () => {}}});
test('checkUrl: ok, 404, HEAD refused then GET, redirect, retries 503, network error', async () => {
  const fast = {sleep: async () => {}};
  assert.equal((await checkUrl('https://a/ok', {fetchImpl: async u => res(200, u), ...fast})).broken, false);
  const nf = await checkUrl('https://a/nf', {fetchImpl: async u => res(404, u), ...fast});
  assert.equal(nf.broken, true); assert.equal(nf.httpStatus, 404);
  const methods = [];
  const h = await checkUrl('https://a/h', {fetchImpl: async (u, o) => { methods.push(o.method); return res(o.method === 'HEAD' ? 405 : 200, u); }, ...fast});
  assert.deepEqual(methods, ['HEAD', 'GET']); assert.equal(h.broken, false);
  const rd = await checkUrl('https://a/old', {fetchImpl: async () => res(200, 'https://a/new'), ...fast});
  assert.ok(rd.redirected); assert.equal(rd.finalUrl, 'https://a/new');
  let n = 0;
  const flaky = await checkUrl('https://a/f', {fetchImpl: async u => res(++n < 5 ? 503 : 200, u), ...fast});
  assert.equal(flaky.httpStatus, 200);
  const dead = await checkUrl('https://a/d', {fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), {cause: {code: 'ENOTFOUND'}}); }, ...fast});
  assert.equal(dead.broken, true); assert.equal(dead.error, 'ENOTFOUND');
});
