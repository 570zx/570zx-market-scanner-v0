# Broken Link Checker

Find broken links on any list of pages. It checks every link on each page, follows redirects, retries temporary errors, and reports one row per link with the HTTP status, the link text and whether it is broken. Optionally it also checks images, scripts and stylesheets.

**$0.50 per 1,000 links checked.** Links skipped because of robots.txt and pages that fail to load are free.

## Good for

- **SEO and site maintenance**: broken links hurt users and rankings
- **Agencies**: a quick broken-link report for a client or prospect
- **After a migration or redesign**: find links to pages that moved
- **Scheduled checks**: run weekly and get only the broken ones (`Only return broken links`)

## Output (one row per link)

```json
{
  "page": "https://www.python.org/",
  "status": "ok",
  "link": "https://www.python.org/jobs/",
  "linkText": "Jobs",
  "kind": "link",
  "internal": true,
  "httpStatus": 200,
  "finalUrl": "https://www.python.org/jobs/",
  "redirected": false,
  "broken": false,
  "error": null
}
```

`broken` is true for HTTP 400 and above, and for links that can't be reached at all (the reason is in `error`, for example `ENOTFOUND` for a dead domain or `timed out`).

## How it checks

- A `HEAD` request first; if the server refuses HEAD it retries with `GET`, as many servers mishandle HEAD.
- Temporary errors (429, 502, 503, 504, network hiccups) are retried before a link is called broken.
- At most 2 requests at a time to any one site, so it never hammers a server.
- A link that appears on many pages is fetched once per run.

## Limits

- It checks the pages you list; it does not crawl the site. Feed it a sitemap's URLs to cover everything.
- Some sites block automated requests (for example LinkedIn or some shops return 999 or 403). Those show as broken with their status code; check them by hand before removing them.
- Links added by JavaScript after the page loads are not seen.
