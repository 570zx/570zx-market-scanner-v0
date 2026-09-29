// Robinhood Agentic Trading connection for MEDS.
//
// Robinhood exposes agent trading as an MCP server (Streamable HTTP) protected
// by OAuth 2.1 with dynamic client registration and PKCE. Self-registered
// clients may only use loopback redirect URIs, so login is a copy/paste flow:
// the browser ends on http://localhost:8765/callback?... (which fails to load)
// and the operator pastes that address back into the MEDS console.
//
// Access and refresh tokens are sealed with AES-GCM before they are written to
// D1. The key comes from BROKER_TOKEN_KEY, or is derived from ADMIN_TOKEN.

export const RH_MCP_URL='https://agent.robinhood.com/mcp/trading';
export const RH_REDIRECT_URI='http://localhost:8765/callback';
export const MCP_PROTOCOL_VERSION='2025-06-18';
export const CLIENT_NAME='MEDS Scout';
const LOGIN_TTL_MS=15*60_000;
const ACCESS_SKEW_MS=60_000;

export type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;

// ---------------------------------------------------------------- encoding

const te=new TextEncoder(),td=new TextDecoder();
export function b64url(bytes:Uint8Array){
  let s='';for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function fromB64url(text:string){
  const s=text.trim().replace(/-/g,'+').replace(/_/g,'/'),pad=s.length%4?'='.repeat(4-s.length%4):'';
  return Uint8Array.from(atob(s+pad),c=>c.charCodeAt(0));
}
export function randomToken(bytes=32){return b64url(crypto.getRandomValues(new Uint8Array(bytes)));}
export async function pkcePair(){
  const verifier=randomToken(48);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(verifier)));
  return {verifier,challenge:b64url(digest)};
}
export function timingSafeEqual(a:string,b:string){
  const x=te.encode(a),y=te.encode(b);let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]??0)^(y[i]??0);
  return diff===0;
}

// ---------------------------------------------------------------- token vault

export type VaultEnv={BROKER_TOKEN_KEY?:string;ADMIN_TOKEN?:string};
export async function vaultKey(env:VaultEnv):Promise<CryptoKey>{
  if(env.BROKER_TOKEN_KEY){
    const raw=fromB64url(env.BROKER_TOKEN_KEY);
    if(raw.length!==32)throw new Error('BROKER_TOKEN_KEY_MUST_BE_32_BYTES_BASE64');
    return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<16)throw new Error('TOKEN_VAULT_KEY_UNAVAILABLE');
  const base=await crypto.subtle.importKey('raw',te.encode(env.ADMIN_TOKEN),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:te.encode('meds-robinhood-token-vault'),info:te.encode('v1')},
    base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(key:CryptoKey,plain:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode(plain)));
  return 'v1.'+b64url(iv)+'.'+b64url(ct);
}
export async function unseal(key:CryptoKey,sealed:string){
  const [v,iv,ct]=sealed.split('.');
  if(v!=='v1'||!iv||!ct)throw new Error('SEALED_VALUE_INVALID');
  return td.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64url(iv)},key,fromB64url(ct)));
}

// ---------------------------------------------------------------- OAuth

export type OAuthMetadata={
  resource:string;issuer:string;authorization_endpoint:string;token_endpoint:string;
  registration_endpoint:string|null;scope:string|null;
};
export type OAuthClient={client_id:string;client_secret:string|null};
export type TokenSet={access_token:string;refresh_token:string|null;expires_in:number|null;scope:string|null};

function httpsOnly(url:string,label:string){
  const u=new URL(url);
  if(u.protocol!=='https:')throw new Error(label+'_MUST_BE_HTTPS');
  return u.toString();
}
async function getJson(fetchImpl:FetchLike,url:string){
  try{
    const r=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10_000)});
    if(!r.ok)return null;
    return await r.json() as any;
  }catch{return null;}
}
export function resourceMetadataUrl(header:string|null){
  const m=/resource_metadata="([^"]+)"/i.exec(header??'');
  return m?m[1]:null;
}

