# domain-email-security  2026-09-30T16:21:23Z 57b464c
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 3s
```
## unit tests
```
# tests 16
# pass 16
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 5 of 5 domains
[32mINFO[39m  [Status message]: Processed 5 of 5 domains. Charged 4; 1 not charged (errors, blocked or invalid).
```
## items
5 items
```json
{"input": "not a domain", "checkedAt": "2026-09-30T16:21:26.810Z", "status": "invalid_domain", "error": "Not a valid domain name"}
```
```json
{"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:21:26.810Z", "domain": "this-domain-should-not-exist-570zx.com", "status": "ok", "exists": false, "grade": "F", "issues": [{"severity": "error", "code": "no_domain", "message": "Domain does not exist in DNS."}]}
```
```json
{"input": "google.com", "checkedAt": "2026-09-30T16:21:26.809Z", "domain": "google.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [{"severity": "notice", "code": "dkim_not_found", "message": "No DKIM key found under 31 common selector names (the domain may use a custom selector)."}], "mailProvider": "Google Workspace", "mx": [{"host": "smtp.google.com", "priority": 10}], "nullMx": false, "nameservers": ["ns1.google.com", "ns2.google.com", "ns3.google.com", "ns4.google.com"], "spfRecord": "v=spf1 include:_spf.google.com ~all", "spfAll": "~all", "spfLookups": 1, "spfIncludes": ["_spf.google.com"], "dmarcRecord": "v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com", "dmarcPolicy": "reject", "dmarcPct": 100, "dmarcReportsTo": "mailto:mailauth-reports@google.com", "dkimSelectorsFound": [], "dkim": [], "mtaSts": true, "tlsRpt": true, "bimi": null}
```
```json
{"input": "example.com", "checkedAt": "2026-09-30T16:21:26.810Z", "domain": "example.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [{"severity": "notice", "code": "dmarc_no_reports", "message": "DMARC has no rua= address, so no aggregate reports are collected."}, {"severity": "notice", "code": "null_mx", "message": "Null MX: the domain states it never receives email."}], "mailProvider": "Other / self-hosted", "mx": [{"host": "", "priority": 0}], "nullMx": true, "nameservers": ["elliott.ns.cloudflare.com", "hera.ns.cloudflare.com"], "spfRecord": "v=spf1 -all", "spfAll": "-all", "spfLookups": 0, "spfIncludes": [], "dmarcRecord": "v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s", "dmarcPolicy": "reject", "dmarcPct": 100, "dmarcReportsTo": null, "dkimSelectorsFound": ["amazonses", "cm", "default", "dk", "dkim", "everlytickey1", "fm1", "fm2", "fm3", "google", "hs1", "hs2", "k1", "k2", "k3", "krs", "mail", "mailjet", "mandrill", "mxvault", "pm", "protonmail", "protonmail2", "s1", "s2", "selector1", "selector2", "sendgrid", "smtp", "smtpapi", "zoho"], "dkim": [{"selector": "amazonses", "revoked": true, "keyType": "rsa", "approxKeyBits": null}, {"selector": "cm", "revoked": true, "keyType": "rsa", "approxKeyBits": null}, {"selector": "default", "revoked": true, "keyType": "rsa", "approxKeyBits": null}, {"selector": "dk", "revoked": true, "keyType" …
```
```json
{"input": "apify.com", "checkedAt": "2026-09-30T16:21:26.810Z", "domain": "apify.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [], "mailProvider": "Google Workspace", "mx": [{"host": "aspmx.l.google.com", "priority": 1}, {"host": "alt1.aspmx.l.google.com", "priority": 5}, {"host": "alt2.aspmx.l.google.com", "priority": 5}, {"host": "aspmx2.googlemail.com", "priority": 10}, {"host": "aspmx3.googlemail.com", "priority": 10}], "nullMx": false, "nameservers": ["ns-1225.awsdns-25.org", "ns-1928.awsdns-49.co.uk", "ns-449.awsdns-56.com", "ns-839.awsdns-40.net"], "spfRecord": "v=spf1 a mx include:_spf.google.com include:mailgun.org include:amazonses.com include:19497222.spf05.hubspotemail.net -all", "spfAll": "-all", "spfLookups": 6, "spfIncludes": ["_spf.google.com", "mailgun.org", "amazonses.com", "19497222.spf05.hubspotemail.net"], "dmarcRecord": "v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc-reports@apify.com; ri=604800", "dmarcPolicy": "reject", "dmarcPct": 100, "dmarcReportsTo": "mailto:dmarc-reports@apify.com", "dkimSelectorsFound": ["google"], "dkim": [{"selector": "google", "revoked": false, "keyType": "rsa", "approxKeyBits": 2048}], "mtaSts": true, "tlsRpt": true, "bimi": "v=BIMI1;l=https://apify.com/ext/apify-bimi-logo.svg;a=https://apify.com/ext/apify-bimi-certificate.pem;avp=personal"}
```
