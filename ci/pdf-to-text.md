# pdf-to-text  2026-09-30T16:24:30Z 3e1734e
## install
```
npm warn deprecated gauge@3.0.2: This package is no longer supported.
npm warn deprecated tar@6.2.1: Old versions of tar are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 188 packages in 8s
```
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 3 of 3 PDFs
[32mINFO[39m  [Status message]: Processed 3 of 3 PDFs. Charged 4; 1 not charged (errors, blocked or invalid).
```
## items
3 items
```json
{"url": "https://arxiv.org/pdf/1706.03762", "checkedAt": "2026-09-30T16:24:39.864Z", "finalUrl": "https://arxiv.org/pdf/1706.03762", "status": "ok", "bytes": 2215244, "pageCount": 15, "pagesRead": 3, "title": null, "author": null, "subject": null, "keywords": null, "creator": "LaTeX with hyperref", "producer": "pdfTeX-1.40.25", "createdAt": "2024-04-10T21:11:43.000Z", "modifiedAt": "2024-04-10T21:11:43.000Z", "text": "Provided proper attribution is provided, Google hereby grants permission to\nreproduce the tables and figures in this paper solely for use in journalistic or\nscholarly works.\nAttention Is All You Need\nAshish Vaswani∗\nGoogle Brain\navaswani@google.com\nNoam Shazeer∗\nGoogle Brain\nnoam@google.com\nNiki Parmar∗\nGoogle Research\nnikip@google.com\nJakob Uszkoreit∗\nGoogle Research\nusz@google.com\nLlion Jones∗\nGoogle Research\nllion@google.com\nAidan N. Gomez∗ †\nUniversity of Toronto\naidan@cs.toronto.edu\nŁukasz Kaiser∗\nGoogle Brain\nlukaszkaiser@google.com\nIllia Polosukhin∗ ‡\nillia.polosukhin@gmail.com\nAbstract\nThe dominant sequence transduction models are based on complex recurrent or\nconvolutional neural networks that include an encoder and a decoder. The best\nperforming models also connect the encoder and decoder through an attention\nmechanism. We propose a new simple network architecture, the Transformer,\nbased solely on attention mechanisms, dis …
```
```json
{"url": "https://example.com/", "checkedAt": "2026-09-30T16:24:39.876Z", "httpStatus": 200, "status": "not_a_pdf", "error": "The URL did not return a PDF (content type text/html; charset=utf-8)"}
```
```json
{"url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "checkedAt": "2026-09-30T16:24:39.875Z", "finalUrl": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", "status": "ok", "bytes": 13264, "pageCount": 1, "pagesRead": 1, "title": null, "author": "Evangelos Vlachogiannis", "subject": null, "keywords": null, "creator": "Writer", "producer": "OpenOffice.org 2.1", "createdAt": "2007-02-23T17:56:37.000Z", "modifiedAt": null, "text": "Dummy PDF file", "wordCount": 3}
```
