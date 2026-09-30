# ship web-to-markdown 2026-09-30T16:02:37Z 6cdfd78
## unit
```
# tests 15
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 149.657066
```
## push
```
2026-09-30T16:02:11.524Z ACTOR: Building container image (cache enabled).
2026-09-30T16:02:28.472Z ACTOR: Pushing container image to repository.
2026-09-30T16:02:29.677Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: 81VuQAQdDBdP5rFcU
Build ID: hR3R3WQZCt3VaXAfK
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/81VuQAQdDBdP5rFcU
Build URL: https://console.apify.com/actors/81VuQAQdDBdP5rFcU#/builds/0.1.1
```
## ship
```
actor Dodge_Bot/web-to-markdown
pricing + store details: 200  ok
pricing confirmed: True {'page': 0.001}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid)., secs 3.049, platform cost $0.00014649514814880162, items 4, ok 3
   {"url": "https://example.com/missing-page-404", "fetchedAt": "2026-09-30T16:02:33.851Z", "finalUrl": "https://example.com/missing-page-404", "httpStatus": 404, "status": "http_error", "error": "The page answered HTTP 404"}
   {"url": "https://www.python.org/doc/", "fetchedAt": "2026-09-30T16:02:33.848Z", "finalUrl": "https://www.python.org/doc/", "httpStatus": 200, "status": "ok", "title": "Welcome to Python.org", "byline": null, "siteName": "Python.org", "lang": "en", "excerpt": "The official home of the Python Programming Language", "publishedTime": null, "markdown": "# Welcome to Python.org\n\n**Notice:** This page  …
   {"url": "https://docs.apify.com/platform/actors", "fetchedAt": "2026-09-30T16:02:33.846Z", "finalUrl": "https://docs.apify.com/actors", "httpStatus": 200, "status": "ok", "title": "Actors | Platform | Apify Documentation", "byline": null, "siteName": null, "lang": "en", "excerpt": "Learn how to develop, run and share serverless cloud programs. Create your own web scraping and automation tools and  …
   {"url": "https://en.wikipedia.org/wiki/Markdown", "fetchedAt": "2026-09-30T16:02:33.828Z", "finalUrl": "https://en.wikipedia.org/wiki/Markdown", "httpStatus": 200, "status": "ok", "title": "Markdown", "byline": "Contributors to Wikimedia projects", "siteName": "Wikimedia Foundation, Inc.", "lang": "en", "excerpt": "From Wikipedia, the free encyclopedia", "publishedTime": "2005-08-09T19:56:00Z", "m …
public: 403 {"type": "readme-required", "message": "This Actor can't be published because its default build has no README. Add a README.md to the source code, rebuild, and publish again."}
```
