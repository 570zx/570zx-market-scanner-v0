import dns from 'node:dns/promises';

export const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 's1', 's2', 'dkim', 'mail', 'smtp', 'mxvault', 'zoho', 'protonmail', 'protonmail2', 'fm1', 'fm2', 'fm3', 'mandrill', 'mailjet', 'sendgrid', 'smtpapi', 'amazonses', 'everlytickey1', 'cm', 'krs', 'hs1', 'hs2', 'pm', 'dk'];

export function normalizeDomain(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').split(/[/?#:]/)[0].replace(/\.$/, '');
  try { s = new URL('http://' + s).hostname; } catch { return null; }
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(s)) return null;
  return s;
}

const joinTxt = rec => rec.map(parts => parts.join(''));

async function txt(resolver, name) {
  try { return {ok: true, records: joinTxt(await resolver.resolveTxt(name))}; } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') return {ok: true, records: []};
    return {ok: false, error: e.code ?? e.message, records: []};
  }
}

export function parseSpf(record) {
  const terms = record.split(/\s+/).slice(1).filter(Boolean);
  const all = terms.find(t => /^[~?+-]?all$/i.test(t)) ?? null;
  const lookups = terms.filter(t => /^[~?+-]?(include|a|mx|ptr|exists|redirect)(?:[:=/]|$)/i.test(t)).length;
  const includes = terms.filter(t => /^[~?+-]?include:/i.test(t)).map(t => t.split(':')[1]);
  return {all, lookups, includes};
}

export function parseTags(record) {
  const out = {};
  for (const part of record.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim().toLowerCase()] = v.join('=').trim();
  }
  return out;
}

