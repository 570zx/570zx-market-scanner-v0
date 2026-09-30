import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {parseSitemap, collect, bufferToText, unescapeXml, looksLikeSitemapUrl} from '../src/sitemap.js';

const urlset = (...locs) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${locs.map(l => `<url><loc>${l}</loc><lastmod>2026-09-01</lastmod><priority>0.8</priority><image:image><image:loc>https://x/i.jpg</image:loc></image:image></url>`).join('')}</urlset>`;
const index = (...maps) => `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps.map(m => `<sitemap><loc>${m}</loc></sitemap>`).join('')}</sitemapindex>`;

test('parse urlset with entities, priority and images', () => {
  const p = parseSitemap(urlset('https://a.com/x?a=1&amp;b=2', 'https://a.com/y'));
  assert.equal(p.type, 'urlset');
  assert.deepEqual(p.urls.map(u => u.url), ['https://a.com/x?a=1&b=2', 'https://a.com/y']);
  assert.equal(p.urls[0].priority, 0.8); assert.equal(p.urls[0].lastmod, '2026-09-01'); assert.equal(p.urls[0].images, 1);
});

test('parse index, CDATA, text sitemaps, and reject HTML', () => {
  assert.deepEqual(parseSitemap(index('https://a.com/s1.xml', '<![CDATA[https://a.com/s2.xml]]>')).sitemaps.map(s => s.url), ['https://a.com/s1.xml', 'https://a.com/s2.xml']);
  assert.equal(parseSitemap('https://a.com/1\nhttps://a.com/2\n').urls.length, 2);
  assert.equal(parseSitemap('<!DOCTYPE html><html>404</html>').type, 'unknown');
  assert.equal(unescapeXml('&#39;&#x41;&lt;'), "'A<");
});

test('gzip sitemaps are unpacked', () => {
  assert.equal(bufferToText(gzipSync(Buffer.from('hello'))), 'hello');
  assert.equal(bufferToText(Buffer.from('plain')), 'plain');
});

test('looksLikeSitemapUrl', () => {
  assert.ok(looksLikeSitemapUrl('https://a.com/sitemap.xml'));
  assert.ok(looksLikeSitemapUrl('https://a.com/post-sitemap2.xml.gz'));
  assert.ok(!looksLikeSitemapUrl('https://a.com/'));
});

function site(pages) {
  const calls = [];
  const fetchText = async url => { calls.push(url); return url in pages ? {status: 200, text: pages[url]} : {status: 404, text: 'nf'}; };
  return {fetchText, calls};
}

test('collect: robots.txt -> index -> urlsets, dedup, maxUrls', async () => {
  const {fetchText, calls} = site({
    'https://a.com/robots.txt': 'User-agent: *\nSitemap: https://a.com/idx.xml',
    'https://a.com/idx.xml': index('https://a.com/s1.xml', 'https://a.com/s2.xml'),
    'https://a.com/s1.xml': urlset('https://a.com/1', 'https://a.com/2'),
    'https://a.com/s2.xml': urlset('https://a.com/2', 'https://a.com/3')
  });
  const r = await collect({start: 'https://a.com/', fetchText});
  assert.deepEqual(r.urls.map(u => u.url), ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  assert.equal(r.urls[2].sitemap, 'https://a.com/s2.xml');
  assert.ok(!calls.includes('https://a.com/sitemap.xml'));
  const cap = await collect({start: 'https://a.com/', fetchText, maxUrls: 2});
  assert.equal(cap.urls.length, 2); assert.ok(cap.truncated);
});

test('collect: falls back to /sitemap.xml and stops guessing once found', async () => {
  const {fetchText, calls} = site({'https://b.com/sitemap.xml': urlset('https://b.com/p')});
  const r = await collect({start: 'https://b.com', fetchText});
  assert.equal(r.urls.length, 1);
  assert.ok(!calls.includes('https://b.com/wp-sitemap.xml'));
});

test('collect: nothing found reports tried locations and does not loop on self-referencing index', async () => {
  const none = await collect({start: 'https://c.com', fetchText: site({}).fetchText});
  assert.equal(none.urls.length, 0); assert.ok(none.tried.length >= 3);
  const loop = await collect({start: 'https://d.com/sitemap.xml', fetchText: site({'https://d.com/sitemap.xml': index('https://d.com/sitemap.xml')}).fetchText});
  assert.equal(loop.urls.length, 0);
});
