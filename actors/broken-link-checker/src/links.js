import {stripNonContent, findTags, elementTexts, absolutize} from './shared/html.js';
import {USER_AGENT} from './shared/web.js';

// Links on a page: [{url, text, kind: 'link'|'image'|'script'|'stylesheet', internal}]
export function extractLinks(html, pageUrl, {includeAssets = false} = {}) {
  const clean = stripNonContent(html);
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const out = new Map();
  const add = (href, text, kind) => {
    if (!href || /^(?:#|javascript:|mailto:|tel:|data:|sms:|about:)/i.test(href.trim())) return;
    const abs = absolutize(href.trim(), pageUrl);
    if (!abs || !/^https?:/i.test(abs)) return;
    const u = new URL(abs); u.hash = '';
    const key = u.href;
    if (!out.has(key)) out.set(key, {url: key, text: (text ?? '').slice(0, 200), kind, internal: u.hostname.replace(/^www\./, '') === host});
  };
  for (const a of elementTexts(clean, 'a')) add(a.attrs.href, a.text || a.attrs.title || a.attrs['aria-label'] || '', 'link');
  if (includeAssets) {
    for (const t of findTags(clean, ['img'])) add(t.attrs.src, t.attrs.alt ?? '', 'image');
    for (const t of findTags(String(html), ['script'])) if (t.attrs.src) add(t.attrs.src, '', 'script');
    for (const t of findTags(clean, ['link'])) if (/stylesheet/i.test(t.attrs.rel ?? '')) add(t.attrs.href, '', 'stylesheet');
  }
  return [...out.values()];
}

// Per-host concurrency limit so we never hammer one site.
export class HostLimiter {
  constructor(perHost = 2) { this.perHost = perHost; this.active = new Map(); this.waiting = new Map(); }
  async run(host, fn) {
    while ((this.active.get(host) ?? 0) >= this.perHost) await new Promise(r => { const q = this.waiting.get(host) ?? []; q.push(r); this.waiting.set(host, q); });
    this.active.set(host, (this.active.get(host) ?? 0) + 1);
    try { return await fn(); } finally {
      this.active.set(host, this.active.get(host) - 1);
      const q = this.waiting.get(host); if (q?.length) q.shift()();
    }
  }
}

const TRANSIENT = new Set([429, 502, 503, 504]);

// Check one URL: HEAD first, GET if HEAD is refused. -> {httpStatus, finalUrl, redirected, broken, error}
export async function checkUrl(url, {fetchImpl = fetch, timeoutMs = 20000, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const attempt = async method => {
    const res = await fetchImpl(url, {method, redirect: 'follow', headers: {'user-agent': USER_AGENT, accept: '*/*'}, signal: AbortSignal.timeout(timeoutMs)});
    if (method === 'GET') { try { await res.body?.cancel?.(); } catch {} }
    return res;
  };
  let res, lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      res = await attempt('HEAD');
      if ([403, 405, 400, 501].includes(res.status) || res.status >= 500) res = await attempt('GET');
      if (TRANSIENT.has(res.status) && i < 2) { await sleep(1500 * (i + 1)); continue; }
      break;
    } catch (e) {
      lastErr = e;
      if (i < 2) await sleep(1000 * (i + 1));
    }
  }
  if (!res) {
    const msg = lastErr?.name === 'TimeoutError' ? 'timed out' : lastErr?.cause?.code ?? lastErr?.message ?? 'failed';
    return {httpStatus: null, finalUrl: null, redirected: false, broken: true, error: msg};
  }
  const finalUrl = res.url || url;
  return {httpStatus: res.status, finalUrl, redirected: finalUrl !== url, broken: res.status >= 400, error: null};
}
