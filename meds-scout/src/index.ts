interface Env {
  ADMIN_TOKEN?: string;
  SCOUT_ENABLED?: string;
  MEDS_DB: D1Database;
  AI?: Ai;
  ALPACA_API_KEY: string;
  ALPACA_API_SECRET: string;
  ALERT_WEBHOOK_URL?: string;
  BORROW_PROVIDER_URL?: string;
  BORROW_PROVIDER_TOKEN?: string;
  TRADING_MODE: string;
  MIN_PRICE: string;
  MAX_PRICE: string;
  MAX_DAY_CHANGE_PCT: string;
  MIN_SIGNAL_SCORE: string;
  MAX_WATCH_SYMBOLS: string;
  MAX_NEW_POSITION_PCT: string;
  PROFIT_PROTECT_PCT: string;
  FIRST_TAKE_PROFIT_PCT: string;
  FIRST_TAKE_PROFIT_FRACTION: string;
  SECOND_TAKE_PROFIT_PCT: string;
  SECOND_TAKE_PROFIT_FRACTION: string;
  STOP_LOSS_PCT: string;
  MARKET_TIMEZONE: string;
}

type Snapshot = {
  latestTrade?: { p: number; s?: number; t?: string };
  latestQuote?: { bp: number; ap: number; bs?: number; as?: number; t?: string };
  minuteBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
  prevDailyBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
};

type Candidate = {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  dayChangePct: number;
  dayVolume: number;
  previousDayVolume: number;
  minuteVolume: number;
  volumeAccel: number;
  consecutiveHits: number;
  catalystScore: number;
  catalystSummary: string;
  borrowFee?: number;
  shortInterestPct?: number;
  borrowAvailable?: number;
  score: number;
  reasons: string[];
};

const ALPACA_DATA = "https://data.alpaca.markets";

