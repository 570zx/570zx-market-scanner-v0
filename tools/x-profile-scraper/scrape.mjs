#!/usr/bin/env node
// Pull a public X (Twitter) profile's posts and interactions through the official X API v2.
// Usage: X_BEARER_TOKEN=... node scrape.mjs <username|profile URL> [options]   (see --help)
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {XClient, TWEET_PARAMS, USER_FIELDS, normalizeUsername, flattenTweet, interactionSummary} from './lib.mjs';

const HELP = `Usage: node scrape.mjs <username|profile URL> [options]

Env: X_BEARER_TOKEN  App bearer token from developer.x.com

Options:
  --archive          Use full-archive search (whole history back to 2006; needs Pro or
                     Enterprise API access). Without it: newest 3,200 posts, 800 mentions.
  --since <date>     Only posts on/after this date (ISO, e.g. 2024-01-01). Archive mode only.
  --until <date>     Only posts before this date. Archive mode only.
  --no-mentions      Skip posts by others that mention or reply to the profile
  --likes            Also fetch posts the profile has liked (if X still exposes them)
  --followers        Also fetch followers (capped by --max-users)
  --following        Also fetch accounts the profile follows (capped by --max-users)
  --max-users <n>    Cap for followers/following (default 5000)
  --max <n>          Cap for each tweet stream (default: no cap)
  --out <dir>        Output folder (default ./out/<username>)
  --fresh            Ignore saved progress and start over
  -h, --help`;

const {values: opt, positionals} = parseArgs({allowPositionals: true, options: {
  archive: {type: 'boolean'}, since: {type: 'string'}, until: {type: 'string'},
  'no-mentions': {type: 'boolean'}, likes: {type: 'boolean'}, followers: {type: 'boolean'}, following: {type: 'boolean'},
  'max-users': {type: 'string'}, max: {type: 'string'}, out: {type: 'string'}, fresh: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
}});
if (opt.help || !positionals[0]) { console.log(HELP); process.exit(opt.help ? 0 : 1); }

const log = (...a) => console.error(...a);
process.on('uncaughtException', e => { log(`Error: ${e.message}`); process.exit(1); });
const username = normalizeUsername(positionals[0]);
const outDir = path.resolve(opt.out ?? path.join('out', username));
const maxItems = opt.max ? Number(opt.max) : Infinity;
const maxUsers = Number(opt['max-users'] ?? 5000);
const iso = d => { const t = Date.parse(d); if (Number.isNaN(t)) throw new Error(`Bad date: ${d}`); return new Date(t).toISOString(); };
if ((opt.since || opt.until) && !opt.archive) log('Note: --since/--until apply to --archive mode only; ignoring them.');

