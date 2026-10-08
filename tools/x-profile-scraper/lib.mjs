// X (Twitter) API v2 client: pagination, rate-limit waits, tweet flattening and interaction stats.
// No dependencies; needs Node 20+ (global fetch).

const API = process.env.X_API_BASE ?? 'https://api.x.com/2';

export const TWEET_PARAMS = {
  'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics,entities,lang,source,possibly_sensitive,attachments,note_tweet',
  expansions: 'author_id,in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys,entities.mentions.username',
  'user.fields': 'username,name,verified,created_at,description,public_metrics,location,url,profile_image_url',
  'media.fields': 'type,url,preview_image_url,duration_ms,public_metrics,alt_text',
};
export const USER_FIELDS = 'created_at,description,entities,location,pinned_tweet_id,profile_image_url,protected,public_metrics,url,verified,verified_type';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class XClient {
  constructor(token, {fetchImpl = globalThis.fetch, log = console.error, minIntervalMs = 0, maxRetries = 8} = {}) {
    if (!token) throw new Error('Missing bearer token: set X_BEARER_TOKEN (developer.x.com > your app > Keys and tokens).');
    this.token = token; this.fetch = fetchImpl; this.log = log;
    this.minIntervalMs = minIntervalMs; this.maxRetries = maxRetries; this.last = 0;
  }

  async get(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res;
      try {
        res = await this.fetch(url, {headers: {authorization: `Bearer ${this.token}`, 'user-agent': 'x-profile-scraper/1.0'}});
      } catch (e) {
        if (attempt >= this.maxRetries) throw e;
        await this.backoff(attempt, `network error: ${e.message}`); continue;
      }
      if (res.status === 429) {
        const reset = Number(res.headers.get('x-rate-limit-reset'));
        const ms = reset ? Math.max(1000, reset * 1000 - Date.now() + 1000) : 60_000;
        this.log(`Rate limited on ${path}; waiting ${Math.ceil(ms / 1000)}s`);
        await sleep(ms); continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) { await this.backoff(attempt, `HTTP ${res.status}`); continue; }
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400) {
        const detail = body.detail || body.title || body.errors?.[0]?.message || JSON.stringify(body).slice(0, 300);
        const err = new Error(`X API ${res.status} on ${path}: ${detail}`); err.status = res.status; throw err;
      }
      return body;
    }
  }

  async backoff(attempt, why) {
    const ms = Math.min(60_000, 1000 * 2 ** attempt);
    this.log(`${why}; retrying in ${ms / 1000}s`);
    await sleep(ms);
  }

  // Yields {data, includes, meta} pages until there is no next_token, `limit` items are reached, or onPage returns false.
  async *paginate(path, params, {tokenParam = 'pagination_token', startToken, limit = Infinity} = {}) {
    let token = startToken, count = 0;
    do {
      const page = await this.get(path, {...params, [tokenParam]: token});
      const data = page.data ?? [];
      count += data.length;
      token = page.meta?.next_token;
      yield {data, includes: page.includes ?? {}, meta: page.meta ?? {}, nextToken: token};
    } while (token && count < limit);
  }
}

export function normalizeUsername(s) {
  const m = String(s).trim().match(/^(?:https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/)?@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/);
  if (!m) throw new Error(`Not a valid X username or profile URL: ${s}`);
  return m[1];
}

