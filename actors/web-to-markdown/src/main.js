import {Fetcher, readUrls, isHtml} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {convert, chunkMarkdown, approxTokens, countWords, tidyMarkdown} from './convert.js';

main(async input => {
  const {urls, invalid, overLimit} = readUrls(input, 'urls', 10000);
  if (!urls.length) throw userError('Add at least one page URL to "Page URLs".');
  const mode = input.extractMode === 'full' ? 'full' : 'article';
  const maxChars = Math.max(0, Number(input.maxCharacters) || 0);
  const chunkSize = Math.max(0, Number(input.chunkTokens) || 0);
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 8_000_000});
  const work = async url => {
    const base = {url, fetchedAt: new Date().toISOString()};
    let r;
    try { r = await fetcher.get(url); } catch (e) {
      return {billable: false, item: {...base, status: e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', error: e.message}};
    }
    if (r.status >= 400) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'http_error', error: `The page answered HTTP ${r.status}`}};
    let out;
    if (isHtml(r.contentType)) out = convert(r.body, r.finalUrl, {mode, includeLinks: Boolean(input.includeLinks)});
    else if (/text\/(plain|markdown)/i.test(r.contentType)) out = {title: null, markdown: tidyMarkdown(r.body), extraction: 'plain_text'};
    else return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'unsupported_content', error: `Content type ${r.contentType} is not a web page`}};
    let markdown = out.markdown;
    const truncated = maxChars > 0 && markdown.length > maxChars;
    if (truncated) markdown = markdown.slice(0, maxChars);
    if (countWords(markdown) < 5) return {billable: false, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'no_text', error: 'The page has almost no text (it may need JavaScript to render).'}};
    return {billable: true, item: {...base, finalUrl: r.finalUrl, httpStatus: r.status, status: 'ok', ...out, markdown,
      wordCount: countWords(markdown), characters: markdown.length, approxTokens: approxTokens(markdown), truncated,
      chunks: chunkSize ? chunkMarkdown(markdown, chunkSize) : undefined}};
  };
  return runItems({items: urls, concurrency: 8, event: 'page', work, label: 'pages',
    summaryExtra: () => [invalid.length ? `${invalid.length} invalid URLs skipped.` : '', overLimit ? `${overLimit} URLs over the per-run limit skipped.` : ''].filter(Boolean)});
});
