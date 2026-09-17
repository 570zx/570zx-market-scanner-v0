const ALLOWED = new Set([
  "/status",
  "/status/trades",
  "/status/positions",
  "/status/decisions",
]);

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return new Response("Read only", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const url = new URL(request.url);

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
