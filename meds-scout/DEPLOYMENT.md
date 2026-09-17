# Cloudflare native GitHub import

Status: prepared for import, not yet deployed or production-verified.

In Cloudflare > Workers & Pages > Create application > Import a repository:

| Setting | Value |
| --- | --- |
| Repository | 570zx/570zx-market-scanner-v0 |
| Branch | meds-scout-native-cloudflare |
| Worker name | meds-scout-agent |
| Root directory | meds-scout |
| Build command | npm run check && npm test |
| Deploy command | npm run deploy |
| Node version | 24 (set NODE_VERSION in build variables if needed) |
| Plan | Workers Free |

Authorize the Cloudflare GitHub application for this repository only. This is a Worker project, not a Pages/static website.

The deploy command first deploys with scanning disabled, automatically provisions D1, applies the migrations, then deploys with scanning enabled. Existing pauses persist across deployment. D1 is the only storage binding; KV and AI are unnecessary. Cloudflare's native build service supplies deployment authentication. You do not need to put a Cloudflare API token into GitHub.

After the first deployment, open Worker > Settings > Variables and Secrets. Add these as runtime secrets, not plain text variables or build variables:

- ALPACA_API_KEY: Alpaca paper-account key.
- ALPACA_API_SECRET: corresponding paper-account secret.
- ADMIN_TOKEN: at least 32 random characters from a password manager.
- ALERT_WEBHOOK_URL: optional Discord webhook.

Never paste secret values into chat, source, GitHub issues, or screenshots. Adding secrets may trigger a deployment. Give the assistant the Worker URL and the D1 database ID (the ID is not a secret). The database ID should be committed into Wrangler configuration after import to pin subsequent builds to the verified database. Cloudflare does not automatically write the provisioned ID back to GitHub.

Select the same branch as the production branch for automatic redeploys; later merge to main and change the production branch if desired. Never enable non-production branch deployments against the production database.

## What is already tested

Local SQLite/D1-adapter tests cover simulated scheduled scans, persistent state between minutes, database reopen in another process, +20% de-risk, +30% runner reduction, trailing stop, duplicate suppression, authentication, pause and live-mode rejection. TypeScript and Wrangler packaging must pass before import. These checks do not verify Cloudflare runtime or real cron execution.

## Runtime behavior

- Shadow only: no brokerage order API exists. Non-shadow mode is rejected.
- Every-minute cron, weekdays 04:00 inclusive–20:00 exclusive America/New_York; DST aware. Exchange holidays/early closes are not explicitly modeled.
- Broad discovery from Alpaca active/movers screeners plus remembered symbols; IEX snapshots and recent Alpaca news. Live account entitlements and extended-hours feed quality remain to be verified.
- Four shortlisted symbols and four open shadow positions limit per-invocation database work on Free. This is a throughput tradeoff, not a full-universe coverage claim.
- +20% de-risks 70%; +30% takes half the remaining runner. At +15% high-water gain, arm breakeven. After first take-profit, trail high-water by 15% and never lower the stop.
- Durable position journal and at-most-once alert dispatch. Ambiguous delivery can lose an alert; it is recorded and not blindly retried.
- No verified borrow fee/availability, full SIP, AI classification, broker paper execution or real-money execution.

## Acceptance checks still required

Observe at least two live cron ticks, real database writes and restart persistence. Verify Alpaca entitlement, a successful live scan in market hours, webhook receipt, and Free CPU/database quotas under full load. Repeated/malformed provider timestamps, exchange calendar, crash/lease-expiry tests and long-term event/state retention need further hardening. Do not claim production readiness solely from the local tests.

## Monitor and disable

GET /health: tick_count, last_tick_at, last_success_at, last_error, enabled and live_execution=false. Cron propagation can take several minutes. A fresh last_tick_at with an error is not a successful market scan.

Authenticated GET /events, /alerts, /signals and /positions use Authorization: Bearer <ADMIN_TOKEN>.

POST /control/pause with the same auth stops subsequent scans; an in-flight scan can finish. For immediate external shutdown, disable the Worker or remove its cron in Cloudflare. POST /control/resume reverses the persisted pause.

## Costs

Target $0/month on Workers Free, Workers Builds Free and Alpaca Basic. No upgrade, billing, AI or paid-data activation is implemented. Free quotas can interrupt the service; measure the real workload before accepting continuous operation. No paid upgrade is permitted without the user's explicit approval.

Official references:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
