import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peerHash,peerCanonical} from './official-phone-peer-protocol.mjs';
const need=(v,code)=>{if(!v)throw Error('OFFICIAL_PHONE_EXECUTION_'+code);};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const same=(a,b)=>peerCanonical(a)===peerCanonical(b);
export const phoneExecutionHash=value=>peerHash(value);
export function validatePhoneExecution(value,{sourceCommit,workflow,resources,runtimeRoot=dirname(fileURLToPath(import.meta.url))}={}){
 const d=structuredClone(value),f=d?.snapshot,m=d?.deployment,r=d?.release;
 need(d?.protocol==='official-phone-execution/v1'&&d.host==='xian-m4'&&[d.profile,d.serial,d.account].every(v=>typeof v==='string'&&v.length>0&&v.length<=160&&!/[\r\n\0]/.test(v)),'IDENTITY');
 need(/^[a-f0-9]{40}$/.test(sourceCommit||'')&&m?.source_commit===sourceCommit&&m.target==='xian-m4'&&m.environment===`staging:${sourceCommit}`,'SOURCE');
 need(d.runtime_root===`/Users/jinnuoshengyuan/.local/share/zenithjoy/phone-candidates/${sourceCommit}/runtime`&&d.run_root==='/Users/jinnuoshengyuan/.local/share/zenithjoy/official-phone-runs','PATH');
 need(uuid.test(r?.id||'')&&uuid.test(m.observation_id||'')&&m.release_id===r.id&&r.target==='xian-m4'&&r.environment===m.environment&&r.manifest_sha256===peerHash({environment:r.environment,target:r.target,payload:r.payload}),'RELEASE');
 need(d.observation?.id===m.observation_id&&d.observation.release_id===r.id&&d.observation.payload?.target==='xian-m4'&&d.observation.payload?.environment===m.environment&&same(d.observation.payload.components,r.payload.components),'OBSERVATION');
 need(d.gate?.deployed===true&&d.gate.actual_matches===true&&d.gate.current_observation_id===m.observation_id&&d.gate.verification?.ci_status==='verified'&&d.gate.verification?.status==='verified'&&Array.isArray(d.gate.gaps)&&d.gate.gaps.length===0,'GATE');
 const {snapshot_sha256,...body}=f||{};need(snapshot_sha256===peerHash(body)&&same(f.deployment,m)&&same(f.release,r)&&f.workflow_version?.payload?.key===workflow,'SNAPSHOT');
 need(['douyin_video_discovery','douyin_video_processing'].includes(workflow)&&resources?.profile===d.profile&&resources.serial===d.serial&&resources.account===d.account,'RESOURCE');
 const brain=new URL(d.brain_url);need(['http:','https:'].includes(brain.protocol)&&!brain.username&&!brain.password&&!brain.search&&!brain.hash&&brain.pathname==='/'&&!['localhost','127.0.0.1','::1','[::1]'].includes(brain.hostname),'BRAIN_ROUTE');
 if(workflow==='douyin_video_processing')for(const name of ['scp','ssh'])need(d.audio_transfer?.executables?.[name]?.path==='/usr/bin/'+name&&/^[a-f0-9]{64}$/.test(d.audio_transfer.executables[name].sha256),'AUDIO_TRANSFER');
 const scope=f.discovery_phone_scope||f.collection_phone_scope;
 need(scope?.target==='xian-m4'&&scope.profile===d.profile&&scope.serial===d.serial&&scope.expected_account===d.account&&scope.policy?.schema_version===1&&scope.policy.host_id==='xian-m4'&&scope.policy.transport==='usb'&&scope.policy.endpoint==='tcp:127.0.0.1:5037'&&same(scope.policy.forbidden_ports,[5041,5042]),'USB');
 need(scope.policy_binding?.usb_local?.protocol==='usb-local-lease/v1'&&Number.isSafeInteger(scope.policy_binding.usb_local.device_sdk)&&scope.policy_binding.usb_local.device_sdk>0,'USB_BINDING');
 need(f.preflight_profile?.profile===d.profile&&f.preflight_profile?.serial===d.serial&&f.preflight_profile.enabled===true,'PROFILE');
 const files=Object.fromEntries(Object.entries(f.files||{}).filter(([p])=>p.startsWith('runtime/')).map(([p,h])=>[p.slice(8),h]));
 need(Array.isArray(m.files)&&m.files.length>0&&m.files.every(row=>files[row.deployed_path]===row.content_sha256),'FILE_CLOSURE');
 need(files['official-phone-peer-host.mjs']&&files['official-phone-peer-runtime.mjs']&&files['phone-operation-admission.mjs']&&files['deployment-manifest.json']&&Object.keys(files).every(p=>p&&!p.startsWith('/')&&p.split('/').every(v=>v&&v!=='.'&&v!=='..')&&/^[a-f0-9]{64}$/.test(files[p])),'FILES');
 const read=name=>{need(typeof name==='string'&&name.startsWith('config/')&&name.split('/').every(v=>v&&v!=='.'&&v!=='..')&&files[name],'REGISTRY_SOURCE');const path=join(runtimeRoot,name),s=lstatSync(path);need(s.isFile()&&!s.isSymbolicLink()&&!(s.mode&0o022)&&realpathSync(path)===path,'REGISTRY_SOURCE');const bytes=readFileSync(path);need(peerHash(bytes)===files[name],'REGISTRY_SOURCE');return bytes;};
 const hosts=JSON.parse(read('config/collection-phone-hosts.json')).hosts.filter(h=>h.target===d.host&&h.profile===d.profile&&h.serial===d.serial);
 need(hosts.length===1&&hosts[0].expected_account===d.account&&Array.isArray(hosts[0].workflow_keys)&&hosts[0].workflow_keys.includes(workflow)&&same(hosts[0].policy,scope.policy),'REGISTRY');
 const rows=JSON.parse(read('config/native-phone-command-sources.json')).device_sources.filter(r=>r.profile===d.profile&&r.serial===d.serial);
 need(rows.length===1&&rows[0].device_sdk===scope.policy_binding.usb_local.device_sdk&&rows[0].width===f.preflight_profile.width&&rows[0].height===f.preflight_profile.height&&rows[0].review&&typeof rows[0].review.path==='string'&&rows[0].review.path.startsWith('config/native-phone-reviews/')&&rows[0].review.sha256===files[rows[0].review.path],'REVIEW');
 need(peerHash(read(rows[0].review.path))===rows[0].review.sha256,'REVIEW');
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
