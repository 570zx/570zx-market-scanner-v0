# ship web-to-markdown 2026-09-30T16:17:45Z c7de7ed
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
Actor ID: 81VuQAQdDBdP5rFcU
Build ID: JZ5HANDaLVJkMI46i
Build number: 0.1.3

Actor URL: https://console.apify.com/actors/81VuQAQdDBdP5rFcU
Build URL: https://console.apify.com/actors/81VuQAQdDBdP5rFcU#/builds/0.1.3
```
## Apify setup and test run
```
actor Dodge_Bot/web-to-markdown
pricing + store details: 400  {"type": "schema-validation", "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"}
pricing confirmed: True {'page': 0.001}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid)., secs 3.382, platform cost $0.0001504225380089548, items 4, ok 3
   {"url": "https://example.com/missing-page-404", "fetchedAt": "2026-09-30T16:18:07.528Z", "finalUrl": "https://example.com/missing-page-404", "httpStatus": 404, "status": "http_error", "error": "The page answered HTTP 404"}
   {"url": "https://en.wikipedia.org/wiki/Markdown", "fetchedAt": "2026-09-30T16:18:07.506Z", "finalUrl": "https://en.wikipedia.org/wiki/Markdown", "httpStatus": 200, "status": "ok", "title": "Markdown", "byline": "Contributors to Wikimedia projects", "siteName": "Wikimedia Foundation, Inc.", "lang": "en", "excerpt": "From Wikipedia, the free encyclopedia", "publishedTime": "2005-08-09T19:56:00Z", "m …
   {"url": "https://docs.apify.com/platform/actors", "fetchedAt": "2026-09-30T16:18:07.525Z", "finalUrl": "https://docs.apify.com/actors", "httpStatus": 200, "status": "ok", "title": "Actors | Platform | Apify Documentation", "byline": null, "siteName": null, "lang": "en", "excerpt": "Learn how to develop, run and share serverless cloud programs. Create your own web scraping and automation tools and  …
   {"url": "https://www.python.org/doc/", "fetchedAt": "2026-09-30T16:18:07.526Z", "finalUrl": "https://www.python.org/doc/", "httpStatus": 200, "status": "ok", "title": "Welcome to Python.org", "byline": null, "siteName": "Python.org", "lang": "en", "excerpt": "The official home of the Python Programming Language", "publishedTime": null, "markdown": "# Welcome to Python.org\n\n**Notice:** This page  …
public: 200 True
```