function headers(env: Env): HeadersInit {
  return {
    "APCA-API-KEY-ID": env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function inScanWindow(date = new Date()): boolean {
  const p = easternParts(date);
  if (["Sat", "Sun"].includes(p.weekday)) return false;
  const mins = p.hour * 60 + p.minute;
  // Premarket through postmarket. Regular-session signals get a small score boost.
  return mins >= 4 * 60 && mins < 20 * 60;
}

function regularSession(date = new Date()): boolean {
  const p = easternParts(date);
  const mins = p.hour * 60 + p.minute;
  return !["Sat", "Sun"].includes(p.weekday) && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

async function alpacaJson(env: Env, path: string): Promise<any> {
  const r = await fetch(`${ALPACA_DATA}${path}`, { headers: headers(env), redirect:"error", signal:AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Alpaca HTTP ${r.status}`);
  return r.json();
}

async function discoverSymbols(env: Env): Promise<string[]> {
  // Broad real-time discovery sources. We deliberately do NOT rely on gainers alone.
  const [active, movers] = await Promise.all([
    alpacaJson(env, "/v1beta1/screener/stocks/most-actives?by=trades&top=100"),
    alpacaJson(env, "/v1beta1/screener/stocks/movers?top=50"),
  ]);
  const symbols = new Set<string>();
  for (const x of active?.most_actives ?? active?.mostActives ?? []) if (x.symbol) symbols.add(x.symbol);
  for (const x of movers?.gainers ?? []) if (x.symbol) symbols.add(x.symbol);
  for (const x of movers?.losers ?? []) if (x.symbol) symbols.add(x.symbol);

  // Keep recently interesting names alive even if they temporarily fall off screeners.
  const recent = await env.MEDS_DB.prepare(
    `SELECT symbol FROM symbol_state WHERE last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes') ORDER BY score DESC LIMIT 80`
  ).all<{symbol:string}>();
  for (const r of recent.results ?? []) symbols.add(r.symbol);
  return [...symbols].slice(0, 180);
}

async function fetchSnapshots(env: Env, symbols: string[]): Promise<Record<string, Snapshot>> {
  const out: Record<string, Snapshot> = {};
  for (let i = 0; i < symbols.length; i += 45) {
    const batch = symbols.slice(i, i + 45);
    const q = encodeURIComponent(batch.join(","));
    const data = await alpacaJson(env, `/v2/stocks/snapshots?symbols=${q}&feed=iex`);
    Object.assign(out, data);
  }
  return out;
}

async function getPriorState(env: Env, symbol: string) {
  return env.MEDS_DB.prepare(
    `SELECT day_volume, last_minute_volume, consecutive_hits, score FROM symbol_state WHERE symbol=?`
  ).bind(symbol).first<any>();
}

async function fetchNewsForSymbols(env: Env, symbols: string[]) {
  if (!symbols.length) return [] as any[];
  const start = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const q = new URLSearchParams({ symbols: symbols.join(","), limit: "35", sort: "desc", start });
  const r = await fetch(`${ALPACA_DATA}/v1beta1/news?${q}`, { headers: headers(env), redirect:"error", signal:AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`News HTTP ${r.status}`);
  const j: any = await r.json();
  return j.news ?? [];
}

function heuristicCatalyst(news: any[], symbol: string) {
  const rows = news.filter(n => (n.symbols ?? []).includes(symbol)).slice(0, 4);
  if (!rows.length) return { score: 0, summary: "No fresh news in the current feed." };
  const hot = /(fda|phase\s*[123]|trial|contract|award|acquisition|merger|partnership|approval|patent|ai\b|artificial intelligence|data center|guidance|earnings|revenue|strategic|license|licensing|milestone)/i;
  const bad = /(offering|registered direct|atm\b|at-the-market|warrant|reverse split|delisting|bankruptcy|going concern|dilution)/i;
  let score = 0;
  const reasons: string[] = [];
  for (const n of rows) {
    const text = `${n.headline ?? ""} ${n.summary ?? ""}`;
    if (hot.test(text)) score += 22;
    if (bad.test(text)) score -= 22;
    reasons.push(n.headline ?? "fresh headline");
  }
  return { score: clamp(score, -35, 45), summary: reasons.slice(0, 2).join(" | ") };
}

function scoreCandidate(c: Candidate, isRegular: boolean): Candidate {
  let s = 0;
  const r: string[] = [];

  if (c.price >= 0.5 && c.price <= 10) { s += 8; r.push("low-dollar asymmetric range"); }
  if (c.dayChangePct >= -3 && c.dayChangePct <= 12) { s += 16; r.push("still early / not extended"); }
  else if (c.dayChangePct > 12 && c.dayChangePct <= 25) { s += 7; r.push("momentum active but less early"); }
  else if (c.dayChangePct > 25) { s -= 18; r.push("already extended"); }

  if (c.spreadPct <= 1.5) { s += 15; r.push("tight spread"); }
  else if (c.spreadPct <= 3.0) { s += 7; }
  else if (c.spreadPct > 6) { s -= 18; r.push("execution spread too wide"); }

  if (c.volumeAccel >= 0.20) { s += 17; r.push("minute-volume acceleration"); }
  else if (c.volumeAccel >= 0.08) { s += 10; }
  else if (c.volumeAccel <= -0.10) { s -= 8; r.push("participation cooling"); }

  const dayVolVsPrev = c.previousDayVolume > 0 ? c.dayVolume / c.previousDayVolume : 0;
  if (dayVolVsPrev >= 1.5) { s += 12; r.push("day volume already > prior day"); }
  else if (dayVolVsPrev >= 0.6) s += 6;

  if (c.consecutiveHits >= 2) { s += Math.min(10, c.consecutiveHits * 2); r.push("persistent across scans"); }
  s += c.catalystScore;
  if (c.catalystScore > 0) r.push("fresh catalyst detected");
  if (c.catalystScore < 0) r.push("financing/dilution headline risk");

  if (c.borrowFee != null) {
    if (c.borrowFee >= 100) { s += 15; r.push("extreme borrow fee"); }
    else if (c.borrowFee >= 50) { s += 10; r.push("high borrow fee"); }
    else if (c.borrowFee >= 30) s += 5;
  }
  if (c.borrowAvailable != null && c.borrowAvailable < 25000) { s += 9; r.push("scarce borrow inventory"); }
  if (c.shortInterestPct != null && c.shortInterestPct >= 20) { s += 8; r.push("crowded short interest"); }
  if (isRegular) s += 2;

  c.score = clamp(s, 0, 100);
  c.reasons = r;
  return c;
}

// At-most-once dispatch: ambiguous deliveries are journaled, never blindly retried.
async function postAlert(env: Env, text: string, eventKey: string) {
  if (!env.ALERT_WEBHOOK_URL) return;
  const claim = await env.MEDS_DB.prepare(`INSERT OR IGNORE INTO alert_delivery(event_key,created_at,status) VALUES(?,?,'claimed')`)
    .bind(eventKey,new Date().toISOString()).run();
  if (!claim.meta.changes) return;
  let status = "unknown";
  try {
    const target = new URL(env.ALERT_WEBHOOK_URL);
    if (target.protocol !== "https:" || /(^|\.)alpaca\.markets$/.test(target.hostname)) throw new Error("Invalid webhook target");
    const body = /(^|\.)discord(?:app)?\.com$/.test(target.hostname)
      ? { content: text.slice(0,1900), allowed_mentions: {parse: []} } : { text };
    const response = await fetch(target, {method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),
      headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    status = response.ok ? "sent" : `failed_http_${response.status}`;
  } catch { status = "unknown"; }
  await env.MEDS_DB.prepare(`UPDATE alert_delivery SET status=? WHERE event_key=?`).bind(status,eventKey).run();
}

async function persistCandidate(env: Env, c: Candidate, status: string, raw: any) {
  const now = new Date().toISOString();
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare(`INSERT INTO symbol_state(symbol,last_price,last_bid,last_ask,day_volume,previous_day_volume,last_minute_volume,score,status,consecutive_hits,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(symbol) DO UPDATE SET last_price=excluded.last_price,last_bid=excluded.last_bid,last_ask=excluded.last_ask,day_volume=excluded.day_volume,previous_day_volume=excluded.previous_day_volume,last_minute_volume=excluded.last_minute_volume,score=excluded.score,status=excluded.status,consecutive_hits=excluded.consecutive_hits,last_seen_at=excluded.last_seen_at`)
      .bind(c.symbol,c.price,c.bid,c.ask,c.dayVolume,c.previousDayVolume,c.minuteVolume,c.score,status,c.consecutiveHits,now),
    env.MEDS_DB.prepare(`INSERT INTO signals(created_at,symbol,score,status,price,bid,ask,day_change_pct,spread_pct,volume_accel,catalyst_score,borrow_fee,short_interest_pct,borrow_available,reasons,catalyst_summary,raw_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(now,c.symbol,c.score,status,c.price,c.bid,c.ask,c.dayChangePct,c.spreadPct,c.volumeAccel,c.catalystScore,c.borrowFee ?? null,c.shortInterestPct ?? null,c.borrowAvailable ?? null,c.reasons.join("; "),c.catalystSummary,JSON.stringify(raw).slice(0,12000))
  ]);
}

async function manageShadowPositions(env: Env, snapshots: Record<string, Snapshot>) {
  const rows = await env.MEDS_DB.prepare(`SELECT * FROM shadow_positions WHERE status='open'`).all<any>();
  const firstTp = num(env.FIRST_TAKE_PROFIT_PCT, 0.20);
  const firstFrac = num(env.FIRST_TAKE_PROFIT_FRACTION, 0.70);
  const secondTp = num(env.SECOND_TAKE_PROFIT_PCT, 0.30);
  const secondFrac = num(env.SECOND_TAKE_PROFIT_FRACTION, 0.50);
  const stopPct = num(env.STOP_LOSS_PCT, 0.12);

  for (const p of rows.results ?? []) {
    const snap = snapshots[p.symbol];
    const px = snap?.latestTrade?.p ?? snap?.minuteBar?.c;
    if (!px || !snap?.latestTrade?.t || Date.now()-Date.parse(snap.latestTrade.t)>5*60000 || Date.parse(snap.latestTrade.t)>Date.now()+60000) continue;
    const gain = px / p.entry_price - 1;
    const high = Math.max(p.highest_price, px);
    let remaining = p.remaining_qty;
    let realized = p.realized_pnl;
    let firstDone = p.first_tp_done;
    let secondDone = p.second_tp_done;
    const events: string[] = [];

    if (!firstDone && px + p.entry_price * 1e-10 >= p.entry_price * (1 + firstTp)) {
      const qty = Math.max(0, remaining * firstFrac);
      realized += qty * (px - p.entry_price);
      remaining -= qty; firstDone = 1;
      events.push(`+${(gain*100).toFixed(1)}%: de-risk ${(firstFrac*100).toFixed(0)}%, runner kept`);
    }
    if (!secondDone && px + p.entry_price * 1e-10 >= p.entry_price * (1 + secondTp) && remaining > 0) {
      const qty = remaining * secondFrac;
      realized += qty * (px - p.entry_price);
      remaining -= qty; secondDone = 1;
      events.push(`+${(gain*100).toFixed(1)}%: took another ${(secondFrac*100).toFixed(0)}% of runner`);
    }
    // Arm at +15%; protect entry, then trail the runner by the configured 15%.
    const protect = num(env.PROFIT_PROTECT_PCT,0.15);
    const stop = Math.max(p.stop_price ?? 0, p.entry_price * (1-stopPct),
      high + p.entry_price*1e-10 >= p.entry_price*(1+protect) ? p.entry_price : 0,
      firstDone ? high*(1-protect) : 0);
    if (px <= stop && remaining > 0) {
      realized += remaining * (px - p.entry_price);
      events.push(`stop hit at ${px.toFixed(3)}`);
      remaining = 0;
    }
    const status = remaining <= 0.000001 ? "closed" : "open";
    const update = env.MEDS_DB.prepare(`UPDATE shadow_positions SET remaining_qty=?,highest_price=?,realized_pnl=?,first_tp_done=?,second_tp_done=?,stop_price=?,status=? WHERE symbol=?`)
      .bind(remaining,high,realized,firstDone,secondDone,stop,status,p.symbol);
    const eventKey = `${p.symbol}:${p.opened_at}:${firstDone}:${secondDone}:${status}`;
    const statements = [update];
    if (events.length) statements.push(env.MEDS_DB.prepare(`INSERT OR IGNORE INTO position_events(event_key,created_at,symbol,price,remaining_qty,realized_pnl,description) VALUES(?,?,?,?,?,?,?)`)
      .bind(eventKey,new Date().toISOString(),p.symbol,px,remaining,realized,events.join("; ")));
    await env.MEDS_DB.batch(statements);
    if (events.length) await postAlert(env, `🛡️ ${p.symbol} POSITION MANAGER\n${events.join("\n")}\nEntry ${p.entry_price.toFixed(3)} | Now ${px.toFixed(3)} | Remaining ${remaining.toFixed(2)}`,eventKey);
  }
}

async function scanTick(env: Env) {
  if (!inScanWindow()) return { ok: true, skipped: "outside scan window" };
  const minPrice = num(env.MIN_PRICE, 0.5);
  const maxPrice = num(env.MAX_PRICE, 20);
  const maxChange = num(env.MAX_DAY_CHANGE_PCT, 25);
  const threshold = num(env.MIN_SIGNAL_SCORE, 67);

  const discovered = await discoverSymbols(env);
  const held = await env.MEDS_DB.prepare(`SELECT symbol FROM shadow_positions WHERE status='open'`).all<{symbol:string}>();
  const symbols = [...new Set([...(held.results ?? []).map(p=>p.symbol),...discovered])];
  const prior = await env.MEDS_DB.prepare(`SELECT * FROM symbol_state WHERE last_seen_at >= ?`).bind(new Date(Date.now()-90*60000).toISOString()).all<any>();
  const priorMap = new Map((prior.results ?? []).map(p=>[p.symbol,p]));
  const snapshots = await fetchSnapshots(env, symbols);
  await manageShadowPositions(env, snapshots);

  const rough: Candidate[] = [];
  for (const symbol of symbols) {
    const s = snapshots[symbol];
    const price = s?.latestTrade?.p ?? s?.minuteBar?.c;
    if (!price || price < minPrice || price > maxPrice) continue;
    const prevClose = s?.prevDailyBar?.c ?? 0;
    const bid = s?.latestQuote?.bp ?? 0;
    const ask = s?.latestQuote?.ap ?? 0;
    const spreadPct = bid > 0 && ask > 0 ? ((ask - bid) / ((ask + bid)/2)) * 100 : 99;
    const dayChangePct = prevClose > 0 ? (price / prevClose - 1) * 100 : 0;
    if (dayChangePct > maxChange + 20 || dayChangePct < -15) continue;
    const previousState = priorMap.get(symbol);
    const state = previousState && easternParts(new Date(previousState.last_seen_at)).date === easternParts().date ? previousState : null;
    if (!s?.latestTrade?.t || Date.now()-Date.parse(s.latestTrade.t)>5*60000 || Date.parse(s.latestTrade.t)>Date.now()+60000) continue;
    if (!(bid > 0 && ask >= bid)) continue;
    const dayVolume = s?.dailyBar?.v ?? 0;
    const priorDayVolume = s?.prevDailyBar?.v ?? 0;
    const minuteVolume = s?.minuteBar?.v ?? 0;
    const priorMinuteVolume = state?.last_minute_volume ?? minuteVolume;
    const volumeAccel = priorMinuteVolume > 0 ? (minuteVolume - priorMinuteVolume) / priorMinuteVolume : 0;
    rough.push({
      symbol, price, bid, ask, spreadPct, dayChangePct, dayVolume, previousDayVolume: priorDayVolume,
      minuteVolume, volumeAccel, consecutiveHits: (state && Date.now()-Date.parse(state.last_seen_at)<150000 ? state.consecutive_hits : 0) + 1,
      catalystScore: 0, catalystSummary: "", score: 0, reasons: []
    });
  }

  // Pre-rank before expensive news/borrow checks.
  for (const c of rough) scoreCandidate(c, regularSession());
  rough.sort((a,b) => b.score - a.score);
  const top = rough.slice(0, Math.min(4, num(env.MAX_WATCH_SYMBOLS, 4)));
  const news = await fetchNewsForSymbols(env, top.slice(0, 12).map(x => x.symbol));
  const borrow: Record<string,any> = {}; // No verified free borrow provider configured.

  for (const c of top) {
    const h = heuristicCatalyst(news, c.symbol);
    c.catalystScore = h.score;
    c.catalystSummary = h.summary;
    const bm = borrow[c.symbol] ?? {};
    c.borrowFee = bm.borrow_fee ?? bm.borrowFee;
    c.shortInterestPct = bm.short_interest_pct ?? bm.shortInterestPct;
    c.borrowAvailable = bm.available_shares ?? bm.borrowAvailable;
    scoreCandidate(c, regularSession());

    const ai: any = null; // Free-first deployment uses deterministic headline classification.
    if (ai) {
      const aiAdj = clamp(((ai.catalyst_strength ?? 50) - 50) * 0.15 - (ai.dilution_risk ?? 0) * 0.12 + (ai.squeeze_relevance ?? 0) * 0.08, -18, 18);
      c.score = clamp(c.score + aiAdj, 0, 100);
      c.catalystSummary = ai.summary ?? c.catalystSummary;
      if ((ai.dilution_risk ?? 0) >= 70) c.reasons.push("AI flags high dilution/financing risk");
      if ((ai.squeeze_relevance ?? 0) >= 70) c.reasons.push("AI flags squeeze-relevant catalyst");
    }

    const status = c.score >= 82 ? "A_PLUS_ARMED" : c.score >= threshold ? "IGNITION_WATCH" : "WATCH";
    await persistCandidate(env, c, status, snapshots[c.symbol]);

    const previous = priorMap.get(c.symbol);
    const oldAlert = previous?.last_alert_at ? Date.parse(previous.last_alert_at) : 0;
    const cooldown = Date.now() - oldAlert < 8 * 60 * 1000;
    if (c.score >= threshold && !cooldown) {
      const borrowText = c.borrowFee != null ? `\nBorrow: ${c.borrowFee.toFixed(1)}% | SI ${c.shortInterestPct?.toFixed?.(1) ?? "?"}% | avail ${c.borrowAvailable ?? "?"}` : "";
      const msg = `${c.score >= 82 ? "🔥 A+ ARMED" : "🚨 IGNITION WATCH"} — ${c.symbol}\nPrice ${c.price.toFixed(3)} | Day ${c.dayChangePct.toFixed(1)}% | Spread ${c.spreadPct.toFixed(1)}%\nVol accel ${(c.volumeAccel*100).toFixed(0)}% | Day/PriorVol ${(c.previousDayVolume>0?c.dayVolume/c.previousDayVolume:0).toFixed(2)}x${borrowText}\nCatalyst: ${c.catalystSummary || "none found"}\nWhy: ${c.reasons.slice(0,5).join(" + ")}\nSTATUS: PRE-MOVE / VERIFY BEFORE ENTRY`;
      await postAlert(env, msg, `signal:${c.symbol}:${Math.floor(Date.now()/480000)}`);
      await env.MEDS_DB.prepare(`UPDATE symbol_state SET last_alert_at=? WHERE symbol=?`).bind(new Date().toISOString(), c.symbol).run();
    }
  }

  return { ok: true, scanned: symbols.length, shortlisted: top.length, leaders: top.slice(0,5).map(x => ({symbol:x.symbol,score:x.score,price:x.price})) };
}

async function openShadowPosition(env: Env, req: Request) {
  const body: any = await req.json();
  const symbol = String(body.symbol ?? "").toUpperCase();
  const entry = Number(body.entry_price);
  const qty = Number(body.quantity);
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol) || !Number.isFinite(entry) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return Response.json({error:"symbol, entry_price, quantity required"},{status:400});
  const existing = await env.MEDS_DB.prepare(`SELECT symbol FROM shadow_positions WHERE symbol=?`).bind(symbol).first();
  if (existing) return Response.json({error:"Position already recorded; overwrite prohibited"},{status:409});
  const count = await env.MEDS_DB.prepare(`SELECT COUNT(*) AS n FROM shadow_positions WHERE status='open'`).first<any>();
  if (count.n >= 4) return Response.json({error:"Free-tier limit: four open shadow positions"},{status:409});
  await env.MEDS_DB.prepare(`INSERT INTO shadow_positions(symbol,opened_at,entry_price,quantity,remaining_qty,highest_price,status,stop_price,notes)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(symbol,new Date().toISOString(),entry,qty,qty,entry,"open",entry*(1-num(env.STOP_LOSS_PCT,0.12)),body.notes ?? "").run();
  return Response.json({ok:true,symbol,entry,qty});
}

async function runTick(env: Env, source: string) {
  const now = new Date().toISOString();
  await env.MEDS_DB.prepare(`UPDATE service_state SET last_tick_at=?,last_source=?,tick_count=tick_count+1 WHERE id=1`).bind(now,source).run();
  const state = await env.MEDS_DB.prepare(`SELECT * FROM service_state WHERE id=1`).first<any>();
  if (env.TRADING_MODE !== "shadow") throw new Error("Only shadow mode is supported; no brokerage execution exists");
  if (env.SCOUT_ENABLED !== "true" || state.paused) return {ok:true,skipped:"disabled"};
  if (!inScanWindow()) return {ok:true,skipped:"outside scan window"};
  const owner = crypto.randomUUID();
  const lock = await env.MEDS_DB.prepare(`UPDATE service_state SET lock_owner=?,lock_until=? WHERE id=1 AND (lock_until IS NULL OR lock_until<?)`)
    .bind(owner,Date.now()+15*60000,Date.now()).run();
  if (!lock.meta.changes) return {ok:true,skipped:"scan already running"};
  try {
    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw new Error("Missing Alpaca secrets");
    const result = await scanTick(env);
    await env.MEDS_DB.prepare(`UPDATE service_state SET last_success_at=?,last_result=?,last_error=NULL WHERE id=1`).bind(now,JSON.stringify(result)).run();
    // Bounded cleanup per tick, including outside-hours retention on next active scan.
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`DELETE FROM signals WHERE id IN (SELECT id FROM signals WHERE created_at<? LIMIT 8)`).bind(new Date(Date.now()-7*86400000).toISOString()),
      env.MEDS_DB.prepare(`DELETE FROM alert_delivery WHERE event_key IN (SELECT event_key FROM alert_delivery WHERE created_at<? LIMIT 8)`).bind(new Date(Date.now()-30*86400000).toISOString())
    ]);
    return result;
  } catch (error) {
    const message = error instanceof Error && /^(Missing Alpaca|Alpaca HTTP|News HTTP)/.test(error.message) ? error.message : "Scan failed; check provider availability and database limits";
    await env.MEDS_DB.prepare(`UPDATE service_state SET last_error=? WHERE id=1`).bind(message).run();
    return {ok:false,error:message};
  } finally {
    await env.MEDS_DB.prepare(`UPDATE service_state SET lock_owner=NULL,lock_until=NULL WHERE id=1 AND lock_owner=?`).bind(owner).run();
  }
}

export { runTick, scanTick, manageShadowPositions, inScanWindow, heuristicCatalyst };
export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runTick(env,"cron"));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health" && req.method === "GET") {
      const state = await env.MEDS_DB.prepare(`SELECT paused,last_tick_at,last_success_at,last_source,last_error,tick_count FROM service_state WHERE id=1`).first<any>();
      return Response.json({ok:env.TRADING_MODE==="shadow" && !state?.last_error,mode:"shadow",live_execution:false,
        enabled:env.SCOUT_ENABLED==="true" && !state?.paused,time:new Date().toISOString(),market:easternParts(),...state});
    }
    if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return Response.json({error:"Unauthorized"},{status:401});
    if (url.pathname === "/control/pause" && req.method === "POST") {
      await env.MEDS_DB.prepare(`UPDATE service_state SET paused=1 WHERE id=1`).run();
      return Response.json({ok:true,paused:true});
    }
    if (url.pathname === "/control/resume" && req.method === "POST") {
      await env.MEDS_DB.prepare(`UPDATE service_state SET paused=0 WHERE id=1`).run();
      return Response.json({ok:true,paused:false});
    }
    if (url.pathname === "/scan" && req.method === "POST") return Response.json(await runTick(env,"manual"));
    if (url.pathname === "/shadow/open" && req.method === "POST") return openShadowPosition(env,req);
    const tables: Record<string,string> = {"/signals":"signals ORDER BY id DESC", "/positions":"shadow_positions ORDER BY opened_at DESC", "/events":"position_events ORDER BY created_at DESC", "/alerts":"alert_delivery ORDER BY created_at DESC"};
    if (tables[url.pathname] && req.method === "GET") {
      const rows = await env.MEDS_DB.prepare(`SELECT * FROM ${tables[url.pathname]} LIMIT 50`).all();
      return Response.json(rows.results);
    }
    return new Response("Not found",{status:404});
  }
};
