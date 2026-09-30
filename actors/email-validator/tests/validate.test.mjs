import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEmail, validate, mailServers} from '../src/validate.js';
import {DISPOSABLE, FREE_PROVIDERS} from '../src/lists.js';

const err = code => Object.assign(new Error(code), {code});
function resolver(map) {
  return {
    resolveMx: async d => { const v = map[d]; if (v === undefined) throw err('ENOTFOUND'); if (v === 'nomx' || v === 'nothing') throw err('ENODATA'); if (v === 'fail') throw err('ESERVFAIL'); return v; },
    resolve4: async d => { if (map[d] === 'nomx') return ['1.2.3.4']; throw err('ENODATA'); },
    resolve6: async () => { throw err('ENODATA'); }
  };
}
const R = resolver({
  'gmail.com': [{exchange: 'alt1.gmail-smtp-in.l.google.com', priority: 10}, {exchange: 'gmail-smtp-in.l.google.com', priority: 5}],
  'company.co.uk': [{exchange: 'mx.company.co.uk', priority: 10}], 'webonly.com': 'nomx', 'nothing.com': 'nothing',
  'nullmx.com': [{exchange: '', priority: 0}], 'mailinator.com': [{exchange: 'mail.mailinator.com', priority: 1}],
  'gmial.com': [{exchange: 'mx.gmial.com', priority: 1}], 'flaky.com': 'fail'
});

test('syntax', () => {
  assert.ok(parseEmail('John.Smith+tag@Company.CO.UK').ok);
  assert.equal(parseEmail('John.Smith+tag@Company.CO.UK').domain, 'company.co.uk');
  assert.equal(parseEmail('"Jo" <jo@gmail.com>').email, 'jo@gmail.com');
  assert.equal(parseEmail('mailto:a@b.io').email, 'a@b.io');
  for (const bad of ['plainaddress', '@no-local.com', 'a@', 'a..b@x.com', '.a@x.com', 'a.@x.com', 'a@x', 'a@-x.com', 'a b@x.com', 'a@x.c0m', 'a@x..com'])
    assert.equal(parseEmail(bad).ok, false, bad);
  assert.ok(parseEmail('user@bücher.de').ok);
});

test('valid, risky and invalid verdicts', async () => {
  const v = async e => (await validate(e, {resolver: R})).item;
  const g = await v('jane@gmail.com');
  assert.equal(g.verdict, 'valid'); assert.ok(g.freeProvider); assert.equal(g.mxRecords[0], 'gmail-smtp-in.l.google.com');
  assert.equal((await v('info@company.co.uk')).verdict, 'risky');
  assert.ok((await v('info@company.co.uk')).roleAccount);
  const d = await v('x@mailinator.com'); assert.equal(d.verdict, 'risky'); assert.ok(d.disposable);
  const t = await v('bob@gmial.com'); assert.equal(t.typoSuggestion, 'bob@gmail.com'); assert.equal(t.verdict, 'risky');
  assert.equal((await v('a@nullmx.com')).verdict, 'invalid');
  assert.equal((await v('a@nothing.com')).verdict, 'invalid');
  assert.equal((await v('a@doesnotexist-zz.com')).verdict, 'invalid');
  const w = await v('a@webonly.com'); assert.equal(w.verdict, 'valid'); assert.ok(w.reasons.some(r => /no MX/.test(r)));
  const bad = await validate('not-an-email', {resolver: R});
  assert.ok(bad.billable); assert.equal(bad.item.verdict, 'invalid'); assert.equal(bad.item.syntaxValid, false);
});

test('temporary DNS failure is unknown and free', async () => {
  const r = await validate('a@flaky.com', {resolver: R});
  assert.equal(r.billable, false); assert.equal(r.item.verdict, 'unknown');
});

test('domain lookups are cached', async () => {
  let n = 0;
  const cr = {resolveMx: async () => { n++; return [{exchange: 'mx.x.com', priority: 1}]; }};
  const cache = new Map();
  await Promise.all(['a@x.com', 'b@x.com', 'c@x.com'].map(e => validate(e, {resolver: cr, cache})));
  assert.equal(n, 1);
});

test('lists sane', () => {
  assert.ok(DISPOSABLE.size > 200); assert.ok(!DISPOSABLE.has('gmail.com')); assert.ok(FREE_PROVIDERS.has('gmail.com'));
  for (const d of FREE_PROVIDERS) assert.ok(!DISPOSABLE.has(d), d);
});
