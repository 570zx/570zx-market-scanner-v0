// EU VAT numbers, checked against VIES (the European Commission's VAT Information Exchange System).

export const FORMATS = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/, DE: /^\d{9}$/, DK: /^\d{8}$/, EE: /^\d{9}$/,
  EL: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^\d{8}$/, FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/, HR: /^\d{11}$/, HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/, IT: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/, LU: /^\d{8}$/, LV: /^\d{11}$/, MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/, PT: /^\d{9}$/, RO: /^\d{2,10}$/, SE: /^\d{12}$/, SI: /^\d{8}$/, SK: /^\d{10}$/, XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/
};

// "DE 123 456 789" / "de123456789" / "GR123..." -> {country:'DE', number:'123456789'}
export function parseVat(raw, defaultCountry = null) {
  let s = String(raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
  if (!s) return {ok: false, reason: 'empty'};
  let cc = s.slice(0, 2);
  if (cc === 'GR') cc = 'EL';
  if (/^[A-Z]{2}$/.test(cc) && (FORMATS[cc] || cc === 'GB')) s = s.slice(2);
  else if (defaultCountry) cc = defaultCountry.toUpperCase() === 'GR' ? 'EL' : defaultCountry.toUpperCase();
  else return {ok: false, reason: 'No country prefix (for example DE, FR, NL). Add one, or set a default country.'};
  if (cc === 'GB') return {ok: false, country: 'GB', number: s, reason: 'UK (GB) VAT numbers are no longer in VIES since Brexit; only Northern Ireland (XI) numbers are.'};
  if (!FORMATS[cc]) return {ok: false, reason: `${cc} is not an EU VAT country code`};
  if (!FORMATS[cc].test(s)) return {ok: false, country: cc, number: s, reason: `Wrong format for a ${cc} VAT number`};
  return {ok: true, country: cc, number: s};
}

const clean = v => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s && s !== '---' ? s : null; };

// fetchJson(url) -> parsed JSON. Returns {state: 'valid'|'invalid'|'unavailable', ...}
export async function checkVies({country, number}, {fetchJson, sleep = ms => new Promise(r => setTimeout(r, ms)), tries = 4}) {
  let last;
  for (let i = 0; i < tries; i++) {
    let j;
    try { j = await fetchJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${encodeURIComponent(number)}`); } catch (e) { last = e.message; await sleep(1500 * (i + 1)); continue; }
    const err = j?.userError;
    if (j?.isValid === true || err === 'VALID') return {state: 'valid', name: clean(j.name), address: clean(j.address), requestDate: j.requestDate ?? null};
    if (err === 'INVALID' || (j?.isValid === false && (!err || err === 'INVALID'))) return {state: 'invalid', requestDate: j.requestDate ?? null};
    if (err === 'INVALID_INPUT') return {state: 'invalid', requestDate: j.requestDate ?? null, note: 'VIES rejected the number format'};
    last = err ?? 'unexpected answer';
    await sleep(2000 * (i + 1)); // MS_UNAVAILABLE, MS_MAX_CONCURRENT_REQ, TIMEOUT, SERVICE_UNAVAILABLE
  }
  return {state: 'unavailable', error: `VIES could not answer (${last}). The member state's system may be down; try again later.`};
}
