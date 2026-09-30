import {decodeEntities, textFromHtml, findTags, absolutize} from './shared/html.js';

const unCdata = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const val = s => { const v = decodeEntities(unCdata(s)).trim(); return v || null; };

function tagText(block, names) {
  for (const name of [].concat(names)) {
    const re = new RegExp(`<${name.replace(':', '\\:')}\\b[^>]*>([\\s\\S]*?)</${name.replace(':', '\\:')}>`, 'i');
    const m = re.exec(block);
    if (m) return m[1];
  }
  return null;
}
function tagAttr(block, name, attr, where = null) {
  const re = new RegExp(`<${name.replace(':', '\\:')}\\b([^>]*)/?>`, 'gi');
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (where && !where(attrs)) continue;
    const a = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
    if (a) return decodeEntities(a[1]);
  }
  return null;
}
const allTags = (block, name) => [...block.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi'))].map(m => val(m[1])).filter(Boolean);

export function toIso(s) {
  if (!s) return null;
  const d = new Date(String(s).trim().replace(/\s+(UT|GMT)$/i, ' GMT'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const summaryText = html => { if (!html) return null; const t = textFromHtml(decodeEntities(unCdata(html))); return t ? t.slice(0, 2000) : null; };

// Parse RSS 2.0 / RSS 1.0 (RDF) / Atom / JSON Feed. Returns {format, title, link, description, items: [...]}
export function parseFeed(body, feedUrl) {
  const text = String(body ?? '').replace(/^﻿/, '').trim();
  if (text.startsWith('{')) {
    const j = JSON.parse(text);
    if (!/jsonfeed\.org/.test(j.version ?? '')) throw new Error('Not a feed');
    return {format: 'json', title: j.title ?? null, link: j.home_page_url ?? null, description: j.description ?? null,
      items: (j.items ?? []).map(i => ({title: i.title ?? null, link: i.url ?? i.external_url ?? null, guid: String(i.id ?? i.url ?? ''), published: toIso(i.date_published), updated: toIso(i.date_modified),
        author: i.authors?.[0]?.name ?? i.author?.name ?? null, categories: i.tags ?? [], summary: i.summary ?? summaryText(i.content_html) ?? ((i.content_text ?? '').slice(0, 2000) || null),
        contentHtml: i.content_html ?? null, image: i.image ?? null, enclosureUrl: i.attachments?.[0]?.url ?? null, enclosureType: i.attachments?.[0]?.mime_type ?? null, durationSeconds: i.attachments?.[0]?.duration_in_seconds ?? null}))};
  }
  const isAtom = /<feed\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(text) || (/<feed\b/i.test(text) && /<entry\b/i.test(text));
  if (isAtom) {
    const head = text.split(/<entry\b/i)[0];
    const items = [...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => {
      const b = m[1];
      const link = tagAttr(b, 'link', 'href', a => !/rel=["'](?!alternate)/i.test(a)) ?? tagAttr(b, 'link', 'href');
      return {title: val(tagText(b, 'title')), link: link ? absolutize(link, feedUrl) : null, guid: val(tagText(b, 'id')), published: toIso(val(tagText(b, ['published', 'issued']))), updated: toIso(val(tagText(b, ['updated', 'modified']))),
        author: val(tagText(tagText(b, 'author') ?? '', 'name')), categories: [...b.matchAll(/<category\b[^>]*term=["']([^"']+)["']/gi)].map(x => decodeEntities(x[1])),
        summary: summaryText(tagText(b, ['summary', 'content'])), contentHtml: val(tagText(b, 'content')), image: tagAttr(b, 'media:thumbnail', 'url') ?? tagAttr(b, 'media:content', 'url'),
        enclosureUrl: tagAttr(b, 'link', 'href', a => /rel=["']enclosure/i.test(a)), enclosureType: null, durationSeconds: null};
    });
    return {format: 'atom', title: val(tagText(head, 'title')), link: tagAttr(head, 'link', 'href', a => !/rel=["']self/i.test(a)), description: val(tagText(head, 'subtitle')), items};
  }
  if (/<rss\b|<rdf:RDF\b|<channel\b/i.test(text)) {
    const head = text.split(/<item\b/i)[0];
    const items = [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => {
      const b = m[1];
      const link = val(tagText(b, 'link'));
      const dur = val(tagText(b, 'itunes:duration'));
      return {title: val(tagText(b, 'title')), link: link ? absolutize(link, feedUrl) : null, guid: val(tagText(b, 'guid')) ?? link, published: toIso(val(tagText(b, ['pubDate', 'dc:date']))), updated: null,
        author: val(tagText(b, ['dc:creator', 'author', 'itunes:author'])), categories: allTags(b, 'category'),
        summary: summaryText(tagText(b, ['description', 'itunes:summary'])), contentHtml: val(tagText(b, 'content:encoded')),
        image: tagAttr(b, 'media:thumbnail', 'url') ?? tagAttr(b, 'media:content', 'url', a => /image/i.test(a)) ?? tagAttr(b, 'itunes:image', 'href') ?? tagAttr(b, 'enclosure', 'url', a => /type=["']image/i.test(a)),
        enclosureUrl: tagAttr(b, 'enclosure', 'url'), enclosureType: tagAttr(b, 'enclosure', 'type'), durationSeconds: dur ? durationToSeconds(dur) : null};
    });
    return {format: /<rdf:RDF/i.test(text) ? 'rss1' : 'rss2', title: val(tagText(head, 'title')), link: val(tagText(head, 'link')), description: val(tagText(head, 'description')), items};
  }
  throw new Error('Not an RSS, Atom or JSON feed');
}

export function durationToSeconds(s) {
  const p = String(s).trim().split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

// Find feed links in an HTML page.
export function discoverFeeds(html, pageUrl) {
  return findTags(String(html ?? ''), ['link'])
    .filter(t => /alternate/i.test(t.attrs.rel ?? '') && /(rss|atom|feed)\+?(xml|json)|application\/feed\+json/i.test(t.attrs.type ?? ''))
    .map(t => absolutize(t.attrs.href, pageUrl)).filter(Boolean);
}

export const looksLikeFeed = body => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(String(body ?? '')) || /^\s*\{[\s\S]*jsonfeed\.org/.test(String(body ?? '').slice(0, 500));
