import test from 'node:test';
import assert from 'node:assert/strict';
import {readPdf, isPdf, pdfDate} from '../src/pdf.js';

// Build a minimal valid two-page PDF with real xref offsets.
function makePdf(pages, info = '/Title (Test Doc) /Author (Dodge) /CreationDate (D:20260102030405Z)') {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  for (const t of pages) {
    const stream = `BT /F1 18 Tf 50 700 Td (${t}) Tj ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  const p = add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  assert.equal(p, pagesId);
  const cat = add(`<< /Type /Catalog /Pages ${p} 0 R >>`);
  const inf = add(`<< ${info} >>`);
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${inf} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

test('reads text and metadata from a two-page PDF', async () => {
  const buf = makePdf(['Hello carbon fibre world', 'Second page text here']);
  assert.ok(isPdf(buf));
  const d = await readPdf(buf);
  assert.equal(d.pageCount, 2); assert.equal(d.pagesRead, 2);
  assert.match(d.pages[0], /Hello carbon fibre world/); assert.match(d.pages[1], /Second page/);
  assert.equal(d.title, 'Test Doc'); assert.equal(d.author, 'Dodge'); assert.equal(d.createdAt, '2026-01-02T03:04:05.000Z');
});

test('maxPages and helpers', async () => {
  const d = await readPdf(makePdf(['one', 'two', 'three']), {maxPages: 2});
  assert.equal(d.pageCount, 3); assert.equal(d.pagesRead, 2);
  assert.ok(!isPdf(Buffer.from('<html>nope</html>')));
  assert.equal(pdfDate('D:2024'), '2024-01-01T00:00:00.000Z'); assert.equal(pdfDate('junk'), null);
});

test('garbage input throws (caller turns it into unreadable_pdf)', async () => {
  await assert.rejects(readPdf(Buffer.from('%PDF-1.4 garbage')));
});
