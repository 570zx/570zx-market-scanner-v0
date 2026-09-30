# Actor configure
user Dodge_Bot, get actor: 200
current: isPublic True categories ['AUTOMATION', 'DEVELOPER_TOOLS'] pricingInfos [{"pricingModel": "PAY_PER_EVENT", "pricingPerEvent": {"actorChargeEvents": {"apify-actor-start": {"eventTitle": "Actor Start", "eventDescription": "Charged when the Actor starts running. Number of events charged depends on Actor memory (one event per GB, minimum one event).", "eventPriceUsd": 5e-05}, "vehicle-report": {"eventTitle": "Vehicle report", "eventDescription": "One decoded VIN with specs, recalls, complaints and crash ratings. Invalid or undecodable VINs are free.", "eventPriceUsd": 0.01}}}, "createdAt": "2026-09-30T15:40:47.108Z", "startedAt": "2026-09-30T15:40:47.108Z", "apifyMarginPercentage": 0.2}]

set pricing/categories: HTTP 400
{
 "type": "schema-validation",
 "message": "Invalid value provided in checkAndSanitizePricingInfosModifier[existing_record]: createdAt is required"
}

pricing confirmed: True
