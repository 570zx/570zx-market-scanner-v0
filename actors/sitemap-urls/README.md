# Sitemap URL Extractor

Get every page URL a website publishes in its XML sitemaps, with last-modified date, change frequency, priority and image count. Give it a domain and it finds the sitemaps itself, through robots.txt and the usual locations. It follows sitemap indexes, unpacks `.xml.gz` files and reads plain-text sitemaps too.

**$0.30 per 1,000 URLs. Sites without a sitemap are not charged.**

## Good for

- Building a crawl list or the input for an SEO audit, price monitor or content scraper
- Counting and comparing how many pages competitors publish
- Spotting new or recently changed pages (sort by `lastmod`)
- Checking that your own sitemaps are found and valid

## Output (one row per URL; real result)

```json
{
  "site": "https://apify.com/",
  "domain": "apify.com",
  "status": "ok",
  "url": "https://apify.com/about",
  "lastmod": null,
  "changefreq": null,
  "priority": null,
  "images": 0,
  "sitemap": "https://apify.com/sitemap/pages.xml"
}
```

If a site has no sitemap you get one row with `status: "no_sitemap_found"` and the locations that were tried (free).

## Input

- **Websites or sitemap URLs**: a domain (auto-discovery) or a direct sitemap link. Up to 500 per run.
- **Maximum URLs per site**: default 5,000, up to 200,000.
- **Respect robots.txt**: on by default.

## Notes

- Duplicates across sitemaps are removed per site.
- `lastmod`, `changefreq` and `priority` are what the site declares; many sites leave them out or never update them.
- Sitemaps list what a site wants indexed. Pages missing from the sitemap are not discovered (this tool does not crawl links).
