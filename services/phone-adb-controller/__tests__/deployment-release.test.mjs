import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../runtime-definition.mjs';
const path=new URL('../deployment-release.mjs',import.meta.url);
function fixture(){
 const manifest={source_repo:'fixture/repo',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/run.sh',deployed_path:'run.sh',content_sha256:'b'.repeat(64)}]};
 const release={id:'release-1',environment:'production',target:'xian-m4',payload:{components:[{kind:'repo',repo:manifest.source_repo,revision:manifest.source_commit},{kind:'code',repo:manifest.source_repo,path:manifest.files[0].path,revision:manifest.source_commit,digest:'sha256:'+manifest.files[0].content_sha256}]}};
 release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});
 const options={manifest,releaseId:release.id,host:'xian-m4',environment:'production',collector:'trusted-fixture',attemptKey:'deploy-1',brainUrl:'http://brain.invalid',stateDir:mkdtempSync(join(tmpdir(),'release-observation-')),collect:async()=>({...manifest,observed_hostname:'m4-xian.local'})};
 const calls=[];let observation;
 options.request=async(endpoint,body)=>{calls.push({endpoint,body});if(body){assert.equal(readdirSync(options.stateDir).some(n=>n.endsWith('.request.json')),true,'网络前必须持久化');observation={id:'obs-1',release_id:release.id,payload:body};return {observation};}if(endpoint.endsWith('/observations/obs-1'))return {observation};if(endpoint.endsWith('/gate'))return {deployed:true,actual_matches:true,current_observation_id:'obs-1'};return {release};};
 return {options,release,calls};
}
test('真实采集→持久请求→观测精确回读→gate之后才发布manifest',async()=>{
 const {observeDeployment}=await import(path);const f=fixture();const result=await observeDeployment(f.options);
 assert.equal(result.release_id,'release-1');assert.equal(result.observation_id,'obs-1');assert.equal(result.target,'xian-m4');assert.deepEqual(f.calls.find(c=>c.body).body.components,f.release.payload.components);
 const stored=JSON.parse(readFileSync(join(f.options.stateDir,readdirSync(f.options.stateDir).find(n=>n.endsWith('.request.json'))),'utf8'));assert.equal(stored.body.collector,'trusted-fixture');assert.equal(stored.body.deployed,undefined);
});
test('假target、未采集组件与漂移观测均禁止可运行manifest',async()=>{
 const {observeDeployment}=await import(path);
 const host=fixture();host.options.collect=async()=>({...host.options.manifest,observed_hostname:'unrelated-host'});await assert.rejects(observeDeployment(host.options),/机器/);assert.equal(host.calls.some(c=>c.body),false);
 const missing=fixture();missing.release.payload.components.push({kind:'skill',repo:'other/repo',path:'SKILL.md',revision:'a'.repeat(40),digest:'sha256:'+'c'.repeat(64)});missing.release.manifest_sha256=digest({environment:missing.release.environment,target:missing.release.target,payload:missing.release.payload});await assert.rejects(observeDeployment(missing.options),/组件/);assert.equal(missing.calls.some(c=>c.body),false);
 const gate=fixture();const request=gate.options.request;gate.options.request=(url,body)=>url.endsWith('/gate')?{deployed:false,actual_matches:false,current_observation_id:'other'}:request(url,body);await assert.rejects(observeDeployment(gate.options),/观测/);
});
test('观测网络重试持久同event与body；409固定blocked',async()=>{
 const {observeDeployment}=await import(path);const f=fixture();const request=f.options.request;const sent=[];let fail=true;
 f.options.request=async(url,body)=>{if(body){sent.push(body);if(fail){fail=false;throw Error('network');}}return request(url,body);};
 await assert.rejects(observeDeployment(f.options),/network/);await observeDeployment(f.options);assert.deepEqual(sent[0],sent[1]);
 const conflict=fixture();let posts=0;const original=conflict.options.request;conflict.options.request=async(url,body)=>{if(body){posts++;throw Object.assign(Error('conflict'),{status:409});}return original(url,body);};await assert.rejects(observeDeployment(conflict.options),/conflict/);await assert.rejects(observeDeployment(conflict.options),/blocked/);assert.equal(posts,1);
});
test('deploy入口发布新模块且必须在观测回读后才原子发布manifest',()=>{
 const source=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
 const files=source.match(/DEVICE_NODE_FILES=\(([^)]+)\)/s)[1];
 for(const name of ['runtime-binding.mjs','runtime-release.mjs','deployment-manifest.mjs'])assert.ok(files.includes(name),`部署漏发${name}`);
 assert.match(source,/deployment-release\.mjs/);assert.ok(source.lastIndexOf('deployment-release.mjs')<source.lastIndexOf('deployment-manifest.json'));
 assert.match(source,/push_atomic "\$OBSERVED_MANIFEST"/);
});

