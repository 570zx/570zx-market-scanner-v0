import {SIGNATURES} from './signatures.js';

// Pull the pieces of a page the signatures look at. Regex scanning is enough here: we only need
// attribute values and the generator tag, not a full DOM.
export function pageParts(html) {
  const h = String(html ?? '');
  const srcs = [];
  for (const m of h.matchAll(/<(?:script|link|img|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) srcs.push(m[1]);
  const generators = [];
  for (const m of h.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (/name\s*=\s*["']generator["']/i.test(tag)) {
      const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
      if (c) generators.push(c[1]);
    }
  }
  return {html: h, srcs, generators};
}

export function cookieNames(setCookie) {
  // fetch joins multiple Set-Cookie headers with ", "; a cookie name is the token before "=" at the start of each cookie.
  const names = [];
  for (const part of String(setCookie ?? '').split(/,(?=\s*[^;=\s]+=)/)) {
    const n = part.trim().split('=')[0];
    if (n) names.push(n.trim());
  }
  return names;
}

export function detect({headers = {}, html = ''}) {
  const {srcs, generators} = pageParts(html);
  const cookies = cookieNames(headers['set-cookie']);
  const found = new Map();
  const add = (sig, evidence, version) => {
    const cur = found.get(sig.name) ?? {name: sig.name, category: sig.cat, version: null, evidence: []};
    if (version && !cur.version) cur.version = version;
    if (!cur.evidence.includes(evidence)) cur.evidence.push(evidence);
    found.set(sig.name, cur);
  };
  for (const sig of SIGNATURES) {
    if (sig.header) for (const [k, re] of Object.entries(sig.header)) {
      const v = headers[k];
      if (v == null) continue;
      const m = re.exec(v);
      if (m) add(sig, `header ${k}`, m[1]);
    }
    if (sig.meta) for (const g of generators) { const m = sig.meta.exec(g); if (m) add(sig, 'meta generator', m[1]); }
    if (sig.src) for (const s of srcs) { const m = sig.src.exec(s); if (m) { add(sig, 'asset URL', m[1]); break; } }
    if (sig.html) { const m = sig.html.exec(html); if (m) add(sig, 'page markup', m[1]); }
    if (sig.cookie) for (const c of cookies) if (sig.cookie.test(c)) { add(sig, 'cookie'); break; }
  }
  // Implied technologies (for example Next.js implies React).
  for (const sig of SIGNATURES) {
    if (!found.has(sig.name) || !sig.implies) continue;
    for (const imp of sig.implies) {
      const target = SIGNATURES.find(s => s.name === imp);
      if (target && !found.has(imp)) found.set(imp, {name: imp, category: target.cat, version: null, evidence: [`implied by ${sig.name}`]});
    }
  }
  const list = [...found.values()].map(t => ({...t, confidence: t.evidence.some(e => e.startsWith('implied')) ? 'medium' : (t.evidence.length > 1 || t.evidence[0].startsWith('header') || t.evidence[0] === 'meta generator') ? 'high' : 'medium'}));
  list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return list;
}

export function summarize(techs) {
  const byCategory = {};
  for (const t of techs) (byCategory[t.category] ??= []).push(t.name);
  const pick = (...cats) => techs.find(t => cats.includes(t.category))?.name ?? null;
  return {
    technologyCount: techs.length,
    technologyNames: techs.map(t => t.name),
    byCategory,
    cms: pick('CMS', 'Website builder', 'Headless CMS'),
    ecommerce: pick('E-commerce'),
    framework: pick('JavaScript framework', 'Static site generator'),
    hosting: pick('Hosting'),
    cdn: pick('CDN'),
    analytics: techs.filter(t => t.category === 'Analytics').map(t => t.name)
  };
}
