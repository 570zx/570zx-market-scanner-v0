import dns from 'node:dns/promises';
import {DISPOSABLE, FREE_PROVIDERS, ROLE_PREFIXES, TYPOS} from './lists.js';

// Practical address syntax (RFC 5321/5322 subset that real mail systems accept).
const LOCAL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}(?<!\.)$/;
const LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;

export function parseEmail(raw) {
  let s = String(raw ?? '').trim().replace(/^mailto:/i, '');
  const angle = /<([^<>]+)>\s*$/.exec(s);
  if (angle) s = angle[1].trim();
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return {ok: false, reason: 'missing @ or empty part', input: String(raw ?? '')};
  const local = s.slice(0, at), domainRaw = s.slice(at + 1).replace(/\.$/, '');
  let domain;
  try { domain = new URL(`http://${domainRaw}`).hostname; } catch { return {ok: false, reason: 'invalid domain', input: String(raw ?? '')}; }
  if (domain !== domainRaw.toLowerCase() && !/^xn--/.test(domain.split('.').find(p => p.startsWith('xn--')) ?? '')) {
    // punycode conversion of an international domain is fine; anything else changed means it was invalid
    if (!/[^\x00-\x7f]/.test(domainRaw)) return {ok: false, reason: 'invalid domain', input: String(raw ?? '')};
  }
  if (!LOCAL.test(local)) return {ok: false, reason: 'invalid characters or dots in the part before @', input: String(raw ?? '')};
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every(l => LABEL.test(l)) || !/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1))) return {ok: false, reason: 'invalid domain', input: String(raw ?? '')};
  if (s.length > 254) return {ok: false, reason: 'address too long', input: String(raw ?? '')};
  return {ok: true, local, domain, email: `${local}@${domain}`};
}

export async function mailServers(domain, resolver = dns) {
  try {
    const mx = await resolver.resolveMx(domain);
    const nullMx = mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.');
    return {state: nullMx ? 'null_mx' : mx.length ? 'mx' : 'none', mx: mx.sort((a, b) => a.priority - b.priority).map(m => m.exchange)};
  } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') {
      if (e.code === 'ENOTFOUND') return {state: 'no_domain', mx: []};
      // No MX: mail falls back to the domain's A/AAAA record (RFC 5321 section 5.1).
      try { const a = await resolver.resolve4(domain); if (a.length) return {state: 'a_fallback', mx: [domain]}; } catch {}
      try { const a6 = await resolver.resolve6(domain); if (a6.length) return {state: 'a_fallback', mx: [domain]}; } catch {}
      return {state: 'none', mx: []};
    }
    const err = new Error(`DNS lookup failed (${e.code ?? e.message})`); err.transient = true; throw err;
  }
}

export function suggestion(domain) {
  return TYPOS[domain] ?? null;
}

// -> {billable, item}
export async function validate(raw, {resolver = dns, cache = new Map()} = {}) {
  const p = parseEmail(raw);
  const base = {input: String(raw ?? ''), checkedAt: new Date().toISOString()};
  if (!p.ok) return {billable: true, item: {...base, status: 'ok', email: null, verdict: 'invalid', syntaxValid: false, reasons: [p.reason]}};
  const {local, domain, email} = p;
  if (!cache.has(domain)) cache.set(domain, mailServers(domain, resolver));
  let ms;
  try { ms = await cache.get(domain); } catch (e) {
    cache.delete(domain);
    return {billable: false, item: {...base, email, status: 'dns_error', verdict: 'unknown', error: e.message}};
  }
  const disposable = DISPOSABLE.has(domain) || [...DISPOSABLE].some(d => domain.endsWith('.' + d));
  const role = ROLE_PREFIXES.has(local.toLowerCase().split('+')[0]);
  const free = FREE_PROVIDERS.has(domain);
  const typo = suggestion(domain);
  const reasons = [];
  let verdict = 'valid';
  if (ms.state === 'no_domain') { verdict = 'invalid'; reasons.push('domain does not exist'); }
  else if (ms.state === 'null_mx') { verdict = 'invalid'; reasons.push('domain declares it accepts no email (null MX)'); }
  else if (ms.state === 'none') { verdict = 'invalid'; reasons.push('domain has no mail server'); }
  if (verdict !== 'invalid') {
    if (disposable) { verdict = 'risky'; reasons.push('disposable (throwaway) email provider'); }
    if (typo) { verdict = 'risky'; reasons.push(`possible typo, did you mean ${local}@${typo}?`); }
    if (role) { if (verdict === 'valid') verdict = 'risky'; reasons.push('role address (shared inbox such as info@ or sales@)'); }
    if (ms.state === 'a_fallback') reasons.push('no MX record; mail would go to the domain\'s web server address');
  }
  return {billable: true, item: {...base, status: 'ok', email, verdict, syntaxValid: true, reasons,
    domain, localPart: local, mailServer: ms.state === 'mx' || ms.state === 'a_fallback', mxRecords: ms.mx.slice(0, 5), nullMx: ms.state === 'null_mx',
    disposable, freeProvider: free, roleAccount: role, typoSuggestion: typo ? `${local}@${typo}` : null}};
}
