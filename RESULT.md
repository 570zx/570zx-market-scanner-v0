# Actor live check 2026-09-30T13:30:47Z (6986a94)

## Unit tests
```
# Subtest: several matching model names are merged without duplicates
ok 14 - several matching model names are merged without duplicates
  ---
  duration_ms: 0.404704
  type: 'test'
  ...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 54.19122
```
## SDK run
```
[32mINFO[39m  System info[90m {"apifyVersion":"3.7.2","apifyClientVersion":"2.25.0","crawleeVersion":"3.18.2","osType":"Linux","nodeVersion":"v22.23.2"}[39m
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Checked 3 of 3 VINs
[32mINFO[39m  [Status message]: Checked 3 VINs: 2 reports delivered, 1 not decodable or invalid (not charged).
1HGCM82633A004352 ok 2003 HONDA Accord recalls 24 complaints 2013 ncap None
5YJ3E1EA7KF317000 partial 2019 TESLA Model 3 recalls 22 complaints 614 ncap 5
BAD invalid_vin None None None recalls None complaints None ncap None
```
## Live
## 1HGCM82633A004352  status=ok billable=true (6821 ms)
2003 HONDA Accord | recalls 24 (["ACCORD","ACCORD","ACCORD","ACCORD"]) | complaints 2013 (["ACCORD","ACCORD","ACCORD","ACCORD"]) | NCAP null | warnings: []
## 5YJ3E1EA7KF317000  status=partial billable=true (1215 ms)
2019 TESLA Model 3 | recalls 22 (["MODEL 3","MODEL 3"]) | complaints 614 (["MODEL 3","MODEL 3"]) | NCAP 5 | warnings: ["Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo."]
## 1FTFW1ET5DFC10312  status=partial billable=true (27413 ms)
2013 FORD F-150 | recalls 0 (["F-150 SUPERCAB","F-150 SUPERCAB","F-150 SUPER CREW","F-150 SUPER CREW","F-150 REGULAR CAB"]) | complaints 2796 (["F-150 SUPERCAB","F-150 SUPERCAB","F-150 SUPER CREW","F-150 SUPER CREW","F-150 REGULAR CAB"]) | NCAP null | warnings: ["Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo."]
## 3VWFE21C04M000001  status=ok billable=true (2310 ms)
2004 VOLKSWAGEN Beetle | recalls 2 (["NEW BEETLE","NEW BEETLE"]) | complaints 361 (["NEW BEETLE","NEW BEETLE"]) | NCAP null | warnings: []
## 1G1YY22G965109876  status=partial billable=true (2132 ms)
2006 CHEVROLET Corvette | recalls 5 (["CORVETTE"]) | complaints 413 (["CORVETTE"]) | NCAP null | warnings: ["Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo."]
## WBAVB13506PT12345  status=ok billable=true (1721 ms)
2006 BMW 325i | recalls 7 (["325i"]) | complaints 0 (["325i"]) | NCAP null | warnings: []
## NOTAVIN  status=invalid_vin billable=false (0 ms)
undefined undefined undefined | recalls undefined (undefined) | complaints undefined (undefined) | NCAP undefined | warnings: undefined

billable 6 of 7
