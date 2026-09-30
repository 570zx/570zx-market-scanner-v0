# ship broken-link-checker 2026-09-30T16:27:59Z c00dcdcb151da2664345188cc9312b96c921739c
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-09-30T16:28:20.079Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: TmZqdw4laJ9EJ4vt7
Build ID: itIeurxb4ONFO6LFT
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/TmZqdw4laJ9EJ4vt7
Build URL: https://console.apify.com/actors/TmZqdw4laJ9EJ4vt7#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/broken-link-checker
pricing + store details: 200  ok
pricing confirmed: True {'link': 0.0005}
test run: SUCCEEDED, Checked 24 links on 2 pages: 0 broken., secs 2.924, platform cost $0.00015617905951870813, items 26, ok 24
   {"page": "https://www.python.org/", "status": "ok", "link": "https://www.python.org/", "linkText": "Python", "kind": "link", "internal": true, "httpStatus": 200, "finalUrl": "https://www.python.org/", "redirected": false, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://www.python.org/jobs/", "linkText": "Jobs", "kind": "link", "internal": true, "httpStatus": 200, "finalUrl": "https://www.python.org/jobs/", "redirected": false, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://pypi.org/", "linkText": "PyPI", "kind": "link", "internal": false, "httpStatus": 200, "finalUrl": "https://pypi.org/", "redirected": false, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://docs.python.org/", "linkText": "Docs", "kind": "link", "internal": false, "httpStatus": 200, "finalUrl": "https://docs.python.org/3/", "redirected": true, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://www.python.org/community/", "linkText": "Community", "kind": "link", "internal": true, "httpStatus": 200, "finalUrl": "https://www.python.org/community/", "redirected": false, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://www.python.org/psf/", "linkText": "PSF", "kind": "link", "internal": true, "httpStatus": 200, "finalUrl": "https://www.python.org/psf-landing/", "redirected": true, "broken": false, "error": null}
   {"page": "https://example.com/", "status": "ok", "link": "https://iana.org/help/example-domains", "linkText": "Learn more", "kind": "link", "internal": false, "httpStatus": 200, "finalUrl": "https://www.iana.org/help/example-domains", "redirected": true, "broken": false, "error": null}
   {"page": "https://www.python.org/", "status": "ok", "link": "https://www.python.org/community/irc/", "linkText": "Chat on IRC", "kind": "link", "internal": true, "httpStatus": 200, "finalUrl": "https://www.python.org/community/irc/", "redirected": false, "broken": false, "error": null}
```
