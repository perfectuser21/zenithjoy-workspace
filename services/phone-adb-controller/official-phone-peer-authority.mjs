import {hostname} from 'node:os';
import {deploymentTarget} from './runtime-host.mjs';
import {fetchBrainAuthorityGet} from './brain-authority-get.mjs';
import {validatePhoneExecution,assertPhoneExecutionFiles} from './official-phone-execution.mjs';
import {peerCanonical,peerHash} from './official-phone-peer-protocol.mjs';
const permits=new WeakMap(),ownerStops=new WeakMap();
const fail=()=>{throw Error('OFFICIAL_PHONE_PEER_AUTHORITY');};
export function phonePeerPermitRecord(permit){const v=permits.get(permit);if(!v||Date.now()>=v.deadline_ms)fail();return structuredClone(v);}
export function delegatedPhoneOwnerStopped(proof,scope){return ownerStops.get(proof)===peerHash(scope);}
export function createDelegatedPhoneOwnerStop(permit,scope){const p=phonePeerPermitRecord(permit);if(scope.run_id!==p.identity.run_id||scope.task_id!==p.identity.task_id||scope.source_commit!==p.parent.source_commit||Date.now()>=scope.receipt_deadline_ms)fail();const proof=Object.freeze({execution_stopped:true,protocol:'delegated-phone-owner-stop/v1'});ownerStops.set(proof,peerHash(scope));return proof;}
export async function verifyPhonePeerBootstrap({bootstrap,root,env,get}={}){
 if(deploymentTarget(hostname())!=='xian-m4'||!env.BRAIN_URL||!env.BRAIN_INTERNAL_TOKEN)fail();
 const {session,parent,descriptor,identity}=bootstrap??{},f=parent?.frozen;
 if(descriptor?.brain_url!==env.BRAIN_URL||bootstrap.protocol!=='official-phone-peer-bootstrap/v1'||!session||session.run_id!==identity?.run_id||session.task_id!==identity?.task_id||session.source_commit!==f?.deployment?.source_commit||session.descriptor_sha256!==peerHash(descriptor)||session.deadline_ms!==f.public_domain?.cleanup_deadline_ms||session.deadline_ms<=Date.now()||parent.snapshot_sha256!==f.snapshot_sha256)fail();
 const {snapshot_sha256,...body}=f;if(peerHash(body)!==snapshot_sha256||f.execution_mode!=='agent'||f.primary_host!=='official-child-v1'||f.deployment.target!=='mmv'||f.release.target!=='mmv'||identity.machine_id!=='us-mac-m4'||peerCanonical(identity.run_binding)!==peerCanonical(f.public_domain.run_binding))fail();
 const d=validatePhoneExecution(descriptor,{sourceCommit:session.source_commit,workflow:f.workflow_version.payload.key,resources:f.public_domain.phone_resources??f.agent_input});assertPhoneExecutionFiles(d,root);
 if(peerCanonical(d.snapshot.workflow_version)!==peerCanonical(f.workflow_version)||peerCanonical(d.snapshot.activities)!==peerCanonical(f.activities))fail();
 const request=get??(async path=>{const r=await fetchBrainAuthorityGet(new URL(path,env.BRAIN_URL),{headers:{Authorization:'Bearer '+env.BRAIN_INTERNAL_TOKEN},timeoutMs:8000});if(!r.ok)fail();return r.json();});
 const {validatePublicDomainIdentity,publicDomainTaskProjectionMatches}=await import('./public-domain-authority.mjs');validatePublicDomainIdentity(identity);
 const record={identity:structuredClone(identity),parent:{source_commit:session.source_commit,snapshot_sha256:f.snapshot_sha256,claim:structuredClone(f.native_claim)},descriptor:structuredClone(d),deadline_ms:session.deadline_ms,session:structuredClone(session)};
 async function assertAuthority({resourceOnly=false,phase='execute'}={}){
  if(Date.now()>=record.deadline_ms)fail();assertPhoneExecutionFiles(d,root);
  const task=await request('/api/brain/tasks/'+identity.task_id),b=identity.run_binding;
  const a={identity,binding:{id:b.run_binding_id,run_id:identity.run_id,task_id:identity.task_id,workflow_id:b.workflow_id,workflow_definition_version_id:b.workflow_definition_version_id,attempt_key:b.attempt_key,activities:b.activities}};
  if(!publicDomainTaskProjectionMatches(task,a)||peerCanonical({claimed_by:task.claimed_by,claimed_at:task.claimed_at})!==peerCanonical(f.native_claim))fail();
  for(const wanted of [{release:f.release,deployment:f.deployment},{release:d.release,deployment:d.deployment}]){
   const gate=await request('/api/brain/releases/'+wanted.release.id+'/gate');
   if(!gate?.release_id||gate.release_id!==wanted.release.id||!gate.manifest_sha256||gate.manifest_sha256!==wanted.release.manifest_sha256||gate.deployed!==true||gate.actual_matches!==true||gate.current_observation_id!==wanted.deployment.observation_id||gate.verification?.ci_status!=='verified'||gate.verification?.status!=='verified')fail();
  }
  if(phase!=='prepare'&&!(phase==='close'&&resourceOnly===true)){
   const value=await request('/api/brain/device-locks'),rows=value.locks?.filter(r=>r.device_name===d.serial);
   if(value.success!==true||rows?.length!==1||rows[0].locked_by!==identity.task_id||!Number.isFinite(Date.parse(rows[0].expires_at))||Date.parse(rows[0].expires_at)<=Date.now()+1000)fail();
  }
  if(Date.now()>=record.deadline_ms)fail();assertPhoneExecutionFiles(d,root);return true;
 }
 await assertAuthority({phase:'prepare',resourceOnly:true});const permit=Object.freeze({});permits.set(permit,record);return {permit,assertAuthority};
}
