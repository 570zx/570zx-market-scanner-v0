import {gunzipSync} from 'node:zlib';
import {normalizeUrl, parseRobots} from './shared/web.js';

const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
export const unescapeXml = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]).trim();

export function bufferToText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? '');
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) return gunzipSync(b, {maxOutputLength: 200_000_000}).toString('utf8');
  return b.toString('utf8');
}

const tag = (block, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i').exec(block);
  return m ? unescapeXml(m[1]) : null;
};

// Returns {type: 'index'|'urlset'|'text'|'unknown', sitemaps: [...], urls: [{url, lastmod, changefreq, priority, images}]}
export function parseSitemap(text) {
  const t = String(text ?? '').replace(/^﻿/, '');
  if (/<(?:[\w-]+:)?sitemapindex\b/i.test(t)) {
    const sitemaps = [];
    for (const m of t.matchAll(/<(?:[\w-]+:)?sitemap\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?sitemap>/gi)) {
      const loc = tag(m[1], 'loc');
      if (loc) sitemaps.push({url: loc, lastmod: tag(m[1], 'lastmod')});
    }
    return {type: 'index', sitemaps, urls: []};
  }
  if (/<(?:[\w-]+:)?urlset\b/i.test(t)) {
    const urls = [];
    for (const m of t.matchAll(/<(?:[\w-]+:)?url\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?url>/gi)) {
      const loc = tag(m[1], 'loc');
      if (!loc) continue;
      const pr = tag(m[1], 'priority');
      urls.push({url: loc, lastmod: tag(m[1], 'lastmod'), changefreq: tag(m[1], 'changefreq'), priority: pr != null && pr !== '' && !Number.isNaN(Number(pr)) ? Number(pr) : null,
        images: (m[1].match(/<(?:[\w-]+:)?image\b[^>]*>/gi) ?? []).filter(x => !/image:loc|<image:title/i.test(x)).length});
    }
    return {type: 'urlset', sitemaps: [], urls};
  }
  if (/^\s*<(?:!doctype|html)/i.test(t)) return {type: 'unknown', sitemaps: [], urls: []};
  // Text sitemap: one absolute URL per line.
  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\/\S+$/i.test(s));
  if (lines.length) return {type: 'text', sitemaps: [], urls: lines.map(url => ({url, lastmod: null, changefreq: null, priority: null, images: 0}))};
  return {type: 'unknown', sitemaps: [], urls: []};
}

export const looksLikeSitemapUrl = u => /sitemap|\.xml(\.gz)?$|\.txt$/i.test(new URL(u).pathname);

// Walk a site's sitemaps. fetchText(url) -> {status, text} (throws on network error).
export async function collect({start, fetchText, maxUrls = 5000, maxSitemaps = 200, onLog = () => {}}) {
  const origin = new URL(start).origin;
  let queue = [];
  const tried = [];
  if (looksLikeSitemapUrl(start) && new URL(start).pathname !== '/') {
    queue.push(start);
  } else {
    try {
      const r = await fetchText(`${origin}/robots.txt`);
      if (r.status < 400) queue.push(...parseRobots(r.text).sitemaps.map(s => normalizeUrl(s)).filter(Boolean));
    } catch { /* no robots.txt */ }
    if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`, `${origin}/sitemap.txt`);
  }
  const seenMaps = new Set(), seenUrls = new Set(), urls = [], sitemapsRead = [], errors = [];
  let fallbackMode = !looksLikeSitemapUrl(start) || new URL(start).pathname === '/';
  while (queue.length && urls.length < maxUrls && seenMaps.size < maxSitemaps) {
    const sm = queue.shift();
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm); tried.push(sm);
    let r;
    try { r = await fetchText(sm); } catch (e) { errors.push(`${sm}: ${e.message}`); continue; }
    if (r.status >= 400) { errors.push(`${sm}: HTTP ${r.status}`); continue; }
    let parsed;
    try { parsed = parseSitemap(r.text); } catch (e) { errors.push(`${sm}: ${e.message}`); continue; }
    if (parsed.type === 'unknown') { errors.push(`${sm}: not a sitemap`); continue; }
    sitemapsRead.push(sm);
    if (parsed.type === 'index') {
      queue.unshift(...parsed.sitemaps.map(s => normalizeUrl(s.url)).filter(Boolean));
    } else {
      for (const u of parsed.urls) {
        if (seenUrls.has(u.url)) continue;
        seenUrls.add(u.url);
        urls.push({...u, sitemap: sm});
        if (urls.length >= maxUrls) break;
      }
    }
    // Found a real sitemap through the guesses: stop guessing the other default names.
    if (fallbackMode && sitemapsRead.length) { queue = queue.filter(q => !/\/(?:sitemap|sitemap_index|wp-sitemap)\.xml$|\/sitemap\.txt$/.test(q) || seenMaps.has(q)); fallbackMode = false; }
  }
  return {urls, sitemapsRead, tried, errors, truncated: urls.length >= maxUrls};
}
