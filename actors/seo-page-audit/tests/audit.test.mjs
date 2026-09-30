import test from 'node:test';
import assert from 'node:assert/strict';
import {audit} from '../src/audit.js';

const good = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Carbon fibre body kits for the Nissan 300ZX | 570ZX</title>
<meta name="description" content="Hand-laid carbon fibre body panels for the Z32 300ZX, designed and test-fitted in the UK. Hoods, fenders, diffusers and more.">
<link rel="canonical" href="https://570zx.example/kits"><link rel="icon" href="/f.ico">
<meta property="og:title" content="Kits"><script type="application/ld+json">{"@type":"Organization","name":"570ZX"}</script></head>
<body><h1>Body kits</h1><h2>Hoods</h2><img src="a.jpg" alt="hood"><a href="/about">About</a><a href="https://instagram.com/x" rel="nofollow">IG</a>
<p>${'word '.repeat(300)}</p></body></html>`;
const res = (body, extra = {}) => ({finalUrl: 'https://570zx.example/kits', status: 200, headers: {}, body, bytes: body.length, ms: 300, redirected: false, ...extra});

test('a well-built page scores high with no errors or warnings', () => {
  const a = audit(res(good), 'https://570zx.example/kits');
  assert.equal(a.errors, 0); assert.equal(a.warnings, 0);
  assert.ok(a.score >= 97, 'score ' + a.score + ' ' + JSON.stringify(a.issues));
  assert.deepEqual(a.h1, ['Body kits']); assert.equal(a.internalLinks, 1); assert.equal(a.externalLinks, 1); assert.equal(a.nofollowLinks, 1);
  assert.ok(a.wordCount >= 300); assert.deepEqual(a.schemaTypes, ['Organization']); assert.equal(a.lang, 'en');
});

test('a bare page gets the right issues', () => {
  const a = audit(res('<html><head></head><body><img src=x.png><p>hi</p></body></html>', {finalUrl: 'http://bare.example/'}), 'http://bare.example/');
  const codes = a.issues.map(i => i.code);
  for (const c of ['no_https', 'title_missing', 'description_missing', 'h1_missing', 'viewport_missing', 'img_alt_missing', 'thin_content', 'lang_missing', 'canonical_missing'])
    assert.ok(codes.includes(c), 'missing ' + c);
  assert.ok(a.score < 60);
});

test('noindex via header, redirects, slow server, 404', () => {
  const a = audit(res(good, {headers: {'x-robots-tag': 'noindex'}, redirected: true, ms: 4500, status: 404}), 'https://570zx.example/old');
  const codes = a.issues.map(i => i.code);
  for (const c of ['noindex', 'redirect', 'slow_response', 'http_status']) assert.ok(codes.includes(c), 'missing ' + c);
});

test('title length warnings', () => {
  const long = good.replace(/<title>.*<\/title>/, `<title>${'x'.repeat(80)}</title>`);
  assert.ok(audit(res(long), 'https://570zx.example/kits').issues.some(i => i.code === 'title_long'));
});
