// Copied into each web Actor's tests/ as shared-web.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUrl, readUrls, parseRobots, robotsAllows, Fetcher, pool} from '../src/shared/web.js';

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl(' http://a.b/x#frag '), 'http://a.b/x');
  assert.equal(normalizeUrl('ftp://a.b'), null);
  assert.equal(normalizeUrl('notaurl'), null);
  assert.equal(normalizeUrl(''), null);
});

test('readUrls dedupes, accepts objects and text, reports invalid', () => {
  const r = readUrls({urls: ['example.com', {url: 'https://example.com/'}, 'bad', 'b.org/x']});
  assert.deepEqual(r.urls, ['https://example.com/', 'https://b.org/x']);
  assert.deepEqual(r.invalid, ['bad']);
  assert.deepEqual(readUrls({urls: 'a.com b.com,c.com'}).urls.length, 3);
  assert.equal(readUrls({urls: ['a.com', 'b.com', 'c.com']}, 'urls', 2).overLimit, 1);
});

test('robots: groups, longest match, allow ties, wildcards', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: BadBot\nUser-agent: DodgeBotTools\nDisallow: /nope\nSitemap: https://x.com/s.xml`);
  assert.deepEqual(r.sitemaps, ['https://x.com/s.xml']);
  // our agent has its own group, so * rules do not apply
  assert.equal(robotsAllows(r, 'DodgeBotTools', '/private'), true);
  assert.equal(robotsAllows(r, 'DodgeBotTools', '/nope/a'), false);
  assert.equal(robotsAllows(r, 'OtherBot', '/private/x'), false);
  assert.equal(robotsAllows(r, 'OtherBot', '/private/ok/1'), true);
  assert.equal(robotsAllows(r, 'OtherBot', '/file.pdf'), false);
  assert.equal(robotsAllows(r, 'OtherBot', '/file.pdf?x'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:'), 'x', '/a'), true);
  assert.equal(robotsAllows(null, 'x', '/a'), true);
});

const resp = (body, {status = 200, type = 'text/html; charset=utf-8', url} = {}) => ({
  status, url, redirected: false, headers: new Map([['content-type', type]]), body: null,
  arrayBuffer: async () => new TextEncoder().encode(body).buffer
});

test('Fetcher respects robots.txt and caches it', async () => {
  const calls = [];
  const f = async u => { calls.push(u); return u.endsWith('/robots.txt') ? resp('User-agent: *\nDisallow: /secret', {type: 'text/plain'}) : resp('<p>hi</p>', {url: u}); };
  const fe = new Fetcher({fetchImpl: f, sleep: async () => {}});
  assert.equal((await fe.get('https://s.com/page')).body, '<p>hi</p>');
  await assert.rejects(fe.get('https://s.com/secret/x'), e => e.code === 'ROBOTS');
  assert.equal(calls.filter(c => c.endsWith('robots.txt')).length, 1);
  const off = new Fetcher({fetchImpl: f, respectRobots: false});
  assert.equal((await off.get('https://s.com/secret/x')).status, 200);
});

test('Fetcher retries 503 then gives up with a clear error; caps size', async () => {
  let n = 0;
  const f = async u => (u.endsWith('robots.txt') ? resp('', {status: 404}) : (++n, resp('x', {status: 503})));
  const fe = new Fetcher({fetchImpl: f, sleep: async () => {}, retries: 2});
  const r = await fe.get('https://s.com/');
  assert.equal(r.status, 503); assert.equal(n, 3);
  const big = new Fetcher({fetchImpl: async () => resp('a'.repeat(100)), maxBytes: 10, respectRobots: false});
  const b = await big.get('https://s.com/');
  assert.equal(b.body.length, 10); assert.ok(b.truncated);
  const dead = new Fetcher({fetchImpl: async () => { throw new Error('ECONNRESET'); }, sleep: async () => {}, respectRobots: false});
  await assert.rejects(dead.get('https://s.com/'), e => e.code === 'FETCH' && /ECONNRESET/.test(e.message));
});

test('pool runs everything with bounded concurrency and can stop', async () => {
  let active = 0, peak = 0; const seen = [];
  await pool([1, 2, 3, 4, 5, 6], 2, async x => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); seen.push(x); active--; });
  assert.equal(seen.length, 6); assert.equal(peak, 2);
  const s2 = [];
  await pool([1, 2, 3, 4], 1, async (x, i, stop) => { s2.push(x); if (x === 2) stop(); });
  assert.deepEqual(s2, [1, 2]);
});
