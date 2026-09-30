# Actor live check 2026-09-30T13:26:42Z (7504460)

## Unit tests
```
# Subtest: options switch off lookups
ok 11 - options switch off lookups
  ---
  duration_ms: 0.2995
  type: 'test'
  ...
1..11
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 66.476494
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
## 1HGCM82633A004352  status=ok billable=true (6321 ms)
```json
{
 "vin": "1HGCM82633A004352",
 "inputVin": "1HGCM82633A004352",
 "checkedAt": "2026-09-30T13:26:14.229Z",
 "source": "NHTSA (US National Highway Traffic Safety Administration) public data",
 "status": "ok",
 "decodeMessage": null,
 "decodeCodes": [
  "0"
 ],
 "year": 2003,
 "make": "HONDA",
 "model": "Accord",
 "trim": "EX-V6",
 "series": null,
 "bodyClass": "Coupe",
 "vehicleType": "PASSENGER CAR",
 "doors": 2,
 "driveType": null,
 "engineCylinders": null,
 "engineDisplacementL": 2.998832712,
 "engineHp": 240,
 "fuelType": "Gasoline",
 "electrificationLevel": null,
 "transmission": "Automatic",
 "gvwrClass": "Class 1C: 4,001 - 5,000 lb (1,814 - 2,268 kg)",
 "manufacturer": "AMERICAN HONDA MOTOR CO., INC.",
 "plantCountry": "UNITED STATES (USA)",
 "plantCity": "MARYSVILLE",
 "plantState": "OHIO",
 "airbagLocFront": "1st Row (Driver and Passenger)",
 "airbagLocSide": "1st Row (Driver and Passenger)",
 "abs": null,
 "esc": null,
 "tpms": null,
 "warnings": [],
 "recallCount": 24,
 "recallsNote": "Recall campaigns that apply to this make, model and year. NHTSA does not publish whether this specific car was already repaired: check with the manufacturer or a dealer using the VIN.",
 "recalls": [
  {
   "campaignNumber": "19E068000",
   "manufacturer": "Dorman Products, Inc.",
   "reportReceivedDate": "10/10/2019",
   "component": "VEHICLE SPEED CONTROL:ACCELERATOR PEDAL",
   "summary": "Dorman Products, Inc.  (Dorman) is recalling certain Accelerator Pedal Assemblies part numbers 699-114 and 825-5029-1, sold as replacement parts for 2003-2006 Acura MDX, 2004-2008 Acura TL and TSX, 2003-2007 Honda Accord, 2005-2006 Honda CR-V, 2007-2011 Honda Element, 2005-2008 Honda Pilot and 2006-2014 Honda Ridgeline vehicles.  The rotating portion of the accelerator pedal assembly may bind. As such, these vehicles fail to comply with the requirements of Federal Motor Vehicle Safety Standard (FMVSS) number 124, \"Accelerator Control Systems.\"",
   "consequence": "If the accelerator pedal binds, the engine may not quickly return to idle after the pedal is no longer pressed, increasing the risk of a crash.",
   "remedy": "Dorman will notify owners, and qualified service facilities will replace the affected accelerator pedal assemblies, free of charge.  The recall began December 9, 2019.  Owners may contact Dorman customer service at 1-800-523-2492, using option 5.  Dorman's number for this recall is AS1019XXXX.",
   "parkIt": false,
   "parkOutSide": false,
   "overTheAirUpdate": false
  }
 ],
 "safetyRatings": [
  {
   "vehicleId": 4739,
   "description": "2003 Honda Accord 2-DR. w/SAB",
   "overall": "Not Rated",
   "frontCrash": "Not Rated",
   "sideCrash": "Not Rated",
   "rollover": "Not Rated",
   "rolloverPossibility": 0,
   "complaintsCount": 2013,
   "recallsCount": 24,
   "investigationCount": 5
  }
 ],
 "overallSafetyRating": null,
 "complaintCount": 2013,
 "complaintSummary": {
  "crashes": 158,
  "fires": 19,
  "injuries": 157,
  "deaths": 1,
  "topComponents": [
   {
    "component": "POWER TRAIN",
    "count": 926
   },
   {
    "component": "AIR BAGS",
    "count": 324
   },
   {
    "component": "SERVICE BRAKES",
    "count": 175
   },
   {
    "component": "HYDRAULIC",
    "count": 146
   },
   {
    "component": "ELECTRICAL SYSTEM",
    "count": 143
   },
   {
    "component": "ENGINE AND ENGINE COOLING",
    "count": 95
   },
   {
    "component": "STEERING",
    "count": 91
   },
   {
    "component": "VEHICLE SPEED CONTROL",
    "count
```
## 5YJ3E1EA7KF317000  status=partial billable=true (2220 ms)
```json
{
 "vin": "5YJ3E1EA7KF317000",
 "inputVin": "5YJ3E1EA7KF317000",
 "checkedAt": "2026-09-30T13:26:20.551Z",
 "source": "NHTSA (US National Highway Traffic Safety Administration) public data",
 "status": "partial",
 "decodeMessage": "1 - Check Digit (9th position) does not calculate properly",
 "decodeCodes": [
  "1"
 ],
 "year": 2019,
 "make": "TESLA",
 "model": "Model 3",
 "trim": null,
 "series": null,
 "bodyClass": "Sedan/Saloon",
 "vehicleType": "PASSENGER CAR",
 "doors": 4,
 "driveType": null,
 "engineCylinders": null,
 "engineDisplacementL": null,
 "engineHp": null,
 "fuelType": "Electric",
 "electrificationLevel": "BEV (Battery Electric Vehicle)",
 "transmission": "Automatic",
 "gvwrClass": "Class 1C: 4,001 - 5,000 lb (1,814 - 2,268 kg)",
 "manufacturer": "TESLA, INC.",
 "plantCountry": "UNITED STATES (USA)",
 "plantCity": "FREMONT",
 "plantState": "CALIFORNIA",
 "airbagLocFront": "1st Row (Driver and Passenger)",
 "airbagLocSide": "1st Row (Driver and Passenger)",
 "abs": "Standard",
 "esc": "Standard",
 "tpms": "Direct",
 "warnings": [
  "Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo."
 ],
 "recallCount": 22,
 "recallsNote": "Recall campaigns that apply to this make, model and year. NHTSA does not publish whether this specific car was already repaired: check with the manufacturer or a dealer using the VIN.",
 "recalls": [
  {
   "campaignNumber": "26V507000",
   "manufacturer": "Tesla, Inc.",
   "reportReceivedDate": "05/08/2026",
   "component": "EXTERIOR LIGHTING:HEADLIGHTS",
   "summary": "Tesla, Inc. (Tesla) is recalling certain 2017-2023 Model 3 and 2020-2023 Model Y vehicles. The headlight low beams may be too bright and exceed the maximum light output. As such, these vehicles fail to comply with the requirements of Federal Motor Vehicle Safety Standard (FMVSS) number 108, \"Lamps, Reflective Devices, and Associated Equipment.\"",
   "consequence": "Headlight low beams that are too bright can reduce visibility for oncoming drivers, increasing the risk of a crash.",
   "remedy": "The remedy is currently under development. Owner notification letters are expected to be mailed October 3, 2026. Owners may contact Tesla customer service at 1-877-798-3752. Tesla's number for this recall is SB-24-17-003.",
   "parkIt": false,
   "parkOutSide": false,
   "overTheAirUpdate": false
  }
 ],
 "safetyRatings": [
  {
   "vehicleId": 14094,
   "description": "2019 Tesla Model 3 4 DR RWD",
   "overall": "5",
   "frontCrash": "5",
   "sideCrash": "5",
   "rollover": "5",
   "rolloverPossibility": 0.066,
   "complaintsCount": 614,
   "recallsCount": 22,
   "investigationCount": 14
  }
 ],
 "overallSafetyRating": "5",
 "complaintCount": 614,
 "complaintSummary": {
  "crashes": 60,
  "fires": 5,
  "injuries": 30,
  "deaths": 4,
  "topComponents": [
   {
    "component": "FORWARD COLLISION AVOIDANCE",
    "count": 169
   },
   {
    "component": "ELECTRICAL SYSTEM",
    "count": 91
   },
   {
    "component": "AIR BAGS",
    "count": 85
   },
   {
    "component": "SUSPENSION",
    "count": 82
   },
   {
    "component": "UNKNOWN OR OTHER",
    "count": 78
   },
   {
    "component": "VEHICLE SPEED CONTROL",
    "count": 71
   },
   {
    "component": "LANE DEPARTURE",
    "count": 70
   },
   {
    "component": "SERVICE BRAKES",
    "count": 63
   }
  ]
 },
 "recentComplaints": [
  {
   "odiNumber": 11754048,
   "dateComplaintFiled": "07/31/2026",
   "dateOfIncident":
```
## 1FTFW1ET5DFC10312  status=partial billable=true (4996 ms)
```json
{
 "vin": "1FTFW1ET5DFC10312",
 "inputVin": "1FTFW1ET5DFC10312",
 "checkedAt": "2026-09-30T13:26:22.771Z",
 "source": "NHTSA (US National Highway Traffic Safety Administration) public data",
 "status": "partial",
 "decodeMessage": "1 - Check Digit (9th position) does not calculate properly",
 "decodeCodes": [
  "1"
 ],
 "year": 2013,
 "make": "FORD",
 "model": "F-150",
 "trim": null,
 "series": null,
 "bodyClass": "Pickup",
 "vehicleType": "TRUCK",
 "doors": null,
 "driveType": "4WD/4-Wheel Drive/4x4",
 "engineCylinders": null,
 "engineDisplacementL": 3.5,
 "engineHp": 365,
 "fuelType": "Gasoline",
 "electrificationLevel": null,
 "transmission": null,
 "gvwrClass": "Class 2F: 7,001 - 8,000 lb (3,175 - 3,629 kg)",
 "manufacturer": "FORD MOTOR COMPANY",
 "plantCountry": "UNITED STATES (USA)",
 "plantCity": "DEARBORN",
 "plantState": "MICHIGAN",
 "airbagLocFront": "1st Row (Driver and Passenger)",
 "airbagLocSide": "1st and 2nd Rows",
 "abs": null,
 "esc": null,
 "tpms": "Direct",
 "warnings": [
  "Check digit (position 9) does not match. Normal for some non-North-American vehicles; otherwise the VIN may contain a typo.",
  "Part of the data could not be fetched: NHTSA request failed after 4 tries: HTTP 400 (https://api.nhtsa.gov/complaints/complaintsByVehicle)"
 ],
 "recallCount": 3,
 "recallsNote": "Recall campaigns that apply to this make, model and year. NHTSA does not publish whether this specific car was already repaired: check with the manufacturer or a dealer using the VIN.",
 "recalls": [
  {
   "campaignNumber": "19V433000",
   "manufacturer": "Ford Motor Company",
   "reportReceivedDate": "10/06/2019",
   "component": "POWER TRAIN:AUTOMATIC TRANSMISSION",
   "summary": "Ford Motor Company (Ford) is recalling certain 2013 F-150 vehicles equipped with 5.0L or 6.2L gasoline engines, that previously had the powertrain control module (PCM) software reprogrammed under recall 19V-075.  The software used to reprogram the PCM did not have the necessary updates to prevent the transmission from unexpectedly downshifting into first gear, regardless of vehicle speed.",
   "consequence": "Unexpectedly downshifting into first gear may result in a loss of vehicle control, increasing the risk of a crash.",
   "remedy": "Ford will notify owners, and dealers will reprogram the powertrain control module, free of charge.  The recall began June 24, 2019.  Owners may contact Ford customer service at 1-866-436-7332.  Ford's number for this recall is 19S19.",
   "parkIt": false,
   "parkOutSide": false,
   "overTheAirUpdate": false
  }
 ],
 "safetyRatings": [],
 "overallSafetyRating": null
}
```
## 3VWFE21C04M000001  status=partial billable=true (5152 ms)
```json
{
 "vin": "3VWFE21C04M000001",
 "inputVin": "3VWFE21C04M000001",
 "checkedAt": "2026-09-30T13:26:27.767Z",
 "source": "NHTSA (US National Highway Traffic Safety Administration) public data",
 "status": "partial",
 "decodeMessage": null,
 "decodeCodes": [
  "0"
 ],
 "year": 2004,
 "make": "VOLKSWAGEN",
 "model": "Beetle",
 "trim": "Turbo S",
 "series": null,
 "bodyClass": "Hatchback/Liftback/Notchback",
 "vehicleType": "PASSENGER CAR",
 "doors": 2,
 "driveType": null,
 "engineCylinders": null,
 "engineDisplacementL": 1.781,
 "engineHp": 180,
 "fuelType": "Gasoline",
 "electrificationLevel": null,
 "transmission": null,
 "gvwrClass": "Class 1: 6,000 lb or less (2,722 kg or less)",
 "manufacturer": "VOLKSWAGEN DE MEXICO SA DE CV",
 "plantCountry": "MEXICO",
 "plantCity": "PUEBLA",
 "plantState": null,
 "airbagLocFront": "1st Row (Driver and Passenger)",
 "airbagLocSide": "1st Row (Driver and Passenger)",
 "abs": null,
 "esc": null,
 "tpms": null,
 "warnings": [
  "Part of the data could not be fetched: NHTSA request failed after 4 tries: HTTP 400 (https://api.nhtsa.gov/complaints/complaintsByVehicle)"
 ],
 "recallCount": 6,
 "recallsNote": "Recall campaigns that apply to this make, model and year. NHTSA does not publish whether this specific car was already repaired: check with the manufacturer or a dealer using the VIN.",
 "recalls": [
  {
   "campaignNumber": "14E007000",
   "manufacturer": "The Gates Corporation",
   "reportReceivedDate": "07/03/2014",
   "component": "ENGINE AND ENGINE COOLING:ENGINE",
   "summary": "The Gates Corporation (Gates) is recalling certain aftermarket Tru-Flow Water Pumps, part number TFW 41127, sold at certain NAPA Auto Parts and/or installed by automotive service technicians after November 1, 2013 (and manufactured August 2013 through October 2013) that have a black-colored pulley/sprocket or do not have 'US9377' stamped on the water pump housing.  These service replacement parts were sold for use in model year 1999-2005 Audi A4, 2000-2006 Audi TT, 1998-2005 Volkswagen Beetle, 1999-2006 Golf, 1999-2008 and 2011-2013 Volkswagen Jetta, and 2000-2005 Volkswagen Passat.  In the affected water pumps, the pulley or sprocket that turns the timing belt may develop microfractures causing the timing belt to fail.",
   "consequence": "A failure of the timing belt may cause the engine to shut down, potentially increasing the risk of a vehicle crash.",
   "remedy": "Gates will notify owners, and dealers will replace the water pump, free of charge.  The recall began during May 2014.  Owners may contact The Gates Corporation at 1-303-744-1911.",
   "parkIt": false,
   "parkOutSide": false,
   "overTheAirUpdate": false
  }
 ],
 "safetyRatings": [],
 "overallSafetyRating": null
}
```
## NOTAVIN  status=invalid_vin billable=false (0 ms)
```json
{
 "vin": "NOTAVIN",
 "inputVin": "NOTAVIN",
 "checkedAt": "2026-09-30T13:26:32.919Z",
 "source": "NHTSA (US National Highway Traffic Safety Administration) public data",
 "status": "invalid_vin",
 "error": "A VIN is 17 letters and digits (no I, O or Q)."
}
```

billable 4 of 5