// Turns one API tweet plus the page's includes into a flat record with type, URL, and resolved usernames.
export function flattenTweet(t, includes = {}) {
  const users = new Map((includes.users ?? []).map(u => [u.id, u]));
  const tweets = new Map((includes.tweets ?? []).map(x => [x.id, x]));
  const media = new Map((includes.media ?? []).map(m => [m.media_key, m]));
  const refs = t.referenced_tweets ?? [];
  const ref = kind => refs.find(r => r.type === kind);
  const type = ref('retweeted') ? 'retweet' : ref('quoted') && !ref('replied_to') ? 'quote' : ref('replied_to') ? 'reply' : 'tweet';
  const author = users.get(t.author_id);
  const refInfo = r => {
    if (!r) return undefined;
    const rt = tweets.get(r.id), ru = rt && users.get(rt.author_id);
    return {id: r.id, authorId: rt?.author_id, authorUsername: ru?.username, text: rt?.note_tweet?.text ?? rt?.text,
      url: ru ? `https://x.com/${ru.username}/status/${r.id}` : `https://x.com/i/status/${r.id}`};
  };
  const replyTo = t.in_reply_to_user_id ? users.get(t.in_reply_to_user_id) : undefined;
  return {
    id: t.id,
    url: `https://x.com/${author?.username ?? 'i'}/status/${t.id}`,
    type,
    createdAt: t.created_at,
    authorId: t.author_id,
    authorUsername: author?.username,
    authorName: author?.name,
    text: t.note_tweet?.text ?? t.text,
    lang: t.lang,
    conversationId: t.conversation_id,
    inReplyToUserId: t.in_reply_to_user_id,
    inReplyToUsername: replyTo?.username,
    repliedTo: refInfo(ref('replied_to')),
    quoted: refInfo(ref('quoted')),
    retweeted: refInfo(ref('retweeted')),
    mentions: (t.entities?.mentions ?? []).map(m => m.username),
    hashtags: (t.entities?.hashtags ?? []).map(h => h.tag),
    cashtags: (t.entities?.cashtags ?? []).map(c => c.tag),
    urls: (t.entities?.urls ?? []).map(u => u.expanded_url ?? u.url).filter(u => !/^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+\/(photo|video)/.test(u)),
    media: (t.attachments?.media_keys ?? []).map(k => media.get(k)).filter(Boolean).map(m => ({type: m.type, url: m.url ?? m.preview_image_url, altText: m.alt_text})),
    likes: t.public_metrics?.like_count,
    retweets: t.public_metrics?.retweet_count,
    replies: t.public_metrics?.reply_count,
    quotes: t.public_metrics?.quote_count,
    bookmarks: t.public_metrics?.bookmark_count,
    impressions: t.public_metrics?.impression_count,
    source: t.source,
    possiblySensitive: t.possibly_sensitive,
  };
}

// Who the profile talks to, and who talks to it, ranked by count.
export function interactionSummary(username, {tweets = [], mentions = [], liked = []} = {}) {
  const me = username.toLowerCase();
  const bump = (map, key) => { if (key && key.toLowerCase() !== me) map.set(key, (map.get(key) ?? 0) + 1); };
  const out = {repliedTo: new Map(), mentioned: new Map(), retweeted: new Map(), quoted: new Map(), mentionedBy: new Map(), liked: new Map(), hashtags: new Map(), cashtags: new Map()};
  const byType = {tweet: 0, reply: 0, retweet: 0, quote: 0};
  for (const t of tweets) {
    byType[t.type] = (byType[t.type] ?? 0) + 1;
    if (t.type === 'reply') bump(out.repliedTo, t.inReplyToUsername ?? t.repliedTo?.authorUsername);
    if (t.type === 'retweet') bump(out.retweeted, t.retweeted?.authorUsername);
    if (t.quoted) bump(out.quoted, t.quoted.authorUsername);
    if (t.type !== 'retweet') {
      for (const m of new Set(t.mentions)) bump(out.mentioned, m);
      for (const h of t.hashtags) bump(out.hashtags, '#' + h.toLowerCase());
      for (const c of t.cashtags) bump(out.cashtags, '$' + c.toUpperCase());
    }
  }
  for (const t of mentions) bump(out.mentionedBy, t.authorUsername);
  for (const t of liked) bump(out.liked, t.authorUsername);
  const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([name, count]) => ({name, count}));
  const dates = tweets.map(t => t.createdAt).filter(Boolean).sort();
  const sum = k => tweets.filter(t => t.type !== 'retweet').reduce((s, t) => s + (t[k] ?? 0), 0);
  return {
    username,
    counts: {...byType, total: tweets.length, mentionsReceived: mentions.length, liked: liked.length},
    firstTweetAt: dates[0], lastTweetAt: dates.at(-1),
    engagementReceived: {likes: sum('likes'), retweets: sum('retweets'), replies: sum('replies'), quotes: sum('quotes')},
    topRepliedTo: top(out.repliedTo), topMentioned: top(out.mentioned), topRetweeted: top(out.retweeted), topQuoted: top(out.quoted),
    topMentionedBy: top(out.mentionedBy), topLikedAuthors: top(out.liked), topHashtags: top(out.hashtags), topCashtags: top(out.cashtags),
  };
}
