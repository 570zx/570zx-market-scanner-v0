# ship sitemap-urls 2026-09-30T16:18:10Z c7de7ed
## unit tests
```
# tests 18
# pass 18
# fail 0
```
## push
```
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: 083KFjXXR0IbVyzVV
Build ID: 7Ozs2Wddo5zlJGKDu
Build number: 0.1.3

Actor URL: https://console.apify.com/actors/083KFjXXR0IbVyzVV
Build URL: https://console.apify.com/actors/083KFjXXR0IbVyzVV#/builds/0.1.3
```
## Apify setup and test run
```
actor Dodge_Bot/sitemap-urls
pricing + store details: 400  {"type": "schema-validation", "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"}
pricing confirmed: True {'url': 0.0003}
test run: SUCCEEDED, Read 3 of 3 sites and found 40 URLs., secs 1.982, platform cost $0.00010855062291357253, items 42, ok 40
   {"site": "https://www.python.org/", "domain": "www.python.org", "status": "no_sitemap_found", "sitemapsTried": ["https://www.python.org/sitemap.xml", "https://www.python.org/sitemap_index.xml", "https://www.python.org/wp-sitemap.xml", "https://www.python.org/sitemap.txt"], "errors": ["https://www.python.org/sitemap.xml: HTTP 404", "https://www.python.org/sitemap_index.xml: HTTP 404", "https://www. …
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/about", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/actors", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/ai-agents", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/ai-agents/ai-agent-marketplace", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/alternatives", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
   {"site": "https://apify.com/sitemap.xml", "domain": "apify.com", "status": "ok", "url": "https://apify.com/alternatives/bardeen-alternatives", "lastmod": null, "changefreq": null, "priority": null, "images": 0, "sitemap": "https://apify.com/sitemap/pages.xml"}
public: 200 True
```
