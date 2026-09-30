import test from 'node:test';
import assert from 'node:assert/strict';
import {parseApp, appDetails, parseReviews, Spacer, reviewsUrl} from '../src/appstore.js';

test('parseApp', () => {
  assert.deepEqual(parseApp('https://apps.apple.com/gb/app/spotify-music-and-podcasts/id324684580'), {id: '324684580', country: 'gb'});
  assert.deepEqual(parseApp('324684580'), {id: '324684580', country: null});
  assert.deepEqual(parseApp('id324684580'), {id: '324684580', country: null});
  assert.deepEqual(parseApp('Spotify'), {term: 'Spotify'});
  assert.equal(parseApp(''), null);
  assert.equal(reviewsUrl('1', 'us', 2), 'https://itunes.apple.com/us/rss/customerreviews/page=2/id=1/sortby=mostrecent/json');
});

test('appDetails maps lookup fields', () => {
  const d = appDetails({trackId: 324684580, trackName: 'Spotify', artistName: 'Spotify', averageUserRating: 4.7812, userRatingCount: 1000, price: 0, formattedPrice: 'Free', currency: 'USD', version: '9.0', fileSizeBytes: '123', genres: ['Music']}, 'us');
  assert.equal(d.appId, '324684580'); assert.equal(d.rating, 4.78); assert.equal(d.sizeBytes, 123); assert.equal(d.formattedPrice, 'Free');
});

test('parseReviews skips the app entry and reads labels', () => {
  const j = {feed: {entry: [
    {'im:name': {label: 'Spotify'}},
    {id: {label: '111'}, author: {name: {label: 'Ann'}}, 'im:rating': {label: '5'}, title: {label: 'Great'}, content: {label: 'Love it'}, 'im:version': {label: '9.0'}, updated: {label: '2026-09-29T10:00:00-07:00'}, 'im:voteSum': {label: '2'}, 'im:voteCount': {label: '3'}}
  ]}};
  const r = parseReviews(j);
  assert.equal(r.length, 1); assert.equal(r[0].rating, 5); assert.equal(r[0].author, 'Ann'); assert.equal(r[0].voteCount, 3);
  assert.deepEqual(parseReviews({feed: {entry: {'im:rating': {label: '1'}, id: {label: 'x'}}}}).length, 1);
  assert.deepEqual(parseReviews({}), []);
});

test('Spacer spaces calls', async () => {
  let t = 0; const slept = [];
  const s = new Spacer(1000, () => t, async ms => { slept.push(ms); });
  await s.wait(); await s.wait(); await s.wait();
  assert.deepEqual(slept, [1000, 2000]);
});
