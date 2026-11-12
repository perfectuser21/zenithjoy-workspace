import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peerHash} from '../official-phone-peer-protocol.mjs';
import {verifyPhonePeerBootstrap} from '../official-phone-peer-authority.mjs';

function fixture(t,{fullRelease='timeout'}={}){
 const source=fileURLToPath(new URL('../',import.meta.url));
 const temp=fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(),'phone-peer-authority-')));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const commit='a'.repeat(40),root=`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${commit}/runtime`;
 const resources={profile:'xiaolongxia',serial:'ANGYVB4311010223',account:'90915521618'};
 const sourceRow=JSON.parse(fs.readFileSync(join(source,'config/native-phone-command-sources.json'))).device_sources.find(row=>row.profile===resources.profile);
 const host=JSON.parse(fs.readFileSync(join(source,'config/collection-phone-hosts.json'))).hosts.find(row=>row.profile===resources.profile);
 const paths=['official-phone-peer-host.mjs','official-phone-peer-runtime.mjs','phone-operation-admission.mjs','config/collection-phone-hosts.json','config/native-phone-command-sources.json',sourceRow.review.path];
 const files=Object.fromEntries(paths.map(path=>['runtime/'+path,peerHash(fs.readFileSync(join(source,path)))]));
 const release=target=>{const value={id:randomUUID(),target,environment:'staging:'+commit,payload:{components:[]}};return {...value,manifest_sha256:peerHash({environment:value.environment,target,payload:value.payload})};};
 const phoneRelease=release('xian-m4'),parentRelease=release('mmv');
 const deployment={source_commit:commit,target:'xian-m4',environment:phoneRelease.environment,release_id:phoneRelease.id,observation_id:randomUUID(),files:paths.map(path=>({deployed_path:path,content_sha256:files['runtime/'+path]}))};
 const manifest=join(temp,'deployment-manifest.json');fs.writeFileSync(manifest,JSON.stringify(deployment),{mode:0o600});files['runtime/deployment-manifest.json']=peerHash(fs.readFileSync(manifest));
 const ref={reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()};
 const binding={run_binding_id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:randomUUID(),attempt_key:'a1',activities:{collect_videos:ref}};
 const identity={mode:'formal',run_id:randomUUID(),task_id:randomUUID(),machine_id:'us-mac-m4',profile_sha256:'b'.repeat(64),run_binding:binding};
 const workflow_version={id:binding.workflow_definition_version_id,payload:{key:'douyin_video_discovery'}},activities=[{reference:{slot_key:'collect_videos',...ref},version:{id:ref.activity_definition_version_id}}];
 const phoneSnapshot={deployment,release:phoneRelease,workflow_version,activities,files,preflight_profile:{profile:resources.profile,serial:resources.serial,width:sourceRow.width,height:sourceRow.height,enabled:true},discovery_phone_scope:{target:'xian-m4',...resources,expected_account:resources.account,policy:host.policy,policy_binding:{usb_local:{protocol:'usb-local-lease/v1',device_sdk:sourceRow.device_sdk}}}};
 phoneSnapshot.snapshot_sha256=peerHash(phoneSnapshot);
 const verification={ci_status:'verified',status:'verified'};
 const descriptor={protocol:'official-phone-execution/v1',host:'xian-m4',...resources,brain_url:'https://brain.example.test/',runtime_root:root,run_root:'/Users/jinnuoshengyuan/.local/share/zenithjoy/official-phone-runs',release:phoneRelease,deployment,snapshot:phoneSnapshot,observation:{id:deployment.observation_id,release_id:phoneRelease.id,payload:{target:'xian-m4',environment:phoneRelease.environment,components:[]}},gate:{deployed:true,actual_matches:true,current_observation_id:deployment.observation_id,verification,gaps:[]}};
 const claim={claimed_by:'common-runner',claimed_at:'2026-11-12T00:00:00.000Z'},deadline=Date.now()+60000;
 const frozen={execution_mode:'agent',primary_host:'official-child-v1',deployment:{source_commit:commit,target:'mmv',observation_id:randomUUID()},release:parentRelease,workflow_version,activities,native_claim:claim,public_domain:{cleanup_deadline_ms:deadline,run_binding:binding,phone_resources:resources}};
 frozen.snapshot_sha256=peerHash(frozen);
 const session={run_id:identity.run_id,task_id:identity.task_id,source_commit:commit,descriptor_sha256:peerHash(descriptor),deadline_ms:deadline};
 const bootstrap={protocol:'official-phone-peer-bootstrap/v1',session,parent:{frozen,snapshot_sha256:frozen.snapshot_sha256},descriptor,identity};
 const task={id:identity.task_id,status:'in_progress',...claim,result:{common_runner:{...identity,task_id:identity.task_id}}};
 const releases=new Map([parentRelease,phoneRelease].map(value=>[value.id,value]));
 const gates=new Map([[parentRelease.id,frozen.deployment],[phoneRelease.id,deployment]].map(([id,d])=>[id,{release_id:id,manifest_sha256:releases.get(id).manifest_sha256,deployed:true,actual_matches:true,current_observation_id:d.observation_id,verification:structuredClone(verification),gaps:[]}]));
 const locks={success:true,locks:[{device_name:resources.serial,locked_by:identity.task_id,expires_at:new Date(deadline).toISOString()}]},reads=[];
 const get=async path=>{
  reads.push(path);
  if(path==='/api/brain/tasks/'+identity.task_id)return task;
  if(path==='/api/brain/device-locks')return locks;
  const match=path.match(/^\/api\/brain\/releases\/([^/]+)(\/gate)?$/);
  assert.ok(match,'unexpected authority endpoint');
  if(match[2])return gates.get(match[1]);
  if(fullRelease==='timeout')throw new DOMException('release body exceeded the authority deadline','TimeoutError');
  return {release:releases.get(match[1])};
 };
 const original={read:fs.readFileSync,lstat:fs.lstatSync,realpath:fs.realpathSync};
 const local=path=>String(path)===root?temp:String(path).startsWith(root+'/')?(String(path)===root+'/deployment-manifest.json'?manifest:join(source,String(path).slice(root.length+1))):path;
 t.mock.method(os,'hostname',()=> 'mac-mini-m4-xian');
 t.mock.method(fs,'readFileSync',(path,...args)=>original.read(local(path),...args));
 t.mock.method(fs,'lstatSync',(path,...args)=>original.lstat(local(path),...args));
 t.mock.method(fs,'realpathSync',(path,...args)=>String(path)===root||String(path).startsWith(root+'/')?String(path):original.realpath(path,...args));
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return {root,bootstrap,task,gates,locks,reads,parentRelease,phoneRelease,deadline,verify:()=>verifyPhonePeerBootstrap({bootstrap,root,env:{BRAIN_URL:descriptor.brain_url,BRAIN_INTERNAL_TOKEN:'fixture-only-brain-authority-token'},get})};
}