export async function checkDomain(raw, {resolver = dns, selectors = DKIM_SELECTORS} = {}) {
  const domain = normalizeDomain(raw);
  const base = {input: String(raw ?? ''), checkedAt: new Date().toISOString()};
  if (!domain) return {billable: false, item: {...base, status: 'invalid_domain', error: 'Not a valid domain name'}};
  const issues = [];
  const add = (severity, code, message) => issues.push({severity, code, message});

  // Does the domain exist at all?
  let ns = [];
  try { ns = await resolver.resolveNs(domain); } catch (e) {
    if (e.code === 'ENOTFOUND') return {billable: true, item: {...base, domain, status: 'ok', exists: false, grade: 'F', issues: [{severity: 'error', code: 'no_domain', message: 'Domain does not exist in DNS.'}]}};
    if (e.code !== 'ENODATA') return {billable: false, item: {...base, domain, status: 'dns_error', error: `DNS lookup failed (${e.code ?? e.message})`}};
  }

  let mx = [];
  try { mx = (await resolver.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map(m => ({host: m.exchange, priority: m.priority})); } catch {}
  const nullMx = mx.length === 1 && (mx[0].host === '' || mx[0].host === '.');
  const provider = mailProvider(mx.map(m => m.host));

  // SPF
  const root = await txt(resolver, domain);
  const spfRecords = root.records.filter(r => /^v=spf1(\s|$)/i.test(r));
  let spf = null;
  if (spfRecords.length === 0) add(nullMx ? 'notice' : 'error', 'spf_missing', 'No SPF record: anyone can send email that claims to come from this domain.');
  else if (spfRecords.length > 1) add('error', 'spf_multiple', 'More than one SPF record: receivers treat this as a permanent error.');
  if (spfRecords.length) {
    spf = {record: spfRecords[0], ...parseSpf(spfRecords[0])};
    if (!spf.all) add('warning', 'spf_no_all', 'SPF has no "all" mechanism at the end.');
    else if (/^\+?all$/i.test(spf.all)) add('error', 'spf_pass_all', 'SPF ends in +all, which allows every server in the world to send as this domain.');
    else if (/^\?all$/i.test(spf.all)) add('warning', 'spf_neutral', 'SPF ends in ?all (neutral), which gives no protection.');
    if (spf.lookups > 10) add('error', 'spf_too_many_lookups', `SPF needs about ${spf.lookups} DNS lookups at the top level; the limit is 10.`);
  }

  // DMARC
  const dm = await txt(resolver, `_dmarc.${domain}`);
  const dmarcRecords = dm.records.filter(r => /^v=DMARC1/i.test(r));
  let dmarc = null;
  if (!dmarcRecords.length) add('error', 'dmarc_missing', 'No DMARC record: receivers get no instruction for mail that fails SPF/DKIM, and you get no reports.');
  else {
    const t = parseTags(dmarcRecords[0]);
    dmarc = {record: dmarcRecords[0], policy: t.p ?? null, subdomainPolicy: t.sp ?? null, pct: t.pct ? Number(t.pct) : 100, rua: t.rua ?? null, ruf: t.ruf ?? null, adkim: t.adkim ?? 'r', aspf: t.aspf ?? 'r'};
    if (dmarcRecords.length > 1) add('error', 'dmarc_multiple', 'More than one DMARC record.');
    if (!['none', 'quarantine', 'reject'].includes(dmarc.policy)) add('error', 'dmarc_bad_policy', 'DMARC policy (p=) missing or invalid.');
    else if (dmarc.policy === 'none') add('warning', 'dmarc_monitor_only', 'DMARC policy is p=none (monitoring only): spoofed mail is still delivered.');
    if (dmarc.pct < 100 && dmarc.policy !== 'none') add('notice', 'dmarc_partial', `DMARC applies to only ${dmarc.pct}% of mail.`);
    if (!dmarc.rua) add('notice', 'dmarc_no_reports', 'DMARC has no rua= address, so no aggregate reports are collected.');
  }

  // DKIM (common selectors only: a domain's selectors cannot be listed from DNS)
  const dkimFound = [];
  await Promise.all(selectors.map(async sel => {
    const r = await txt(resolver, `${sel}._domainkey.${domain}`);
    const rec = r.records.find(x => /v=DKIM1|k=rsa|k=ed25519|p=/i.test(x));
    if (rec) {
      const t = parseTags(rec);
      dkimFound.push({selector: sel, revoked: t.p === '', keyType: t.k ?? 'rsa', approxKeyBits: t.p ? approxRsaBits(t.p) : null});
    }
  }));
  dkimFound.sort((a, b) => a.selector.localeCompare(b.selector));
  if (!dkimFound.length && !nullMx) add('notice', 'dkim_not_found', `No DKIM key found under ${selectors.length} common selector names (the domain may use a custom selector).`);
  if (dkimFound.some(d => d.approxKeyBits && d.approxKeyBits < 1024 && d.keyType === 'rsa')) add('warning', 'dkim_weak_key', 'A DKIM key is shorter than 1024 bits.');

  // MTA-STS, TLS-RPT, BIMI
  const sts = (await txt(resolver, `_mta-sts.${domain}`)).records.find(r => /^v=STSv1/i.test(r)) ?? null;
  const tlsrpt = (await txt(resolver, `_smtp._tls.${domain}`)).records.find(r => /^v=TLSRPTv1/i.test(r)) ?? null;
  const bimi = (await txt(resolver, `default._bimi.${domain}`)).records.find(r => /^v=BIMI1/i.test(r)) ?? null;

  if (!mx.length) add('notice', 'no_mx', 'No MX record: the domain does not receive email.');
  if (nullMx) add('notice', 'null_mx', 'Null MX: the domain states it never receives email.');

  const errors = issues.filter(i => i.severity === 'error').length, warnings = issues.filter(i => i.severity === 'warning').length;
  const grade = errors >= 2 ? 'F' : errors === 1 ? 'D' : warnings >= 2 ? 'C' : warnings === 1 ? 'B' : 'A';
  return {billable: true, item: {...base, domain, status: 'ok', exists: true, grade, errors, warnings, issues,
    mailProvider: provider, mx, nullMx, nameservers: ns.sort(),
    spfRecord: spf?.record ?? null, spfAll: spf?.all ?? null, spfLookups: spf?.lookups ?? null, spfIncludes: spf?.includes ?? [],
    dmarcRecord: dmarc?.record ?? null, dmarcPolicy: dmarc?.policy ?? null, dmarcPct: dmarc?.pct ?? null, dmarcReportsTo: dmarc?.rua ?? null,
    dkimSelectorsFound: dkimFound.map(d => d.selector), dkim: dkimFound,
    mtaSts: Boolean(sts), tlsRpt: Boolean(tlsrpt), bimi: bimi}};
}

// RSA public key in DKIM is base64 DER SubjectPublicKeyInfo; modulus size is ~ (DER bytes - 38) * 8 for common sizes.
export function approxRsaBits(b64) {
  const n = Buffer.from(b64, 'base64').length;
  for (const bits of [512, 768, 1024, 2048, 3072, 4096]) if (n <= bits / 8 + 60) return bits;
  return n * 8;
}

export function mailProvider(hosts) {
  const h = hosts.join(' ').toLowerCase();
  const map = [[/google\.com|googlemail\.com/, 'Google Workspace'], [/outlook\.com|protection\.outlook/, 'Microsoft 365'], [/pphosted\.com/, 'Proofpoint'],
    [/mimecast/, 'Mimecast'], [/zoho/, 'Zoho Mail'], [/protonmail/, 'Proton Mail'], [/messagingengine\.com/, 'Fastmail'], [/secureserver\.net/, 'GoDaddy'],
    [/yahoodns|yahoo\.com/, 'Yahoo'], [/icloud\.com/, 'iCloud'], [/mx\.cloudflare\.net/, 'Cloudflare Email Routing'], [/improvmx/, 'ImprovMX'],
    [/barracudanetworks/, 'Barracuda'], [/amazonaws\.com|amazonses/, 'Amazon SES / WorkMail'], [/ovh\.net/, 'OVH'], [/ionos|1and1/, 'IONOS'],
    [/mailgun/, 'Mailgun'], [/sendgrid/, 'SendGrid'], [/yandex/, 'Yandex'], [/hostinger/, 'Hostinger'], [/namecheap|privateemail/, 'Namecheap']];
  for (const [re, name] of map) if (re.test(h)) return name;
  return hosts.length ? 'Other / self-hosted' : null;
}
