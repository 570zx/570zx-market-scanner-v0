import base from "./index";

type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<any>;
};

interface Env {
  OPS_DB?: D1Database;
  AI?: AiBinding;
  ADMIN_TOKEN?: string;
  AI_ENABLED?: string;
  AI_MODEL?: string;
  TIMEZONE?: string;
  APPROVAL_MODE?: string;
  MAX_AI_CALLS_PER_RUN?: string;
}

type MerchEventRow = {
  id: string;
  type: string;
  source: string;
  payload_json: string;
  created_at: string;
  processed_at: string | null;
};

const MERCH_RULES = `You are the 570ZX Merch + Store Growth Director.

MISSION:
Turn authentic 570ZX attention into profitable merch and store revenue without weakening the brand.

CURRENT STORE CONTEXT:
- Store platform: Fourthwall.
- Current known drop: DEVELOPMENT DIVISION DROP 001.
- Current known products: SHIRT 001, SHIRT 002, HAT 001, STICKER PACK 001.
- Preserve Fourthwall's native product/cart/checkout behavior unless a measured reason justifies a change.

BRAND RULES:
- Real car. Real work. Real story.
- Merch should connect to Project 001, the build process, actual audience language, or Kinetic Composites development.
- No generic JDM slogans, fake technical claims, fake scarcity, fake countdowns, fake discounts, fabricated sales numbers, or AI-slop graphics.
- Do not present concept renders as completed physical parts.
- Do not call Dodge's Blender workflow CAD.
- Prefer fewer strong products over constant filler drops.
- Re-push proven winners when there is a natural reason instead of inventing endless new SKUs.

FUNNEL:
Measure attention -> site click -> product view -> add to cart -> checkout -> purchase -> revenue.
Distinguish a CTR problem from a product-page/conversion problem. Do not invent industry benchmarks when none are provided.

APPROVAL RULE:
You may analyze, calculate, propose, write copy, propose designs, propose bundles, propose pricing tests, and prepare experiments automatically. Any public change, product creation, site edit, pricing change, discount, campaign launch, post, email, purchase, or commitment requires Dodge's explicit approval first.

OUTPUT:
Be concise and commercial. Recommend at most two high-value experiments at a time. For each experiment include: problem/opportunity, hypothesis, exact proposed change, primary metric, why it fits 570ZX, and a stop/keep rule. Reject weak ideas instead of filling space.`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return asObject(await request.json());
  } catch {
    return {};
  }
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get("authorization");
  const xToken = request.headers.get("x-admin-token");
  return header === `Bearer ${env.ADMIN_TOKEN}` || xToken === env.ADMIN_TOKEN;
}

function authFailure(env: Env): Response {
  if (!env.ADMIN_TOKEN) {
    return json({ error: "ADMIN_TOKEN_NOT_CONFIGURED", message: "Protected endpoints are intentionally locked until ADMIN_TOKEN is set in Cloudflare." }, 503);
  }
  return json({ error: "UNAUTHORIZED" }, 401);
}

function extractAiText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result?.response === "string") return result.result.response;
  return JSON.stringify(result);
}

async function runMerchAi(env: Env, prompt: string): Promise<{ text: string; aiCalls: number; mode: string }> {
  if (env.AI_ENABLED !== "true" || !env.AI) {
    return {
      text: "[merch_store_director] AI unavailable; metrics were stored safely and await a higher-quality manual review.",
      aiCalls: 0,
      mode: "deterministic",
    };
  }

  const model = env.AI_MODEL || "@cf/meta/llama-3.2-3b-instruct";
  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: MERCH_RULES },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.5,
    });
    return { text: extractAiText(result), aiCalls: 1, mode: "workers_ai" };
  } catch (error) {
    return {
      text: `[merch_store_director] Workers AI failed safely: ${error instanceof Error ? error.message : String(error)}`,
      aiCalls: 0,
      mode: "fallback",
    };
  }
}

async function startRun(env: Env, triggerType: string): Promise<string> {
  const id = crypto.randomUUID();
  if (env.OPS_DB) {
    await env.OPS_DB.prepare("INSERT INTO agent_runs(id,agent,trigger_type,status,started_at,ai_calls) VALUES(?,?,?,?,?,0)")
      .bind(id, "merch_store_director", triggerType, "running", nowIso())
      .run();
  }
  return id;
}

