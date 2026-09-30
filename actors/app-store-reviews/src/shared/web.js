// Shared by the web tools. Copied into each Actor's src/shared/ by actors/sync-shared.sh (the CI checks the copies match).
// Polite fetching: identifies itself, respects robots.txt, caps page size, times out, retries only on transient errors.

export const USER_AGENT = 'Mozilla/5.0 (compatible; DodgeBotTools/1.0; +https://apify.com/Dodge_Bot)';
export const ROBOTS_AGENT = 'DodgeBotTools';

export function normalizeUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

// Accepts an array of strings, an array of {url} objects (Apify requestListSources), or a text blob.
export function readUrls(input, key = 'urls', max = 10000) {
  const raw = input?.[key];
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/);
  const seen = new Set(), out = [], invalid = [];
  for (const x of list) {
    const v = typeof x === 'object' && x ? x.url : x;
    if (v == null || String(v).trim() === '') continue;
    const n = normalizeUrl(v);
    if (!n) { invalid.push(String(v)); continue; }
    if (seen.has(n)) continue;
    seen.add(n); out.push(n);
  }
  return {urls: out.slice(0, max), invalid, overLimit: Math.max(0, out.length - max)};
}

// ---- robots.txt (RFC 9309): groups by user-agent, longest match wins, Allow wins ties, * and $ wildcards.
export function parseRobots(text) {
  const groups = [], sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (let line of String(text ?? '').split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = {agents: [], rules: []}; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'disallow' && val === '') continue; // empty Disallow = allow all
      cur.rules.push({allow: key === 'allow', path: val});
    } else if (key === 'sitemap') {
      if (val) sitemaps.push(val);
    } else {
      lastWasAgent = false;
    }
  }
  return {groups, sitemaps};
}

function ruleRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function robotsAllows(robots, agent, pathWithQuery) {
  if (!robots) return true;
  const a = agent.toLowerCase();
  let group = robots.groups.filter(g => g.agents.some(x => x !== '*' && a.includes(x)));
  if (!group.length) group = robots.groups.filter(g => g.agents.includes('*'));
  if (!group.length) return true;
  const rules = group.flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    if (!ruleRegex(r.path).test(pathWithQuery)) continue;
    const len = r.path.replace(/[*$]/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = {len, allow: r.allow};
  }
  return best ? best.allow : true;
}

// ---- fetching
export class Fetcher {
  constructor({fetchImpl = fetch, timeoutMs = 30000, maxBytes = 5_000_000, retries = 2, respectRobots = true, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
    Object.assign(this, {fetchImpl, timeoutMs, maxBytes, retries, respectRobots, sleep});
    this.robotsCache = new Map();
  }

  async robotsFor(origin) {
    if (!this.robotsCache.has(origin)) {
      this.robotsCache.set(origin, (async () => {
        try {
          const r = await this.get(`${origin}/robots.txt`, {skipRobots: true, maxBytes: 500_000, retries: 1});
          if (r.status >= 200 && r.status < 300) return parseRobots(r.body);
          if (r.status === 401 || r.status === 403) return {groups: [{agents: ['*'], rules: [{allow: false, path: '/'}]}], sitemaps: []};
          return null; // 404 or other: no restrictions
        } catch {
          return null;
        }
      })());
    }
    return this.robotsCache.get(origin);
  }

  async allowed(url) {
    if (!this.respectRobots) return true;
    const u = new URL(url);
    return robotsAllows(await this.robotsFor(u.origin), ROBOTS_AGENT, u.pathname + u.search);
  }

  // Returns {url, finalUrl, status, headers, contentType, body, bytes, truncated, ms, redirected}
  async get(url, {skipRobots = false, maxBytes = this.maxBytes, retries = this.retries, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', binary = false} = {}) {
    if (!skipRobots && !(await this.allowed(url))) {
      const e = new Error('Blocked by the site\'s robots.txt'); e.code = 'ROBOTS'; throw e;
    }
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const t0 = Date.now();
      try {
        const res = await this.fetchImpl(url, {redirect: 'follow', headers: {'user-agent': USER_AGENT, accept, 'accept-language': 'en;q=0.9,*;q=0.5'}, signal: AbortSignal.timeout(this.timeoutMs)});
        if ((res.status === 429 || res.status >= 500) && attempt < retries) { last = new Error(`HTTP ${res.status}`); await this.sleep(1000 * 2 ** attempt); continue; }
        const {buf, truncated} = await readCapped(res, maxBytes);
        const headers = {};
        res.headers?.forEach?.((v, k) => { headers[k.toLowerCase()] = v; });
        const contentType = headers['content-type'] ?? '';
        return {url, finalUrl: res.url || url, redirected: Boolean(res.redirected) || (res.url && res.url !== url), status: res.status, headers, contentType,
          body: binary ? buf : decode(buf, contentType), bytes: buf.length, truncated, ms: Date.now() - t0};
      } catch (e) {
        last = e;
        if (attempt < retries) await this.sleep(1000 * 2 ** attempt);
      }
    }
    const e = new Error(`Could not load the page: ${last?.name === 'TimeoutError' ? 'timed out' : last?.message ?? last}`); e.code = 'FETCH'; throw e;
  }
}

async function readCapped(res, maxBytes) {
  if (!res.body?.getReader) {
    const ab = Buffer.from(await res.arrayBuffer());
    return ab.length > maxBytes ? {buf: ab.subarray(0, maxBytes), truncated: true} : {buf: ab, truncated: false};
  }
  const reader = res.body.getReader(), chunks = [];
  let n = 0, truncated = false;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { chunks.push(value.subarray(0, value.length - (n - maxBytes))); truncated = true; try { await reader.cancel(); } catch {} break; }
    chunks.push(value);
  }
  return {buf: Buffer.concat(chunks.map(c => Buffer.from(c))), truncated};
}

function decode(buf, contentType) {
  let cs = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, '').toLowerCase();
  if (!cs) {
    const head = buf.subarray(0, 2048).toString('latin1');
    cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

export const isHtml = ct => /text\/html|application\/xhtml/i.test(ct || '') || !ct;

// Run fn over items with limited concurrency, in order of completion; stop() halts new work.
export async function pool(items, concurrency, fn) {
  let i = 0, stopped = false;
  const stop = () => { stopped = true; };
  const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (!stopped && i < items.length) { const idx = i++; await fn(items[idx], idx, stop); }
  });
  await Promise.all(workers);
}
