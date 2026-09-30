import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDomain, normalizeDomain, parseSpf, parseTags, mailProvider, approxRsaBits} from '../src/check.js';

const err = code => Object.assign(new Error(code), {code});
const key2048 = Buffer.alloc(294, 1).toString('base64');
function R(zone) {
  const get = (name, type) => { const v = zone[`${type} ${name}`]; if (v === undefined) throw err(zone[`nx ${name.split('.').slice(-2).join('.')}`] ? 'ENOTFOUND' : 'ENODATA'); if (v === 'FAIL') throw err('ESERVFAIL'); return v; };
  return {resolveNs: async n => get(n, 'NS'), resolveMx: async n => get(n, 'MX'), resolveTxt: async n => get(n, 'TXT')};
}

test('helpers', () => {
  assert.equal(normalizeDomain('https://www.Example.COM/path'), 'www.example.com');
  assert.equal(normalizeDomain('bob@company.co.uk'), 'company.co.uk');
  assert.equal(normalizeDomain('not a domain'), null);
  assert.deepEqual(parseSpf('v=spf1 include:_spf.google.com include:sendgrid.net a mx ~all'), {all: '~all', lookups: 4, includes: ['_spf.google.com', 'sendgrid.net']});
  assert.equal(parseTags('v=DMARC1; p=reject; rua=mailto:d@x.com').p, 'reject');
  assert.equal(mailProvider(['aspmx.l.google.com']), 'Google Workspace');
  assert.equal(mailProvider([]), null);
  assert.equal(approxRsaBits(key2048), 2048);
});

test('well configured domain gets A', async () => {
  const r = R({
    'NS good.com': ['ns1.x.net'], 'MX good.com': [{exchange: 'aspmx.l.google.com', priority: 1}],
    'TXT good.com': [['v=spf1 include:_spf.google.com -all'], ['google-site-verification=abc']],
    'TXT _dmarc.good.com': [['v=DMARC1; p=reject; rua=mailto:dmarc@good.com']],
    'TXT google._domainkey.good.com': [['v=DKIM1; k=rsa; p=', key2048]],
    'TXT _mta-sts.good.com': [['v=STSv1; id=1']]
  });
  const {item} = await checkDomain('good.com', {resolver: R && r, selectors: ['google', 'selector1']});
  assert.equal(item.grade, 'A', JSON.stringify(item.issues));
  assert.equal(item.mailProvider, 'Google Workspace'); assert.equal(item.dmarcPolicy, 'reject'); assert.deepEqual(item.dkimSelectorsFound, ['google']);
  assert.equal(item.dkim[0].approxKeyBits, 2048); assert.ok(item.mtaSts);
});

test('weak domain: no DMARC, +all SPF', async () => {
  const r = R({'NS weak.com': ['ns'], 'MX weak.com': [{exchange: 'mx.weak.com', priority: 10}], 'TXT weak.com': [['v=spf1 +all']]});
  const {item} = await checkDomain('weak.com', {resolver: r, selectors: ['default']});
  const codes = item.issues.map(i => i.code);
  for (const c of ['spf_pass_all', 'dmarc_missing', 'dkim_not_found']) assert.ok(codes.includes(c), c);
  assert.equal(item.grade, 'F');
});

test('p=none and missing SPF', async () => {
  const r = R({'NS m.com': ['ns'], 'MX m.com': [{exchange: 'mx.m.com', priority: 10}], 'TXT _dmarc.m.com': [['v=DMARC1; p=none']]});
  const {item} = await checkDomain('m.com', {resolver: r, selectors: []});
  const codes = item.issues.map(i => i.code);
  assert.ok(codes.includes('spf_missing') && codes.includes('dmarc_monitor_only') && codes.includes('dmarc_no_reports'));
});

test('nonexistent domain is charged (it is an answer); DNS outage and junk input are free', async () => {
  const nx = await checkDomain('gone.com', {resolver: R({'nx gone.com': true}), selectors: []});
  assert.ok(nx.billable); assert.equal(nx.item.exists, false); assert.equal(nx.item.grade, 'F');
  const out = await checkDomain('x.com', {resolver: R({'NS x.com': 'FAIL'}), selectors: []});
  assert.ok(!out.billable); assert.equal(out.item.status, 'dns_error');
  assert.ok(!(await checkDomain('???')).billable);
});
