import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve('services/phone-adb-controller/commander');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');
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
function start(f){
 const r=spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify({'release-test':{snapshot_sha256:f.definition.snapshot_sha256,workflow_key:'report.generic'}})],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const launch=f.call('wf-launch.sh',['--envelope',f.file,'--parent-session','agent:work-commander:test']);assert.equal(launch.status,0,launch.stdout+launch.stderr);
 return join(f.home,'wf-agent-runs',f.envelope.run_id);
}
function helper(f,command,dir,input){return spawnSync('python3',[join(f.dir,'wf-v2.py'),command,dir],{env:f.env,input:input&&JSON.stringify(input),encoding:'utf8'});}
function bind(f,dir){
 const request=JSON.parse(readFileSync(join(dir,'agent-request.json')));
 const receipt=Object.fromEntries(['run_id','task_id','parent_session_key','nonce'].map(k=>[k,request[k]]));
 Object.assign(receipt,{child_session_key:'agent:skill-factory:subagent:v2',child_run_id:'1234abcd-0000-4000-8000-000000000002'});
 const r=spawnSync('python3',[join(f.dir,'wf-agent-handoff.py'),'bind',dir],{env:f.env,input:JSON.stringify(receipt),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return receipt;
}
test('唯一spawn领取跨重入持久；绑定活child恢复只await，预算变更拒绝',()=>{
 const f=fixture(),dir=start(f);
 assert.equal(helper(f,'claim-spawn',dir).status,0);assert.notEqual(helper(f,'claim-spawn',dir).status,0);
 const args=['--envelope',f.file,'--parent-session','agent:work-commander:test'];
 assert.equal(JSON.parse(f.call('wf-launch.sh',args).stdout).action,'blocked');bind(f,dir);
 assert.equal(JSON.parse(f.call('wf-launch.sh',args).stdout).action,'await');
 f.envelope.deadline_at=new Date(Date.now()+900000).toISOString();writeFileSync(f.file,JSON.stringify(f.envelope));
 assert.notEqual(f.call('wf-launch.sh',args).status,0);
});
test('非手机官方child终态输出无损，丢反馈跨worker重入幂等补账',()=>{
 const f=fixture(),dir=start(f);helper(f,'claim-spawn',dir);const receipt=bind(f,dir);
 const outputs={text:'长文\n中文\n"$(id)"',empty:[],nested:{value:false}};
 const agent={status:'success',outputs,evidence:['report.json'],effects:[{key:f.envelope.task_id+':report',status:'none',receipt:{read_only:true}}],failure:null};
 const terminal={runId:receipt.child_run_id,status:'ok',endedAt:Date.now(),terminalReceipt:{runId:receipt.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}},terminalReply:{text:'WF_DELIVERY '+JSON.stringify(agent)}};
 const cli=join(f.home,'openclaw');writeFileSync(cli,'#!/usr/bin/env python3\nimport sys\nassert sys.argv[1:4]==["gateway","call","agent.wait"]\nprint('+JSON.stringify(JSON.stringify(terminal))+')\n',{mode:0o755});f.env.OPENCLAW=cli;
 assert.equal(helper(f,'worker',dir).status,0);
 const status=JSON.parse(f.call('wf-status.sh',[f.envelope.run_id]).stdout);
 assert.equal(status.execution_stopped,true);assert.equal(status.state,'awaiting_verify');
 assert.deepEqual(status.delivery.outputs,outputs);assert.deepEqual(status.delivery.input,f.envelope.input);assert.deepEqual(status.delivery.definition,f.definition);assert.equal(status.delivery.cleanup.completed,true);
 const events=status.events;assert.equal(events.filter(e=>e.type==='delivery').length,1);assert.deepEqual(events.map(e=>e.seq),events.map((_,i)=>i+1));
 assert.equal(helper(f,'worker',dir).status,0);assert.deepEqual(JSON.parse(f.call('wf-status.sh',[f.envelope.run_id]).stdout).events,events);
});
test('未知child活性保留blocked且不释放执行，不重复发起',()=>{
 const f=fixture(),dir=start(f);helper(f,'claim-spawn',dir);bind(f,dir);
 const cli=join(f.home,'openclaw');writeFileSync(cli,'#!/bin/sh\nexit 1\n',{mode:0o755});f.env.OPENCLAW=cli;
 assert.equal(helper(f,'worker',dir).status,0);const status=JSON.parse(f.call('wf-status.sh',[f.envelope.run_id]).stdout);
 assert.equal(status.execution_stopped,false);assert.equal(status.state,'blocked');assert.equal(status.action,'await');assert.equal(status.delivery,undefined);
 assert.notEqual(helper(f,'claim-spawn',dir).status,0);
});
test('输入摘要错配和未部署release均零运行副作用',()=>{
 for(const kind of ['input','release']){
  const f=fixture();spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify({'release-test':{snapshot_sha256:f.definition.snapshot_sha256,workflow_key:'report.generic'}})]);
  if(kind==='input')f.envelope.input.text='changed';else f.envelope.definition.release_id='unregistered';writeFileSync(f.file,JSON.stringify(f.envelope));
  assert.notEqual(f.call('wf-launch.sh',['--envelope',f.file,'--parent-session','agent:work-commander:test']).status,0);
 }
});
test('数值指数与Unicode键按Brain JSON摘要一致，部署进行中拒绝ready',()=>{
 const f=fixture();f.envelope.input={number:1e-7,big:1e20,unicode:{'𐀀':1,'\ue000':2}};f.envelope.input_sha256=hash(f.envelope.input);writeFileSync(f.file,JSON.stringify(f.envelope));start(f);
 writeFileSync(join(f.dir,'.deploying'),'');const ready=f.call('wf-launch.sh',['--ready'],{definition:f.definition,workflow_key:'report.generic'});assert.notEqual(ready.status,0);assert.match(ready.stdout,/deployment in progress/);
});
test('反馈断网后按原seq重放，0600凭据仅存在Authorization头',async()=>{
 const {createServer}=await import('node:http');const {spawn}=await import('node:child_process');
 const f=fixture(),dir=start(f);helper(f,'event',dir,{type:'activity_completed',data:{reference_id:'ref',outcome:'pass',evidence:{path:'报告.json'}}});
 const expected=JSON.parse(readFileSync(join(dir,'events.json')));const token=join(f.home,'internal-token');writeFileSync(token,'test-secret-only-in-header',{mode:0o600});f.env.WF_INTERNAL_TOKEN_FILE=token;
 const received=[];let fail=true;
 const server=createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{assert.equal(req.headers.authorization,'Bearer test-secret-only-in-header');received.push(JSON.parse(body));res.statusCode=fail?503:200;res.end('{}');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));f.env.WF_BRAIN_URL='http://127.0.0.1:'+server.address().port;
 const replay=()=>new Promise((resolve,reject)=>{const p=spawn('python3',[join(f.dir,'wf-v2.py'),'replay',dir],{env:f.env,stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});
 try{assert.equal(await replay(),0);fail=false;assert.equal(await replay(),0);assert.deepEqual(received,[expected[0],...expected]);received.length=0;assert.equal(await replay(),0);assert.deepEqual(received,[]);assert.equal(readFileSync(join(dir,'events.json'),'utf8').includes('test-secret'),false);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('v2手机共享控制器外壳：精确owner、官方child停止后桌面原件与放锁读回',async()=>{
 const {spawn}=await import('node:child_process');const {existsSync}=await import('node:fs');
 const f=fixture();f.envelope.contract.resources={machine:'xian-m4',profile:'test',device_serial:'ABC123',account_ref:'授权测试'};writeFileSync(f.file,JSON.stringify(f.envelope));
 const dir=start(f);const ssh=join(f.home,'ssh');
 writeFileSync(ssh,`#!/usr/bin/env python3
import sys,os,pathlib,shlex
home=pathlib.Path(os.environ['HOME']);cmd=sys.argv[-1]
with open(home/'calls','a') as f:f.write(cmd+'\\n')
if cmd.startswith('cat '):
 if cmd.endswith('.png'):sys.stdout.buffer.write(b'\\x89PNG\\r\\n\\x1a\\n'+bytes.fromhex('49454e44ae426082'))
 else:print('<hierarchy><node package="com.launcher"/></hierarchy>')
 sys.exit(0)
a=shlex.split(cmd.split('; ',1)[1])[3:]
owner=home/'owner'
if a[:1]==['--lock-owner']:
 assert a[1]=='wfd-test' and owner.read_text()=='wfd-test';a=a[2:]
op=a[0]
if op=='preflight':print('serial=ABC123 state=device')
elif op=='lock-status':print('lock=held owner='+owner.read_text() if owner.exists() else 'lock=free')
elif op=='lock-acquire':owner.write_text(a[1]);print('lock=acquired owner='+a[1])
elif op=='account-current':print('nickname=授权测试')
elif op=='return-safe-desktop':print('launcher=com.launcher\\nforeground_package=com.launcher')
elif op=='lock-release':assert owner.read_text()==a[1];owner.unlink();print('lock=free')
else:print('ok')
`,{mode:0o755});f.env.PATH=f.home+':'+process.env.PATH;
 const childId='1234abcd-0000-4000-8000-000000000002';
 const terminal={runId:childId,status:'ok',endedAt:Date.now(),terminalReceipt:{runId:childId,effective:{provider:'openai',model:'gpt-6.1-sol'}},terminalReply:{text:'WF_DELIVERY '+JSON.stringify({status:'completed',outputs:{report:'手机读回'},evidence:['screen'],effects:[{key:f.envelope.task_id+':read',status:'none',receipt:{}}]})}};
 const cli=join(f.home,'openclaw');writeFileSync(cli,'#!/usr/bin/env python3\nprint('+JSON.stringify(JSON.stringify(terminal))+')\n',{mode:0o755});f.env.OPENCLAW=cli;
 const worker=spawn('python3',[join(f.dir,'wf-v2.py'),'worker',dir],{env:f.env,stdio:'ignore'});const done=new Promise(resolve=>worker.once('exit',resolve));
 try{
  for(let i=0;i<70&&!existsSync(join(dir,'agent-request.json'));i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(existsSync(join(dir,'agent-request.json')),true);helper(f,'claim-spawn',dir);bind(f,dir);assert.equal(await done,0);
  const status=JSON.parse(f.call('wf-status.sh',[f.envelope.run_id]).stdout);assert.equal(status.delivery.status,'completed');assert.equal(status.delivery.cleanup.completed,true);assert.equal(existsSync(join(f.home,'owner')),false);
  const calls=readFileSync(join(f.home,'calls'),'utf8');assert.match(calls,/lock-acquire wfd-test/);assert.match(calls,/--lock-owner wfd-test close-app/);assert.match(calls,/lock-release wfd-test/);
 }finally{if(worker.exitCode===null){worker.kill('SIGTERM');await done;}}
});
test('deadline跨重启不变：只补预算内官方终态，晚终态拒绝冒充成功',()=>{
 for(const late of [false,true]){
  const f=fixture(),dir=start(f);helper(f,'claim-spawn',dir);const receipt=bind(f,dir);
  const request=JSON.parse(readFileSync(join(dir,'agent-request.json')));request.expires_at=Date.now()/1000-2;writeFileSync(join(dir,'agent-request.json'),JSON.stringify(request));
  const terminal={runId:receipt.child_run_id,status:'ok',endedAt:(request.expires_at+(late?1:-1))*1000,terminalReceipt:{runId:receipt.child_run_id,effective:{provider:'openai',model:'gpt-6.1-sol'}},terminalReply:{text:'WF_DELIVERY '+JSON.stringify({status:'completed',outputs:{recovered:true},evidence:['original'],effects:[]})}};
  const cli=join(f.home,'openclaw');writeFileSync(cli,'#!/usr/bin/env python3\nprint('+JSON.stringify(JSON.stringify(terminal))+')\n',{mode:0o755});f.env.OPENCLAW=cli;
  helper(f,'worker',dir);const status=JSON.parse(f.call('wf-status.sh',[f.envelope.run_id]).stdout);
  if(late){assert.equal(status.execution_stopped,true);assert.equal(status.delivery.status,'failed');}else{assert.equal(status.delivery.status,'completed');assert.equal(status.execution_stopped,true);assert.notEqual(helper(f,'event',dir,{type:'activity_completed',data:{}}).status,0);}
  assert.equal(JSON.parse(readFileSync(join(dir,'agent-request.json'))).expires_at,request.expires_at);
 }
});
