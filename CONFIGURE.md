# Actor configure
user Dodge_Bot, get actor: 200
current: isPublic False categories None pricingInfos null

set pricing/categories: HTTP 400
{
 "type": "cannot-monetize-without-payout-billing-info",
 "message": "To monetize your Actor, you need to set your payout billing info at https://console.apify.com/actors/IFgedzUMAOip8F0co/publication."
}

pricing confirmed: False
NOT making public: pricing is not set, it would be listed for free.
