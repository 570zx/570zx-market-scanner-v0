# PDF to Text: Extract Text and Metadata from PDF URLs

Give it links to PDF files and get back their text and metadata: title, author, creation and modification dates, page count and word count. You can have the whole document as one text, and optionally the text of each page separately. Useful for feeding reports, filings, research papers, manuals and brochures into search, AI and RAG pipelines.

**$0.50 per 1,000 pages.** Unreachable files, links that are not PDFs, scanned PDFs without a text layer and unreadable files are free.

## Output (one row per PDF, shortened)

```json
{
  "url": "https://arxiv.org/pdf/1706.03762",
  "status": "ok",
  "pageCount": 15,
  "pagesRead": 3,
  "title": null,
  "author": null,
  "createdAt": null,
  "wordCount": 1500,
  "text": "Provided proper attribution is provided, Google hereby grants permission to reproduce ..."
}
```

(Example values are illustrative; the exact numbers depend on the file.)

## Input

- **PDF URLs**: direct links to PDF files, up to 60 MB each.
- **Also return text per page**: adds `pageTexts`, an array with one string per page.
- **Maximum pages per PDF**: default 500. You're charged for the pages actually read.
- **Respect robots.txt**: on by default.

## Limits

- **No OCR.** Scanned PDFs made of images have no text layer; they return `no_text_layer` and are free.
- Password-protected PDFs return `password_protected` (free).
- Text comes out in the PDF's reading order. Complex multi-column layouts and tables may come out in an awkward order.
- The PDF must be reachable by a direct link. Files behind a login are not supported.
