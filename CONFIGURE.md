# Actor configure
user Dodge_Bot, get actor: 200
current: isPublic False categories None pricingInfos null

set pricing/categories: HTTP 400
{
 "type": "schema-validation",
 "message": "Invalid value provided in updatedActor: seoTitle must be at most 60 characters long Received \"VIN Decoder API with Recalls, Complaints and Crash Ratings (NHTSA)\""
}

pricing confirmed: False
NOT making public: pricing is not set, it would be listed for free.
