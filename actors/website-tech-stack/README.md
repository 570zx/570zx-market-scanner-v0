# Website Tech Stack Detector

Find out what any website is built with: CMS, e-commerce platform, JavaScript framework, analytics, ad pixels, tag managers, hosting, CDN, payments, live chat, cookie consent and more. Give it a list of domains; get one row per site with every technology found, the version where the site exposes it, and the evidence for each match.

**$2 per 1,000 websites. Sites that are down, blocked or return errors are not charged.**

## Good for

- **Sales prospecting**: find shops on Shopify or WooCommerce, sites using a competitor's tool, or sites without analytics
- **Agencies**: check a prospect's stack before a pitch
- **Market research**: measure how common a platform is across a list of sites
- **Due diligence**: see what a company runs on its public site

## What it detects

More than 130 technologies across CMS (WordPress, Drupal, Wix, Squarespace, Webflow, Framer, HubSpot CMS and more), e-commerce (Shopify, WooCommerce, Magento, BigCommerce, PrestaShop, Salesforce Commerce Cloud), frameworks (Next.js, Nuxt, React, Vue, Angular, Svelte, Astro, Gatsby), analytics and pixels (Google Analytics, Tag Manager, Meta Pixel, TikTok, LinkedIn, Hotjar, Clarity, Plausible, Segment, Mixpanel), hosting and CDN (Cloudflare, Vercel, Netlify, CloudFront, Fastly, Akamai), servers, payments (Stripe, PayPal, Klarna), chat and support (Intercom, Zendesk, Drift, Tawk.to), email marketing (Klaviyo, Mailchimp), cookie consent, CAPTCHAs and more.

## Output (one row per website)

```json
{
  "inputUrl": "https://wordpress.org/",
  "status": "ok",
  "cms": "WordPress",
  "ecommerce": null,
  "framework": null,
  "hosting": null,
  "cdn": null,
  "technologyCount": 5,
  "technologyNames": ["WordPress", "Google Fonts", "HSTS", "Google Tag Manager", "Nginx"],
  "technologies": [
    {"name": "WordPress", "category": "CMS", "version": "7.2", "evidence": ["meta generator", "asset URL"], "confidence": "high"}
  ]
}
```

`confidence` is `high` when the evidence is a response header, a generator tag or more than one signal, `medium` for a single markup or asset match or an implied technology (for example Next.js implies React).

## How it works, and its limits

- It reads the home page (or the URL you give) and its response headers once. No browser, no logins.
- Tools that load only after scripts run, or only on inner pages (checkout, account), may be missed. Give it the specific page if you need those.
- Matching is deliberately conservative: a missed tool is better than a wrong one.
- It respects robots.txt by default and skips sites that refuse automated access (not charged).
