import tls from 'node:tls';

export function parseTarget(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!host || (!host.includes('.') && !host.includes(':'))) return null;
    return {host, port: u.port ? Number(u.port) : 443};
  } catch { return null; }
}

// Connect and read the certificate the server presents. Chain validation errors are captured, not thrown.
export function fetchCertificate({host, port}, {timeoutMs = 15000} = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const sock = tls.connect({host, port, servername: /^[\d.]+$|:/.test(host) ? undefined : host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1']});
    const timer = setTimeout(() => { sock.destroy(); reject(Object.assign(new Error('Timed out connecting'), {code: 'TIMEOUT'})); }, timeoutMs);
    sock.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = sock.getPeerCertificate(true);
      const out = {cert, authorized: sock.authorized, authorizationError: sock.authorizationError ? String(sock.authorizationError) : null,
        protocol: sock.getProtocol(), cipher: sock.getCipher()?.name ?? null, alpn: sock.alpnProtocol || null, handshakeMs: Date.now() - started};
      sock.end();
      resolve(out);
    });
    sock.once('error', e => { clearTimeout(timer); reject(e); });
  });
}

function chainOf(cert) {
  const chain = [];
  let c = cert, guard = 0;
  while (c && Object.keys(c).length && guard++ < 10) {
    chain.push({subject: c.subject?.CN ?? c.subject?.O ?? null, issuer: c.issuer?.CN ?? c.issuer?.O ?? null, validTo: c.valid_to ? new Date(c.valid_to).toISOString() : null});
    if (!c.issuerCertificate || c.issuerCertificate === c || c.issuerCertificate.fingerprint256 === c.fingerprint256) break;
    c = c.issuerCertificate;
  }
  return chain;
}

// Turn a connection result into a report. `now` is injectable for tests.
export function analyse(target, conn, {now = new Date(), warnDays = 30} = {}) {
  const c = conn.cert ?? {};
  const issues = [];
  const add = (severity, code, message) => issues.push({severity, code, message});
  const validFrom = c.valid_from ? new Date(c.valid_from) : null;
  const validTo = c.valid_to ? new Date(c.valid_to) : null;
  const daysLeft = validTo ? Math.floor((validTo - now) / 86400000) : null;
  const sans = String(c.subjectaltname ?? '').split(/,\s*/).filter(Boolean).map(s => s.replace(/^(DNS|IP Address):/, ''));
  const idErr = tls.checkServerIdentity(target.host, c);
  const selfSigned = Boolean(c.issuer && c.subject && JSON.stringify(c.issuer) === JSON.stringify(c.subject));

  if (!validTo) add('error', 'no_certificate', 'The server presented no certificate.');
  else if (daysLeft < 0) add('error', 'expired', `Certificate expired ${-daysLeft} days ago (${validTo.toISOString().slice(0, 10)}).`);
  else if (daysLeft <= 7) add('error', 'expires_this_week', `Certificate expires in ${daysLeft} days.`);
  else if (daysLeft <= warnDays) add('warning', 'expires_soon', `Certificate expires in ${daysLeft} days.`);
  if (validFrom && validFrom > now) add('error', 'not_yet_valid', 'Certificate is not valid yet.');
  if (idErr) add('error', 'hostname_mismatch', `Certificate does not cover ${target.host}.`);
  if (selfSigned) add('error', 'self_signed', 'Certificate is self-signed.');
  else if (!conn.authorized && conn.authorizationError && !/CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID/.test(conn.authorizationError)) add('error', 'untrusted_chain', `Certificate chain is not trusted: ${conn.authorizationError}.`);
  if (conn.protocol && /TLSv1(\.[01])?$/.test(conn.protocol)) add('warning', 'old_tls', `Server negotiated ${conn.protocol}; TLS 1.2 or newer is expected.`);
  if (c.bits && c.bits < 2048 && !/EC|ecdsa/i.test(c.asn1Curve ?? c.nistCurve ?? '') && !c.nistCurve) add('warning', 'weak_key', `RSA key is ${c.bits} bits.`);

  const errors = issues.filter(i => i.severity === 'error').length;
  return {
    host: target.host, port: target.port, status: 'ok',
    valid: errors === 0, daysLeft, validFrom: validFrom?.toISOString() ?? null, validTo: validTo?.toISOString() ?? null,
    issuer: c.issuer?.O ?? c.issuer?.CN ?? null, issuerCommonName: c.issuer?.CN ?? null, subject: c.subject?.CN ?? null,
    subjectAltNames: sans.slice(0, 100), sanCount: sans.length, coversHost: !idErr, selfSigned, trusted: Boolean(conn.authorized),
    trustError: conn.authorizationError, protocol: conn.protocol, cipher: conn.cipher, alpn: conn.alpn,
    keyType: c.nistCurve ? `EC ${c.nistCurve}` : c.bits ? `RSA ${c.bits}` : null,
    serialNumber: c.serialNumber ?? null, fingerprintSha256: c.fingerprint256 ?? null,
    chain: chainOf(c), handshakeMs: conn.handshakeMs, issues
  };
}
