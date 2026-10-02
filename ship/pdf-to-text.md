# ship pdf-to-text 2026-10-02T17:28:21Z 2d0c7738a1009a5aeb79561d43cf68d9c71617e1
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-10-02T17:28:49.769Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: nkeduW8KCcd89Op9d
Build ID: B55Y5MVbpw0cl20kV
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/nkeduW8KCcd89Op9d
Build URL: https://console.apify.com/actors/nkeduW8KCcd89Op9d#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/pdf-to-text
pricing + store details: 200 unchanged pricing kept ok
pricing confirmed: True {'page': 0.0005}
test run: SUCCEEDED, Processed 3 of 3 PDFs. Charged 4; 1 not charged (errors, blocked or invalid)., secs 3.273, platform cost $0.0001595443543593089, items 3, ok 2
   {"url": "https://example.com/", "checkedAt": "2026-10-02T17:28:54.670Z", "httpStatus": 200, "status": "not_a_pdf", "error": "The URL did not return a PDF (content type text/html; charset=utf-8)"}
   {"url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "checkedAt": "2026-10-02T17:28:54.668Z", "finalUrl": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "status": "ok", "bytes": 13264, "pageCount": 1, "pagesRead": 1, "title": null, "author": "Evangelos Vlachogiannis", "subject": null, "keywords": null, "creator": "Writer", "producer": "Open …
   {"url": "https://arxiv.org/pdf/1706.03762", "checkedAt": "2026-10-02T17:28:54.647Z", "finalUrl": "https://arxiv.org/pdf/1706.03762", "status": "ok", "bytes": 2215244, "pageCount": 15, "pagesRead": 3, "title": null, "author": null, "subject": null, "keywords": null, "creator": "LaTeX with hyperref", "producer": "pdfTeX-1.40.25", "createdAt": "2024-04-10T21:11:43.000Z", "modifiedAt": "2024-04-10T21: …
public: 200 True
```
