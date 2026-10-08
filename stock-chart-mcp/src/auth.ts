// Two secrets:
//  - MCP_TOKEN: full connector access (all tools). Only in the connector URL
//    (/mcp/<token>) or an Authorization: Bearer header.
//  - chart token: HMAC of MCP_TOKEN, view-only access to /chart and /api.
//    Chart links shown in chats carry this one, so sharing a chart link
//    never exposes the connector.

export const MIN_TOKEN_LENGTH = 24;

export function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function mcpTokenOk(env: { MCP_TOKEN?: string }, given: string | undefined) {
  const want = env.MCP_TOKEN ?? '';
  return want.length >= MIN_TOKEN_LENGTH && !!given && timingSafeEqual(want, given);
}

export async function chartToken(env: { MCP_TOKEN?: string }) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MCP_TOKEN ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('stock-chart-view-v1')));
  return [...sig.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function chartTokenOk(env: { MCP_TOKEN?: string }, given: string | undefined) {
  if ((env.MCP_TOKEN ?? '').length < MIN_TOKEN_LENGTH || !given) return false;
  return timingSafeEqual(await chartToken(env), given);
}
