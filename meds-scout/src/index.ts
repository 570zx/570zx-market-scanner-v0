import {SIM_VERSION, EXEC_VERSION, LIMITS, validQuote, equityExit, optionQuote, riskCapacity, type Exposure} from './paper-accounting.ts';

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
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
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
  executionFresh?: boolean;
  quoteAgeMs?: number;
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

type DiscoveryResult={
  symbols:string[];
  sourceBySymbol:Map<string,{source:string;rank:number|null}>;
  gainers:any[];
};

async function discoverSymbols(env: Env): Promise<DiscoveryResult> {
  // Broad real-time discovery sources. We deliberately do NOT rely on gainers alone.
  const [active, movers] = await Promise.all([
    alpacaJson(env, "/v1beta1/screener/stocks/most-actives?by=trades&top=100"),
    alpacaJson(env, "/v1beta1/screener/stocks/movers?top=50"),
  ]);
  const symbols = new Set<string>();
  const sourceBySymbol=new Map<string,{source:string;rank:number|null}>();
  const actives=active?.most_actives ?? active?.mostActives ?? [];
  const gainers=movers?.gainers ?? [];
  const losers=movers?.losers ?? [];
  for (const [i,x] of actives.entries()) if (x.symbol){
    symbols.add(x.symbol);sourceBySymbol.set(x.symbol,{source:'most_active',rank:i+1});
  }
  for (const [i,x] of gainers.entries()) if (x.symbol){
    symbols.add(x.symbol);sourceBySymbol.set(x.symbol,{source:'top_gainer',rank:i+1});
  }
  for (const [i,x] of losers.entries()) if (x.symbol){
    symbols.add(x.symbol);if(!sourceBySymbol.has(x.symbol)) sourceBySymbol.set(x.symbol,{source:'top_loser',rank:i+1});
  }

  // Keep recently interesting names alive even if they temporarily fall off screeners.
  const recent = await env.MEDS_DB.prepare(
    `SELECT symbol FROM symbol_state WHERE last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes') ORDER BY score DESC LIMIT 80`
  ).all<{symbol:string}>();
  for (const r of recent.results ?? []){
    symbols.add(r.symbol);if(!sourceBySymbol.has(r.symbol)) sourceBySymbol.set(r.symbol,{source:'recent',rank:null});
  }
  return {symbols:[...symbols].slice(0,180),sourceBySymbol,gainers:gainers.slice(0,50)};
}

async function fetchSnapshots(env: Env, symbols: string[]): Promise<Record<string, Snapshot>> {
  const feed = stockFeed();
  const batches:string[][]=[];
  for (let i = 0; i < symbols.length; i += 45) batches.push(symbols.slice(i,i+45));
  const pages=await Promise.all(batches.map(async batch=>{
    const q=encodeURIComponent(batch.join(","));
    return alpacaJson(env,`/v2/stocks/snapshots?symbols=${q}&feed=${feed}`);
  }));
  return Object.assign({},...pages);
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

  if (c.price >= HUNT_MIN_STOCK_PRICE && c.price < 0.5) { s += 10; r.push("sub-$0.50 penny asymmetric range"); }
  else if (c.price >= 0.5 && c.price <= 10) { s += 8; r.push("low-dollar asymmetric range"); }
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
CREATE TRIGGER IF NOT EXISTS paper_ledgers_prevent_negative_cash BEFORE UPDATE OF cash ON paper_ledgers WHEN NEW.cash < -0.000001 AND NEW.cash < OLD.cash BEGIN SELECT RAISE(ABORT,'paper ledger cash cannot be reduced below zero'); END;
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('A','MICRO',209.87,210.92,1.05,210.92,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('B','SMALL',1000,1000,0,1000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('C','GROWTH',5000,5000,0,5000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO paper_ledgers(ledger_id,label,starting_equity,cash,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('D','SCALE',25000,25000,0,25000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes)
SELECT 'A','PRIMARY','equity','CIFR','extended_hours_continuation','long','2026-09-16T23:58:00-04:00','2026-09-17T04:51:00-04:00',3,17.30,17.65,1.05,2.0231,1.9444,1.80,NULL,NULL,0,'target','manual-paper','Imported from manual paper cycle' WHERE NOT EXISTS(SELECT 1 FROM paper_trades WHERE ledger_id='A' AND symbol='CIFR' AND opened_at='2026-09-16T23:58:00-04:00');
INSERT INTO paper_meta(id,version,initialized_at) VALUES(1,2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET version=excluded.version;
`;

async function ensurePaperSchema(env:PaperEnv){
  try {
    const row=await env.MEDS_DB.prepare(`SELECT version FROM paper_meta WHERE id=1`).first<any>();
    if(Number(row?.version)>=9) return;
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
  // Additive migration: legacy values explicitly identify untouched history.
  for(const table of ['paper_trades','paper_cycles']){
    const columns=await env.MEDS_DB.prepare(`PRAGMA table_info(${table})`).all<any>();
    for(const col of ['simulator_version','execution_version']){
      if(!(columns.results??[]).some((c:any)=>c.name===col))
        await env.MEDS_DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT NOT NULL DEFAULT 'legacy-untrusted'`).run();
    }
  }
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS paper_valuations(id INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT NOT NULL,created_at TEXT NOT NULL,equity REAL,complete INTEGER NOT NULL,diagnostics TEXT NOT NULL,exposures TEXT NOT NULL,simulator_version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_paper_valuation_ledger ON paper_valuations(ledger_id,id DESC)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS paper_metric_epochs(ledger_id TEXT NOT NULL,simulator_version TEXT NOT NULL,max_equity REAL NOT NULL,max_drawdown_pct REAL NOT NULL,PRIMARY KEY(ledger_id,simulator_version))`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS paper_account_revisions(ledger_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0)`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO paper_account_revisions SELECT ledger_id,0 FROM paper_ledgers`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS paper_risk_guards(ledger_id TEXT PRIMARY KEY,expected_revision INTEGER NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_risk_guard_v3 BEFORE INSERT ON paper_risk_guards WHEN NEW.expected_revision != (SELECT revision FROM paper_account_revisions WHERE ledger_id=NEW.ledger_id) BEGIN SELECT RAISE(ABORT,'concurrent portfolio change: retry valuation'); END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_cash_revision_v3 AFTER UPDATE OF cash ON paper_ledgers BEGIN UPDATE paper_account_revisions SET revision=revision+1 WHERE ledger_id=NEW.ledger_id; END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_no_double_close_v3 BEFORE UPDATE OF status ON paper_positions WHEN OLD.status='closed' AND NEW.status='closed' BEGIN SELECT RAISE(ABORT,'position already closed'); END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_no_double_option_close_v3 BEFORE UPDATE OF status ON paper_option_positions WHEN OLD.status='closed' AND NEW.status='closed' BEGIN SELECT RAISE(ABORT,'option already closed'); END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_no_duplicate_equity_v3 BEFORE INSERT ON paper_positions WHEN EXISTS(SELECT 1 FROM paper_positions WHERE ledger_id=NEW.ledger_id AND symbol=NEW.symbol AND status='open') BEGIN SELECT RAISE(ABORT,'duplicate underlying equity'); END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_no_duplicate_option_v3 BEFORE INSERT ON paper_option_positions WHEN EXISTS(SELECT 1 FROM paper_option_positions WHERE ledger_id=NEW.ledger_id AND long_symbol=NEW.long_symbol AND COALESCE(short_symbol,'')=COALESCE(NEW.short_symbol,'') AND status='open') BEGIN SELECT RAISE(ABORT,'duplicate option structure'); END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_trade_version_v3 AFTER INSERT ON paper_trades BEGIN UPDATE paper_trades SET simulator_version='phase1-v1',execution_version='observed-side-v1' WHERE id=NEW.id; END`),
    env.MEDS_DB.prepare(`CREATE TRIGGER IF NOT EXISTS paper_cycle_version_v3 AFTER INSERT ON paper_cycles BEGIN UPDATE paper_cycles SET simulator_version='phase1-v1',execution_version='observed-side-v1' WHERE bucket=NEW.bucket; END`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_observations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,bucket TEXT NOT NULL,created_at TEXT NOT NULL,symbol TEXT NOT NULL,phase TEXT NOT NULL,
      price REAL NOT NULL,bid REAL NOT NULL,ask REAL NOT NULL,day_change_pct REAL NOT NULL,score REAL NOT NULL,spread_pct REAL NOT NULL,
      volume_accel REAL NOT NULL,day_volume_ratio REAL NOT NULL,consecutive_hits INTEGER NOT NULL,catalyst_score REAL NOT NULL,
      status TEXT NOT NULL,features TEXT NOT NULL,version TEXT NOT NULL,UNIQUE(bucket,symbol))`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_observation_time ON hunt_observations(created_at DESC)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_positions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,opened_at TEXT NOT NULL,entry_price REAL NOT NULL,stop_price REAL NOT NULL,
      target_price REAL NOT NULL,highest_price REAL NOT NULL,lowest_price REAL NOT NULL,entry_score REAL NOT NULL,
      entry_day_change_pct REAL NOT NULL,opened_phase TEXT NOT NULL,features TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',
      version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hunt_open_symbol ON hunt_positions(symbol) WHERE status='open'`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,opened_at TEXT NOT NULL,closed_at TEXT NOT NULL,
      entry_price REAL NOT NULL,exit_price REAL NOT NULL,return_pct REAL NOT NULL,mfe_pct REAL NOT NULL,mae_pct REAL NOT NULL,
      minutes_held REAL NOT NULL,exit_reason TEXT NOT NULL,entry_score REAL NOT NULL,entry_day_change_pct REAL NOT NULL,
      opened_phase TEXT NOT NULL,features TEXT NOT NULL,version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_trade_time ON hunt_trades(closed_at DESC)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_accounts(
      account_id TEXT PRIMARY KEY,label TEXT NOT NULL,starting_equity REAL NOT NULL,cash REAL NOT NULL,current_equity REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,max_equity REAL NOT NULL,max_drawdown_pct REAL NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at)
      VALUES('H100','$100',100,100,100,0,100,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at)
      VALUES('H1K','$1K',1000,1000,1000,0,1000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at)
      VALUES('H10K','$10K',10000,10000,10000,0,10000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at)
      VALUES('H100K','$100K',100000,100000,100000,0,100000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at)
      VALUES('H500K','$500K',500000,500000,500000,0,500000,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_positions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,symbol TEXT NOT NULL,opened_at TEXT NOT NULL,
      entry_price REAL NOT NULL,quantity REAL NOT NULL,entry_notional REAL NOT NULL,stop_price REAL NOT NULL,target_price REAL NOT NULL,
      highest_price REAL NOT NULL,lowest_price REAL NOT NULL,entry_score REAL NOT NULL,entry_day_change_pct REAL NOT NULL,
      opened_phase TEXT NOT NULL,features TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hunt_account_open_symbol ON hunt_account_positions(account_id,symbol) WHERE status='open'`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_account_position_open ON hunt_account_positions(account_id,status)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,symbol TEXT NOT NULL,opened_at TEXT NOT NULL,closed_at TEXT NOT NULL,
      entry_price REAL NOT NULL,exit_price REAL NOT NULL,quantity REAL NOT NULL,entry_notional REAL NOT NULL,exit_value REAL NOT NULL,
      realized_pnl REAL NOT NULL,return_pct REAL NOT NULL,mfe_pct REAL NOT NULL,mae_pct REAL NOT NULL,minutes_held REAL NOT NULL,
      exit_reason TEXT NOT NULL,entry_score REAL NOT NULL,entry_day_change_pct REAL NOT NULL,opened_phase TEXT NOT NULL,
      features TEXT NOT NULL,version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_account_trade_time ON hunt_account_trades(account_id,closed_at DESC)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,position_id INTEGER NOT NULL,symbol TEXT NOT NULL,
      created_at TEXT NOT NULL,event_type TEXT NOT NULL,price REAL NOT NULL,quantity REAL NOT NULL,realized_pnl REAL NOT NULL,
      details TEXT NOT NULL,version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_account_event_time ON hunt_account_events(account_id,created_at DESC)`)
  ]);
  // v6 is additive: preserve every existing Leader Hunt position while adding
  // partial-profit and runner state. Existing positions start with their full
  // original quantity remaining.
  const hpCols=await env.MEDS_DB.prepare(`PRAGMA table_info(hunt_account_positions)`).all<any>();
  const hpNames=new Set((hpCols.results??[]).map((x:any)=>x.name));
  const hpAdds=[
    ['remaining_qty','REAL'],
    ['locked_realized_pnl','REAL NOT NULL DEFAULT 0'],
    ['take200_done','INTEGER NOT NULL DEFAULT 0'],
    ['take200_price','REAL'],
    ['take200_at','TEXT'],
    ['runner_high','REAL']
  ] as const;
  for(const [name,type] of hpAdds) if(!hpNames.has(name))
    await env.MEDS_DB.prepare(`ALTER TABLE hunt_account_positions ADD COLUMN ${name} ${type}`).run();
  await env.MEDS_DB.prepare(`UPDATE hunt_account_positions SET remaining_qty=quantity WHERE remaining_qty IS NULL`).run();

  const htCols=await env.MEDS_DB.prepare(`PRAGMA table_info(hunt_account_trades)`).all<any>();
  const htNames=new Set((htCols.results??[]).map((x:any)=>x.name));
  const htAdds=[
    ['take200_hit','INTEGER NOT NULL DEFAULT 0'],
    ['take200_price','REAL'],
    ['runner_quantity','REAL'],
    ['peak_gap_pct','REAL']
  ] as const;
  for(const [name,type] of htAdds) if(!htNames.has(name))
    await env.MEDS_DB.prepare(`ALTER TABLE hunt_account_trades ADD COLUMN ${name} ${type}`).run();
  await env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_milestones(
    account_id TEXT NOT NULL,multiple REAL NOT NULL,reached_at TEXT NOT NULL,equity REAL NOT NULL,
    max_drawdown_pct REAL NOT NULL,version TEXT NOT NULL,PRIMARY KEY(account_id,multiple))`).run();
  await env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_milestone_time ON hunt_account_milestones(reached_at DESC)`).run();

  // v8 adds options to the same Leader Hunt capital accounts. Existing equity
  // positions/trades are untouched; options use dedicated tables but share
  // account cash, equity, drawdown and compounding milestones.
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_option_positions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,underlying TEXT NOT NULL,symbol TEXT NOT NULL,
      opened_at TEXT NOT NULL,entry_price REAL NOT NULL,quantity REAL NOT NULL,entry_notional REAL NOT NULL,
      stop_price REAL NOT NULL,target_price REAL NOT NULL,highest_price REAL NOT NULL,lowest_price REAL NOT NULL,
      current_mark REAL NOT NULL,current_mark_at TEXT NOT NULL,entry_score REAL NOT NULL,entry_day_change_pct REAL NOT NULL,opened_phase TEXT NOT NULL,features TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',version TEXT NOT NULL,remaining_qty REAL NOT NULL,
      locked_realized_pnl REAL NOT NULL DEFAULT 0,take200_done INTEGER NOT NULL DEFAULT 0,take200_price REAL,
      take200_at TEXT,runner_high REAL,data_quality TEXT NOT NULL DEFAULT 'indicative')`),
    env.MEDS_DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hunt_option_open_contract
      ON hunt_account_option_positions(account_id,symbol) WHERE status='open'`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_option_open
      ON hunt_account_option_positions(account_id,status)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_option_trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,underlying TEXT NOT NULL,symbol TEXT NOT NULL,
      opened_at TEXT NOT NULL,closed_at TEXT NOT NULL,entry_price REAL NOT NULL,exit_price REAL NOT NULL,
      quantity REAL NOT NULL,entry_notional REAL NOT NULL,exit_value REAL NOT NULL,realized_pnl REAL NOT NULL,
      return_pct REAL NOT NULL,mfe_pct REAL NOT NULL,mae_pct REAL NOT NULL,minutes_held REAL NOT NULL,
      exit_reason TEXT NOT NULL,entry_score REAL NOT NULL,entry_day_change_pct REAL NOT NULL,opened_phase TEXT NOT NULL,
      features TEXT NOT NULL,version TEXT NOT NULL,take200_hit INTEGER NOT NULL DEFAULT 0,take200_price REAL,
      runner_quantity REAL,peak_gap_pct REAL,data_quality TEXT NOT NULL DEFAULT 'indicative')`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_option_trade_time
      ON hunt_account_option_trades(account_id,closed_at DESC)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_account_option_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,position_id INTEGER NOT NULL,
      underlying TEXT NOT NULL,symbol TEXT NOT NULL,created_at TEXT NOT NULL,event_type TEXT NOT NULL,
      price REAL NOT NULL,quantity REAL NOT NULL,realized_pnl REAL NOT NULL,details TEXT NOT NULL,version TEXT NOT NULL)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_option_event_time
      ON hunt_account_option_events(account_id,created_at DESC)`)
  ]);
  await env.MEDS_DB.prepare(`UPDATE paper_meta SET version=8 WHERE id=1`).run();

  // v9 records the broad discovery universe and the live top-gainer board so
  // Leader Hunt can grade misses instead of only measuring trades it took.
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_discovery_observations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,bucket TEXT NOT NULL,session_date TEXT NOT NULL,created_at TEXT NOT NULL,
      symbol TEXT NOT NULL,source TEXT NOT NULL,source_rank INTEGER,price REAL NOT NULL,day_change_pct REAL NOT NULL,
      score REAL NOT NULL,spread_pct REAL NOT NULL,execution_fresh INTEGER NOT NULL,eligible INTEGER NOT NULL,
      shortlisted INTEGER NOT NULL DEFAULT 0,version TEXT NOT NULL,UNIQUE(bucket,symbol))`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_discovery_symbol_time
      ON hunt_discovery_observations(session_date,symbol,created_at)`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_discovery_under10
      ON hunt_discovery_observations(session_date,symbol,day_change_pct,created_at)`),
    env.MEDS_DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_gainer_board(
      id INTEGER PRIMARY KEY AUTOINCREMENT,bucket TEXT NOT NULL,session_date TEXT NOT NULL,created_at TEXT NOT NULL,
      phase TEXT NOT NULL,rank INTEGER NOT NULL,symbol TEXT NOT NULL,price REAL,change REAL,percent_change REAL,
      raw_json TEXT NOT NULL,version TEXT NOT NULL,UNIQUE(bucket,symbol))`),
    env.MEDS_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_gainer_board_time
      ON hunt_gainer_board(session_date,bucket,rank)`)
  ]);
  await env.MEDS_DB.prepare(`UPDATE paper_meta SET version=9 WHERE id=1`).run();
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

const HUNT_VERSION='leader-hunt-v4-multi-asset';
const HUNT_TRACKED_PER_CYCLE=12;
const HUNT_MAX_OPEN=32;
const HUNT_MIN_STOCK_PRICE=0.10;
const HUNT_MAX_OPTION_SIGNALS_PER_CYCLE=3;
const HUNT_OPTION_STOP_PCT=0.35;
const HUNT_OPTION_MAX_HOLD_MIN=24*60;
const HUNT_OPTION_SLIPPAGE_PCT=0.005;
const HUNT_MAX_NEW_PER_CYCLE=6;
const HUNT_MAX_HOLD_MIN=12*60;
const HUNT_RUNNER_MAX_HOLD_MIN=24*60;
const HUNT_REENTRY_COOLDOWN_MIN=15;
const HUNT_POSITION_PCT=0.04;
const HUNT_MAX_MINUTE_PARTICIPATION=0.05;
const HUNT_TAKE_RETURN_PCT=2.00;
const HUNT_RUNNER_FRACTION=0.05;
const HUNT_LADDER=[
  {event:'LADDER_25',returnPct:0.25,fraction:0.025},
  {event:'LADDER_50',returnPct:0.50,fraction:0.025},
  {event:'LADDER_100',returnPct:1.00,fraction:0.05},
] as const;
const HUNT_TAKE_FRACTION=1-HUNT_RUNNER_FRACTION-HUNT_LADDER.reduce((n,x)=>n+x.fraction,0);
const HUNT_RUNNER_TRAIL_PCT=0.15;
const HUNT_ACCOUNT_MULTIPLES=[2,5,10,25,50,100] as const;
const HUNT_ACCOUNTS=[
  {account_id:'H100',label:'$100',starting_equity:100},
  {account_id:'H1K',label:'$1K',starting_equity:1000},
  {account_id:'H10K',label:'$10K',starting_equity:10000},
  {account_id:'H100K',label:'$100K',starting_equity:100000},
  {account_id:'H500K',label:'$500K',starting_equity:500000},
] as const;

function leaderHuntEligible(c:PaperCandidate){
  // Research lane intentionally samples aggressively. The broad scanner has
  // already ranked these names; Leader Hunt only insists that the move is
  // still early enough to study, the spread is executable enough to model,
  // and the candidate is not completely unranked. Bad samples are useful
  // negative labels here because no live capital is attached.
  const early=c.dayChangePct>=-8 && c.dayChangePct<=10;
  const liquid=c.spreadPct<=(c.price<0.5?8:6);
  return c.price>=HUNT_MIN_STOCK_PRICE && early && liquid && c.score>=15;
}

function huntFeatures(c:PaperCandidate,marketPhase:ReturnType<typeof phase>){
  const x=c as PaperCandidate & {executionFresh?:boolean;quoteAgeMs?:number};
  return {
    phase:marketPhase,score:c.score,price:c.price,day_change_pct:c.dayChangePct,spread_pct:c.spreadPct,
    volume_accel:c.volumeAccel,day_volume_ratio:c.previousDayVolume>0?c.dayVolume/c.previousDayVolume:0,
    consecutive_hits:c.consecutiveHits,catalyst_score:c.catalystScore,catalyst_summary:c.catalystSummary,
    reasons:c.reasons,within_10pct:c.dayChangePct<=10,
    execution_quote_fresh:x.executionFresh===true,
    quote_age_seconds:Number.isFinite(x.quoteAgeMs)?Number(x.quoteAgeMs)/1000:null,
  };
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

async function manageLeaderHuntPositions(env:PaperEnv,snaps:Record<string,PaperSnapshot>,now=new Date()){
  const rows=await env.MEDS_DB.prepare("SELECT * FROM hunt_positions WHERE status='open' ORDER BY id").all<any>();
  let exits=0;
  for(const p of rows.results??[]){
    const q=snaps[p.symbol]?.latestQuote;
    if(!validQuote(q,now.getTime())) continue;
    const bid=Number(q.bp),ask=Number(q.ap),mid=(bid+ask)/2;
    await env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET current_mark=?,current_mark_at=? WHERE id=?")
      .bind(bid,now.toISOString(),p.id).run();
    const high=Math.max(Number(p.highest_price),mid),low=Math.min(Number(p.lowest_price),mid);
    const ageMin=Math.max(0,(now.getTime()-Date.parse(p.opened_at))/60000);
    const stop=bid<=Number(p.stop_price),target=bid>=Number(p.target_price),timeExit=ageMin>=HUNT_MAX_HOLD_MIN;
    if(!stop&&!target&&!timeExit){
      await env.MEDS_DB.prepare("UPDATE hunt_positions SET highest_price=?,lowest_price=? WHERE id=?").bind(high,low,p.id).run();
      continue;
    }
    const reason=stop?'stop':target?'target':'time';
    const fill=Math.max(0,bid*(1-0.0002));
    const ret=(fill/Number(p.entry_price)-1)*100;
    const mfe=(high/Number(p.entry_price)-1)*100;
    const mae=(low/Number(p.entry_price)-1)*100;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare("UPDATE hunt_positions SET status='closed',highest_price=?,lowest_price=? WHERE id=?").bind(high,low,p.id),
      env.MEDS_DB.prepare(`INSERT INTO hunt_trades(symbol,opened_at,closed_at,entry_price,exit_price,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.symbol,p.opened_at,now.toISOString(),p.entry_price,fill,ret,mfe,mae,ageMin,reason,p.entry_score,p.entry_day_change_pct,p.opened_phase,p.features,HUNT_VERSION)
    ]);
    exits++;
  }
  return exits;
}


