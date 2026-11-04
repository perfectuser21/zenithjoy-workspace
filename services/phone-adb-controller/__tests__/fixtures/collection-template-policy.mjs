// 实际模板/manifest/default scope；仅固定证据目录的stat/alias为隔离synthetic元数据。
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source=fileURLToPath(new URL('../../',import.meta.url)),relative='config/collection-phone-hosts.json';
const bytes=fs.readFileSync(join(source,relative)),oldBytes=fs.readFileSync(new URL('./collection-phone-hosts-699515a5.json',import.meta.url));
const mode=process.argv[2],template=JSON.parse(bytes),old=JSON.parse(oldBytes),host=mode.startsWith('xiaolongxia-')?{...template.hosts[0],profile:'xiaolongxia',serial:'ANGYVB4311010223',expected_account:'90915521618',evidence_root:'/private/tmp/openclaw-phone/evidence/xiaolongxia',workflow_keys:['douyin_video_discovery','douyin_video_processing']}:template.hosts[['101-work','102-work'].includes(mode)?1:0];
const original={lstatSync:fs.lstatSync,readlinkSync:fs.readlinkSync,realpathSync:fs.realpathSync};
const alias=host.evidence_alias,canonical=join(alias.target,'evidence',host.profile),paths=new Set();
for(const root of [alias.path,canonical])for(let p=root;;p=resolve(p,'..')){paths.add(p);if(p==='/')break;}
const numbers=new Map([...paths].sort().map((p,i)=>[p,1000+i]));
fs.lstatSync=(p,...args)=>paths.has(String(p))?{dev:1,ino:numbers.get(String(p)),uid:process.getuid(),mode:0o40700,
 isSymbolicLink:()=>String(p)===alias.path,isDirectory:()=>String(p)!==alias.path}:original.lstatSync(p,...args);
