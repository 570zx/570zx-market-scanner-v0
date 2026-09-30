# Structured Data Extractor: Schema.org JSON-LD, Open Graph, Product Prices

Pull the machine-readable data out of any web page in one pass: schema.org JSON-LD, microdata types, Open Graph and Twitter card tags, and ready-to-use summaries of products (name, price, currency, stock, rating), organisations (name, phone, email, address, social profiles), articles, breadcrumbs and FAQs.

**$2 per 1,000 pages. Pages that fail, are blocked or are not HTML are not charged.**

## Good for

- **Price and stock monitoring** on shops that publish schema.org Product data, which most do for Google Shopping
- **SEO checks**: see which schema types a page has and whether its JSON-LD is broken
- **Lead enrichment**: organisation phone, email, address and social links from company sites
- **Link previews**: title, image and description as social networks see them

## Output (one row per page)

```json
{
  "url": "https://shop.example/p/carbon-hood",
  "status": "ok",
  "title": "Carbon Hood | Example",
  "schemaTypes": ["Product", "Organization", "BreadcrumbList"],
  "productName": "Carbon Hood",
  "price": 899,
  "currency": "GBP",
  "availability": "InStock",
  "products": [{"name": "Carbon Hood", "sku": "H-1", "brand": "Example", "price": 899, "currency": "GBP", "availability": "InStock", "ratingValue": 4.8, "reviewCount": 12}],
  "organization": {"type": "Organization", "name": "Example", "telephone": null, "address": "London, GB", "sameAs": ["https://instagram.com/example"]},
  "breadcrumbs": ["Home", "Hoods"],
  "openGraph": {"og:title": "Carbon Hood", "og:image": "https://shop.example/h.jpg"},
  "jsonLdErrors": [],
  "jsonLd": ["...every JSON-LD node as found..."]
}
```

## Input

- **Page URLs**: up to 10,000 per run.
- **Include raw JSON-LD**: on by default. Switch off for smaller output.
- **Respect robots.txt**: on by default.

## Limits

- It reads the HTML the server sends, without running JavaScript. Data injected only by scripts after load is not seen (most shops put JSON-LD in the HTML for search engines, so it usually is there).
- Prices are what the page declares in its structured data, not what the visible page shows. They normally match, but not always.
- No logins, CAPTCHA solving or block evasion. Sites that refuse automated access are skipped and not charged.
