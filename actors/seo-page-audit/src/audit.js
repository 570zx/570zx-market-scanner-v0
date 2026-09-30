import {stripNonContent, findTags, elementTexts, jsonLdBlocks, jsonLdNodes, typesOf, metaTags, absolutize, textFromHtml} from './shared/html.js';

// On-page SEO audit of one fetched page. `res` = {finalUrl, status, headers, body, bytes, ms, redirected}; `requestedUrl` = what the user gave.
export function audit(res, requestedUrl) {
  const html = String(res.body ?? '');
  const clean = stripNonContent(html);
  const url = new URL(res.finalUrl);
  const meta = metaTags(clean);
  const issues = [];
  const add = (severity, code, message) => issues.push({severity, code, message});

  const title = elementTexts(clean, 'title')[0]?.text ?? '';
  const desc = meta.name.description ?? '';
  const h1 = elementTexts(clean, 'h1').map(e => e.text);
  const h2 = elementTexts(clean, 'h2').map(e => e.text);
  const links = findTags(clean, ['link']);
  const rel = t => (t.attrs.rel ?? '').toLowerCase().split(/\s+/);
  const canonicalRaw = links.find(t => rel(t).includes('canonical'))?.attrs.href ?? null;
  const canonical = canonicalRaw ? absolutize(canonicalRaw, url.href) : null;
  const hreflang = links.filter(t => rel(t).includes('alternate') && t.attrs.hreflang).map(t => t.attrs.hreflang);
  const favicon = links.some(t => rel(t).includes('icon'));
  const robotsMeta = (meta.name.robots ?? '').toLowerCase();
  const xRobots = (res.headers?.['x-robots-tag'] ?? '').toLowerCase();
  const htmlTag = findTags(clean, ['html'])[0]?.attrs ?? {};
  const imgs = findTags(clean, ['img']);
  const missingAlt = imgs.filter(i => i.attrs.alt == null);
  const anchors = findTags(clean, ['a']).filter(a => a.attrs.href && !/^(?:#|javascript:|mailto:|tel:)/i.test(a.attrs.href));
  let internal = 0, external = 0, nofollow = 0;
  for (const a of anchors) {
    const abs = absolutize(a.attrs.href, url.href);
    if (!abs) continue;
    if (new URL(abs).hostname.replace(/^www\./, '') === url.hostname.replace(/^www\./, '')) internal++; else external++;
    if (/\bnofollow\b/i.test(a.attrs.rel ?? '')) nofollow++;
  }
  const bodyHtml = /<body\b[\s\S]*<\/body>/i.exec(clean)?.[0] ?? clean;
  const text = textFromHtml(bodyHtml);
  const words = text ? text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const schemaTypes = [...new Set(jsonLdNodes(jsonLdBlocks(html)).flatMap(typesOf))];
  const og = Object.keys(meta.property).filter(k => k.startsWith('og:'));

  // --- checks
  if (res.status >= 400) add('error', 'http_status', `Page answers HTTP ${res.status}.`);
  if (url.protocol !== 'https:') add('error', 'no_https', 'Page is not served over HTTPS.');
  if (res.redirected && res.finalUrl !== requestedUrl) add('notice', 'redirect', `Requested URL redirects to ${res.finalUrl}.`);
  if (!title) add('error', 'title_missing', 'No <title>.');
  else if (title.length < 20) add('warning', 'title_short', `Title is short (${title.length} characters; aim for 30-60).`);
  else if (title.length > 65) add('warning', 'title_long', `Title is long (${title.length} characters) and may be cut off in search results.`);
  if (!desc) add('warning', 'description_missing', 'No meta description.');
  else if (desc.length < 70) add('notice', 'description_short', `Meta description is short (${desc.length} characters; aim for 70-160).`);
  else if (desc.length > 170) add('notice', 'description_long', `Meta description is long (${desc.length} characters).`);
  if (!h1.length) add('warning', 'h1_missing', 'No <h1> heading.');
  else if (h1.length > 1) add('notice', 'h1_multiple', `${h1.length} <h1> headings.`);
  if (!canonical) add('notice', 'canonical_missing', 'No canonical link.');
  else if (canonical.replace(/\/$/, '') !== url.href.replace(/[?#].*$/, '').replace(/\/$/, '') && canonical.replace(/\/$/, '') !== url.href.replace(/\/$/, '')) add('notice', 'canonical_other', `Canonical points to another URL: ${canonical}`);
  if (/noindex/.test(robotsMeta) || /noindex/.test(xRobots)) add('error', 'noindex', 'Page tells search engines not to index it (noindex).');
  if (/nofollow/.test(robotsMeta)) add('warning', 'nofollow_meta', 'Robots meta says nofollow.');
  if (!htmlTag.lang) add('notice', 'lang_missing', 'No lang attribute on <html>.');
  if (!meta.name.viewport) add('warning', 'viewport_missing', 'No viewport meta tag (page may not be mobile-friendly).');
  if (missingAlt.length) add('notice', 'img_alt_missing', `${missingAlt.length} of ${imgs.length} images have no alt text.`);
  if (words < 200 && res.status < 400) add('notice', 'thin_content', `Only about ${words} words of text.`);
  if (!og.length) add('notice', 'open_graph_missing', 'No Open Graph tags (links shared on social media will have no preview card).');
  if (!schemaTypes.length) add('notice', 'structured_data_missing', 'No schema.org JSON-LD structured data.');
  if (res.ms > 3000) add('warning', 'slow_response', `Server took ${(res.ms / 1000).toFixed(1)} s to respond.`);
  if (res.bytes > 3_000_000) add('warning', 'heavy_html', `HTML is ${(res.bytes / 1e6).toFixed(1)} MB.`);
  if (!favicon) add('notice', 'favicon_missing', 'No favicon link.');

  const weight = {error: 15, warning: 5, notice: 1};
  const score = Math.max(0, 100 - issues.reduce((s, i) => s + weight[i.severity], 0));
  return {
    score,
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    notices: issues.filter(i => i.severity === 'notice').length,
    issues,
    title, titleLength: title.length,
    metaDescription: desc || null, metaDescriptionLength: desc.length,
    h1, h2Count: h2.length, h2: h2.slice(0, 20),
    canonical, robotsMeta: robotsMeta || null, xRobotsTag: xRobots || null,
    lang: htmlTag.lang ?? null, hreflang,
    wordCount: words,
    images: imgs.length, imagesMissingAlt: missingAlt.length,
    internalLinks: internal, externalLinks: external, nofollowLinks: nofollow,
    openGraphTags: og, twitterCard: meta.name['twitter:card'] ?? meta.property['twitter:card'] ?? null,
    schemaTypes,
    https: url.protocol === 'https:',
    responseTimeMs: res.ms, htmlBytes: res.bytes
  };
}
