# RSS & Atom Feed Reader: News, Blogs, Podcasts to JSON

Turn any RSS 2.0, RSS 1.0, Atom or JSON Feed into clean, consistent JSON. For each item you get the title, link, publication date, author, categories, a plain-text summary, optionally the full HTML content, an image, and for podcasts the audio file link and duration. Give it feed URLs, or just a website address: if the page links to a feed, it is found automatically.

**$0.30 per 1,000 items.** Feeds that fail, are empty or can't be found are free.

## Good for

- **News monitoring**: follow many publications and filter to the last day or week
- **Content pipelines and AI**: feed fresh articles into summarisers, newsletters or RAG
- **Podcast data**: episode titles, dates, audio URLs and durations
- **Competitor tracking**: new posts from rival blogs, on a schedule

## Output (one row per item)

| Field | Meaning |
|---|---|
| `feedTitle`, `feedUrl`, `feedFormat` | The feed and its format (`rss2`, `rss1`, `atom`, `json`) |
| `title`, `link`, `guid` | The item |
| `published`, `updated` | ISO dates when the feed provides them |
| `author`, `categories` | As the feed gives them |
| `summary` | Plain text, up to 2,000 characters |
| `contentHtml` | Full HTML content (only if you switch it on and the feed includes it) |
| `image`, `enclosureUrl`, `enclosureType`, `durationSeconds` | Media: image, attachment (for example podcast MP3) and duration |

## Input

- **Feeds or websites**: up to 2,000 per run.
- **Maximum items per feed**: default 50.
- **Published within (days)**: 0 for no filter.
- **Include full HTML content**, **Respect robots.txt** (on by default).

## Limits

- It returns what the feed contains. Many feeds list only the latest 10-50 items, and some include only a short summary rather than the full text.
- A feed that appears several times in one run (for example a site and its feed URL) is read once.
