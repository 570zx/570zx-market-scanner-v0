// Apple's public iTunes Search/Lookup API and App Store customer-review RSS feeds.

export function parseApp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const id = /(?:^id|^|\/id|[?&]id=)(\d{6,12})(?:\D|$)/.exec(s);
  if (id) {
    const cc = /apps\.apple\.com\/([a-z]{2})\//i.exec(s)?.[1]?.toLowerCase() ?? null;
    return {id: id[1], country: cc};
  }
  if (/^\d{6,12}$/.test(s)) return {id: s, country: null};
  return {term: s};
}

export const lookupUrl = (id, cc) => `https://itunes.apple.com/lookup?id=${id}&country=${cc}&entity=software`;
export const searchUrl = (term, cc) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${cc}&entity=software&limit=1`;
export const reviewsUrl = (id, cc, page) => `https://itunes.apple.com/${cc}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;

export function appDetails(r, cc) {
  if (!r) return null;
  return {
    appId: String(r.trackId), bundleId: r.bundleId ?? null, name: r.trackName ?? null, developer: r.artistName ?? r.sellerName ?? null, developerId: r.artistId ? String(r.artistId) : null,
    country: cc, url: r.trackViewUrl ?? null, price: r.price ?? null, currency: r.currency ?? null, formattedPrice: r.formattedPrice ?? null,
    rating: r.averageUserRating != null ? Math.round(r.averageUserRating * 100) / 100 : null, ratingCount: r.userRatingCount ?? null,
    ratingCurrentVersion: r.averageUserRatingForCurrentVersion != null ? Math.round(r.averageUserRatingForCurrentVersion * 100) / 100 : null, ratingCountCurrentVersion: r.userRatingCountForCurrentVersion ?? null,
    version: r.version ?? null, currentVersionReleaseDate: r.currentVersionReleaseDate ?? null, releaseDate: r.releaseDate ?? null, releaseNotes: r.releaseNotes ?? null,
    primaryGenre: r.primaryGenreName ?? null, genres: r.genres ?? [], contentRating: r.contentAdvisoryRating ?? r.trackContentRating ?? null,
    sizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null, minimumOsVersion: r.minimumOsVersion ?? null, languages: r.languageCodesISO2A ?? [],
    description: r.description ?? null, iconUrl: r.artworkUrl512 ?? r.artworkUrl100 ?? null, screenshotUrls: r.screenshotUrls ?? [], iPadScreenshotUrls: r.ipadScreenshotUrls ?? []
  };
}

const L = x => (x && typeof x === 'object' && 'label' in x ? x.label : x ?? null);

export function parseReviews(json) {
  const entries = [].concat(json?.feed?.entry ?? []);
  return entries.filter(e => e && e['im:rating']).map(e => ({
    reviewId: L(e.id), author: L(e.author?.name), rating: Number(L(e['im:rating'])), title: L(e.title), text: L(e.content),
    appVersion: L(e['im:version']), date: L(e.updated), voteSum: Number(L(e['im:voteSum']) ?? 0), voteCount: Number(L(e['im:voteCount']) ?? 0)
  }));
}

// Simple spacing limiter: Apple allows roughly 20 requests a minute per IP.
export class Spacer {
  constructor(minGapMs, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms))) { Object.assign(this, {minGapMs, now, sleep}); this.next = 0; }
  async wait() {
    const t = this.now(), at = Math.max(t, this.next);
    this.next = at + this.minGapMs;
    if (at > t) await this.sleep(at - t);
  }
}
