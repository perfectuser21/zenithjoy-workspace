import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/activity-host-104.json',import.meta.url)));
const implementation=new URL('../activity-host-104.mjs',import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
const roots=[];const toolchain=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'activity104-tools-')));roots.push(toolchain);
// CI toolcache may share writable or hardlinked interpreters. Own immutable copies for admission fixtures.
const sources={node:fs.realpathSync(process.execPath),python:fs.realpathSync(spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).stdout.trim())};
for(const [name,source]of Object.entries(sources)){
 // Apple's Python locates its dylib relative to the executable; a relocated binary is not runnable.
 const file=path.join(toolchain,name);
 if(name==='python')fs.writeFileSync(file,"#!/bin/sh\nexec '"+source.replaceAll("'","'\\''")+"' \"$@\"\n");else fs.copyFileSync(source,file);
 fs.chmodSync(file,0o700);
}
const node=path.join(toolchain,'node'),python=path.join(toolchain,'python');
function setup(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'activity104-')));roots.push(root);
 const baseRoot=path.join(root,'base'),localBaseRoot=path.join(root,'local'),runtime=path.join(root,'runtime');
 for(const [dir,files] of [[baseRoot,fixture.files],[localBaseRoot,fixture.local]])for(const [n,f]of Object.entries(files)){assert.equal(hash(f.source),f.sha256);fs.mkdirSync(path.dirname(path.join(dir,n)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,n),f.source,{mode:0o600});}
 fs.mkdirSync(runtime,{mode:0o700});for(const n of ['controller','registry','adb-policy','state','evidence'])fs.writeFileSync(path.join(runtime,n),'fixture-'+n,{mode:0o600});
 const auth={schema:'run-send-authorization/v1',root_task_id:'root-task',decision_id:'decision',message:'测试正文',message_sha256:hash('测试正文'),max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
 const authPath=path.join(root,'auth.json');fs.writeFileSync(authPath,JSON.stringify(auth),{mode:0o600});
 const context={assigned_workflow:'104',root_task_id:'root-task',actor:'fixture',source_commit:'a'.repeat(40),runtime_root:runtime,transport:'local',host:'fixture-host',profile:'fixture-phone',serial:'hardware-1',adb_serial:'127.0.0.1:15555',company_id:'company-1',tenant_id:'tenant-1',line:'fixture-line',account:'sender-1',sender_id:'sender-1',local_owner:'local-1',central_owner:'task-1',tasks:{'104':{task_id:'task-1',run_id:'run-1',run_tag:'tag-1'}},business_deadline_ms:Date.now()+3600000,cleanup_deadline_ms:Date.now()+4200000,node,node_sha256:hash(fs.readFileSync(node)),python,python_sha256:hash(fs.readFileSync(python)),native_root:path.join(runtime,'evidence'),credentials:{database:path.join(root,'db.json'),feishu:path.join(root,'feishu.json'),brain:path.join(root,'brain.env'),provider_env_files:[]},authorization_asset:{path:authPath,sha256:hash(fs.readFileSync(authPath))},verification:{policy_id:'policy',policy_version:1,pg:{deployment:{source_commit:'a'.repeat(40)}},runtime_sha256:{},'104':{record_id:'record',comment_id:'comment',lead_id:'lead',target_douyin_id:'target',profile_url:'https://v.douyin.com/fixture/',source_102_run:'new102',source_103_run:'new103'}},outreach_runtime:{state_directory:path.join(root,'state'),evidence_base:path.join(root,'evidence'),lock_root:path.join(root,'locks'),account_bindings:[{host:'fixture-host',profile:'fixture-phone',serial:'127.0.0.1:15555'}],history_assets:[]}};
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
test('104 packaged qualification reads legacy and bound 103 Agent scores without spoofing a provider response',async()=>{
 const f=setup();
 for(const name of ['company-config-lib.js','judge-comment.js'])fs.writeFileSync(path.join(f.context.runtime_root,name),'module.exports={}');
 fs.writeFileSync(path.join(f.context.runtime_root,'leadgen-policy-review.js'),"throw Error('old phone scoring verifier loaded')");
 const receipt=await candidate(f);
 const packagePath=path.join(f.targetRoot,'business-runtime/package.json');
 const files=['leadgen-policy-review.js','leadgen-score-context.js','leadgen-frozen-policy-evidence.js'];
 for(const name of files){
  const relative='business-runtime/'+name;
  assert.ok(receipt.sha256[relative],`missing frozen score source ${name}`);
  assert.equal(receipt.sha256[relative],hash(fs.readFileSync(path.join(f.targetRoot,relative))));
 }
 const runtime=fs.readFileSync(path.join(f.targetRoot,'outreach104/runtime-deps.mjs'),'utf8');
 assert.match(runtime,/score=createRequire\(new URL\('\.\.\/business-runtime\/package\.json',import\.meta\.url\)\)\('\.\/leadgen-policy-review\.js'\)/);
 assert.doesNotMatch(runtime,/score=req\(/);
 assert.match(runtime,/const result=await score\.verifyStoredScore\(comment,frozen\[0\]\.snapshot\)/);
 const policy=createRequire(packagePath)('./leadgen-policy-review.js');
 const snapshot={company_id:'company',tenant_id:'tenant',version:4,policy_id:'policy',
  runtime_config:{comment_scoring:{audiences:[{id:'audience',fields:{'意向信号':'咨询流程'}}]}}};
 const agentIdentity={task_id:'11111111-1111-4111-8111-111111111111',run_id:'22222222-2222-4222-8222-222222222222',activity_key:'scoring',action_id:'score-action',attempt:1,tool_action:'score-submit'};
 const row={id:'33333333-3333-4333-8333-333333333333',line_key:'fixture',harvest_batch:'source102',
  comment_body:'我想咨询流程',source_video:'报名流程介绍',source_video_url:'https://v.douyin.com/test/'};
 const proof={audience_id:'audience',matched_rule:'咨询流程',comment_signal:'咨询流程',video_signal:'流程介绍',exclusion_rule:null,reason:'咨询与视频相关'};
 const agent={provider:'codex',agent_identity:agentIdentity,input_sha256:'a'.repeat(64),answer_sha256:'b'.repeat(64),
  policy_reference_mode:'frozen-fields-v1',policy_evidence:proof};
 const legacy={model:'legacy-model',response_id:'legacy-response'};
 const save=audit=>{
  const result={grade:'A',relevance:'相关',reason:proof.reason,audit};
  return {...row,relevance:result.relevance,intent_grade:result.grade,judgment_reason:result.reason,
   judgment_config:policy.makeSingleScoreAudit(row,snapshot,result,{run_id:agentIdentity.run_id,
     company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id})};
 };
 const original=save(legacy),bound=save(agent);
 assert.equal(policy.verifyStoredScore(original,snapshot).response_id,'legacy-response');
 assert.deepEqual(policy.verifyStoredScore(bound,snapshot).agent_identity,agentIdentity);
 assert.equal(policy.verifyStoredScore(bound,snapshot).provider,'codex');
 assert.equal(policy.verifyStoredScore(bound,snapshot).response_id,undefined);
 assert.equal(policy.verifyStoredScore({...bound,comment_body:'被替换的评论'},snapshot).status,'unknown');
 assert.equal(policy.verifyStoredScore(save({...agent,agent_identity:{...agentIdentity,activity_key:'send_dm'}}),snapshot).status,'unknown');
 assert.equal(policy.verifyStoredScore(save({...agent,response_id:'fake-provider-id'}),snapshot).status,'unknown');
 assert.equal(policy.verifyStoredScore(save({...legacy,response_id:undefined}),snapshot).status,'unknown');
});
test('wrong authorization/root/order/source rejects before runtime module execution',async()=>{
 const f=setup();await candidate(f);const api=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/runtime-deps.mjs')));
 for(const mutate of [c=>c.marker_source='b'.repeat(40),c=>c.node='/other-node',c=>c.python='/other-python',c=>c.company_id='other',c=>c.account='other',c=>c.root_task_id='other',c=>c.verification['104'].record_id='other',c=>c.source_commit='b'.repeat(40),c=>c.authorization_asset.sha256='0'.repeat(64)]){
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

test('original prepared order recovery never repeats PUT and unknown never clears reservation',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));
 const auth=JSON.parse(fs.readFileSync(f.context.authorization_asset.path)),s=f.context.verification['104'];
 const row={record_id:s.record_id,fields:{'抖音号':s.target_douyin_id,'主页链接':s.profile_url,'状态':'待触达','发送状态':'未发送'}};
 const counts={put:0,get:0,native:0};let outcome='unknown';
 const deps={authorize:async()=>auth,qualify:async()=>({verified:true}),withLock:fn=>fn(),validateOriginal:()=>true,validateStable:()=>true,api:{all:async()=>[structuredClone(row)],get:async()=>{counts.get++;return structuredClone(row);},fields:async()=>[{field_name:'触达时间',type:1}],put:async(_id,fields)=>{counts.put++;Object.assign(row.fields,fields);if(counts.put===1)throw Error('response-lost-after-committed-put');}},freshRuntime:async()=>({verified:true,pause:false,halt:false,today_dm_attempts:0,today_sent_orders:0}),readPreflightFacts:async()=>({source_verified:true}),readSendFacts:async()=>{counts.native++;return {source_verified:outcome==='sent',outcome,sent_at_ms:Date.now()};},close:async()=>{}};
 const args={context:f.context,scope:s,artifact_dir:path.join(f.root,'orders'),evidence:{}};
 assert.equal((await request({...args,op:'claim'},deps)).status,'claimed');assert.equal(counts.put,1);
 assert.equal((await request({...args,op:'claim'},deps)).status,'claimed');assert.equal(counts.put,1);
 assert.equal((await request({...args,op:'prepare'},deps)).status,'prepared');assert.equal(counts.put,2);
 assert.equal((await request({...args,op:'prepare'},deps)).status,'prepared');assert.equal(counts.put,2);
 assert.equal((await request({...args,op:'write_back'},deps)).status,'unknown');assert.equal(counts.put,2);assert.match(row.fields['回复结果'],/^\[104 prepared:/);
 assert.equal((await request({...args,op:'readback'},deps)).status,'prepared');assert.equal(counts.put,2);
});
test('missing local state and missing migrated-account history are blocked without creating directories',async()=>{
 const f=setup();f.context.outreach_runtime.account_bindings.push({host:'old-host',profile:'old-profile',serial:'old-device'});await candidate(f);
 const {observe104Runtime}=await import(pathToFileURL(path.join(f.targetRoot,'activity-104-runtime.mjs')));
 const r=observe104Runtime(f.context);assert.equal(r.verified,false);assert.equal(r.account_day_coverage_complete,false);assert.ok(r.missing_sources.includes('state_directory'));assert.equal(fs.existsSync(f.context.outreach_runtime.state_directory),false);
});
test('local counters and malformed native ledger fail closed while retaining original files',async()=>{
 for(const mode of ['pause','bad-count','bad-ledger']){
  const f=setup(),cfg=f.context.outreach_runtime;fs.mkdirSync(cfg.state_directory);fs.mkdirSync(path.join(cfg.evidence_base,f.context.profile),{recursive:true});fs.mkdirSync(cfg.lock_root);const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','');
  const file=mode==='pause'?path.join(cfg.state_directory,'dm-paused-'+f.context.profile+'.flag'):mode==='bad-count'?path.join(cfg.state_directory,'dm-count-'+f.context.profile+'-'+date+'.txt'):path.join(cfg.evidence_base,f.context.profile,'old-outward-ledger.jsonl');fs.writeFileSync(file,'broken');await candidate(f);
  const {observe104Runtime}=await import(pathToFileURL(path.join(f.targetRoot,'activity-104-runtime.mjs')));const r=observe104Runtime(f.context);if(mode==='pause')assert.equal(r.pause,true);else assert.equal(r.verified,false);assert.equal(fs.readFileSync(file,'utf8'),'broken');
 }
});
test('hardware proof is independent of ADB route and rejects mismatches before returning preflight',async()=>{
 const f=setup(),adb=path.join(f.context.runtime_root,'adb-managed-client.py');fs.writeFileSync(adb,'# frozen fixture');f.context.verification.runtime_sha256['adb-managed-client.py']=hash(fs.readFileSync(adb));await candidate(f);
 const script=`import sys,json,importlib.util,subprocess\nsys.path.insert(0,${JSON.stringify(f.targetRoot)})\nsp=importlib.util.spec_from_file_location('host',${JSON.stringify(path.join(f.targetRoot,'activity-104-transport.py'))});m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)\nc=json.loads(${JSON.stringify(JSON.stringify(f.context))})\ncalls=[]\ndef run(args,**kw):\n calls.append(args);return subprocess.CompletedProcess(args,0,'hardware-1\\n','')\nr=subprocess.CompletedProcess([],0,'serial='+c['adb_serial']+'\\n','')\nout=m.preflight_result(c,r,run)\nassert 'hardware_serial=hardware-1' in out.stdout and calls[0][-3:]==['shell','getprop','ro.serialno']\ndef wrong(args,**kw):return subprocess.CompletedProcess(args,0,'other-hardware','')\ntry:m.preflight_result(c,subprocess.CompletedProcess([],0,'serial='+c['adb_serial']+'\\n',''),wrong);raise AssertionError('accepted wrong hardware')\nexcept ValueError as e:assert str(e)=='ACTIVITY_104_HARDWARE_BINDING'\nprint('bound')`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'bound');
});
test('authorization content mutation and config hash mutation reject without external loading',async()=>{
 const f=setup();await candidate(f);const api=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/runtime-deps.mjs')));
 fs.appendFileSync(f.context.authorization_asset.path,' ');await assert.rejects(api.createRuntimeDeps(f.context,f.context.verification['104']),/104_SOURCE_DIGEST/);
 fs.appendFileSync(path.join(f.targetRoot,'outreach-host-binding.json'),' ');await assert.rejects(api.createRuntimeDeps(f.context,f.context.verification['104']),/104_CONTEXT_FROZEN/);
});
test('all assembled JavaScript/Python entry sources parse and 104 method stays scoped',async()=>{
 const f=setup();const receipt=await candidate(f);
 for(const name of Object.keys(receipt.sha256))if(name.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',path.join(f.targetRoot,name)],{encoding:'utf8'});assert.equal(r.status,0,name+': '+r.stderr);}
 const p=spawnSync('python3',['-c','import ast,pathlib,sys\nfor p in pathlib.Path(sys.argv[1]).rglob("*.py"):ast.parse(p.read_text())',f.targetRoot],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
 assert.match(fs.readFileSync(path.join(f.targetRoot,'outreach104/order-adapter.mjs'),'utf8'),/releaseOwnClaim/);
 assert.equal(hash(fs.readFileSync(path.join(f.baseRoot,'outreach104/order-adapter.mjs'))),fixture.files['outreach104/order-adapter.mjs'].sha256);
 assert.equal(hash(fs.readFileSync(path.join(f.targetRoot,'outreach104/phone_guard.py'))),fixture.files['outreach104/phone_guard.py'].sha256);
 assert.match(fs.readFileSync(path.join(f.targetRoot,'TOOLS.txt'),'utf8'),/commander_host_tools.invoke/);
});

test('actual assembled runtime loads admitted PG closure; bad scope dispatches zero external initializations',async()=>{
 const f=setup(),runtime=f.context.runtime_root;
 const {installPreflightPg,preflightPgLockIdentity}=await import('../preflight-pg-dependencies.mjs');
 for(const n of ['preflight-pg-dependencies.mjs','preflight-pg-lock.json']){fs.copyFileSync(new URL('../'+n,import.meta.url),path.join(runtime,n));f.context.verification.runtime_sha256[n]=hash(fs.readFileSync(path.join(runtime,n)));}
 await installPreflightPg({runtimeRoot:runtime,sourceCommit:f.context.source_commit});f.context.verification.pg.preflight_pg=preflightPgLockIdentity({runtimeRoot:runtime});
 globalThis.activity104Effects={module:0,order:0,query:0};
 for(const n of ['leadgen-outreach-orders.js','line-routes.js','next-outreach-lib.js','leadgen-outreach-bridge.js','company-config-lib.js','leadgen-policy-review.js']){
  const code='globalThis.activity104Effects.module++;module.exports='+ (n==='line-routes.js'?'{routeOf:()=>({})}':n==='leadgen-outreach-orders.js'?'{orderClient:async()=>{globalThis.activity104Effects.order++;return {};},withOrderLock:(_line,fn)=>fn()}':'{}')+';';fs.writeFileSync(path.join(runtime,n),code,{mode:0o600});f.context.verification.runtime_sha256[n]=hash(code);
 }
 await candidate(f);const api=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/runtime-deps.mjs'))),env={DATABASE_URL:process.env.DATABASE_URL,LEADGEN_FEISHU_CREDENTIALS:process.env.LEADGEN_FEISHU_CREDENTIALS};
 process.env.DATABASE_URL='postgres://fixture:fixture@127.0.0.1:1/fixture';process.env.LEADGEN_FEISHU_CREDENTIALS='fixture-no-read';
 try{
  const wrong={...f.context,company_id:'other'};await assert.rejects(api.createRuntimeDeps(wrong,wrong.verification['104']),/104_CONTEXT_CHANGED/);assert.deepEqual(globalThis.activity104Effects,{module:0,order:0,query:0});
  await assert.rejects(api.createRuntimeDeps(f.context,{...f.context.verification['104'],record_id:'other'}),/104_CONTEXT_SCOPE/);assert.equal(globalThis.activity104Effects.module,0);
  const d=await api.createRuntimeDeps(f.context,f.context.verification['104']);await d.close();assert.deepEqual(globalThis.activity104Effects,{module:5,order:1,query:0});
 }finally{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;delete globalThis.activity104Effects;}
});

test('same-account earlier prepared or unknown orders retain conservative budget without global account pause',async()=>{
 const f=setup(),cfg=f.context.outreach_runtime;fs.mkdirSync(cfg.state_directory);fs.mkdirSync(path.join(cfg.evidence_base,f.context.profile),{recursive:true});fs.mkdirSync(cfg.lock_root);await candidate(f);
 const {observe104Runtime}=await import(pathToFileURL(path.join(f.targetRoot,'activity-104-runtime.mjs')));
 assert.equal(observe104Runtime(f.context).verified,true);
 for(const phase of ['prepared','unknown']){
  const other={record_id:'other-recipient-order',fields:{'实际分发号':'old-profile('+f.context.sender_id+')','回复结果':'[104 '+phase+':earlier:sha]'}};
  const r=observe104Runtime(f.context,{orders:[other]});assert.equal(r.verified,true);assert.equal(r.unresolved_attempt_reservations,1);assert.equal(r.today_dm_attempts,1);
  const own={...other,record_id:f.context.verification['104'].record_id,fields:{...other.fields,'回复结果':'[104 '+phase+':'+f.context.tasks['104'].run_tag+':'+f.context.source_commit+']'}};assert.equal(observe104Runtime(f.context,{orders:[own]}).unresolved_attempt_reservations,0);
 }
});

test('invalid historical observation time or missing risk flags cannot attest complete account coverage',async()=>{
 for(const mode of ['time','risk']){
  const f=setup(),binding={host:'old-host',profile:'old-phone',serial:'old-route'},date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());f.context.outreach_runtime.account_bindings.push(binding);
  const h={...binding,sender_id:f.context.sender_id,observed_at:new Date().toISOString(),date,complete:true,today_dm_attempts:0,unparsed_ledger_rows:0,unresolved_attempts:0,pause:false,halt:false};if(mode==='time')h.observed_at='invalid-date';else delete h.pause;
  const p=path.join(f.root,'history.json');fs.writeFileSync(p,JSON.stringify(h),{mode:0o600});f.context.outreach_runtime.history_assets=[{path:p,sha256:hash(fs.readFileSync(p))}];await candidate(f);
  const {observe104Runtime}=await import(pathToFileURL(path.join(f.targetRoot,'activity-104-runtime.mjs')));assert.equal(observe104Runtime(f.context).account_day_coverage_complete,false);
 }
});

test('original order adapter keeps same-UID prohibition and daily 100 limit with conservative unknown reservations',async()=>{
 const f=setup(),cfg=f.context.outreach_runtime;fs.mkdirSync(cfg.state_directory);fs.mkdirSync(path.join(cfg.evidence_base,f.context.profile),{recursive:true});fs.mkdirSync(cfg.lock_root);await candidate(f);
 const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs'))),{observe104Runtime}=await import(pathToFileURL(path.join(f.targetRoot,'activity-104-runtime.mjs')));
 const auth=JSON.parse(fs.readFileSync(f.context.authorization_asset.path)),scope=f.context.verification['104'];let puts=0;
 const own={record_id:scope.record_id,fields:{'抖音号':scope.target_douyin_id,'主页链接':scope.profile_url,'状态':'待触达','发送状态':'未发送'}};
 const makeOther=i=>({record_id:'previous-order-'+i,fields:{'抖音号':'other-person-'+i,'实际分发号':'old-profile('+f.context.sender_id+')','回复结果':'[104 unknown:old-run:old-source]','状态':'触达中'}});
 let prior=[makeOther(0)],row=own;const args={context:f.context,scope,artifact_dir:path.join(f.root,'budget-orders'),evidence:{}};
 const deps={authorize:async()=>auth,qualify:async()=>({verified:true}),withLock:fn=>fn(),validateOriginal:()=>true,validateStable:()=>true,api:{all:async()=>[row,...prior].map(x=>structuredClone(x)),get:async()=>structuredClone(row),fields:async()=>[],put:async(_id,fields)=>{puts++;Object.assign(row.fields,fields);}},freshRuntime:async all=>({...observe104Runtime(f.context,{orders:all}),today_sent_orders:0}),readPreflightFacts:async()=>({source_verified:true}),close:async()=>{}};
 assert.equal((await request({...args,op:'inspect'},deps)).status,'ready');assert.equal(puts,0);
 prior[0].fields['抖音号']=scope.target_douyin_id;await assert.rejects(request({...args,op:'claim'},deps),/RECIPIENT_RESERVED/);assert.equal(puts,0);
 prior=[makeOther(0)];assert.equal((await request({...args,op:'claim'},deps)).status,'claimed');assert.equal(puts,1);
 prior=Array.from({length:100},(_,i)=>makeOther(i));await assert.rejects(request({...args,op:'prepare'},deps),/CURRENT_RUNTIME_BLOCKED/);assert.equal(puts,1);
 prior=Array.from({length:99},(_,i)=>makeOther(i));assert.equal((await request({...args,op:'prepare'},deps)).status,'prepared');assert.equal(puts,2);
});

test('unsafe writable or hardlinked toolchain assets still reject before host creation',async()=>{
 for(const mode of ['writable','hardlink']){
  const f=setup(),file=path.join(f.root,'unsafe-node');fs.copyFileSync(node,file);fs.chmodSync(file,mode==='writable'?0o775:0o700);if(mode==='hardlink')fs.linkSync(file,file+'-alias');f.context.node=file;f.context.node_sha256=hash(fs.readFileSync(file));
  await assert.rejects(candidate(f),/ACTIVITY_104_SOURCE_FILE/);assert.equal(fs.existsSync(f.targetRoot),false);
 }
});

function stateFixture(f){
 const auth=JSON.parse(fs.readFileSync(f.context.authorization_asset.path)),s=f.context.verification['104'];
 const row={record_id:s.record_id,fields:{'抖音号':s.target_douyin_id,'主页链接':s.profile_url,'状态':'待触达','发送状态':'未发送'}};
 const counts={put:0,pg:0};
 const deps={authorize:async()=>auth,qualify:async()=>({verified:true}),withLock:fn=>fn(),validateOriginal:()=>true,validateStable:()=>true,
 api:{all:async()=>[structuredClone(row)],get:async()=>structuredClone(row),fields:async()=>[{field_name:'触达时间',type:1}],put:async(_id,v)=>{counts.put++;Object.assign(row.fields,v);}},
 freshRuntime:async()=>({verified:true,pause:false,halt:false,today_dm_attempts:0,today_sent_orders:0}),readPreflightFacts:async()=>({source_verified:true}),
 readSendFacts:async()=>({source_verified:true,outcome:'sent',sent_at_ms:1795000000000}),syncLead:async()=>{counts.pg++;return {lead:{id:s.lead_id,status:'已触达'}};},readLead:async()=>({lead:{id:s.lead_id}}),close:async()=>{}};
 return {row,counts,deps,args:{context:f.context,scope:s,artifact_dir:path.join(f.root,'orders'),evidence:{}}};
}
test('104 own unprepared claim releases once through assembled adapter and returns original readback',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 await request({...x.args,op:'claim'},x.deps);
 const r=await request({...x.args,op:'release'},x.deps);assert.equal(r.status,'released');assert.equal(x.row.fields['状态'],'待触达');
 assert.equal((await request({...x.args,op:'release'},x.deps)).status,'released');assert.equal(x.counts.put,2);
});
test('104 original writeback and terminal recovery both call the PG synchronization without repeating Feishu writes',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 await request({...x.args,op:'claim'},x.deps);await request({...x.args,op:'prepare'},x.deps);
 const a=await request({...x.args,op:'write_back'},x.deps);assert.equal(a.lead_readback.lead.id,x.args.scope.lead_id);assert.equal(x.counts.pg,1);
 await request({...x.args,op:'write_back'},x.deps);assert.equal(x.counts.pg,2);assert.equal(x.counts.put,3);
});
test('104 release never clears prepared, unknown, pending prepare or any native invocation',async()=>{
 for(const mode of ['prepared','prepare-intent','unknown','reserved','invocation','send-input','other-owner']){
  const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
  await request({...x.args,op:'claim'},x.deps);const file=path.join(x.args.artifact_dir,'action.json'),j=JSON.parse(fs.readFileSync(file));
  if(mode==='prepared')await request({...x.args,op:'prepare'},x.deps);
  else if(mode==='prepare-intent'){j.phase='prepared_intent';j.pending_write={phase:'prepared',fields:{}};fs.writeFileSync(file,JSON.stringify(j));}
  else if(mode==='unknown'){j.phase='unknown';fs.writeFileSync(file,JSON.stringify(j));}
  else if(mode==='reserved'){j.reserved_budget=1;fs.writeFileSync(file,JSON.stringify(j));}
  else if(mode==='other-owner')x.row.fields['回复结果']='[104 claim:other:source]';
  else fs.writeFileSync(path.join(x.args.artifact_dir,mode==='invocation'?'phone-invocation.json':'send-input.json'),'{}');
  const before=JSON.stringify(x.row),puts=x.counts.put;
  await assert.rejects(request({...x.args,op:'release'},x.deps),/RELEASE_/);assert.equal(x.counts.put,puts);assert.equal(JSON.stringify(x.row),before);
 }
});
test('104 release response loss reconciles original row only; no blind repeat PUT',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 await request({...x.args,op:'claim'},x.deps);const get=x.deps.api.get;x.deps.api.get=async()=>{throw Error('lost');};
 assert.equal((await request({...x.args,op:'release'},x.deps)).status,'unknown');assert.equal(x.counts.put,2);
 x.deps.api.get=get;assert.equal((await request({...x.args,op:'release'},x.deps)).status,'released');assert.equal(x.counts.put,2);
});
test('104 lost claim acknowledgement and rejected preparation before reservation can be cleaned up',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f),get=x.deps.api.get;
 x.deps.api.get=async()=>{throw Error('lost');};assert.equal((await request({...x.args,op:'claim'},x.deps)).status,'unknown');
 x.deps.api.get=get;fs.writeFileSync(path.join(x.args.artifact_dir,'prepare-runtime.json'),JSON.stringify({verified:false}));
 assert.equal((await request({...x.args,op:'release'},x.deps)).status,'released');assert.equal(x.counts.put,2);
});
test('104 uncertain release leaves its intent and never retries an unconfirmed PUT',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 await request({...x.args,op:'claim'},x.deps);x.deps.api.put=async()=>{x.counts.put++;throw Error('unknown');};
 assert.equal((await request({...x.args,op:'release'},x.deps)).status,'unknown');assert.equal((await request({...x.args,op:'release'},x.deps)).status,'unknown');assert.equal(x.counts.put,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(x.args.artifact_dir,'action.json'))).phase,'release_intent');assert.match(x.row.fields['回复结果'],/^\[104 claim:/);
});
test('104 both JSON-stdio boundaries expose release only to cleanup and readback to every phase',async()=>{
 const f=setup();await candidate(f);const {OPS}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/profile-input.mjs')));
 for(const [key,ops]of Object.entries(OPS)){assert.equal(ops.includes('release'),key==='cleanup');assert.ok(ops.includes('lead_readback'));}
 const script=`import sys,json\nsys.path.insert(0,${JSON.stringify(f.targetRoot)})\nfrom outreach104.tool_extension import OPS,readonly_recovery\nassert all(('release' in v)==(k=='cleanup') and 'lead_readback' in v for k,v in OPS.items())\nassert readonly_recovery('outreach',['{"op":"lead_readback"}'])\nassert not readonly_recovery('outreach',['{"op":"release"}'])\nprint('scoped')`;
 const p=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout.trim(),'scoped');
 const source=fs.readFileSync(path.join(f.targetRoot,'outreach104/runtime-deps.mjs'),'utf8');assert.match(source,/\['readback','lead_readback','release','write_back'\]\.includes\(op\)/);
});
test('104 committed Feishu result with failed PG returns unknown then repairs PG only',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 await request({...x.args,op:'claim'},x.deps);await request({...x.args,op:'prepare'},x.deps);
 const sync=x.deps.syncLead;x.deps.syncLead=async()=>{throw Error('COMMIT_REPLY_LOST');};
 const r=await request({...x.args,op:'write_back'},x.deps);assert.equal(r.status,'unknown');assert.equal(r.reason,'LEAD_WRITEBACK_UNCONFIRMED');assert.equal(x.row.fields['状态'],'已触达');
 x.deps.syncLead=sync;assert.equal((await request({...x.args,op:'write_back'},x.deps)).status,'sent');assert.equal(x.counts.put,3);assert.equal(x.counts.pg,1);
});
test('104 lead readback returns raw facts and never performs a write',async()=>{
 const f=setup();await candidate(f);const {request}=await import(pathToFileURL(path.join(f.targetRoot,'outreach104/order-adapter.mjs')));const x=stateFixture(f);
 const r=await request({...x.args,op:'lead_readback'},x.deps);assert.equal(r.lead_readback.lead.id,x.args.scope.lead_id);assert.equal(x.counts.put,0);assert.equal(x.counts.pg,0);assert.equal(Object.hasOwn(r,'verified'),false);
});

test('current assembled 104 contains source facts and no legacy independent business judges',async()=>{
 const f=setup();await candidate(f);
 for(const name of ['checker.mjs','cleanup-result.mjs','native-readback.mjs','outreach104/checker104.mjs','outreach104/preserved-checker.mjs','outreach104/native-checker.py','outreach104/native-checker.mjs'])assert.equal(fs.existsSync(path.join(f.targetRoot,name)),false,name);
 const deps=fs.readFileSync(path.join(f.targetRoot,'outreach104/runtime-deps.mjs'),'utf8'),adapter=fs.readFileSync(path.join(f.targetRoot,'outreach104/order-adapter.mjs'),'utf8');
 assert.match(deps,/readSendFacts/);assert.match(adapter,/native\.source_verified/);assert.doesNotMatch(adapter,/native\.verified/);
});
