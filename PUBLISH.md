# Actor publish 2026-09-30T15:29:13Z
Apify user: Dodge_Bot

## Push
```
2026-09-30T15:29:11.680Z #12 DONE 0.0s
2026-09-30T15:29:11.681Z #11 exporting to image
2026-09-30T15:29:11.681Z #11 exporting manifest sha256:ebd5aa5c824c6786e88d30da1f17e73772053f9592e10765446feed4b6db96d8 0.0s done
2026-09-30T15:29:11.681Z #11 exporting config sha256:948c5007113d0885974849de4fef014d4a40f975952b6bbc72b24fe3c107ce86 0.0s done
2026-09-30T15:29:11.682Z #11 pushing layers
2026-09-30T15:29:11.888Z #11 ...
2026-09-30T15:29:11.889Z #13 exporting cache to Amazon S3
2026-09-30T15:29:11.889Z #13 preparing build cache for export 0.0s done
2026-09-30T15:29:11.890Z #13 sending cache export 0.1s done
2026-09-30T15:29:11.890Z #13 writing layer sha256:3a44c0bf304aff32ad84cc6c0380a2f72abb970150c7434f39efaee6b0f12445 0.0s done
2026-09-30T15:29:11.891Z #13 writing layer sha256:9388a9cd7357016d1d3d76510cf8363a012a89a595e456793a1a14bf9579c04b 0.0s done
2026-09-30T15:29:11.891Z #13 writing layer sha256:ecbdf75a5cd8dcc01f37cd45bbe9f0e82842d45171477c7285f7a6319d2518c4 0.0s done
2026-09-30T15:29:11.891Z #13 DONE 0.1s
2026-09-30T15:29:12.003Z #11 exporting to image
2026-09-30T15:29:12.006Z #11 pushing layers 0.4s done
2026-09-30T15:29:12.007Z #11 pushing manifest for 031263542130.dkr.ecr.us-east-1.amazonaws.com/act-builds-prod-00368:Tb2L9NQwep4XPQ4dt@sha256:ebd5aa5c824c6786e88d30da1f17e73772053f9592e10765446feed4b6db96d8
2026-09-30T15:29:12.288Z #11 pushing manifest for 031263542130.dkr.ecr.us-east-1.amazonaws.com/act-builds-prod-00368:Tb2L9NQwep4XPQ4dt@sha256:ebd5aa5c824c6786e88d30da1f17e73772053f9592e10765446feed4b6db96d8 0.3s done
2026-09-30T15:29:12.288Z #11 DONE 0.9s
2026-09-30T15:29:12.362Z ACTOR: Build finished.
Run: Applying build tag "latest"...
Apify push result: SUCCEEDED

Upload: SUCCEEDED
Build: SUCCEEDED
Actor ID: IFgedzUMAOip8F0co
Build ID: Tb2L9NQwep4XPQ4dt
Build number: 0.1.1

Actor URL: https://console.apify.com/actors/IFgedzUMAOip8F0co
Build URL: https://console.apify.com/actors/IFgedzUMAOip8F0co#/builds/0.1.1
```
## Actor
```
{'id': 'IFgedzUMAOip8F0co', 'name': 'vehicle-safety-intel', 'title': 'VIN Decoder + Recalls + Complaints + Crash Ratings (NHTSA)', 'isPublic': False, 'pricingInfos': None}
builds {'latest': {'buildId': 'Tb2L9NQwep4XPQ4dt', 'finishedAt': '2026-09-30T15:29:12.365Z', 'buildNumberInt': 100001, 'buildNumber': '0.1.1'}}
```
## Test run on Apify (2 VINs)
```
1HGCM82633A004352 ok 2003 HONDA Accord recalls 24 complaints 2013 ncap None
5YJ3E1EA7KF317000 partial 2019 TESLA Model 3 recalls 22 complaints 614 ncap 5
last run SUCCEEDED secs 4.493 usd 0.0001233345575200187 statusMessage Checked 2 VINs: 2 reports delivered, 0 not decodable or invalid (not charged).
```
