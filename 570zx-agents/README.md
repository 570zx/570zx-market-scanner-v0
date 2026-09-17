# 570ZX Agents v0.1

Approval-gated background operating system for **570ZX / Project 001**.

## Agents

- **Chief of Staff** — reconciles project priorities, partner state, open tasks and approvals into a concise ops brief.
- **Partnership Manager** — reviews partner/revenue events and prepares drafts for approval.
- **Content Director** — turns real build milestones/assets into authentic content plans and rejects filler.

## Permanent safety rule

Internal work may run automatically. Anything public, external, financial, contractual or commitment-forming requires Dodge's explicit approval first.

This v0.1 Worker goes one step further: **it contains no external action executor at all.** Approving an item changes its queue status only. It cannot send email, post content, buy anything, sign anything or make a partner commitment.

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

The Worker runs meaningful AI work only when events are queued or the twice-daily Chief of Staff brief is due.

## Routes

Public:

- `GET /health`

Protected by `ADMIN_TOKEN`:

- `GET /api/state`
- `GET /api/approvals?status=pending`
- `POST /api/events`
- `POST /api/milestones`
- `POST /api/revenue`
- `POST /api/run/full`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`

Example event:

```json
{
  "type": "content_milestone",
  "source": "Project 001 garage update",
  "payload": {
    "milestone": "rear bumper printed",
    "facts": ["real printed part", "3DXTECH material visible"]
  }
}
```

Supported event types:

- `partner_message`
- `opportunity`
- `ugc_lead`
- `content_milestone`
- `content_asset`

## Approval lifecycle

`event -> agent draft/plan -> approvals table -> Dodge approves/edits/rejects -> status changes`

There is deliberately no final send/publish executor in v0.1.

## Cloudflare bootstrap

See `DEPLOYMENT.md`.
