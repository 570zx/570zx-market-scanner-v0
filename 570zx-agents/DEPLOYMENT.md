# 570ZX Agents — Cloudflare Deployment

This intentionally mirrors the working MEDS Scout pattern: **GitHub -> Cloudflare native Git deployment -> Worker -> D1 -> Cron**.

## 1. Import the existing GitHub repository

In Cloudflare Workers & Pages:

1. Create application / Import repository.
2. Select `570zx/570zx-market-scanner-v0`.
3. Use branch: `570zx-agents-native-cloudflare`.
4. Root directory: `570zx-agents`.
5. Build command: `npm run check`.
6. Deploy command: `npm run deploy`.

The 570ZX agents live on their own branch and root directory so the trading Worker is not modified.

## 2. First deploy

The Worker can deploy before D1 exists. In this bootstrap state:

- `/health` works.
- Workers AI binding exists.
- Cron exists.
- Protected endpoints remain locked until `ADMIN_TOKEN` is configured.
- Persistent event/state writes remain disabled until D1 is bound.

This lets us verify the Worker itself before adding state.

## 3. Create D1

Create a D1 database named:

`570zx-agents`

Copy the database UUID.

Then update `wrangler.toml` by uncommenting:

```toml
[[d1_databases]]
binding = "OPS_DB"
database_name = "570zx-agents"
database_id = "YOUR_D1_UUID"
```

Push the change. Native Git deployment will redeploy automatically.

Apply the migration once:

```bash
npm run db:init
```

The migration creates the shared state tables and seeds the current Project 001 / partnership state.

## 4. Configure secret

Add a strong Worker secret named:

`ADMIN_TOKEN`

Do not commit it to GitHub.

All mutation/state/approval endpoints fail closed if the token is absent.

## 5. Verify

Open:

`/health`

Expected shape:

```json
{
  "ok": true,
  "service": "570zx-agents",
  "approval_mode": "required",
  "persistent_state": true,
  "workers_ai": true,
  "external_action_executor": false
}
```

If `persistent_state` is false, D1 is not bound yet.

## 6. What runs by itself

Cron fires every 15 minutes. The Worker:

- processes queued partner/content/revenue events;
- creates drafts/plans in the approval queue;
- runs the Chief of Staff brief around 8 AM and 7 PM Eastern;
- never sends email, posts content, spends money, signs anything or makes an external commitment.

## 7. Free-first budget guard

The Worker caps AI event processing to 3 calls per scheduled run by default. `MAX_AI_CALLS_PER_RUN` can be lowered later.

Workers AI free allocation should be treated as a hard operating budget. If inference is unavailable or the free allocation is exhausted, the system fails safely and leaves work for later/manual review rather than silently upgrading or spending money.

## Next integration after base deployment

Once the base Worker + D1 are healthy, add inbound connectors one at a time:

1. Gmail/partner-message ingestion.
2. Build milestone / content asset ingestion.
3. Approval UI or ChatGPT bridge.
4. Only after repeated successful approval cycles, add external executors behind a second explicit approval gate.
