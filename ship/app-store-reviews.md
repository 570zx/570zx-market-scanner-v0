# ship app-store-reviews 2026-09-30T16:29:27Z c00dcdcb151da2664345188cc9312b96c921739c
## unit tests
```
# tests 15
# pass 15
# fail 0
```
## push
```
2026-09-30T16:29:46.107Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: l5B6lLfojVhkGwS35
Build ID: cPJKauYqZx9P6nQFZ
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/l5B6lLfojVhkGwS35
Build URL: https://console.apify.com/actors/l5B6lLfojVhkGwS35#/builds/0.1.1
```
## Apify setup and test run
```
actor Dodge_Bot/app-store-reviews
pricing + store details: 200  ok
pricing confirmed: True {'app': 0.002, 'review': 0.0002}
test run: SUCCEEDED, Returned 3 app records and 15 reviews., secs 18.283, platform cost $0.0006325366763985821, items 18, ok 18
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "country": "us", "checkedAt": "2026-09-30T16:29:50.007Z", "type": "app", "status": "ok", "appId": "324684580", "bundleId": "com.spotify.client", "name": "Spotify: Music and Podcasts", "developer": "Spotify", "developerId": "324684583", "url": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580?uo=4" …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14603418822", "author": "M1rra58", "rating": 5, "title": "Songs", "text": "Hi I love Spotify and how I love it it’s because when I go on a other app the song is till playing and I like it sh …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14603399497", "author": "zephyr322", "rating": 5, "title": "Always there", "text": "Thanks Spotify for keeping the music going offline out in the back woods!", "appVersion": "9.1.86", "date" …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14603384672", "author": "sally mutt", "rating": 5, "title": "Love it!", "text": "It’s a great way to listen to music", "appVersion": "9.1.86", "date": "2026-09-28T06:29:45-07:00", "voteSum": …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14603364693", "author": "ELITE_TTV-_-", "rating": 5, "title": "Idk", "text": "It’s tuff bro trust I listen to tuff music", "appVersion": "9.1.86", "date": "2026-09-28T06:23:44-07:00", "voteS …
   {"input": "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "type": "review", "status": "ok", "appId": "324684580", "appName": "Spotify: Music and Podcasts", "country": "us", "reviewId": "14603363606", "author": "Whatamithinkin", "rating": 4, "title": "The APP has been wonky lately", "text": "Lately the APP freezes when I go between APP on my iPad. Other than that, I enjoy th …
   {"input": "Duolingo", "country": "us", "checkedAt": "2026-09-30T16:29:53.590Z", "type": "app", "status": "ok", "appId": "570060128", "bundleId": "com.duolingo.DuolingoMobile", "name": "Duolingo: Language Lessons", "developer": "Duolingo", "developerId": "570060151", "url": "https://apps.apple.com/us/app/duolingo-language-lessons/id570060128?uo=4", "price": 0, "currency": "USD", "formattedPrice": " …
   {"input": "Duolingo", "type": "review", "status": "ok", "appId": "570060128", "appName": "Duolingo: Language Lessons", "country": "us", "reviewId": "14603415806", "author": "slVrPncAk3", "rating": 5, "title": "A great app for learning chess", "text": "Duolingo helped me out with my strategy for chess and helping me choose where to put my pieces", "appVersion": "7.141.1", "date": "2026-09-28T06:38: …
```
