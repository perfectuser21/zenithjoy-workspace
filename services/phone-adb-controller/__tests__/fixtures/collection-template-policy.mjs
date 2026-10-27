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
const template=JSON.parse(bytes),old=JSON.parse(oldBytes),host=template.hosts[0];
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
const {defaultDiscoveryPhoneScope}=await import('../../discovery-phone-scope.mjs');
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
const mode=process.argv[2];
try{
 if(mode==='101'||mode==='102'){
  const f=fixture(),key=mode==='101'?'douyin_video_discovery':'douyin_video_processing',value=scope(f,key);
  const r=spawnSync('python3',['-c',"import importlib.util,json,sys;s=importlib.util.spec_from_file_location('service',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.POLICY))",join(source,'adb-host-service.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const policy=JSON.parse(r.stdout);
  assert.deepEqual(Object.fromEntries(Object.keys(policy).map(k=>[k,value.policy[k]])),policy,'new default must match approved single5037 service policy');
  assert.equal(value.source_commit,f.manifest.source_commit);assert.equal(value.profile,host.profile);assert.equal(value.serial,host.serial);assert.equal(value.expected_account,host.expected_account);assert.deepEqual(value.executables,host.executables);
 }else if(mode==='pins'){
  const strip=t=>{t=structuredClone(t);delete t.hosts[0].policy.endpoint;delete t.hosts[0].policy.forbidden_ports;return t;};assert.deepEqual(strip(template),strip(old));assert.equal(template.hosts.length,1);
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
