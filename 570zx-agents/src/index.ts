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

type AgentName = "chief_of_staff" | "partnership_manager" | "content_director";

type EventRow = {
  id: string;
  type: string;
  source: string;
  payload_json: string;
  created_at: string;
  processed_at: string | null;
};

const BOOTSTRAP_STATE = {
  project: {
    name: "570ZX / Project 001",
    priority: "Finish Project 001 before expansion",
    front_lip: "complete / printed",
    rear_bumper: "remaining",
    diffuser: "remaining",
  },
  partners: [
    { id: "juggerbot", name: "JuggerBot 3D", status: "meeting_scheduled", next_action: "Sept 17 12:30 PM ET call; seek a concrete Project 001 pilot next step." },
    { id: "modix", name: "Modix", status: "waiting_on_reply", next_action: "Wait for Adam after package; do not chase." },
    { id: "direct-connection", name: "Direct Connection", status: "formal_review", next_action: "Wait for review." },
    { id: "morimoto", name: "Morimoto Lighting", status: "active_development", next_action: "Wait for hardware/shipping update." },
    { id: "3dxtech", name: "3DXTECH", status: "active_material_partner", next_action: "No action required." },
    { id: "deatschwerks", name: "DeatschWerks", status: "needs_technical_specs", next_action: "Answer horsepower target/fuel when powertrain direction is ready." },
    { id: "qidi", name: "QIDI", status: "parked", next_action: "No action unless Dodge explicitly reopens." },
  ],
};

const SYSTEM_RULES = `You are part of the 570ZX operating system.\n\nNON-NEGOTIABLE PRIORITY ORDER:\n1. Finish Project 001.\n2. Existing obligations.\n3. Revenue and partnership opportunities.\n4. Content.\n5. Future Kinetic Composites work.\n\nBRAND FACTS:\n- Project 001 is a 1993 Nissan 300ZX Z32 2+0 with a 5.7L Gen III HEMI.\n- The one-off full-size body is 3D designed/modelled in Blender and physically 3D printed before composite finishing. Do not call Dodge's Blender workflow CAD.\n- 3DXTECH is the Project 001 Material Partner.\n- Morimoto Lighting is an active lighting-development collaboration. Do not call it a paid sponsorship unless explicitly confirmed.\n- Kinetic Composites is the future automotive additive/composite manufacturing direction.\n- Project 002 is planned as a full Stratos HF-inspired replacement shell engineered around a Pontiac Fiero platform, not merely a body kit.\n- The front lip is officially printed. Rear bumper and diffuser remain in the major print queue unless newer state says otherwise.\n\nAPPROVAL CONSTITUTION:\nInternal research, analysis, organization, drafts, calculations, state updates, and idea generation are allowed. Anything public, external, financial, contractual, or commitment-forming requires Dodge's explicit approval first. Never claim an external action happened unless the state proves it.\n\nCONTENT CONSTITUTION:\nReal car. Real work. Real story. No fake progress, fake reactions, generic AI voiceover concepts, fabricated partner claims, or AI-generated imagery presented as real Project 001 progress. AI should reduce labor around authentic footage and real build events, not replace Dodge's personality.`;

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

async function loadState(env: Env) {
  if (!env.OPS_DB) {
    return { persistent: false, ...BOOTSTRAP_STATE, tasks: [], approvals: [] };
  }

  const [partners, milestones, tasks, approvals] = await Promise.all([
    env.OPS_DB.prepare("SELECT id,name,status,next_action,notes,last_event_at,updated_at FROM partners ORDER BY name").all(),
    env.OPS_DB.prepare("SELECT key,value,status,notes,updated_at FROM project_milestones ORDER BY key").all(),
    env.OPS_DB.prepare("SELECT id,title,owner_agent,priority,status,due_at,source,created_at,updated_at FROM tasks WHERE status != 'done' ORDER BY priority ASC, created_at ASC LIMIT 50").all(),
    env.OPS_DB.prepare("SELECT id,action_type,title,risk,status,created_at,resolved_at,resolution_note FROM approvals WHERE status='pending' ORDER BY created_at ASC LIMIT 50").all(),
  ]);

  return {
    persistent: true,
    partners: partners.results,
    milestones: milestones.results,
    tasks: tasks.results,
    approvals: approvals.results,
  };
}

