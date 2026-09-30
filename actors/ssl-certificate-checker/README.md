# SSL Certificate Checker: Expiry, Issuer, Chain, TLS

Check the SSL/TLS certificate of any number of domains in one run: expiry date and days left, issuer, whether it covers the host name, whether the chain is trusted, self-signed certificates, TLS version, cipher, key type and every subject alternative name.

**$1 per 1,000 hosts.** Hosts that do not exist or refuse the connection are free.

## Good for

- **Expiry monitoring**: schedule it daily or weekly on your domains and alert on `daysLeft` (use Apify's schedules and integrations)
- **Agencies and IT teams**: audit every client site at once
- **Security reviews**: find self-signed, mismatched or old-TLS endpoints
- **Inventory**: list which certificate authority each domain uses

## Output (one row per host, shortened)

```json
{
  "host": "apify.com",
  "port": 443,
  "status": "ok",
  "valid": true,
  "daysLeft": 61,
  "validTo": "2026-11-30T23:59:59.000Z",
  "issuer": "Google Trust Services",
  "coversHost": true,
  "trusted": true,
  "selfSigned": false,
  "protocol": "TLSv1.3",
  "keyType": "EC prime256v1",
  "sanCount": 2,
  "subjectAltNames": ["apify.com", "*.apify.com"],
  "issues": []
}
```

`valid` is false when there is any error: expired, expiring within 7 days, not yet valid, host name not covered, self-signed, or an untrusted chain. `expires_soon` (within your warning window, default 30 days) and old TLS versions are warnings.

## Input

- **Hosts**: domains or URLs, optionally with a port (`mail.example.com:993` works for any TLS service).
- **Warn when expiring within (days)**: default 30.

## Limits

- It reads the certificate the server presents for the host name you give (SNI). It does not scan every server behind a load balancer.
- It does not check revocation (OCSP/CRL).