export async function discoverOAuth(fetchImpl:FetchLike,mcpUrl=RH_MCP_URL):Promise<OAuthMetadata>{
  const u=new URL(mcpUrl);
  let header:string|null=null;
  try{
    const probe=await fetchImpl(mcpUrl,{method:'POST',signal:AbortSignal.timeout(10_000),
      headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:CLIENT_NAME,version:'9.0'}}})});
    header=probe.headers.get('www-authenticate');
  }catch{}
  const prmCandidates=[resourceMetadataUrl(header),`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`,`${u.origin}/.well-known/oauth-protected-resource`]
    .filter((x):x is string=>!!x);
  let prm:any=null;
  for(const c of prmCandidates){const j=await getJson(fetchImpl,c);if(Array.isArray(j?.authorization_servers)&&j.authorization_servers.length){prm=j;break;}}
  const issuer=String(prm?.authorization_servers?.[0]??u.origin).replace(/\/$/,'');
  const iu=new URL(issuer),path=iu.pathname==='/'?'':iu.pathname.replace(/\/$/,'');
  const asCandidates=[`${iu.origin}/.well-known/oauth-authorization-server${path}`,`${iu.origin}/.well-known/openid-configuration${path}`,
    ...(path?[`${issuer}/.well-known/oauth-authorization-server`,`${issuer}/.well-known/openid-configuration`]:[])];
  let as:any=null;
  for(const c of asCandidates){const j=await getJson(fetchImpl,c);if(j?.authorization_endpoint&&j?.token_endpoint){as=j;break;}}
  if(!as)throw new Error('OAUTH_METADATA_NOT_FOUND');
  const scopes:string[]=Array.isArray(prm?.scopes_supported)?prm.scopes_supported.map(String):[];
  return {
    resource:String(prm?.resource??mcpUrl),issuer:String(as.issuer??issuer),
    authorization_endpoint:httpsOnly(String(as.authorization_endpoint),'AUTHORIZATION_ENDPOINT'),
    token_endpoint:httpsOnly(String(as.token_endpoint),'TOKEN_ENDPOINT'),
    registration_endpoint:as.registration_endpoint?httpsOnly(String(as.registration_endpoint),'REGISTRATION_ENDPOINT'):null,
    scope:scopes.length?scopes.join(' '):null,
  };
}

export async function registerClient(fetchImpl:FetchLike,meta:OAuthMetadata,redirectUri=RH_REDIRECT_URI):Promise<OAuthClient>{
  if(!meta.registration_endpoint)throw new Error('OAUTH_DYNAMIC_REGISTRATION_UNAVAILABLE');
  const r=await fetchImpl(meta.registration_endpoint,{method:'POST',signal:AbortSignal.timeout(10_000),
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({client_name:CLIENT_NAME,redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],
      response_types:['code'],token_endpoint_auth_method:'none',...(meta.scope?{scope:meta.scope}:{})})});
  const j:any=await r.json().catch(()=>null);
  if(!r.ok||!j?.client_id)throw new Error('OAUTH_REGISTRATION_FAILED_'+r.status);
  return {client_id:String(j.client_id),client_secret:j.client_secret?String(j.client_secret):null};
}

export function authorizeUrl(meta:OAuthMetadata,client:OAuthClient,x:{state:string;challenge:string;redirectUri:string}){
  const u=new URL(meta.authorization_endpoint);
  const params:Record<string,string>={response_type:'code',client_id:client.client_id,redirect_uri:x.redirectUri,
    code_challenge:x.challenge,code_challenge_method:'S256',state:x.state,resource:meta.resource};
  if(meta.scope)params.scope=meta.scope;
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  return u.toString();
}