function extractAiText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result?.response === "string") return result.result.response;
  return JSON.stringify(result);
}

async function runAi(env: Env, agent: AgentName, userPrompt: string): Promise<{ text: string; aiCalls: number; mode: string }> {
  if (env.AI_ENABLED !== "true" || !env.AI) {
    return { text: `[${agent}] AI unavailable; state was processed deterministically and awaits a higher-quality manual run.`, aiCalls: 0, mode: "deterministic" };
  }

  const model = env.AI_MODEL || "@cf/meta/llama-3.2-3b-instruct";
  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: SYSTEM_RULES },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 900,
      temperature: agent === "content_director" ? 0.65 : 0.25,
    });
    return { text: extractAiText(result), aiCalls: 1, mode: "workers_ai" };
  } catch (error) {
    return { text: `[${agent}] Workers AI failed safely: ${error instanceof Error ? error.message : String(error)}`, aiCalls: 0, mode: "fallback" };
  }
}

async function startRun(env: Env, agent: AgentName, triggerType: string): Promise<string> {
  const id = crypto.randomUUID();
  if (env.OPS_DB) {
    await env.OPS_DB.prepare("INSERT INTO agent_runs(id,agent,trigger_type,status,started_at,ai_calls) VALUES(?,?,?,?,?,0)")
      .bind(id, agent, triggerType, "running", nowIso())
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

async function runChiefOfStaff(env: Env, triggerType: string) {
  const runId = await startRun(env, "chief_of_staff", triggerType);
  const state = await loadState(env);
  const prompt = `Produce a concise 570ZX operations brief from this current state. Use four sections: TODAY, WAITING, NEEDS DODGE APPROVAL, CAN WAIT. Surface only high-value actions. Do not invent missing facts. State:\n${JSON.stringify(state)}`;
  const result = await runAi(env, "chief_of_staff", prompt);
  await finishRun(env, runId, result.text, result.aiCalls);
  return { agent: "chief_of_staff", runId, ...result };
}

async function handlePartnershipEvent(env: Env, event: EventRow, payload: Record<string, unknown>) {
  const runId = await startRun(env, "partnership_manager", `event:${event.type}`);
  const state = await loadState(env);
  const prompt = `Review this partnership/revenue event against current 570ZX state. Determine what it means, identify any factual or relationship risks, and prepare the best DRAFT response or next-step proposal if action is warranted. Do not send anything and do not overstate partnerships. If no response is warranted, say WAIT and explain briefly.\n\nEVENT SOURCE: ${event.source}\nEVENT: ${JSON.stringify(payload)}\nSTATE: ${JSON.stringify(state)}`;
  const result = await runAi(env, "partnership_manager", prompt);
  const approvalId = await createApproval(env, event.type === "opportunity" ? "outreach_draft" : "partner_reply_draft", `Partnership review: ${event.source}`, { event_id: event.id, source: event.source, draft: result.text }, "yellow");
  await finishRun(env, runId, result.text, result.aiCalls);
  return { runId, approvalId, result };
}

async function handleContentEvent(env: Env, event: EventRow, payload: Record<string, unknown>) {
  const runId = await startRun(env, "content_director", `event:${event.type}`);
  const state = await loadState(env);
  const prompt = `Turn this REAL build event or asset into a high-quality content plan without AI slop. Use only facts in the event/state. Prefer authentic footage, Dodge's voice, useful technical detail, and story. Create: (1) strongest long-form angle if warranted, (2) up to 3 short-form hooks, (3) Reddit/community angle if warranted, (4) partner deliverables naturally supported, (5) missing shots worth capturing. Reject weak ideas instead of filling space.\n\nEVENT SOURCE: ${event.source}\nEVENT: ${JSON.stringify(payload)}\nSTATE: ${JSON.stringify(state)}`;
  const result = await runAi(env, "content_director", prompt);
  const approvalId = await createApproval(env, "content_plan", `Content plan: ${event.source}`, { event_id: event.id, source: event.source, plan: result.text }, "yellow");
  await finishRun(env, runId, result.text, result.aiCalls);
  return { runId, approvalId, result };
}

async function processQueuedEvents(env: Env) {
  if (!env.OPS_DB) return { processed: 0, note: "D1 not configured; event queue is disabled." };

  const query = await env.OPS_DB.prepare("SELECT id,type,source,payload_json,created_at,processed_at FROM events WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT 10").all<EventRow>();
  const processed: unknown[] = [];
  let aiCalls = 0;
  const maxCalls = Math.max(1, Number(env.MAX_AI_CALLS_PER_RUN || "3"));

  for (const event of query.results || []) {
    let payload: Record<string, unknown> = {};
    try { payload = asObject(JSON.parse(event.payload_json)); } catch { payload = {}; }

    let outcome: unknown;
    if (event.type === "partner_message" || event.type === "opportunity" || event.type === "ugc_lead") {
      if (aiCalls >= maxCalls) break;
      outcome = await handlePartnershipEvent(env, event, payload);
      aiCalls += (outcome as any)?.result?.aiCalls || 0;
    } else if (event.type === "content_milestone" || event.type === "content_asset") {
      if (aiCalls >= maxCalls) break;
      outcome = await handleContentEvent(env, event, payload);
      aiCalls += (outcome as any)?.result?.aiCalls || 0;
    } else {
      outcome = { skipped: true, reason: "Unsupported event type" };
    }

    await env.OPS_DB.prepare("UPDATE events SET processed_at=? WHERE id=?").bind(nowIso(), event.id).run();
    processed.push({ event: event.id, type: event.type, outcome });
  }

  return { processed: processed.length, aiCalls, items: processed };
}

function zonedHour(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value || "0");
}

async function chiefAlreadyRanThisHour(env: Env): Promise<boolean> {
  if (!env.OPS_DB) return false;
  const cutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString();
  const row = await env.OPS_DB.prepare("SELECT id FROM agent_runs WHERE agent='chief_of_staff' AND started_at>=? LIMIT 1").bind(cutoff).first();
  return Boolean(row);
}

async function scheduledRun(env: Env) {
  const queue = await processQueuedEvents(env);
  const hour = zonedHour(env.TIMEZONE || "America/New_York");
  let chief: unknown = null;
  if ((hour === 8 || hour === 19) && !(await chiefAlreadyRanThisHour(env))) {
    chief = await runChiefOfStaff(env, "scheduled");
  }
  return { queue, chief };
}

async function addEvent(env: Env, body: Record<string, unknown>) {
  if (!env.OPS_DB) return json({ error: "D1_NOT_CONFIGURED", message: "Create/bind OPS_DB before queueing persistent events." }, 503);
  const type = String(body.type || "").trim();
  const source = String(body.source || "manual").trim();
  const payload = asObject(body.payload);
  const allowed = new Set(["partner_message", "opportunity", "ugc_lead", "content_milestone", "content_asset"]);
  if (!allowed.has(type)) return json({ error: "INVALID_EVENT_TYPE", allowed: [...allowed] }, 400);
  const id = crypto.randomUUID();
  await env.OPS_DB.prepare("INSERT INTO events(id,type,source,payload_json,created_at) VALUES(?,?,?,?,?)")
    .bind(id, type, source, JSON.stringify(payload), nowIso()).run();
  return json({ ok: true, id, status: "queued", note: "No external action was taken." }, 201);
}

async function updateMilestone(env: Env, body: Record<string, unknown>) {
  if (!env.OPS_DB) return json({ error: "D1_NOT_CONFIGURED" }, 503);
  const key = String(body.key || "").trim();
  const value = String(body.value || "").trim();
  const status = String(body.status || "active").trim();
  const notes = String(body.notes || "").trim();
  if (!key || !value) return json({ error: "key and value are required" }, 400);
  await env.OPS_DB.prepare("INSERT INTO project_milestones(key,value,status,notes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at")
    .bind(key, value, status, notes, nowIso()).run();
  return json({ ok: true, key, value, status });
}

async function recordRevenue(env: Env, body: Record<string, unknown>) {
  if (!env.OPS_DB) return json({ error: "D1_NOT_CONFIGURED" }, 503);
  const id = crypto.randomUUID();
  const agent = String(body.agent || "unknown");
  const eventType = String(body.event_type || "revenue");
  const amountCents = Number(body.amount_cents || 0);
  const valueCents = Number(body.value_cents || 0);
  const notes = String(body.notes || "");
  await env.OPS_DB.prepare("INSERT INTO revenue_events(id,agent,event_type,amount_cents,value_cents,notes,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, agent, eventType, amountCents, valueCents, notes, nowIso()).run();
  return json({ ok: true, id });
}

async function listApprovals(env: Env, url: URL) {
  if (!env.OPS_DB) return json({ persistent: false, approvals: [] });
  const status = url.searchParams.get("status") || "pending";
  const rows = await env.OPS_DB.prepare("SELECT id,action_type,title,payload_json,risk,status,created_at,resolved_at,resolution_note FROM approvals WHERE status=? ORDER BY created_at ASC LIMIT 100").bind(status).all();
  return json({ approvals: rows.results.map((row: any) => ({ ...row, payload: (() => { try { return JSON.parse(row.payload_json); } catch { return row.payload_json; } })(), payload_json: undefined })) });
}

async function resolveApproval(env: Env, id: string, decision: "approved" | "rejected", note: string) {
  if (!env.OPS_DB) return json({ error: "D1_NOT_CONFIGURED" }, 503);
  const current = await env.OPS_DB.prepare("SELECT id,status FROM approvals WHERE id=?").bind(id).first<any>();
  if (!current) return json({ error: "APPROVAL_NOT_FOUND" }, 404);
  if (current.status !== "pending") return json({ error: "ALREADY_RESOLVED", status: current.status }, 409);
  await env.OPS_DB.prepare("UPDATE approvals SET status=?,resolved_at=?,resolution_note=? WHERE id=?")
    .bind(decision, nowIso(), note, id).run();
  return json({ ok: true, id, status: decision, external_action_executed: false, note: "Approval changes queue state only. This v0.1 Worker contains no email/post/purchase executor by design." });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "570zx-agents",
      version: "0.1.0",
      approval_mode: env.APPROVAL_MODE || "required",
      persistent_state: Boolean(env.OPS_DB),
      workers_ai: Boolean(env.AI && env.AI_ENABLED === "true"),
      external_action_executor: false,
      agents: ["chief_of_staff", "partnership_manager", "content_director"],
      timestamp: nowIso(),
    });
  }

  if (!isAuthorized(request, env)) return authFailure(env);

  if (request.method === "GET" && url.pathname === "/api/state") {
    return json(await loadState(env));
  }

  if (request.method === "GET" && url.pathname === "/api/approvals") {
    return listApprovals(env, url);
  }

  if (request.method === "POST" && url.pathname === "/api/events") {
    return addEvent(env, await readJson(request));
  }

  if (request.method === "POST" && url.pathname === "/api/milestones") {
    return updateMilestone(env, await readJson(request));
  }

  if (request.method === "POST" && url.pathname === "/api/revenue") {
    return recordRevenue(env, await readJson(request));
  }

  if (request.method === "POST" && url.pathname === "/api/run/full") {
    const queue = await processQueuedEvents(env);
    const chief = await runChiefOfStaff(env, "manual_full_run");
    return json({ ok: true, queue, chief, external_actions_taken: 0 });
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
  if (request.method === "POST" && approvalMatch) {
    const body = await readJson(request);
    return resolveApproval(env, approvalMatch[1], approvalMatch[2] === "approve" ? "approved" : "rejected", String(body.note || ""));
  }

  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledRun(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