fs.mkdirSync(outDir, {recursive: true});
const statePath = path.join(outDir, 'state.json');
const fileOf = name => path.join(outDir, `${name}.jsonl`);
if (opt.fresh) for (const f of fs.readdirSync(outDir)) if (f.endsWith('.jsonl') || f === 'state.json') fs.rmSync(path.join(outDir, f));
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const readJsonl = name => fs.existsSync(fileOf(name)) ? fs.readFileSync(fileOf(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// Full-archive search allows 1 request/second per app.
const client = new XClient(process.env.X_BEARER_TOKEN, {log, minIntervalMs: opt.archive ? 1100 : 0});

// Fetches one paginated stream into <name>.jsonl, saving the page token after every page so a rerun resumes.
async function stream(name, apiPath, params, {tokenParam = 'pagination_token', map = x => x, limit = maxItems} = {}) {
  const st = state[name] ??= {};
  if (st.done) { log(`${name}: already complete (${st.count ?? 0}), skipping. Use --fresh to refetch.`); return; }
  const seen = new Set(readJsonl(name).map(x => x.id));
  st.count = seen.size;
  try {
    for await (const page of client.paginate(apiPath, params, {tokenParam, startToken: st.nextToken, limit: limit - seen.size})) {
      const rows = page.data.map(d => map(d, page.includes)).filter(r => !seen.has(r.id));
      rows.forEach(r => seen.add(r.id));
      if (rows.length) fs.appendFileSync(fileOf(name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      st.count = seen.size; st.nextToken = page.nextToken; saveState();
      log(`${name}: ${seen.size}${page.data.at(-1)?.created_at ? ` (back to ${page.data.at(-1).created_at.slice(0, 10)})` : ''}`);
    }
    st.done = true; delete st.nextToken; saveState();
  } catch (e) {
    if ([401, 403].includes(e.status)) { log(`${name}: skipped — ${e.message}`); st.skipped = e.message; saveState(); return; }
    throw e;
  }
}

const userRes = await client.get(`/users/by/username/${username}`, {'user.fields': USER_FIELDS, expansions: 'pinned_tweet_id', 'tweet.fields': 'created_at,public_metrics'});
const user = userRes.data;
if (!user) throw new Error(`User @${username} not found: ${JSON.stringify(userRes.errors ?? userRes)}`);
if (user.protected) log(`Warning: @${username} is protected; only public data is reachable, so expect little or nothing.`);
fs.writeFileSync(path.join(outDir, 'profile.json'), JSON.stringify({...user, pinnedTweet: userRes.includes?.tweets?.[0], fetchedAt: new Date().toISOString()}, null, 2));
log(`@${user.username} (${user.name}): ${user.public_metrics?.tweet_count} posts, ${user.public_metrics?.followers_count} followers`);

const flat = (t, inc) => flattenTweet(t, inc);
if (opt.archive) {
  const range = {start_time: opt.since ? iso(opt.since) : '2006-03-21T00:00:00Z', end_time: opt.until ? iso(opt.until) : undefined, max_results: 500, ...TWEET_PARAMS};
  await stream('tweets', '/tweets/search/all', {query: `from:${username}`, ...range}, {tokenParam: 'next_token', map: flat});
  if (!opt['no-mentions']) await stream('mentions', '/tweets/search/all', {query: `(@${username} OR to:${username}) -from:${username}`, ...range}, {tokenParam: 'next_token', map: flat});
} else {
  await stream('tweets', `/users/${user.id}/tweets`, {max_results: 100, ...TWEET_PARAMS}, {map: flat});
  if (!opt['no-mentions']) await stream('mentions', `/users/${user.id}/mentions`, {max_results: 100, ...TWEET_PARAMS}, {map: flat});
}
if (opt.likes) await stream('liked', `/users/${user.id}/liked_tweets`, {max_results: 100, ...TWEET_PARAMS}, {map: flat});
const userParams = {max_results: 1000, 'user.fields': USER_FIELDS};
if (opt.followers) await stream('followers', `/users/${user.id}/followers`, userParams, {limit: maxUsers});
if (opt.following) await stream('following', `/users/${user.id}/following`, userParams, {limit: maxUsers});

const summary = interactionSummary(user.username, {tweets: readJsonl('tweets'), mentions: readJsonl('mentions'), liked: readJsonl('liked')});
summary.mode = opt.archive ? 'full-archive' : 'recent-timeline (API caps: 3,200 posts / 800 mentions)';
summary.skipped = Object.fromEntries(Object.entries(state).filter(([, s]) => s.skipped).map(([k, s]) => [k, s.skipped]));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
log(`Done → ${outDir}`);
log(`  ${summary.counts.total} posts (${summary.counts.tweet} original, ${summary.counts.reply} replies, ${summary.counts.retweet} reposts, ${summary.counts.quote} quotes), ${summary.counts.mentionsReceived} mentions/replies received`);
if (summary.topRepliedTo[0]) log(`  Talks to most: ${summary.topRepliedTo.slice(0, 5).map(x => `@${x.name} (${x.count})`).join(', ')}`);
if (summary.topMentionedBy[0]) log(`  Mentioned most by: ${summary.topMentionedBy.slice(0, 5).map(x => `@${x.name} (${x.count})`).join(', ')}`);
