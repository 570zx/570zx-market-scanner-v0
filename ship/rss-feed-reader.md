# ship rss-feed-reader 2026-09-30T16:30:08Z c00dcdcb151da2664345188cc9312b96c921739c
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## push
```
2026-09-30T16:30:27.283Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: fNzDnWQfqDQ9WKrFS
Build ID: QeyIuKsAw6fBnl0Ui
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/fNzDnWQfqDQ9WKrFS
Build URL: https://console.apify.com/actors/fNzDnWQfqDQ9WKrFS#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/rss-feed-reader
pricing + store details: 200  ok
pricing confirmed: True {'item': 0.0003}
test run: SUCCEEDED, Read 3 feeds, 9 items returned., secs 2.412, platform cost $0.00011712591481208801, items 10, ok 9
   {"input": "https://example.com/", "status": "no_feed_found", "error": "The page is not a feed and does not link to one"}
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "Give your LangGraph agent real-time web data with Apify", "link": "https://blog.apify.com/langgraph-agent-web-data/", "guid": "6ab514320fbf470001cfa583", "published": "2026-09-30T10:07:16.000Z", "updated": null, "author": "Antonello Zanini", "cat …
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "I gave my Reddit Actor to an AI agent, and it made all the same mistakes I did", "link": "https://blog.apify.com/reddit-actor-ai-agent-input-schema/", "guid": "6abba5c9efb3b50001d93c9e", "published": "2026-09-30T09:03:52.000Z", "updated": null, " …
   {"input": "https://blog.apify.com/", "status": "ok", "feedUrl": "https://blog.apify.com/rss/", "feedTitle": "Apify Blog", "feedFormat": "rss2", "title": "Build a documentation chatbot with LangChain, OpenAI, Pinecone, and Apify", "link": "https://blog.apify.com/how-to-use-langchain/", "guid": "64ad614dad28eb0001510a14", "published": "2026-09-29T06:25:00.000Z", "updated": null, "author": "Egop Gogo …
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "Developer policy update: Transparency, state policy, and what’s ahead", "link": "https://github.blog/news-insights/policy-news-and-insights/developer-policy-update-transparency-state-policy-and-whats-ahead/", "guid": "https://github.blog/?p= …
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "How we found 24 Android vulnerabilities using our open source AI security agent", "link": "https://github.blog/security/how-we-found-24-android-vulnerabilities-using-our-open-source-ai-security-agent/", "guid": "https://github.blog/?p=98105" …
   {"input": "https://github.blog/feed/", "status": "ok", "feedUrl": "https://github.blog/feed/", "feedTitle": "The GitHub Blog", "feedFormat": "rss2", "title": "Highlights from Git 2.56", "link": "https://github.blog/open-source/git/highlights-from-git-2-56/", "guid": "https://github.blog/?p=99087", "published": "2026-09-28T17:23:33.000Z", "updated": null, "author": "Elijah Newren", "categories": [" …
   {"input": "https://feeds.bbci.co.uk/news/rss.xml", "status": "ok", "feedUrl": "https://feeds.bbci.co.uk/news/rss.xml", "feedTitle": "BBC News", "feedFormat": "rss2", "title": "'We've just taken control': Passengers describe what happened on flight", "link": "https://www.bbc.co.uk/news/videos/cv70d22kd34do?at_medium=RSS&at_campaign=rss", "guid": "https://www.bbc.co.uk/news/videos/cv70d22kd34do#1",  …
```
