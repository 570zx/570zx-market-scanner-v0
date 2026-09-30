import test from 'node:test';
import assert from 'node:assert/strict';
import {convert, chunkMarkdown, tidyMarkdown, countWords} from '../src/convert.js';

const para = n => `<p>${'The carbon fibre hood is laid by hand and cured in an oven for strength. '.repeat(n)}</p>`;
const articlePage = `<!doctype html><html lang="en"><head><title>How we make hoods</title><meta name="description" content="Process notes"></head><body>
<header><nav><a href="/">Home</a><a href="/shop">Shop</a></nav></header>
<main><article><h1>How we make hoods</h1>${para(8)}<h2>Curing</h2>${para(6)}
<table><tr><th>Step</th><th>Hours</th></tr><tr><td>Cure</td><td>8</td></tr></table>
<p>See <a href="/guide">the guide</a> and <img src="/img/h.jpg" alt="hood"></p></article></main>
<footer>© 570ZX <a href="/privacy">Privacy</a></footer><script>track()</script></body></html>`;

test('article mode keeps the main content, drops nav/footer, absolute links, tables as GFM', () => {
  const r = convert(articlePage, 'https://570zx.example/blog/hoods', {mode: 'article', includeLinks: true});
  assert.equal(r.extraction, 'main_content');
  assert.equal(r.title, 'How we make hoods');
  assert.equal(r.lang, 'en');
  assert.ok(r.markdown.startsWith('# How we make hoods'), r.markdown.slice(0, 80));
  assert.ok(r.markdown.includes('## Curing'));
  assert.ok(r.markdown.includes('[the guide](https://570zx.example/guide)'));
  assert.ok(r.markdown.includes('![hood](https://570zx.example/img/h.jpg)'));
  assert.ok(/\|\s*Step\s*\|\s*Hours\s*\|/.test(r.markdown), 'table: ' + r.markdown);
  assert.ok(!r.markdown.includes('Privacy') && !r.markdown.includes('track()'));
  assert.ok(r.links.includes('https://570zx.example/shop'));
});

test('short pages fall back to the full page', () => {
  const r = convert('<html><head><title>Tiny</title></head><body><nav>menu</nav><p>Just a few words here.</p></body></html>', 'https://a.com/', {mode: 'article'});
  assert.equal(r.extraction, 'full_page_fallback');
  assert.ok(r.markdown.includes('Just a few words here.'));
  assert.ok(!r.markdown.includes('menu'));
});

test('chunking respects size and carries headings', () => {
  const md = '# A\n\n' + 'alpha '.repeat(200) + '\n\n## B\n\n' + 'beta '.repeat(200);
  const c = chunkMarkdown(md, 100);
  assert.ok(c.length >= 3);
  assert.ok(c.every(x => x.text.length <= 400 + 10));
  assert.equal(c.at(-1).heading, 'B');
  assert.equal(chunkMarkdown(md, 0), null);
});

test('helpers', () => {
  assert.equal(tidyMarkdown('a  \n\n\n\nb c'), 'a\n\nb c');
  assert.equal(countWords("It's 2 o'clock, don't-panic"), 4);
});
