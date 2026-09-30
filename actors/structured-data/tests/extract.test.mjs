import test from 'node:test';
import assert from 'node:assert/strict';
import {extract} from '../src/extract.js';

const productPage = `<!doctype html><html><head><title>Carbon Hood | 570ZX</title>
<meta name="description" content="Dry carbon hood.">
<link rel="canonical" href="/p/hood">
<meta property="og:title" content="Carbon Hood"><meta property="og:image" content="https://x.com/h.jpg"><meta property="product:price:amount" content="899">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"Carbon Hood","sku":"H-1","brand":{"@type":"Brand","name":"570ZX"},
"offers":{"@type":"Offer","price":"899.00","priceCurrency":"GBP","availability":"https://schema.org/InStock"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"12"}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"570ZX","url":"https://570zx.com","sameAs":["https://instagram.com/570zx"],
"address":{"@type":"PostalAddress","addressLocality":"London","addressCountry":"GB"}},{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":2,"name":"Hoods"},{"@type":"ListItem","position":1,"name":"Home"}]}]}</script>
</head><body><div itemscope itemtype="https://schema.org/Offer"></div></body></html>`;

test('product page: product, organisation, breadcrumbs, OG, twitter, canonical', () => {
  const d = extract(productPage, 'https://shop.example/p/hood?ref=x');
  assert.equal(d.title, 'Carbon Hood | 570ZX');
  assert.equal(d.canonical, 'https://shop.example/p/hood');
  assert.deepEqual(d.schemaTypes.sort(), ['BreadcrumbList', 'Organization', 'Product']);
  assert.deepEqual(d.microdataTypes, ['Offer']);
  const p = d.products[0];
  assert.equal(p.name, 'Carbon Hood'); assert.equal(p.brand, '570ZX'); assert.equal(p.price, 899); assert.equal(p.currency, 'GBP');
  assert.equal(p.availability, 'InStock'); assert.equal(p.ratingValue, 4.8); assert.equal(p.reviewCount, 12);
  assert.equal(d.organization.name, '570ZX'); assert.equal(d.organization.address, 'London, GB');
  assert.deepEqual(d.breadcrumbs, ['Home', 'Hoods']);
  assert.equal(d.openGraph['og:title'], 'Carbon Hood'); assert.equal(d.openGraph['product:price:amount'], '899');
  assert.equal(d.twitterCard['twitter:card'], 'summary_large_image');
  assert.equal(d.jsonLdBlocks, 2); assert.deepEqual(d.jsonLdErrors, []);
});

test('article, FAQ, aggregate offers, broken JSON-LD reported', () => {
  const h = `<script type="application/ld+json">[{"@type":"BlogPosting","headline":"H","datePublished":"2026-01-02","author":[{"@type":"Person","name":"A"},{"name":"B"}]},
  {"@type":"FAQPage","mainEntity":[{"@type":"Question"},{"@type":"Question"}]},
  {"@type":"Product","name":"T","offers":{"@type":"AggregateOffer","lowPrice":10,"highPrice":"20","priceCurrency":"USD","offerCount":3}}]</script>
  <script type="application/ld+json">{nope</script>`;
  const d = extract(h, 'https://a.com/');
  assert.deepEqual(d.article.author, ['A', 'B']); assert.equal(d.article.headline, 'H');
  assert.equal(d.faqQuestions, 2);
  assert.equal(d.products[0].price, 10); assert.equal(d.products[0].highPrice, 20); assert.equal(d.products[0].offerCount, 3);
  assert.equal(d.jsonLdErrors.length, 1);
});

test('page with no structured data returns empty structures, not errors', () => {
  const d = extract('<html><head><title>x</title></head><body>hi</body></html>', 'https://a.com/');
  assert.deepEqual(d.schemaTypes, []); assert.deepEqual(d.products, []); assert.equal(d.organization, null); assert.equal(d.breadcrumbs, null);
});
