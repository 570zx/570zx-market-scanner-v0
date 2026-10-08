import test from 'node:test';
import assert from 'node:assert/strict';
import {XClient, normalizeUsername, flattenTweet, interactionSummary} from '../lib.mjs';

test('normalizeUsername accepts handles and profile URLs', () => {
  assert.equal(normalizeUsername('@jack'), 'jack');
  assert.equal(normalizeUsername('https://x.com/elonmusk/status/1'), 'elonmusk');
  assert.equal(normalizeUsername('https://twitter.com/Some_User?lang=en'), 'Some_User');
  assert.throws(() => normalizeUsername('not a user!'));
});

const includes = {
  users: [{id: '1', username: 'me', name: 'Me'}, {id: '2', username: 'bob', name: 'Bob'}, {id: '3', username: 'amy', name: 'Amy'}],
  tweets: [{id: '900', author_id: '2', text: 'original by bob'}, {id: '901', author_id: '3', text: 'amy quote target'}],
  media: [{media_key: 'm1', type: 'photo', url: 'https://pbs/x.jpg'}],
};

test('flattenTweet classifies replies, retweets and quotes and resolves usernames', () => {
  const reply = flattenTweet({id: '10', author_id: '1', text: '@bob hi', in_reply_to_user_id: '2', referenced_tweets: [{type: 'replied_to', id: '900'}],
    entities: {mentions: [{username: 'bob'}], cashtags: [{tag: 'tsla'}]}, attachments: {media_keys: ['m1']}, public_metrics: {like_count: 4}}, includes);
  assert.equal(reply.type, 'reply');
  assert.equal(reply.url, 'https://x.com/me/status/10');
  assert.equal(reply.inReplyToUsername, 'bob');
  assert.equal(reply.repliedTo.text, 'original by bob');
  assert.deepEqual(reply.media, [{type: 'photo', url: 'https://pbs/x.jpg', altText: undefined}]);
  assert.equal(reply.likes, 4);
  assert.equal(flattenTweet({id: '11', author_id: '1', text: 'RT', referenced_tweets: [{type: 'retweeted', id: '900'}]}, includes).type, 'retweet');
  const q = flattenTweet({id: '12', author_id: '1', text: 'look', referenced_tweets: [{type: 'quoted', id: '901'}]}, includes);
  assert.equal(q.type, 'quote');
  assert.equal(q.quoted.authorUsername, 'amy');
  assert.equal(flattenTweet({id: '13', author_id: '1', text: 'long', note_tweet: {text: 'long full text'}}, includes).text, 'long full text');
});

test('interactionSummary ranks who the profile talks to and who talks to it', () => {
  const tweets = [
    {type: 'reply', inReplyToUsername: 'bob', mentions: ['bob'], hashtags: [], cashtags: ['tsla'], createdAt: '2020-01-01T00:00:00Z', likes: 3},
    {type: 'reply', inReplyToUsername: 'bob', mentions: ['bob', 'amy'], hashtags: ['AI'], cashtags: [], createdAt: '2021-01-01T00:00:00Z', likes: 2},
    {type: 'retweet', retweeted: {authorUsername: 'amy'}, mentions: ['amy'], hashtags: [], cashtags: [], createdAt: '2022-01-01T00:00:00Z', likes: 999},
    {type: 'reply', inReplyToUsername: 'me', mentions: ['me'], hashtags: [], cashtags: [], createdAt: '2019-01-01T00:00:00Z'},
  ];
  const s = interactionSummary('me', {tweets, mentions: [{authorUsername: 'amy'}, {authorUsername: 'amy'}, {authorUsername: 'bob'}]});
  assert.deepEqual(s.topRepliedTo, [{name: 'bob', count: 2}]); // self-replies (threads) are excluded
  assert.deepEqual(s.topMentioned, [{name: 'bob', count: 2}, {name: 'amy', count: 1}]); // retweets don't count as mentions
  assert.deepEqual(s.topRetweeted, [{name: 'amy', count: 1}]);
  assert.deepEqual(s.topMentionedBy[0], {name: 'amy', count: 2});
  assert.deepEqual(s.topCashtags, [{name: '$TSLA', count: 1}]);
  assert.equal(s.engagementReceived.likes, 5); // retweet metrics belong to the original author
  assert.equal(s.firstTweetAt, '2019-01-01T00:00:00Z');
  assert.equal(s.counts.reply, 3);
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async url => {
    calls.push(new URL(url));
    const r = responses.shift();
    return {status: r.status ?? 200, headers: new Map(Object.entries(r.headers ?? {})), json: async () => r.body};
  };
  fn.calls = calls;
  return fn;
}

test('paginate follows next_token, waits out 429 and stops at the limit', async () => {
  const f = fakeFetch([
    {body: {data: [{id: '1'}, {id: '2'}], meta: {next_token: 'A'}}},
    {status: 429, headers: {'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) - 10)}, body: {}},
    {body: {data: [{id: '3'}], meta: {next_token: 'B'}}},
    {body: {data: [{id: '4'}], meta: {}}},
  ]);
  const c = new XClient('tok', {fetchImpl: f, log: () => {}});
  const ids = [];
  for await (const p of c.paginate('/users/1/tweets', {max_results: 100}, {limit: 3})) ids.push(...p.data.map(d => d.id));
  assert.deepEqual(ids, ['1', '2', '3']);
  assert.equal(f.calls[2].searchParams.get('pagination_token'), 'A');
  assert.equal(f.calls.length, 3); // 2 pages + 1 rate-limited retry, then the limit stops it
});

test('API errors carry the status and message', async () => {
  const c = new XClient('tok', {fetchImpl: fakeFetch([{status: 403, body: {title: 'Forbidden', detail: 'needs Pro access'}}]), log: () => {}});
  await assert.rejects(c.get('/tweets/search/all'), e => e.status === 403 && /needs Pro access/.test(e.message));
  assert.throws(() => new XClient(''), /X_BEARER_TOKEN/);
});
