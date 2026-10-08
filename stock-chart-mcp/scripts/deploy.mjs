import {spawnSync} from 'node:child_process';
function wrangler(args){
 const r=spawnSync('npx',['--no-install','wrangler',...args],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'inherit',timeout:180000});
 if(r.status!==0)throw Error(`Wrangler ${args[0]} failed; exit ${r.status}`);
}
// First deploy provisions D1 if needed; then the schema is applied.
wrangler(['deploy']);
wrangler(['d1','migrations','apply','DB','--remote']);
