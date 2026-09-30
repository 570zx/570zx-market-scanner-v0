import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBootstrap, serverFor, registrable, summarize, normalizeDomain} from '../src/rdap.js';

const boot = {services: [[['com', 'net'], ['https://rdap.verisign.com/com/v1/']], [['uk'], ['https://rdap.nominet.uk/uk/']], [['app', 'dev'], ['http://x/', 'https://pubapi.registry.google/rdap']]]};

test('bootstrap and server selection', () => {
  const m = parseBootstrap(boot);
  assert.equal(serverFor('example.com', m).base, 'https://rdap.verisign.com/com/v1/');
  assert.equal(serverFor('shop.example.co.uk', m).base, 'https://rdap.nominet.uk/uk/');
  assert.equal(serverFor('x.dev', m).base, 'https://pubapi.registry.google/rdap/');
  assert.equal(serverFor('x.zz', m), null);
});

test('registrable domain and normalisation', () => {
  assert.equal(registrable('www.shop.example.com'), 'example.com');
  assert.equal(registrable('www.example.co.uk'), 'example.co.uk');
  assert.equal(normalizeDomain('https://WWW.Example.com/x'), 'www.example.com');
  assert.equal(normalizeDomain('me@site.io'), 'site.io');
  assert.equal(normalizeDomain('nope'), null);
});

test('summarize a Verisign-style response', () => {
  const json = {ldhName: 'EXAMPLE.COM', status: ['client transfer prohibited'],
    events: [{eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z'}, {eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z'}, {eventAction: 'last changed', eventDate: '2026-08-14T07:01:34Z'}],
    entities: [{roles: ['registrar'], handle: '376', publicIds: [{type: 'IANA Registrar ID', identifier: '376'}], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'RESERVED-Internet Assigned Numbers Authority']]],
      entities: [{roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@iana.org'], ['tel', {type: 'voice'}, 'uri', 'tel:+1.310']]]}]}],
    nameservers: [{ldhName: 'B.IANA-SERVERS.NET'}, {ldhName: 'A.IANA-SERVERS.NET'}], secureDNS: {delegationSigned: true}};
  const s = summarize('example.com', json, new Date('2026-09-30T00:00:00Z'));
  assert.equal(s.registrar, 'RESERVED-Internet Assigned Numbers Authority'); assert.equal(s.registrarIanaId, '376');
  assert.equal(s.abuseEmail, 'abuse@iana.org'); assert.equal(s.createdDate, '1995-08-14T04:00:00Z');
  assert.equal(s.daysUntilExpiry, 317); assert.equal(s.ageYears, 31.1);
  assert.deepEqual(s.nameservers, ['a.iana-servers.net', 'b.iana-servers.net']); assert.equal(s.dnssec, true);
  assert.equal(s.ldhName, 'example.com');
});
