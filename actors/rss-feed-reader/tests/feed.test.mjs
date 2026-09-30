import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed, discoverFeeds, looksLikeFeed, toIso, durationToSeconds} from '../src/feed.js';

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>570ZX Blog</title><link>https://570zx.example/</link><description>Builds</description>
<item><title><![CDATA[Hood &amp; fenders]]></title><link>https://570zx.example/p/1</link><guid>p1</guid><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate>
<dc:creator>Dodge</dc:creator><category>Carbon</category><category>Z32</category><description>&lt;p&gt;Laid up the &lt;b&gt;hood&lt;/b&gt;&lt;/p&gt;</description>
<content:encoded><![CDATA[<p>Full post</p>]]></content:encoded><enclosure url="https://570zx.example/ep1.mp3" type="audio/mpeg" length="1"/><itunes:duration>1:02:03</itunes:duration></item>
<item><title>Second</title><link>/p/2</link></item></channel></rss>`;

test('RSS 2.0 with CDATA, entities, dc:creator, categories, enclosure, podcast duration', () => {
  const f = parseFeed(rss, 'https://570zx.example/feed');
  assert.equal(f.format, 'rss2'); assert.equal(f.title, '570ZX Blog'); assert.equal(f.items.length, 2);
  const i = f.items[0];
  assert.equal(i.title, 'Hood & fenders'); assert.equal(i.author, 'Dodge'); assert.deepEqual(i.categories, ['Carbon', 'Z32']);
  assert.equal(i.summary, 'Laid up the hood'); assert.equal(i.contentHtml, '<p>Full post</p>'); assert.equal(i.published, '2026-09-29T10:00:00.000Z');
  assert.equal(i.enclosureUrl, 'https://570zx.example/ep1.mp3'); assert.equal(i.durationSeconds, 3723);
  assert.equal(f.items[1].link, 'https://570zx.example/p/2');
});

test('Atom and JSON Feed', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><link rel="self" href="https://a.com/atom"/><link href="https://a.com/"/>
  <entry><title type="html">Post &lt;1&gt;</title><link rel="alternate" href="https://a.com/1"/><id>tag:a,1</id><updated>2026-09-01T00:00:00Z</updated><published>2026-08-31T00:00:00Z</published>
  <author><name>Ann</name></author><category term="news"/><summary>Short</summary></entry></feed>`;
  const a = parseFeed(atom, 'https://a.com/atom');
  assert.equal(a.format, 'atom'); assert.equal(a.link, 'https://a.com/'); assert.equal(a.items[0].title, 'Post <1>'); assert.equal(a.items[0].link, 'https://a.com/1');
  assert.equal(a.items[0].author, 'Ann'); assert.deepEqual(a.items[0].categories, ['news']); assert.equal(a.items[0].published, '2026-08-31T00:00:00.000Z');
  const j = parseFeed(JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'J', items: [{id: '1', url: 'https://j.com/1', title: 'T', content_text: 'hello', date_published: '2026-01-01T00:00:00Z'}]}), 'https://j.com/feed.json');
  assert.equal(j.format, 'json'); assert.equal(j.items[0].summary, 'hello');
});

test('discovery and detection', () => {
  const html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="a.css"></head></html>';
  assert.deepEqual(discoverFeeds(html, 'https://b.com/blog/'), ['https://b.com/feed.xml']);
  assert.ok(looksLikeFeed(rss)); assert.ok(!looksLikeFeed(html));
  assert.throws(() => parseFeed(html, 'https://b.com'));
  assert.equal(toIso('Mon, 01 Jan 2024 00:00:00 UT'), '2024-01-01T00:00:00.000Z'); assert.equal(toIso('garbage'), null);
  assert.equal(durationToSeconds('45'), 45); assert.equal(durationToSeconds('x:1'), null);
});
