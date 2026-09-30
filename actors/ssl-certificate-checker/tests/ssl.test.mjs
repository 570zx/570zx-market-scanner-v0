import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTarget, analyse} from '../src/ssl.js';

const now = new Date('2026-09-30T12:00:00Z');
const cert = (over = {}) => ({subject: {CN: 'example.com'}, issuer: {O: "Let's Encrypt", CN: 'R11'}, subjectaltname: 'DNS:example.com, DNS:www.example.com',
  valid_from: 'Aug  1 00:00:00 2026 GMT', valid_to: 'Dec 30 00:00:00 2026 GMT', bits: 2048, serialNumber: 'AB', fingerprint256: 'FP', ...over});
const conn = (over = {}) => ({cert: cert(), authorized: true, authorizationError: null, protocol: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', handshakeMs: 50, ...over});

test('parseTarget', () => {
  assert.deepEqual(parseTarget('example.com'), {host: 'example.com', port: 443});
  assert.deepEqual(parseTarget('https://mail.example.com:8443/x'), {host: 'mail.example.com', port: 8443});
  assert.equal(parseTarget('nonsense'), null);
});

test('healthy certificate', () => {
  const r = analyse({host: 'www.example.com', port: 443}, conn(), {now});
  assert.equal(r.valid, true); assert.equal(r.daysLeft, 90); assert.equal(r.issuer, "Let's Encrypt"); assert.equal(r.coversHost, true);
  assert.deepEqual(r.issues, []); assert.equal(r.keyType, 'RSA 2048'); assert.equal(r.sanCount, 2);
});

test('expiring, expired, mismatch, self-signed, old TLS', () => {
  const soon = analyse({host: 'example.com', port: 443}, conn({cert: cert({valid_to: 'Oct 20 00:00:00 2026 GMT'})}), {now});
  assert.equal(soon.issues[0].code, 'expires_soon'); assert.equal(soon.valid, true);
  const week = analyse({host: 'example.com', port: 443}, conn({cert: cert({valid_to: 'Oct  3 00:00:00 2026 GMT'})}), {now});
  assert.equal(week.issues[0].code, 'expires_this_week'); assert.equal(week.valid, false);
  const exp = analyse({host: 'example.com', port: 443}, conn({authorized: false, authorizationError: 'CERT_HAS_EXPIRED', cert: cert({valid_to: 'Sep  1 00:00:00 2026 GMT'})}), {now});
  assert.deepEqual(exp.issues.map(i => i.code), ['expired']);
  const mm = analyse({host: 'other.org', port: 443}, conn(), {now});
  assert.ok(mm.issues.some(i => i.code === 'hostname_mismatch')); assert.equal(mm.coversHost, false);
  const ss = analyse({host: 'example.com', port: 443}, conn({authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT', cert: cert({issuer: {CN: 'example.com'}})}), {now});
  assert.ok(ss.selfSigned); assert.ok(ss.issues.some(i => i.code === 'self_signed')); assert.ok(!ss.issues.some(i => i.code === 'untrusted_chain'));
  const old = analyse({host: 'example.com', port: 443}, conn({protocol: 'TLSv1'}), {now});
  assert.ok(old.issues.some(i => i.code === 'old_tls'));
});
