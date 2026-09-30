# ship structured-data 2026-09-30T17:28:22Z 1a2ee6848810d221fb4b4b76269f831097e3106b
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-09-30T17:28:41.308Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: wc3n5iwnLIcSuATnd
Build ID: h1qQIkQAiN3s7qoJS
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/wc3n5iwnLIcSuATnd
Build URL: https://console.apify.com/actors/wc3n5iwnLIcSuATnd#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/structured-data
pricing + store details: 400  {"type": "schema-validation", "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"}
pricing confirmed: True {'page': 0.002}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid)., secs 2.633, platform cost $0.0001232648037009769, items 4, ok 3
   {"url": "https://example.com/does-not-exist-404", "checkedAt": "2026-09-30T17:28:44.450Z", "finalUrl": "https://example.com/does-not-exist-404", "httpStatus": 404, "status": "http_error", "error": "The page answered HTTP 404"}
   {"url": "https://www.bbc.co.uk/news", "checkedAt": "2026-09-30T17:28:44.447Z", "finalUrl": "https://www.bbc.co.uk/news", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "Home - BBC News", "metaDescription": "Visit BBC News for up-to-the-minute news, breaking news, video, audio and feature stories. BBC News provides trusted Wor …
   {"url": "https://www.python.org/", "checkedAt": "2026-09-30T17:28:44.432Z", "finalUrl": "https://www.python.org/", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "Welcome to Python.org", "metaDescription": "The official home of the Python Programming Language", "canonical": null, "schemaTypes": ["WebSite"], "microdataTypes":  …
   {"url": "https://github.com/apify/crawlee", "checkedAt": "2026-09-30T17:28:44.449Z", "finalUrl": "https://github.com/apify/crawlee", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "GitHub - apify/crawlee: Crawlee—A web scraping and browser automation library for Node.js to build reliable crawlers. In JavaScript and TypeScript …
public: 429 {"type": "daily-publication-limit-exceeded", "message": "You\u2019ve reached the daily limit of 5 Actor publications. Try again in 24 hours."}
```