async function markHuntAccounts(env:PaperEnv,snaps:Record<string,PaperSnapshot>,now=new Date(),huntOptionMarks:Record<string,OptionSnap>={}){
  const accounts=await env.MEDS_DB.prepare("SELECT * FROM hunt_accounts ORDER BY starting_equity").all<any>();
  for(const a of accounts.results??[]){
    let equity=Number(a.cash),complete=Number.isFinite(equity);
    const positions=await env.MEDS_DB.prepare("SELECT * FROM hunt_account_positions WHERE account_id=? AND status='open'").bind(a.account_id).all<any>();
    for(const p of positions.results??[]){
      const q=snaps[p.symbol]?.latestQuote;
      if(!validQuote(q,now.getTime())){complete=false;continue;}
      equity+=Number(q.bp)*Number(p.remaining_qty??p.quantity);
    }
    const optionPositions=await env.MEDS_DB.prepare("SELECT * FROM hunt_account_option_positions WHERE account_id=? AND status='open'").bind(a.account_id).all<any>();
    for(const p of optionPositions.results??[]){
      const q=huntOptionMarks[p.symbol]?.latestQuote;
      if(phase(now)!=='regular' || !validQuote(q,now.getTime())){complete=false;continue;}
      equity+=Number(q.bp)*100*Number(p.remaining_qty??p.quantity);
    }
    if(!complete) continue;
    const peak=Math.max(Number(a.max_equity),equity);
    const dd=peak>0?1-equity/peak:0;
    const maxDrawdown=Math.max(Number(a.max_drawdown_pct??0),dd);
    await env.MEDS_DB.prepare("UPDATE hunt_accounts SET current_equity=?,max_equity=?,max_drawdown_pct=?,updated_at=? WHERE account_id=?")
      .bind(equity,peak,maxDrawdown,now.toISOString(),a.account_id).run();
    const currentMultiple=Number(a.starting_equity)>0?equity/Number(a.starting_equity):0;
    for(const multiple of HUNT_ACCOUNT_MULTIPLES){
      if(currentMultiple+1e-12<multiple) continue;
      await env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_account_milestones(account_id,multiple,reached_at,equity,max_drawdown_pct,version)
        VALUES(?,?,?,?,?,?)`).bind(a.account_id,multiple,now.toISOString(),equity,maxDrawdown,HUNT_VERSION).run();
    }
  }
}

async function manageHuntAccountPositions(env:PaperEnv,snaps:Record<string,PaperSnapshot>,now=new Date(),markAtEnd=true){
  const rows=await env.MEDS_DB.prepare("SELECT * FROM hunt_account_positions WHERE status='open' ORDER BY id").all<any>();
  const ladderRows=await env.MEDS_DB.prepare("SELECT position_id,event_type FROM hunt_account_events WHERE event_type LIKE 'LADDER_%'").all<any>();
  const ladderByPosition=new Map<number,Set<string>>();
  for(const e of ladderRows.results??[]){
    const id=Number(e.position_id),set=ladderByPosition.get(id)??new Set<string>();
    set.add(String(e.event_type));ladderByPosition.set(id,set);
  }
  const deferredMarks:any[]=[];
  let exits=0,take200s=0,ladderSells=0;
  for(const p of rows.results??[]){
    const positionVersion=String(p.version??HUNT_VERSION);
    const snap=snaps[p.symbol],q=snap?.latestQuote;
    if(!validQuote(q,now.getTime())) continue;
    const bid=Number(q.bp),ask=Number(q.ap),mid=(bid+ask)/2;
    const high=Math.max(Number(p.highest_price),mid),low=Math.min(Number(p.lowest_price),mid);
    const ageMin=Math.max(0,(now.getTime()-Date.parse(p.opened_at))/60000);
    let remaining=Number(p.remaining_qty??p.quantity);
    let locked=Number(p.locked_realized_pnl??0);
    if(!(remaining>0)) continue;
    const minuteLiquidity=Math.max(1,Number(snap?.minuteBar?.v??1));
    const modeledSell=(qty:number)=>{
      const participation=qty/minuteLiquidity;
      const slipPct=paperClamp(0.0002+participation*0.025,0.0002,0.01);
      return {fill:Math.max(0,bid*(1-slipPct)),slipPct};
    };

    // Small profit ladder: only 10% of the original position is peeled before
    // the +200% objective. This locks incremental profit without turning the
    // monster-mover experiment into a scalp strategy.
    if(!Number(p.take200_done)){
      const done=ladderByPosition.get(Number(p.id))??new Set<string>();
      for(const rung of HUNT_LADDER){
        if(done.has(rung.event) || bid<Number(p.entry_price)*(1+rung.returnPct)) continue;
        const qty=Math.min(remaining,Number(p.quantity)*rung.fraction);
        if(!(qty>0)) continue;
        const sell=modeledSell(qty);
        const proceeds=sell.fill*qty;
        const partialPnl=(sell.fill-Number(p.entry_price))*qty;
        remaining-=qty; locked+=partialPnl;
        await env.MEDS_DB.batch([
          env.MEDS_DB.prepare("UPDATE hunt_account_positions SET remaining_qty=?,locked_realized_pnl=?,highest_price=?,lowest_price=? WHERE id=?")
            .bind(remaining,locked,high,low,p.id),
          env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
            .bind(proceeds,partialPnl,now.toISOString(),p.account_id),
          env.MEDS_DB.prepare(`INSERT INTO hunt_account_events(account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
            VALUES(?,?,?,?,?,?,?,?,?,?)`)
            .bind(p.account_id,p.id,p.symbol,now.toISOString(),rung.event,sell.fill,qty,partialPnl,
              JSON.stringify({threshold_return_pct:rung.returnPct,fraction:rung.fraction,remaining_qty:remaining,
                slippage_pct:sell.slipPct,observed_bid:bid}),positionVersion)
        ]);
        done.add(rung.event);
        ladderSells++;
      }
    }

    if(!Number(p.take200_done) && bid>=Number(p.entry_price)*(1+HUNT_TAKE_RETURN_PCT)){
      const runnerQty=Math.min(remaining,Number(p.quantity)*HUNT_RUNNER_FRACTION);
      const takeQty=Math.max(0,remaining-runnerQty);
      if(takeQty>0){
        const sell=modeledSell(takeQty);
        const proceeds=sell.fill*takeQty;
        const partialPnl=(sell.fill-Number(p.entry_price))*takeQty;
        remaining=runnerQty; locked+=partialPnl;
        await env.MEDS_DB.batch([
          env.MEDS_DB.prepare(`UPDATE hunt_account_positions SET remaining_qty=?,locked_realized_pnl=?,
            take200_done=1,take200_price=?,take200_at=?,runner_high=?,highest_price=?,lowest_price=? WHERE id=?`)
            .bind(remaining,locked,sell.fill,now.toISOString(),high,high,low,p.id),
          env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
            .bind(proceeds,partialPnl,now.toISOString(),p.account_id),
          env.MEDS_DB.prepare(`INSERT INTO hunt_account_events(account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
            VALUES(?,?,?,?,?,?,?,?,?,?)`)
            .bind(p.account_id,p.id,p.symbol,now.toISOString(),'TAKE_200',sell.fill,takeQty,partialPnl,
              JSON.stringify({fraction:HUNT_TAKE_FRACTION,remaining_qty:remaining,runner_fraction:HUNT_RUNNER_FRACTION,
                slippage_pct:sell.slipPct,observed_bid:bid,high}),positionVersion)
        ]);
        take200s++;
      }
      continue;
    }

    if(Number(p.take200_done)){
      const runnerHigh=Math.max(Number(p.runner_high??p.highest_price??mid),high);
      const runnerAgeMin=p.take200_at?Math.max(0,(now.getTime()-Date.parse(p.take200_at))/60000):0;
      const retrace=runnerHigh>0?1-bid/runnerHigh:0;
      const peakExit=retrace>=HUNT_RUNNER_TRAIL_PCT;
      const runnerTimeout=runnerAgeMin>=HUNT_RUNNER_MAX_HOLD_MIN;
      if(!peakExit&&!runnerTimeout){
        deferredMarks.push(env.MEDS_DB.prepare("UPDATE hunt_account_positions SET highest_price=?,lowest_price=?,runner_high=? WHERE id=?")
          .bind(high,low,runnerHigh,p.id));
        continue;
      }
      const sell=modeledSell(remaining);
      const proceeds=sell.fill*remaining;
      const runnerPnl=(sell.fill-Number(p.entry_price))*remaining;
      const totalPnl=locked+runnerPnl;
      const ret=Number(p.entry_notional)>0?totalPnl/Number(p.entry_notional)*100:0;
      const mfe=(high/Number(p.entry_price)-1)*100;
      const mae=(low/Number(p.entry_price)-1)*100;
      const peakGap=runnerHigh>0?(runnerHigh-sell.fill)/runnerHigh*100:0;
      const reason=peakExit?'runner_peak_retrace':'runner_time';
      await env.MEDS_DB.batch([
        env.MEDS_DB.prepare("UPDATE hunt_account_positions SET status='closed',remaining_qty=0,highest_price=?,lowest_price=?,runner_high=? WHERE id=?")
          .bind(high,low,runnerHigh,p.id),
        env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
          .bind(proceeds,runnerPnl,now.toISOString(),p.account_id),
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_trades(account_id,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(p.account_id,p.symbol,p.opened_at,now.toISOString(),p.entry_price,sell.fill,p.quantity,p.entry_notional,
            Number(p.entry_notional)+totalPnl,totalPnl,ret,mfe,mae,ageMin,reason,p.entry_score,p.entry_day_change_pct,p.opened_phase,
            p.features,positionVersion,1,p.take200_price,remaining,peakGap),
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_events(account_id,position_id,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .bind(p.account_id,p.id,p.symbol,now.toISOString(),'RUNNER_EXIT',sell.fill,remaining,runnerPnl,
            JSON.stringify({reason,runner_high:runnerHigh,peak_gap_pct:peakGap,retrace,slippage_pct:sell.slipPct}),positionVersion)
      ]);
      exits++;
      continue;
    }

    const stop=bid<=Number(p.stop_price);
    const timeExit=ageMin>=HUNT_MAX_HOLD_MIN;
    if(!stop&&!timeExit){
      deferredMarks.push(env.MEDS_DB.prepare("UPDATE hunt_account_positions SET highest_price=?,lowest_price=? WHERE id=?").bind(high,low,p.id));
      continue;
    }
    const reason=stop?'stop':'time';
    const sell=modeledSell(remaining);
    const proceeds=sell.fill*remaining;
    const finalPnl=(sell.fill-Number(p.entry_price))*remaining;
    const totalPnl=locked+finalPnl;
    const ret=Number(p.entry_notional)>0?totalPnl/Number(p.entry_notional)*100:0;
    const mfe=(high/Number(p.entry_price)-1)*100;
    const mae=(low/Number(p.entry_price)-1)*100;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare("UPDATE hunt_account_positions SET status='closed',remaining_qty=0,highest_price=?,lowest_price=? WHERE id=?").bind(high,low,p.id),
      env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
        .bind(proceeds,finalPnl,now.toISOString(),p.account_id),
      env.MEDS_DB.prepare(`INSERT INTO hunt_account_trades(account_id,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.account_id,p.symbol,p.opened_at,now.toISOString(),p.entry_price,sell.fill,p.quantity,p.entry_notional,
          Number(p.entry_notional)+totalPnl,totalPnl,ret,mfe,mae,ageMin,reason,p.entry_score,p.entry_day_change_pct,p.opened_phase,
          p.features,positionVersion,0,null,0,null)
    ]);
    exits++;
  }
  if(deferredMarks.length) await env.MEDS_DB.batch(deferredMarks);
  if(markAtEnd) await markHuntAccounts(env,snaps,now);
  return {exits,take200s,ladderSells};
}

async function runHuntAccounts(env:PaperEnv,candidates:PaperCandidate[],snaps:Record<string,PaperSnapshot>,now=new Date()){
  const marketPhase=phase(now);
  const optionMarksMap=await fetchHuntOptionMarks(env,now);
  const management=await manageHuntAccountPositions(env,snaps,now,false);
  const optionManagement=await manageHuntOptionPositions(env,optionMarksMap,now);
  const eligible=candidates.filter(leaderHuntEligible).slice(0,HUNT_MAX_NEW_PER_CYCLE);
  let accountEntries=0,signalsEntered=0;
  for(const c of eligible){
    const quote=snaps[c.symbol]?.latestQuote;
    if(!validQuote(quote,now.getTime())) continue;
    let signalUsed=false;
    for(const account of HUNT_ACCOUNTS){
      const row=await env.MEDS_DB.prepare("SELECT * FROM hunt_accounts WHERE account_id=?").bind(account.account_id).first<any>();
      if(!row) continue;
      const openRow=await env.MEDS_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM hunt_account_positions WHERE account_id=? AND status='open')+
        (SELECT COUNT(*) FROM hunt_account_option_positions WHERE account_id=? AND status='open') AS n`)
        .bind(account.account_id,account.account_id).first<any>();
      if(Number(openRow?.n??0)>=HUNT_MAX_OPEN) continue;
      const duplicate=await env.MEDS_DB.prepare("SELECT id FROM hunt_account_positions WHERE account_id=? AND symbol=? AND status='open' LIMIT 1").bind(account.account_id,c.symbol).first<any>();
      if(duplicate) continue;
      const cooldownAfter=new Date(now.getTime()-HUNT_REENTRY_COOLDOWN_MIN*60000).toISOString();
      const recent=await env.MEDS_DB.prepare("SELECT id FROM hunt_account_trades WHERE account_id=? AND symbol=? AND closed_at>=? LIMIT 1").bind(account.account_id,c.symbol,cooldownAfter).first<any>();
      if(recent) continue;

      const cash=Number(row.cash);
      const targetNotional=Math.min(Number(row.starting_equity)*HUNT_POSITION_PCT,cash);
      if(!(targetNotional>0.01)) continue;
      const ask=Number(quote.ap);
      const targetQty=targetNotional/ask;
      const minuteLiquidity=Math.max(1,Number(c.minuteVolume||0));
      const liquidityQty=minuteLiquidity*HUNT_MAX_MINUTE_PARTICIPATION;
      let qty=Math.min(targetQty,liquidityQty);
      if(!(qty>0)) continue;
      let execution=executablePrice(c,'long',qty);
      if(qty*execution.fill>cash){
        qty=cash/execution.fill;
        execution=executablePrice(c,'long',qty);
      }
      const cost=qty*execution.fill;
      if(!(cost>0.01) || cost>cash+1e-8) continue;
      const stop=execution.fill*0.95,target=execution.fill*(1+HUNT_TAKE_RETURN_PCT);
      const features=JSON.stringify({...huntFeatures(c,marketPhase),asset_type:'equity',account:account.label,target_notional:targetNotional,
        actual_notional:cost,quantity:qty,entry_slippage_pct:execution.slipPct,
        capacity_limited:qty+1e-12<targetQty,minute_participation:qty/minuteLiquidity,fractional_paper:true}).slice(0,12000);
      await env.MEDS_DB.batch([
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_positions(account_id,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,entry_score,entry_day_change_pct,opened_phase,features,status,version,remaining_qty,locked_realized_pnl,take200_done)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,0,0)`)
          .bind(account.account_id,c.symbol,now.toISOString(),execution.fill,qty,cost,stop,target,execution.fill,execution.fill,c.score,c.dayChangePct,marketPhase,features,HUNT_VERSION,qty),
        env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash-?,updated_at=? WHERE account_id=?").bind(cost,now.toISOString(),account.account_id)
      ]);
      accountEntries++;signalUsed=true;
    }
    if(signalUsed) signalsEntered++;
  }

  const optionEntries=await enterLeaderHuntOptions(env,eligible,now,optionMarksMap);
  await markHuntAccounts(env,snaps,now,optionMarksMap);
  return {
    exits:management.exits+optionManagement.exits,
    equity_exits:management.exits,option_exits:optionManagement.exits,
    take200s:management.take200s+optionManagement.take200s,
    ladder_sells:management.ladderSells+optionManagement.ladderSells,
    account_entries:accountEntries+optionEntries.account_entries,
    equity_account_entries:accountEntries,option_account_entries:optionEntries.account_entries,
    signals_entered:signalsEntered+optionEntries.signals_entered,
    equity_signals_entered:signalsEntered,option_signals_entered:optionEntries.signals_entered
  };
}
async function runLeaderHunt(env:PaperEnv,candidates:PaperCandidate[],snaps:Record<string,PaperSnapshot>,now=new Date()){
  await ensurePaperSchema(env);
  const marketPhase=phase(now),bucket=bucket5(now);
  const legacyExits=await manageLeaderHuntPositions(env,snaps,now);
  const tracked=candidates.slice(0,HUNT_TRACKED_PER_CYCLE);
  for(const c of tracked){
    const features=JSON.stringify(huntFeatures(c,marketPhase)).slice(0,12000);
    const dayVolumeRatio=c.previousDayVolume>0?c.dayVolume/c.previousDayVolume:0;
    await env.MEDS_DB.prepare(`INSERT OR IGNORE INTO hunt_observations(bucket,created_at,symbol,phase,price,bid,ask,day_change_pct,score,spread_pct,volume_accel,day_volume_ratio,consecutive_hits,catalyst_score,status,features,version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(bucket,now.toISOString(),c.symbol,marketPhase,c.price,c.bid,c.ask,c.dayChangePct,c.score,c.spreadPct,c.volumeAccel,dayVolumeRatio,c.consecutiveHits,c.catalystScore,
        leaderHuntEligible(c) && (c as any).executionFresh===true ? 'ELIGIBLE':'TRACKED',features,HUNT_VERSION).run();
  }
  const accounts=await runHuntAccounts(env,tracked,snaps,now);
  for(const c of tracked.filter(c=>leaderHuntEligible(c) && (c as any).executionFresh===true).slice(0,HUNT_MAX_NEW_PER_CYCLE)){
    await env.MEDS_DB.prepare("UPDATE hunt_observations SET status='ACCOUNT_SAMPLED' WHERE bucket=? AND symbol=?").bind(bucket,c.symbol).run();
  }
  const openRow=await env.MEDS_DB.prepare(`SELECT
    (SELECT COUNT(*) FROM hunt_account_positions WHERE status='open')+
    (SELECT COUNT(*) FROM hunt_account_option_positions WHERE status='open') AS n`).first<any>();
  const open=Number(openRow?.n??0);
  return {version:HUNT_VERSION,tracked:tracked.length,
    research_eligible:tracked.filter(leaderHuntEligible).length,
    eligible:tracked.filter(c=>leaderHuntEligible(c) && (c as any).executionFresh===true).length,
    signals_entered:accounts.signals_entered,equity_signals_entered:accounts.equity_signals_entered,
    option_signals_entered:accounts.option_signals_entered,
    account_entries:accounts.account_entries,equity_account_entries:accounts.equity_account_entries,
    option_account_entries:accounts.option_account_entries,
    exits:accounts.exits,equity_exits:accounts.equity_exits,option_exits:accounts.option_exits,take200s:accounts.take200s,
    ladder_sells:accounts.ladder_sells,legacy_exits:legacyExits,open};
}

async function openCount(env:PaperEnv,ledger:string,lane:string,table='paper_positions'){
  const row=await env.MEDS_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ledger_id=? AND lane=? AND status='open'`).bind(ledger,lane).first<any>();
  return Number(row?.n??0);
}
async function hasOpen(env:PaperEnv,ledger:string,lane:string,symbol:string,strategy:string){
  const r=await env.MEDS_DB.prepare(`SELECT id FROM paper_positions WHERE ledger_id=? AND symbol=? AND status='open' LIMIT 1`).bind(ledger,symbol).first<any>();
  return !!r;
}

type PaperContext = {stocks:Record<string,PaperSnapshot>; options:Record<string,OptionSnap>};
function spreadWidth(p:any):number|null {
  if(!p.short_symbol) return null;
  const l=parseOcc(p.long_symbol), r=parseOcc(p.short_symbol);
  if(!l||!r||l.root!==r.root||l.expiration!==r.expiration||l.type!==r.type) return NaN;
  return Math.abs(l.strike-r.strike);
}
function entryVersion(notes:string|null):string {
  try{return JSON.parse(notes??'').simulator_version??'legacy-untrusted';}catch{return 'legacy-untrusted';}
}
async function valueLedger(env:PaperEnv,ledger:Ledger,ctx:PaperContext){
  const revision=Number((await env.MEDS_DB.prepare('SELECT revision FROM paper_account_revisions WHERE ledger_id=?').bind(ledger.ledger_id).first<any>())?.revision??-1);
  const cash=await env.MEDS_DB.prepare('SELECT cash FROM paper_ledgers WHERE ledger_id=?').bind(ledger.ledger_id).first<any>();
  let equity=Number(cash?.cash); const warnings:string[]=[];const exposures:Exposure[]=[];
  if(!Number.isFinite(equity)) warnings.push('invalid cash');
  const equities=await env.MEDS_DB.prepare("SELECT * FROM paper_positions WHERE ledger_id=? AND status='open'").bind(ledger.ledger_id).all<any>();
  for(const p of equities.results??[]){
    const q=ctx.stocks[p.symbol]?.latestQuote;
    if(!validQuote(q)){warnings.push('equity quote unavailable/stale: '+p.symbol);continue;}
    const mark=p.direction==='long'?q.bp:q.ap;
    const pnl=(p.direction==='long'?mark-p.entry_price:p.entry_price-mark)*p.quantity;
    equity+=(p.direction==='long'?1:-1)*mark*p.quantity;
    exposures.push({underlying:p.symbol,risk:Math.max(Number(p.initial_risk),Math.abs(mark-p.stop_price)*p.quantity),notional:mark*p.quantity,unrealized:pnl});
  }
  const options=await env.MEDS_DB.prepare("SELECT * FROM paper_option_positions WHERE ledger_id=? AND status='open'").bind(ledger.ledger_id).all<any>();
  for(const p of options.results??[]){
    const mark=optionQuote(ctx.options[p.long_symbol]?.latestQuote,ctx.options[p.short_symbol]?.latestQuote,spreadWidth(p));
    if(!mark){warnings.push('option quote unavailable/stale/invalid: '+p.long_symbol);continue;}
    equity+=mark.liquidation*100*p.quantity;
    exposures.push({underlying:p.underlying,risk:Number(p.initial_risk),notional:p.entry_debit*100*p.quantity,unrealized:(mark.liquidation-p.entry_debit)*100*p.quantity});
  }
  const finalRevision=Number((await env.MEDS_DB.prepare('SELECT revision FROM paper_account_revisions WHERE ledger_id=?').bind(ledger.ledger_id).first<any>())?.revision??-1);
  if(revision<0 || revision!==finalRevision) warnings.push('portfolio changed during valuation');
  return {complete:warnings.length===0,equity:warnings.length?null:equity,warnings,exposures,revision};
}
async function markLedger(env:PaperEnv,ledger:Ledger,ctx:PaperContext){
  const v=await valueLedger(env,ledger,ctx);
  const statements=[env.MEDS_DB.prepare('INSERT INTO paper_valuations(ledger_id,created_at,equity,complete,diagnostics,exposures,simulator_version) VALUES(?,?,?,?,?,?,?)')
    .bind(ledger.ledger_id,new Date().toISOString(),v.equity,v.complete?1:0,JSON.stringify(v.warnings),JSON.stringify(v.exposures),SIM_VERSION)];
  if(v.complete && v.equity!==null) statements.push(env.MEDS_DB.prepare(`INSERT INTO paper_metric_epochs(ledger_id,simulator_version,max_equity,max_drawdown_pct) VALUES(?,?,?,0)
    ON CONFLICT(ledger_id,simulator_version) DO UPDATE SET
    max_drawdown_pct=MAX(max_drawdown_pct,CASE WHEN MAX(max_equity,excluded.max_equity)>0 THEN 1-excluded.max_equity/MAX(max_equity,excluded.max_equity) ELSE 0 END),
    max_equity=MAX(max_equity,excluded.max_equity)`).bind(ledger.ledger_id,SIM_VERSION,v.equity));
  // Legacy paper_ledgers.max_drawdown_pct/max_equity stay frozen and flagged.
  await env.MEDS_DB.batch(statements);
  return v;
}

async function manageEquityPositions(env:PaperEnv,snaps:Record<string,PaperSnapshot>){
  const rows=await env.MEDS_DB.prepare(`SELECT * FROM paper_positions WHERE status='open' ORDER BY id`).all<any>();
  let exits=0;
  for(const p of rows.results??[]){
    const s=snaps[p.symbol]; if(!s) continue;
    const bid=s.latestQuote?.bp??0, ask=s.latestQuote?.ap??0;
    if(!validQuote(s.latestQuote)) continue;
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
    const triggerPrice=stopHit?Number(p.stop_price):targetHit?Number(p.target_price):mark;
    const execution=equityExit(s.latestQuote!,p.direction,triggerPrice,p.quantity)!;
    const exitFill=execution.modeled_fill;
    const exitSlip=execution.slippage_total;
    const pnl=p.direction==='long'
      ? (exitFill-p.entry_price)*p.quantity
      : (p.entry_price-exitFill)*p.quantity;
    const ret=p.entry_price>0?pnl/(p.entry_price*p.quantity):0;
    const rMult=p.initial_risk>0?pnl/p.initial_risk:0;
    const mfe=p.direction==='long'?(hi-p.entry_price)/p.entry_price:(p.entry_price-lo)/p.entry_price;
    const mae=p.direction==='long'?(lo-p.entry_price)/p.entry_price:(p.entry_price-hi)/p.entry_price;
    const reward=rMult - Math.abs(ret)*0.15 - (p.entry_slippage_cost+exitSlip)/Math.max(0.01,p.initial_risk)*0.15;
    const cashDelta=p.direction==='long'?exitFill*p.quantity:-exitFill*p.quantity;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`UPDATE paper_positions SET status='closed',highest_price=?,lowest_price=? WHERE id=?`).bind(hi,lo,p.id),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE ledger_id=?`).bind(cashDelta,pnl,new Date().toISOString(),p.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.ledger_id,p.lane,'equity',p.symbol,p.strategy,p.direction,p.opened_at,new Date().toISOString(),p.quantity,p.entry_price,exitFill,pnl,ret*100,rMult,reward,mfe*100,mae*100,p.entry_slippage_cost+exitSlip,exitReason,'market-data',JSON.stringify({original_notes:p.notes??'',execution,simulator_version:SIM_VERSION,entry_version:entryVersion(p.notes)}))
    ]);
    exits++;
  }
  return exits;
}

async function enterEquityProposal(env:PaperEnv,ledger:Ledger,lane:'PRIMARY'|'SHADOW',c:PaperCandidate,p:Proposal,bucket:string,ctx:PaperContext){
  if(p.direction==='short') return {entered:false,reason:'unsupported short: borrow/collateral model unavailable'};
  if(!validQuote(ctx.stocks[c.symbol]?.latestQuote)) return {entered:false,reason:'data quality: stale/missing equity quote'};
  if(!Number.isFinite(c.minuteVolume) || c.minuteVolume<=0) return {entered:false,reason:'data quality: invalid minute liquidity'};
  const policy=LEDGER_POLICY[ledger.ledger_id];
  const maxOpen=lane==='PRIMARY'?policy.primaryMax:policy.shadowMax;
  if(await openCount(env,ledger.ledger_id,lane)>=maxOpen) return {entered:false,reason:'open-position cap'};
  if(await hasOpen(env,ledger.ledger_id,lane,c.symbol,p.strategy)) return {entered:false,reason:'already open'};
  if(lane==='PRIMARY' && p.quality<70) return {entered:false,reason:'soft score threshold'};
  if(lane==='SHADOW' && p.quality<52) return {entered:false,reason:'below exploration threshold'};
  if(!(c.ask>0&&c.bid>0&&c.ask>=c.bid)) return {entered:false,reason:'invalid quote'};
  if(c.spreadPct>(lane==='PRIMARY'?3.0:5.0)) return {entered:false,reason:'spread too wide'};
  const roughEntry=p.direction==='long'?c.ask:c.bid;
  const riskPerShare=Math.max(roughEntry*p.stopPct,roughEntry*0.01)*1.01;
  const valuation=await valueLedger(env,ledger,ctx);
  if(!valuation.complete || valuation.equity===null) return {entered:false,reason:'incomplete ledger valuation'};
  const equity=valuation.equity;
  const capacity=riskCapacity(equity,valuation.exposures,c.symbol);
  if(capacity.risk<=0 || capacity.allocation<=0) return {entered:false,reason:'aggregate ledger/underlying risk or allocation exhausted'};
  const riskCap=Math.min(equity*policy.maxRiskPct,capacity.risk);
  const allocCap=Math.min(equity*policy.maxAllocPct,capacity.allocation);
  const immediateLossPerShare=Math.max(0,roughEntry*1.01-c.bid);
  const byRisk=Math.floor(riskCap/(riskPerShare+immediateLossPerShare*(1+LIMITS.totalRisk)));
  const byAlloc=Math.floor(allocCap/(roughEntry*1.01+immediateLossPerShare*LIMITS.grossAllocation));
  const liquidityCap=Math.max(0,Math.floor(Math.max(0,c.minuteVolume)*(lane==='PRIMARY'?0.02:0.05)));
  // Re-read cash for every proposal. A ledger can make several entries in one
  // decision cycle, so the cycle-start Ledger snapshot is not authoritative.
  const cashRow=await env.MEDS_DB.prepare(`SELECT cash FROM paper_ledgers WHERE ledger_id=?`).bind(ledger.ledger_id).first<any>();
  const availableCash=Math.max(0,Number(cashRow?.cash??0));
  ledger.cash=Number(cashRow?.cash??0);
  const byCash=p.direction==='long'?Math.floor(availableCash/(c.ask*1.01)):Number.MAX_SAFE_INTEGER;
  const qty=Math.max(0,Math.min(byRisk,byAlloc,liquidityCap||0,byCash));
  if(qty<1) return {entered:false,reason:'size/liquidity/whole-share constraint'};
  const {fill,slipPct}=executablePrice(c,p.direction,qty);
  const stop=p.direction==='long'?fill*(1-p.stopPct):fill*(1+p.stopPct);
  const risk=Math.abs(fill-stop)*qty;
  const target=p.direction==='long'?fill+(fill-stop)*p.rewardRisk:fill-(stop-fill)*p.rewardRisk;
  const cost=fill*qty;
  if(risk>riskCap+1e-8 || cost>allocCap+1e-8) return {entered:false,reason:'aggregate risk/allocation limit'};
  if(p.direction==='long' && cost>availableCash+1e-8) return {entered:false,reason:'cash constraint'};
  const spreadCost=(c.ask-c.bid)*0.5*qty, slipCost=fill*slipPct*qty;
  const cashDelta=p.direction==='long'?-cost:cost;
  await env.MEDS_DB.batch([
    env.MEDS_DB.prepare('INSERT OR REPLACE INTO paper_risk_guards(ledger_id,expected_revision) VALUES(?,?)').bind(ledger.ledger_id,valuation.revision),
    env.MEDS_DB.prepare(`INSERT INTO paper_positions(ledger_id,lane,symbol,direction,strategy,opened_at,entry_price,quantity,stop_price,target_price,initial_risk,entry_spread_cost,entry_slippage_cost,highest_price,lowest_price,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(ledger.ledger_id,lane,c.symbol,p.direction,p.strategy,new Date().toISOString(),fill,qty,stop,target,risk,spreadCost,slipCost,fill,fill,'open',JSON.stringify({reason:p.reason,simulator_version:SIM_VERSION})),
    env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,updated_at=? WHERE ledger_id=?`).bind(cashDelta,new Date().toISOString(),ledger.ledger_id),
    env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(new Date().toISOString(),bucket,ledger.ledger_id,lane,'equity',c.symbol,p.strategy,'ENTER',p.quality,fill,c.spreadPct,p.reason,'market-data')
  ]);
  ledger.cash+=cashDelta;
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


type HuntOptionChoice={
  underlying:string;
  symbol:string;
  direction:'call'|'put';
  quote:OptionSnap;
  strike:number;
  expiration:string;
};

function leaderOptionDirection(c:PaperCandidate):'bull'|'bear'|null{
  let bull=0,bear=0;
  if(c.catalystScore>0) bull+=2;
  if(c.catalystScore<0) bear+=2;
  if(c.dayChangePct>=0.75) bull++;
  if(c.dayChangePct<=-0.75) bear++;
  if(c.volumeAccel>=0.08) bull++;
  if(c.volumeAccel<=-0.08) bear++;
  if(bull===0&&bear===0) return null;
  return bull>=bear?'bull':'bear';
}

async function selectLeaderOption(env:PaperEnv,c:PaperCandidate,now=new Date()):Promise<HuntOptionChoice|null>{
  if(phase(now)!=='regular') return null;
  const direction=leaderOptionDirection(c); if(!direction) return null;
  const chain=await optionChain(env,c,direction);
  const usable=chain.filter(x=>{
    const q=x.s.latestQuote;
    if(!validQuote(q,now.getTime())) return false;
    const bid=Number(q!.bp),ask=Number(q!.ap);
    if(!(ask>0&&bid>0&&ask>=bid)) return false;
    const spread=(ask-bid)/((ask+bid)/2);
    return spread<=0.35 && Number(q!.as??0)>=1;
  });
  usable.sort((a,b)=>{
    const am=Math.abs(a.meta!.strike-c.price)/Math.max(0.01,c.price);
    const bm=Math.abs(b.meta!.strike-c.price)/Math.max(0.01,c.price);
    return am-bm || a.meta!.expiration.localeCompare(b.meta!.expiration);
  });
  const x=usable[0]; if(!x) return null;
  return {underlying:c.symbol,symbol:x.symbol,direction:x.meta!.type as 'call'|'put',quote:x.s,
    strike:x.meta!.strike,expiration:x.meta!.expiration};
}

async function fetchHuntOptionMarks(env:PaperEnv,now=new Date()){
  if(phase(now)!=='regular') return {} as Record<string,OptionSnap>;
  const rows=await env.MEDS_DB.prepare("SELECT DISTINCT symbol FROM hunt_account_option_positions WHERE status='open'").all<{symbol:string}>();
  const symbols=(rows.results??[]).map(x=>x.symbol);
  if(!symbols.length) return {} as Record<string,OptionSnap>;
  try{return await optionMarks(env,symbols);}catch{return {} as Record<string,OptionSnap>;}
}

async function manageHuntOptionPositions(env:PaperEnv,marks:Record<string,OptionSnap>,now=new Date()){
  if(phase(now)!=='regular') return {exits:0,take200s:0,ladderSells:0};
  const rows=await env.MEDS_DB.prepare("SELECT * FROM hunt_account_option_positions WHERE status='open' ORDER BY id").all<any>();
  let exits=0,take200s=0,ladderSells=0;
  for(const p of rows.results??[]){
    const q=marks[p.symbol]?.latestQuote;
    if(!validQuote(q,now.getTime())) continue;
    const bid=Number(q.bp),ask=Number(q.ap),mid=(bid+ask)/2;
    const high=Math.max(Number(p.highest_price),mid),low=Math.min(Number(p.lowest_price),mid);
    const ageMin=Math.max(0,(now.getTime()-Date.parse(p.opened_at))/60000);
    let remaining=Number(p.remaining_qty??p.quantity);
    let locked=Number(p.locked_realized_pnl??0);
    const originalQty=Number(p.quantity);
    const positionVersion=String(p.version??HUNT_VERSION);
    if(!(remaining>0)) continue;
    const modeledSell=(qty:number)=>{
      const fill=Math.max(0,bid*(1-HUNT_OPTION_SLIPPAGE_PCT));
      return {fill,slipPct:HUNT_OPTION_SLIPPAGE_PCT};
    };

    if(!Number(p.take200_done)){
      const priorEvents=await env.MEDS_DB.prepare(
        "SELECT event_type FROM hunt_account_option_events WHERE position_id=? AND event_type LIKE 'LADDER_%'"
      ).bind(p.id).all<any>();
      const done=new Set((priorEvents.results??[]).map((x:any)=>String(x.event_type)));
      for(const rung of HUNT_LADDER){
        if(done.has(rung.event) || bid<Number(p.entry_price)*(1+rung.returnPct)) continue;
        const qty=Math.min(remaining,Math.floor(originalQty*rung.fraction));
        if(!(qty>=1)) continue; // options are whole contracts
        const sell=modeledSell(qty);
        const proceeds=sell.fill*100*qty;
        const partialPnl=(sell.fill-Number(p.entry_price))*100*qty;
        remaining-=qty; locked+=partialPnl;
        await env.MEDS_DB.batch([
          env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET remaining_qty=?,locked_realized_pnl=?,highest_price=?,lowest_price=? WHERE id=?")
            .bind(remaining,locked,high,low,p.id),
          env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
            .bind(proceeds,partialPnl,now.toISOString(),p.account_id),
          env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_events(account_id,position_id,underlying,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(p.account_id,p.id,p.underlying,p.symbol,now.toISOString(),rung.event,sell.fill,qty,partialPnl,
              JSON.stringify({threshold_return_pct:rung.returnPct,fraction:rung.fraction,remaining_qty:remaining,
                slippage_pct:sell.slipPct,observed_bid:bid,data_quality:'indicative'}),positionVersion)
        ]);
        ladderSells++;
      }
    }

    if(!Number(p.take200_done) && bid>=Number(p.entry_price)*(1+HUNT_TAKE_RETURN_PCT)){
      // Do not invent fractional option contracts. A 5% runner is only kept
      // when the original position is large enough for one contract to be <=5%.
      const runnerQty=originalQty>=20?Math.min(remaining,Math.max(1,Math.floor(originalQty*HUNT_RUNNER_FRACTION))):0;
      const takeQty=Math.max(0,remaining-runnerQty);
      if(takeQty>0){
        const sell=modeledSell(takeQty);
        const proceeds=sell.fill*100*takeQty;
        const partialPnl=(sell.fill-Number(p.entry_price))*100*takeQty;
        remaining=runnerQty; locked+=partialPnl;
        const statements:any[]=[
          env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
            .bind(proceeds,partialPnl,now.toISOString(),p.account_id),
          env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_events(account_id,position_id,underlying,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(p.account_id,p.id,p.underlying,p.symbol,now.toISOString(),'TAKE_200',sell.fill,takeQty,partialPnl,
              JSON.stringify({remaining_qty:remaining,runner_quantity:runnerQty,slippage_pct:sell.slipPct,
                observed_bid:bid,data_quality:'indicative'}),positionVersion)
        ];
        if(runnerQty>0){
          statements.unshift(env.MEDS_DB.prepare(`UPDATE hunt_account_option_positions SET remaining_qty=?,locked_realized_pnl=?,
            take200_done=1,take200_price=?,take200_at=?,runner_high=?,highest_price=?,lowest_price=? WHERE id=?`)
            .bind(remaining,locked,sell.fill,now.toISOString(),high,high,low,p.id));
        } else {
          const totalPnl=locked;
          const ret=Number(p.entry_notional)>0?totalPnl/Number(p.entry_notional)*100:0;
          const mfe=(high/Number(p.entry_price)-1)*100,mae=(low/Number(p.entry_price)-1)*100;
          statements.unshift(
            env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET status='closed',remaining_qty=0,locked_realized_pnl=?,take200_done=1,take200_price=?,take200_at=?,highest_price=?,lowest_price=? WHERE id=?")
              .bind(locked,sell.fill,now.toISOString(),high,low,p.id),
            env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_trades(account_id,underlying,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct,data_quality)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
              .bind(p.account_id,p.underlying,p.symbol,p.opened_at,now.toISOString(),p.entry_price,sell.fill,p.quantity,p.entry_notional,
                Number(p.entry_notional)+totalPnl,totalPnl,ret,mfe,mae,ageMin,'take_200',p.entry_score,p.entry_day_change_pct,p.opened_phase,
                p.features,positionVersion,1,sell.fill,0,null,'indicative')
          );
          exits++;
        }
        await env.MEDS_DB.batch(statements);
        take200s++;
      }
      continue;
    }

    if(Number(p.take200_done)){
      const runnerHigh=Math.max(Number(p.runner_high??p.highest_price??mid),high);
      const retrace=runnerHigh>0?1-bid/runnerHigh:0;
      const runnerAgeMin=p.take200_at?Math.max(0,(now.getTime()-Date.parse(p.take200_at))/60000):0;
      const peakExit=retrace>=HUNT_RUNNER_TRAIL_PCT;
      const runnerTimeout=runnerAgeMin>=HUNT_OPTION_MAX_HOLD_MIN;
      if(!peakExit&&!runnerTimeout){
        await env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET highest_price=?,lowest_price=?,runner_high=? WHERE id=?")
          .bind(high,low,runnerHigh,p.id).run();
        continue;
      }
      const sell=modeledSell(remaining);
      const proceeds=sell.fill*100*remaining;
      const runnerPnl=(sell.fill-Number(p.entry_price))*100*remaining;
      const totalPnl=locked+runnerPnl;
      const ret=Number(p.entry_notional)>0?totalPnl/Number(p.entry_notional)*100:0;
      const mfe=(high/Number(p.entry_price)-1)*100,mae=(low/Number(p.entry_price)-1)*100;
      const peakGap=runnerHigh>0?(runnerHigh-sell.fill)/runnerHigh*100:0;
      const reason=peakExit?'runner_peak_retrace':'runner_time';
      await env.MEDS_DB.batch([
        env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET status='closed',remaining_qty=0,highest_price=?,lowest_price=?,runner_high=? WHERE id=?")
          .bind(high,low,runnerHigh,p.id),
        env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
          .bind(proceeds,runnerPnl,now.toISOString(),p.account_id),
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_trades(account_id,underlying,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct,data_quality)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(p.account_id,p.underlying,p.symbol,p.opened_at,now.toISOString(),p.entry_price,sell.fill,p.quantity,p.entry_notional,
            Number(p.entry_notional)+totalPnl,totalPnl,ret,mfe,mae,ageMin,reason,p.entry_score,p.entry_day_change_pct,p.opened_phase,
            p.features,positionVersion,1,p.take200_price,remaining,peakGap,'indicative'),
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_events(account_id,position_id,underlying,symbol,created_at,event_type,price,quantity,realized_pnl,details,version)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(p.account_id,p.id,p.underlying,p.symbol,now.toISOString(),'RUNNER_EXIT',sell.fill,remaining,runnerPnl,
            JSON.stringify({reason,runner_high:runnerHigh,peak_gap_pct:peakGap,retrace,slippage_pct:sell.slipPct,data_quality:'indicative'}),positionVersion)
      ]);
      exits++;
      continue;
    }

    const stop=bid<=Number(p.stop_price);
    const timeExit=ageMin>=HUNT_OPTION_MAX_HOLD_MIN;
    if(!stop&&!timeExit){
      await env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET highest_price=?,lowest_price=? WHERE id=?")
        .bind(high,low,p.id).run();
      continue;
    }
    const reason=stop?'stop':'time';
    const sell=modeledSell(remaining);
    const proceeds=sell.fill*100*remaining;
    const finalPnl=(sell.fill-Number(p.entry_price))*100*remaining;
    const totalPnl=locked+finalPnl;
    const ret=Number(p.entry_notional)>0?totalPnl/Number(p.entry_notional)*100:0;
    const mfe=(high/Number(p.entry_price)-1)*100,mae=(low/Number(p.entry_price)-1)*100;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare("UPDATE hunt_account_option_positions SET status='closed',remaining_qty=0,highest_price=?,lowest_price=? WHERE id=?")
        .bind(high,low,p.id),
      env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE account_id=?")
        .bind(proceeds,finalPnl,now.toISOString(),p.account_id),
      env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_trades(account_id,underlying,symbol,opened_at,closed_at,entry_price,exit_price,quantity,entry_notional,exit_value,realized_pnl,return_pct,mfe_pct,mae_pct,minutes_held,exit_reason,entry_score,entry_day_change_pct,opened_phase,features,version,take200_hit,take200_price,runner_quantity,peak_gap_pct,data_quality)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.account_id,p.underlying,p.symbol,p.opened_at,now.toISOString(),p.entry_price,sell.fill,p.quantity,p.entry_notional,
          Number(p.entry_notional)+totalPnl,totalPnl,ret,mfe,mae,ageMin,reason,p.entry_score,p.entry_day_change_pct,p.opened_phase,
          p.features,positionVersion,0,null,0,null,'indicative')
    ]);
    exits++;
  }
  return {exits,take200s,ladderSells};
}

async function enterLeaderHuntOptions(env:PaperEnv,candidates:PaperCandidate[],now:Date,marks:Record<string,OptionSnap>){
  if(phase(now)!=='regular') return {signals_entered:0,account_entries:0};
  const optionCandidates=candidates
    .filter(c=>leaderHuntEligible(c) && (c as any).executionFresh===true && leaderOptionDirection(c)!==null)
    .slice(0,HUNT_MAX_OPTION_SIGNALS_PER_CYCLE);
  let signalsEntered=0,accountEntries=0;
  for(const c of optionCandidates){
    let choice:HuntOptionChoice|null=null;
    try{choice=await selectLeaderOption(env,c,now);}catch{choice=null;}
    if(!choice) continue;
    marks[choice.symbol]=choice.quote;
    const q=choice.quote.latestQuote!;
    const entryFill=Number(q.ap)*(1+HUNT_OPTION_SLIPPAGE_PCT);
    const displayedAsk=Math.max(0,Math.floor(Number(q.as??0)));
    if(!(entryFill>0) || displayedAsk<1) continue;
    let signalUsed=false;
    for(const account of HUNT_ACCOUNTS){
      const row=await env.MEDS_DB.prepare("SELECT * FROM hunt_accounts WHERE account_id=?").bind(account.account_id).first<any>();
      if(!row) continue;
      const countRow=await env.MEDS_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM hunt_account_positions WHERE account_id=? AND status='open')+
        (SELECT COUNT(*) FROM hunt_account_option_positions WHERE account_id=? AND status='open') AS n`)
        .bind(account.account_id,account.account_id).first<any>();
      if(Number(countRow?.n??0)>=HUNT_MAX_OPEN) continue;
      const duplicate=await env.MEDS_DB.prepare("SELECT id FROM hunt_account_option_positions WHERE account_id=? AND underlying=? AND status='open' LIMIT 1")
        .bind(account.account_id,c.symbol).first<any>();
      if(duplicate) continue;
      const cooldownAfter=new Date(now.getTime()-HUNT_REENTRY_COOLDOWN_MIN*60000).toISOString();
      const recent=await env.MEDS_DB.prepare("SELECT id FROM hunt_account_option_trades WHERE account_id=? AND underlying=? AND closed_at>=? LIMIT 1")
        .bind(account.account_id,c.symbol,cooldownAfter).first<any>();
      if(recent) continue;
      const cash=Number(row.cash);
      const targetNotional=Math.min(Number(row.starting_equity)*HUNT_POSITION_PCT,cash);
      const perContract=entryFill*100;
      let qty=Math.floor(Math.min(targetNotional/perContract,displayedAsk));
      if(qty<1) continue;
      if(qty*perContract>cash) qty=Math.floor(cash/perContract);
      if(qty<1) continue;
      const cost=qty*perContract;
      const stop=entryFill*(1-HUNT_OPTION_STOP_PCT),target=entryFill*(1+HUNT_TAKE_RETURN_PCT);
      const features=JSON.stringify({...huntFeatures(c,phase(now)),asset_type:'option',underlying:c.symbol,
        option_type:choice.direction,strike:choice.strike,expiration:choice.expiration,data_quality:'indicative',
        target_notional:targetNotional,actual_notional:cost,displayed_ask_contracts:displayedAsk,
        entry_slippage_pct:HUNT_OPTION_SLIPPAGE_PCT,whole_contracts:true}).slice(0,12000);
      await env.MEDS_DB.batch([
        env.MEDS_DB.prepare(`INSERT INTO hunt_account_option_positions(account_id,underlying,symbol,opened_at,entry_price,quantity,entry_notional,stop_price,target_price,highest_price,lowest_price,current_mark,current_mark_at,entry_score,entry_day_change_pct,opened_phase,features,status,version,remaining_qty,locked_realized_pnl,take200_done,data_quality)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,0,0,'indicative')`)
          .bind(account.account_id,c.symbol,choice.symbol,now.toISOString(),entryFill,qty,cost,stop,target,entryFill,entryFill,
            entryFill,now.toISOString(),c.score,c.dayChangePct,phase(now),features,HUNT_VERSION,qty),
        env.MEDS_DB.prepare("UPDATE hunt_accounts SET cash=cash-?,updated_at=? WHERE account_id=?")
          .bind(cost,now.toISOString(),account.account_id)
      ]);
      accountEntries++;signalUsed=true;
    }
    if(signalUsed) signalsEntered++;
  }
  return {signals_entered:signalsEntered,account_entries:accountEntries};
}