async function finishRun(env: Env, id: string, summary: string, aiCalls: number, status = "complete") {
  if (!env.OPS_DB) return;
  await env.OPS_DB.prepare("UPDATE agent_runs SET status=?,summary=?,finished_at=?,ai_calls=? WHERE id=?")
    .bind(status, summary, nowIso(), aiCalls, id)
    .run();
}

async function createApproval(env: Env, actionType: string, title: string, payload: unknown, risk = "yellow") {
  if (!env.OPS_DB) return null;
  const id = crypto.randomUUID();
  await env.OPS_DB.prepare("INSERT INTO approvals(id,action_type,title,payload_json,risk,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
    .bind(id, actionType, title, JSON.stringify(payload), risk, nowIso())
    .run();
  return id;
}

function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function normalizedMetrics(input: Record<string, unknown>) {
  const impressions = Math.max(0, Number(input.impressions || 0));
  const siteClicks = Math.max(0, Number(input.site_clicks || 0));
  const productViews = Math.max(0, Number(input.product_views || 0));
  const addToCarts = Math.max(0, Number(input.add_to_carts || 0));
  const checkouts = Math.max(0, Number(input.checkouts || 0));
  const purchases = Math.max(0, Number(input.purchases || 0));
  const revenueCents = Math.max(0, Number(input.revenue_cents || 0));

  return {
    impressions,
    site_clicks: siteClicks,
    product_views: productViews,
    add_to_carts: addToCarts,
    checkouts,
    purchases,
    revenue_cents: revenueCents,
    derived: {
      traffic_ctr: rate(siteClicks, impressions),
      site_to_product_view_rate: rate(productViews, siteClicks),
      product_to_cart_rate: rate(addToCarts, productViews),
      cart_to_checkout_rate: rate(checkouts, addToCarts),
      checkout_completion_rate: rate(purchases, checkouts),
      site_purchase_conversion: rate(purchases, siteClicks),
      product_purchase_conversion: rate(purchases, productViews),
      average_order_value_dollars: purchases > 0 ? Number((revenueCents / purchases / 100).toFixed(2)) : null,
      revenue_per_1000_impressions_dollars: impressions > 0 ? Number(((revenueCents / 100) / impressions * 1000).toFixed(2)) : null,
    },
  };
}

async function loadMerchContext(env: Env) {
  if (!env.OPS_DB) {
    return {
      persistent: false,
      store: { platform: "Fourthwall", drop: "DEVELOPMENT DIVISION DROP 001", products: ["SHIRT 001", "SHIRT 002", "HAT 001", "STICKER PACK 001"] },
      metrics: [],
      milestones: [],
      experiments: [],
      revenue: [],
    };
  }

  const [metrics, milestones, experiments, revenue] = await Promise.all([
    env.OPS_DB.prepare("SELECT id,source,period_start,period_end,impressions,site_clicks,product_views,add_to_carts,checkouts,purchases,revenue_cents,notes,captured_at FROM store_metrics ORDER BY captured_at DESC LIMIT 10").all(),
    env.OPS_DB.prepare("SELECT key,value,status,notes,updated_at FROM project_milestones ORDER BY updated_at DESC LIMIT 25").all(),
    env.OPS_DB.prepare("SELECT id,title,hypothesis,proposal_json,primary_metric,status,approval_id,created_at,updated_at FROM merch_experiments ORDER BY created_at DESC LIMIT 10").all(),
    env.OPS_DB.prepare("SELECT agent,event_type,amount_cents,value_cents,notes,created_at FROM revenue_events ORDER BY created_at DESC LIMIT 20").all(),
  ]);

  return {
    persistent: true,
    store: { platform: "Fourthwall", drop: "DEVELOPMENT DIVISION DROP 001", products: ["SHIRT 001", "SHIRT 002", "HAT 001", "STICKER PACK 001"] },
    metrics: metrics.results,
    milestones: milestones.results,
    experiments: experiments.results,
    revenue: revenue.results,
  };
}

async function saveExperiment(env: Env, sourceEvent: string | null, title: string, proposal: string, approvalId: string | null) {
  if (!env.OPS_DB) return null;
  const id = crypto.randomUUID();
  await env.OPS_DB.prepare("INSERT INTO merch_experiments(id,source_event,title,hypothesis,proposal_json,primary_metric,status,approval_id,created_at,updated_at) VALUES(?,?,?,?,?,?, 'proposed',?,?,?)")
    .bind(id, sourceEvent, title, "See proposal", JSON.stringify({ proposal }), "revenue/conversion", approvalId, nowIso(), nowIso())
    .run();
  return id;
}

async function handleMerchEvent(env: Env, event: MerchEventRow, payload: Record<string, unknown>) {
  const runId = await startRun(env, `event:${event.type}`);
  const context = await loadMerchContext(env);
  const metricBlock = event.type === "store_metrics" ? normalizedMetrics(payload) : null;
  const prompt = `Review this merch/store event and current context. Identify the actual bottleneck before proposing action. If metrics are insufficient, say what data is missing instead of inventing benchmarks. Propose at most two tests that can improve qualified website CTR, product interest, conversion, AOV, repeat purchase, or merch revenue while protecting brand quality. Tie merch concepts to real Project 001 moments when appropriate.\n\nEVENT TYPE: ${event.type}\nSOURCE: ${event.source}\nEVENT: ${JSON.stringify(payload)}\nNORMALIZED FUNNEL: ${JSON.stringify(metricBlock)}\nCONTEXT: ${JSON.stringify(context)}`;
  const result = await runMerchAi(env, prompt);
  const approvalId = await createApproval(
    env,
    "merch_store_experiment",
    `Merch/store proposal: ${event.source}`,
    { event_id: event.id, source: event.source, event_type: event.type, proposal: result.text, metrics: metricBlock },
    "yellow",
  );
  const experimentId = await saveExperiment(env, event.id, `Merch/store proposal: ${event.source}`, result.text, approvalId);
  await finishRun(env, runId, result.text, result.aiCalls);
  return { runId, approvalId, experimentId, result };
}

async function processMerchQueue(env: Env) {
  if (!env.OPS_DB) return { processed: 0, note: "D1 not configured; merch queue is disabled." };
  const rows = await env.OPS_DB.prepare("SELECT id,type,source,payload_json,created_at,processed_at FROM events WHERE processed_at IS NULL AND type IN ('store_metrics','merch_signal','merch_asset') ORDER BY created_at ASC LIMIT 6").all<MerchEventRow>();
  const items: unknown[] = [];
  let aiCalls = 0;
  const maxCalls = Math.max(1, Number(env.MAX_AI_CALLS_PER_RUN || "3"));

  for (const event of rows.results || []) {
    if (aiCalls >= maxCalls) break;
    let payload: Record<string, unknown> = {};
    try { payload = asObject(JSON.parse(event.payload_json)); } catch { payload = {}; }
    const outcome = await handleMerchEvent(env, event, payload);
    aiCalls += outcome.result.aiCalls;
    await env.OPS_DB.prepare("UPDATE events SET processed_at=? WHERE id=?").bind(nowIso(), event.id).run();
    items.push({ event: event.id, type: event.type, outcome });
  }

  return { processed: items.length, aiCalls, items };
}

async function queueMerchEvent(env: Env, type: string, source: string, payload: Record<string, unknown>) {
  if (!env.OPS_DB) return { error: "D1_NOT_CONFIGURED" } as const;
  const allowed = new Set(["store_metrics", "merch_signal", "merch_asset"]);
  if (!allowed.has(type)) return { error: "INVALID_EVENT_TYPE", allowed: [...allowed] } as const;
  const id = crypto.randomUUID();
  await env.OPS_DB.prepare("INSERT INTO events(id,type,source,payload_json,created_at) VALUES(?,?,?,?,?)")
    .bind(id, type, source, JSON.stringify(payload), nowIso())
    .run();
  return { ok: true, id } as const;
}

async function recordStoreMetrics(env: Env, body: Record<string, unknown>) {
  if (!env.OPS_DB) return json({ error: "D1_NOT_CONFIGURED" }, 503);
  const source = String(body.source || "Fourthwall/manual").trim();
  const metrics = normalizedMetrics(body);
  const id = crypto.randomUUID();
  const capturedAt = nowIso();

  await env.OPS_DB.prepare("INSERT INTO store_metrics(id,source,period_start,period_end,impressions,site_clicks,product_views,add_to_carts,checkouts,purchases,revenue_cents,notes,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(
      id,
      source,
      body.period_start ? String(body.period_start) : null,
      body.period_end ? String(body.period_end) : null,
      metrics.impressions,
      metrics.site_clicks,
      metrics.product_views,
      metrics.add_to_carts,
      metrics.checkouts,
      metrics.purchases,
      metrics.revenue_cents,
      body.notes ? String(body.notes) : null,
      capturedAt,
    )
    .run();

  const queued = await queueMerchEvent(env, "store_metrics", source, { metric_id: id, ...metrics, period_start: body.period_start || null, period_end: body.period_end || null, notes: body.notes || null });
  return json({ ok: true, metric_id: id, queued, derived: metrics.derived, external_action_taken: false }, 201);
}

async function listStoreMetrics(env: Env) {
  if (!env.OPS_DB) return json({ persistent: false, metrics: [] });
  const rows = await env.OPS_DB.prepare("SELECT id,source,period_start,period_end,impressions,site_clicks,product_views,add_to_carts,checkouts,purchases,revenue_cents,notes,captured_at FROM store_metrics ORDER BY captured_at DESC LIMIT 50").all();
  return json({ metrics: rows.results });
}

async function listMerchExperiments(env: Env) {
  if (!env.OPS_DB) return json({ persistent: false, experiments: [] });
  const rows = await env.OPS_DB.prepare("SELECT id,source_event,title,hypothesis,proposal_json,primary_metric,status,approval_id,created_at,updated_at FROM merch_experiments ORDER BY created_at DESC LIMIT 50").all();
  return json({ experiments: rows.results.map((row: any) => ({ ...row, proposal: (() => { try { return JSON.parse(row.proposal_json); } catch { return row.proposal_json; } })(), proposal_json: undefined })) });
}

async function merchFetch(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    const baseResponse = await (base as any).fetch(request, env);
    const body = await baseResponse.json() as Record<string, any>;
    const agents = Array.isArray(body.agents) ? body.agents : [];
    return json({ ...body, version: "0.2.0", agents: [...new Set([...agents, "merch_store_director"])] });
  }

  const merchRoute = url.pathname.startsWith("/api/store/") || url.pathname.startsWith("/api/merch/") || url.pathname === "/api/run/merch";
  if (!merchRoute) return null;
  if (!isAuthorized(request, env)) return authFailure(env);

  if (request.method === "GET" && url.pathname === "/api/store/metrics") return listStoreMetrics(env);
  if (request.method === "POST" && url.pathname === "/api/store/metrics") return recordStoreMetrics(env, await readJson(request));
  if (request.method === "GET" && url.pathname === "/api/merch/experiments") return listMerchExperiments(env);

  if (request.method === "POST" && url.pathname === "/api/merch/events") {
    const body = await readJson(request);
    const type = String(body.type || "merch_signal").trim();
    const source = String(body.source || "manual").trim();
    const payload = asObject(body.payload);
    const queued = await queueMerchEvent(env, type, source, payload);
    if ("error" in queued) return json(queued, queued.error === "D1_NOT_CONFIGURED" ? 503 : 400);
    return json({ ...queued, status: "queued", note: "No external action was taken." }, 201);
  }

  if (request.method === "POST" && url.pathname === "/api/run/merch") {
    return json({ ok: true, merch: await processMerchQueue(env), external_actions_taken: 0 });
  }

  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const merchResponse = await merchFetch(request, env);
    if (merchResponse) return merchResponse;

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/run/full") {
      if (!isAuthorized(request, env)) return authFailure(env);
      const merch = await processMerchQueue(env);
      const baseResponse = await (base as any).fetch(request, env, ctx);
      const body = await baseResponse.json();
      return json({ ...(body as Record<string, unknown>), merch, external_actions_taken: 0 });
    }

    return (base as any).fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await processMerchQueue(env);
      await (base as any).scheduled(event, env, ctx);
    })());
  },
} satisfies ExportedHandler<Env>;