async function tokenRequest(fetchImpl:FetchLike,meta:OAuthMetadata,client:OAuthClient,params:Record<string,string>):Promise<TokenSet>{
  const body=new URLSearchParams({...params,client_id:client.client_id,resource:meta.resource});
  if(client.client_secret)body.set('client_secret',client.client_secret);
  const r=await fetchImpl(meta.token_endpoint,{method:'POST',signal:AbortSignal.timeout(15_000),
    headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString()});
  const j:any=await r.json().catch(()=>null);
  if(!r.ok||!j?.access_token)throw new Error(`OAUTH_${params.grant_type.toUpperCase()}_FAILED_${r.status}${j?.error?':'+String(j.error).slice(0,60):''}`);
  return {access_token:String(j.access_token),refresh_token:j.refresh_token?String(j.refresh_token):null,
    expires_in:Number.isFinite(Number(j.expires_in))?Number(j.expires_in):null,scope:j.scope?String(j.scope):null};
}
export function exchangeCode(fetchImpl:FetchLike,meta:OAuthMetadata,client:OAuthClient,code:string,verifier:string,redirectUri=RH_REDIRECT_URI){
  return tokenRequest(fetchImpl,meta,client,{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirectUri});
}
export function refreshAccess(fetchImpl:FetchLike,meta:OAuthMetadata,client:OAuthClient,refreshToken:string){
  return tokenRequest(fetchImpl,meta,client,{grant_type:'refresh_token',refresh_token:refreshToken});
}

// Accepts the full address the browser landed on, or just its query string.
export function parseCallback(pasted:string){
  const text=pasted.trim();
  let u:URL;
  try{u=new URL(text);}catch{u=new URL('http://localhost/?'+text.replace(/^[^?]*\?/,''));}
  const error=u.searchParams.get('error');
  if(error)throw new Error('OAUTH_AUTHORIZATION_DENIED:'+error.slice(0,60));
  const code=u.searchParams.get('code'),state=u.searchParams.get('state');
  if(!code||!state)throw new Error('OAUTH_CALLBACK_MISSING_CODE_OR_STATE');
  return {code,state};
}

// ---------------------------------------------------------------- MCP client

export type McpTool={name:string;description?:string|null;inputSchema?:any};
export type ToolResult={isError:boolean;text:string;data:any};
export type TokenSource={token:()=>Promise<string>;refresh:()=>Promise<string|null>};

function sseMessage(block:string){
  const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
  if(!data)return null;
  try{return JSON.parse(data);}catch{return null;}
}
export function parseSse(text:string,id:unknown){
  let found:any=null,last:any=null;
  for(const block of text.split(/\r?\n\r?\n/)){
    const m=sseMessage(block);
    if(!m)continue;
    if(m.id===id)found=m;else if(m.result!==undefined||m.error!==undefined)last=m;
  }
  return found??last;
}
// Reads an SSE response only until the reply to `id` arrives, then closes the
// stream, so a server that keeps the stream open cannot stall the call.
export async function readSse(r:Response,id:unknown){
  if(!r.body)return parseSse(await r.text(),id);
  const reader=r.body.getReader(),decoder=new TextDecoder();
  let buffer='',last:any=null;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(value)buffer+=decoder.decode(value,{stream:true});
      for(let m=/\r?\n\r?\n/.exec(buffer);m;m=/\r?\n\r?\n/.exec(buffer)){
        const message=sseMessage(buffer.slice(0,m.index));buffer=buffer.slice(m.index+m[0].length);
        if(message?.id===id)return message;
        if(message&&(message.result!==undefined||message.error!==undefined))last=message;
      }
      if(done)break;
    }
    const tail=sseMessage(buffer);
    return tail?.id===id?tail:last;
  }finally{reader.cancel().catch(()=>{});}
}
export function toolResult(r:any):ToolResult{
  const texts:string[]=(Array.isArray(r?.content)?r.content:[]).filter((c:any)=>c?.type==='text').map((c:any)=>String(c.text??''));
  let data=r?.structuredContent??null;
  if(data==null)for(const t of texts){try{data=JSON.parse(t);break;}catch{}}
  return {isError:!!r?.isError,text:texts.join('\n'),data};
}

export class McpClient {
  calls=0;
  private sessionId:string|null=null;
  private nextId=1;
  private initialized=false;
  private initializing:Promise<unknown>|null=null;
  private protocol=MCP_PROTOCOL_VERSION;
  private fetchImpl:FetchLike;
  private url:string;
  private auth:TokenSource;
  constructor(fetchImpl:FetchLike,url:string,auth:TokenSource){this.fetchImpl=fetchImpl;this.url=url;this.auth=auth;}

