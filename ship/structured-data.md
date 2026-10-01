# ship structured-data 2026-10-01T17:28:21Z 8f08d4ccbc893481865ff7b8f7cd88c5ffdf98e5
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-10-01T17:28:46.107Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: wc3n5iwnLIcSuATnd
Build ID: mgi4EqBYUzUhLnOoj
Build number: 0.1.3

Actor URL: https://console.apify.com/actors/wc3n5iwnLIcSuATnd
Build URL: https://console.apify.com/actors/wc3n5iwnLIcSuATnd#/builds/0.1.3
```
## Apify setup and test run
```
actor Dodge_Bot/structured-data
pricing + store details: 200 unchanged pricing kept ok
pricing confirmed: True {'page': 0.002}
test run: SUCCEEDED, Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid)., secs 3.123, platform cost $0.00016065093773603441, items 4, ok 3
   {"url": "https://example.com/does-not-exist-404", "checkedAt": "2026-10-01T17:28:50.382Z", "finalUrl": "https://example.com/does-not-exist-404", "httpStatus": 404, "status": "http_error", "error": "The page answered HTTP 404"}
   {"url": "https://www.bbc.co.uk/news", "checkedAt": "2026-10-01T17:28:50.378Z", "finalUrl": "https://www.bbc.co.uk/news", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "Home - BBC News", "metaDescription": "Visit BBC News for up-to-the-minute news, breaking news, video, audio and feature stories. BBC News provides trusted Wor …
   {"url": "https://www.python.org/", "checkedAt": "2026-10-01T17:28:50.355Z", "finalUrl": "https://www.python.org/", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "Welcome to Python.org", "metaDescription": "The official home of the Python Programming Language", "canonical": null, "schemaTypes": ["WebSite"], "microdataTypes":  …
   {"url": "https://github.com/apify/crawlee", "checkedAt": "2026-10-01T17:28:50.380Z", "finalUrl": "https://github.com/apify/crawlee", "httpStatus": 200, "status": "ok", "productName": null, "price": null, "currency": null, "availability": null, "title": "GitHub - apify/crawlee: Crawlee—A web scraping and browser automation library for Node.js to build reliable crawlers. In JavaScript and TypeScript …
public: 200 True
```
