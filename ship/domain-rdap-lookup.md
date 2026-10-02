# ship domain-rdap-lookup 2026-10-02T17:29:26Z 2d0c7738a1009a5aeb79561d43cf68d9c71617e1
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-10-02T17:29:51.724Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: rabS0F7FLHc6eprv8
Build ID: BgzJ5P0US0LKhgz2h
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/rabS0F7FLHc6eprv8
Build URL: https://console.apify.com/actors/rabS0F7FLHc6eprv8#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/domain-rdap-lookup
pricing + store details: 200 unchanged pricing kept ok
pricing confirmed: True {'domain': 0.002}
test run: SUCCEEDED, Processed 5 of 5 domains. Charged 4; 1 not charged (errors, blocked or invalid)., secs 4.179, platform cost $0.00017061365886529288, items 5, ok 4
   {"input": "not a domain", "checkedAt": "2026-10-02T17:29:57.524Z", "status": "invalid_domain", "error": "Not a valid domain name"}
   {"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-10-02T17:29:57.524Z", "domain": "this-domain-should-not-exist-570zx.com", "status": "ok", "registered": false, "note": "Not found in the registry: the domain is probably available to register (some registries also hide reserved names)."}
   {"input": "apify.com", "checkedAt": "2026-10-02T17:29:57.523Z", "rdapServer": "https://rdap.verisign.com/com/v1/", "domain": "apify.com", "status": "ok", "registered": true, "ldhName": "apify.com", "registrar": "Amazon Registrar, Inc.", "registrarIanaId": "468", "abuseEmail": "trustandsafety@support.aws.com", "abusePhone": "tel:+1.2024422253", "createdDate": "2009-06-02T17:14:10Z", "updatedDate":  …
   {"input": "google.dev", "checkedAt": "2026-10-02T17:29:57.524Z", "rdapServer": "https://pubapi.registry.google/rdap/", "domain": "google.dev", "status": "ok", "registered": true, "ldhName": "google.dev", "registrar": "MarkMonitor Inc.", "registrarIanaId": "292", "abuseEmail": "registryescalations@markmonitor.com", "abusePhone": "tel:+1.2083895740", "createdDate": "2018-06-13T22:30:20.594Z", "updat …
   {"input": "www.bbc.co.uk", "checkedAt": "2026-10-02T17:29:57.524Z", "rdapServer": "https://rdap.nominet.uk/uk/", "domain": "bbc.co.uk", "status": "ok", "registered": true, "ldhName": "bbc.co.uk", "registrar": "British Broadcasting Corporation", "registrarIanaId": null, "abuseEmail": "nominet.admins@bbc.co.uk", "abusePhone": null, "createdDate": "1994-12-13T03:49:48Z", "updatedDate": "2025-10-29T03 …
public: 200 True
```
