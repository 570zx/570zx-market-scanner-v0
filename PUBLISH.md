# Actor publish 2026-09-30T15:43:46Z
Apify user: Dodge_Bot

## Push
```
2026-09-30T15:43:45.388Z #12 [auth] sharing credentials for 031263542130.dkr.ecr.us-east-1.amazonaws.com
2026-09-30T15:43:45.389Z #12 DONE 0.0s
2026-09-30T15:43:45.391Z #11 exporting to image
2026-09-30T15:43:45.393Z #11 exporting manifest sha256:81098866a58ebbc51bb56b485717d669c8dfb268160aa2b5f416e6d31b3228c2 0.0s done
2026-09-30T15:43:45.395Z #11 exporting config sha256:e7f093810b4c17e3a1ea8488fdee560391b5f2882fac0658384b7921c6de98a0 0.0s done
2026-09-30T15:43:45.397Z #11 pushing layers
2026-09-30T15:43:45.609Z #11 ...
2026-09-30T15:43:45.611Z #13 exporting cache to Amazon S3
2026-09-30T15:43:45.613Z #13 preparing build cache for export done
2026-09-30T15:43:45.615Z #13 sending cache export 0.2s done
2026-09-30T15:43:45.616Z #13 writing layer sha256:afbcfc8a186786f4250a5a3a3d909f92f5e57c1f39105ad87d638c00d850bac2 0.1s done
2026-09-30T15:43:45.618Z #13 writing layer sha256:a6d8d2c00231fd5807a6fb353011faaf96d3bacdca06d8187604d943c8e913a9 0.0s done
2026-09-30T15:43:45.619Z #13 DONE 0.2s
2026-09-30T15:43:45.772Z #11 exporting to image
2026-09-30T15:43:45.774Z #11 pushing layers 0.5s done
2026-09-30T15:43:45.776Z #11 pushing manifest for 031263542130.dkr.ecr.us-east-1.amazonaws.com/act-builds-prod-00368:jSkz2ybVTJ7rAHv12@sha256:81098866a58ebbc51bb56b485717d669c8dfb268160aa2b5f416e6d31b3228c2
2026-09-30T15:43:46.000Z #11 pushing manifest for 031263542130.dkr.ecr.us-east-1.amazonaws.com/act-builds-prod-00368:jSkz2ybVTJ7rAHv12@sha256:81098866a58ebbc51bb56b485717d669c8dfb268160aa2b5f416e6d31b3228c2 0.2s done
2026-09-30T15:43:46.002Z #11 DONE 0.9s
2026-09-30T15:43:46.071Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: IFgedzUMAOip8F0co
Build ID: jSkz2ybVTJ7rAHv12
Build number: 0.2.1

Actor URL: https://console.apify.com/actors/IFgedzUMAOip8F0co
Build URL: https://console.apify.com/actors/IFgedzUMAOip8F0co#/builds/0.2.1
```
## Actor
```
{'id': 'IFgedzUMAOip8F0co', 'name': 'vehicle-safety-intel', 'title': 'VIN Decoder + Recalls + Complaints + Crash Ratings (NHTSA)', 'isPublic': False, 'pricingInfos': [{'pricingModel': 'PAY_PER_EVENT', 'pricingPerEvent': {'actorChargeEvents': {'apify-actor-start': {'eventTitle': 'Actor Start', 'eventDescription': 'Charged when the Actor starts running. Number of events charged depends on Actor memory (one event per GB, minimum one event).', 'eventPriceUsd': 5e-05}, 'vehicle-report': {'eventTitle': 'Vehicle report', 'eventDescription': 'One decoded VIN with specs, recalls, complaints and crash ratings. Invalid or undecodable VINs are free.', 'eventPriceUsd': 0.01}}}, 'createdAt': '2026-09-30T15:40:47.108Z', 'startedAt': '2026-09-30T15:40:47.108Z', 'apifyMarginPercentage': 0.2}]}
builds {'latest': {'buildId': 'jSkz2ybVTJ7rAHv12', 'finishedAt': '2026-09-30T15:43:46.073Z', 'buildNumberInt': 200001, 'buildNumber': '0.2.1'}}
```
## Test run on Apify (2 VINs)
```
1HGCM82633A004352 ok 2003 HONDA Accord recalls 24 complaints 2013 ncap None
5YJ3E1EA7KF317000 partial 2019 TESLA Model 3 recalls 22 complaints 614 ncap 5
last run SUCCEEDED secs 2.53 usd 8.546857708030276e-05 statusMessage Checked 2 VINs: 2 reports delivered, 0 not decodable or invalid (not charged).
```
