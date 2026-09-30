# ship seo-page-audit 2026-09-30T16:02:35Z 6cdfd78
## unit
```
# tests 15
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 63.389937
```
## push
```
2026-09-30T16:02:09.976Z ACTOR: Building container image (cache enabled).
2026-09-30T16:02:21.852Z ACTOR: Pushing container image to repository.
2026-09-30T16:02:22.843Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: RbofdgB6d5fj2PnmN
Build ID: JcHgB91U4Z3IQqpef
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/RbofdgB6d5fj2PnmN
Build URL: https://console.apify.com/actors/RbofdgB6d5fj2PnmN#/builds/0.1.1
```
## ship
```
actor Dodge_Bot/seo-page-audit
pricing + store details: 200  ok
pricing confirmed: True {'page': 0.003}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 4; 0 not charged (errors, blocked or invalid)., secs 5.499, platform cost $0.00022632548706233503, items 4, ok 4
   {"url": "https://example.com/", "checkedAt": "2026-09-30T16:02:26.823Z", "finalUrl": "https://example.com/", "httpStatus": 200, "status": "ok", "score": 81, "errors": 0, "warnings": 3, "notices": 4, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (14 characters; aim for 30-60)."}, {"severity": "warning", "code": "description_missing", "message": "No meta descri …
   {"url": "https://www.bbc.co.uk/news", "checkedAt": "2026-09-30T16:02:26.826Z", "finalUrl": "https://www.bbc.co.uk/news", "httpStatus": 200, "status": "ok", "score": 94, "errors": 0, "warnings": 1, "notices": 1, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (15 characters; aim for 30-60)."}, {"severity": "notice", "code": "description_long", "message": "Meta d …
   {"url": "https://www.python.org/", "checkedAt": "2026-09-30T16:02:26.800Z", "finalUrl": "https://www.python.org/", "httpStatus": 200, "status": "ok", "score": 97, "errors": 0, "warnings": 0, "notices": 3, "issues": [{"severity": "notice", "code": "description_short", "message": "Meta description is short (52 characters; aim for 70-160)."}, {"severity": "notice", "code": "h1_multiple", "message": " …
   {"url": "http://neverssl.com/", "checkedAt": "2026-09-30T16:02:26.827Z", "finalUrl": "http://neverssl.com/", "httpStatus": 200, "status": "ok", "score": 68, "errors": 1, "warnings": 2, "notices": 7, "issues": [{"severity": "error", "code": "no_https", "message": "Page is not served over HTTPS."}, {"severity": "warning", "code": "description_missing", "message": "No meta description."}, {"severity" …
public: 403 {"type": "readme-required", "message": "This Actor can't be published because its default build has no README. Add a README.md to the source code, rebuild, and publish again."}
```
