# domain-rdap-lookup  2026-09-30T16:22:50Z bfd6232
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 2s
```
## unit tests
```
# tests 14
# pass 14
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
{"input": "not a domain", "checkedAt": "2026-09-30T16:22:53.226Z", "status": "invalid_domain", "error": "Not a valid domain name"}
```
```json
{"input": "apify.com", "checkedAt": "2026-09-30T16:22:53.225Z", "rdapServer": "https://rdap.verisign.com/com/v1/", "domain": "apify.com", "status": "ok", "registered": true, "ldhName": "apify.com", "registrar": "Amazon Registrar, Inc.", "registrarIanaId": "468", "abuseEmail": "trustandsafety@support.aws.com", "abusePhone": "tel:+1.2024422253", "createdDate": "2009-06-02T17:14:10Z", "updatedDate": "2026-05-16T16:53:04Z", "expiryDate": "2035-06-02T17:14:10Z", "daysUntilExpiry": 3167, "ageYears": 17.3, "statuses": ["client transfer prohibited"], "nameservers": ["ns-1225.awsdns-25.org", "ns-1928.awsdns-49.co.uk", "ns-449.awsdns-56.com", "ns-839.awsdns-40.net"], "dnssec": true}
```
```json
{"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:22:53.226Z", "domain": "this-domain-should-not-exist-570zx.com", "status": "ok", "registered": false, "note": "Not found in the registry: the domain is probably available to register (some registries also hide reserved names)."}
```
```json
{"input": "google.dev", "checkedAt": "2026-09-30T16:22:53.226Z", "rdapServer": "https://pubapi.registry.google/rdap/", "domain": "google.dev", "status": "ok", "registered": true, "ldhName": "google.dev", "registrar": "MarkMonitor Inc.", "registrarIanaId": "292", "abuseEmail": "registryescalations@markmonitor.com", "abusePhone": "tel:+1.2083895740", "createdDate": "2018-06-13T22:30:20.594Z", "updatedDate": "2025-10-23T18:23:49.881Z", "expiryDate": "2027-06-13T22:30:20.594Z", "daysUntilExpiry": 256, "ageYears": 8.2, "statuses": ["client delete prohibited", "client transfer prohibited", "client update prohibited"], "nameservers": ["ns1.googledomains.com", "ns2.googledomains.com", "ns3.googledomains.com", "ns4.googledomains.com"], "dnssec": false}
```
```json
{"input": "www.bbc.co.uk", "checkedAt": "2026-09-30T16:22:53.226Z", "rdapServer": "https://rdap.nominet.uk/uk/", "domain": "bbc.co.uk", "status": "ok", "registered": true, "ldhName": "bbc.co.uk", "registrar": "British Broadcasting Corporation", "registrarIanaId": null, "abuseEmail": "nominet.admins@bbc.co.uk", "abusePhone": null, "createdDate": "1994-12-13T03:49:48Z", "updatedDate": "2025-10-29T03:51:11.009091Z", "expiryDate": "2034-12-13T03:49:48Z", "daysUntilExpiry": 2995, "ageYears": 31.7, "statuses": ["server delete prohibited", "server transfer prohibited", "server update prohibited"], "nameservers": ["ddns0.bbc.co.uk.", "ddns0.bbc.com.", "ddns1.bbc.co.uk.", "ddns1.bbc.com.", "dns0.bbc.co.uk.", "dns0.bbc.com.", "dns1.bbc.co.uk.", "dns1.bbc.com."], "dnssec": false}
```
