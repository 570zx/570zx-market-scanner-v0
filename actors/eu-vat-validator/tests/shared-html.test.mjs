// Copied into web Actors' tests/ as shared-html.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeEntities, stripNonContent, parseAttrs, findTags, elementTexts, jsonLdBlocks, jsonLdNodes, metaTags, absolutize, textFromHtml} from '../src/shared/html.js';

test('entities and attributes', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#8217;s &#x41; &nbsp;&bogus;'), 'Tom & Jerry ’s A  &bogus;');
  assert.deepEqual(parseAttrs(` href="/a?x=1&amp;y=2" data-x='q "z"' disabled rel=nofollow`), {href: '/a?x=1&y=2', 'data-x': 'q "z"', disabled: '', rel: 'nofollow'});
});

test('findTags handles > inside quoted attributes and ignores script contents after stripping', () => {
  const h = stripNonContent('<img alt="a > b" src="x.png"><script>var s="<img src=no.png>"</script><!-- <img src=c.png> --><IMG SRC=y.png>');
  assert.deepEqual(findTags(h, ['img']).map(t => t.attrs.src), ['x.png', 'y.png']);
  assert.equal(findTags(h, ['img'])[0].attrs.alt, 'a > b');
});

test('elementTexts and text extraction', () => {
  const h = '<h1 class="t">Hello <span>World</span></h1><h1>Two<br>Lines</h1>';
  assert.deepEqual(elementTexts(h, 'h1').map(e => e.text), ['Hello World', 'Two Lines']);
  assert.equal(textFromHtml('<p>a&amp;b</p>\n <b>c</b>'), 'a&b c');
});

test('JSON-LD: good, bad, @graph', () => {
  const h = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"A"},{"@type":["Product","Thing"],"name":"P"}]}</script>
    <script type='application/ld+json'>{bad json</script>`;
  const b = jsonLdBlocks(h);
  assert.equal(b.length, 2); assert.ok(b[0].ok); assert.ok(!b[1].ok);
  assert.deepEqual(jsonLdNodes(b).map(n => n.name), ['A', 'P']);
});

test('meta tags and absolutize', () => {
  const m = metaTags('<meta name="Description" content="d"><meta property="og:title" content="t"><meta name="description" content="second">');
  assert.equal(m.name.description, 'd'); assert.equal(m.property['og:title'], 't');
  assert.equal(absolutize('/x', 'https://a.com/b/c'), 'https://a.com/x');
  assert.equal(absolutize('http://[bad', 'https://a.com'), null);
});
