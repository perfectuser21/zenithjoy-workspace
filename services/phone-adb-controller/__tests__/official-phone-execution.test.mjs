import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validatePhoneExecution} from '../official-phone-execution.mjs';
import {peerHash} from '../official-phone-peer-protocol.mjs';
import {registerDelegatedPhoneAuthority} from '../public-domain-authority.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const commit='a'.repeat(40),workflow='douyin_video_discovery',resources={profile:'xiaolongxia',serial:'ANGYVB4311010223',account:'90915521618'};
function descriptor(){const release={id:randomUUID(),target:'xian-m4',environment:'staging:'+commit,payload:{components:[]}};release.manifest_sha256=peerHash({target:release.target,environment:release.environment,payload:release.payload});const deployment={source_commit:commit,target:'xian-m4',environment:release.environment,release_id:release.id,observation_id:randomUUID(),files:[]};const files=Object.fromEntries(['official-phone-peer-host.mjs','official-phone-peer-runtime.mjs','phone-operation-admission.mjs','deployment-manifest.json'].map(p=>['runtime/'+p,'b'.repeat(64)]));for(const path of ['config/collection-phone-hosts.json','config/native-phone-command-sources.json','config/native-phone-reviews/xiaolongxia-sdk35-xian-m4.md'])files['runtime/'+path]=peerHash(readFileSync(new URL('../'+path,import.meta.url)));deployment.files=Object.entries(files).filter(([p])=>!p.endsWith('deployment-manifest.json')).map(([p,h])=>({deployed_path:p.slice(8),content_sha256:h}));const snapshot={deployment,release,workflow_version:{payload:{key:workflow}},files,preflight_profile:{profile:resources.profile,serial:resources.serial,width:1200,height:2664,enabled:true},discovery_phone_scope:{target:'xian-m4',profile:resources.profile,serial:resources.serial,expected_account:resources.account,policy:JSON.parse(readFileSync(new URL('../config/collection-phone-hosts.json',import.meta.url))).hosts.find(h=>h.profile===resources.profile).policy,policy_binding:{usb_local:{protocol:'usb-local-lease/v1',device_sdk:35}}}};snapshot.snapshot_sha256=peerHash(snapshot);return {protocol:'official-phone-execution/v1',host:'xian-m4',...resources,brain_url:'https://brain.example.test/',runtime_root:`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${commit}/runtime`,run_root:'/Users/jinnuoshengyuan/.local/share/zenithjoy/official-phone-runs',release,deployment,snapshot,observation:{id:deployment.observation_id,release_id:release.id,payload:{target:'xian-m4',environment:release.environment,components:[]}},gate:{deployed:true,actual_matches:true,current_observation_id:deployment.observation_id,verification:{ci_status:'verified',status:'verified'},gaps:[]}};}
test('双端descriptor独立冻结手机source/release/observation；manifest不要求自引用hash',()=>{const d=descriptor();assert.equal(validatePhoneExecution(d,{sourceCommit:commit,workflow,resources}).host,'xian-m4');assert.equal(d.deployment.files.some(r=>r.deployed_path==='deployment-manifest.json'),false);});
for(const [name,change]of Object.entries({source:d=>d.deployment.source_commit='c'.repeat(40),observation:d=>d.gate.current_observation_id=randomUUID(),ci:d=>d.gate.verification.ci_status='pending',route:d=>d.brain_url='http://localhost:5221/',account:d=>d.account='other',runtime:d=>d.runtime_root='/tmp/free-runtime',snapshot:d=>d.snapshot.preflight_profile.enabled=false}))test('descriptor拒绝独立材料漂移 '+name,()=>{const d=descriptor();change(d);assert.throws(()=>validatePhoneExecution(d,{sourceCommit:commit,workflow,resources}));});
test('serialized JSON不能登记M4 delegated authority',()=>{assert.throws(()=>registerDelegatedPhoneAuthority({permit:{identity:{},deadline_ms:Date.now()+1000},runDirectory:'/tmp/unused',frozen:{}}),/PHONE_PEER_AUTHORITY/);});

