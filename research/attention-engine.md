# Autonomous Attention Engine: research report

Date: 2026-10-11. Research only. Nothing was built, posted, sent, or bought.

**Evidence labels**
- **[V]** verified from a primary source I fetched (official docs, the paper itself, or a live API I queried)
- **[S]** secondary source or vendor study, not independently verified
- **[H]** my hypothesis
- **[E]** my estimate, with the assumptions stated

**Availability labels**
- **Available:** usable today
- **Gated:** needs an application, audit, or approval
- **Partner:** needs a commercial agreement
- **Experimental**
- **Theoretical**

**What I actually touched in this session**
- Metricool analytics for 570ZX (live)
- The Apify Store public API for Dodge's 16 Actors (live)
- Public web pages and search
- Google's, OpenAI's, and Apify's documentation pages

**What I did not touch:** Google Search Console, YouTube Analytics, Bing Webmaster Tools, the Reddit API, DataForSEO, the Perplexity or OpenAI APIs. Every claim about those comes from their documentation or from secondary sources.

---

## 1. Executive finding

**Feasible, but not in the form "an AI that buys or manufactures attention like Google Ads."** What can be built is an always-on system that finds demand nobody is serving well, matches it to a real asset (a video, a tool, a dataset, a page), publishes through owned or audited channels, and measures the incremental effect. That is a real capability. It is fundamentally different from Ads in four ways.

