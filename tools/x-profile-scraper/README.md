# X (Twitter) profile scraper

Pulls a public X profile's posts and interactions into JSONL files, plus a ranked summary of who the profile talks to and who talks to it. Zero dependencies (Node 20+). It uses the **official X API v2**, because X blocks logged-out access to timelines and the unofficial endpoints break often.

## Setup

1. Create an app at [developer.x.com](https://developer.x.com) and copy its **Bearer Token**.
2. `export X_BEARER_TOKEN=...`

## Run

```bash
cd tools/x-profile-scraper
node scrape.mjs elonmusk                    # newest 3,200 posts + 800 mentions
node scrape.mjs https://x.com/jack --archive # entire history since 2006 (Pro/Enterprise access)
node scrape.mjs jack --archive --since 2023-01-01 --until 2024-01-01
node scrape.mjs jack --likes --followers --following --max-users 2000
```

Progress is saved after every page. If a run stops (Ctrl-C, quota, error), run the same command again and it resumes where it stopped. Use `--fresh` to start over. When X rate-limits a request, the tool waits for the reset time and then continues.

## Output (`out/<username>/`)

| File | Contents |
|---|---|
| `profile.json` | Bio, location, URL, join date, follower/following/post counts, pinned post |
| `tweets.jsonl` | Everything the profile posted: `type` (`tweet`/`reply`/`retweet`/`quote`), text (full long-post text), date, URL, who it replied to / quoted / reposted (with their text), mentions, hashtags, cashtags, links, media, likes/reposts/replies/quotes/bookmarks/views |
| `mentions.jsonl` | Posts by others that mention or reply to the profile (same fields) |
| `liked.jsonl` | Posts the profile liked (`--likes`) |
| `followers.jsonl`, `following.jsonl` | Account records (`--followers`, `--following`) |
| `summary.json` | Counts by type, first/last post date, total engagement received, top 50 accounts replied to / mentioned / reposted / quoted / mentioned by / liked, top hashtags and cashtags |

## What your API tier can reach

| Data | Without `--archive` | With `--archive` |
|---|---|---|
| Profile's posts | Newest 3,200 | Full history |
| Mentions & replies to the profile | Newest 800 | Full history |
| Likes, followers, following | Whatever your tier allows | same |

- Full-archive search (`/2/tweets/search/all`) needs Pro or Enterprise access. On a lower tier, X answers 403 and the tool says so.
- Every X tier has a monthly read quota. A big account's whole history can use a large share of it. Use `--max` or `--since` to cap a run.
- X made likes private in 2024, so `liked_tweets` usually returns nothing for other people's accounts. A stream that is forbidden on your tier is skipped and listed under `summary.json → skipped`; the rest of the run continues.
- Protected accounts and deleted posts are not returned.

## Tests

`npm test` runs unit tests for parsing, classification, pagination and rate-limit handling. They don't call the network. Set `X_API_BASE` to point the tool at a mock server.
