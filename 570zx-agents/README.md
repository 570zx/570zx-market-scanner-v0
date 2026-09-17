# 570ZX Agents v0.2

Approval-gated background operating system for **570ZX / Project 001**.

## Agents

- **Chief of Staff** — reconciles project priorities, partner state, open tasks and approvals into a concise ops brief.
- **Partnership Manager** — reviews partner/revenue events and prepares drafts for approval.
- **Content Director** — turns real build milestones/assets into authentic content plans and rejects filler.
- **Merch + Store Growth Director** — turns authentic project attention into merch/store revenue experiments, analyzes the funnel from impressions through purchase, proposes merch concepts, CTR tests, product-page tests, bundles and re-pushes, and sends every outward-facing change to Dodge for approval.

## Permanent approval rule

Internal work may run automatically. Anything public, external, financial, contractual or commitment-forming requires Dodge's explicit approval first.

This Worker goes one step further: **it contains no external action executor at all.** Approving an item changes its queue status only. It cannot send email, publish content, create/change live products, change live pricing, buy anything, sign anything or make a partner commitment.

## Merch/store constitution

- Real car. Real work. Real story.
- Merch should connect to Project 001, the build process, actual audience language or Kinetic Composites development.
- No generic JDM filler, fake technical claims, fake scarcity, fake countdowns, fake discounts or fabricated sales numbers.
- Prefer fewer strong products over constant filler drops.
- Re-push proven winners when there is a natural reason.
- Preserve Fourthwall's native product/cart/checkout behavior unless measured data supports a change.
- Diagnose the actual funnel stage before proposing a fix: impressions -> site click -> product view -> add to cart -> checkout -> purchase -> revenue.

Current known merch context: **DEVELOPMENT DIVISION DROP 001**, SHIRT 001, SHIRT 002, HAT 001 and STICKER PACK 001.

## Project truth currently seeded

- Project 001: 1993 Nissan 300ZX Z32 2+0, 5.7L Gen III HEMI.
- Body development is done in **Blender** / 3D modeling. Do not call Dodge's workflow CAD.
- Front lip: **printed / complete**.
- Rear bumper: remaining major print.
- Diffuser: remaining major print.
- 3DXTECH: active Material Partner.
- Morimoto: active lighting-development collaboration.
- QIDI: parked unless Dodge reopens it.
- Project 001 completion outranks future expansion.

## Free-first Cloudflare architecture

- Cloudflare Worker
- Cloudflare Cron Trigger every 15 minutes
- Workers AI binding using `@cf/meta/llama-3.2-3b-instruct`
- D1 persistent state once bound
- GitHub native Cloudflare deployment

The Worker runs meaningful AI work only when events are queued or an operations brief is due. The merch/store agent is event-driven, so it sleeps until store metrics, merch signals or merch assets arrive.

## Routes

Public:

- `GET /health`

Protected by `ADMIN_TOKEN`:

Core:
- `GET /api/state`
- `GET /api/approvals?status=pending`
- `POST /api/events`
- `POST /api/milestones`
- `POST /api/revenue`
- `POST /api/run/full`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`

Merch/store:
- `GET /api/store/metrics`
- `POST /api/store/metrics`
- `GET /api/merch/experiments`
- `POST /api/merch/events`
- `POST /api/run/merch`

Example store-metrics payload:

```json
{
  "source": "Fourthwall",
  "period_start": "2026-09-01",
  "period_end": "2026-09-17",
  "impressions": 10000,
  "site_clicks": 400,
  "product_views": 250,
  "add_to_carts": 35,
  "checkouts": 18,
  "purchases": 12,
  "revenue_cents": 47880
}
```

The Merch + Store Growth Director calculates funnel rates, stores the snapshot, analyzes the bottleneck and creates an approval-gated experiment proposal. No live store change occurs automatically.

Example merch signal:

```json
{
  "type": "merch_signal",
  "source": "Project 001 milestone",
  "payload": {
    "signal": "front lip officially printed",
    "idea": "evaluate whether this milestone supports a real DROP 002 concept or a re-push of an existing product"
  }
}
```

Supported core event types:
- `partner_message`
- `opportunity`
- `ugc_lead`
- `content_milestone`
- `content_asset`

Supported merch/store event types:
- `store_metrics`
- `merch_signal`
- `merch_asset`

## Approval lifecycle

`event -> agent analysis/draft/experiment -> approvals table -> Dodge approves/edits/rejects -> queue status changes`

There is deliberately no final send/publish/store-change executor in v0.2.

## Cloudflare bootstrap

See `DEPLOYMENT.md`.
