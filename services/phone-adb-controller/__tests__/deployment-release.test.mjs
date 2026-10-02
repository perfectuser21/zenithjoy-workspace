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
