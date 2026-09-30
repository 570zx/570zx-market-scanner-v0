# SEO Page Audit: Bulk On-Page SEO Checker

Audit any number of pages for on-page SEO. Each page gets a 0-100 score and a plain-English list of what to fix, plus the underlying numbers: title and meta description length, headings, canonical, noindex, mobile viewport, image alt text, internal and external links, word count, Open Graph, schema.org, HTTPS and server response time.

**$3 per 1,000 pages.** A 404 or 500 page is still audited and charged, because the audit reports it. Unreachable, blocked or non-HTML URLs are free.

## Good for

- Quick audits of a client or prospect site: feed in its sitemap URLs (for example from a sitemap extractor)
- Catching SEO regressions after a release: run it on a schedule and compare scores
- Finding pages with missing titles, descriptions, H1s or alt text across a large site

## Output (one row per page)

```json
{
  "url": "https://example.com/",
  "status": "ok",
  "httpStatus": 200,
  "score": 81,
  "errors": 0,
  "warnings": 3,
  "notices": 4,
  "issues": [
    {"severity": "warning", "code": "title_short", "message": "Title is short (14 characters; aim for 30-60)."},
    {"severity": "warning", "code": "description_missing", "message": "No meta description."},
    {"severity": "warning", "code": "h1_missing", "message": "No <h1> heading."}
  ],
  "title": "Example Domain",
  "titleLength": 14,
  "wordCount": 28,
  "imagesMissingAlt": 0,
  "internalLinks": 0,
  "externalLinks": 1,
  "schemaTypes": [],
  "responseTimeMs": 120
}
```

### Checks

Errors: HTTP error status, no HTTPS, missing title, noindex (meta or `X-Robots-Tag`). Warnings: title too short or long, no meta description, no H1, no viewport, robots nofollow, slow server (over 3 s), HTML over 3 MB. Notices: description length, several H1s, missing or foreign canonical, no `lang`, images without alt, thin content (under 200 words), no Open Graph, no structured data, no favicon, redirects.

Score = 100 minus 15 per error, 5 per warning and 1 per notice (minimum 0).

## Limits

- One page per URL: it does not crawl the site. Give it the list of pages you want checked.
- The HTML is read as the server sends it, without running JavaScript.
- Speed is the server's response time for the HTML only, not full page load or Core Web Vitals.
- It respects robots.txt by default. Turn that off only for your own sites.