async function manageOptionPositions(env:PaperEnv,marks:Record<string,OptionSnap>){
  const rows=await env.MEDS_DB.prepare(`SELECT * FROM paper_option_positions WHERE status='open' ORDER BY id`).all<any>();
  const symbols=[...new Set((rows.results??[]).flatMap((p:any)=>[p.long_symbol,p.short_symbol].filter(Boolean)))];
  if(!symbols.length || phase()!=='regular') return 0;
  let exits=0;
  for(const p of rows.results??[]){
    const l=marks[p.long_symbol], sh=p.short_symbol?marks[p.short_symbol]:null;
    const pricing=optionQuote(l?.latestQuote,sh?.latestQuote,spreadWidth(p));
    if(!pricing) continue;
    const mark=pricing.liquidation;
    const hi=Math.max(Number(p.highest_mark),mark),lo=Math.min(Number(p.lowest_mark),mark);
    const age=(Date.now()-Date.parse(p.opened_at))/60000;
    const stop=mark<=p.stop_debit,target=mark>=p.target_debit,timeExit=age>=240;
    if(!stop&&!target&&!timeExit){ await env.MEDS_DB.prepare(`UPDATE paper_option_positions SET highest_mark=?,lowest_mark=?,current_mark=? WHERE id=?`).bind(hi,lo,mark,p.id).run(); continue; }
    const reason=stop?'stop':target?'target':'time';
    const slip=mark*0.0002;
    const fill=Math.max(0,mark-slip);
    const execution={trigger_price:stop?p.stop_debit:target?p.target_debit:mark,
      ...pricing,modeled_fill:fill,slippage_per_unit:slip,slippage_total:slip*100*p.quantity,execution_version:EXEC_VERSION};
    const pnl=(fill-p.entry_debit)*100*p.quantity;
    const ret=p.entry_debit>0?(fill/p.entry_debit-1):0;
    const r=p.initial_risk>0?pnl/p.initial_risk:0;
    const reward=r-0.20; // fixed penalty: free indicative options data is not execution-quality.
    const symbol=p.short_symbol?`${p.long_symbol}/${p.short_symbol}`:p.long_symbol;
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`UPDATE paper_option_positions SET status='closed',highest_mark=?,lowest_mark=?,current_mark=? WHERE id=?`).bind(hi,lo,mark,p.id),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash+?,realized_pnl=realized_pnl+?,updated_at=? WHERE ledger_id=?`).bind(fill*100*p.quantity,pnl,new Date().toISOString(),p.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_trades(ledger_id,lane,asset_type,symbol,strategy,direction,opened_at,closed_at,quantity,entry_price,exit_price,realized_pnl,return_pct,r_multiple,reward_score,max_favorable_excursion,max_adverse_excursion,slippage_cost,exit_reason,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(p.ledger_id,'SHADOW','option',symbol,p.strategy,'long',p.opened_at,new Date().toISOString(),p.quantity,p.entry_debit,fill,pnl,ret*100,r,reward,(hi/p.entry_debit-1)*100,(lo/p.entry_debit-1)*100,execution.slippage_total,reason,'indicative',JSON.stringify({original_notes:p.notes??'',execution,simulator_version:SIM_VERSION,entry_version:entryVersion(p.notes)}))
    ]); exits++;
  }
  return exits;
}

async function enterOptionsForCandidate(env:PaperEnv,ledger:Ledger,c:PaperCandidate,bucket:string,ctx:PaperContext){
  const reject=async(reason:string,strategy='option_candidate')=>{
    await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','option',c.symbol,strategy,'REJECTED_HARD',c.score,c.price,null,reason,'indicative').run();
    return 0;
  };
  if(phase()!=='regular') return 0;
  const bullish=c.catalystScore>0 || (c.dayChangePct>1&&c.volumeAccel>0);
  const bearish=c.catalystScore<0 || (c.dayChangePct<-2&&c.volumeAccel>0);
  if(!bullish&&!bearish) return reject('no directional underlying setup');
  const dir=bullish&&!bearish?'bull':bearish&&!bullish?'bear':c.score>=70?'bull':'bear';
  if(!proposals(c,phase()).some(p=>p.direction===(dir==='bull'?'long':'short'))) return reject('no valid underlying setup');
  if(!validQuote(ctx.stocks[c.symbol]?.latestQuote)) return reject('data quality: underlying quote unavailable/stale');
  const chain=await optionChain(env,c,dir); if(!chain.length) return reject('data quality: no valid option quotes');
  for(const x of chain) ctx.options[x.symbol]=x.s;
  chain.sort((a,b)=>Math.abs((a.meta!.strike)-c.price)-Math.abs((b.meta!.strike)-c.price) || a.meta!.expiration.localeCompare(b.meta!.expiration));
  const long=chain[0]; const longAsk=long.s.latestQuote!.ap!, longBid=long.s.latestQuote!.bp!;
  if(!validQuote(long.s.latestQuote) || (longAsk-longBid)/((longAsk+longBid)/2)>0.35) return reject('data quality: long quote stale/invalid/wide');
  const sameExp=chain.filter(x=>x.meta!.expiration===long.meta!.expiration).sort((a,b)=>a.meta!.strike-b.meta!.strike);
  const shortCandidates=dir==='bull'?sameExp.filter(x=>x.meta!.strike>long.meta!.strike):sameExp.filter(x=>x.meta!.strike<long.meta!.strike).reverse();
  const short=shortCandidates[0];
  const existing=await env.MEDS_DB.prepare(`SELECT COUNT(*) AS n FROM paper_option_positions WHERE ledger_id=? AND underlying=? AND status='open'`).bind(ledger.ledger_id,c.symbol).first<any>();
  if(Number(existing?.n??0)>=2) return reject('underlying option position cap');
  const policy=LEDGER_POLICY[ledger.ledger_id]; let entries=0;
  const strategies:{strategy:string,longSym:string,shortSym?:string,debit:number}[]=[{strategy:dir==='bull'?'long_call':'long_put',longSym:long.symbol,debit:longAsk}];
  if(short){ const shortBid=short.s.latestQuote?.bp??0; const debit=longAsk-shortBid; if(debit>0.02) strategies.push({strategy:dir==='bull'?'call_debit_spread':'put_debit_spread',longSym:long.symbol,shortSym:short.symbol,debit}); }
  for(const st of strategies.slice(0,2)){
    const pricing=optionQuote(long.s.latestQuote,st.shortSym?short?.s.latestQuote:undefined,st.shortSym?Math.abs(long.meta!.strike-short!.meta!.strike):null);
    if(!pricing || pricing.friction>LIMITS.optionFriction){await reject('data quality: invalid legs/debit/width or excessive combined friction',st.strategy);continue;}
    if(!Number.isFinite(long.s.latestQuote?.as) || Number(long.s.latestQuote?.as)<1 || (st.shortSym && (!Number.isFinite(short?.s.latestQuote?.bs) || Number(short?.s.latestQuote?.bs)<1))){await reject('data quality: missing executable option size',st.strategy);continue;}
    const duplicate=await env.MEDS_DB.prepare("SELECT id FROM paper_option_positions WHERE ledger_id=? AND long_symbol=? AND COALESCE(short_symbol,'')=? AND status='open' LIMIT 1").bind(ledger.ledger_id,st.longSym,st.shortSym??'').first();
    if(duplicate){await reject('duplicate option structure',st.strategy);continue;}
    const valuation=await valueLedger(env,ledger,ctx);
    if(!valuation.complete || valuation.equity===null){await reject('incomplete ledger valuation',st.strategy);continue;}
    const eq=valuation.equity, capacity=riskCapacity(eq,valuation.exposures,c.symbol);
    st.debit=pricing.entry;
    const cashRow=await env.MEDS_DB.prepare(`SELECT cash FROM paper_ledgers WHERE ledger_id=?`).bind(ledger.ledger_id).first<any>();
    const availableCash=Math.max(0,Number(cashRow?.cash??0));
    ledger.cash=Number(cashRow?.cash??0);
    const riskPer=st.debit*100;
    const immediateLoss=Math.max(0,st.debit-pricing.liquidation)*100;
    const qty=Math.floor(Math.min(eq*policy.maxRiskPct/riskPer,eq*policy.maxAllocPct/riskPer,capacity.risk/(riskPer+immediateLoss*(1+LIMITS.totalRisk)),capacity.allocation/(riskPer+immediateLoss*LIMITS.grossAllocation),availableCash/riskPer,Math.max(0,Number(long.s.latestQuote?.as??0)),st.shortSym?Math.max(0,Number(short?.s.latestQuote?.bs??0)):Number.MAX_SAFE_INTEGER));
    if(qty<1){
      await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','option',c.symbol,st.strategy,'REJECTED_SIZE',c.score,st.debit,null,'premium/risk exceeds ledger constraints','indicative').run();
      continue;
    }
    const risk=riskPer*qty; const target=st.debit*1.50, stop=Math.max(0.01,st.debit*0.60);
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare('INSERT OR REPLACE INTO paper_risk_guards(ledger_id,expected_revision) VALUES(?,?)').bind(ledger.ledger_id,valuation.revision),
      env.MEDS_DB.prepare(`INSERT INTO paper_option_positions(ledger_id,lane,underlying,strategy,opened_at,long_symbol,short_symbol,quantity,entry_debit,stop_debit,target_debit,initial_risk,highest_mark,lowest_mark,current_mark,status,data_quality,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(ledger.ledger_id,'SHADOW',c.symbol,st.strategy,new Date().toISOString(),st.longSym,st.shortSym??null,qty,st.debit,stop,target,risk,st.debit,st.debit,st.debit,'open','indicative',JSON.stringify({quality:'Free Alpaca indicative feed; research-only, not live-quality execution',simulator_version:SIM_VERSION,entry_quotes:pricing})),
      env.MEDS_DB.prepare(`UPDATE paper_ledgers SET cash=cash-?,updated_at=? WHERE ledger_id=?`).bind(riskPer*qty,new Date().toISOString(),ledger.ledger_id),
      env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','option',c.symbol,st.strategy,'ENTER',c.score,st.debit,null,'directional option research from underlying signal','indicative')
    ]); ledger.cash=availableCash-riskPer*qty; entries++;
  }
  return entries;
}

