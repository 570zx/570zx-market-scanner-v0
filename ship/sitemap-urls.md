# ship sitemap-urls 2026-09-30T16:02:26Z 6cdfd78
## unit
```
# tests 18
# suites 0
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 89.176975
```
## push
```
2026-09-30T16:02:06.221Z ACTOR: Building container image (cache enabled).
2026-09-30T16:02:17.139Z ACTOR: Pushing container image to repository.
2026-09-30T16:02:18.180Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: 083KFjXXR0IbVyzVV
Build ID: d6dhDP7hSSRZmrTp3
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/083KFjXXR0IbVyzVV
Build URL: https://console.apify.com/actors/083KFjXXR0IbVyzVV#/builds/0.1.1
```
## ship
```
actor Dodge_Bot/sitemap-urls
pricing + store details: 200  ok
pricing confirmed: True {'url': 0.0003}
test run: SUCCEEDED, Read 3 of 3 sites and found 40 URLs., secs 3.597, platform cost $0.00015442035637299218, items 42, ok 40
   {"site": "https://www.python.org/", "domain": "www.python.org", "status": "no_sitemap_found", "sitemapsTried": ["https://www.python.org/sitemap.xml", "https://www.python.org/sitemap_index.xml", "https://www.python.org/wp-sitemap.xml", "https://www.python.org/sitemap.txt"], "errors": ["https://www.python.org/sitemap.xml: HTTP 404", "https://www.python.org/sitemap_index.xml: HTTP 404", "https://www. …
   {"site": "https://example.com/", "domain": "example.com", "status": "no_sitemap_found", "sitemapsTried": ["https://example.com/sitemap.xml", "https://example.com/sitemap_index.xml", "https://example.com/wp-sitemap.xml", "https://example.com/sitemap.txt"], "errors": ["https://example.com/sitemap.xml: HTTP 404", "https://example.com/sitemap_index.xml: HTTP 404", "https://example.com/wp-sitemap.xml:  …
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/about", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/actors", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/ai-agents", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/ai-agents/ai-agent-marketplace", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/alternatives", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
public: 403 {"type": "readme-required", "message": "This Actor can't be published because its default build has no README. Add a README.md to the source code, rebuild, and publish again."}
```