  private post(body:unknown,token:string){
    const headers:Record<string,string>={'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+token};
    if(this.initialized)headers['mcp-protocol-version']=this.protocol;
    if(this.sessionId)headers['mcp-session-id']=this.sessionId;
    this.calls++;
    return this.fetchImpl(this.url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
  }
  private async send(body:{id?:number;method:string;params?:unknown;jsonrpc:'2.0'},expectResponse:boolean):Promise<any>{
    let r=await this.post(body,await this.auth.token());
    if(r.status===401){
      const fresh=await this.auth.refresh();
      if(!fresh)throw new Error('MCP_UNAUTHORIZED');
      r=await this.post(body,fresh);
    }
    if(r.status===404&&this.sessionId&&body.method!=='initialize'){
      // Session expired server-side: start a new one and retry once.
      this.sessionId=null;this.initialized=false;this.initializing=null;
      await this.ready();
      r=await this.post(body,await this.auth.token());
    }
    if(r.status===401)throw new Error('MCP_UNAUTHORIZED');
    const sid=r.headers.get('mcp-session-id');if(sid)this.sessionId=sid;
    if(!expectResponse){if(!r.ok)throw new Error('MCP_HTTP_'+r.status);return null;}
    if(!r.ok)throw new Error('MCP_HTTP_'+r.status);
    const type=r.headers.get('content-type')??'';
    let message:any=type.includes('text/event-stream')?await readSse(r,body.id):await r.json();
    if(Array.isArray(message))message=message.find(m=>m?.id===body.id);
    if(!message)throw new Error('MCP_EMPTY_RESPONSE');
    if(message.error)throw new Error('MCP_ERROR_'+(message.error.code??'')+':'+String(message.error.message??'').slice(0,200));
    return message.result;
  }
  async initialize(){
    const result=await this.send({jsonrpc:'2.0',id:this.nextId++,method:'initialize',
      params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:CLIENT_NAME,version:'9.0'}}},true);
    if(result?.protocolVersion)this.protocol=String(result.protocolVersion);
    this.initialized=true;
    await this.send({jsonrpc:'2.0',method:'notifications/initialized'},false);
    return result;
  }
  // One initialize per client even when calls start concurrently.
  private ready(){
    if(this.initialized)return Promise.resolve();
    if(!this.initializing)this.initializing=this.initialize().catch(e=>{this.initializing=null;throw e;});
    return this.initializing;
  }
  async listTools():Promise<McpTool[]>{
    await this.ready();
    const tools:McpTool[]=[];let cursor:string|undefined;
    for(let page=0;page<10;page++){
      const r=await this.send({jsonrpc:'2.0',id:this.nextId++,method:'tools/list',params:cursor?{cursor}:{}},true);
      tools.push(...(Array.isArray(r?.tools)?r.tools:[]));
      cursor=r?.nextCursor||undefined;
      if(!cursor)break;
    }
    return tools;
  }
  async callTool(name:string,args:Record<string,unknown>):Promise<ToolResult>{
    await this.ready();
    return toolResult(await this.send({jsonrpc:'2.0',id:this.nextId++,method:'tools/call',params:{name,arguments:args}},true));
  }
}

// ---------------------------------------------------------------- persistence

