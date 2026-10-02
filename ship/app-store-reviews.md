# ship app-store-reviews 2026-10-02T17:30:00Z 2d0c7738a1009a5aeb79561d43cf68d9c71617e1
## unit tests
```
# tests 15
# pass 15
# fail 0
```
## push
```
2026-10-02T17:30:29.852Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: l5B6lLfojVhkGwS35
Build ID: N7VJHerqOV0UCPyHm
Build number: 0.1.2

Actor URL: https://console.apify.com/actors/l5B6lLfojVhkGwS35
Build URL: https://console.apify.com/actors/l5B6lLfojVhkGwS35#/builds/0.1.2
```
## Apify setup and test run
```
actor Dodge_Bot/app-store-reviews
pricing + store details: 200 unchanged pricing kept ok
pricing confirmed: True {'app': 0.002, 'review': 0.0002}
test run: SUCCEEDED, Returned 3 app records and 15 reviews., secs 25.087, platform cost $0.0008235717093563744, items 18, ok 18
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "country": "us", "checkedAt": "2026-10-02T17:30:40.880Z", "type": "app", "status": "ok", "appId": "324684580", "bundleId": "com.spotify.client", "name": "Spotify: Music and Podcasts", "developer": "Spotify", "developerId": "324684583", "url": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580?uo=4" …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14614482193", "author": "Masmsmw", "rating": 5, "title": "This helped me.. a lot", "text": "Spotify made me feel welcome it made me be me and I love music when I’m sad Spotify is always ther …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14614481878", "author": "hazemonstaaa", "rating": 3, "title": "adds", "text": "there’s hella adds and it’s annoying every 2 songs there’s 2 min of adds and it’s the same repeating adds at le …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14614475100", "author": "X-unknown😁", "rating": 5, "title": "Spotify has been on a roll lately ‼️", "text": "⭐️⭐️⭐️⭐️⭐️", "appVersion": "9.1.86", "date": "2026-10-01T04:02:43-07:00", "voteSu …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14614473523", "author": "dbfwaldo", "rating": 5, "title": "More songs", "text": "Add more underground artist", "appVersion": "9.1.86", "date": "2026-10-01T04:02:11-07:00", "voteSum": 0, "vot …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14614455180", "author": "Shanock1)(", "rating": 1, "title": "Not best music app to me anymore", "text": "Lately my account is been buffering, on my profile has some number 3 I never put that …
   {"input": "Duolingo", "country": "us", "checkedAt": "2026-10-02T17:30:44.450Z", "type": "app", "status": "ok", "appId": "570060128", "bundleId": "com.duolingo.DuolingoMobile", "name": "Duolingo: Language Lessons", "developer": "Duolingo", "developerId": "570060151", "url": "https://apps.apple.com/us/app/duolingo-language-lessons/id570060128?uo=4", "price": 0, "currency": "USD", "formattedPrice": " …
   {"input": "Duolingo", "type": "review", "status": "ok", "appId": "570060128", "appName": "Duolingo: Language Lessons", "country": "us", "reviewId": "14614480592", "author": "Atecyr", "rating": 2, "title": "Juvenile and Unresponsive", "text": "I found that this app has become more and more geared towards school-age children. While I enjoy the gamification it’s just gone overboard and all the little …
public: 200 True
```
