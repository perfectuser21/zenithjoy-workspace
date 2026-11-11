import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {peerHash,peerCanonical} from './official-phone-peer-protocol.mjs';
const need=(v,code)=>{if(!v)throw Error('OFFICIAL_PHONE_EXECUTION_'+code);};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const same=(a,b)=>peerCanonical(a)===peerCanonical(b);
export const phoneExecutionHash=value=>peerHash(value);
export function validatePhoneExecution(value,{sourceCommit,workflow,resources}={}){
 const d=structuredClone(value),f=d?.snapshot,m=d?.deployment,r=d?.release;
 need(d?.protocol==='official-phone-execution/v1'&&d.host==='xian-m4'&&d.profile==='xiaolongxia'&&d.serial==='ANGYVB4311010223'&&d.account==='90915521618','IDENTITY');
 need(/^[a-f0-9]{40}$/.test(sourceCommit||'')&&m?.source_commit===sourceCommit&&m.target==='xian-m4'&&m.environment===`staging:${sourceCommit}`,'SOURCE');
 need(d.runtime_root===`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${sourceCommit}/runtime`&&d.run_root==='/Users/jinnuoshengyuan/.local/share/zenithjoy/official-phone-runs','PATH');
 need(uuid.test(r?.id||'')&&uuid.test(m.observation_id||'')&&m.release_id===r.id&&r.target==='xian-m4'&&r.environment===m.environment&&r.manifest_sha256===peerHash({environment:r.environment,target:r.target,payload:r.payload}),'RELEASE');
 need(d.observation?.id===m.observation_id&&d.observation.release_id===r.id&&d.observation.payload?.target==='xian-m4'&&d.observation.payload?.environment===m.environment&&same(d.observation.payload.components,r.payload.components),'OBSERVATION');
 need(d.gate?.deployed===true&&d.gate.actual_matches===true&&d.gate.current_observation_id===m.observation_id&&d.gate.verification?.ci_status==='verified'&&d.gate.verification?.status==='verified'&&Array.isArray(d.gate.gaps)&&d.gate.gaps.length===0,'GATE');
 const {snapshot_sha256,...body}=f||{};need(snapshot_sha256===peerHash(body)&&same(f.deployment,m)&&same(f.release,r)&&f.workflow_version?.payload?.key===workflow,'SNAPSHOT');
 need(['douyin_video_discovery','douyin_video_processing'].includes(workflow)&&resources?.profile===d.profile&&resources.serial===d.serial&&resources.account===d.account,'RESOURCE');
 const brain=new URL(d.brain_url);need(['http:','https:'].includes(brain.protocol)&&!brain.username&&!brain.password&&!brain.search&&!brain.hash&&brain.pathname==='/'&&!['localhost','127.0.0.1','::1','[::1]'].includes(brain.hostname),'BRAIN_ROUTE');
 const scope=f.discovery_phone_scope||f.collection_phone_scope;
 need(scope?.target==='xian-m4'&&scope.profile===d.profile&&scope.serial===d.serial&&scope.expected_account===d.account&&scope.policy?.schema_version===1&&scope.policy.host_id==='xian-m4'&&scope.policy.transport==='usb'&&scope.policy.endpoint==='tcp:127.0.0.1:5037'&&same(scope.policy.forbidden_ports,[5041,5042]),'USB');
 need(scope.policy_binding?.usb_local?.protocol==='usb-local-lease/v1'&&scope.policy_binding.usb_local.device_sdk===35,'USB_BINDING');
 need(f.preflight_profile?.profile===d.profile&&f.preflight_profile?.serial===d.serial&&f.preflight_profile.enabled===true,'PROFILE');
 const files=Object.fromEntries(Object.entries(f.files||{}).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 need((m.files||[]).every(row=>files[row.deployed_path]===row.content_sha256),'FILE_CLOSURE');
 need(files['official-phone-peer-host.mjs']&&files['official-phone-peer-runtime.mjs']&&files['phone-operation-admission.mjs']&&files['deployment-manifest.json']&&Object.keys(files).every(p=>p&&!p.startsWith('/')&&p.split('/').every(v=>v&&v!=='.'&&v!=='..')&&/^[a-f0-9]{64}$/.test(files[p])),'FILES');
 return Object.freeze(d);
}
export function assertPhoneExecutionFiles(descriptor,root){
 need(root===descriptor.runtime_root&&realpathSync(root)===root,'ROOT');
 for(const [relative,hash] of Object.entries(descriptor.snapshot.files).filter(([p])=>p.startsWith('runtime/'))){const path=join(root,relative.slice(8)),s=lstatSync(path);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&!(s.mode&0o022)&&s.nlink===1&&realpathSync(path)===path&&peerHash(readFileSync(path))===hash,'FILE');}
 need(same(JSON.parse(readFileSync(join(root,'deployment-manifest.json'))),descriptor.deployment),'MANIFEST');
}
export function buildPhonePeerSession({identity,frozen,phoneExecution,deadline_ms}){
 const d=validatePhoneExecution(phoneExecution,{sourceCommit:frozen.deployment.source_commit,workflow:frozen.workflow_version.payload.key,resources:frozen.public_domain?.phone_resources??frozen.agent_input});
 const p=frozen.public_domain;need(p&&identity.run_id===p.run_id&&identity.task_id===p.task_id&&same(identity.run_binding,p.run_binding)&&Number.isSafeInteger(deadline_ms)&&deadline_ms===p.cleanup_deadline_ms&&Date.now()<deadline_ms,'PARENT');
 return {descriptor:d,parent:{identity:structuredClone(identity),snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,claim:structuredClone(frozen.native_claim)},deadline_ms};
}
