# Web Page to Markdown for AI & RAG

Turn any web page into clean Markdown that an LLM can use. You give it URLs; it returns the page's main content only (no menus, cookie banners, ads or footers), with a title, author, date, word count and token estimate. Optionally it splits each page into chunks ready for a vector database.

**$1 per 1,000 pages. Pages that fail, are blocked or are empty are not charged.**

## Good for

- Feeding documentation, articles or product pages into RAG pipelines and vector stores
- Giving an AI agent the readable text of a link mid-task
- Building training or evaluation sets from public pages
- Archiving articles as portable Markdown

## What you get for each page

| Field | What it is |
|---|---|
| `markdown` | The page as Markdown. Headings, lists, tables (GitHub format), links and images kept; links and image URLs made absolute |
| `title`, `byline`, `siteName`, `lang`, `publishedTime`, `excerpt` | Page metadata when the page provides it |
| `wordCount`, `characters`, `approxTokens` | Size of the result (tokens estimated at 4 characters each) |
| `extraction` | `main_content` (article detected), `full_page_fallback` (short or unusual page, whole body used) or `full_page` |
| `chunks` | Only if you set a chunk size: pieces of about N tokens split on paragraph boundaries, each with its section heading |
| `links` | Only if you ask: every absolute link on the page |
| `status` | `ok`, or why a page was skipped: `http_error`, `unreachable`, `blocked_by_robots_txt`, `no_text`, `unsupported_content` |

### Example (shortened)

```json
{
  "url": "https://en.wikipedia.org/wiki/Markdown",
  "status": "ok",
  "title": "Markdown",
  "lang": "en",
  "extraction": "main_content",
  "wordCount": 3120,
  "approxTokens": 5210,
  "markdown": "# Markdown\n\nMarkdown is a lightweight markup language for creating formatted text ..."
}
```

## Input

- **Page URLs**: up to 10,000 per run.
- **What to keep**: main content (recommended) or the whole page body.
- **Chunk size for RAG**: 0 for none, or a token size such as 500.
- **Maximum characters per page**: cut very long pages.
- **Include list of links** and **Respect robots.txt** (on by default).

## Limits, honestly

- Pages are fetched as HTML, without running JavaScript. Sites that only render content with JavaScript return little text; those come back as `no_text` and are not charged.
- It does not log in, solve CAPTCHAs or get around blocks. If a site refuses automated access, the page is skipped and free.
- PDFs and other files are not converted (they return `unsupported_content`, free).
- Respecting robots.txt is on by default. Only turn it off for sites you own or have permission to fetch.

## Use with AI agents

Every run is pay per page with no subscription, so agents can call it through the Apify API or MCP server and pay only for what they convert.
