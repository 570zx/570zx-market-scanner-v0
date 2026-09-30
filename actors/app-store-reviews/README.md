# App Store Reviews & App Details

Get iPhone and iPad app data from Apple's App Store for any app and any country: app details (average rating and rating count, current version and its release notes, price, size, genre, content rating, description, icon and screenshots) and the most recent customer reviews (star rating, title, text, app version, date, helpful votes).

Paste App Store links, numeric app IDs, or just app names (the top search result is used).

**Pricing:** $2 per 1,000 app records and $0.20 per 1,000 reviews.

## Good for

- **App developers and product teams**: track what users say after each release, by version and country
- **Competitor research**: compare ratings, update frequency and complaints across rival apps
- **ASO and marketing**: mine review language for keywords and messaging
- **Sentiment analysis and AI**: feed recent reviews into your own models

## Output

Each row has `type`: `app` for app details, `review` for a review, or `error` (free) when an app isn't found in a country.

| App fields | Review fields |
|---|---|
| `appId`, `bundleId`, `name`, `developer`, `url`, `price`, `formattedPrice`, `rating`, `ratingCount`, `ratingCurrentVersion`, `version`, `currentVersionReleaseDate`, `releaseNotes`, `primaryGenre`, `genres`, `contentRating`, `sizeBytes`, `minimumOsVersion`, `languages`, `description`, `iconUrl`, `screenshotUrls` | `reviewId`, `appId`, `appName`, `country`, `rating` (1-5), `title`, `text`, `appVersion`, `date`, `author`, `voteSum`, `voteCount` |

## Input

- **Apps**: links like `https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580`, IDs like `324684580`, or names like `Duolingo`.
- **Countries**: App Store country codes (`us`, `gb`, `de`...). Reviews are separate per country.
- **Maximum reviews per app and country**: default 100, most recent first, up to 500.
- **Include app details**: on by default.

## Limits

- Apple's public review feed returns at most the 500 most recent reviews per app per country, and only reviews with written text (not star-only ratings).
- Apple limits how fast its public API can be called, so the tool paces itself at about one request every 3 seconds. Large runs take a while.
- Data comes from Apple's public iTunes Search API and App Store review feeds. No logins.
