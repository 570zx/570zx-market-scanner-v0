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
  PAPER_ENABLED?: string;
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
  const mins = p.hour * 60 + p.minute;
  // 24/5 US equities window: Sunday 20:00 ET through Friday 20:00 ET.
  if (p.weekday === "Sat") return false;
  if (p.weekday === "Sun") return mins >= 20 * 60;
  if (p.weekday === "Fri") return mins < 20 * 60;
  return true;
}

function stockFeed(date = new Date()): "iex" | "overnight" {
  const p = easternParts(date);
  const mins = p.hour * 60 + p.minute;
  return mins >= 20 * 60 || mins < 4 * 60 ? "overnight" : "iex";
}

function freshTimestamp(ts: string | undefined, maxAgeMs: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && t <= Date.now() + 60_000 && Date.now() - t <= maxAgeMs;
}

function regularSession(date = new Date()): boolean {
  const p = easternParts(date);
  const mins = p.hour * 60 + p.minute;
  return !["Sat", "Sun"].includes(p.weekday) && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

async function alpacaJson(env: Env, path: string): Promise<any> {
  const r = await fetch(`${ALPACA_DATA}${path}`, { headers: headers(env), redirect:"manual", signal:AbortSignal.timeout(5000) });
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
  const feed = stockFeed();
  for (let i = 0; i < symbols.length; i += 45) {
    const batch = symbols.slice(i, i + 45);
    const q = encodeURIComponent(batch.join(","));
    const data = await alpacaJson(env, `/v2/stocks/snapshots?symbols=${q}&feed=${feed}`);
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
  const r = await fetch(`${ALPACA_DATA}/v1beta1/news?${q}`, { headers: headers(env), redirect:"manual", signal:AbortSignal.timeout(5000) });
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
    const response = await fetch(target, {method:"POST",redirect:"manual",signal:AbortSignal.timeout(5000),
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
    const overnight = stockFeed() === "overnight";
    const quoteFresh = freshTimestamp(snap?.latestQuote?.t, 5 * 60_000);
    const tradeFresh = freshTimestamp(snap?.latestTrade?.t, overnight ? 20 * 60_000 : 5 * 60_000);
    const quoteMid = snap?.latestQuote?.bp && snap?.latestQuote?.ap ? (snap.latestQuote.bp + snap.latestQuote.ap) / 2 : undefined;
    const px = overnight && quoteFresh ? quoteMid : (tradeFresh ? snap?.latestTrade?.p : snap?.minuteBar?.c);
    if (!px) continue;
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

type D1Like = D1Database;

type PaperEnv = {
  MEDS_DB: D1Like;
  ALPACA_API_KEY: string;
  ALPACA_API_SECRET: string;
  PAPER_ENABLED?: string;
};

type PaperSnapshot = {
  latestTrade?: { p: number; s?: number; t?: string };
  latestQuote?: { bp: number; ap: number; bs?: number; as?: number; t?: string };
  minuteBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
  prevDailyBar?: { o: number; h: number; l: number; c: number; v: number; t?: string };
};

type PaperCandidate = {
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
  score: number;
  reasons: string[];
};

type Ledger = {
  ledger_id: string;
  label: string;
  starting_equity: number;
  cash: number;
  realized_pnl: number;
  max_equity: number;
  max_drawdown_pct: number;
};

type Proposal = {
  symbol: string;
  strategy: string;
  direction: 'long'|'short';
  quality: number;
  stopPct: number;
  rewardRisk: number;
  reason: string;
};

type OptionSnap = {
  latestQuote?: { bp?: number; ap?: number; bs?: number; as?: number; t?: string };
  latestTrade?: { p?: number; t?: string };
  impliedVolatility?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
};

const PAPER_ALPACA_DATA = 'https://data.alpaca.markets';

const PAPER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS paper_meta(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, initialized_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paper_ledgers(ledger_id TEXT PRIMARY KEY,label TEXT NOT NULL,starting_equity REAL NOT NULL,cash REAL NOT NULL,realized_pnl REAL NOT NULL DEFAULT 0,max_equity REAL NOT NULL,max_drawdown_pct REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paper_cycles(bucket TEXT PRIMARY KEY,started_at TEXT NOT NULL,completed_at TEXT,candidates_evaluated INTEGER NOT NULL DEFAULT 0,entries INTEGER NOT NULL DEFAULT 0,exits INTEGER NOT NULL DEFAULT 0,option_entries INTEGER NOT NULL DEFAULT 0,notes TEXT);
CREATE TABLE IF NOT EXISTS paper_positions(id INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT NOT NULL,lane TEXT NOT NULL CHECK(lane IN ('PRIMARY','SHADOW')),symbol TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('long','short')),strategy TEXT NOT NULL,opened_at TEXT NOT NULL,entry_price REAL NOT NULL,quantity INTEGER NOT NULL,stop_price REAL NOT NULL,target_price REAL NOT NULL,initial_risk REAL NOT NULL,entry_spread_cost REAL NOT NULL DEFAULT 0,entry_slippage_cost REAL NOT NULL DEFAULT 0,highest_price REAL NOT NULL,lowest_price REAL NOT NULL,status TEXT NOT NULL DEFAULT 'open',notes TEXT);
CREATE INDEX IF NOT EXISTS idx_paper_positions_open ON paper_positions(status,ledger_id,lane);
CREATE INDEX IF NOT EXISTS idx_paper_positions_symbol ON paper_positions(symbol,status);
CREATE TABLE IF NOT EXISTS paper_option_positions(id INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT NOT NULL,lane TEXT NOT NULL CHECK(lane='SHADOW'),underlying TEXT NOT NULL,strategy TEXT NOT NULL,opened_at TEXT NOT NULL,long_symbol TEXT NOT NULL,short_symbol TEXT,quantity INTEGER NOT NULL,entry_debit REAL NOT NULL,stop_debit REAL NOT NULL,target_debit REAL NOT NULL,initial_risk REAL NOT NULL,highest_mark REAL NOT NULL,lowest_mark REAL NOT NULL,current_mark REAL NOT NULL,status TEXT NOT NULL DEFAULT 'open',data_quality TEXT NOT NULL DEFAULT 'indicative',notes TEXT);
CREATE INDEX IF NOT EXISTS idx_paper_option_open ON paper_option_positions(status,ledger_id);
CREATE TABLE IF NOT EXISTS paper_trades(id INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT NOT NULL,lane TEXT NOT NULL,asset_type TEXT NOT NULL,symbol TEXT NOT NULL,strategy TEXT NOT NULL,direction TEXT NOT NULL,opened_at TEXT NOT NULL,closed_at TEXT NOT NULL,quantity REAL NOT NULL,entry_price REAL NOT NULL,exit_price REAL NOT NULL,realized_pnl REAL NOT NULL,return_pct REAL NOT NULL,r_multiple REAL NOT NULL,reward_score REAL NOT NULL,max_favorable_excursion REAL,max_adverse_excursion REAL,slippage_cost REAL NOT NULL DEFAULT 0,exit_reason TEXT NOT NULL,data_quality TEXT NOT NULL,notes TEXT);
CREATE INDEX IF NOT EXISTS idx_paper_trades_ledger_time ON paper_trades(ledger_id,closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy ON paper_trades(strategy,closed_at DESC);
CREATE TABLE IF NOT EXISTS paper_decisions(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,bucket TEXT NOT NULL,ledger_id TEXT NOT NULL,lane TEXT NOT NULL,asset_type TEXT NOT NULL,symbol TEXT NOT NULL,strategy TEXT NOT NULL,decision TEXT NOT NULL,score REAL,reference_price REAL,spread_pct REAL,reason TEXT,data_quality TEXT NOT NULL DEFAULT 'live');
CREATE INDEX IF NOT EXISTS idx_paper_decisions_bucket ON paper_decisions(bucket,ledger_id);
CREATE INDEX IF NOT EXISTS idx_paper_decisions_symbol ON paper_decisions(symbol,created_at DESC);
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('A','MICRO',209.87,210.92,1.05,210.92,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('B','SMALL',1000,1000,0,1000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('C','GROWTH',5000,5000,0,5000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('D','SCALE',25000,25000,0,25000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes)
SELECT 'A','PRIMARY','equity','CIFR','extended_hours_continuation','long','2026-09-16T23:58:00-04:00','2026-09-17T04:51:00-04:00',3,17.30,17.65,1.05,2.0231,1.9444,1.80,NULL,NULL,0,'target','manual-paper','Imported from manual paper cycle' WHERE NOT EXISTS(SELECT 1 FROM paper_trades WHERE ledger_id='A' AND symbol='CIFR' AND opened_at='2026-09-16T23:58:00-04:00');
INSERT OR REPLACE INTO paper_meta(id,version,initialized_at) VALUES(1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
`;

async function ensurePaperSchema(env:PaperEnv){
  try {
    const row=await env.MEDS_DB.prepare(`SELECT version FROM paper_meta WHERE id=1`).first<any>();
    if(Number(row?.version)>=1) return;
  } catch { /* first boot before paper tables exist */ }
  // D1 exec() treats newline-delimited input as separate statements, which
  // breaks the multiline INSERT ... SELECT seed below. Prepare complete
  // semicolon-delimited statements and apply them atomically instead.
  const statements = PAPER_SCHEMA_SQL.trim()
    .split(/;\s*(?:\n|$)/)
    .map(sql => sql.trim())
    .filter(Boolean)
    .map(sql => env.MEDS_DB.prepare(sql));
  await env.MEDS_DB.batch(statements);
}
const LEDGER_POLICY: Record<string,{maxRiskPct:number;maxAllocPct:number;primaryMax:number;shadowMax:number}> = {
  A: {maxRiskPct:0.05,maxAllocPct:0.25,primaryMax:3,shadowMax:7},
  B: {maxRiskPct:0.05,maxAllocPct:0.25,primaryMax:3,shadowMax:7},
  C: {maxRiskPct:0.05,maxAllocPct:0.25,primaryMax:4,shadowMax:8},
  D: {maxRiskPct:0.05,maxAllocPct:0.25,primaryMax:4,shadowMax:8},
};

function paperHeaders(env: PaperEnv): HeadersInit {
  return {'APCA-API-KEY-ID':env.ALPACA_API_KEY,'APCA-API-SECRET-KEY':env.ALPACA_API_SECRET};
}
function paperClamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)); }
function isoDate(d:Date){ return d.toISOString().slice(0,10); }
function addDays(d:Date,n:number){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function etParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date);
  const get=(t:string)=>parts.find(p=>p.type===t)?.value??'';
  return {weekday:get('weekday'),hour:Number(get('hour')),minute:Number(get('minute'))};
}
function phase(date=new Date()): 'overnight'|'premarket'|'regular'|'postmarket'|'closed' {
  const p=etParts(date), m=p.hour*60+p.minute;
  if (p.weekday==='Sat') return 'closed';
  if (p.weekday==='Sun') return m>=20*60?'overnight':'closed';
  if (p.weekday==='Fri' && m>=20*60) return 'closed';
  if (m<4*60) return 'overnight';
  if (m<9*60+30) return 'premarket';
  if (m<16*60) return 'regular';
  if (m<20*60) return 'postmarket';
  return 'overnight';
}
function paperDecisionBoundary(date=new Date()){ return phase(date)!=='closed'; }
function bucket5(date=new Date()){
  const ms=5*60*1000; return new Date(Math.floor(date.getTime()/ms)*ms).toISOString();
}

async function alpaca(env:PaperEnv,path:string):Promise<any>{
  const r=await fetch(`${PAPER_ALPACA_DATA}${path}`,{headers:paperHeaders(env),redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(!r.ok) throw new Error(`Alpaca paper-lab HTTP ${r.status}`);
  return r.json();
}

function proposals(c:PaperCandidate, marketPhase:ReturnType<typeof phase>):Proposal[]{
  const out:Proposal[]=[];
  const earlyLong=c.dayChangePct>=-2 && c.dayChangePct<=20;
  if(c.catalystScore>0 && earlyLong && c.volumeAccel>=0.05 && c.spreadPct<=3.0){
    out.push({symbol:c.symbol,strategy:'catalyst_momentum',direction:'long',quality:c.score+8,stopPct:paperClamp(Math.max(0.025,c.spreadPct/100*2.2),0.025,0.08),rewardRisk:2.2,reason:'positive catalyst + participation acceleration'});
  }
  if(['overnight','premarket','postmarket'].includes(marketPhase) && c.dayChangePct>=1 && c.dayChangePct<=22 && c.consecutiveHits>=2 && c.volumeAccel>=-0.05 && c.spreadPct<=3.0){
    out.push({symbol:c.symbol,strategy:'extended_hours_continuation',direction:'long',quality:c.score+4,stopPct:paperClamp(Math.max(0.02,c.spreadPct/100*2.0),0.02,0.07),rewardRisk:2.0,reason:'persistent extended-hours continuation'});
  }
  if(c.dayChangePct<=-4 && c.dayChangePct>=-15 && c.catalystScore>=0 && c.spreadPct<=2.5 && c.volumeAccel>=-0.25){
    out.push({symbol:c.symbol,strategy:'mean_reversion_long',direction:'long',quality:c.score-2,stopPct:0.045,rewardRisk:1.7,reason:'controlled selloff without negative catalyst'});
  }
  if(marketPhase==='regular' && c.dayChangePct<=-3 && c.catalystScore<0 && c.volumeAccel>=0.05 && c.spreadPct<=2.0){
    out.push({symbol:c.symbol,strategy:'breakdown_short',direction:'short',quality:c.score+6,stopPct:0.04,rewardRisk:2.0,reason:'negative catalyst + downside participation'});
  }
  if(marketPhase==='regular' && c.dayChangePct>=8 && c.dayChangePct<=30 && c.catalystScore<=0 && c.volumeAccel<=-0.10 && c.spreadPct<=2.0){
    out.push({symbol:c.symbol,strategy:'failed_momentum_short',direction:'short',quality:c.score-4,stopPct:0.035,rewardRisk:1.8,reason:'extended move with cooling participation'});
  }
  return out.sort((a,b)=>b.quality-a.quality);
}

function executablePrice(c:PaperCandidate, direction:'long'|'short', qty:number){
  const minuteLiquidity=Math.max(1,c.minuteVolume||0);
  const participation=qty/minuteLiquidity;
  const slipPct=paperClamp(0.0002 + participation*0.025,0.0002,0.01);
  if(direction==='long') return {fill:c.ask*(1+slipPct),slipPct};
  return {fill:c.bid*(1-slipPct),slipPct};
}

async function openCount(env:PaperEnv,ledger:string,lane:string,table='paper_positions'){
  const row=await env.MEDS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ledger_id=? AND lane=? AND status='open'`).bind(ledger,lane).first<any>();
  return Number(row?.n??0);
}
async function hasOpen(env:PaperEnv,ledger:string,lane:string,symbol:string,strategy:string){
  const r=await env.MEDS_DB.prepare(`SELECT id FROM paper_positions WHERE ledger_id=? AND lane=? AND symbol=? AND strategy=? AND status='open' LIMIT 1`).bind(ledger,lane,symbol,strategy).first<any>();
  return !!r;
}

async function markLedger(env:PaperEnv, ledger:Ledger, snaps:Record<string,PaperSnapshot>){
  const equities=await env.MEDS_DB.prepare(`SELECT symbol,direction,quantity FROM paper_positions WHERE ledger_id=? AND status='open'`).bind(ledger.ledger_id).all<any>();
  let equity=Number(ledger.cash);
  for(const p of equities.results??[]){
    const s=snaps[p.symbol]; const bid=s?.latestQuote?.bp??s?.latestTrade?.p??0; const ask=s?.latestQuote?.ap??s?.latestTrade?.p??0;
    if(p.direction==='long') equity+=Number(p.quantity)*bid; else equity-=Number(p.quantity)*ask;
  }
  const opts=await env.MEDS_DB.prepare(`SELECT current_mark,quantity FROM paper_option_positions WHERE ledger_id=? AND status='open'`).bind(ledger.ledger_id).all<any>();
  for(const p of opts.results??[]) equity += Number(p.current_mark) * 100 * Number(p.quantity);
  const high=Math.max(Number(ledger.max_equity),equity);
  const dd=high>0?Math.max(Number(ledger.max_drawdown_pct),1-equity/high):Number(ledger.max_drawdown_pct);
  await env.MEDS_DB.prepare(`UPDATE paper_ledgers SET max_equity=?,max_drawdown_pct=?,updated_at=? WHERE ledger_id=?`).bind(high,dd,new Date().toISOString(),ledger.ledger_id).run();
  return equity;
}

async function manageEquityPositions(env:PaperEnv,snaps:Record<string,PaperSnapshot>){
  const rows=await env.MEDS_DB.prepare(`SELECT * FROM paper_positions WHERE status='open' ORDER BY id`).all<any>();
  let exits=0;
  for(const p of rows.results??[]){
    const s=snaps[p.symbol]; if(!s) continue;
    const bid=s.latestQuote?.bp??0, ask=s.latestQuote?.ap??0;
    if(!(bid>0&&ask>=bid)) continue;
    const mark=p.direction==='long'?bid:ask;
    const hi=Math.max(Number(p.highest_price),mark), lo=Math.min(Number(p.lowest_price),mark);
    const stopHit=p.direction==='long'?mark<=p.stop_price:mark>=p.stop_price;
    const targetHit=p.direction==='long'?mark>=p.target_price:mark<=p.target_price;
    const ageMin=(Date.now()-Date.parse(p.opened_at))/60000;
    const timeExit=ageMin>=180;
    if(!stopHit&&!targetHit&&!timeExit){
      await env.MEDS_DB.prepare(`UPDATE paper_positions SET highest_price=?,lowest_price=? WHERE id=?`).bind(hi,lo,p.id).run();
      continue;
    }
    const exitReason=stopHit?'stop':targetHit?'target':'time';
    const gross=p.direction==='long'?(mark-p.entry_price)*p.quantity:(p.entry_price-mark)*p.quantity;
    const exitSlip=Math.abs(ask-bid)*0.5*p.quantity;
    const pnl=gross-exitSlip;
    const ret=p.entry_price>0?pnl/(p.entry_price*p.quantity):0;
    const rMult=p.initial_risk>0?pnl/p.initial_risk:0;
    const mfe=p.direction==='long'?(hi-p.entry_price)/p.entry_price:(p.entry_price-lo)/p.entry_price;
    const mae=p.direction==='long'?(lo-p.entry_price)/p.entry_price:(p.entry_price-hi)/p.entry_price;
    const reward=rMult - Math.abs(ret)*0.15 - (p.entry_slippage_cost+exitSlip)/Math.max(0.01,p.initial_risk)*0.15;
    const cashDelta=p.direction==='long'?mark*p.quantity:-mark*p.quantity;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`UPDATE paper_positions SET status='closed',highest_price=?,lowest_price=? WHERE id=?`).bind(hi,lo,p.id),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE ledger_id=?`).bind(cashDelta,pnl,new Date().toISOString(),p.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.ledger_id,p.lane,'equity',p.symbol,p.strategy,p.direction,p.opened_at,new Date().toISOString(),p.quantity,p.entry_price,mark,pnl,ret*100,rMult,reward,mfe*100,mae*100,p.entry_slippage_cost+exitSlip,exitReason,'market-data',p.notes??'')
    ]);
    exits++;
  }
  return exits;
}

async function enterEquityProposal(env:PaperEnv,ledger:Ledger,lane:'PRIMARY'|'SHADOW',c:PaperCandidate,p:Proposal,bucket:string){
  const policy=LEDGER_POLICY[ledger.ledger_id];
  const maxOpen=lane==='PRIMARY'?policy.primaryMax:policy.shadowMax;
  if(await openCount(env,ledger.ledger_id,lane)>=maxOpen) return {entered:false,reason:'open-position cap'};
  if(await hasOpen(env,ledger.ledger_id,lane,c.symbol,p.strategy)) return {entered:false,reason:'already open'};
  if(lane==='PRIMARY' && p.quality<70) return {entered:false,reason:'soft score threshold'};
  if(lane==='SHADOW' && p.quality<52) return {entered:false,reason:'below exploration threshold'};
  if(!(c.ask>0&&c.bid>0&&c.ask>=c.bid)) return {entered:false,reason:'invalid quote'};
  if(c.spreadPct>(lane==='PRIMARY'?3.0:5.0)) return {entered:false,reason:'spread too wide'};
  const roughEntry=p.direction==='long'?c.ask:c.bid;
  const riskPerShare=Math.max(roughEntry*p.stopPct,roughEntry*0.01);
  const equity=Math.max(0.01,Number(ledger.starting_equity)+Number(ledger.realized_pnl));
  const riskCap=equity*policy.maxRiskPct;
  const allocCap=equity*policy.maxAllocPct;
  const byRisk=Math.floor(riskCap/riskPerShare), byAlloc=Math.floor(allocCap/roughEntry);
  const liquidityCap=Math.max(0,Math.floor(Math.max(0,c.minuteVolume)*(lane==='PRIMARY'?0.02:0.05)));
  const qty=Math.max(0,Math.min(byRisk,byAlloc,liquidityCap||0));
  if(qty<1) return {entered:false,reason:'size/liquidity/whole-share constraint'};
  const {fill,slipPct}=executablePrice(c,p.direction,qty);
  const stop=p.direction==='long'?fill*(1-p.stopPct):fill*(1+p.stopPct);
  const risk=Math.abs(fill-stop)*qty;
  const target=p.direction==='long'?fill+(fill-stop)*p.rewardRisk:fill-(stop-fill)*p.rewardRisk;
  const cost=fill*qty;
  if(p.direction==='long' && cost>ledger.cash+1e-8) return {entered:false,reason:'cash constraint'};
  const spreadCost=(c.ask-c.bid)*0.5*qty, slipCost=fill*slipPct*qty;
  const cashDelta=p.direction==='long'?-cost:cost;
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare(`INSERT INTO paper_positions(ledger_id,lane,symbol,direction,strategy,opened_at,entry_price,quantity,stop_price,target_price,initial_risk,entry_spread_cost,entry_slippage_cost,highest_price,lowest_price,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(ledger.ledger_id,lane,c.symbol,p.direction,p.strategy,new Date().toISOString(),fill,qty,stop,target,risk,spreadCost,slipCost,fill,fill,'open',p.reason),
    env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,updated_at=? WHERE ledger_id=?`).bind(cashDelta,new Date().toISOString(),ledger.ledger_id),
    env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(new Date().toISOString(),bucket,ledger.ledger_id,lane,'equity',c.symbol,p.strategy,'ENTER',p.quality,fill,c.spreadPct,p.reason,'market-data')
  ]);
  return {entered:true,qty,fill,stop,target,risk};
}

function parseOcc(symbol:string){
  const m=symbol.match(/^(.*?)(\d{6})([CP])(\d{8})$/); if(!m) return null;
  const yy=Number(m[2].slice(0,2)),mm=Number(m[2].slice(2,4)),dd=Number(m[2].slice(4,6));
  return {root:m[1],expiration:`20${String(yy).padStart(2,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`,type:m[3]==='C'?'call':'put',strike:Number(m[4])/1000};
}

async function optionChain(env:PaperEnv,c:PaperCandidate,direction:'bull'|'bear'){
  const today=new Date();
  const q=new URLSearchParams({feed:'indicative',limit:'250',expiration_date_gte:isoDate(addDays(today,7)),expiration_date_lte:isoDate(addDays(today,45)),strike_price_gte:String(Math.max(0.5,c.price*0.75)),strike_price_lte:String(c.price*1.25),type:direction==='bull'?'call':'put'});
  const j=await alpaca(env,`/v1beta1/options/snapshots/${encodeURIComponent(c.symbol)}?${q}`);
  const snaps:Record<string,OptionSnap>=j.snapshots??{};
  return Object.entries(snaps).map(([symbol,s])=>({symbol,s,meta:parseOcc(symbol)})).filter(x=>x.meta && (x.s.latestQuote?.bp??0)>0 && (x.s.latestQuote?.ap??0)>=(x.s.latestQuote?.bp??0));
}

async function optionMarks(env:PaperEnv,symbols:string[]){
  const out:Record<string,OptionSnap>={};
  for(let i=0;i<symbols.length;i+=90){
    const q=new URLSearchParams({symbols:symbols.slice(i,i+90).join(','),feed:'indicative'});
    const j=await alpaca(env,`/v1beta1/options/snapshots?${q}`); Object.assign(out,j.snapshots??{});
  }
  return out;
}

async function manageOptionPositions(env:PaperEnv){
  const rows=await env.MEDS_DB.prepare(`SELECT * FROM paper_option_positions WHERE status='open' ORDER BY id`).all<any>();
  const symbols=[...new Set((rows.results??[]).flatMap((p:any)=>[p.long_symbol,p.short_symbol].filter(Boolean)))];
  if(!symbols.length || phase()!=='regular') return 0;
  const marks=await optionMarks(env,symbols); let exits=0;
  for(const p of rows.results??[]){
    const l=marks[p.long_symbol], sh=p.short_symbol?marks[p.short_symbol]:null;
    const longBid=l?.latestQuote?.bp??0; const shortAsk=sh?.latestQuote?.ap??0;
    if(!(longBid>0) || (p.short_symbol && !(shortAsk>=0))) continue;
    const mark=Math.max(0.01,longBid-(p.short_symbol?shortAsk:0));
    const hi=Math.max(Number(p.highest_mark),mark),lo=Math.min(Number(p.lowest_mark),mark);
    const age=(Date.now()-Date.parse(p.opened_at))/60000;
    const stop=mark<=p.stop_debit,target=mark>=p.target_debit,timeExit=age>=240;
    if(!stop&&!target&&!timeExit){ await env.MEDS_DB.prepare(`UPDATE paper_option_positions SET highest_mark=?,lowest_mark=?,current_mark=? WHERE id=?`).bind(hi,lo,mark,p.id).run(); continue; }
    const reason=stop?'stop':target?'target':'time';
    const pnl=(mark-p.entry_debit)*100*p.quantity;
    const ret=p.entry_debit>0?(mark/p.entry_debit-1):0;
    const r=p.initial_risk>0?pnl/p.initial_risk:0;
    const reward=r-0.20; // fixed penalty: free indicative options data is not execution-quality.
    const symbol=p.short_symbol?`${p.long_symbol}/${p.short_symbol}`:p.long_symbol;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`UPDATE paper_option_positions SET status='closed',highest_mark=?,lowest_mark=?,current_mark=? WHERE id=?`).bind(hi,lo,mark,p.id),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE ledger_id=?`).bind(mark*100*p.quantity,pnl,new Date().toISOString(),p.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.ledger_id,'SHADOW','option',symbol,p.strategy,'long',p.opened_at,new Date().toISOString(),p.quantity,p.entry_debit,mark,pnl,ret*100,r,reward,(hi/p.entry_debit-1)*100,(lo/p.entry_debit-1)*100,0,reason,'indicative',p.notes??'')
    ]); exits++;
  }
  return exits;
}

async function enterOptionsForCandidate(env:PaperEnv,ledger:Ledger,c:PaperCandidate,bucket:string){
  if(phase()!=='regular') return 0;
  const bullish=c.catalystScore>0 || (c.dayChangePct>1&&c.volumeAccel>0);
  const bearish=c.catalystScore<0 || (c.dayChangePct<-2&&c.volumeAccel>0);
  if(!bullish&&!bearish) return 0;
  const dir=bullish&&!bearish?'bull':bearish&&!bullish?'bear':c.score>=70?'bull':'bear';
  const chain=await optionChain(env,c,dir); if(!chain.length) return 0;
  chain.sort((a,b)=>Math.abs((a.meta!.strike)-c.price)-Math.abs((b.meta!.strike)-c.price) || a.meta!.expiration.localeCompare(b.meta!.expiration));
  const long=chain[0]; const longAsk=long.s.latestQuote!.ap!, longBid=long.s.latestQuote!.bp!;
  if(!(longAsk>0&&longBid>0) || (longAsk-longBid)/((longAsk+longBid)/2)>0.35) return 0;
  const sameExp=chain.filter(x=>x.meta!.expiration===long.meta!.expiration).sort((a,b)=>a.meta!.strike-b.meta!.strike);
  const shortCandidates=dir==='bull'?sameExp.filter(x=>x.meta!.strike>long.meta!.strike):sameExp.filter(x=>x.meta!.strike<long.meta!.strike).reverse();
  const short=shortCandidates[0];
  const existing=await env.MEDS_DB.prepare(`SELECT COUNT(*) AS n FROM paper_option_positions WHERE ledger_id=? AND underlying=? AND status='open'`).bind(ledger.ledger_id,c.symbol).first<any>();
  if(Number(existing?.n??0)>=2) return 0;
  const policy=LEDGER_POLICY[ledger.ledger_id]; const eq=Math.max(0.01,ledger.starting_equity+ledger.realized_pnl); let entries=0;
  const strategies:{strategy:string,longSym:string,shortSym?:string,debit:number}[]=[{strategy:dir==='bull'?'long_call':'long_put',longSym:long.symbol,debit:longAsk}];
  if(short){ const shortBid=short.s.latestQuote?.bp??0; const debit=longAsk-shortBid; if(debit>0.02) strategies.push({strategy:dir==='bull'?'call_debit_spread':'put_debit_spread',longSym:long.symbol,shortSym:short.symbol,debit}); }
  for(const st of strategies.slice(0,2)){
    const riskPer=st.debit*100; const qty=Math.floor(Math.min(eq*policy.maxRiskPct/riskPer,eq*policy.maxAllocPct/riskPer,ledger.cash/riskPer));
    if(qty<1){
      await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','option',c.symbol,st.strategy,'REJECTED_SIZE',c.score,st.debit,null,'premium/risk exceeds ledger constraints','indicative').run();
      continue;
    }
    const risk=riskPer*qty; const target=st.debit*1.50, stop=Math.max(0.01,st.debit*0.60);
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`INSERT INTO paper_option_positions(ledger_id,lane,underlying,strategy,opened_at,long_symbol,short_symbol,quantity,entry_debit,stop_debit,target_debit,initial_risk,highest_mark,lowest_mark,current_mark,status,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ledger.ledger_id,'SHADOW',c.symbol,st.strategy,new Date().toISOString(),st.longSym,st.shortSym??null,qty,st.debit,stop,target,risk,st.debit,st.debit,st.debit,'open','indicative','Free Alpaca indicative feed; research-only, not live-quality execution'),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash-?,updated_at=? WHERE ledger_id=?`).bind(riskPer*qty,new Date().toISOString(),ledger.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','option',c.symbol,st.strategy,'ENTER',c.score,st.debit,null,'directional option research from underlying signal','indicative')
    ]); entries++;
  }
  return entries;
}

async function runPaperLab(env:PaperEnv,candidates:PaperCandidate[],snaps:Record<string,PaperSnapshot>){
  if(env.PAPER_ENABLED==='false') return {ok:true,skipped:'paper disabled'};
  await ensurePaperSchema(env);
  const equityExits=await manageEquityPositions(env,snaps);
  const optionExits=await manageOptionPositions(env);
  const ledgers=(await env.MEDS_DB.prepare(`SELECT * FROM paper_ledgers ORDER BY ledger_id`).all<Ledger>()).results??[];
  for(const l of ledgers) await markLedger(env,l,snaps);
  if(!paperDecisionBoundary()) return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false};
  const bucket=bucket5();
  const claim=await env.MEDS_DB.prepare(`INSERT OR IGNORE INTO paper_cycles(bucket,started_at) VALUES(?,?)`).bind(bucket,new Date().toISOString()).run();
  if(!claim.meta.changes) return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false,duplicate:true};
  let entries=0,optionEntries=0,evaluated=0;
  const marketPhase=phase();
  for(const ledger of ledgers){
    for(const c of candidates.slice(0,6)){
      const ps=proposals(c,marketPhase);
      if(!ps.length){
        await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','equity',c.symbol,'none','NO_SETUP',c.score,c.price,c.spreadPct,'no strategy rule matched','market-data').run();
        evaluated++; continue;
      }
      for(const p of ps.slice(0,2)){
        for(const lane of ['PRIMARY','SHADOW'] as const){
          const r=await enterEquityProposal(env,ledger,lane,c,p,bucket); evaluated++;
          if(r.entered) entries++;
          else await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,lane,'equity',c.symbol,p.strategy,(r.reason==='soft score threshold'||r.reason==='below exploration threshold')?'REJECTED_SOFT':'REJECTED_HARD',p.quality,c.price,c.spreadPct,r.reason,'market-data').run();
        }
      }
    }
    // Free option data is indicative, so options are shadow/research-only until OPRA-quality data is available.
    for(const c of candidates.slice(0,2)) optionEntries+=await enterOptionsForCandidate(env,ledger,c,bucket);
  }
  await env.MEDS_DB.prepare(`UPDATE paper_cycles SET completed_at=?,candidates_evaluated=?,entries=?,exits=?,option_entries=?,notes=? WHERE bucket=?`).bind(new Date().toISOString(),evaluated,entries,equityExits+optionExits,optionEntries,`phase=${marketPhase}; options=indicative-research-only`,bucket).run();
  return {ok:true,decisionCycle:true,bucket,marketPhase,evaluated,entries,optionEntries,equityExits,optionExits};
}


async function scanTick(env: Env) {
  if (!inScanWindow()) return { ok: true, skipped: "outside scan window" };
  const minPrice = num(env.MIN_PRICE, 0.5);
  const maxPrice = Math.max(num(env.MAX_PRICE, 20), 500);
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
    const overnight = stockFeed() === "overnight";
    const bid = s?.latestQuote?.bp ?? 0;
    const ask = s?.latestQuote?.ap ?? 0;
    const quoteFresh = freshTimestamp(s?.latestQuote?.t, 5 * 60_000);
    const tradeFresh = freshTimestamp(s?.latestTrade?.t, overnight ? 20 * 60_000 : 5 * 60_000);
    const price = overnight && quoteFresh && bid > 0 && ask >= bid ? (bid + ask) / 2 : (tradeFresh ? s?.latestTrade?.p : s?.minuteBar?.c);
    if (!price || price < minPrice || price > maxPrice) continue;
    const prevClose = s?.prevDailyBar?.c ?? 0;
    const spreadPct = bid > 0 && ask > 0 ? ((ask - bid) / ((ask + bid)/2)) * 100 : 99;
    const dayChangePct = prevClose > 0 ? (price / prevClose - 1) * 100 : 0;
    if (dayChangePct > maxChange + 20 || dayChangePct < -15) continue;
    const previousState = priorMap.get(symbol);
    const state = previousState && easternParts(new Date(previousState.last_seen_at)).date === easternParts().date ? previousState : null;
    if (overnight ? !quoteFresh : !tradeFresh) continue;
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
  const top = rough.slice(0, Math.min(8, num(env.MAX_WATCH_SYMBOLS, 8)));
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

  let paper: any = { ok: true, skipped: "paper unavailable" };
  try {
    paper = await runPaperLab(env, top, snapshots);
  } catch (error) {
    paper = { ok: false, error: error instanceof Error ? error.message : "paper lab failed" };
  }
  return { ok: true, feed: stockFeed(), scanned: symbols.length, shortlisted: top.length, leaders: top.slice(0,5).map(x => ({symbol:x.symbol,score:x.score,price:x.price})), paper };
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
  if (count.n >= 8) return Response.json({error:"Free-tier limit: eight open shadow positions"},{status:409});
  await env.MEDS_DB.prepare(`INSERT INTO shadow_positions(symbol,opened_at,entry_price,quantity,remaining_qty,highest_price,status,stop_price,notes)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(symbol,new Date().toISOString(),entry,qty,qty,entry,"open",entry*(1-num(env.STOP_LOSS_PCT,0.12)),body.notes ?? "").run();
  return Response.json({ok:true,symbol,entry,qty});
}

async function runTick(env: Env, source: string) {
  const now = new Date().toISOString();
  await env.MEDS_DB.prepare(`UPDATE service_state SET last_tick_at=?,last_source=? WHERE id=1`).bind(now,source).run();
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
    const rawMessage = error instanceof Error ? error.message : "Unknown scan failure";
    // Persist a bounded, credential-safe diagnostic so /health can identify
    // provider and D1 failures without exposing request headers or secrets.
    const message = rawMessage
      .replace(/(APCA-API-(?:KEY-ID|SECRET-KEY)[=: ]+)[^\s,;]+/gi, "$1[redacted]")
      .slice(0, 300);
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
      const state = await env.MEDS_DB.prepare(`SELECT paused,last_tick_at,last_success_at,last_source,last_error FROM service_state WHERE id=1`).first<any>();
      return Response.json({ok:env.TRADING_MODE==="shadow" && !state?.last_error,mode:"shadow",live_execution:false,
        enabled:env.SCOUT_ENABLED==="true" && !state?.paused,time:new Date().toISOString(),market:easternParts(),feed:stockFeed(),paper_enabled:env.PAPER_ENABLED!=="false",...state});
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
    const tables: Record<string,string> = {
      "/signals":"signals ORDER BY id DESC",
      "/positions":"shadow_positions ORDER BY opened_at DESC",
      "/events":"position_events ORDER BY created_at DESC",
      "/alerts":"alert_delivery ORDER BY created_at DESC",
      "/paper/ledgers":"paper_ledgers ORDER BY ledger_id",
      "/paper/positions":"paper_positions ORDER BY id DESC",
      "/paper/options":"paper_option_positions ORDER BY id DESC",
      "/paper/trades":"paper_trades ORDER BY id DESC",
      "/paper/decisions":"paper_decisions ORDER BY id DESC",
      "/paper/cycles":"paper_cycles ORDER BY bucket DESC"
    };
    if (tables[url.pathname] && req.method === "GET") {
      const rows = await env.MEDS_DB.prepare(`SELECT * FROM ${tables[url.pathname]} LIMIT 50`).all();
      return Response.json(rows.results);
    }
    return new Response("Not found",{status:404});
  }
};