1. **Ads rent guaranteed placement. Organic attention is earned and gated by someone else's ranking system.** The engine controls inputs (what exists, where, how well structured, how fast) and never controls the output (ranking, recommendation, citation).
   - Google says AI Overviews and AI Mode have **no additional technical requirements** beyond being indexed and snippet-eligible, and that "specific optimization isn't required" [V, [Google Search Central](https://developers.google.com/search/docs/appearance/ai-features)].
   - OpenAI shows a site in ChatGPT search only if OAI-SearchBot can crawl it [V, [OpenAI crawler docs](https://developers.openai.com/api/docs/bots)].
   - Everything past eligibility is the platform's decision.

2. **Throughput is not the lever. Platforms now penalize it.**
   - Google's *scaled content abuse* policy (March 2024) applies "whether automated, human, or combined" [S, [Victorious](https://victorious.com/blog/scaled-content-abuse/)].
   - YouTube stopped monetizing "mass-produced, repetitious" content on July 15, 2025 [S, [Plagiarism Today](https://www.plagiarismtoday.com/2025/07/08/youtube-targets-inauthentic-content/)].
   - The best-known AI content blitz, Causal's 1,800-article "SEO heist," dropped about 99.5% in estimated organic traffic after a manual action [S, [Ahrefs](https://ahrefs.com/blog/biggest-traffic-losers/)].
   - An engine that wins by publishing more loses.

3. **The agent's real edge is detection, matching, and measurement, not generation.** Generation is now a commodity. The scarce parts are:
   - noticing an unserved query or conversation early;
   - attaching an asset that is genuinely the best answer (often one only the owner can make: Dodge's real build, his real tools);
   - proving with a control group that it moved the needle.

4. **AI answer engines are a real but small and noisy channel.**
   - AI referrals are estimated at roughly 0.1–1% of site traffic [S, [Similarweb](https://aisearch.similarweb.com/blog/gen-ai-stats/), [SE Ranking](https://seranking.com/blog/ai-traffic-research-study/)]. Vendors claim higher conversion [S].
   - AI recommendation lists repeat less than 1 time in 100 across runs (SparkToro/Gumshoe, 2,961 runs) [S, [Search Engine Land](https://searchengineland.com/ai-recommendation-lists-rarely-repeat-study-468076)], so "rank tracking" in AI is mostly noise. Visibility has to be measured as a sampled rate.
   - When Google shows an AI Overview, users click a result in about 8% of visits versus 15% without one, and click a cited source in about 1% [S, Pew via [The Decoder](https://the-decoder.com/pew-finds-that-only-1-percent-of-users-click-a-source-link-directly-from-googles-ai-overviews/)]. Google disputes the method.

**What it means in practice for Dodge's two real targets:**

- **570ZX (creator brand).** The niche has *zero* competition on its defining queries.
  - Searching "hemi swapped 300ZX Z32 build" and "570ZX 3D printed widebody 300ZX hemi" today returns no Hemi Z32 build at all, and the search engine's AI summary says so explicitly [V, my searches this session]. Every Z32 V8 resource found is an LS swap.
  - YouTube is the single most-cited domain in Google AI Overviews, around 23% of citations in one 46M-citation analysis [S, Surfer via [Radiant Elephant](https://www.radiantelephant.com/youtube-ai-overview-citations/)].
  - Dodge already has the one asset nobody else can produce: the real build on video.
- **Apify Actor portfolio (tools sold to people and AI agents).**
  - All 16 Actors are live and **already eligible for agentic payments** (`isWhiteListedForAgenticPayments: true` on every one) [V, Apify Store API, queried today]. AI agents can discover them through Apify's MCP server and pay via x402 without an Apify account [V, [Apify AGENTS.md](https://apify.com/agents.md), [Apify monetization docs](https://docs.apify.com/actors/publishing/monetize)].
  - **Each one shows 1 user in the last 30 days and 2 total**, most likely the owner's own test runs [V for the numbers, H for the interpretation].
  - This is a clean zero baseline for testing agent-to-agent discovery.

---

## 2. Ten best opportunities (ranked)

**Ranking score** = evidence × expected value × durability ÷ (cost + risk). All scores are judgment calls [H], shown so they can be argued with.

| # | Opportunity | Evidence | Setup cost | Monthly cost | Durability | Platform risk | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Own zero-competition entity queries** ("Hemi Z32", "3D printed widebody Z32", "PETG-CF body panels") with long-form YouTube (titles, chapters, transcripts) plus matching build-log pages on the existing Fourthwall site | Medium-high. No competing source exists [V]; YouTube is the top AI Overview citation source [S] | ~$0 + Dodge's time | ~$0 | High (evergreen) | Very low | Available |
| 2 | **Earned third-party mentions** (Hackaday, The Autopian, All3DP, a 3DXTECH case study, forum build threads) | Medium. Off-site branded mentions are the strongest correlate of AI Overview brand visibility (ρ≈0.66, 75k brands) [S, [Ahrefs](https://ahrefs.com/blog/ai-overview-brand-correlation/)]; these outlets already cover 3D-printed car bodies [V] | $0 | $0 | High | Low (human-sent, one each) | Available |
| 3 | **Agent-facing listing optimization for the 16 Actors.** Rewrite titles and READMEs for how agents search (Apify's guide says agent search matches "platform or product names" and README text [V]); list where agents look (MCP registries) | Low-medium. The mechanism is documented [V]; demand is unproven (16× ~0 users) | $0 | $0 | Medium | Low | Available |
| 4 | **Time-window detection** (new NHTSA recalls → vehicle tool; SEMA/Formnext season; new printer or filament launches → 570ZX) | Medium. Detection is cheap and APIs are free [V for HN/Bluesky/NHTSA]; payoff unproven [H] | Low | <$20 | Low per item, high as a process | Low | Available |
| 5 | **Question matching:** the agent finds public questions (HN, Bluesky, forums, Reddit via email alerts), drafts a genuinely useful answer, Dodge posts it where self-links are allowed | Medium. The demand is real; volume is bounded by rules and human time | Low | $0–30 | Low per post | **Medium** (Reddit bans AI promo accounts [S, [404 Media](https://www.404media.co/ai-is-poisoning-reddit-to-promote-products-and-game-google-with-parasite-seo/)]) | Available (human-posted only) |
| 6 | **Original-data assets** that others cite, such as "Most-recalled models 2016–2026" from NHTSA data, or "State of the Apify Store" from the existing 12.6k-Actor scan already in `research/BUSINESS.md` | Low-medium. The GEO paper found adding statistics and citations raises visibility (up to 40%) [V for the abstract claim, [arXiv](https://arxiv.org/abs/2311.09735v3)]; no direct link-earning study found | Low | ~$0 | High | Very low | Available |
| 7 | **Clip pipeline** from Dodge's own raw footage (Drive), scheduled through Metricool, which is already connected and an audited publisher | Medium. His clips already reach 0.5–2.6k views each [V, Metricool]; incrementality unknown | Low | Existing Metricool plan | Low per clip | Low if not mass-produced | Available |
| 8 | **First-party AI measurement:** Bing Webmaster Tools AI Performance report (Copilot citations, CSV export) plus Search Console | Medium. It's the only first-party AI-citation data that exists [S, [Search Engine Land](https://searchengineland.com/bing-webmaster-tools-testing-new-ai-performance-report-468039)] | $0 | $0 | Infrastructure | None | Available (public preview, no API yet [S]) |
| 9 | **Small free tools on owned pages** (Z32 fitment/offset calculator; SPF/DMARC quick check as a demo of the Actor) | Low. No rigorous public case study found; only how-to guides [S] | Medium | ~$0 | High if useful | Very low | Available |
| 10 | **Partner amplification:** 3DXTECH and Morimoto reposts and case studies, plus LOJ Conversions (sells Gen III Hemi swap kits for 350Z/G35 [V, [lojkits.com](https://lojkits.com/products/350z-g35-hemi-basic-swap-kit)], a natural Hemi-Nissan partner) | Medium. Distribution through trusted accounts | $0 | $0 | Medium | Low (must disclose) | Available |

**Deliberately excluded**
- **Programmatic SEO at volume:** scaled-content-abuse risk, and the Causal case shows the failure mode.
- **AI auto-replies:** bans, and FTC exposure.
- **llms.txt:** 97% of files get zero requests and AI retrieval bots make about 1% of the fetches [V, [Ahrefs, 137k sites](https://ahrefs.com/blog/llmstxt-study/)].
- **Agentic checkout (ACP/UCP):** gated merchant programs, and Instant Checkout was reportedly scaled back in March 2026 [S, [Naturaily](https://naturaily.com/blog/agentic-commerce-shopify-guide)]. Fourthwall owns the checkout anyway.
- **ChatGPT ads:** this is the real "Google Ads for AI answers" (self-serve beta since May 2026 [S, [OpenAI](https://openai.com/index/new-ways-to-buy-chatgpt-ads)]). It's paid and out of scope, though it's useful later as a paid benchmark arm.

---

## 3. Competitor and technology map

### AI-answer visibility
| Tool | What it does | API / automation | Price | Can't do | Status |
|---|---|---|---|---|---|
| Google Search Console | Impressions and clicks; AI Overviews and AI Mode are counted inside "Web" | API, 50k rows/day/site [V, [Google](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive)] | Free | Can't separate AI Overview clicks from classic ones | Available |
| Bing Webmaster AI Performance | Copilot/Bing AI citation counts, grounding queries | CSV only, API "on the backlog" [S] | Free | No clicks; can't filter partners | Public preview |
| Otterly.ai | Samples prompts on ChatGPT, AI Overviews, Perplexity, Copilot | Unclear | $29/15 prompts to $489/400 [S] | Can't fix the run-to-run variance | Available |
| Peec AI / Profound | Same, aimed at mid-market and enterprise | Profound: yes (enterprise) | ~$95–$499+/mo; enterprise $30k+/yr [S] | Same variance problem | Available |
| Ahrefs Brand Radar | Brand mentions across AI answers | Ahrefs API | Ahrefs plan | Same | Available |
| **DIY sampler** | Run fixed prompts through Claude (web search $10 per 1k searches [V, skill docs]) and Perplexity Sonar (~$5–14 per 1k requests [S]); log mentions | Fully scriptable | ~$20–80/mo [E] | API answers ≠ consumer app answers (personalization, different models) [H] | Available |

### Opportunity detection
| Source | Access | Cost / limits | Notes | Status |
|---|---|---|---|---|
| Reddit Data API | OAuth, about 100 QPM | Free only for non-commercial use; commercial needs an agreement; access approval required (Responsible Builder Policy, Nov 2025) [S] | GummySearch shut down because it couldn't get a commercial licence [V, [GummySearch](https://gummysearch.com/docs/articles/gummysearch-is-now-closed-6533h)]. **Use email keyword alerts (F5Bot, free) or manual review, not a commercial scraper** | Gated |
| Hacker News | Firebase API + Algolia search | Free; limits undocumented officially [S] | Good for 3D-printing and dev-tool topics | Available |
| Bluesky Jetstream | Public WebSocket, JSON | Free [V, [docs.bsky.app](https://docs.bsky.app/blog/jetstream)] | Filter by keyword client-side | Available |
| X API | Pay-per-use since Feb 2026 | ~$0.005 per read [S] | Car audience is moderate there | Available (paid) |
| YouTube Data API | Default quota 10k units/day; search costs 100 units [V, [Google](https://developers.google.com/youtube/v3/determine_quota_cost)] | Free under quota | Topic and competition research | Available |
| Google Trends API | Alpha, by application, small pilot [S, [Google blog](https://developers.google.com/search/blog/2025/07/trends-api)] | Unknown | Excludes "Trending Now" | Gated |
| DataForSEO | SERP $0.0006–0.002 per query; $50 minimum prepay [S] | Pay-as-you-go | Cheapest SERP and keyword data | Available |
| NHTSA APIs | Free government APIs [V, already used by `vehicle-safety-intel`] | Free | Daily new recalls as time-window triggers | Available |
| Apify Store API | Public, includes usage stats and agentic eligibility [V] | Free | Competition and demand data for tools | Available |

### Creation and distribution
| Tool | Use | Limits | Status |
|---|---|---|---|
| Metricool (already connected) | Schedule to YouTube, TikTok, IG, and **create posts *for review*** (`createScheduledPostForReview` exists in this session) | Plan-dependent | Available |
| TikTok Content Posting API (direct) | Posting | **Unaudited apps can post only as SELF_ONLY (private)** [V, [TikTok](https://developers.tiktok.com/doc/content-sharing-guidelines)] | Gated |
| YouTube `videos.insert` (direct) | Uploading | **Uploads from unverified projects created after 2020-07-28 are locked private** until audit [V, [Google](https://developers.google.com/youtube/v3/docs/videos/insert)] | Gated |
| Instagram Graph API | Posting | 50 or 100 posts/24h (Meta's docs contradict each other) [S] | Available (business account) |
| Postiz (open source, AGPL) | Self-hosted scheduler, 28–30+ networks, API and MCP | Inherits each platform's audit gates; needs 4 GB RAM [S] | Available |
| OpusClip | Auto-clipping long video | API only on Pro (limited) or Business (custom) [S] | Available |
| Claude API | Triage, drafting, checks | Opus 5.5 $4/$20 per MTok; Sonnet 5.5 $2/$10; Haiku 5.5 $0.10/$0.50; batch 50% off; web search $10 per 1k [V, skill docs] | Available (billed separately from any Claude subscription) |

### Agent-to-agent discovery and commerce
| Channel | What it is | Status |
|---|---|---|
| Apify MCP + x402/AGI | Agents search Actors (`search-actors` is free), pay per run in USDC or with a prepaid token; Dodge's Actors are already eligible [V] | **Available today** |
| Official MCP Registry / Smithery / Glama | Directories agents and developers use to find MCP servers [S] | Available (registry is in preview) |
| ChatGPT app directory (Apps SDK) | Submit an MCP-backed app for review and get listed in ChatGPT [S, [VentureBeat](https://venturebeat.com/technology/openai-now-accepting-chatgpt-app-submissions-from-third-party-devs-launches)] | Gated (review) |
| OpenAI ACP / Instant Checkout | Product feed + checkout inside ChatGPT; protocol open, checkout for approved partners [S] | Partner (reportedly scaled back) |
| Google UCP | Agentic checkout in AI Mode/Gemini via Merchant Center [S] | Partner / early access |
| ChatGPT ads | Paid placements under answers; OAI-AdsBot checks landing pages [V for the bot, S for the program] | Available (paid) |

### What nobody can do (from outside a platform)
- Insert a recommendation into someone else's private conversation, or into another company's recommender.
- Guarantee citation in any AI answer.
- Post publicly through TikTok's or YouTube's own APIs without passing their audits.

---

## 4. System architecture

```
                    ┌──────────────────────── SCHEDULER (GitHub Actions cron; already used in this repo) ───────────────┐
                    │                                                                                                  │
 OBSERVE ───────────┼─> collectors (each a small job, own rate limit + cost meter)                                       │
   GSC API, YouTube Analytics, Metricool, Apify Store API, Bing AI-perf CSV (manual weekly),                           │
   HN/Algolia, Bluesky Jetstream (keyword filter), F5Bot e-mails (via Gmail), NHTSA, DataForSEO (capped),              │
   AI-answer sampler (fixed prompt panel × engines × N samples)                                                        │
                    │                                                                                                  │
                    v                                                                                                  │
 STORE   SQLite (or Cloudflare D1): signals · opportunities · assets · actions · approvals · metrics_daily ·            │
         experiments · ai_samples · costs · audit_log                                                                   │
                    │                                                                                                  │
 DETECT  Haiku 5.5 classifies each signal: intent (question / comparison / buy / news), topic, target (570ZX|Actor|none)│
                    │                                                                                                  │
 EVALUATE score = fit × demand × (1−competition) × freshness ÷ effort ; rules reject anything off-policy                 │
                    │                                                                                                  │
 CREATE  Opus 5.5 drafts: page section / video metadata / answer / pitch / listing copy                                 │
         Quality gates: source-grounded facts · originality · channel-rule check · disclosure check · "only if better    │
         than what already ranks" check                                                                                 │
                    │                                                                                                  │
 APPROVE daily digest (one GitHub issue or Gmail draft) ── Dodge: approve / edit / reject (after 5 PM) ──────────────┐   │
                    │                                                                                             │   │
 DISTRIBUTE  approved only: Metricool "for review" posts · Apify listing (API) · Fourthwall pages (Dodge pastes) ·   │   │
             YouTube metadata (Dodge or OAuth) · pitches/forum posts sent BY DODGE                                │   │
                    │                                                                                             │   │
 CONVERT  every link carries UTM (utm_source=engine&utm_campaign=<experiment>&utm_content=<action_id>)            │   │
                    │                                                                                             │   │
 MEASURE  daily metric pulls → metrics_daily ; weekly AI-sample panel → ai_samples                                │   │
                    │                                                                                             │   │
 LEARN    per-experiment treatment-vs-control diff-in-diff ; keep/drop/retest ; playbook.md updated ───────────────┘   │
                    └──────────────────────────────── REPEAT (daily detect, weekly learn) ─────────────────────────────┘
```

### Autonomy by stage
| Stage | Autonomous? | Why |
|---|---|---|
| Observe, store, detect, score | Yes | Read-only, public or owner-authorized data |
| Create drafts | Yes | Drafts aren't public |
| Approve | **Human (Dodge)** | His voice, his accounts, his risk |
| Distribute to owned or connected channels | After approval: yes (Metricool, Apify listing API) | Audited publishers; reversible |
| Distribute to communities, outreach, pitches | **Human sends** | Platform rules and trust; avoid the ReplyGuy pattern |
| Measure, learn | Yes | |
| Change budget, add channels, or create accounts | **Human only** | Spending and identity |

### Running it affordably
- **Scheduled jobs:** GitHub Actions. The repo already runs a dozen cron workflows, for example `actor-publish-daily.yml` [V].
- **State:** a SQLite file committed to a data branch, or Cloudflare D1 (free tier; the repo already deploys to Workers).
- **LLM calls:** Claude API with prompt caching (cache reads $0.20/MTok on Opus 5.5) and Batches (50% off) for non-urgent drafting [V].
- **A Claude subscription is not an API budget.** Claude Code routines can run this on a schedule, but within plan limits; that is not unlimited or always-on compute. The engine should call the API and carry a hard monthly cap.

---

## 5. Experiment design: three strategies, then one 30-day pilot

### Strategy comparison (all figures are estimates [E] unless labelled)
| | A: AI-search visibility (GEO/AEO/SEO) | B: Real-time opportunity detection + useful distribution | C: Hybrid engine (A's assets + B's detection + measurement loop) |
|---|---|---|---|
| Setup cost | $0–50 (DataForSEO deposit optional) | $0–50 | $50–100 |
| Monthly cost | $20–80 (AI sampler + small SERP pulls) | $10–40 | $50–150 incl. LLM; hard cap $150 |
| Human time | ~2 h/week (Dodge reviews pages and metadata) | ~3–5 h/week (Dodge posts answers himself) | ~2–3 h/week (daily 10-min digest + filming he already does) |
| Time to first signal | Indexing: days to weeks; AI citations: weeks; noisy | Same day (a click-through on an answer) | Days (B) and weeks (A) |
| Volume | 5–15 assets/month (pages, video metadata, listings) | 10–40 human-posted answers/month | 15–40 approved actions/month |
| Traffic potential | Low absolute volume, high intent. Zero-competition queries can win quickly, but monthly searches are probably small (tens to hundreds) [H] | Spiky, low durability | Low to medium; compounds if A works |
| Conversion potential | High: the visitor searched the exact thing | Medium: answers get read, rarely clicked [H] | Highest per visit (intent-matched) |
| Scalability | High (pages persist) | Bounded by human posting and community rules | Medium-high |
| Technical difficulty | Low-medium | Medium (classification noise) | Medium |
| Platform risk | Very low | **Medium** (Reddit/forum rules; anything automated looks like spam) | Low (B stays human-posted) |

**Sensitivity.** The swing factor for A is query volume, which nobody can see without Search Console data. If the 570ZX target queries total 300 searches/month and he captures 30% CTR, that's ~90 visits; at 30 searches it's ~9 [E]. That is why the pilot measures *share of available demand* (impressions, position, AI mention rate) rather than raw traffic.

### The 30-day pilot: run C-lite on both targets with pre-registered controls

**Baseline (days −7 to 0, no interventions)**
- Pull Search Console (needs Dodge to verify the Fourthwall site or a domain), YouTube Analytics traffic sources with search terms, Metricool, Apify per-Actor users/runs/revenue, and Bing Webmaster AI Performance.
- Run the AI sampler on the prompt panel: 5 samples × each engine, because of the run-to-run variance.

**Arm 1: 570ZX query panel (randomized, query-level difference-in-differences)**
- Build 24 target queries from real demand. Examples: "hemi swap 300zx", "z32 widebody kit 2026", "3d printed widebody", "petg-cf body panels", "z32 headlight projector housing", "1/5 scale 3d printed car".
- **Randomly assign 12 to treatment and 12 to control.**
- Treatment queries get one excellent asset each: a Fourthwall build-log page section with real specs, photos and the embedded video, and/or YouTube title/description/chapter changes. All approved by Dodge.
- Control queries get nothing.
- Outcomes per query: Google impressions and average position (Search Console), YouTube search-term views, and AI mention rate (share of sampled answers naming 570ZX or citing his URL/video).
- Effect = (treatment change) − (control change).

**Arm 2: Apify agent discovery (randomized, Actor-level)**
- Randomly assign 8 of the 16 Actors to treatment: listing rewritten for agent search terms, a worked example in the README, and an MCP-registry or directory mention where permitted.
- The other 8 are unchanged.
- Outcomes: distinct users, runs, revenue (Apify Insights), and agent-originated runs where Apify exposes them [H: may not be visible].
- Caveat: with a baseline near zero, 30 days may be underpowered. Treat it as a *directional* read and extend to 60–90 days.

**Arm 3: question matching (per-action attribution)**
- Up to 3 human-posted answers a week, each with a unique UTM link.
- Outcome: clicks → qualified sessions (≥30 s or a second page) → signups or purchases per answer.
- No control is possible per post, so treat it as cost-per-qualified-visit accounting, not a causal claim.

### Metrics recorded daily
- Impressions, views, and watch time
- Search Console position and CTR
- AI mention or citation rate
- Sessions by source
- Qualified sessions
- Email signups (Fourthwall), sales, Actor users and revenue
- Dollars spent (API meter)
- Dodge's minutes (logged per approval)

### Success criteria (pre-registered)
| | Pass | Kill |
|---|---|---|
| Arm 1 | Treatment queries show ≥2× the control group's change in impressions, **and** an AI mention rate above 0 on ≥3 treatment queries versus ~0 on controls | No treatment/control difference by day 30 → change the asset type once and re-test 30 days; stop after 60 days with no difference |
| Arm 2 | Any treatment Actor gains ≥3 distinct non-owner users, or any paid run, versus none in control | Nothing in 90 days → stop investing in listings |
| Arm 3 | Cost per qualified visit beats the alternative (Dodge's time valued at a stated rate) and ≥1 conversion | Fewer than 5 qualified visits per 10 answers → stop |
| Engine overall | Total time ≤3 h/week and spend ≤$150/month | Over either cap for 2 weeks → cut scope |

**Correlation versus causation.** Only Arms 1 and 2 are randomized. Algorithm updates and seasonality hit both groups and cancel out in the difference. Arm 3 and any viral spike are correlational and reported as such.

---

## 6. Cost and economics

### Pilot operating cost [E]
| Item | Monthly |
|---|---|
| Triage: Haiku 5.5, ~1.5M input tokens/day at $0.10/MTok | ~$5 |
| Drafting: Opus 5.5, ~40 drafts × ~80k in / 20k out | ~$30 (~$15 batched) |
| AI sampler: ~40 prompts × 3 engines × 5 samples × 4 weeks = 2,400 calls at ~$0.01–0.03 | ~$25–70 |
| DataForSEO SERP/keywords (capped) | ~$5–15 ($50 one-time prepay) |
| GitHub Actions, D1 or SQLite, Search Console, Bing, HN, Bluesky, NHTSA, Apify Store API | $0 |
| Metricool | existing plan |
| **Total cash** | **~$65–150/mo**, hard cap $150 |
| Dodge's time | ~2–3 h/week |

### Revenue paths and break-even [E]
| Path | Unit economics | Break-even on $100/mo engine cost |
|---|---|---|
| Apify tools at $1 per 1k results | Apify pays 80% of event revenue minus platform cost [S, per `research/BUSINESS.md`] → ~$0.80 per 1k | ~125k paid results/month |
| Vehicle reports at $0.01 | ~$0.008 per report | ~12,500 reports/month |
| 570ZX merch (Fourthwall) | Assume $8–12 margin per order [H] | ~10 orders/month |
| 570ZX YouTube ads | Not eligible yet: 173 subs, YPP needs 1,000 plus watch hours | $0 near-term |
| Sponsorship / partners | Already has 3DXTECH and Morimoto; value scales with qualified audience | Hard to model; likely the largest 570ZX lever [H] |
| Engine as a service for small creators | Market prices for *measurement only*: $29–$499/mo [S] | 1 client at $150–300/mo covers it, but only *after* the pilot proves incrementality |

**Attention versus monetization.** A million low-intent views of a meme clip is worth less to 570ZX than ~200 people who searched "hemi swap 300zx" and watched 8 minutes. The first moves almost nothing; the second is the audience sponsors and kit buyers come from. The engine should optimize **qualified sessions and subscribers from intent-matched surfaces**, not raw views.

**The honest risk:** at pilot scale neither target will pay for the engine in 30 days. The pilot buys **evidence of incrementality**. Spend should rise only when that evidence exists.

---

## 7. Implementation roadmap

1. **Weeks 0–2 (measurement first; nothing else is credible without it)**
   - Connect Search Console and Bing Webmaster for the Fourthwall site.
   - Get YouTube Analytics access (OAuth by Dodge, or a weekly CSV).
   - Build the collectors, the SQLite schema, the cost meter, the AI sampler, and the daily digest issue.
   - Run the baseline week.
2. **Weeks 2–6 (the pilot above)**
   - Treatment assets for Arm 1, listing rewrites for Arm 2, ≤3 answers a week for Arm 3.
   - Weekly report.
3. **After the pilot, only if a pass criterion is met**
   - Add detection sources: Jetstream/HN keyword streams, NHTSA recall triggers, an X pay-per-use read.
   - Add an original-data asset (opportunity #6) and a small free tool (#9).
   - Consider the ChatGPT app directory listing for the best-performing Actor.
   - Consider offering the engine to one other creator.

---

## 8. Failure modes and early detection

| Failure | Early signal | Response |
|---|---|---|
| Target queries have no volume | Search Console impressions stay under ~10/week per treatment query after indexing | Re-pick queries from YouTube search-term data and DataForSEO volume; shift to the Arm 2 and #2 levers |
| Assets don't get indexed or crawled | URL Inspection shows not indexed after 14 days; no crawler hits | Fix internal links and sitemap; check robots. Fourthwall currently allows all crawlers [V, its robots.txt] |
| AI measurement is pure noise | Mention rate varies wildly week to week even on controls | Raise samples per prompt; report confidence intervals; rely on the Bing first-party data |
| Detection floods with junk | <10% of surfaced opportunities get approved | Tighten classifier thresholds; fewer sources |
| Human bottleneck | Digest unanswered for 3+ days | Cut daily items to ≤5; batch weekly |
| Platform enforcement | Removed posts, mod warnings, Search Console manual action, Metricool errors | Stop that channel immediately; review the rules file |
| Cost creep | API meter past 80% of cap | Auto-pause non-essential jobs at the cap |
| Measurement contamination | Bot traffic: automated traffic was ~51% of web traffic in 2024 [S, [Imperva via Malwarebytes](https://www.malwarebytes.com/blog/news/2025/04/hi-robot-half-of-all-internet-traffic-now-automated)] | Count only qualified sessions; ignore raw hits |
| Prompt injection from collected content | Odd instructions in scraped text | All collected text treated as data; tools for drafts only; nothing auto-publishes |

## Manipulation landscape: why it works briefly, and the legitimate equivalent

| Tactic | Mechanism | Why it works short-term | How it fails | Risk | Legit equivalent |
|---|---|---|---|---|---|
| Scaled AI pages / "SEO heist" | Volume × keyword coverage beats thin competition until classifiers or manual review catch up | Ranking systems lag | Causal: −99.5% estimated traffic after a manual action [S] | Deindexing | Few pages, each the best answer, on unserved queries |
| AI reply bots on Reddit (ReplyGuy) | Plug a product into live threads; also targets Google, which ranks Reddit highly | Reddit content ranks and gets cited | Accounts banned; Reddit treats it as spam [S] | Bans, brand damage | Owner-posted, rule-following answers |
| Undisclosed AI persuasion (Zurich study) | Personalized AI comments; 137 deltas from 1,783 comments, reported ~6× human persuasion [S] | It works on people | Bans, formal legal demands, publication pulled [S, [NBC](https://www.nbcnews.com/news/rcna203597), [404 Media](https://www.404media.co/reddit-issuing-formal-legal-demands-against-researchers-who-conducted-secret-ai-experiment-on-users/)] | Legal, ethical | Disclosed, owner-authored contributions |
| Bought views, followers, reviews | Inflates social proof and ranking inputs | Social proof is a ranking feature | FTC rule (effective Oct 21, 2024): civil penalties up to ~$51,744 per violation for knowingly buying fake indicators or reviews [S, [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)] | Legal, financial | Real reviews from real users, asked for honestly |
| Parasite SEO / site-reputation abuse | Third-party pages on high-authority hosts | Borrowed authority | Manual actions since May 2024 [S] | Deindexing | Earned features on those sites (opportunity #2) |
| llms.txt "AI SEO" | Hope that AI reads a special file | Nothing | 97% never fetched [V] | Wasted effort; prompt-injection surface | Plain crawlable HTML + video transcripts |

**The pattern:** every manipulation forges a signal the platform uses as a *proxy* for real value (links, engagement, mentions, reviews). Platforms keep investing in detecting forged proxies, so forging has a short half-life and a growing penalty. The durable play is to create the underlying value the proxy was measuring, then make it easy to find. Defensively, the same knowledge says what to filter out of your own analytics.

---

## 9. Final recommendation

**Test first: the "unserved entity" experiment (Arm 1), with Arm 2 alongside because it costs nothing extra.**

Why this before anything else:
1. **It's the only option where the baseline is verifiably zero and competition is verifiably absent.** No Hemi Z32 build appears in search, and the answer engine says so. Any movement is attributable.
2. **It can be tested causally.** A randomized query-level control turns "we published stuff and views went up" into a real incrementality estimate. Most of the GEO industry can't do that because of run-to-run variance.
3. **It uses the asset no one can copy.** Dodge's real build on YouTube, which is also the most-cited domain in AI Overviews [S].
4. **It's cheap, reversible, and policy-safe.** A handful of high-quality pages and metadata edits, all approved by the owner.
5. **It builds the engine's core,** measurement plus an experiment registry, which every later strategy needs anyway.

What would change this: if Search Console shows the target queries have essentially no volume, pivot to Arm 2 and to opportunity #2 (earned mentions), which create demand rather than wait for it.

---

## 10. Build specification, v0.1 (for after this report is accepted)

**Location:** `engine/` in this repo. Python 3.11, no framework beyond `httpx`, `anthropic` (official SDK) and `sqlite3`. Scheduling through GitHub Actions.

```
engine/
  config.yaml            # targets, query panel (treatment/control), sources, caps, channels + their rules
  db/schema.sql          # tables below
  collectors/
    gsc.py               # Search Console searchanalytics.query (OAuth by Dodge; secret in GH Actions)
    youtube.py           # YouTube Analytics: views by trafficSource & search term (OAuth)
    metricool.py         # per-post metrics (API key or export)
    apify.py             # public store API + owner Insights export
    bing_ai.py           # parses weekly CSV dropped in engine/inbox/
    hn.py, bluesky.py    # keyword streams (public)
    alerts_email.py      # F5Bot alerts via Gmail label (read-only)
    ai_sampler.py        # prompt panel × {claude+web_search, perplexity sonar} × N; logs raw answers + mention/citation flags
  detect.py              # Haiku 5.5 classification, strict JSON schema output
  score.py               # deterministic scoring + policy filter (per-channel rules from config)
  draft.py               # Opus 5.5 drafts with source grounding; batched when not urgent
  gates.py               # checks: facts cite sources; no claims kit is for sale; partner disclosure present; channel rules
  digest.py              # opens/updates ONE GitHub issue per day: proposed actions with approve/reject checkboxes
  publish.py             # executes ONLY approved items on allowed channels (Metricool for-review, Apify listing API)
  measure.py             # daily metrics_daily rows; UTM builder
  analyze.py             # weekly diff-in-diff per experiment, CIs; writes reports/YYYY-WW.md
  budget.py              # cost meter from API usage fields; hard stop at cap
.github/workflows/
  engine-collect.yml     # daily 10:00 UTC
  engine-digest.yml      # daily 20:30 UTC (before 5 PM ET review window)
  engine-publish.yml     # on issue label "approved" / checkbox change
  engine-analyze.yml     # weekly Monday
```

**Tables**
| Table | Columns |
|---|---|
| `signals` | id, source, url, text, seen_at, hash |
| `opportunities` | id, signal_ids, target, intent, query, score, status |
| `assets` | id, target, type, url, created_at |
| `actions` | id, opportunity_id, channel, draft, status (proposed/approved/rejected/done), approved_by, approved_at, utm |
| `experiments` | id, hypothesis, unit, treatment_ids, control_ids, start, end, primary_metric, pass_rule, kill_rule |
| `metrics_daily` | date, unit_type, unit_id, metric, value, source |
| `ai_samples` | date, engine, prompt_id, sample_n, answer_text, mentioned, cited_url |
| `costs` | date, service, units, usd |
| `audit_log` | ts, actor, action, detail |

**Hard rules in code**
- `publish.py` refuses any action without an approval record.
- Community, outreach, and DM channels are draft-only; the code has no send path.
- `budget.py` halts all model calls at the monthly cap ($150 default).
- Secrets live only in GitHub Actions secrets, never in the repo or logs.
- Every external write is appended to `audit_log`.
- Collected text is never executed or followed as instructions.

**Needs from Dodge before building (the minimum)**
1. Verify the Fourthwall site in Google Search Console and Bing Webmaster Tools, or a custom domain. `570zx.com` doesn't resolve from here [V], so confirm which domain is canonical.
2. Grant YouTube Analytics read access (OAuth) or agree to a weekly CSV export.
3. An Anthropic API key with a spending limit set in the console, stored as a GitHub secret.
4. Approve the 24-query panel and the random treatment/control split.
5. Approve the $150/month cap, or set a different one.
