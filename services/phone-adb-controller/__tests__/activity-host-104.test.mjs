import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/activity-host-104.json',import.meta.url)));
const implementation=new URL('../activity-host-104.mjs',import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
const roots=[];
function setup(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'activity104-')));roots.push(root);
 const baseRoot=path.join(root,'base'),localBaseRoot=path.join(root,'local'),runtime=path.join(root,'runtime');
 for(const [dir,files] of [[baseRoot,fixture.files],[localBaseRoot,fixture.local]])for(const [n,f]of Object.entries(files)){assert.equal(hash(f.source),f.sha256);fs.mkdirSync(path.dirname(path.join(dir,n)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,n),f.source,{mode:0o600});}
 fs.mkdirSync(runtime,{mode:0o700});for(const n of ['controller','registry','adb-policy','state','evidence'])fs.writeFileSync(path.join(runtime,n),'fixture-'+n,{mode:0o600});
 const auth={schema:'run-send-authorization/v1',root_task_id:'root-task',decision_id:'decision',message:'测试正文',message_sha256:hash('测试正文'),max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
 const authPath=path.join(root,'auth.json');fs.writeFileSync(authPath,JSON.stringify(auth),{mode:0o600});
 const context={assigned_workflow:'104',root_task_id:'root-task',actor:'fixture',source_commit:'a'.repeat(40),runtime_root:runtime,transport:'local',host:'fixture-host',profile:'fixture-phone',serial:'hardware-1',adb_serial:'127.0.0.1:15555',company_id:'company-1',tenant_id:'tenant-1',line:'fixture-line',account:'sender-1',sender_id:'sender-1',local_owner:'local-1',central_owner:'task-1',tasks:{'104':{task_id:'task-1',run_id:'run-1',run_tag:'tag-1'}},business_deadline_ms:Date.now()+3600000,cleanup_deadline_ms:Date.now()+4200000,python:process.env.PYTHON||'python3',native_root:path.join(runtime,'evidence'),credentials:{database:path.join(root,'db.json'),feishu:path.join(root,'feishu.json'),brain:path.join(root,'brain.env'),provider_env_files:[]},authorization_asset:{path:authPath,sha256:hash(fs.readFileSync(authPath))},verification:{policy_id:'policy',policy_version:1,pg:{deployment:{source_commit:'a'.repeat(40)}},runtime_sha256:{},'104':{record_id:'record',comment_id:'comment',lead_id:'lead',target_douyin_id:'target',profile_url:'https://v.douyin.com/fixture/',source_102_run:'new102',source_103_run:'new103'}},outreach_runtime:{state_directory:path.join(root,'state'),evidence_base:path.join(root,'evidence'),lock_root:path.join(root,'locks'),account_bindings:[{host:'fixture-host',profile:'fixture-phone',serial:'127.0.0.1:15555'}],history_assets:[]}};
 for(const [k,n]of Object.entries({phone_controller:'controller',phone_registry:'registry',adb_host_config:'adb-policy'})){context[k]=path.join(runtime,n);context[k+'_sha256']=hash(fs.readFileSync(context[k]));}
 const pgHost=new URL('../activity-host-pg.mjs',import.meta.url);const pgHelper={path:pgHost.pathname,sha256:hash(fs.readFileSync(pgHost))};
 return {root,baseRoot,localBaseRoot,context,pgHelper,targetRoot:path.join(root,'candidate')};
}
async function candidate(f){
 if(fs.existsSync(implementation))return (await import(implementation)).assembleActivity104Host(f);
 fs.cpSync(f.baseRoot,f.targetRoot,{recursive:true});return {status:'legacy-baseline'};
}
test.after(()=>roots.forEach(r=>fs.rmSync(r,{recursive:true,force:true})));
test('real frozen 104 accepts an explicit current runtime before any PG or order access',async()=>{
 const f=setup();await candidate(f);
 const api=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/runtime-deps.mjs')));
 // The original source fails RUNTIME_NOT_PINNED; new source must validate the separately frozen context first.
 await assert.rejects(api.createRuntimeDeps(f.context,f.context.verification['104']),/PARENT_CREDENTIAL_ENV_REQUIRED/);
});
test('wrong authorization/root/order/source rejects before runtime module execution',async()=>{
 const f=setup();await candidate(f);const api=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/runtime-deps.mjs')));
 for(const mutate of [c=>c.company_id='other',c=>c.account='other',c=>c.root_task_id='other',c=>c.verification['104'].record_id='other',c=>c.source_commit='b'.repeat(40),c=>c.authorization_asset.sha256='0'.repeat(64)]){
  const c=structuredClone(f.context);mutate(c);await assert.rejects(api.createRuntimeDeps(c,c.verification['104']),/104_(CONTEXT|AUTHORIZATION|SOURCE)/);
 }
 assert.equal(fs.existsSync(path.join(f.root,'external-effects')),false);
});
test('assembly does not modify legacy source and rejects tampering before output',async()=>{
 const f=setup();await candidate(f);for(const [n,v]of Object.entries(fixture.files))assert.equal(hash(fs.readFileSync(path.join(f.baseRoot,n))),v.sha256);
 const bad=setup();fs.appendFileSync(path.join(bad.baseRoot,'outreach104/phone_guard.py'),'\n# changed');
 await assert.rejects(candidate(bad),/104_BASE/);assert.equal(fs.existsSync(bad.targetRoot),false);
});
test('parent transport calls the pinned local controller; guard remains single invocation after unknown',async()=>{
 const f=setup();await candidate(f);
 const script=`import sys,json,pathlib,importlib.util,hashlib,time,datetime\nsys.path.insert(0,${JSON.stringify(f.targetRoot)})\nimport tools\nc=json.loads(${JSON.stringify(JSON.stringify(f.context))})\ncmd=tools.ssh(c,['--profile',c['profile'],'lock-status'])\nassert 'ssh' not in cmd and c['phone_controller'] in cmd,cmd\nfrom outreach104.phone_guard import send_once\np=pathlib.Path(${JSON.stringify(f.targetRoot)});d=p/'outreach-receipts';d.mkdir()\nt=c['tasks']['104'];s=c['verification']['104'];msg='测试正文'\ni={**t,**{k:c[k] for k in ['profile','serial','sender_id']},**{k:s[k] for k in ['record_id','comment_id','target_douyin_id','profile_url']},'message':msg,'message_sha256':hashlib.sha256(msg.encode()).hexdigest(),'message_b64':__import__('base64').b64encode(msg.encode()).decode(),'evidence_id':t['run_tag']+'-a2-dm-1','action_key':'action'}\n(d/'send-input.json').write_text(json.dumps(i));(d/'prepare-runtime.json').write_text(json.dumps({'verified':True,'pause':False,'halt':False,'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}))\ncalls=[]\ndef run(*a,**kw):\n calls.append(a);raise TimeoutError('unknown')\napi={'task_authority':lambda c:None,'resource_authority':lambda c:None,'readback':lambda c:{**{k:True for k in ['prepared_verified','sender_verified','target_verified','message_verified','same_uid_clear','initial_phone_allowed']},'phone_invocation_present':False,'action_key':'action'},'run':run,'ssh':tools.ssh}\nfor _ in range(2):\n try:send_once(p,c,'send_dm',[],api)\n except (TimeoutError,ValueError):pass\nassert len(calls)==1,calls\nassert json.loads((d/'phone-invocation.json').read_text())['state']=='unknown'\nprint('single-unknown-preserved')`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'single-unknown-preserved');
});
