# seo-page-audit  2026-09-30T16:23:04Z bfd6232
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 2s
```
## unit tests
```
# tests 15
# pass 15
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 4 of 4 pages
[32mINFO[39m  [Status message]: Processed 4 of 4 pages. Charged 3; 1 not charged (errors, blocked or invalid).
```
## items
4 items
```json
{"url": "https://www.python.org/", "checkedAt": "2026-09-30T16:23:06.477Z", "finalUrl": "https://www.python.org/", "httpStatus": 200, "status": "ok", "score": 97, "errors": 0, "warnings": 0, "notices": 3, "issues": [{"severity": "notice", "code": "description_short", "message": "Meta description is short (52 characters; aim for 70-160)."}, {"severity": "notice", "code": "h1_multiple", "message": "5 <h1> headings."}, {"severity": "notice", "code": "canonical_missing", "message": "No canonical link."}], "title": "Welcome to Python.org", "titleLength": 21, "metaDescription": "The official home of the Python Programming Language", "metaDescriptionLength": 52, "h1": ["Intuitive Interpretation", "Compound Data Types", "All the Flow You’d Expect", "Functions Defined", "Quick & Easy to Learn"], "h2Count": 9, "h2": ["Get Started", "Download", "Docs", "Jobs", "Latest News", "Upcoming Events", "Success Stories", "Use Python for…", ">>> Python Software Foundation"], "canonical": null, "robotsMeta": null, "xRobotsTag": null, "lang": "en", "hreflang": [], "wordCount": 1001, "images": 1, "imagesMissingAlt": 0, "internalLinks": 126, "externalLinks": 78, "nofollowLinks": 0, "openGraphTags": ["og:type", "og:site_name", "og:title", "og:description", "og:image", "og:image:secure_url", "og:url"], "twitterCard": null, "schemaTypes": ["WebSite"], "https": true, "responseTimeMs": 7, "htmlBytes": 52943 …
```
```json
{"url": "https://example.com/", "checkedAt": "2026-09-30T16:23:06.487Z", "finalUrl": "https://example.com/", "httpStatus": 200, "status": "ok", "score": 81, "errors": 0, "warnings": 3, "notices": 4, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (14 characters; aim for 30-60)."}, {"severity": "warning", "code": "description_missing", "message": "No meta description."}, {"severity": "warning", "code": "h1_missing", "message": "No <h1> heading."}, {"severity": "notice", "code": "canonical_missing", "message": "No canonical link."}, {"severity": "notice", "code": "thin_content", "message": "Only about 27 words of text."}, {"severity": "notice", "code": "open_graph_missing", "message": "No Open Graph tags (links shared on social media will have no preview card)."}, {"severity": "notice", "code": "structured_data_missing", "message": "No schema.org JSON-LD structured data."}], "title": "Example Domain", "titleLength": 14, "metaDescription": null, "metaDescriptionLength": 0, "h1": [], "h2Count": 0, "h2": [], "canonical": null, "robotsMeta": null, "xRobotsTag": null, "lang": "en", "hreflang": [], "wordCount": 27, "images": 0, "imagesMissingAlt": 0, "internalLinks": 0, "externalLinks": 1, "nofollowLinks": 0, "openGraphTags": [], "twitterCard": null, "schemaTypes": [], "https": true, "responseTimeMs": 44, "htmlBytes": 713}
```
```json
{"url": "https://www.bbc.co.uk/news", "checkedAt": "2026-09-30T16:23:06.488Z", "finalUrl": "https://www.bbc.co.uk/news", "httpStatus": 200, "status": "ok", "score": 94, "errors": 0, "warnings": 1, "notices": 1, "issues": [{"severity": "warning", "code": "title_short", "message": "Title is short (15 characters; aim for 30-60)."}, {"severity": "notice", "code": "description_long", "message": "Meta description is long (245 characters)."}], "title": "Home - BBC News", "titleLength": 15, "metaDescription": "Visit BBC News for up-to-the-minute news, breaking news, video, audio and feature stories. BBC News provides trusted World and UK news as well as local and regional perspectives. Also entertainment, business, science, technology and health news.", "metaDescriptionLength": 245, "h1": ["BBC News"], "h2Count": 10, "h2": ["The video playlist", "More to explore", "US Politics Unspun", "Most watched", "Also in news", "Most read", "BBC News app", "BBC News on iPlayer and Sounds", "Elsewhere on the BBC", "Sport"], "canonical": "https://www.bbc.co.uk/news", "robotsMeta": "max-image-preview:large", "xRobotsTag": "bingbot: noarchive", "lang": "en-GB", "hreflang": ["en", "en-gb", "en-gb"], "wordCount": 2904, "images": 115, "imagesMissingAlt": 0, "internalLinks": 232, "externalLinks": 43, "nofollowLinks": 0, "openGraphTags": ["og:description", "og:image", "og:image:alt", "og:site_name", "og:t …
```
```json
{"url": "http://neverssl.com/", "checkedAt": "2026-09-30T16:23:06.488Z", "status": "unreachable", "error": "Could not load the page: fetch failed"}
```
