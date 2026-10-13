import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, cpSync, existsSync} from 'node:fs';
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
 const f=fixture();f.envelope.contract.resources={machine:'xian-m4',profile:'test',device_serial:'ABC123',account_ref:'授权测试'};
 f.envelope.activity_bindings=['preflight','prepare','cleanup'].map((key,i)=>({key,reference_id:'reference-'+i,activity_id:'activity-'+i,activity_definition_version_id:'version-'+i,steps:[{key:key+'_evidence',step_id:'step-'+i}]}));
 f.envelope.definition.expected_path=f.envelope.activity_bindings.flatMap(({steps,key,...binding})=>[{...binding,required:true},...steps.map(step=>({...binding,step_id:step.step_id,required:true}))]);
 writeFileSync(f.file,JSON.stringify(f.envelope));
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
  const shellFacts=status.events.filter(x=>x.type==='activity_completed');
  assert.equal(shellFacts.length,4,'shell must record activity plus step for preflight and cleanup');
  assert.deepEqual(new Set(shellFacts.map(x=>x.data.reference_id)),new Set(['reference-0','reference-2']));
  for(const fact of shellFacts){assert.equal(fact.data.outcome,'pass');assert.ok(fact.data.started_at&&fact.data.ended_at);assert.ok(fact.data.evidence.files.every(x=>existsSync(x.path)));}
  assert.match(readFileSync(join(dir,'preflight-controller.log'),'utf8'),/serial=ABC123/);
  assert.match(readFileSync(join(dir,'preflight-account.log'),'utf8'),/nickname=授权测试/);
  for(const stage of ['preflight','cleanup'])for(const edge of ['start','end'])assert.equal(JSON.parse(readFileSync(join(dir,stage+'-root-'+edge+'.json'))).matches,true);
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
function python(f,body){return spawnSync('python3',['-c',`import importlib.util,json,pathlib,time\nspec=importlib.util.spec_from_file_location('runtime',${JSON.stringify(join(f.dir,'wf-v2.py'))})\nr=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)\n`+body],{env:f.env,encoding:'utf8'});}
test('清理取证异常仍精确放锁；已失败的清理可重入且不重复业务',()=>{
 const f=fixture(),dir=start(f);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
p=r.phone_module.Phone(d,e);p.check_roots('preflight-start',establish=True);calls=[];owner=[e['run_id']]
p.owner=lambda:owner[0]
def ctl(*args):
 calls.append(args)
 if args[0]=='lock-release':owner[0]='free';return 'lock=free'
 if 'snapshot-evidence' in args:raise ValueError('evidence copy interrupted')
 return 'receipt'
p.ctl=ctl
try:p.cleanup()
except ValueError:pass
assert ('lock-release',e['run_id']) in calls,'failed evidence leaked exact owner lock'
r.io.write(d/'envelope.json',e);r.io.write(d/'agent-completion.json',{'status':'ok'});r.io.write(d/'agent-delivery.json',{'status':'completed','outputs':{},'evidence':[],'effects':[]})
r.io.write(d/'cleanup.json',{'completed':False,'evidence':[]})
class CleanupOnly:
 def __init__(self,*args):pass
 def prepare(self):raise AssertionError('business preflight repeated')
 def cleanup(self):
  calls.append(('cleanup-retry',));return {'completed':True,'evidence':['actual-cleanup']}
r.phone_module.Phone=CleanupOnly
r.worker(d)
assert ('cleanup-retry',) in calls,'cached failure never retried'
assert r.io.read(d/'delivery.json')['cleanup']['completed'] is True
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('执行deadline后wait异常仍精确abort；abort异常仍独立读终态',()=>{
 const f=fixture(),dir=start(f);helper(f,'claim-spawn',dir);bind(f,dir);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');e['deadline_at']='2000-01-01T00:00:00Z';r.io.write(d/'envelope.json',e)
calls=[]
def wait(*args,**kwargs):calls.append('wait');raise ValueError('wait unavailable')
def stop(*args):calls.append('abort');raise ValueError('termination unknown')
r.handoff.await_result=wait;r.handoff.stop=stop
r.worker(d)
assert calls==['wait','abort'],calls
assert r.io.read(d/'runtime.json')['execution_stopped'] is False
spec=importlib.util.spec_from_file_location('fresh',r.HERE/'wf-agent-handoff.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
calls=[]
def rpc(method,payload,timeout=20):
 calls.append(method)
 if method=='sessions.abort':raise ValueError('abort response lost')
 return {'runId':r.io.read(d/'agent-binding.json')['child_run_id'],'endedAt':1,'status':'error'}
h.rpc=rpc;h.stop(d)
assert calls==['sessions.abort','agent.wait'],calls
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('phone准备禁止消费cleanup预算；cleanup独立使用原收尾截止时间',()=>{
 const f=fixture(),dir=start(f);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');e['deadline_at']='2000-01-01T00:00:00Z';e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
p=r.phone_module.Phone(d,e);calls=[]
class Result:returncode=0;stdout=b'lock=free'
def run(*args,**kwargs):calls.append(args);return Result()
r.phone_module.subprocess.run=run
try:p.prepare()
except ValueError:pass
assert calls==[],'preparation consumed cleanup budget'
p.cleanup()
assert calls,'cleanup failed to use its reserved budget'
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('部署中旧launch和直接旧runner均不得触发业务或绕过admission',()=>{
 for(const command of ['wf-launch.sh','wf-agent-run.sh']){
  const f=fixture();writeFileSync(join(f.dir,'.deploying'),'');writeFileSync(join(f.home,'ssh'),'#!/bin/sh\ntouch "$HOME/ssh-called"\nexit 0\n',{mode:0o755});f.env.PATH=f.home+':'+process.env.PATH;
  const args=command==='wf-launch.sh'?['keyword_acquisition','xian-m4','test','ABC123','授权测试','--dry-run']:['douyin_video_publish','xian-m4','test','ABC123','授权测试','--tag','cmd10130000','--run-id',f.envelope.run_id,'--task-id',f.envelope.task_id,'--parent-session','agent:work-commander:test'];
  const result=f.call(command,args);assert.notEqual(result.status,0,result.stdout+result.stderr);assert.match(result.stderr+result.stdout,/deployment|部署/);assert.equal(existsSync(join(f.home,'ssh-called')),false);
 }
});
test('通用skill以原始v2信封与正式会话交接为主，不保留旧escort操作指令',()=>{
 const skill=readFileSync(join(source,'skills/workflow-commander/SKILL.md'),'utf8');
 assert.doesNotMatch(skill,/重拉 escort|陪跑 escort 已上岗|Brain 已先登记 task\/run，并将 JSON 信封写到绝对路径/);
 for(const required of ['原始JSON信封','结构化文件工具','session_status','claim-spawn','resolvedProvider','resolvedModel','previous_attempt'])assert.ok(skill.includes(required),required);
});
test('清理失败在剩余预算内不固化delivery，重入只清理并补一次最终回执',()=>{
 const f=fixture(),dir=start(f);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'};r.io.write(d/'envelope.json',e)
r.io.write(d/'agent-completion.json',{'status':'ok'});r.io.write(d/'agent-delivery.json',{'status':'completed','outputs':{'unchanged':True},'evidence':[],'effects':[]})
request=(d/'agent-request.json').read_bytes();calls=[]
class CleanupOnly:
 def __init__(self,*args):pass
 def prepare(self):raise AssertionError('business prepare repeated')
 def cleanup(self):
  calls.append('cleanup');result={'completed':len(calls)>1,'evidence':['real-cleanup']};r.io.write(d/'cleanup.json',result);return result
r.phone_module.Phone=CleanupOnly
r.worker(d)
assert r.io.read(d/'runtime.json')['phase']=='cleanup_pending'
assert not (d/'delivery.json').exists(),'failed cleanup became immutable terminal delivery'
assert not any(x['type']=='delivery' for x in r.io.read(d/'events.json'))
r.worker(d)
assert calls==['cleanup','cleanup']
assert r.io.read(d/'delivery.json')['cleanup']['completed'] is True
assert sum(x['type']=='delivery' for x in r.io.read(d/'events.json'))==1
assert (d/'agent-request.json').read_bytes()==request
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('abort真实耗满分配预算后仍保留官方终态读回时间',()=>{
 const f=fixture(),dir=start(f);helper(f,'claim-spawn',dir);const receipt=bind(f,dir);
 const cli=join(f.home,'openclaw');writeFileSync(cli,`#!/usr/bin/env python3
import json,sys,time,pathlib,os
method=sys.argv[3]
with open(pathlib.Path(os.environ['HOME'])/'rpc-calls','a') as f:f.write(method+'\\n')
if method=='sessions.abort':time.sleep(60)
else:print(json.dumps({'runId':${JSON.stringify(receipt.child_run_id)},'endedAt':1,'status':'error'}))
`,{mode:0o755});f.env.OPENCLAW=cli;
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');from datetime import datetime,timezone
e['cleanup_deadline_at']=datetime.fromtimestamp(time.time()+5.5,timezone.utc).isoformat();r.io.write(d/'envelope.json',e)
r.handoff.stop(d)
assert r.io.read(d/'child-stop-readback.json')['endedAt']==1
`);assert.equal(result.status,0,result.stderr+result.stdout);assert.deepEqual(readFileSync(join(f.home,'rpc-calls'),'utf8').trim().split('\n'),['sessions.abort','agent.wait']);
});
test('部署准入拒绝业务已停但cleanup_pending且无delivery的包',()=>{
 const f=fixture(),dir=start(f);writeFileSync(join(dir,'runtime.json'),JSON.stringify({phase:'cleanup_pending',execution_stopped:true}));
 const deploy=readFileSync(resolve('services/phone-adb-controller/deploy.sh'),'utf8');const script=deploy.split("<<'PYADMISSION'\n")[1].split('\nPYADMISSION')[0];
 writeFileSync(join(f.home,'pgrep'),'#!/bin/sh\nexit 1\n',{mode:0o755});f.env.PATH=f.home+':'+process.env.PATH;
 const result=spawnSync('python3',['-c',script],{env:f.env,encoding:'utf8'});assert.notEqual(result.status,0,'cleanup pending deployment was admitted');assert.equal(existsSync(join(f.home,'.openclaw/commander/.deploying')),false);
});
test('外壳绑定缺失先拒绝；失败preflight重入仍失败且不重复设备动作',()=>{
 const f=fixture(),dir=start(f);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');path={'reference_id':'ref','activity_id':'act','activity_definition_version_id':'version'}
e['definition']['expected_path']=[path,dict(path,step_id='step')]
class Phone:directory=d;envelope=e;cleanup_deadline=time.time()+30;control_receipts=[]
p=Phone();calls=[]
def fail():calls.append('device');raise ValueError('real preflight failure')
try:r.phone_module.shell.execute(p,'preflight',fail);raise AssertionError('missing binding accepted')
except ValueError as error:assert 'binding' in str(error)
assert calls==[]
e['activity_bindings']=[dict(path,key='preflight',steps=[{'key':'check','step_id':'step'}])]
for i in range(2):
 try:r.phone_module.shell.execute(p,'preflight',fail);raise AssertionError('failed preflight replay became success')
 except ValueError as error:assert 'real preflight failure' in str(error)
assert calls==['device']
facts=[x for x in r.io.read(d/'events.json') if x['type']=='activity_completed']
assert len(facts)==2 and all(x['data']['outcome']=='fail' for x in facts)
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('cleanup中间失败只记blocked且原件不可覆盖；最终唯一pass并可重放，预算耗尽才fail',()=>{
 const f=fixture(),dir=start(f);
 const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');path={'reference_id':'ref','activity_id':'act','activity_definition_version_id':'version'}
e['definition']['expected_path']=[path,dict(path,step_id='step')];e['activity_bindings']=[dict(path,key='cleanup',steps=[{'key':'check','step_id':'step'}])]
class Phone:directory=d;envelope=e;cleanup_deadline=time.time()+30;control_receipts=[]
p=Phone();calls=[]
def clean():
 calls.append('cleanup');(d/'cleanup-original.log').write_text('raw-'+str(len(calls)));return {'completed':len(calls)>1,'failure':'lost screenshot' if len(calls)==1 else None}
shell=r.phone_module.shell
assert shell.execute(p,'cleanup',clean)['completed'] is False
assert not any(x['type']=='activity_completed' for x in r.io.read(d/'events.json'))
blocked=[x for x in r.io.read(d/'events.json') if x['type']=='blocked'];assert len(blocked)==1
original=[x for x in blocked[0]['data']['evidence']['files'] if x['path'].endswith('cleanup-original.log')][0]
assert pathlib.Path(original['path']).read_text()=='raw-1'
assert shell.execute(p,'cleanup',clean)['completed'] is True
assert pathlib.Path(original['path']).read_text()=='raw-1'
assert shell.execute(p,'cleanup',clean)['completed'] is True and len(calls)==2
facts=[x for x in r.io.read(d/'events.json') if x['type']=='activity_completed'];assert len(facts)==2 and all(x['data']['outcome']=='pass' for x in facts)
# 模拟终态checkpoint写好、outbox尚未写齐；重放一次补齐，第二次幂等。
r.io.write(d/'events.json',[x for x in r.io.read(d/'events.json') if x['type']!='activity_completed'])
shell.replay(d,'cleanup');shell.replay(d,'cleanup')
assert sum(x['type']=='activity_completed' for x in r.io.read(d/'events.json'))==2
(d/'shell-cleanup.json').unlink();p.cleanup_deadline=time.time()-1
shell.execute(p,'cleanup',lambda:{'completed':False,'failure':'budget exhausted'})
assert all(x['outcome']=='fail' for x in r.io.read(d/'shell-cleanup.json')['facts'])
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('真实执行包和run根stat前后绑定，路径同名替换inode拒绝且清理仍精确放锁',()=>{
 for(const target of ['run','package','evidence']){
  const f=fixture(),dir=start(f);
  const result=python(f,`import shutil
d=pathlib.Path(${JSON.stringify(dir)})
`.trimStart()+`
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
p=r.phone_module.Phone(d,e);p.check_roots('preflight-start',establish=True);p.check_roots('preflight-end')
root={'run':d,'package':r.HERE,'evidence':d/'evidence'}[${JSON.stringify(target)}]
old=root.with_name(root.name+'-old');root.rename(old);shutil.copytree(old,root)
try:p.check_roots('cleanup-start');raise AssertionError('same path different inode accepted')
except ValueError as error:assert 'root identity' in str(error)
calls=[]
def ctl(*args):
 calls.append(args)
 if args[0]=='lock-status':return 'lock=free'
 return 'lock=free'
p.ctl=ctl
receipt=p.cleanup();assert receipt['completed'] is False
assert ('lock-release',e['run_id']) in calls,'root error skipped exact release'
readback=r.io.read(d/'cleanup-root-start.json');assert readback['matches'] is False
`);assert.equal(result.status,0,result.stderr+result.stdout);
 }
});
test('MMV gateway_exec结构化env示例可执行、无损落盘且拒绝覆盖冲突',()=>{
 const f=fixture();const skill=readFileSync(join(source,'skills/workflow-commander/SKILL.md'),'utf8');
 const block=skill.split('<!-- gateway-envelope-write -->')[1];assert.ok(block,'missing executable gateway envelope example');
 const call=JSON.parse(block.split('```json\n')[1].split('\n```')[0]);
 assert.equal(call.timeoutSeconds,30);assert.ok(call.command.includes('os.environ'));assert.doesNotMatch(call.command,/中文|touch \/tmp/);
 const execute=envelope=>spawnSync('bash',['-c',call.command],{env:{...f.env,WF_ENVELOPE_JSON:JSON.stringify(envelope)},encoding:'utf8'});
 const first=execute(f.envelope);assert.equal(first.status,0,first.stderr);
 const result=JSON.parse(first.stdout);assert.deepEqual(JSON.parse(readFileSync(result.envelope_path)),f.envelope);
 assert.equal(execute(f.envelope).status,0);assert.notEqual(execute({...f.envelope,input:{changed:true}}).status,0);
 assert.notEqual(execute({...f.envelope,recovery:{max_attempts:true}}).status,0,'JSON boolean must not equal number');
 assert.deepEqual(JSON.parse(readFileSync(result.envelope_path)),f.envelope);
 const dir=start(f),request=JSON.parse(readFileSync(join(dir,'agent-request.json')));assert.equal(request.execution_location.tool,'gateway_exec');assert.equal(request.execution_location.host,'mmv');assert.match(readFileSync(join(dir,'msg.txt'),'utf8'),/模型本机不是MMV/);
 assert.ok(skill.includes('gateway_process'));assert.ok(skill.includes('WF_BINDING_JSON'));assert.ok(skill.includes('模型本机'));
 const special=readFileSync(join(source,'skills/wf-douyin_video_publish/SKILL.md'),'utf8');
 assert.match(special,/version: 0\.1\.2/);assert.match(special,/multi-platform-publish/);assert.doesNotMatch(special,/android-douyin-private-video|45 分钟|wf-status\.sh mmv/);
});
test('阶段原子回执后崩溃可恢复同次shell事实：不重复设备、不新编时间或证据',()=>{
 for(const key of ['preflight','cleanup']){
  const f=fixture(),dir=start(f);const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)});key=${JSON.stringify(key)}
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
path={'reference_id':'ref','activity_id':'act','activity_definition_version_id':'version'}
e['definition']['expected_path']=[path,dict(path,step_id='step')];e['activity_bindings']=[dict(path,key=key,steps=[{'key':'check','step_id':'step'}])]
r.io.write(d/'envelope.json',e);p=r.phone_module.Phone(d,e);shell=r.phone_module.shell;calls=[]
def completed():
 calls.append('actual-device');(d/(key+'-original.log')).write_text('actual original')
 shell.commit_receipt(p,key,{'completed':True,'evidence':[str(d/(key+'-original.log'))]})
 raise SystemExit('worker died after durable phone phase receipt')
try:shell.execute(p,key,completed)
except SystemExit:pass
receipt=r.io.read(d/(key+'.json'));assert receipt['_shell']['ended_at']
assert not r.io.read(d/('shell-'+key+'.json'))['terminal']
new=r.phone_module.Phone(d,e);shell.recover(new,key);shell.recover(new,key)
facts=[x for x in r.io.read(d/'events.json') if x['type']=='activity_completed'];assert len(facts)==2
for fact in facts:
 assert fact['data']['started_at']==receipt['_shell']['started_at']
 assert fact['data']['ended_at']==receipt['_shell']['ended_at']
 assert fact['data']['outcome']=='pass'
 assert any(pathlib.Path(x['path']).read_text()=='actual original' for x in fact['data']['evidence']['files'] if x['path'].endswith('.log'))
assert calls==['actual-device']
assert shell.execute(new,key,lambda:(_ for _ in ()).throw(AssertionError('device repeated')))['completed'] is True
`);assert.equal(result.status,0,result.stderr+result.stdout);
 }
});
test('worker在phone阶段标记落盘后退出，重入先补shell事实再handoff或delivery',()=>{
 for(const key of ['preflight','cleanup']){
  const f=fixture(),dir=start(f);const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)});key=${JSON.stringify(key)}
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
path={'reference_id':'ref','activity_id':'act','activity_definition_version_id':'version'}
e['definition']['expected_path']=[path,dict(path,step_id='step')];e['activity_bindings']=[dict(path,key=key,steps=[{'key':'check','step_id':'step'}])];r.io.write(d/'envelope.json',e)
if key=='cleanup':
 r.io.write(d/'agent-completion.json',{'status':'ok'});r.io.write(d/'agent-delivery.json',{'status':'completed','outputs':{'preserved':True},'evidence':[],'effects':[]})
calls=[]
def phase(self):
 calls.append('phone');(d/(key+'-original.log')).write_text('controller raw receipt')
 r.phone_module.shell.commit_receipt(self,key,{'completed':True,'evidence':[str(d/(key+'-original.log'))]})
 raise SystemExit('process killed')
setattr(r.phone_module.Phone,'_'+('prepare' if key=='preflight' else 'cleanup'),phase)
try:r.worker(d)
except SystemExit:pass
assert calls==['phone']
original=r.io.read(d/(key+'.json'))['_shell']
if key=='preflight':
 def handoff(*args):raise SystemExit('next business handoff')
 r.make_request=handoff
try:r.worker(d)
except SystemExit:pass
assert calls==['phone'],'phone callback repeated after durable receipt'
facts=[x for x in r.io.read(d/'events.json') if x['type']=='activity_completed'];assert len(facts)==2
assert all(x['data']['ended_at']==original['ended_at'] for x in facts)
if key=='cleanup':
 assert r.io.read(d/'delivery.json')['status']=='completed'
 assert r.io.read(d/'events.json')[-1]['type']=='delivery'
`);assert.equal(result.status,0,result.stderr+result.stdout);
 }
});
test('历史阶段标记缺原子事实元数据明确拒绝补造成功',()=>{
 const f=fixture(),dir=start(f);const result=python(f,`d=pathlib.Path(${JSON.stringify(dir)})
e=r.io.read(d/'envelope.json');e['contract']['resources']={'machine':'xian-m4','profile':'test','device_serial':'ABC123','account_ref':'授权测试'}
p=r.phone_module.Phone(d,e);r.io.write(d/'cleanup.json',{'completed':True,'evidence':['old']})
try:r.phone_module.shell.recover(p,'cleanup');raise AssertionError('legacy marker fabricated facts')
except ValueError as error:assert 'durable shell attempt identity' in str(error)
assert not any(x['type']=='activity_completed' for x in r.io.read(d/'events.json'))
`);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('同一release ready按workflow固定摘要握手，多workflow未知或串用摘要均拒绝',()=>{
 const f=fixture();const workflows=Object.fromEntries(['workflow.meta','workflow_report.internal','douyin_video_publish.android'].map((key,i)=>[key,{snapshot_sha256:String(i+1).repeat(64)}]));
 const seal=releases=>{const result=spawnSync('python3',[join(f.dir,'wf-v2-io.py'),'manifest',f.dir,JSON.stringify(releases)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(readFileSync(join(f.dir,'runtime-manifest.json')));};
 const manifest=seal({'release-test':{workflows}});
 const ready=(key,snapshot,definition={})=>f.call('wf-launch.sh',['--ready'],{workflow_key:key,definition:{...f.definition,snapshot_sha256:snapshot,runtime_snapshot_sha256:manifest.runtime_snapshot_sha256,...definition}});
 for(const [key,value] of Object.entries(workflows)){
  const result=ready(key,value.snapshot_sha256);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{protocol:'commander-v2',ready:true,release_id:'release-test',snapshot_sha256:value.snapshot_sha256,runtime_snapshot_sha256:manifest.runtime_snapshot_sha256});
 }
 for(const [key,snapshot,definition] of [['missing.workflow','1'.repeat(64),{}],['workflow.meta','2'.repeat(64),{}],['workflow.meta','1'.repeat(64),{release_id:'missing-release'}],['workflow.meta','1'.repeat(64),{runtime_snapshot_sha256:'f'.repeat(64)}]])assert.notEqual(ready(key,snapshot,definition).status,0);
 for(const invalid of [null,[],{'workflow.meta':{}},{'workflow.meta':{snapshot_sha256:null}},{'workflow.meta':{snapshot_sha256:'invalid'}}]){
  // 显式新shape损坏时不得退回旁边碰巧匹配的旧字段。
  seal({'release-test':{workflows:invalid,workflow_key:'workflow.meta',snapshot_sha256:'1'.repeat(64)}});
  assert.notEqual(ready('workflow.meta','1'.repeat(64)).status,0);
  assert.notEqual(ready('workflow.meta','invalid').status,0);
 }
 seal({'release-test':{workflows}});writeFileSync(join(f.dir,'wf-agent-lib.py'),'# component changed');assert.notEqual(ready('workflow.meta','1'.repeat(64)).status,0);
 assert.equal(existsSync(join(f.home,'wf-agent-runs')),false,'ready must not start any run');
});
