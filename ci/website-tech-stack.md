# website-tech-stack  2026-09-30T16:25:05Z 3e1734e
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 2s
```
## unit tests
```
# tests 17
# pass 17
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 3 of 3 websites
[32mINFO[39m  [Status message]: Processed 3 of 3 websites. Charged 3; 0 not charged (errors, blocked or invalid). 1 invalid URLs skipped.
```
## items
3 items
```json
{"inputUrl": "https://nextjs.org/", "checkedAt": "2026-09-30T16:25:07.960Z", "finalUrl": "https://nextjs.org/", "httpStatus": 200, "status": "ok", "domain": "nextjs.org", "technologyCount": 5, "technologyNames": ["Tailwind CSS", "Vercel", "Next.js", "React", "HSTS"], "byCategory": {"CSS framework": ["Tailwind CSS"], "Hosting": ["Vercel"], "JavaScript framework": ["Next.js"], "JavaScript library": ["React"], "Security": ["HSTS"]}, "cms": null, "ecommerce": null, "framework": "Next.js", "hosting": "Vercel", "cdn": null, "analytics": [], "technologies": [{"name": "Tailwind CSS", "category": "CSS framework", "version": null, "evidence": ["page markup"], "confidence": "medium"}, {"name": "Vercel", "category": "Hosting", "version": null, "evidence": ["header server", "header x-vercel-id"], "confidence": "high"}, {"name": "Next.js", "category": "JavaScript framework", "version": null, "evidence": ["header x-powered-by", "page markup"], "confidence": "high"}, {"name": "React", "category": "JavaScript library", "version": null, "evidence": ["implied by Next.js"], "confidence": "medium"}, {"name": "HSTS", "category": "Security", "version": null, "evidence": ["header strict-transport-security"], "confidence": "high"}]}
```
```json
{"inputUrl": "https://wordpress.org/", "checkedAt": "2026-09-30T16:25:07.959Z", "finalUrl": "https://wordpress.org/", "httpStatus": 200, "status": "ok", "domain": "wordpress.org", "technologyCount": 5, "technologyNames": ["WordPress", "Google Fonts", "HSTS", "Google Tag Manager", "Nginx"], "byCategory": {"CMS": ["WordPress"], "Font": ["Google Fonts"], "Security": ["HSTS"], "Tag manager": ["Google Tag Manager"], "Web server": ["Nginx"]}, "cms": "WordPress", "ecommerce": null, "framework": null, "hosting": null, "cdn": null, "analytics": [], "technologies": [{"name": "WordPress", "category": "CMS", "version": "7.2", "evidence": ["meta generator", "asset URL"], "confidence": "high"}, {"name": "Google Fonts", "category": "Font", "version": null, "evidence": ["asset URL"], "confidence": "medium"}, {"name": "HSTS", "category": "Security", "version": null, "evidence": ["header strict-transport-security"], "confidence": "high"}, {"name": "Google Tag Manager", "category": "Tag manager", "version": null, "evidence": ["page markup"], "confidence": "medium"}, {"name": "Nginx", "category": "Web server", "version": null, "evidence": ["header server"], "confidence": "high"}]}
```
```json
{"inputUrl": "https://www.shopify.com/", "checkedAt": "2026-09-30T16:25:07.947Z", "finalUrl": "https://www.shopify.com/", "httpStatus": 200, "status": "ok", "domain": "www.shopify.com", "technologyCount": 3, "technologyNames": ["Cloudflare", "Shopify", "HSTS"], "byCategory": {"CDN": ["Cloudflare"], "E-commerce": ["Shopify"], "Security": ["HSTS"]}, "cms": null, "ecommerce": "Shopify", "framework": null, "hosting": null, "cdn": "Cloudflare", "analytics": [], "technologies": [{"name": "Cloudflare", "category": "CDN", "version": null, "evidence": ["header server", "header cf-ray"], "confidence": "high"}, {"name": "Shopify", "category": "E-commerce", "version": null, "evidence": ["asset URL"], "confidence": "medium"}, {"name": "HSTS", "category": "Security", "version": null, "evidence": ["header strict-transport-security"], "confidence": "high"}]}
```
