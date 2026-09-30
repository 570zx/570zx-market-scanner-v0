import test from 'node:test';
import assert from 'node:assert/strict';
import {detect, summarize, cookieNames, pageParts} from '../src/detect.js';
import {SIGNATURES} from '../src/signatures.js';

const names = t => t.map(x => x.name);

test('signatures are well formed and unique', () => {
  const seen = new Set();
  for (const s of SIGNATURES) {
    assert.ok(s.name && s.cat, JSON.stringify(s));
    assert.ok(!seen.has(s.name), 'duplicate ' + s.name); seen.add(s.name);
    assert.ok(s.header || s.meta || s.src || s.html || s.cookie, s.name + ' has no checks');
    for (const imp of s.implies ?? []) assert.ok(SIGNATURES.some(x => x.name === imp), `${s.name} implies unknown ${imp}`);
  }
});

test('WordPress + WooCommerce + GA4 + Cloudflare from a realistic page', () => {
  const html = `<html><head><meta name="generator" content="WordPress 6.6.2" />
    <link rel='stylesheet' href='https://shop.example/wp-content/plugins/woocommerce/assets/css/woocommerce.css' />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
    <script src="https://shop.example/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script></head>
    <body class="home woocommerce-no-js"></body></html>`;
  const t = detect({headers: {server: 'cloudflare', 'cf-ray': '8abc-LHR', 'set-cookie': 'PHPSESSID=abc; path=/, wp_lang=en; path=/'}, html});
  const n = names(t);
  for (const x of ['WordPress', 'WooCommerce', 'Google Analytics', 'Cloudflare', 'jQuery', 'PHP']) assert.ok(n.includes(x), 'missing ' + x + ' in ' + n);
  assert.equal(t.find(x => x.name === 'WordPress').version, '6.6.2');
  assert.equal(t.find(x => x.name === 'WordPress').confidence, 'high');
  const s = summarize(t);
  assert.equal(s.cms, 'WordPress'); assert.equal(s.ecommerce, 'WooCommerce'); assert.equal(s.cdn, 'Cloudflare');
});

test('Next.js on Vercel implies React', () => {
  const t = detect({headers: {'x-powered-by': 'Next.js', server: 'Vercel', 'x-vercel-id': 'lhr1::abc'}, html: '<script id="__NEXT_DATA__" type="application/json">{}</script><script src="/_next/static/chunks/main.js"></script>'});
  const n = names(t);
  assert.ok(n.includes('Next.js') && n.includes('Vercel') && n.includes('React'));
  assert.deepEqual(t.find(x => x.name === 'React').evidence, ['implied by Next.js']);
  assert.equal(t.find(x => x.name === 'Next.js').confidence, 'high');
});

test('Shopify store', () => {
  const t = detect({headers: {'x-shopid': '123'}, html: '<script src="//cdn.shopify.com/s/files/1/theme.js"></script><script>window.Shopify = {}; Shopify.theme = {}</script>'});
  assert.ok(names(t).includes('Shopify'));
  assert.equal(summarize(t).ecommerce, 'Shopify');
});

test('plain page gives nothing spurious', () => {
  const t = detect({headers: {'content-type': 'text/html'}, html: '<html><body><h1>Hello</h1><p>Plain page about flex and grid.</p></body></html>'});
  assert.deepEqual(names(t), []);
});

test('helpers', () => {
  assert.deepEqual(cookieNames('a=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, laravel_session=xyz; HttpOnly'), ['a', 'laravel_session']);
  const p = pageParts('<script src="a.js"></script><link href="b.css" rel="stylesheet"><meta content="Hugo 0.121.0" name="generator">');
  assert.deepEqual(p.srcs, ['a.js', 'b.css']); assert.deepEqual(p.generators, ['Hugo 0.121.0']);
});
