import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {digest} from '../runtime-definition.mjs';
import {processIdentity} from '../native-operation-receipt.mjs';
import {spawnSync} from 'node:child_process';
import * as authority from '../standalone-skill-authority.mjs';
const id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture(){
 const home=mkdtempSync(join(realpathSync(tmpdir()),'standalone-host-')),runDirectory=join(home,'runs',id('2'));mkdirSync(runDirectory,{recursive:true,mode:0o700});
 const identity={protocol:'codex-exec-v1',task_id:id('1'),run_id:id('2'),task_run_id:id('3'),claimer:'direct-host',claimed_at:new Date().toISOString(),machine_id:'mmv',profile_sha256:'a'.repeat(64),scope_sha256:'b'.repeat(64),approved_keywords:['AI办公'],skill:{name:'douyin-leadgen-direct',version:'0.1.0',source_commit:'c'.repeat(40),path:'skill/SKILL.md',sha256:'d'.repeat(64)},company:{company_id:id('4'),tenant_id:id('5'),version:1,policy_id:'original'},run_binding:{run_binding_id:id('6'),workflow_id:id('7'),workflow_definition_version_id:id('8'),attempt_key:'a1',activities:{preflight:{reference_id:id('9'),activity_id:id('a'),activity_definition_version_id:id('b')}}}};
 const body={execution_mode:'agent',primary_host:'codex-exec-v1',standalone_skill:identity,deployment:{source_commit:'e'.repeat(40)},run_identity:{tag:'host-fixture'},files:{}};
 return {home,runDirectory,frozen:{...body,snapshot_sha256:digest(body)}};
}
function install(f){const paths=authority.standaloneHostProofPaths(f.frozen,{home:f.home});mkdirSync(paths.directory,{recursive:true,mode:0o700});const record=authority.createStandaloneHostProof({frozen:f.frozen,runDirectory:f.runDirectory});writeFileSync(paths.proof_path,JSON.stringify(record),{flag:'wx',mode:0o600});return {paths,record};}
test('host authority exports a self-only record builder and a fresh global verifier',()=>{
 assert.equal(typeof authority.createStandaloneHostProof,'function');assert.equal(typeof authority.readStandaloneHostProof,'function');assert.equal(typeof authority.standaloneHostProofPaths,'function');
});
test('healthy fresh host proof pins actual process and every frozen execution identity',()=>{
 const f=fixture();try{const {record}=install(f),actual=authority.readStandaloneHostProof(f);assert.deepEqual(actual,record);assert.equal(record.process_identity.pid,process.pid);assert.equal(record.process_identity.uid,process.getuid());assert.ok(record.process_identity.start_identity);assert.throws(()=>authority.createStandaloneHostProof({...f,pid:1}),/EPOCH_STANDALONE_IDENTITY/);}finally{rmSync(f.home,{recursive:true,force:true});}
});
test('dead or reused PID and every mismatched protected identity remain quarantined',()=>{
 const f=fixture();try{const {record,paths}=install(f);
 for(const mutate of [p=>p.task_id=id('f'),p=>p.run_id=id('f'),p=>p.task_run_id=id('f'),p=>p.run_binding_id=id('f'),p=>p.source_commit='f'.repeat(40),p=>p.snapshot_sha256='f'.repeat(64),p=>p.run_directory=f.home,p=>p.process_identity.uid=process.getuid()+1]){const value=structuredClone(record);mutate(value);writeFileSync(paths.proof_path,JSON.stringify(value));assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);}
 writeFileSync(paths.proof_path,JSON.stringify(record));assert.throws(()=>authority.readStandaloneHostProof({...f,inspectProcess:()=>null}),/EPOCH_STANDALONE_IDENTITY/);assert.throws(()=>authority.readStandaloneHostProof({...f,inspectProcess:()=>({...record.process_identity,start_identity:'reused'})}),/EPOCH_STANDALONE_IDENTITY/);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('unknown of any type, invalid proof ownership layout and permission drift never grant live authority',()=>{
 const f=fixture();try{const {paths}=install(f);
 for(const kind of ['bad-json','directory','symlink']){if(kind==='directory')mkdirSync(paths.unknown_path,{mode:0o700});else if(kind==='symlink')symlinkSync(paths.proof_path,paths.unknown_path);else writeFileSync(paths.unknown_path,'broken',{mode:0o600});assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);rmSync(paths.unknown_path,{recursive:true,force:true});}
 chmodSync(paths.proof_path,0o644);assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);chmodSync(paths.proof_path,0o600);
 const alias=paths.proof_path+'.alias';linkSync(paths.proof_path,alias);assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);rmSync(alias);
 chmodSync(paths.directory,0o755);assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('final fresh check refuses revocation or unknown introduced during other admission work',async()=>{
 const f=fixture();try{const {paths}=install(f);authority.readStandaloneHostProof(f);await Promise.resolve();writeFileSync(paths.unknown_path,'unknown',{mode:0o600});assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);rmSync(paths.unknown_path);authority.readStandaloneHostProof(f);rmSync(paths.proof_path);assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);}finally{rmSync(f.home,{recursive:true,force:true});}
});
test('only exact new standalone marker is active; legacy and other quarantine flags retain rejection',()=>{
 assert.equal(typeof authority.standaloneLocalLockQuarantined,'function');const f=fixture(),tag=f.frozen.run_identity.tag+'\n';
 try{assert.equal(authority.standaloneLocalLockQuarantined(f.frozen,['standalone_review_required'],tag),false);assert.equal(authority.standaloneLocalLockQuarantined(f.frozen,[],undefined),true);assert.equal(authority.standaloneLocalLockQuarantined(f.frozen,['standalone_review_required'],'other\n'),true);
 for(const flag of ['standalone_quarantined','preflight_quarantined','preflight_proof_required','epoch_fence_lost'])assert.equal(authority.standaloneLocalLockQuarantined(f.frozen,['standalone_review_required',flag],tag),true);
 const legacy={...f.frozen};delete legacy.standalone_skill;assert.equal(authority.standaloneLocalLockQuarantined(legacy,['standalone_review_required'],tag),true);assert.equal(authority.standaloneLocalLockQuarantined(legacy,[],undefined),false);assert.equal(authority.standaloneLocalLockQuarantined(legacy,['standalone_quarantined'],undefined),true);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('unknown created during final PID inspection is refused before the fresh host guard returns',()=>{
 const f=fixture();try{const {paths}=install(f);authority.readStandaloneHostProof(f);
  assert.throws(()=>authority.readStandaloneHostProof({...f,inspectProcess:(pid,deadline)=>{const actual=processIdentity(pid,deadline);writeFileSync(paths.unknown_path,'new unknown during final inspection',{mode:0o600});return actual;}}),/EPOCH_STANDALONE_IDENTITY/);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('a real host process that published its own proof and exited cannot remain admitted',()=>{
 const f=fixture();try{const paths=authority.standaloneHostProofPaths(f.frozen,{home:f.home});mkdirSync(paths.directory,{recursive:true,mode:0o700});
  const script=`import {readFileSync,writeFileSync} from 'node:fs';import {createStandaloneHostProof} from ${JSON.stringify(new URL('../standalone-skill-authority.mjs',import.meta.url).href)};const v=JSON.parse(readFileSync(0,'utf8'));const proof=createStandaloneHostProof({frozen:v.frozen,runDirectory:v.runDirectory});writeFileSync(v.proof_path,JSON.stringify(proof),{flag:'wx',mode:0o600});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify({frozen:f.frozen,runDirectory:f.runDirectory,proof_path:paths.proof_path}),encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);
  assert.throws(()=>authority.readStandaloneHostProof(f),/EPOCH_STANDALONE_IDENTITY/);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
