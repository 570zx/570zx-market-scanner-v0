# Actor configure
user Dodge_Bot, get actor: 200
current: isPublic False categories None pricingInfos null

set pricing/categories: HTTP 200
{
 "categories": [
  "AUTOMATION",
  "DEVELOPER_TOOLS"
 ],
 "pricingInfos": [
  {
   "pricingModel": "PAY_PER_EVENT",
   "pricingPerEvent": {
    "actorChargeEvents": {
     "apify-actor-start": {
      "eventTitle": "Actor Start",
      "eventDescription": "Charged when the Actor starts running. Number of events charged depends on Actor memory (one event per GB, minimum one event).",
      "eventPriceUsd": 5e-05
     },
     "vehicle-report": {
      "eventTitle": "Vehicle report",
      "eventDescription": "One decoded VIN with specs, recalls, complaints and crash ratings. Invalid or undecodable VINs are free.",
      "eventPriceUsd": 0.01
     }
    }
   },
   "createdAt": "2026-09-30T15:40:47.108Z",
   "startedAt": "2026-09-30T15:40:47.108Z",
   "apifyMarginPercentage": 0.2
  }
 ]
}

pricing confirmed: True
make public: HTTP 403 {"type": "store-terms-not-accepted", "message": "The Actor owner must accept the Apify Store terms and conditions to publish the Actor. Visit https://console.apify.com/actors/IFgedzUMAOip8F0co/publication to accept them."}
