import {getDocumentProxy, extractText, getMeta} from 'unpdf';

export const isPdf = buf => buf && buf.length > 4 && buf.subarray(0, 1024).toString('latin1').includes('%PDF-');

const tidy = s => String(s ?? '')
  .replace(/\u0000/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const pdfDate = s => {
  // D:20240131120000+01'00' -> ISO
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// buf: Buffer of a PDF -> {pageCount, pagesRead, title, author, subject, creator, producer, createdAt, modifiedAt, pages: [text], text}
export async function readPdf(buf, {maxPages = 500} = {}) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  let info = {};
  try { info = (await getMeta(pdf))?.info ?? {}; } catch { info = {}; }
  const {totalPages, text} = await extractText(pdf, {mergePages: false});
  const pages = (Array.isArray(text) ? text : [text]).slice(0, maxPages).map(tidy);
  return {
    pageCount: totalPages, pagesRead: pages.length,
    title: info.Title || null, author: info.Author || null, subject: info.Subject || null, keywords: info.Keywords || null,
    creator: info.Creator || null, producer: info.Producer || null, createdAt: pdfDate(info.CreationDate), modifiedAt: pdfDate(info.ModDate),
    pages, text: pages.join('\n\n')
  };
}

export { pdfDate };