export const ROBINHOOD_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS broker_oauth(
    id INTEGER PRIMARY KEY CHECK(id=1),mcp_url TEXT NOT NULL,resource TEXT NOT NULL,issuer TEXT NOT NULL,
    authorization_endpoint TEXT NOT NULL,token_endpoint TEXT NOT NULL,registration_endpoint TEXT,scope TEXT,
    client_id TEXT NOT NULL,client_secret_sealed TEXT,redirect_uri TEXT NOT NULL,registered_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_oauth_pending(
    state TEXT PRIMARY KEY,verifier_sealed TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_credentials(
    id INTEGER PRIMARY KEY CHECK(id=1),access_sealed TEXT NOT NULL,refresh_sealed TEXT,access_expires_at INTEGER,
    scope TEXT,obtained_at TEXT NOT NULL,refreshed_at TEXT,refresh_failures INTEGER NOT NULL DEFAULT 0,last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS broker_tool_catalog(
    name TEXT PRIMARY KEY,description TEXT,input_schema TEXT NOT NULL,fetched_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS broker_tool_shapes(
    tool TEXT PRIMARY KEY,shape TEXT NOT NULL,is_error INTEGER NOT NULL DEFAULT 0,captured_at TEXT NOT NULL)`,
];
export async function ensureRobinhoodSchema(db:D1Database){await db.batch(ROBINHOOD_SCHEMA.map(s=>db.prepare(s)));}

type OAuthRow={mcp_url:string;resource:string;issuer:string;authorization_endpoint:string;token_endpoint:string;
  registration_endpoint:string|null;scope:string|null;client_id:string;client_secret_sealed:string|null;redirect_uri:string};
function metaFromRow(r:OAuthRow):OAuthMetadata{
  return {resource:r.resource,issuer:r.issuer,authorization_endpoint:r.authorization_endpoint,token_endpoint:r.token_endpoint,
    registration_endpoint:r.registration_endpoint,scope:r.scope};
}

// Step 1 of login: discover, (re)register if needed, and return the Robinhood
// authorization URL the operator must open.
export async function startLogin(db:D1Database,env:VaultEnv,fetchImpl:FetchLike,now=new Date(),mcpUrl=RH_MCP_URL){
  const key=await vaultKey(env);
  const meta=await discoverOAuth(fetchImpl,mcpUrl);
  const existing=await db.prepare('SELECT * FROM broker_oauth WHERE id=1').first<OAuthRow>();
  let client:OAuthClient|null=null;
  if(existing&&existing.token_endpoint===meta.token_endpoint&&existing.redirect_uri===RH_REDIRECT_URI){
    // A registration sealed under a previous key (ADMIN_TOKEN rotated) is replaced.
    try{client={client_id:existing.client_id,client_secret:existing.client_secret_sealed?await unseal(key,existing.client_secret_sealed):null};}catch{client=null;}
  }
  client=client??await registerClient(fetchImpl,meta);
  const {verifier,challenge}=await pkcePair(),state=randomToken(24),stamp=now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO broker_oauth(id,mcp_url,resource,issuer,authorization_endpoint,token_endpoint,registration_endpoint,scope,client_id,client_secret_sealed,redirect_uri,registered_at)
      VALUES(1,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mcp_url=excluded.mcp_url,resource=excluded.resource,issuer=excluded.issuer,
      authorization_endpoint=excluded.authorization_endpoint,token_endpoint=excluded.token_endpoint,registration_endpoint=excluded.registration_endpoint,
      scope=excluded.scope,client_id=excluded.client_id,client_secret_sealed=excluded.client_secret_sealed,redirect_uri=excluded.redirect_uri,
      registered_at=CASE WHEN broker_oauth.client_id=excluded.client_id THEN broker_oauth.registered_at ELSE excluded.registered_at END`)
      .bind(mcpUrl,meta.resource,meta.issuer,meta.authorization_endpoint,meta.token_endpoint,meta.registration_endpoint,meta.scope,
        client.client_id,client.client_secret?await seal(key,client.client_secret):null,RH_REDIRECT_URI,stamp),
    db.prepare('DELETE FROM broker_oauth_pending WHERE expires_at<?').bind(now.getTime()),
    db.prepare('INSERT INTO broker_oauth_pending(state,verifier_sealed,created_at,expires_at) VALUES(?,?,?,?)')
      .bind(state,await seal(key,verifier),stamp,now.getTime()+LOGIN_TTL_MS),
  ]);
  return {authorizeUrl:authorizeUrl(meta,client,{state,challenge,redirectUri:RH_REDIRECT_URI}),state};
}

