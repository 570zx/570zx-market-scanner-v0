import {stripNonContent, findTags, elementTexts, jsonLdBlocks, jsonLdNodes, typesOf, metaTags, absolutize} from './shared/html.js';

const first = v => (Array.isArray(v) ? v[0] : v);
const str = v => {
  v = first(v);
  if (v == null) return null;
  if (typeof v === 'object') return v.name ?? v['@id'] ?? v.url ?? null;
  const s = String(v).trim();
  return s || null;
};
const num = v => { const n = Number(String(first(v) ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) && String(first(v) ?? '').trim() !== '' ? n : null; };
const isType = (node, ...names) => typesOf(node).some(t => names.includes(t.replace(/^https?:\/\/schema\.org\//, '')));
const availability = v => (str(v) ?? '').replace(/^https?:\/\/schema\.org\//, '') || null;

function offerOf(p) {
  const offers = [].concat(p.offers ?? []);
  const o = offers[0];
  if (!o) return {};
  if (isType(o, 'AggregateOffer')) return {price: num(o.lowPrice ?? o.price), highPrice: num(o.highPrice), currency: str(o.priceCurrency), availability: availability(o.availability), offerCount: num(o.offerCount)};
  const spec = first(o.priceSpecification);
  return {price: num(o.price ?? spec?.price), currency: str(o.priceCurrency ?? spec?.priceCurrency), availability: availability(o.availability), offerCount: offers.length};
}

export function products(nodes) {
  return nodes.filter(n => isType(n, 'Product', 'ProductGroup')).map(p => {
    const rating = p.aggregateRating ?? {};
    return {name: str(p.name), sku: str(p.sku), gtin: str(p.gtin13 ?? p.gtin12 ?? p.gtin ?? p.gtin14 ?? p.gtin8), mpn: str(p.mpn), brand: str(p.brand),
      ...offerOf(p), ratingValue: num(rating.ratingValue), reviewCount: num(rating.reviewCount ?? rating.ratingCount), image: str(p.image), url: str(p.url)};
  });
}

export function organization(nodes) {
  const o = nodes.find(n => isType(n, 'Organization', 'Corporation', 'LocalBusiness', 'Store', 'Restaurant', 'AutoRepair', 'AutoDealer', 'ProfessionalService', 'MedicalBusiness', 'LegalService', 'NewsMediaOrganization'))
    ?? nodes.find(n => typesOf(n).some(t => /Business|Organization/.test(t)));
  if (!o) return null;
  const a = first(o.address) ?? {};
  const address = typeof a === 'string' ? a : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, str(a.addressCountry)].filter(Boolean).join(', ') || null;
  return {type: typesOf(o)[0], name: str(o.name), url: str(o.url), logo: str(o.logo), telephone: str(o.telephone), email: str(o.email), address,
    sameAs: [].concat(o.sameAs ?? []).map(String).slice(0, 20)};
}

export function article(nodes) {
  const a = nodes.find(n => isType(n, 'Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report'));
  if (!a) return null;
  return {type: typesOf(a)[0], headline: str(a.headline ?? a.name), datePublished: str(a.datePublished), dateModified: str(a.dateModified),
    author: [].concat(a.author ?? []).map(x => str(x)).filter(Boolean).slice(0, 10), publisher: str(a.publisher)};
}

export function breadcrumbs(nodes) {
  const b = nodes.find(n => isType(n, 'BreadcrumbList'));
  if (!b) return null;
  return [].concat(b.itemListElement ?? []).sort((x, y) => (num(x.position) ?? 0) - (num(y.position) ?? 0)).map(i => str(i.name) ?? str(i.item)).filter(Boolean);
}

export function extract(html, pageUrl) {
  const blocks = jsonLdBlocks(html);
  const nodes = jsonLdNodes(blocks);
  const clean = stripNonContent(html);
  const meta = metaTags(clean);
  const og = {}, twitter = {};
  for (const [k, v] of Object.entries(meta.property)) if (k.startsWith('og:') || k.startsWith('product:') || k.startsWith('article:')) og[k] = v;
  for (const [k, v] of Object.entries({...meta.name, ...meta.property})) if (k.startsWith('twitter:')) twitter[k] = v;
  const microdataTypes = [...new Set(findTags(clean, ['div', 'span', 'section', 'article', 'li', 'main', 'body', 'html', 'a', 'ul', 'ol', 'p', 'header', 'footer', 'nav', 'table', 'tr', 'td', 'img', 'meta', 'link', 'address', 'figure'])
    .map(t => t.attrs.itemtype).filter(Boolean).flatMap(s => s.split(/\s+/)).map(s => s.replace(/^https?:\/\/schema\.org\//, '')))];
  const canonical = findTags(clean, ['link']).find(t => (t.attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.attrs.href;
  const faq = nodes.find(n => isType(n, 'FAQPage'));
  const types = [...new Set(nodes.flatMap(typesOf).map(t => t.replace(/^https?:\/\/schema\.org\//, '')))];
  return {
    title: elementTexts(clean, 'title')[0]?.text ?? null,
    metaDescription: meta.name.description ?? null,
    canonical: canonical ? absolutize(canonical, pageUrl) : null,
    schemaTypes: types,
    microdataTypes,
    jsonLdBlocks: blocks.length,
    jsonLdErrors: blocks.filter(b => !b.ok).map(b => b.error),
    openGraph: og,
    twitterCard: twitter,
    products: products(nodes),
    organization: organization(nodes),
    article: article(nodes),
    breadcrumbs: breadcrumbs(nodes),
    faqQuestions: faq ? [].concat(faq.mainEntity ?? []).length : 0,
    jsonLd: nodes.slice(0, 50)
  };
}
