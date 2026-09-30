// RDAP: the registries' official, machine-readable successor to WHOIS (RFC 9082/9083).
// The IANA bootstrap file says which RDAP server serves each top-level domain.

export const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

export function normalizeDomain(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').split(/[/?#:]/)[0].replace(/\.$/, '');
  try { s = new URL('http://' + s).hostname; } catch { return null; }
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(s)) return null;
  return s;
}

// Map of tld (or multi-label suffix) -> base URL (with trailing slash)
export function parseBootstrap(json) {
  const map = new Map();
  for (const [suffixes, urls] of json.services ?? []) {
    const url = urls.find(u => u.startsWith('https://')) ?? urls[0];
    if (!url) continue;
    for (const s of suffixes) map.set(s.toLowerCase(), url.endsWith('/') ? url : url + '/');
  }
  return map;
}

// Registrable domain guess: the RDAP server is chosen by the longest matching suffix; the queried name
// is that suffix plus one label (so www.example.co.uk -> example.co.uk when "co.uk"... is not in bootstrap, we use tld).
export function serverFor(domain, map) {
  const labels = domain.split('.');
  for (let i = 1; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (map.has(suffix)) return {base: map.get(suffix), suffix};
  }
  return null;
}

// Strip subdomains using a small list of common second-level public suffixes; otherwise keep the last two labels.
const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'com.br', 'com.mx', 'co.jp', 'co.in', 'co.kr', 'com.cn', 'com.tr', 'com.sg', 'com.my', 'co.id', 'com.ar', 'co.il', 'com.hk', 'com.tw']);
export function registrable(domain) {
  const l = domain.split('.');
  if (l.length <= 2) return domain;
  const last2 = l.slice(-2).join('.');
  return SECOND_LEVEL.has(last2) ? l.slice(-3).join('.') : last2;
}

const vcardValue = (entity, field) => {
  const props = entity?.vcardArray?.[1] ?? [];
  const p = props.find(x => x[0] === field);
  if (!p) return null;
  const v = p[3];
  return Array.isArray(v) ? v.filter(Boolean).join(' ') : v ?? null;
};

function findEntities(entities, role, out = []) {
  for (const e of entities ?? []) {
    if ((e.roles ?? []).includes(role)) out.push(e);
    findEntities(e.entities, role, out);
  }
  return out;
}

export function summarize(domain, json, now = new Date()) {
  const event = action => json.events?.find(e => e.eventAction === action)?.eventDate ?? null;
  const expires = event('expiration');
  const registrar = findEntities(json.entities, 'registrar')[0];
  const abuse = findEntities(registrar?.entities ?? json.entities, 'abuse')[0];
  const ianaId = registrar?.publicIds?.find(p => /IANA/i.test(p.type))?.identifier ?? null;
  const created = event('registration');
  return {
    domain, status: 'ok', registered: true,
    ldhName: json.ldhName?.toLowerCase() ?? domain,
    registrar: vcardValue(registrar, 'fn') ?? registrar?.handle ?? null, registrarIanaId: ianaId,
    abuseEmail: vcardValue(abuse, 'email'), abusePhone: vcardValue(abuse, 'tel'),
    createdDate: created, updatedDate: event('last changed'), expiryDate: expires,
    daysUntilExpiry: expires ? Math.floor((new Date(expires) - now) / 86400000) : null,
    ageYears: created ? Math.floor((now - new Date(created)) / (365.25 * 86400000) * 10) / 10 : null,
    statuses: json.status ?? [],
    nameservers: (json.nameservers ?? []).map(n => (n.ldhName ?? '').toLowerCase()).filter(Boolean).sort(),
    dnssec: json.secureDNS?.delegationSigned ?? null
  };
}