// Step 2 of login: exchange the pasted callback for tokens, store them sealed,
// then capture Robinhood's tool catalog so order arguments can be mapped.
export async function finishLogin(db:D1Database,env:VaultEnv,fetchImpl:FetchLike,pasted:string,now=new Date()){
  const key=await vaultKey(env);
  const {code,state}=parseCallback(pasted);
  const [pending,oauth]=await Promise.all([
    db.prepare('SELECT * FROM broker_oauth_pending WHERE state=?').bind(state).first<any>(),
    db.prepare('SELECT * FROM broker_oauth WHERE id=1').first<OAuthRow>(),
  ]);
  if(!pending||!oauth)throw new Error('OAUTH_LOGIN_NOT_STARTED_OR_STATE_MISMATCH');
  if(Number(pending.expires_at)<now.getTime())throw new Error('OAUTH_LOGIN_EXPIRED_START_AGAIN');
  const client:OAuthClient={client_id:oauth.client_id,client_secret:oauth.client_secret_sealed?await unseal(key,oauth.client_secret_sealed):null};
  const tokens=await exchangeCode(fetchImpl,metaFromRow(oauth),client,code,await unseal(key,pending.verifier_sealed),oauth.redirect_uri);
  await storeTokens(db,key,tokens,now,null);
  await db.prepare('DELETE FROM broker_oauth_pending WHERE state=?').bind(state).run();
  const session=await RobinhoodSession.load(db,env,fetchImpl);
  if(!session)throw new Error('ROBINHOOD_SESSION_UNAVAILABLE_AFTER_LOGIN');
  const tools=await session.client.listTools();
  await saveToolCatalog(db,tools,now);
  return {tools:tools.length,toolNames:tools.map(t=>t.name)};
}

// `refreshOf` is the obtained_at of the login being refreshed: a refresh never
// overwrites credentials from a newer login made in the meantime.
async function storeTokens(db:D1Database,key:CryptoKey,t:TokenSet,now:Date,refreshOf:string|null){
  const access=await seal(key,t.access_token),refresh=t.refresh_token?await seal(key,t.refresh_token):null;
  const expiresAt=t.expires_in?now.getTime()+t.expires_in*1000:null,stamp=now.toISOString();
  if(refreshOf==null){
    await db.prepare(`INSERT INTO broker_credentials(id,access_sealed,refresh_sealed,access_expires_at,scope,obtained_at,refreshed_at,refresh_failures,last_error)
      VALUES(1,?,?,?,?,?,NULL,0,NULL) ON CONFLICT(id) DO UPDATE SET access_sealed=excluded.access_sealed,refresh_sealed=excluded.refresh_sealed,
      access_expires_at=excluded.access_expires_at,scope=excluded.scope,obtained_at=excluded.obtained_at,refreshed_at=NULL,refresh_failures=0,last_error=NULL`)
      .bind(access,refresh,expiresAt,t.scope,stamp).run();
  }else{
    // Keep the previous refresh token if the server did not rotate it.
    await db.prepare(`UPDATE broker_credentials SET access_sealed=?,refresh_sealed=COALESCE(?,refresh_sealed),access_expires_at=?,
      scope=COALESCE(?,scope),refreshed_at=?,refresh_failures=0,last_error=NULL WHERE id=1 AND obtained_at=?`).bind(access,refresh,expiresAt,t.scope,stamp,refreshOf).run();
  }
}

