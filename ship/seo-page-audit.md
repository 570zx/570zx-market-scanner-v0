# ship seo-page-audit 2026-09-30T16:07:22Z 286ea6d
## unit tests
```
# tests 15
# pass 15
# fail 0
```
## push
```
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: RbofdgB6d5fj2PnmN
Build ID: abyZvOIaRnAw7Ys7E
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/RbofdgB6d5fj2PnmN
Build URL: https://console.apify.com/actors/RbofdgB6d5fj2PnmN#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/seo-page-audit
pricing + store details: 400  {"type": "schema-validation", "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"}
pricing confirmed: True {'page': 0.003}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid)., secs 4.754, platform cost $0.00018561488417122098, items 4, ok 3
   {"url": "https://www.python.org/", "checkedAt": "2026-09-30T16:07:45.317Z", "finalUrl": "https://www.python.org/", "httpStatus": 200, "status": "ok", "score": 97, "errors": 0, "warnings": 0, "notices": 3, "issues": [{"severity": "notice", "code": "description_short", "message": "Meta description is short (52 characters; aim for 70-160)."}, {"severity": "notice", "code": "h1_multiple", "message": " …
   {"url": "https://example.com/", "checkedAt": "2026-09-30T16:07:45.331Z", "finalUrl": "https://example.com/", "httpStatus": 200, "status": "ok", "score": 81, "errors": 0, "warnings": 3, "notices": 4, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (14 characters; aim for 30-60)."}, {"severity": "warning", "code": "description_missing", "message": "No meta descri …
   {"url": "https://www.bbc.co.uk/news", "checkedAt": "2026-09-30T16:07:45.332Z", "finalUrl": "https://www.bbc.co.uk/news", "httpStatus": 200, "status": "ok", "score": 94, "errors": 0, "warnings": 1, "notices": 1, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (15 characters; aim for 30-60)."}, {"severity": "notice", "code": "description_long", "message": "Meta d …
   {"url": "http://neverssl.com/", "checkedAt": "2026-09-30T16:07:45.333Z", "status": "unreachable", "error": "Could not load the page: fetch failed"}
public: 200 True
```
