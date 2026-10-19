import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const source=resolve('services/phone-adb-controller/commander');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const hash=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');
export function fixture(){
 const home=mkdtempSync(join(tmpdir(),'commander-v2-')); const dir=join(home,'commander');cpSync(source,dir,{recursive:true});
 const definition={release_id:'release-test',snapshot_sha256:'a'.repeat(64)};
 const env={...process.env,HOME:home,WF_BRAIN_URL:'http://127.0.0.1:1',WF_V2_NO_WORKER:'1'};
 const envelope={protocol:'commander-v2',task_id:'1234abcd-0000-4000-8000-000000000001',run_id:'wfd-test',workflow_key:'report.generic',attempt:1,owner_epoch:1,deadline_at:new Date(Date.now()+600000).toISOString(),cleanup_deadline_at:new Date(Date.now()+660000).toISOString(),input:{text:'中文\n$(touch /tmp/commander-must-not-execute) `id`',empty:[]},definition,contract:{execution_profile:'codex_agent',resources:{},activities:[{key:'report',by:'agent'}]},recovery:{max_attempts:1}};envelope.input_sha256=hash(envelope.input);
 const file=join(home,'envelope.json');writeFileSync(file,JSON.stringify(envelope));
 function call(cmd,args=[],input){return spawnSync('bash',[join(dir,cmd),...args],{env,encoding:'utf8',input:input&&JSON.stringify(input)});}
 return {home,dir,definition,env,envelope,file,call};
}
export function start(f){
 const r=spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify({'release-test':{snapshot_sha256:f.definition.snapshot_sha256,workflow_key:'report.generic'}})],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const launch=f.call('wf-launch.sh',['--envelope',f.file,'--parent-session','agent:work-commander:test']);assert.equal(launch.status,0,launch.stdout+launch.stderr);
 return join(f.home,'wf-agent-runs',f.envelope.run_id);
}
