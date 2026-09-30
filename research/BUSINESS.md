# Vehicle Safety Intel: operating plan

Owner: Dodge. Operator: Claude. Status: PUBLISHED on Apify Store 2026-09-30 (account Dodge_Bot, Actor IFgedzUMAOip8F0co), $0.01 per vehicle report, pay per event, owner approved scope: publish at this price, no spending, no outreach.

## The business in one paragraph
A paid Apify Actor. A stranger (a person or an AI agent) submits VINs and pays per vehicle report. Apify handles discovery, checkout, billing and payouts. Data comes from free US government APIs, so there is no scraping fragility, no proxy cost and almost no compute cost. Delivery is fully automatic.

## Why this one (evidence, and what is not proven)
Evidence, from the Apify Store catalog scan on 2026-09-30 (12,619 unique actors seen of ~71,000; the API lists at most 16,000 rows and paging is unstable, so this is a large sample, not a census):
- Nearly every third-party actor is pay-per-event (12,288 of 12,514), and Apify pays 80% of event revenue minus platform cost.
- Demand is concentrated. Only ~1,190 of 12,514 third-party actors had 50+ users in the last 30 days; ~4,180 had 10+; ~1,100 had none.
- Apify says top independent creators exceed $10,000/month and it pays about $1.4M a month to roughly 3,000 developers (about $470 average, skewed by a few big earners). Source: Apify pages, via a third-party write-up.
- Competition in this niche is thin: 7 actors mention recalls, 55 mention VIN/NHTSA; the best VIN/recall one had about 5 users in 30 days.
NOT proven:
- Demand for this niche is weak so far (best competitor about 5 users/30 days). It may be that few people want it. That is the main risk.
- No sale has happened. Revenue forecast: unknown. Realistic first outcome is $0 to tens of dollars a month; treat anything more as upside.

## Pricing (proposal, set in Apify Console)
- Event `vehicle-report`: $0.01 per delivered report ($10 per 1,000). Keep the synthetic `apify-actor-start` event at its default.
- Platform cost per report is expected to be well under $0.002 (a handful of small HTTP calls). To be measured on the first paid runs; if profit per run is negative, raise the price.
- Invalid or undecodable VINs are free.

## Experiments and stop rules
Each has a spending cap of $0 (only time), a time limit, and a kill rule.
1. Publish the Actor with a clear listing. Look at 30 days of Store analytics. Continue if there are 10+ distinct users or any paid run; if not, change the listing once (keywords, README top lines), then re-check 30 days later.
2. Add a second and third narrow actor only if experiment 1 shows any paid usage. Otherwise stop building actors in this niche.
3. Stop the whole line if 90 days after publish there is no paid customer.

## Spending policy (proposed, needs Dodge's approval)
- New spending: $0 until Dodge sets a budget. The Actor runs on Apify's free developer allowance. Nothing here requires a paid plan.
- Revenue split proposal (after Apify's cut and any costs): 70% to Dodge, 20% reserve for AI and tool costs, 10% reinvested in new Actors. Reserve cap: 3 months of running costs, then the excess goes to Dodge.
- Claude never raises its own spending authority and never buys anything.

## Ledger (actuals only; forecasts stay in this file's text)
| Date | Collected revenue | Apify fees | Refunds/compensation | AI + tool costs | Net | Owner time (min) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-09-30 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | ~45 (account, token, billing info, publish) |

Measured platform cost: about $0.00004-0.00006 per report (2-VIN test runs cost $0.00009-0.00012).

## Monitoring and control
- Apify Console shows runs, success rate, revenue and cost per Actor (Development > Insights > Analytics).
- Pause: unpublish the Actor in Apify Console, or tell Claude to stop.
- The live-check workflow (`actor-live-check`) can be run any time to confirm the government APIs still respond the same way.
- Known upkeep: NHTSA can change its APIs or model naming; expect a few hours a quarter.

## Setup needed from Dodge (the smallest set)
1. Create a free Apify account (owner-controlled) and complete identity verification (KYC) when payouts are wanted (PayPal minimum $20/month, otherwise $100).
2. Send an Apify API token to GitHub as a repository secret named APIFY_TOKEN (never paste it in chat). Then Claude can publish through a workflow.
3. Approve the operating scope: publish the Actor at $0.01 per report; no other spending; no outreach to people.