const PAPER_CYCLE_RETRY_MS=60_000;
const PAPER_CYCLE_STALE_MS=7*60_000;

async function runPaperLab(env:PaperEnv,candidates:PaperCandidate[],snaps:Record<string,PaperSnapshot>){
  if(env.PAPER_ENABLED==='false') return {ok:true,skipped:'paper disabled'};
  await ensurePaperSchema(env);
  const heldOptions=await env.MEDS_DB.prepare("SELECT long_symbol,short_symbol FROM paper_option_positions WHERE status='open'").all<any>();
  const optionSymbols=[...new Set((heldOptions.results??[]).flatMap((p:any)=>[p.long_symbol,p.short_symbol].filter(Boolean)))] as string[];
  let optionData:Record<string,OptionSnap>={};
  try {if(optionSymbols.length) optionData=await optionMarks(env,optionSymbols);} catch { /* incomplete valuation blocks entries; equity exits continue */ }
  const ctx:PaperContext={stocks:snaps,options:optionData};
  const equityExits=await manageEquityPositions(env,snaps);
  const optionExits=await manageOptionPositions(env,optionData);
  const ledgers=(await env.MEDS_DB.prepare(`SELECT * FROM paper_ledgers ORDER BY ledger_id`).all<Ledger>()).results??[];
  for(const l of ledgers) await markLedger(env,l,ctx);
  if(!paperDecisionBoundary()) return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false};

  const now=new Date();
  const bucket=bucket5(now);
  const existing=await env.MEDS_DB.prepare(`SELECT started_at,completed_at FROM paper_cycles WHERE bucket=?`).bind(bucket).first<any>();
  if(existing?.completed_at) return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false,duplicate:true};

  const latestComplete=await env.MEDS_DB.prepare(`SELECT completed_at FROM paper_cycles WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`).first<any>();
  const latestCompleteMs=latestComplete?.completed_at?Date.parse(latestComplete.completed_at):0;
  const watchdogForced=!latestCompleteMs || now.getTime()-latestCompleteMs>PAPER_CYCLE_STALE_MS;
  if(existing?.started_at && now.getTime()-Date.parse(existing.started_at)<PAPER_CYCLE_RETRY_MS){
    return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false,inProgress:true,watchdogForced};
  }

  const retryBefore=new Date(now.getTime()-PAPER_CYCLE_RETRY_MS).toISOString();
  const claim=await env.MEDS_DB.prepare(`
    INSERT INTO paper_cycles(bucket,started_at,completed_at,candidates_evaluated,entries,exits,option_entries,notes)
    VALUES(?,?,NULL,0,0,0,0,?)
    ON CONFLICT(bucket) DO UPDATE SET
      started_at=excluded.started_at,
      completed_at=NULL,
      candidates_evaluated=0,
      entries=0,
      exits=0,
      option_entries=0,
      notes='retrying incomplete cycle'
      ,simulator_version='phase1-v1',execution_version='observed-side-v1'
    WHERE paper_cycles.completed_at IS NULL AND paper_cycles.started_at<=?
  `).bind(bucket,now.toISOString(),watchdogForced?'running: watchdog recovery':'running',retryBefore).run();
  if(!claim.meta.changes) return {ok:true,managed:true,equityExits,optionExits,decisionCycle:false,inProgress:true,watchdogForced};

  try {
    let entries=0,optionEntries=0,evaluated=0;
    const marketPhase=phase(now);
    for(const ledger of ledgers){
      const ledgerEntriesBefore=entries;
      const ledgerOptionEntriesBefore=optionEntries;
      for(const c of candidates.slice(0,6)){
        const ps=proposals(c,marketPhase);
        if(!ps.length){
          await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','equity',c.symbol,'none','NO_SETUP',c.score,c.price,c.spreadPct,'no strategy rule matched','market-data').run();
          evaluated++; continue;
        }
        for(const p of ps.slice(0,2)){
          for(const lane of ['PRIMARY','SHADOW'] as const){
            const r=await enterEquityProposal(env,ledger,lane,c,p,bucket,ctx); evaluated++;
            if(r.entered) entries++;
            else await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,lane,'equity',c.symbol,p.strategy,(r.reason==='soft score threshold'||r.reason==='below exploration threshold')?'REJECTED_SOFT':'REJECTED_HARD',p.quality,c.price,c.spreadPct,r.reason,'market-data').run();
          }
        }
      }
      // Free option data is indicative, so options remain shadow/research-only.
      for(const c of candidates.slice(0,2)) optionEntries+=await enterOptionsForCandidate(env,ledger,c,bucket,ctx);
      if(entries===ledgerEntriesBefore && optionEntries===ledgerOptionEntriesBefore){
        await env.MEDS_DB.prepare(`INSERT INTO paper_decisions(created_at,bucket,ledger_id,lane,asset_type,symbol,strategy,decision,score,reference_price,spread_pct,reason,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(new Date().toISOString(),bucket,ledger.ledger_id,'SHADOW','equity','MARKET','none','NO_TRADE',null,null,null,'fresh five-minute scan completed; no new entry met strategy and risk constraints','market-data').run();
      }
    }
    for(const ledger of ledgers) await markLedger(env,ledger,ctx);
    await env.MEDS_DB.prepare(`UPDATE paper_cycles SET completed_at=?,candidates_evaluated=?,entries=?,exits=?,option_entries=?,notes=? WHERE bucket=?`).bind(new Date().toISOString(),evaluated,entries,equityExits+optionExits,optionEntries,`complete; phase=${marketPhase}; options=indicative-research-only; watchdog=${watchdogForced}`,bucket).run();
    return {ok:true,decisionCycle:true,bucket,marketPhase,evaluated,entries,optionEntries,equityExits,optionExits,watchdogForced};
  } catch(error){
    const message=error instanceof Error?error.message:String(error);
    await env.MEDS_DB.prepare(`UPDATE paper_cycles SET completed_at=NULL,notes=? WHERE bucket=?`).bind(`incomplete: ${message}`.slice(0,500),bucket).run();
    throw error;
  }
}


async function scanTick(env: Env) {
  if (!inScanWindow()) return { ok: true, skipped: "outside scan window" };
  const coreMinPrice = num(env.MIN_PRICE, 0.5);
  const minPrice = Math.min(coreMinPrice,HUNT_MIN_STOCK_PRICE);
  const maxPrice = Math.max(num(env.MAX_PRICE, 20), 500);
  const maxChange = num(env.MAX_DAY_CHANGE_PCT, 25);
  const threshold = num(env.MIN_SIGNAL_SCORE, 67);

  await ensurePaperSchema(env);
  const discovered = await discoverSymbols(env);
  const paperHeld=await env.MEDS_DB.prepare("SELECT symbol FROM paper_positions WHERE status='open' UNION SELECT underlying AS symbol FROM paper_option_positions WHERE status='open'").all<{symbol:string}>();
  const held = await env.MEDS_DB.prepare(`SELECT symbol FROM shadow_positions WHERE status='open'`).all<{symbol:string}>();
  const huntHeld=await env.MEDS_DB.prepare(`SELECT DISTINCT symbol FROM hunt_account_positions WHERE status='open'
    UNION SELECT DISTINCT symbol FROM hunt_positions WHERE status='open'
    UNION SELECT DISTINCT underlying AS symbol FROM hunt_account_option_positions WHERE status='open'`).all<{symbol:string}>();
  const huntRecent=await env.MEDS_DB.prepare(`SELECT symbol,MAX(created_at) AS last_seen
    FROM hunt_observations WHERE created_at>=? GROUP BY symbol ORDER BY last_seen DESC LIMIT 80`)
    .bind(new Date(Date.now()-12*60*60000).toISOString()).all<{symbol:string}>();
  const symbols = [...new Set([
    ...(paperHeld.results??[]).map(p=>p.symbol),
    ...(held.results ?? []).map(p=>p.symbol),
    ...(huntHeld.results??[]).map(p=>p.symbol),
    ...(huntRecent.results??[]).map(p=>p.symbol),
    ...discovered
  ])].slice(0,240);
  const prior = await env.MEDS_DB.prepare(`SELECT * FROM symbol_state WHERE last_seen_at >= ?`).bind(new Date(Date.now()-12*60*60000).toISOString()).all<any>();
  const priorMap = new Map((prior.results ?? []).map(p=>[p.symbol,p]));
  const snapshots = await fetchSnapshots(env, symbols);
  await manageShadowPositions(env, snapshots);

  const rough: Candidate[] = [];
  for (const symbol of symbols) {
    const s = snapshots[symbol];
    const marketPhase=phase();
    const extended=marketPhase!=='regular';
    const researchAgeMs=extended ? 20*60_000 : 5*60_000;
    const rawBid = s?.latestQuote?.bp ?? 0;
    const rawAsk = s?.latestQuote?.ap ?? 0;
    const quoteAt=Date.parse(s?.latestQuote?.t??'');
    const quoteAgeMs=Number.isFinite(quoteAt)?Math.max(0,Date.now()-quoteAt):Infinity;
    const quoteResearchFresh=freshTimestamp(s?.latestQuote?.t,researchAgeMs) && rawBid>0 && rawAsk>=rawBid;
    const tradeResearchFresh=freshTimestamp(s?.latestTrade?.t,researchAgeMs) && Number(s?.latestTrade?.p)>0;
    const minuteResearchFresh=freshTimestamp(s?.minuteBar?.t,researchAgeMs) && Number(s?.minuteBar?.c)>0;
    const executionFresh=validQuote(s?.latestQuote);

    let price=0;
    if(quoteResearchFresh) price=(rawBid+rawAsk)/2;
    else if(tradeResearchFresh) price=Number(s?.latestTrade?.p);
    else if(minuteResearchFresh) price=Number(s?.minuteBar?.c);
    else continue;

    if (!price || price < minPrice || price > maxPrice) continue;
    const bid=quoteResearchFresh?rawBid:price;
    const ask=quoteResearchFresh?rawAsk:price;
    const prevClose = s?.prevDailyBar?.c ?? 0;
    // A missing/stale quote is still useful for research continuity when a
    // fresh trade/bar exists, but it must never look executable.
    const spreadPct = quoteResearchFresh ? ((rawAsk - rawBid) / ((rawAsk + rawBid)/2)) * 100 : 99;
    const dayChangePct = prevClose > 0 ? (price / prevClose - 1) * 100 : 0;
    if (dayChangePct > maxChange + 20 || dayChangePct < -15) continue;
    const previousState = priorMap.get(symbol);
    const state = previousState && easternParts(new Date(previousState.last_seen_at)).date === easternParts().date ? previousState : null;
    const dayVolume = s?.dailyBar?.v ?? 0;
    const priorDayVolume = s?.prevDailyBar?.v ?? 0;
    const minuteVolume = s?.minuteBar?.v ?? 0;
    const priorMinuteVolume = state?.last_minute_volume ?? minuteVolume;
    const volumeAccel = priorMinuteVolume > 0 ? (minuteVolume - priorMinuteVolume) / priorMinuteVolume : 0;
    rough.push({
      symbol, price, bid, ask, spreadPct, dayChangePct, dayVolume, previousDayVolume: priorDayVolume,
      minuteVolume, volumeAccel, consecutiveHits: (state && Date.now()-Date.parse(state.last_seen_at)<150000 ? state.consecutive_hits : 0) + 1,
      catalystScore: 0, catalystSummary: "", score: 0, reasons: [],
      executionFresh, quoteAgeMs
    });
  }

  // Pre-rank the broad discovery set, then deeply enrich a larger research
  // shortlist. CORE still receives only MAX_WATCH_SYMBOLS; Leader Hunt keeps
  // the wider set so we collect examples before names become obvious movers.
  for (const c of rough) scoreCandidate(c, regularSession());
  rough.sort((a,b) => b.score - a.score);
  const research = rough.slice(0,HUNT_TRACKED_PER_CYCLE);
  const news = await fetchNewsForSymbols(env, research.map(x => x.symbol));
  const borrow: Record<string,any> = {}; // No verified free borrow provider configured.

  for (const c of research) {
    const h = heuristicCatalyst(news, c.symbol);
    c.catalystScore = h.score;
    c.catalystSummary = h.summary;
    const bm = borrow[c.symbol] ?? {};
    c.borrowFee = bm.borrow_fee ?? bm.borrowFee;
    c.shortInterestPct = bm.short_interest_pct ?? bm.shortInterestPct;
    c.borrowAvailable = bm.available_shares ?? bm.borrowAvailable;
    scoreCandidate(c, regularSession());
    const status = c.score >= 82 ? "A_PLUS_ARMED" : c.score >= threshold ? "IGNITION_WATCH" : "WATCH";
    await persistCandidate(env, c, status, snapshots[c.symbol]);
  }
  research.sort((a,b)=>b.score-a.score);
  const top = research.filter(c=>c.executionFresh===true && c.price>=coreMinPrice).slice(0, Math.min(8, num(env.MAX_WATCH_SYMBOLS, 8)));
  for (const c of top) {
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

  let hunt:any={version:HUNT_VERSION,skipped:'research unavailable'};
  try { hunt=await runLeaderHunt(env,research,snapshots); }
  catch(error){ hunt={version:HUNT_VERSION,error:error instanceof Error?error.message:'leader hunt failed'}; }

  let paper: any = { ok: true, skipped: "paper unavailable" };
  try {
    paper = await runPaperLab(env, top, snapshots);
  } catch (error) {
    paper = { ok: false, error: error instanceof Error ? error.message : "paper lab failed" };
  }
  return { ok: true, feed: stockFeed(), scanned: symbols.length, shortlisted: top.length, research_shortlist:research.length,
    research_execution_fresh:research.filter(x=>x.executionFresh===true).length,
    hunt_universe_open_symbols:(huntHeld.results??[]).length,
    leaders: top.slice(0,5).map(x => ({symbol:x.symbol,score:x.score,price:x.price})), hunt, paper };
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
  const lockNow=Date.now();
  // Keep the lease longer than a normal scan but shorter than two scheduled
  // cadences. This prevents the one-minute overlap storm that previously
  // amplified slow scans while still allowing watchdog recovery.
  const lockLeaseMs=6*60_000;
  const lastSuccessMs=state.last_success_at?Date.parse(state.last_success_at):0;
  const staleForMs=lastSuccessMs?Math.max(0,lockNow-lastSuccessMs):Infinity;
  const scannerStale=!lastSuccessMs || staleForMs>PAPER_CYCLE_STALE_MS;
  const lockUntil=Number(state.lock_until??0);
  const remainingLeaseMs=lockUntil>lockNow?lockUntil-lockNow:0;
  const inferredLockAgeMs=remainingLeaseMs>0 && remainingLeaseMs<=lockLeaseMs
    ? Math.max(0,lockLeaseMs-remainingLeaseMs) : 0;
  // Recover both legacy long leases and a genuinely wedged current lease.
  // We only force-reclaim a normal six-minute lease when the scanner has been
  // stale for more than two health windows AND that lease is already >2 min
  // old. That avoids normal overlap while preventing a dead invocation from
  // blocking every following cron.
  const deepStale=staleForMs>2*PAPER_CYCLE_STALE_MS;
  const wedgedCurrentLease=lockUntil>lockNow && lockUntil<=lockNow+lockLeaseMs && inferredLockAgeMs>2*60_000;
  if(scannerStale && (lockUntil>lockNow+lockLeaseMs || (deepStale && wedgedCurrentLease))){
    await env.MEDS_DB.prepare(`UPDATE service_state SET lock_owner=NULL,lock_until=NULL,last_error=? WHERE id=1 AND lock_until=?`)
      .bind('watchdog reclaimed stale scan lock',state.lock_until).run();
  }
  const lock = await env.MEDS_DB.prepare(`UPDATE service_state SET lock_owner=?,lock_until=? WHERE id=1 AND (lock_until IS NULL OR lock_until<?)`)
    .bind(owner,lockNow+lockLeaseMs,lockNow).run();
  if (!lock.meta.changes) {
    if(scannerStale) await env.MEDS_DB.prepare(`UPDATE service_state SET last_error=? WHERE id=1`).bind('scan lock active while scanner is stale; watchdog will retry').run();
    return {ok:true,skipped:"scan already running"};
  }
  try {
    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw new Error("Missing Alpaca secrets");
    const result = await scanTick(env);
    await env.MEDS_DB.prepare(`UPDATE service_state SET last_success_at=?,last_result=?,last_error=NULL WHERE id=1`).bind(now,JSON.stringify(result)).run();
    // Bounded cleanup per tick, including outside-hours retention on next active scan.
    await env.MEDS_DB.batch([
      env.MEDS_DB.prepare(`DELETE FROM signals WHERE id IN (SELECT id FROM signals WHERE created_at<? LIMIT 8)`).bind(new Date(Date.now()-7*86400000).toISOString()),
      env.MEDS_DB.prepare(`DELETE FROM alert_delivery WHERE event_key IN (SELECT event_key FROM alert_delivery WHERE created_at<? LIMIT 8)`).bind(new Date(Date.now()-30*86400000).toISOString()),
      env.MEDS_DB.prepare(`DELETE FROM hunt_observations WHERE id IN (SELECT id FROM hunt_observations WHERE created_at<? LIMIT 64)`).bind(new Date(Date.now()-30*86400000).toISOString())
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

function secondsSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : null;
}

const EXPECTED_PAPER_TABLES = [
  "paper_meta", "paper_ledgers", "paper_cycles", "paper_positions",
  "paper_option_positions", "paper_trades", "paper_decisions"
] as const;

async function publicStatus(env: Env): Promise<Response> {
  const now = new Date();
  const activeSession = inScanWindow(now);
  const paperEnabled = env.PAPER_ENABLED !== "false";
  // Status is frequently the first request after a rolling deployment. Apply
  // additive schema upgrades here too so monitoring cannot observe a new
  // Worker with the previous D1 schema while waiting for the next cron tick.
  if(paperEnabled) await ensurePaperSchema(env);
  const state = await env.MEDS_DB.prepare(
    `SELECT paused,last_tick_at,last_success_at,last_source,last_error,last_result FROM service_state WHERE id=1`
  ).first<any>();
  const secondsSinceTick = secondsSince(state?.last_tick_at);
  const secondsSinceSuccess = secondsSince(state?.last_success_at);
  const scannerEnabled = env.SCOUT_ENABLED === "true" && !state?.paused;
  // The production cron runs every five minutes. Allow one full cadence plus
  // recovery slack before declaring scanner telemetry stale.
  const healthFreshSeconds = Math.floor(PAPER_CYCLE_STALE_MS / 1000);
  const scannerHealthy = env.TRADING_MODE === "shadow" && scannerEnabled && !state?.last_error &&
    secondsSinceTick !== null && secondsSinceTick <= healthFreshSeconds &&
    (!activeSession || (secondsSinceSuccess !== null && secondsSinceSuccess <= healthFreshSeconds));

  const scanner = {
    enabled: scannerEnabled,
    healthy: scannerHealthy,
    active_session: activeSession,
    feed: stockFeed(now),
    last_tick_at: state?.last_tick_at ?? null,
    last_success_at: state?.last_success_at ?? null,
    last_error: state?.last_error ?? null,
    seconds_since_tick: secondsSinceTick,
    seconds_since_success: secondsSinceSuccess,
  };

  let paper: Record<string, unknown> = { enabled: paperEnabled, healthy: !paperEnabled };
  let ledgers: Record<string, unknown>[] = [];
  let activity: Record<string, number> = {};
  try {
    const schema = await env.MEDS_DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'paper_%'`
    ).all<{name:string}>();
    const available = new Set((schema.results ?? []).map(row => row.name));
    const missingTables = EXPECTED_PAPER_TABLES.filter(name => !available.has(name));
    if (missingTables.length) throw new Error(`missing tables: ${missingTables.join(", ")}`);

    const [meta, latestCycle, counts, ledgerRows, laneCounts] = await Promise.all([
      env.MEDS_DB.prepare(`SELECT version,initialized_at FROM paper_meta WHERE id=1`).first<any>(),
      env.MEDS_DB.prepare(`SELECT bucket,started_at,completed_at,notes,simulator_version,execution_version FROM paper_cycles ORDER BY bucket DESC LIMIT 1`).first<any>(),
      env.MEDS_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM paper_cycles) AS cycle_count,
        (SELECT COUNT(*) FROM paper_decisions) AS decision_count,
        (SELECT COUNT(*) FROM paper_positions WHERE status='open') +
          (SELECT COUNT(*) FROM paper_option_positions WHERE status='open') AS open_position_count,
        (SELECT COUNT(*) FROM paper_trades) AS closed_trade_count`).first<any>(),
      env.MEDS_DB.prepare(`SELECT l.ledger_id,l.label,l.starting_equity,l.cash,l.realized_pnl,l.max_equity,l.max_drawdown_pct,l.updated_at,
        (SELECT COUNT(*) FROM paper_positions p WHERE p.ledger_id=l.ledger_id AND p.status='open') +
          (SELECT COUNT(*) FROM paper_option_positions o WHERE o.ledger_id=l.ledger_id AND o.status='open') AS open_position_count,
        (SELECT COUNT(*) FROM paper_trades t WHERE t.ledger_id=l.ledger_id) AS closed_trade_count
        FROM paper_ledgers l ORDER BY l.starting_equity`).all<any>(),
      env.MEDS_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM paper_positions WHERE lane='PRIMARY' AND status='open') AS primary_open,
        (SELECT COUNT(*) FROM paper_positions WHERE lane='SHADOW' AND status='open') +
          (SELECT COUNT(*) FROM paper_option_positions WHERE lane='SHADOW' AND status='open') AS shadow_open,
        (SELECT COUNT(*) FROM paper_trades WHERE lane='PRIMARY') AS primary_trades,
        (SELECT COUNT(*) FROM paper_trades WHERE lane='SHADOW') AS shadow_trades,
        (SELECT COUNT(*) FROM paper_decisions WHERE decision='REJECTED_SOFT') AS rejected_soft,
        (SELECT COUNT(*) FROM paper_decisions WHERE decision='REJECTED_HARD') AS rejected_hard`).first<any>(),
    ]);

    const labels = new Set((ledgerRows.results ?? []).map(row => row.label));
    const expectedLabels = ["MICRO", "SMALL", "GROWTH", "SCALE"];
    const missingLedgers = expectedLabels.filter(label => !labels.has(label));
    const lastCycleAt = latestCycle?.completed_at ?? latestCycle?.started_at ?? null;
    const secondsSinceCycle = secondsSince(lastCycleAt);
    let paperError: string | null = null;
    try {
      const result = state?.last_result ? JSON.parse(state.last_result) : null;
      if (result?.paper?.ok === false) paperError = String(result.paper.error ?? "paper cycle failed").slice(0, 300);
    } catch { paperError = "invalid paper result telemetry"; }
    if (!meta) paperError = "paper_meta is not initialized";
    else if (missingLedgers.length) paperError = `missing ledgers: ${missingLedgers.join(", ")}`;
    else if (latestCycle && !latestCycle.completed_at) paperError = "latest paper cycle is incomplete";
    else if (activeSession && (secondsSinceCycle === null || secondsSinceCycle > 600)) paperError = "paper cycle is stale";

    const paperHealthy = !paperEnabled || paperError === null;
    paper = {
      enabled: paperEnabled,
      healthy: paperHealthy,
      schema_version: meta?.version ?? null,
      initialized_at: meta?.initialized_at ?? null,
      last_cycle_at: lastCycleAt,
      last_cycle_simulator_version: latestCycle?.simulator_version??null,
      last_cycle_execution_version: latestCycle?.execution_version??null,
      seconds_since_cycle: secondsSinceCycle,
      cycle_count: Number(counts?.cycle_count ?? 0),
      decision_count: Number(counts?.decision_count ?? 0),
      open_position_count: Number(counts?.open_position_count ?? 0),
      closed_trade_count: Number(counts?.closed_trade_count ?? 0),
      paper_error: paperError,
    };
    ledgers = (ledgerRows.results ?? []).map(row => ({
      id: row.label,
      starting_equity: Number(row.starting_equity),
      cash: Number(row.cash),
      realized_pnl: Number(row.realized_pnl),
      max_equity: Number(row.max_equity),
      max_drawdown_pct: Number(row.max_drawdown_pct),
      open_position_count: Number(row.open_position_count),
      closed_trade_count: Number(row.closed_trade_count),
      updated_at: row.updated_at,
    }));
    activity = Object.fromEntries(Object.entries(laneCounts ?? {}).map(([key,value]) => [key, Number(value)]));
  } catch (error) {
    const message = error instanceof Error ? error.message : "paper telemetry unavailable";
    paper = { enabled: paperEnabled, healthy: false, paper_error: message.slice(0, 300) };
  }

  const paperHealthy = paper.healthy === true;
  const body: Record<string, unknown> = {
    ok: scannerHealthy && paperHealthy,
    service: "MEDS Scout",
    mode: "shadow",
    live_execution: false,
    time: now.toISOString(),
    scanner,
    paper,
    ledgers,
    activity,
  };
  try {
    const since=new Date(Date.now()-86400000).toISOString();
    const h=await env.MEDS_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM hunt_observations WHERE created_at>=?) AS observations_24h,
      (SELECT COUNT(*) FROM hunt_account_positions WHERE status='open') AS equity_open_positions,
      (SELECT COUNT(*) FROM hunt_account_option_positions WHERE status='open') AS option_open_positions,
      (SELECT COUNT(*) FROM hunt_account_trades WHERE closed_at>=?) AS equity_trades_24h,
      (SELECT COUNT(*) FROM hunt_account_option_trades WHERE closed_at>=?) AS option_trades_24h,
      (SELECT COUNT(*) FROM hunt_account_trades WHERE closed_at>=? AND realized_pnl>0) AS equity_winners_24h,
      (SELECT COUNT(*) FROM hunt_account_option_trades WHERE closed_at>=? AND realized_pnl>0) AS option_winners_24h,
      (SELECT MAX(created_at) FROM hunt_observations) AS latest_observation_at,
      (SELECT MAX(closed_at) FROM hunt_account_trades) AS latest_equity_trade_at,
      (SELECT MAX(closed_at) FROM hunt_account_option_trades) AS latest_option_trade_at`)
      .bind(...Array(5).fill(since)).first<any>();
    const combinedReturns=await env.MEDS_DB.prepare(`SELECT return_pct,realized_pnl,closed_at,'equity' AS asset_type FROM hunt_account_trades WHERE closed_at>=?
      UNION ALL
      SELECT return_pct,realized_pnl,closed_at,'option' AS asset_type FROM hunt_account_option_trades WHERE closed_at>=?`)
      .bind(since,since).all<any>();
    const returnRows=combinedReturns.results??[];
    const returns=returnRows.map((x:any)=>Number(x.return_pct)).filter(Number.isFinite);
    const combinedTrades=returnRows.length;
    const combinedWinners=returnRows.filter((x:any)=>Number(x.realized_pnl)>0).length;
    const avgReturn=returns.length?returns.reduce((a:number,b:number)=>a+b,0)/returns.length:null;
    const bestReturn=returns.length?Math.max(...returns):null;
    const worstReturn=returns.length?Math.min(...returns):null;

    let lastScan:any=null;
    try { lastScan=state?.last_result?JSON.parse(state.last_result):null; } catch {}
    const observationAgeSeconds=secondsSince(h?.latest_observation_at??null);
    const lastHunt=lastScan?.hunt??null;
    const lastResearchCount=Number(lastScan?.research_shortlist??0);
    const huntStreamHealthy=!activeSession || (
      observationAgeSeconds!==null && observationAgeSeconds<=15*60 &&
      !lastHunt?.error && lastResearchCount>0
    );
    const huntWarning=huntStreamHealthy?null:
      lastHunt?.error?String(lastHunt.error):
      lastResearchCount<=0?'latest scan produced no Leader Hunt research candidates':
      observationAgeSeconds==null?'Leader Hunt has no recorded observations':
      `Leader Hunt observations stale by ${observationAgeSeconds}s`;
    if(!huntStreamHealthy) body.ok=false;
    const accounts=await env.MEDS_DB.prepare(`SELECT a.account_id,a.label,a.starting_equity,a.cash,a.current_equity,a.realized_pnl,a.max_equity,a.max_drawdown_pct,a.updated_at,
      (SELECT COUNT(*) FROM hunt_account_positions p WHERE p.account_id=a.account_id AND p.status='open') AS equity_open_positions,
      (SELECT COUNT(*) FROM hunt_account_option_positions p WHERE p.account_id=a.account_id AND p.status='open') AS option_open_positions,
      (SELECT COUNT(*) FROM hunt_account_trades t WHERE t.account_id=a.account_id) AS equity_closed_trades,
      (SELECT COUNT(*) FROM hunt_account_option_trades t WHERE t.account_id=a.account_id) AS option_closed_trades,
      (SELECT COUNT(*) FROM hunt_account_trades t WHERE t.account_id=a.account_id AND t.closed_at>=? AND t.realized_pnl>0) AS equity_winners_24h,
      (SELECT COUNT(*) FROM hunt_account_option_trades t WHERE t.account_id=a.account_id AND t.closed_at>=? AND t.realized_pnl>0) AS option_winners_24h,
      (SELECT COUNT(*) FROM hunt_account_trades t WHERE t.account_id=a.account_id AND t.closed_at>=?) AS equity_trades_24h,
      (SELECT COUNT(*) FROM hunt_account_option_trades t WHERE t.account_id=a.account_id AND t.closed_at>=?) AS option_trades_24h
      FROM hunt_accounts a ORDER BY a.starting_equity`).bind(since,since,since,since).all<any>();
    const milestoneRows=await env.MEDS_DB.prepare(`SELECT * FROM hunt_account_milestones ORDER BY account_id,multiple`).all<any>();
    const milestonesByAccount=new Map<string,any[]>();
    for(const row of milestoneRows.results??[]){
      const arr=milestonesByAccount.get(String(row.account_id))??[];
      arr.push(row);milestonesByAccount.set(String(row.account_id),arr);
    }
    const compoundingScoreboard=(accounts.results??[]).map((a:any)=>{
      const starting=Number(a.starting_equity),equity=Number(a.current_equity);
      const currentMultiple=starting>0?equity/starting:0;
      const reached=milestonesByAccount.get(String(a.account_id))??[];
      const byMultiple=new Map(reached.map((x:any)=>[Number(x.multiple),x]));
      const nextMultiple=HUNT_ACCOUNT_MULTIPLES.find(m=>currentMultiple<m)??null;
      return {
        account_id:a.account_id,label:a.label,starting_equity:starting,current_equity:equity,
        current_multiple:currentMultiple,next_multiple:nextMultiple,
        next_target_equity:nextMultiple==null?null:starting*nextMultiple,
        progress_to_next_pct:nextMultiple==null?100:Math.min(100,currentMultiple/nextMultiple*100),
        max_drawdown_pct:Number(a.max_drawdown_pct??0),
        milestone_2x_at:byMultiple.get(2)?.reached_at??null,
        milestone_5x_at:byMultiple.get(5)?.reached_at??null,
        milestone_10x_at:byMultiple.get(10)?.reached_at??null,
        milestone_25x_at:byMultiple.get(25)?.reached_at??null,
        milestone_50x_at:byMultiple.get(50)?.reached_at??null,
        milestone_100x_at:byMultiple.get(100)?.reached_at??null,
      };
    });
    const openSessions=await env.MEDS_DB.prepare(`SELECT phase,
      SUM(open_account_positions) AS open_account_positions,
      SUM(open_signals) AS open_signals,
      CASE WHEN SUM(mark_count)>0 THEN SUM(return_sum)/SUM(mark_count) ELSE NULL END AS avg_open_return_pct
      FROM (
        SELECT p.opened_phase AS phase,COUNT(*) AS open_account_positions,
          COUNT(DISTINCT p.symbol || '|' || p.opened_at) AS open_signals,
          SUM(CASE WHEN s.last_bid>0 THEN (s.last_bid/p.entry_price-1)*100 ELSE 0 END) AS return_sum,
          SUM(CASE WHEN s.last_bid>0 THEN 1 ELSE 0 END) AS mark_count
        FROM hunt_account_positions p LEFT JOIN symbol_state s ON s.symbol=p.symbol
        WHERE p.status='open' GROUP BY p.opened_phase
        UNION ALL
        SELECT p.opened_phase AS phase,COUNT(*) AS open_account_positions,
          COUNT(DISTINCT p.underlying || '|' || p.symbol || '|' || p.opened_at) AS open_signals,
          SUM(CASE WHEN p.current_mark>0 THEN (p.current_mark/p.entry_price-1)*100 ELSE 0 END) AS return_sum,
          SUM(CASE WHEN p.current_mark>0 THEN 1 ELSE 0 END) AS mark_count
        FROM hunt_account_option_positions p WHERE p.status='open' GROUP BY p.opened_phase
      ) GROUP BY phase`).all<any>();
    const closedSessions=await env.MEDS_DB.prepare(`SELECT opened_phase AS phase,
      COUNT(*) AS account_trades_24h,COUNT(DISTINCT signal_key) AS closed_signals_24h,
      SUM(CASE WHEN realized_pnl>0 THEN 1 ELSE 0 END) AS winners_24h,
      AVG(return_pct) AS avg_closed_return_pct,AVG(mfe_pct) AS avg_mfe_pct,AVG(mae_pct) AS avg_mae_pct,
      MAX(return_pct) AS best_return_pct,MIN(return_pct) AS worst_return_pct
      FROM (
        SELECT opened_phase,symbol || '|' || opened_at AS signal_key,realized_pnl,return_pct,mfe_pct,mae_pct
        FROM hunt_account_trades WHERE closed_at>=?
        UNION ALL
        SELECT opened_phase,underlying || '|' || symbol || '|' || opened_at AS signal_key,realized_pnl,return_pct,mfe_pct,mae_pct
        FROM hunt_account_option_trades WHERE closed_at>=?
      ) GROUP BY opened_phase`).bind(since,since).all<any>();
    const assetBreakdown=await env.MEDS_DB.prepare(`SELECT asset_type,
      SUM(open_positions) AS open_positions,SUM(trades_24h) AS trades_24h,SUM(winners_24h) AS winners_24h,
      CASE WHEN SUM(trades_24h)>0 THEN SUM(weighted_return)/SUM(trades_24h) ELSE NULL END AS avg_closed_return_pct
      FROM (
        SELECT 'equity' AS asset_type,
          (SELECT COUNT(*) FROM hunt_account_positions WHERE status='open') AS open_positions,
          (SELECT COUNT(*) FROM hunt_account_trades WHERE closed_at>=?) AS trades_24h,
          (SELECT COUNT(*) FROM hunt_account_trades WHERE closed_at>=? AND realized_pnl>0) AS winners_24h,
          COALESCE((SELECT SUM(return_pct) FROM hunt_account_trades WHERE closed_at>=?),0) AS weighted_return
        UNION ALL
        SELECT 'option',
          (SELECT COUNT(*) FROM hunt_account_option_positions WHERE status='open'),
          (SELECT COUNT(*) FROM hunt_account_option_trades WHERE closed_at>=?),
          (SELECT COUNT(*) FROM hunt_account_option_trades WHERE closed_at>=? AND realized_pnl>0),
          COALESCE((SELECT SUM(return_pct) FROM hunt_account_option_trades WHERE closed_at>=?),0)
      ) GROUP BY asset_type`).bind(since,since,since,since,since,since).all<any>();
    const openByPhase=new Map((openSessions.results??[]).map((x:any)=>[String(x.phase),x]));
    const closedByPhase=new Map((closedSessions.results??[]).map((x:any)=>[String(x.phase),x]));
    const sessionBreakdown=['overnight','premarket','regular','postmarket'].map(phaseName=>{
      const o:any=openByPhase.get(phaseName)??{}, d:any=closedByPhase.get(phaseName)??{};
      const trades=Number(d.account_trades_24h??0), winners=Number(d.winners_24h??0);
      return {
        phase:phaseName,
        open_signals:Number(o.open_signals??0),
        open_account_positions:Number(o.open_account_positions??0),
        avg_open_return_pct:o.avg_open_return_pct==null?null:Number(o.avg_open_return_pct),
        closed_signals_24h:Number(d.closed_signals_24h??0),
        account_trades_24h:trades,
        winners_24h:winners,
        win_rate_24h:trades>0?winners/trades:null,
        avg_closed_return_pct:d.avg_closed_return_pct==null?null:Number(d.avg_closed_return_pct),
        avg_mfe_pct:d.avg_mfe_pct==null?null:Number(d.avg_mfe_pct),
        avg_mae_pct:d.avg_mae_pct==null?null:Number(d.avg_mae_pct),
        best_return_pct:d.best_return_pct==null?null:Number(d.best_return_pct),
        worst_return_pct:d.worst_return_pct==null?null:Number(d.worst_return_pct),
      };
    });
    body.leader_hunt={
      version:HUNT_VERSION,healthy:huntStreamHealthy,warning:huntWarning,
      observation_age_seconds:observationAgeSeconds,
      last_scan_research_shortlist:lastResearchCount,
      last_scan_execution_fresh:Number(lastScan?.research_execution_fresh??0),
      last_scan_hunt_open:Number(lastHunt?.open??0),
      last_scan_hunt_error:lastHunt?.error??null,
      objective:'hunt early asymmetric moves across equities, penny stocks and options',tracked_per_cycle:HUNT_TRACKED_PER_CYCLE,
      assets:['equity','penny_stock','option'],penny_floor:HUNT_MIN_STOCK_PRICE,
      max_option_signals_per_cycle:HUNT_MAX_OPTION_SIGNALS_PER_CYCLE,option_stop_pct:HUNT_OPTION_STOP_PCT,
      option_max_hold_minutes:HUNT_OPTION_MAX_HOLD_MIN,option_data_quality:'indicative/research-only',
      max_new_signals_per_cycle:HUNT_MAX_NEW_PER_CYCLE,max_open_per_account:HUNT_MAX_OPEN,max_hold_minutes:HUNT_MAX_HOLD_MIN,
      runner_max_hold_minutes:HUNT_RUNNER_MAX_HOLD_MIN,position_pct:HUNT_POSITION_PCT,max_minute_participation:HUNT_MAX_MINUTE_PARTICIPATION,
      take_profit_return_pct:HUNT_TAKE_RETURN_PCT,take_profit_fraction:HUNT_TAKE_FRACTION,runner_fraction:HUNT_RUNNER_FRACTION,
      runner_trail_pct:HUNT_RUNNER_TRAIL_PCT,profit_ladder:HUNT_LADDER.map(x=>({return_pct:x.returnPct,fraction:x.fraction})),
      observations_24h:Number(h?.observations_24h??0),
      open_positions:Number(h?.equity_open_positions??0)+Number(h?.option_open_positions??0),
      equity_open_positions:Number(h?.equity_open_positions??0),option_open_positions:Number(h?.option_open_positions??0),
      trades_24h:combinedTrades,winners_24h:combinedWinners,
      win_rate_24h:combinedTrades>0?combinedWinners/combinedTrades:null,
      avg_return_pct_24h:avgReturn,best_return_pct_24h:bestReturn,worst_return_pct_24h:worstReturn,
      latest_observation_at:h?.latest_observation_at??null,
      latest_trade_at:[h?.latest_equity_trade_at,h?.latest_option_trade_at].filter(Boolean).sort().at(-1)??null,
      accounts:(accounts.results??[]).map(a=>({...a,starting_equity:Number(a.starting_equity),cash:Number(a.cash),
        current_equity:Number(a.current_equity),realized_pnl:Number(a.realized_pnl),max_equity:Number(a.max_equity),
        max_drawdown_pct:Number(a.max_drawdown_pct),
        open_positions:Number(a.equity_open_positions)+Number(a.option_open_positions),
        closed_trades:Number(a.equity_closed_trades)+Number(a.option_closed_trades),
        winners_24h:Number(a.equity_winners_24h)+Number(a.option_winners_24h),
        trades_24h:Number(a.equity_trades_24h)+Number(a.option_trades_24h)})),
      asset_breakdown:(assetBreakdown.results??[]).map((x:any)=>({...x,open_positions:Number(x.open_positions),
        trades_24h:Number(x.trades_24h),winners_24h:Number(x.winners_24h),
        avg_closed_return_pct:x.avg_closed_return_pct==null?null:Number(x.avg_closed_return_pct)})),
      session_breakdown:sessionBreakdown,
      compounding_milestones:HUNT_ACCOUNT_MULTIPLES,
      compounding_scoreboard:compoundingScoreboard,
    };
  } catch(error) {
    body.leader_hunt={version:HUNT_VERSION,error:error instanceof Error?error.message:'leader hunt telemetry unavailable'};
  }

  if (env.CF_VERSION_METADATA?.id) {
    body.version = {
      worker_version: env.CF_VERSION_METADATA.id,
      ...(env.CF_VERSION_METADATA.tag ? { tag: env.CF_VERSION_METADATA.tag } : {}),
      ...(env.CF_VERSION_METADATA.timestamp ? { deployed_at: env.CF_VERSION_METADATA.timestamp } : {}),
    };
  }
  try {
    const valuations=await env.MEDS_DB.prepare(`SELECT v.*,l.label FROM paper_valuations v JOIN paper_ledgers l USING(ledger_id) WHERE v.id=(SELECT MAX(v2.id) FROM paper_valuations v2 WHERE v2.ledger_id=v.ledger_id)`).all<any>();
    const epochs=await env.MEDS_DB.prepare('SELECT * FROM paper_metric_epochs WHERE simulator_version=?').bind(SIM_VERSION).all<any>();
    const rejections=await env.MEDS_DB.prepare("SELECT reason,COUNT(*) AS count FROM paper_decisions WHERE decision LIKE 'REJECTED%' AND created_at>=? GROUP BY reason ORDER BY count DESC LIMIT 20").bind(new Date(Date.now()-86400000).toISOString()).all<any>();
    body.diagnostics={simulator_version:SIM_VERSION,execution_version:EXEC_VERSION,legacy_drawdown_quality:'pre-fix/untrusted; preserved unchanged',
      risk_limits:LIMITS,valuations:(valuations.results??[]).map(v=>{
        const exposures:Exposure[]=JSON.parse(v.exposures);
        const byUnderlying:Record<string,{planned_risk:number;reserved_risk:number;notional:number}>={};
        for(const e of exposures){const a=byUnderlying[e.underlying]??={planned_risk:0,reserved_risk:0,notional:0};a.planned_risk+=e.risk;a.reserved_risk+=e.risk+Math.max(0,-e.unrealized);a.notional+=e.notional;}
        return {...v,diagnostics:JSON.parse(v.diagnostics),exposures,by_underlying:byUnderlying,
          exposure_complete:!!v.complete,
          aggregate_reserved_risk:v.complete?exposures.reduce((n,e)=>n+e.risk+Math.max(0,-e.unrealized),0):null};
      }),
      prospective_metrics:epochs.results??[],rejected_entries_24h:rejections.results??[]};
    const valuationRows=valuations.results??[];
    const optionsOpen=phase(now)==='regular';
    const valuationIncomplete=valuationRows.some(v=>{
      if(v.complete) return false;
      // Outside regular option hours, stale option quotes are expected. Keep
      // the valuation visibly incomplete (so affected ledgers cannot add new
      // risk), but do not call the paper engine unhealthy unless some other
      // valuation defect is present.
      if(!optionsOpen){
        try {
          const diagnostics=JSON.parse(v.diagnostics??'[]');
          // Outside the regular session, some held equities have no usable
          // extended-hours print and listed options are closed. Those are
          // incomplete marks, not a system outage. The ledger remains blocked
          // from adding new risk because valueLedger.complete is still false.
          const expectedClosedMarketGap=(d:any)=>{
            const s=String(d);
            return s.startsWith('option quote unavailable/stale/invalid:') ||
              s.startsWith('equity quote unavailable/stale:');
          };
          return !Array.isArray(diagnostics) || diagnostics.some((d:any)=>!expectedClosedMarketGap(d));
        } catch { return true; }
      }
      return true;
    });
    const valuationStale=activeSession && valuationRows.some(v=>(secondsSince(v.created_at)??Infinity)>healthFreshSeconds);
    if(valuationRows.length!==4 || valuationIncomplete || valuationStale){paper.healthy=false;paper.paper_error='incomplete or stale portfolio valuation';body.ok=false;}
  } catch {body.diagnostics={simulator_version:SIM_VERSION,execution_version:EXEC_VERSION,warning:'phase1 diagnostics unavailable'};paper.healthy=false;body.ok=false;}
  return Response.json(body, {headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}

function publicPage(url: URL) {
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isInteger(requestedLimit) ? clamp(requestedLimit, 1, 100) : 50,
    offset: Number.isInteger(requestedOffset) ? clamp(requestedOffset, 0, 10_000) : 0,
  };
}

async function publicPaperRows(pathname: string, url: URL, env: Env): Promise<Response> {
  const {limit, offset} = publicPage(url);
  const queries: Record<string, string> = {
    "/status/trades": `SELECT t.id,l.label AS ledger,t.lane,t.asset_type,t.symbol,t.strategy,t.direction,
      t.opened_at,t.closed_at,t.quantity,t.entry_price,t.exit_price,t.realized_pnl,t.return_pct,
      t.r_multiple,t.reward_score,t.exit_reason,t.data_quality,t.simulator_version,t.execution_version,t.notes AS execution_audit
      FROM paper_trades t LEFT JOIN paper_ledgers l ON l.ledger_id=t.ledger_id
      ORDER BY t.closed_at DESC,t.id DESC LIMIT ? OFFSET ?`,
    "/status/positions": `SELECT p.id,l.label AS ledger,p.lane,'equity' AS asset_type,p.symbol,p.strategy,
      p.direction,p.opened_at,p.quantity,p.entry_price,NULL AS current_mark,p.stop_price,p.target_price,
      p.initial_risk,p.status,'market-data' AS data_quality,NULL AS long_symbol,NULL AS short_symbol
      FROM paper_positions p LEFT JOIN paper_ledgers l ON l.ledger_id=p.ledger_id WHERE p.status='open'
      UNION ALL
      SELECT o.id,l.label AS ledger,o.lane,'option' AS asset_type,o.underlying AS symbol,o.strategy,
      'long' AS direction,o.opened_at,o.quantity,o.entry_debit,o.current_mark,o.stop_debit,o.target_debit,
      o.initial_risk,o.status,o.data_quality,o.long_symbol,o.short_symbol
      FROM paper_option_positions o LEFT JOIN paper_ledgers l ON l.ledger_id=o.ledger_id WHERE o.status='open'
      ORDER BY opened_at DESC,id DESC LIMIT ? OFFSET ?`,
    "/status/decisions": `SELECT d.id,d.created_at,d.bucket,l.label AS ledger,d.lane,d.asset_type,d.symbol,
      d.strategy,d.decision,d.score,d.reference_price,d.spread_pct,d.reason,d.data_quality
      FROM paper_decisions d LEFT JOIN paper_ledgers l ON l.ledger_id=d.ledger_id
      ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?`,
    "/status/hunt": `SELECT * FROM (
      SELECT t.id,a.label AS account,a.starting_equity,'equity' AS asset_type,t.symbol AS underlying,t.symbol,
        t.opened_at,t.closed_at,t.entry_price,t.exit_price,t.quantity,t.entry_notional,t.exit_value,t.realized_pnl,t.return_pct,
        t.mfe_pct,t.mae_pct,t.minutes_held,t.exit_reason,t.entry_score,t.entry_day_change_pct,t.opened_phase,t.version,
        'market-data' AS data_quality
        FROM hunt_account_trades t LEFT JOIN hunt_accounts a ON a.account_id=t.account_id
      UNION ALL
      SELECT t.id,a.label AS account,a.starting_equity,'option' AS asset_type,t.underlying,t.symbol,
        t.opened_at,t.closed_at,t.entry_price,t.exit_price,t.quantity,t.entry_notional,t.exit_value,t.realized_pnl,t.return_pct,
        t.mfe_pct,t.mae_pct,t.minutes_held,t.exit_reason,t.entry_score,t.entry_day_change_pct,t.opened_phase,t.version,t.data_quality
        FROM hunt_account_option_trades t LEFT JOIN hunt_accounts a ON a.account_id=t.account_id
      ) ORDER BY closed_at DESC,id DESC LIMIT ? OFFSET ?`,
    "/status/hunt/positions": `SELECT p.id,a.label AS account,a.starting_equity,p.account_id,'equity' AS asset_type,
      p.symbol AS underlying,p.symbol,p.opened_at,p.entry_price,p.quantity,p.remaining_qty,p.entry_notional,p.stop_price,p.target_price,
      p.highest_price,p.lowest_price,p.entry_score,p.entry_day_change_pct,p.opened_phase,p.locked_realized_pnl,p.take200_done,
      p.take200_price,p.take200_at,p.runner_high,p.features,p.version,'market-data' AS data_quality,
      s.last_bid AS current_bid,s.last_ask AS current_ask,s.last_price AS current_price,s.last_seen_at AS mark_at,
      CASE WHEN s.last_bid>0 THEN (s.last_bid/p.entry_price-1)*100 ELSE NULL END AS unrealized_return_pct,
      CASE WHEN s.last_bid>0 THEN ((p.entry_price*3.0)/s.last_bid-1)*100 ELSE NULL END AS distance_to_200_pct,
      (SELECT COUNT(*) FROM hunt_account_events e WHERE e.position_id=p.id AND e.event_type='LADDER_25') AS ladder25_done,
      (SELECT COUNT(*) FROM hunt_account_events e WHERE e.position_id=p.id AND e.event_type='LADDER_50') AS ladder50_done,
      (SELECT COUNT(*) FROM hunt_account_events e WHERE e.position_id=p.id AND e.event_type='LADDER_100') AS ladder100_done
      FROM hunt_account_positions p
      LEFT JOIN hunt_accounts a ON a.account_id=p.account_id
      LEFT JOIN symbol_state s ON s.symbol=p.symbol
      WHERE p.status='open'
      UNION ALL
      SELECT p.id,a.label AS account,a.starting_equity,p.account_id,'option' AS asset_type,
      p.underlying,p.symbol,p.opened_at,p.entry_price,p.quantity,p.remaining_qty,p.entry_notional,p.stop_price,p.target_price,
      p.highest_price,p.lowest_price,p.entry_score,p.entry_day_change_pct,p.opened_phase,p.locked_realized_pnl,p.take200_done,
      p.take200_price,p.take200_at,p.runner_high,p.features,p.version,p.data_quality,
      p.current_mark AS current_bid,NULL AS current_ask,p.current_mark AS current_price,p.current_mark_at AS mark_at,
      CASE WHEN p.current_mark>0 THEN (p.current_mark/p.entry_price-1)*100 ELSE NULL END AS unrealized_return_pct,
      CASE WHEN p.current_mark>0 THEN ((p.entry_price*3.0)/p.current_mark-1)*100 ELSE NULL END AS distance_to_200_pct,
      (SELECT COUNT(*) FROM hunt_account_option_events e WHERE e.position_id=p.id AND e.event_type='LADDER_25') AS ladder25_done,
      (SELECT COUNT(*) FROM hunt_account_option_events e WHERE e.position_id=p.id AND e.event_type='LADDER_50') AS ladder50_done,
      (SELECT COUNT(*) FROM hunt_account_option_events e WHERE e.position_id=p.id AND e.event_type='LADDER_100') AS ladder100_done
      FROM hunt_account_option_positions p
      LEFT JOIN hunt_accounts a ON a.account_id=p.account_id
      WHERE p.status='open'
      ORDER BY starting_equity ASC,opened_at DESC,id DESC LIMIT ? OFFSET ?`,
  };
  try {
    const rows = await env.MEDS_DB.prepare(queries[pathname]).bind(limit, offset).all();
    return Response.json({ok:true,read_only:true,limit,offset,count:rows.results?.length ?? 0,rows:rows.results ?? []},
      {headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
  } catch (error) {
    const message = error instanceof Error ? error.message : "paper telemetry unavailable";
    return Response.json({ok:false,read_only:true,error:message.slice(0,300)},
      {status:503,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
  }
}

export { runTick, scanTick, manageShadowPositions, inScanWindow, heuristicCatalyst, ensurePaperSchema, valueLedger, markLedger, manageEquityPositions, manageOptionPositions, enterEquityProposal, enterOptionsForCandidate, leaderHuntEligible, runLeaderHunt, manageLeaderHuntPositions, runHuntAccounts, manageHuntAccountPositions, markHuntAccounts, selectLeaderOption, enterLeaderHuntOptions, manageHuntOptionPositions, HUNT_VERSION };
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
    if (url.pathname === "/status" && req.method === "GET") return publicStatus(env);
    if (["/status/trades","/status/positions","/status/decisions","/status/hunt","/status/hunt/positions"].includes(url.pathname) && req.method === "GET") {
      return publicPaperRows(url.pathname,url,env);
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
