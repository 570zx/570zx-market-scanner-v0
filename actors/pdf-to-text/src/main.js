import {Fetcher, readUrls} from './shared/web.js';
import {main, runItems, userError} from './shared/kit.js';
import {readPdf, isPdf} from './pdf.js';

main(async input => {
  const {urls, invalid, overLimit} = readUrls(input, 'urls', 2000);
  if (!urls.length) throw userError('Add at least one PDF URL to "PDF URLs".');
  const maxPages = Math.max(1, Math.min(2000, Number(input.maxPagesPerPdf) || 500));
  const perPage = input.includePageTexts === true;
  const fetcher = new Fetcher({respectRobots: input.respectRobotsTxt !== false, maxBytes: 60_000_000, timeoutMs: 90000});
  const work = async url => {
    const base = {url, checkedAt: new Date().toISOString()};
    let r;
    try { r = await fetcher.get(url, {binary: true, accept: 'application/pdf,*/*;q=0.5'}); } catch (e) {
      return {billable: false, item: {...base, status: e.code === 'ROBOTS' ? 'blocked_by_robots_txt' : 'unreachable', error: e.message}};
    }
    if (r.status >= 400) return {billable: false, item: {...base, httpStatus: r.status, status: 'http_error', error: `Server answered HTTP ${r.status}`}};
    if (r.truncated) return {billable: false, item: {...base, status: 'too_large', error: 'PDF is larger than 60 MB'}};
    if (!isPdf(r.body)) return {billable: false, item: {...base, httpStatus: r.status, status: 'not_a_pdf', error: `The URL did not return a PDF (content type ${r.contentType || 'unknown'})`}};
    let d;
    try { d = await readPdf(r.body, {maxPages}); } catch (e) {
      return {billable: false, item: {...base, status: /password/i.test(e?.message ?? '') ? 'password_protected' : 'unreadable_pdf', error: String(e?.message ?? e).slice(0, 300)}};
    }
    const words = (d.text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
    if (words === 0 && d.pageCount > 0) return {billable: false, item: {...base, status: 'no_text_layer', pageCount: d.pageCount, error: 'The PDF has no selectable text (probably scanned images; OCR is not included).'}};
    const {pages, ...rest} = d;
    return {billable: true, units: d.pagesRead, item: {...base, finalUrl: r.finalUrl, status: 'ok', bytes: r.bytes, ...rest, wordCount: words, pageTexts: perPage ? pages : undefined}};
  };
  return runItems({items: urls, concurrency: 3, event: 'page', work, label: 'PDFs',
    summaryExtra: () => [invalid.length ? `${invalid.length} invalid URLs skipped.` : '', overLimit ? `${overLimit} URLs over the per-run limit skipped.` : ''].filter(Boolean)});
});
