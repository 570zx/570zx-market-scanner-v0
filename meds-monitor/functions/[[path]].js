const ALLOWED = new Set([
  "/status",
  "/status/trades",
  "/status/positions",
  "/status/decisions",
]);

const REPORT_PATH = "/report";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchTelemetry(env, path) {
  const response = await env.MEDS.fetch(
    new Request(`https://meds.internal${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  );

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    data = { ok: false, error: "Invalid telemetry response" };
  }

  return { status: response.status, data };
}

async function renderReport(env) {
  const sections = await Promise.all([
    fetchTelemetry(env, "/status"),
    fetchTelemetry(env, "/status/trades?limit=100"),
    fetchTelemetry(env, "/status/positions?limit=100"),
    fetchTelemetry(env, "/status/decisions?limit=100"),
  ]);
  const labels = ["Overall status", "Closed trades", "Open positions", "Recent decisions"];
  const generatedAt = new Date().toISOString();
  const blocks = sections.map((section, index) => `
    <section>
      <h2>${labels[index]}</h2>
      <p>Upstream HTTP status: ${section.status}</p>
      <pre>${escapeHtml(JSON.stringify(section.data, null, 2))}</pre>
    </section>`).join("");

  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>MEDS Scout Live Report</title>
<style>body{font:16px/1.45 system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;background:#0b0d10;color:#eef2f6}h1,h2{color:#fff}section{margin:24px 0;padding:18px;border:1px solid #343b44;border-radius:8px;background:#12161b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#080a0d;padding:16px;border-radius:6px;color:#bfe3c4}a{color:#8cc8ff}</style>
</head><body><h1>MEDS Scout — Live Paper-Trading Report</h1>
<p>Public, read-only telemetry. No control actions or brokerage execution are available here.</p>
<p>Generated: <time>${generatedAt}</time></p>${blocks}</body></html>`, {
    status: sections.every((section) => section.status === 200) ? 200 : 502,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return new Response("Read only", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const url = new URL(request.url);

  if (url.pathname === REPORT_PATH) {
    return renderReport(env);
  }

  if (!ALLOWED.has(url.pathname)) {
    return new Response("Not found", { status: 404 });
  }

  const internalUrl = new URL("https://meds.internal");
  internalUrl.pathname = url.pathname;
  internalUrl.search = url.search;

  // Construct a fresh request so caller-supplied authorization, cookies, and
  // other headers can never be forwarded to the MEDS Worker.
  const response = await env.MEDS.fetch(
    new Request(internalUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    })
  );

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
