# ship ssl-certificate-checker 2026-09-30T16:16:42Z c7de7ed
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: 2D3tIpf8x9zsGVthD
Build ID: QbBLBoxjdxZZzxB2h
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/2D3tIpf8x9zsGVthD
Build URL: https://console.apify.com/actors/2D3tIpf8x9zsGVthD#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/ssl-certificate-checker
pricing + store details: 200  ok
pricing confirmed: True {'host': 0.001}
test run: SUCCEEDED, Processed 5 of 5 hosts. Charged 4; 1 not charged (errors, blocked or invalid)., secs 2.143, platform cost $0.00011057458435164558, items 5, ok 4
   {"input": "apify.com", "checkedAt": "2026-09-30T16:17:06.123Z", "host": "apify.com", "port": 443, "status": "ok", "valid": true, "daysLeft": 108, "validFrom": "2026-07-03T00:00:00.000Z", "validTo": "2027-01-16T23:59:59.000Z", "issuer": "Amazon", "issuerCommonName": "Amazon RSA 2048 M04", "subject": "*.apify.com", "subjectAltNames": ["*.apify.com", "apifier.com", "*.apifier.com", "apify.com"], "san …
   {"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:17:06.137Z", "host": "this-domain-should-not-exist-570zx.com", "port": 443, "status": "unreachable", "error": "Host does not exist"}
   {"input": "expired.badssl.com", "checkedAt": "2026-09-30T16:17:06.134Z", "host": "expired.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": -4189, "validFrom": "2015-04-09T00:00:00.000Z", "validTo": "2015-04-12T23:59:59.000Z", "issuer": "COMODO CA Limited", "issuerCommonName": "COMODO RSA Domain Validation Secure Server CA", "subject": "*.badssl.com", "subjectAltNames": ["*.bad …
   {"input": "self-signed.badssl.com", "checkedAt": "2026-09-30T16:17:06.136Z", "host": "self-signed.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": 729, "validFrom": "2026-09-29T21:01:43.000Z", "validTo": "2028-09-28T21:01:43.000Z", "issuer": "BadSSL", "issuerCommonName": "*.badssl.com", "subject": "*.badssl.com", "subjectAltNames": ["*.badssl.com", "badssl.com"], "sanCount": 2 …
   {"input": "wrong.host.badssl.com", "checkedAt": "2026-09-30T16:17:06.135Z", "host": "wrong.host.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": 89, "validFrom": "2026-09-29T20:02:56.000Z", "validTo": "2026-12-28T20:02:55.000Z", "issuer": "Let's Encrypt", "issuerCommonName": "YR1", "subject": "*.badssl.com", "subjectAltNames": ["*.badssl.com", "badssl.com"], "sanCount": 2, "co …
public: 429 {"type": "daily-publication-limit-exceeded", "message": "You\u2019ve reached the daily limit of 5 Actor publications. Try again in 24 hours."}
```
