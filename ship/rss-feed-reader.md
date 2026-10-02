# ship rss-feed-reader 2026-10-02T17:30:59Z 2d0c7738a1009a5aeb79561d43cf68d9c71617e1
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-10-02T17:31:21.502Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: fNzDnWQfqDQ9WKrFS
Build ID: jhXbGBcsVMmb0PdYh
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/fNzDnWQfqDQ9WKrFS
Build URL: https://console.apify.com/actors/fNzDnWQfqDQ9WKrFS#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/rss-feed-reader
pricing + store details: 200 unchanged pricing kept ok
pricing confirmed: True {'item': 0.0003}
test run: SUCCEEDED, Read 3 feeds, 9 items returned., secs 2.009, platform cost $0.00016388413545820449, items 10, ok 9
   {"input": "https://example.com/", "status": "no_feed_found", "error": "The page is not a feed and does not link to one"}
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "AI is changing developer work. Here are three skills to strengthen.", "link": "https://github.blog/ai-and-ml/ai-is-rewriting-the-developer-career-ladder-heres-how-to-stand-out/", "guid": "https://github.blog/?p=99170", "published": "2026-10- …
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "10 technical talks I’m excited about at GitHub Universe 2026", "link": "https://github.blog/news-insights/company-news/10-technical-talks-im-excited-about-at-github-universe-2026/", "guid": "https://github.blog/?p=99192", "published": "2026- …
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "Developer policy update: Transparency, state policy, and what’s ahead", "link": "https://github.blog/news-insights/policy-news-and-insights/developer-policy-update-transparency-state-policy-and-whats-ahead/", "guid": "https://github.blog/?p= …
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "AI agent vs. MCP server: which one should you build?", "link": "https://blog.apify.com/ai-agent-vs-mcp-server/", "guid": "6abd5bc6501b5a00015e909b", "published": "2026-10-02T07:34:10.000Z", "updated": null, "author": "Satyam Tripathi", "categorie …
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "Claude refused to rank my Google Trends data. Then it invented the ranking anyway", "link": "https://blog.apify.com/google-trends-compare-keywords/", "guid": "6abe2753501b5a00015e90c5", "published": "2026-10-01T11:53:55.000Z", "updated": null, "a …
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "Martina Gelnerová: from travel agency to data analyst", "link": "https://blog.apify.com/martina-gelnerova-data-career-change/", "guid": "6a841aaa343bc200019df9e6", "published": "2026-10-01T08:46:24.000Z", "updated": null, "author": "Nathanael Dur …
   {"input": "https://feeds.bbci.co.uk/news/rss.xml", "status": "ok", "feedUrl": "https://feeds.bbci.co.uk/news/rss.xml", "feedTitle": "BBC News", "feedFormat": "rss2", "title": "Watch: Why has UK diesel price hit an all time high?", "link": "https://www.bbc.co.uk/news/videos/c6m2d3mpm7r8o?at_medium=RSS&at_campaign=rss", "guid": "https://www.bbc.co.uk/news/videos/c6m2d3mpm7r8o#1", "published": "2026- …
public: 200 True
```
