# ship domain-email-security 2026-09-30T16:16:17Z c7de7ed
## unit tests
```
# tests 16
# pass 16
# fail 0
```
## push
```
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: D1C3VYxdl12UC3EBw
Build ID: hHdaibcPKjEFKIg11
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/D1C3VYxdl12UC3EBw
Build URL: https://console.apify.com/actors/D1C3VYxdl12UC3EBw#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/domain-email-security
pricing + store details: 200  ok
pricing confirmed: True {'domain': 0.003}
test run: SUCCEEDED, Processed 5 of 5 domains. Charged 4; 1 not charged (errors, blocked or invalid)., secs 3.51, platform cost $0.00015122137874364853, items 5, ok 4
   {"input": "not a domain", "checkedAt": "2026-09-30T16:16:39.067Z", "status": "invalid_domain", "error": "Not a valid domain name"}
   {"input": "google.com", "checkedAt": "2026-09-30T16:16:39.066Z", "domain": "google.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [{"severity": "notice", "code": "dkim_not_found", "message": "No DKIM key found under 31 common selector names (the domain may use a custom selector)."}], "mailProvider": "Google Workspace", "mx": [{"host": "smtp.google.com", " …
   {"input": "example.com", "checkedAt": "2026-09-30T16:16:39.067Z", "domain": "example.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [{"severity": "notice", "code": "dmarc_no_reports", "message": "DMARC has no rua= address, so no aggregate reports are collected."}, {"severity": "notice", "code": "null_mx", "message": "Null MX: the domain states it never re …
   {"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:16:39.067Z", "domain": "this-domain-should-not-exist-570zx.com", "status": "ok", "exists": false, "grade": "F", "issues": [{"severity": "error", "code": "no_domain", "message": "Domain does not exist in DNS."}]}
   {"input": "apify.com", "checkedAt": "2026-09-30T16:16:39.067Z", "domain": "apify.com", "status": "ok", "exists": true, "grade": "A", "errors": 0, "warnings": 0, "issues": [], "mailProvider": "Google Workspace", "mx": [{"host": "aspmx.l.google.com", "priority": 1}, {"host": "alt1.aspmx.l.google.com", "priority": 5}, {"host": "alt2.aspmx.l.google.com", "priority": 5}, {"host": "aspmx3.googlemail.com …
public: 429 {"type": "daily-publication-limit-exceeded", "message": "You\u2019ve reached the daily limit of 5 Actor publications. Try again in 24 hours."}
```
