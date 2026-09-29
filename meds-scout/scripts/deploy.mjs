import {spawnSync} from 'node:child_process';
// Cloudflare Workers Builds supplies its own deployment authentication.
// No manually supplied Cloudflare API token or GitHub Actions secrets required.
function wrangler(args){
 const r=spawnSync('npx',['--no-install','wrangler',...args],{
  env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'inherit',timeout:180000});
 if(r.status!==0)throw Error(`Wrangler ${args[0]} failed; exit ${r.status}`);
}
// Missing D1 ID opts into Wrangler automatic provisioning. On deploy, Wrangler
// writes the resolved resource ID into this build's config for the migration.
// SCOUT_ENABLED=false prevents scans while the schema is being installed.
wrangler(['deploy','--var','SCOUT_ENABLED:false']);
wrangler(['d1','migrations','apply','MEDS_DB','--remote']);
wrangler(['deploy']);