test('手机peer授权不读取会超时的完整release正文，仅消费绑定的权威gate',async t=>{
 const f=fixture(t),admitted=await f.verify();
 assert.equal(await admitted.assertAuthority({phase:'prepare'}),true);
 assert.equal(f.reads.some(path=>/^\/api\/brain\/releases\/[^/]+$/.test(path)),false);
 assert.ok(f.reads.includes('/api/brain/releases/'+f.parentRelease.id+'/gate'));
 assert.ok(f.reads.includes('/api/brain/releases/'+f.phoneRelease.id+'/gate'));
});

for(const side of ['parentRelease','phoneRelease'])for(const [name,mutate]of Object.entries({
 'foreign-release':gate=>gate.release_id=randomUUID(),
 'missing-release':gate=>delete gate.release_id,
 'foreign-manifest':gate=>gate.manifest_sha256='c'.repeat(64),
 'missing-manifest':gate=>delete gate.manifest_sha256,
 'not-deployed':gate=>gate.deployed=false,
 'drift':gate=>{gate.actual_matches=false;gate.gaps=['component drift'];},
 'foreign-observation':gate=>gate.current_observation_id=randomUUID(),
 'ci-pending':gate=>gate.verification.ci_status='pending',
 'verification-pending':gate=>gate.verification.status='pending'
}))test('权威gate拒绝 '+side+' '+name,async t=>{
 const f=fixture(t,{fullRelease:'available'});mutate(f.gates.get(f[side].id));
 await assert.rejects(f.verify,/OFFICIAL_PHONE_PEER_AUTHORITY/);
});

for(const [name,mutate]of Object.entries({
 'task-status':f=>f.task.status='failed',
 'task-projection':f=>f.task.result.common_runner.profile_sha256='c'.repeat(64),
 'claim-epoch':f=>f.task.claimed_at='2026-11-12T00:00:00.001Z'
}))test('小gate不替代原Task授权 '+name,async t=>{
 const f=fixture(t,{fullRelease:'available'});mutate(f);await assert.rejects(f.verify,/OFFICIAL_PHONE_PEER_AUTHORITY/);
});

for(const [name,mutate]of Object.entries({
 'foreign-owner':f=>f.locks.locks[0].locked_by=randomUUID(),
 'expired-lock':f=>f.locks.locks[0].expires_at=new Date(Date.now()-1000).toISOString(),
 'missing-lock':f=>f.locks.locks=[]
}))test('执行阶段仍核设备锁 '+name,async t=>{
 const f=fixture(t,{fullRelease:'available'}),admitted=await f.verify();mutate(f);
 await assert.rejects(()=>admitted.assertAuthority(),/OFFICIAL_PHONE_PEER_AUTHORITY/);
});

test('小gate不能延长原授权deadline',async t=>{
 const f=fixture(t,{fullRelease:'available'}),admitted=await f.verify();t.mock.method(Date,'now',()=>f.deadline);
 await assert.rejects(()=>admitted.assertAuthority({phase:'prepare'}),/OFFICIAL_PHONE_PEER_AUTHORITY/);
});