test('四流程正式部署覆盖 RPC 固定依赖、四新计划和 MMV 同 SHA 实测 manifest',async()=>{
 const {RPC_FILES}=await import('../leadgen-client.mjs');
 const source=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
 const array=name=>source.match(new RegExp(name+'=\\(([^)]+)\\)','s'))?.[1].trim().split(/\s+/);
 const rpc=array('RPC_FILES');assert.deepEqual([...rpc].sort(),[...RPC_FILES].sort());
 const mmv=[...array('MMV_JS_FILES'),...array('MMV_PROBE_FILES')];for(const name of RPC_FILES)assert.ok(mmv.includes(name),`MMV漏RPC依赖 ${name}`);
 const device=[...array('DEVICE_NODE_FILES'),...array('DEVICE_RPC_PROBE_FILES'),...array('DEVICE_PLAN_FILES')];for(const name of RPC_FILES)assert.ok(device.includes(name),`设备冻结漏RPC依赖 ${name}`);
 for(const key of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']){
  assert.ok(array('DEVICE_PLAN_FILES').includes(`plans/${key}.plan`));assert.ok(array('DEVICE_PLAN_FILES').includes(`plans/${key}.steps.json`));
 }
 for(const key of ['keyword_acquisition','benchmark_link_acquisition'])assert.ok(array('DEVICE_PLAN_FILES').includes(`plans/${key}.plan`),'退役入口需覆盖历史plan flag');
 assert.match(source,/deployment-manifest\.mjs.*MMV_RUNTIME_FILES/);
 assert.match(source,/MMV_RUNTIME_FILES=/);
 assert.ok(source.indexOf('deployment-release.mjs" mmv')<source.indexOf('"$MMV_OBSERVED_MANIFEST" mmv'));
 assert.match(source,/push_atomic "\$MMV_OBSERVED_MANIFEST" mmv/);
 assert.match(source,/deployment-release\.mjs" mmv "\$MMV_MANIFEST"/,'MMV必须采实机字节并由Brain正式观测，不能借device release');
});

test('RPC 声明覆盖所有本地静态依赖，防远端部署漏传递依赖',async()=>{
 const {RPC_FILES}=await import('../leadgen-client.mjs');
 for(const file of RPC_FILES){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const imports=[...source.matchAll(/(?:require\(|import\(|from\s+)['"]\.\/([^'"]+)['"]/g)].map(m=>m[1]);
  for(const relative of imports){const dependency=new URL(relative,new URL('../'+file,import.meta.url)).pathname.split('/phone-adb-controller/')[1];assert.ok(RPC_FILES.includes(dependency),`${file} 的远端依赖未冻结: ${dependency}`);}
 }
});

test('MMV正式观测用真实中央机器hostname；device身份冒认MMV拒绝',async()=>{
 const {observeDeployment}=await import(path);
 for(const hostname of ['aad17-2.macminivault.com','m4-xian.local']){
  const f=fixture();f.release.target='mmv';f.release.manifest_sha256=digest({environment:f.release.environment,target:'mmv',payload:f.release.payload});f.options.host='mmv';f.options.collect=async()=>({...f.options.manifest,observed_hostname:hostname});
  if(hostname.startsWith('aad17-2')){const actual=await observeDeployment(f.options);assert.equal(actual.target,'mmv');assert.equal(f.calls.find(c=>c.body).body.target,'mmv');}
  else{await assert.rejects(observeDeployment(f.options),/实际机器身份/);assert.equal(f.calls.some(c=>c.body),false);}
 }
});