// Two statements regardless of catalog size (Robinhood exposes 70+ tools).
export async function saveToolCatalog(db:D1Database,tools:McpTool[],now=new Date()){
  const rows=tools.slice(0,300).map(t=>({name:String(t.name),description:t.description?String(t.description).slice(0,2000):null,input_schema:JSON.stringify(t.inputSchema??{})}));
  await db.batch([
    db.prepare('DELETE FROM broker_tool_catalog'),
    db.prepare(`INSERT OR REPLACE INTO broker_tool_catalog(name,description,input_schema,fetched_at)
      SELECT json_extract(value,'$.name'),json_extract(value,'$.description'),json_extract(value,'$.input_schema'),? FROM json_each(?) WHERE 1`)
      .bind(now.toISOString(),JSON.stringify(rows)),
  ]);
}
export async function loadToolCatalog(db:D1Database):Promise<McpTool[]>{
  const rows=(await db.prepare('SELECT name,description,input_schema FROM broker_tool_catalog ORDER BY name').all<any>()).results??[];
  return rows.map(r=>({name:String(r.name),description:r.description,inputSchema:JSON.parse(r.input_schema||'{}')}));
}
// The live step loads only the tools it may call, with the time each tool's
// response shape was last captured, in one query.
export async function loadRuntimeTools(db:D1Database,names:string[]){
  const rows=(await db.prepare(`SELECT c.name,c.description,c.input_schema,s.captured_at AS shape_at FROM broker_tool_catalog c
    LEFT JOIN broker_tool_shapes s ON s.tool=c.name WHERE c.name IN (SELECT value FROM json_each(?)) OR c.name LIKE '%order%'`)
    .bind(JSON.stringify(names)).all<any>()).results??[];
  return {
    tools:rows.map(r=>({name:String(r.name),description:r.description,inputSchema:JSON.parse(r.input_schema||'{}')}) as McpTool),
    shapeAt:new Map(rows.filter(r=>r.shape_at).map(r=>[String(r.name),Date.parse(r.shape_at)])),
  };
}

// Keys and value types only: lets us see a response's structure without
// publishing balances, positions or order details.
export function shapeOf(value:unknown,depth=0):unknown{
  if(depth>6)return '…';
  if(value===null)return 'null';
  if(Array.isArray(value))return value.length?[shapeOf(value[0],depth+1)]:[];
  if(typeof value==='object'){
    const out:Record<string,unknown>={};
    for(const [k,v] of Object.entries(value as Record<string,unknown>).slice(0,60))out[k]=shapeOf(v,depth+1);
    return out;
  }
  return typeof value;
}
export type ShapeRow={tool:string;shape:string;is_error:number;captured_at:string};
export function shapeRow(tool:string,result:ToolResult,now=new Date()):ShapeRow{
  const shape=JSON.stringify(result.data!=null?shapeOf(result.data):{text_only:true,length:result.text.length});
  return {tool,shape:shape.slice(0,20_000),is_error:result.isError?1:0,captured_at:now.toISOString()};
}
// All captured shapes in one statement.
export function shapesStatement(db:D1Database,rows:ShapeRow[]){
  return db.prepare(`INSERT INTO broker_tool_shapes(tool,shape,is_error,captured_at)
    SELECT json_extract(value,'$.tool'),json_extract(value,'$.shape'),json_extract(value,'$.is_error'),json_extract(value,'$.captured_at') FROM json_each(?) WHERE 1
    ON CONFLICT(tool) DO UPDATE SET shape=excluded.shape,is_error=excluded.is_error,captured_at=excluded.captured_at`).bind(JSON.stringify(rows));
}

// Refresh failures at or above this mean Robinhood rejected the refresh token:
// the session is dead until the operator logs in again, and MEDS stops trying.
const RELOGIN_REQUIRED=99;

