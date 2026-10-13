import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve('services/phone-adb-controller/commander');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const home=mkdtempSync(join(tmpdir(),'commander-v2-')); const dir=join(home,'commander');cpSync(source,dir,{recursive:true});
 const definition={release_id:'release-test',snapshot_sha256:'a'.repeat(64)};
 const env={...process.env,HOME:home,WF_BRAIN_URL:'http://127.0.0.1:1',WF_V2_NO_WORKER:'1'};
 const envelope={protocol:'commander-v2',task_id:'1234abcd-0000-4000-8000-000000000001',run_id:'wfd-test',workflow_key:'report.generic',attempt:1,owner_epoch:1,deadline_at:new Date(Date.now()+600000).toISOString(),cleanup_deadline_at:new Date(Date.now()+660000).toISOString(),input:{text:'中文\n$(touch /tmp/commander-must-not-execute) `id`',empty:[]},definition,contract:{execution_profile:'codex_agent',resources:{},activities:[{key:'report',by:'agent'}]},recovery:{max_attempts:1}};envelope.input_sha256=hash(envelope.input);
 const file=join(home,'envelope.json');writeFileSync(file,JSON.stringify(envelope));
 function call(cmd,args=[],input){return spawnSync('bash',[join(dir,cmd),...args],{env,encoding:'utf8',input:input&&JSON.stringify(input)});}
 return {home,dir,definition,env,envelope,file,call};
}
test('v2 ready实际验证整包manifest，缺包拒绝，标准入口识别协议',()=>{
 const f=fixture();const r=f.call('wf-launch.sh',['--ready'],{definition:f.definition,workflow_key:'report.generic'});
 assert.match(r.stdout,/"protocol"\s*:\s*"commander-v2"/);assert.notEqual(r.status,0);
});
test('v2无手机信封启动保留输入，重复启动复用request与deadline',()=>{
 const f=fixture();
 const manifest=spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify({'release-test':{snapshot_sha256:f.definition.snapshot_sha256,workflow_key:'report.generic'}})],{encoding:'utf8'});assert.equal(manifest.status,0,manifest.stderr);
 const ready=f.call('wf-launch.sh',['--ready'],{definition:f.definition,workflow_key:'report.generic'});assert.equal(ready.status,0,ready.stderr);
 const args=['--envelope',f.file,'--parent-session','agent:work-commander:test'];
 let r=f.call('wf-launch.sh',args);assert.equal(r.status,0,r.stderr);
 const run=join(f.home,'wf-agent-runs',f.envelope.run_id);const original=readFileSync(join(run,'agent-request.json'),'utf8');
 assert.deepEqual(JSON.parse(readFileSync(join(run,'input.json'))),f.envelope.input);
 r=f.call('wf-launch.sh',args);assert.equal(r.status,0,r.stderr);assert.equal(readFileSync(join(run,'agent-request.json'),'utf8'),original);
 const status=f.call('wf-status.sh',[f.envelope.run_id]);assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).execution_stopped,false);
 writeFileSync(join(f.dir,'wf-agent-lib.py'),'# deployment drift');assert.notEqual(f.call('wf-launch.sh',['--ready'],{definition:f.definition,workflow_key:'report.generic'}).status,0);
});
