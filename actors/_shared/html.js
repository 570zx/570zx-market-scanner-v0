// Shared by the web tools. A small, dependency-free HTML reader: enough for tags, attributes and element text.
// Not a full parser: it is tolerant of messy markup and never throws.

const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'};
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export const squashSpace = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// Remove comments, and the contents of script/style/noscript/template/svg (kept separately where needed).
export function stripNonContent(html) {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

export function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in attrs)) attrs[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// All start tags with the given names (lowercase), in document order: [{name, attrs, index}]
export function findTags(html, names) {
  const want = new Set(names.map(n => n.toLowerCase()));
  const out = [];
  const re = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].toLowerCase();
    if (want.has(name)) out.push({name, attrs: parseAttrs(m[2]), index: m.index});
  }
  return out;
}

export const textFromHtml = frag => squashSpace(decodeEntities(String(frag ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')));

// Text of each element with the given tag name (non-nested use: headings, title, a, button).
export function elementTexts(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)</${name}\\s*>`, 'gi');
  let m;
  while ((m = re.exec(html))) out.push({attrs: parseAttrs(m[1]), text: textFromHtml(m[2]), html: m[2]});
  return out;
}

// JSON-LD blocks, parsed. Invalid JSON is reported, not thrown.
export function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html ?? '')))) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try { out.push({ok: true, data: JSON.parse(raw)}); } catch (e) { out.push({ok: false, error: e.message, raw: raw.slice(0, 300)}); }
  }
  return out;
}

// Flatten JSON-LD into typed nodes (handles @graph and arrays).
export function jsonLdNodes(blocks) {
  const nodes = [];
  const walk = x => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (x['@graph']) walk(x['@graph']);
    if (x['@type']) nodes.push(x);
  };
  for (const b of blocks) if (b.ok) walk(b.data);
  return nodes;
}

export const typesOf = node => [].concat(node?.['@type'] ?? []).map(String);

export function metaTags(html) {
  const out = {name: {}, property: {}};
  for (const t of findTags(html, ['meta'])) {
    const c = t.attrs.content;
    if (c == null) continue;
    if (t.attrs.name) out.name[t.attrs.name.toLowerCase()] ??= c;
    if (t.attrs.property) out.property[t.attrs.property.toLowerCase()] ??= c;
    if (t.attrs.itemprop) out.name['itemprop:' + t.attrs.itemprop.toLowerCase()] ??= c;
  }
  return out;
}

export function absolutize(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}