// A logged-in session. Token refresh happens only through this object so the
// rotated refresh token is persisted before it is used again.
export class RobinhoodSession {
  client:McpClient;
  refreshed=false;
  private refreshFailed=false;
  private db:D1Database;private key:CryptoKey;private oauth:OAuthRow;private fetchImpl:FetchLike;
  private access:string;private expiresAt:number|null;private refreshSealed:string|null;private obtainedAt:string;
  private constructor(db:D1Database,key:CryptoKey,oauth:OAuthRow,fetchImpl:FetchLike,access:string,expiresAt:number|null,refreshSealed:string|null,obtainedAt:string){
    this.db=db;this.key=key;this.oauth=oauth;this.fetchImpl=fetchImpl;this.access=access;this.expiresAt=expiresAt;this.refreshSealed=refreshSealed;this.obtainedAt=obtainedAt;
    this.client=new McpClient(fetchImpl,oauth.mcp_url,{token:()=>this.token(),refresh:()=>this.refresh()});
  }
  static async load(db:D1Database,env:VaultEnv,fetchImpl:FetchLike):Promise<RobinhoodSession|null>{
    const row=await db.prepare(`SELECT o.*,c.access_sealed,c.refresh_sealed,c.access_expires_at,c.obtained_at AS cred_obtained_at,c.refresh_failures
      FROM broker_oauth o JOIN broker_credentials c ON c.id=1 WHERE o.id=1`).first<any>();
    if(!row?.access_sealed)return null;
    if(Number(row.refresh_failures)>=RELOGIN_REQUIRED)throw new Error('ROBINHOOD_RELOGIN_REQUIRED');
    const key=await vaultKey(env);
    let access:string;
    try{access=await unseal(key,row.access_sealed);}catch{throw new Error('ROBINHOOD_RELOGIN_REQUIRED_KEY_CHANGED');}
    return new RobinhoodSession(db,key,row as OAuthRow,fetchImpl,access,row.access_expires_at==null?null:Number(row.access_expires_at),row.refresh_sealed??null,String(row.cred_obtained_at));
  }
  async token(){
    if(this.expiresAt!=null&&Date.now()>this.expiresAt-ACCESS_SKEW_MS){const fresh=await this.refresh();if(fresh)return fresh;}
    return this.access;
  }
  async refresh():Promise<string|null>{
    if(this.refreshFailed)return null; // at most one attempt per session
    if(!this.refreshSealed){this.refreshFailed=true;await this.fail('NO_REFRESH_TOKEN_RELOGIN_REQUIRED',true);return null;}
    try{
      const client:OAuthClient={client_id:this.oauth.client_id,client_secret:this.oauth.client_secret_sealed?await unseal(this.key,this.oauth.client_secret_sealed):null};
      const t=await refreshAccess(this.fetchImpl,metaFromRow(this.oauth),client,await unseal(this.key,this.refreshSealed));
      await storeTokens(this.db,this.key,t,new Date(),this.obtainedAt);
      this.access=t.access_token;this.expiresAt=t.expires_in?Date.now()+t.expires_in*1000:null;
      if(t.refresh_token)this.refreshSealed=await seal(this.key,t.refresh_token);
      this.refreshed=true;
      return this.access;
    }catch(error){
      this.refreshFailed=true;
      const message=error instanceof Error?error.message:'REFRESH_FAILED';
      // Only a rejected grant or client will not fix itself; rate limits,
      // timeouts, 5xx and network errors are retried on the next run.
      await this.fail(message,/_FAILED_40[01]:(invalid_grant|invalid_client|unauthorized_client)/.test(message));
      return null;
    }
  }
  private async fail(message:string,fatal:boolean){
    await this.db.prepare(`UPDATE broker_credentials SET refresh_failures=CASE WHEN ? THEN ${RELOGIN_REQUIRED} ELSE refresh_failures+1 END,last_error=? WHERE id=1 AND obtained_at=?`)
      .bind(fatal?1:0,message.slice(0,200),this.obtainedAt).run();
  }
}

export async function connectionStatus(db:D1Database){
  const [oauth,creds,tools]=await Promise.all([
    db.prepare('SELECT client_id,registered_at,issuer FROM broker_oauth WHERE id=1').first<any>(),
    db.prepare('SELECT obtained_at,refreshed_at,access_expires_at,refresh_failures,last_error,refresh_sealed IS NOT NULL AS has_refresh FROM broker_credentials WHERE id=1').first<any>(),
    db.prepare('SELECT COUNT(*) n,MAX(fetched_at) at FROM broker_tool_catalog').first<any>(),
  ]);
  return {
    registered:!!oauth,logged_in:!!creds,relogin_required:Number(creds?.refresh_failures??0)>=RELOGIN_REQUIRED,
    issuer:oauth?.issuer??null,obtained_at:creds?.obtained_at??null,refreshed_at:creds?.refreshed_at??null,
    access_expires_at:creds?.access_expires_at?new Date(Number(creds.access_expires_at)).toISOString():null,has_refresh_token:!!creds?.has_refresh,
    refresh_failures:Number(creds?.refresh_failures??0),last_error:creds?.last_error??null,tools:Number(tools?.n??0),tools_fetched_at:tools?.at??null,
  };
}
