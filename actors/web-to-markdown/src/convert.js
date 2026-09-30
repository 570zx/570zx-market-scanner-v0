import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';

const REMOVE = 'script,style,noscript,template,iframe,svg,canvas,form,button,input,select,textarea,nav,footer,header,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[aria-hidden="true"],.cookie,.cookies,#cookie-banner,.newsletter,.advert,.ads,.ad';

function turndown(baseUrl) {
  const td = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', linkStyle: 'inlined'});
  td.use(gfm);
  td.remove(['script', 'style', 'noscript', 'template', 'iframe']);
  // Make links and images absolute so the Markdown works outside the page.
  td.addRule('absLinks', {
    filter: node => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => {
      const text = content.trim();
      const href = abs(node.getAttribute('href'), baseUrl);
      if (!text) return '';
      if (!href || /^javascript:/i.test(href)) return text;
      return `[${text}](${href})`;
    }
  });
  td.addRule('absImages', {
    filter: 'img',
    replacement: (content, node) => {
      const src = abs(node.getAttribute('src') || node.getAttribute('data-src') || '', baseUrl);
      if (!src || src.startsWith('data:')) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      return `![${alt}](${src})`;
    }
  });
  return td;
}

function abs(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

export function tidyMarkdown(md) {
  return String(md ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const approxTokens = s => Math.ceil(String(s ?? '').length / 4);
export const countWords = s => (String(s ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

// Split Markdown into chunks of about `size` tokens, on paragraph boundaries, carrying the latest heading.
export function chunkMarkdown(md, size) {
  if (!size || size <= 0) return null;
  const limit = size * 4;
  const paras = md.split(/\n{2,}/);
  const chunks = [];
  let cur = '', heading = '';
  const flush = () => { if (cur.trim()) chunks.push({index: chunks.length, heading: heading || null, text: cur.trim(), approxTokens: approxTokens(cur)}); cur = ''; };
  for (const p of paras) {
    if (/^#{1,6}\s/.test(p)) { flush(); heading = p.replace(/^#+\s*/, '').trim(); }
    if (p.length > limit) {
      flush();
      for (let i = 0; i < p.length; i += limit) { cur = p.slice(i, i + limit); flush(); }
      continue;
    }
    if ((cur + '\n\n' + p).length > limit) flush();
    cur = cur ? cur + '\n\n' + p : p;
  }
  flush();
  return chunks;
}

// html -> {title, byline, siteName, lang, excerpt, publishedTime, markdown, extraction, links}
export function convert(html, url, {mode = 'article', includeLinks = false} = {}) {
  const {document} = parseHTML(html);
  const meta = n => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.getAttribute('content')?.trim() || null;
  const lang = document.documentElement?.getAttribute('lang') || null;
  const pageTitle = document.querySelector('title')?.textContent?.trim() || meta('og:title');
  const links = includeLinks ? [...new Set([...document.querySelectorAll('a[href]')].map(a => abs(a.getAttribute('href'), url)).filter(h => h && /^https?:/.test(h)))].slice(0, 2000) : undefined;
  const td = turndown(url);

  let article = null, extraction = 'full';
  if (mode === 'article') {
    try {
      const clone = parseHTML(html).document;
      article = new Readability(clone, {charThreshold: 300, keepClasses: false}).parse();
    } catch { article = null; }
  }
  let markdown;
  if (article?.content && countWords(article.textContent) >= 60) {
    extraction = 'main_content';
    markdown = td.turndown(article.content);
  } else {
    for (const el of document.querySelectorAll(REMOVE)) el.remove();
    const body = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
    markdown = td.turndown(body?.innerHTML ?? '');
    extraction = mode === 'article' ? 'full_page_fallback' : 'full_page';
  }
  markdown = tidyMarkdown(markdown);
  const title = article?.title?.trim() || pageTitle || null;
  if (title && !markdown.startsWith('# ')) markdown = `# ${title}\n\n${markdown}`;
  return {
    title, byline: article?.byline?.trim() || meta('author'), siteName: article?.siteName || meta('og:site_name'), lang,
    excerpt: article?.excerpt?.trim() || meta('description') || meta('og:description'),
    publishedTime: article?.publishedTime || meta('article:published_time'),
    markdown, extraction, links
  };
}
