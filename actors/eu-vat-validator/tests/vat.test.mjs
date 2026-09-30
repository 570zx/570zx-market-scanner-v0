import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVat, checkVies, FORMATS} from '../src/vat.js';

test('parseVat normalises, maps GR to EL, uses default country, rejects bad formats and GB', () => {
  assert.deepEqual(parseVat('de 123.456-789'), {ok: true, country: 'DE', number: '123456789'});
  assert.deepEqual(parseVat('GR123456789'), {ok: true, country: 'EL', number: '123456789'});
  assert.deepEqual(parseVat('NL123456789B01'), {ok: true, country: 'NL', number: '123456789B01'});
  assert.deepEqual(parseVat('123456789', 'de'), {ok: true, country: 'DE', number: '123456789'});
  assert.equal(parseVat('123456789').ok, false);
  assert.match(parseVat('DE12345').reason, /Wrong format/);
  assert.match(parseVat('GB123456789').reason, /Brexit/);
  assert.ok(parseVat('XI123456789').ok);
  assert.equal(Object.keys(FORMATS).length, 28);
});

test('checkVies: valid, invalid, retry then unavailable', async () => {
  const fast = {sleep: async () => {}};
  const v = await checkVies({country: 'DE', number: '1'}, {fetchJson: async () => ({isValid: true, userError: 'VALID', name: 'ACME  GMBH', address: 'Street 1\n  Berlin', requestDate: '2026-09-30'}), ...fast});
  assert.equal(v.state, 'valid'); assert.equal(v.name, 'ACME GMBH'); assert.equal(v.address, 'Street 1 Berlin');
  const dashes = await checkVies({country: 'DE', number: '1'}, {fetchJson: async () => ({isValid: true, name: '---', address: '---'}), ...fast});
  assert.equal(dashes.name, null);
  assert.equal((await checkVies({country: 'DE', number: '1'}, {fetchJson: async () => ({isValid: false, userError: 'INVALID'}), ...fast})).state, 'invalid');
  let n = 0;
  const later = await checkVies({country: 'IT', number: '1'}, {fetchJson: async () => (++n < 3 ? {isValid: false, userError: 'MS_MAX_CONCURRENT_REQ'} : {isValid: true}), ...fast});
  assert.equal(later.state, 'valid'); assert.equal(n, 3);
  const down = await checkVies({country: 'ES', number: '1'}, {fetchJson: async () => ({isValid: false, userError: 'MS_UNAVAILABLE'}), ...fast});
  assert.equal(down.state, 'unavailable'); assert.match(down.error, /MS_UNAVAILABLE/);
});
