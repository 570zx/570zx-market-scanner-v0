// Operator console for live trading: GET /live renders it, POST /live runs an
// action. Every action requires the Worker's ADMIN_TOKEN typed into the form,
// so the page works from any browser without extra tools.

import {startLogin,finishLogin,connectionStatus,loadToolCatalog,timingSafeEqual,RH_REDIRECT_URI,type FetchLike} from './robinhood-mcp.ts';
import {toolCapabilities} from './robinhood-broker.ts';
import {liveStatus,setLiveEnabled,setLiveLimits,clearLiveHalt,LIVE_LIMIT_FIELDS} from './live-execution.ts';

export type ConsoleEnv={MEDS_DB:D1Database;ADMIN_TOKEN?:string;BROKER_TOKEN_KEY?:string};

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const HEADERS={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy':'no-referrer','x-content-type-options':'nosniff'};

const LABELS:Record<string,string>={
  max_capital:'Max capital MEDS may use ($)',max_order_notional:'Max per order ($)',max_orders_per_day:'Max orders per day',
  daily_loss_limit:'Daily loss limit ($, then no new buys)',order_ttl_seconds:'Cancel unfilled orders after (seconds)',
  buy_limit_buffer_pct:'Buy limit above ask (fraction)',sell_limit_buffer_pct:'Sell limit below bid (fraction)',
  max_chase_pct:'Skip entry if price moved above paper by (fraction)',max_spread_pct:'Skip entry if spread wider than (fraction)',
  request_ttl_seconds:'Ignore paper decisions older than (seconds)',
};

function page(title:string,body:string,status=200){
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f6f6f4;--fg:#1b1b1a;--muted:#6b6b66;--card:#fff;--line:#deded8;--accent:#1f5eff;--bad:#b3261e;--good:#1d7a3a}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececea;--muted:#a3a39c;--card:#1c1c1b;--line:#33332f;--accent:#7aa2ff;--bad:#ff8a80;--good:#7fd99a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:14px 0}
.muted{color:var(--muted)}.bad{color:var(--bad)}.good{color:var(--good)}
label{display:block;margin:10px 0 4px;font-weight:600}input,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
button{margin-top:10px;padding:9px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
table{border-collapse:collapse;width:100%}td{padding:4px 0;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{color:var(--muted);width:48%}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:13px}
ol{padding-left:20px}.row{display:flex;gap:8px;flex-wrap:wrap}.row button{flex:1 1 140px}
</style></head><body><main>${body}</main></body></html>`,{status,headers:HEADERS});
}

const tokenField=`<label for="t">Admin token</label><input id="t" name="admin_token" type="password" autocomplete="current-password" required>`;
const form=(action:string,inner:string,button:string,cls='')=>`<form method="post" action="/live"><input type="hidden" name="action" value="${action}">${inner}${tokenField}<button class="${cls}">${esc(button)}</button></form>`;

export async function renderConsole(env:ConsoleEnv,notice=''){
  const [conn,live,catalog]=await Promise.all([connectionStatus(env.MEDS_DB),liveStatus(env.MEDS_DB,false),loadToolCatalog(env.MEDS_DB)]);
  const caps=toolCapabilities(catalog);
  const rows=(pairs:[string,unknown][])=>`<table>${pairs.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const limits=live.limits??{};
  const body=`<h1>MEDS live trading</h1><p class="muted">Robinhood Agentic account · every order is real money</p>
${notice?`<div class="card">${notice}</div>`:''}
<div class="card"><h2>Status</h2>${rows([
    ['Live trading',live.live_execution?'ON':'OFF'],['State',live.state],['Halted',live.halted_reason??'no'],
    ['Robinhood login',conn.relogin_required?'expired: log in again (step 1)':conn.logged_in?`yes (since ${conn.obtained_at})`:'not connected'],
    ['Order tools',catalog.length?(caps.can_trade?'all found':'missing: '+Object.entries(caps.tools).filter(([,v])=>!v).map(([k])=>k).join(', ')):'unknown until login'],
    ['Last sync',live.last_sync_at?`${live.last_sync_at} ${live.last_sync_ok?'ok':'failed'}`:'never'],['Last error',live.last_error??conn.last_error??'none'],
    ['Orders today',live.orders_today],['Pending orders',live.pending_orders],['Open positions',live.open_positions],
    ['Reconciliation',live.reconciliation??'n/a'],['Buys blocked',live.buys_blocked??'no'],
  ])}</div>
<div class="card"><h2>1 · Connect Robinhood</h2><ol>
<li>Enter your admin token and press <b>Start login</b>. You'll be sent to Robinhood.</li>
<li>Log in and approve on your phone. Robinhood then sends you to a <code>localhost</code> page that <b>won't load</b>. That's expected.</li>
<li>Copy the full address from the address bar (it starts with <code>${esc(RH_REDIRECT_URI)}</code>) and paste it in step 2 below within 15 minutes.</li></ol>
${form('start_login','','Start login')}</div>
<div class="card"><h2>2 · Finish login</h2>${form('finish_login',`<label for="cb">Address you landed on</label><textarea id="cb" name="callback" rows="3" required placeholder="${esc(RH_REDIRECT_URI)}?code=...&state=..."></textarea>`,'Finish login')}</div>
<div class="card"><h2>3 · Controls</h2><p class="muted">ON: MEDS copies each new paper entry/exit into a real limit order. OFF: no new buys; MEDS still sells what it bought when the paper account exits.</p>
<form method="post" action="/live">${tokenField}<div class="row">
<button name="action" value="enable">Turn live ON</button><button name="action" value="disable" class="secondary">Turn live OFF</button>
<button name="action" value="clear_halt" class="secondary">Clear halt</button><button name="action" value="run_now" class="secondary">Run a live step now</button>
<button name="action" value="detail" class="secondary">Show account detail</button></div></form></div>
<div class="card"><h2>4 · Limits</h2><form method="post" action="/live"><input type="hidden" name="action" value="limits">
${LIVE_LIMIT_FIELDS.map(f=>`<label for="${f}">${esc(LABELS[f]??f)}</label><input id="${f}" name="${f}" inputmode="decimal" value="${esc(limits[f])}">`).join('')}
${tokenField}<button>Save limits</button></form></div>
<p class="muted">Public read-only status: <a href="/status/live">/status/live</a> · Robinhood tool formats: <a href="/status/broker/tools">/status/broker/tools</a></p>`;
  return page('MEDS live',body);
}

export async function handleConsolePost(req:Request,env:ConsoleEnv,fetchImpl:FetchLike,runNow:()=>Promise<unknown>):Promise<Response>{
  const f=await req.formData().catch(()=>null);
  const token=String(f?.get('admin_token')??''),action=String(f?.get('action')??'');
  if(!env.ADMIN_TOKEN||!timingSafeEqual(token,env.ADMIN_TOKEN))return renderConsole(env,'<b class="bad">Wrong admin token.</b> Nothing was changed.');
  try{
    if(action==='start_login'){
      const {authorizeUrl}=await startLogin(env.MEDS_DB,env,fetchImpl);
      return new Response(null,{status:303,headers:{location:authorizeUrl,'cache-control':'no-store','referrer-policy':'no-referrer'}});
    }
    if(action==='finish_login'){
      const r=await finishLogin(env.MEDS_DB,env,fetchImpl,String(f?.get('callback')??''));
      const caps=toolCapabilities(await loadToolCatalog(env.MEDS_DB));
      return renderConsole(env,`<b class="good">Connected to Robinhood.</b> ${r.tools} tools found. ${caps.can_trade?'Everything MEDS needs to trade is available.':`<span class="bad">Missing for trading: ${esc(Object.entries(caps.tools).filter(([,v])=>!v).map(([k])=>k).join(', '))}</span>`}`);
    }
    if(action==='enable'){
      const [conn,catalog]=await Promise.all([connectionStatus(env.MEDS_DB),loadToolCatalog(env.MEDS_DB)]);
      const caps=toolCapabilities(catalog);
      if(!conn.logged_in||conn.relogin_required)return renderConsole(env,'<b class="bad">Connect Robinhood first.</b>');
      if(!caps.can_trade)return renderConsole(env,`<b class="bad">Robinhood's tools don't include everything MEDS needs to trade:</b> ${esc(Object.entries(caps.tools).filter(([,v])=>!v).map(([k])=>k).join(', '))}.`);
      await setLiveEnabled(env.MEDS_DB,true);
      return renderConsole(env,'<b class="good">Live trading is ON.</b> New paper entries and exits will be sent to Robinhood during regular market hours.');
    }
    if(action==='disable'){await setLiveEnabled(env.MEDS_DB,false);return renderConsole(env,'<b>Live trading is OFF.</b> No new buys. MEDS still exits what it holds.');}
    if(action==='clear_halt'){
      const adjusted=await clearLiveHalt(env.MEDS_DB);
      return renderConsole(env,adjusted.length?`Halt cleared. MEDS now counts only the shares Robinhood actually holds for ${esc(adjusted.join(', '))}.`:'Halt cleared.');
    }
    if(action==='limits'){
      const input:Record<string,unknown>={};for(const k of LIVE_LIMIT_FIELDS)input[k]=f?.get(k);
      const n=await setLiveLimits(env.MEDS_DB,input);
      return renderConsole(env,n?'Limits saved.':'No limit values changed.');
    }
    if(action==='run_now')return renderConsole(env,`<b>Live step result</b><pre>${esc(JSON.stringify(await runNow(),null,2))}</pre>`);
    if(action==='detail')return renderConsole(env,`<b>Account detail</b><pre>${esc(JSON.stringify(await liveStatus(env.MEDS_DB,true),null,2))}</pre>`);
    return renderConsole(env,'Unknown action.');
  }catch(error){
    return renderConsole(env,`<b class="bad">Failed:</b> ${esc(error instanceof Error?error.message:String(error))}`);
  }
}