function reviewedDescriptor(t){
 const runtimeRoot=realpathSync(mkdtempSync(join(tmpdir(),'phone-descriptor-registry-')));t.after(()=>rmSync(runtimeRoot,{recursive:true,force:true}));
 const d=descriptor(),selected={profile:'reviewed-second-phone',serial:'SYNTHETIC-USB-36',account:'fixture-account'},reviewPath='config/native-phone-reviews/fixture.json';
 Object.assign(d,selected);Object.assign(d.snapshot.preflight_profile,{...selected,width:1200,height:2664});
 Object.assign(d.snapshot.discovery_phone_scope,{...selected,expected_account:selected.account});d.snapshot.discovery_phone_scope.policy_binding.usb_local.device_sdk=36;
 const host={target:'xian-m4',...selected,expected_account:selected.account,workflow_keys:[workflow],policy:d.snapshot.discovery_phone_scope.policy};
 const review=Buffer.from('{"fixture_only":true}\n'),source={profile:selected.profile,serial:selected.serial,device_sdk:36,width:1200,height:2664,review:{path:reviewPath,sha256:peerHash(review)}};
 const documents={'config/collection-phone-hosts.json':{version:1,hosts:[host]},'config/native-phone-command-sources.json':{schema_version:1,device_sources:[source]},[reviewPath]:review};
 const seal=()=>{d.deployment.files=Object.entries(d.snapshot.files).filter(([p])=>!p.endsWith('deployment-manifest.json')).map(([p,h])=>({deployed_path:p.slice(8),content_sha256:h}));delete d.snapshot.snapshot_sha256;d.snapshot.snapshot_sha256=peerHash(d.snapshot);};
 const write=()=>{for(const [path,value]of Object.entries(documents)){const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));mkdirSync(join(runtimeRoot,path,'..'),{recursive:true});writeFileSync(join(runtimeRoot,path),bytes);d.snapshot.files['runtime/'+path]=peerHash(bytes);}seal();};write();
 return {d,host,source,documents,write,seal,validate:()=>validatePhoneExecution(d,{sourceCommit:commit,workflow,resources:selected,runtimeRoot})};
}
test('descriptor按冻结审核配置准入第二台USB手机与其SDK36',t=>{const f=reviewedDescriptor(t);assert.equal(f.validate().profile,'reviewed-second-phone');});
for(const [name,change]of Object.entries({
 'unapproved-workflow':f=>{f.host.workflow_keys=['douyin_video_processing'];},
 'duplicate-host':f=>{f.documents['config/collection-phone-hosts.json'].hosts.push(structuredClone(f.host));},
 'duplicate-source':f=>{f.documents['config/native-phone-command-sources.json'].device_sources.push(structuredClone(f.source));},
 'wrong-account':f=>{f.host.expected_account='foreign';},
 'wrong-sdk':f=>{f.source.device_sdk=35;},
 'missing-source':f=>{f.documents['config/native-phone-command-sources.json'].device_sources=[];},
 'missing-review':f=>{delete f.source.review;},
 'unfrozen-review':f=>{delete f.d.snapshot.files['runtime/'+f.source.review.path];f.seal();},
 'unfrozen-config':f=>{delete f.d.snapshot.files['runtime/config/collection-phone-hosts.json'];f.seal();}
}))test('第二台USB descriptor仍拒绝 '+name,t=>{const f=reviewedDescriptor(t);change(f);if(!name.startsWith('unfrozen-'))f.write();assert.throws(f.validate);});
test('descriptor拒绝冻结后配置原件漂移',t=>{const f=reviewedDescriptor(t);f.host.expected_account='foreign';f.write();const before=f.d.snapshot.files['runtime/config/native-phone-command-sources.json'];f.source.device_sdk=35;f.write();f.d.snapshot.files['runtime/config/native-phone-command-sources.json']=before;f.seal();assert.throws(f.validate);});