fs.readlinkSync=(p,...args)=>String(p)===alias.path?alias.target:original.readlinkSync(p,...args);
fs.realpathSync=(p,...args)=>String(p)===alias.path?alias.target:String(p)===canonical?canonical:original.realpathSync(p,...args);
syncBuiltinESMExports();
const {defaultCollectionPhoneScope}=await import('../../collection-phone-scope.mjs');
const {defaultDiscoveryPhoneScope,startDiscoveryPhoneScope}=await import('../../discovery-phone-scope.mjs');
const {startCollectionPhoneScope}=await import('../../collection-phone-scope.mjs');
const {deploymentManifest}=await import('../../deployment-manifest.mjs');
const {digest,freezeDefinition}=await import('../../runtime-definition.mjs');
const sha=x=>createHash('sha256').update(x).digest('hex');
const d=fs.mkdtempSync(join(tmpdir(),'collection-template-policy-'));
function fixture(raw=bytes){
 const root=join(d,'git-'+Math.random().toString(16).slice(2));fs.mkdirSync(join(root,'services/phone-adb-controller/config'),{recursive:true});
 const runtime=join(root,'services/phone-adb-controller');fs.writeFileSync(join(runtime,relative),raw);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'}).toString().trim();
 git('init','-q','-b','cp-template-fixture');git('add','.');const tree=git('write-tree');
 const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','actual template bytes');git('update-ref','HEAD',commit);
 const manifest={...deploymentManifest(root,[relative],{commit}),target:'xian-m4'};fs.writeFileSync(join(runtime,'deployment-manifest.json'),JSON.stringify(manifest));
 const env={P:host.profile,SERIAL:host.serial,WFR_RUN_ID:'template-run',WFR_RUN_DIR:join(root,'new-run')};
 return {root,runtime,manifest,env};
}
function scope(f,key){const env={...f.env,WF_BRAIN_WORKFLOW:key};return (key==='douyin_video_discovery'?defaultDiscoveryPhoneScope:defaultCollectionPhoneScope)({root:f.runtime,env});}
try{
 if(mode.startsWith('xiaolongxia-')){
  const f=fixture(),keys=['douyin_video_discovery','douyin_video_processing'];
  if(['xiaolongxia-101','xiaolongxia-102'].includes(mode)){const key=keys[mode.endsWith('102')?1:0],value=scope(f,key);assert.ok(value,'verified xiaolongxia exact grant missing');for(const field of ['target','profile','serial','expected_account','evidence_root','policy','executables','evidence_alias','workflow_keys'])assert.deepEqual(value[field],host[field]);assert.equal(value.source_commit,f.manifest.source_commit);}
  else if(mode==='xiaolongxia-wrong-serial'){f.env.SERIAL='ANGYVB4227006983';for(const key of keys)assert.equal(scope(f,key),undefined);}
  else if(mode==='xiaolongxia-wrong-host'){f.manifest.target='mmv';fs.writeFileSync(join(f.runtime,'deployment-manifest.json'),JSON.stringify(f.manifest));for(const key of keys)assert.equal(scope(f,key),undefined);}
  else if(mode==='xiaolongxia-104'){assert.equal(scope(f,'douyin_lead_outreach'),undefined);assert.equal(defaultCollectionPhoneScope({root:f.runtime,env:{...f.env,WF_BRAIN_WORKFLOW:'douyin_video_processing'},workflowKey:'douyin_lead_outreach'}),undefined);}
  else if(mode==='xiaolongxia-wrong-source'){fs.appendFileSync(join(f.runtime,relative),' ');for(const key of keys)assert.throws(()=>scope(f,key),/COLLECTION_DEFAULT_TEMPLATE_SOURCE_INVALID/);}
  else if(mode==='xiaolongxia-alias-changed'){fs.realpathSync=(p,...args)=>String(p)===alias.path?alias.target+'-other':original.realpathSync(p,...args);syncBuiltinESMExports();for(const key of keys)assert.throws(()=>scope(f,key),/COLLECTION_EVIDENCE_ALIAS_INVALID/);}
  else if(mode==='xiaolongxia-wrong-account'){
   f.env.WF_BRAIN_TASK_ID='scope-task';
   for(const [index,key]of keys.entries()){const value=scope(f,key);assert.ok(value,'grant must exist before wrong-account check');const field=index?'collection_phone_scope':'discovery_phone_scope';
    const runDir=f.env.WFR_RUN_DIR+'-'+index,body={files:{},deployment:{target:'xian-m4',source_commit:f.manifest.source_commit},[field]:value},frozen={...body,snapshot_sha256:digest(body)};fs.mkdirSync(join(runDir,'run-bindings'),{recursive:true});fs.mkdirSync(join(runDir,'runtime'),{recursive:true});fs.writeFileSync(join(runDir,'run-definition.json'),JSON.stringify(frozen));
    fs.writeFileSync(join(runDir,'run-bindings/a1.request.json'),JSON.stringify({run_id:value.run_id,runtime_snapshot_sha256:frozen.snapshot_sha256,body:{task_id:'scope-task',actor:'runtime:phone-adb-controller'}}));fs.writeFileSync(join(runDir,'run-bindings/a1.ack.json'),JSON.stringify({binding:{id:'binding',run_id:value.run_id,task_id:'scope-task',actor:'runtime:phone-adb-controller'}}));
    const env={...f.env,WFR_RUN_DIR:runDir,WFR_ATTEMPT:'a1',WFR_TAG:'owner',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'300'},state={account:'wrong-account',currentActivity:index?'collection':'collect_videos',budgetDeadline:Date.now()+60000};
    const start=index?startCollectionPhoneScope:startDiscoveryPhoneScope,args={root:f.runtime,env,state,sourceCommit:f.manifest.source_commit,taskId:value.task_id,lockHeld:true};
    await assert.rejects(start(args),index?/COLLECTION_PHONE_ACCOUNT_INVALID/:/DISCOVERY_PHONE_IDENTITY_INVALID/);state.account=host.expected_account;await assert.rejects(start(args),index?/COLLECTION_PHONE_SOURCE_INVALID/:/DISCOVERY_PHONE_SOURCE_INVALID/);
   }
  }else if(['xiaolongxia-frozen101','xiaolongxia-frozen102'].includes(mode)){const key=keys[mode.endsWith('102')?1:0],field=mode.endsWith('102')?'collection_phone_scope':'discovery_phone_scope';fs.mkdirSync(f.env.WFR_RUN_DIR,{recursive:true});const body={files:{},[field]:null},frozen={...body,snapshot_sha256:digest(body)},path=join(f.env.WFR_RUN_DIR,'run-definition.json');fs.writeFileSync(path,JSON.stringify(frozen));const before=fs.readFileSync(path);assert.equal(scope(f,key),null);assert.deepEqual(fs.readFileSync(path),before);}
  else throw Error('unknown xiaolongxia mode');
 }else if(['101','101-work','102','101-task','102-task'].includes(mode)){
  const f=fixture(),key=mode.startsWith('102')?'douyin_video_processing':'douyin_video_discovery';
  if(mode.endsWith('-task'))f.env.WF_BRAIN_TASK_ID='11111111-2222-4333-8444-555555555555';
  const value=scope(f,key);
  if(mode.endsWith('-task'))assert.equal(value.task_id,f.env.WF_BRAIN_TASK_ID,'已验证 Task UUID 必须进入正式冻结手机范围');
  const r=spawnSync('python3',['-c',"import importlib.util,json,sys;s=importlib.util.spec_from_file_location('service',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.POLICY))",join(source,'adb-host-service.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const policy=JSON.parse(r.stdout);
  assert.deepEqual(Object.fromEntries(Object.keys(policy).map(k=>[k,value.policy[k]])),policy,'new default must match approved single5037 service policy');
  assert.equal(value.source_commit,f.manifest.source_commit);assert.equal(value.profile,host.profile);assert.equal(value.serial,host.serial);assert.equal(value.expected_account,host.expected_account);assert.deepEqual(value.executables,host.executables);
 }else if(mode==='102-work'){
  const f=fixture();assert.equal(scope(f,'douyin_video_processing'),undefined,'101 精确新模板不能扩大 102 执行范围');
 }else if(mode==='pins'){
  const strip=t=>{t=structuredClone(t);delete t.hosts[0].policy.endpoint;delete t.hosts[0].policy.forbidden_ports;return t;};
  assert.deepEqual(strip({hosts:[template.hosts[0]]}),strip({hosts:[old.hosts[0]]}));assert.equal(template.hosts.length,4);assert.deepEqual(template.hosts[2],{...template.hosts[0],profile:'xiaolongxia',serial:'ANGYVB4311010223',expected_account:'90915521618',evidence_root:'/private/tmp/openclaw-phone/evidence/xiaolongxia',workflow_keys:['douyin_video_discovery','douyin_video_processing']});
  assert.deepEqual(template.hosts.map(x=>[x.target,x.profile,x.serial]),[['xian-m4','legacy','ANGYVB4402004137'],['xian-m4','jinoshengyuan-work','ANGYVB4227006983'],['xian-m4','xiaolongxia','ANGYVB4311010223'],['xian-m4','yueshengyun-work','e6c7ef34']]);
  assert.deepEqual(template.hosts[3],{...template.hosts[2],profile:'yueshengyun-work',serial:'e6c7ef34',expected_account:'37358506855',evidence_root:'/private/tmp/openclaw-phone/evidence/yueshengyun-work'});
  const work=template.hosts[1],legacy=template.hosts[0];
  assert.deepEqual({target:work.target,profile:work.profile,serial:work.serial,expected_account:work.expected_account,evidence_root:work.evidence_root,workflow_keys:work.workflow_keys},
   {target:'xian-m4',profile:'jinoshengyuan-work',serial:'ANGYVB4227006983',expected_account:'langzi63485',evidence_root:'/private/tmp/openclaw-phone/evidence/jinoshengyuan-work',workflow_keys:['douyin_video_discovery']});
  assert.deepEqual(work.policy,legacy.policy);assert.deepEqual(work.executables,legacy.executables);assert.deepEqual(work.evidence_alias,legacy.evidence_alias);
 }else if(mode==='manifest'){
  const f=fixture();fs.appendFileSync(join(f.runtime,relative),' ');assert.throws(()=>scope(f,'douyin_video_processing'),/COLLECTION_DEFAULT_TEMPLATE_SOURCE_INVALID/);
 }else if(mode==='unknown-binding'){
  const f=fixture();f.env.SERIAL='OTHER';assert.equal(scope(f,'douyin_video_processing'),undefined);assert.equal(scope(f,'douyin_video_discovery'),undefined);
 }else if(mode==='frozen101'||mode==='frozen102'){
  const key=mode==='frozen101'?'douyin_video_discovery':'douyin_video_processing',field=mode==='frozen101'?'discovery_phone_scope':'collection_phone_scope';
  const historical=fixture(oldBytes),prior=scope(historical,key);assert.equal(prior.policy.endpoint,'tcp:127.0.0.1:5042');assert.deepEqual(prior.policy.forbidden_ports,[]);
  const f=fixture();fs.mkdirSync(join(f.env.WFR_RUN_DIR,'runtime/config'),{recursive:true});fs.writeFileSync(join(f.env.WFR_RUN_DIR,'runtime',relative),oldBytes);
  const body={files:{['runtime/'+relative]:sha(oldBytes)},[field]:prior};const frozen={...body,snapshot_sha256:digest(body)};const path=join(f.env.WFR_RUN_DIR,'run-definition.json');fs.writeFileSync(path,JSON.stringify(frozen));const before=fs.readFileSync(path);
  assert.deepEqual(scope(f,key),prior);assert.deepEqual(fs.readFileSync(path),before);assert.deepEqual(fs.readFileSync(join(f.env.WFR_RUN_DIR,'runtime',relative)),oldBytes);
  const changed={...prior,policy:{...prior.policy,endpoint:'tcp:127.0.0.1:5037',forbidden_ports:[5041,5042]}};
  await assert.rejects(freezeDefinition({runDir:f.env.WFR_RUN_DIR,[mode==='frozen101'?'discoveryPhoneScope':'collectionPhoneScope']:changed}),/scope续跑输入与冻结请求不符/);
 }else if(mode==='explicit-wrong-endpoint'){
  const r=spawnSync('python3',['-c',`import importlib.util,sys,inspect
s=importlib.util.spec_from_file_location('route',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.read_host_policy=lambda:{'port':5037}
def forbidden(*a,**kw):raise AssertionError('must refuse before any socket probe')
m.inspect_managed_host=forbidden
assert inspect.signature(m.select_route).parameters['budget'].default==2.0
try:m.select_route('NO-DEVICE','tcp:127.0.0.1:5042')
except ValueError as e:assert str(e)=='ADB_HOST_ENDPOINT_MISMATCH'
else:raise AssertionError('wrong explicit endpoint accepted')`,join(source,'adb-existing-route.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }else throw Error('unknown case');
 console.log('PASS '+mode);
}finally{Object.assign(fs,original);syncBuiltinESMExports();fs.rmSync(d,{recursive:true,force:true});}
