// Code MMV RPC固定依赖消费者；只验证本run冻结字节与ACK，不创建授权或业务结果。
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFrozen,digest,canonical,frozenExecutionMode} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {assertRuntimeHost} from './runtime-host.mjs';
import {loadCodePg} from './preflight-pg-dependencies.mjs';
const fail=()=>{throw Error('CODE_PG_SCOPE_INVALID');};
export function requiresCodeRpcPool({runtimeRoot}){
 const parent=dirname(realpathSync(runtimeRoot));
 if(existsSync(join(parent,'run-definition.json'))){
  const frozen=readFrozen(parent);
  return frozen.deployment?.target==='mmv'&&frozenExecutionMode(frozen)==='code'
   &&['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(frozen.workflow_version?.payload?.key);
 }
 // 远端旧M4调用独立peer部署，没有本地冻结run；沿原源码/SSH验证，不借env声明取得Code本地身份。
 const d=JSON.parse(readFileSync(join(runtimeRoot,'deployment-manifest.json'),'utf8'));
 if(d.target==='mmv')assertRuntimeHost({target:d.target},d);
 return false;
}
export function loadCodeRpcPool({runtimeRoot,input,env=process.env}){
 if(['NODE_PATH','NODE_OPTIONS','NODE_PG_FORCE_NATIVE'].some(k=>env[k]))throw Error('CODE_PG_ENVIRONMENT_ROUTE');
 const tasks=['WF_BRAIN_TASK_ID','BRAIN_TASK_ID','WFR_BRAIN_TASK_ID'].map(k=>env[k]).filter(v=>v!==undefined&&v!=='');
 if(!tasks.length||new Set(tasks).size!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tasks[0]))fail();
 const taskId=tasks[0],dir=env.WFR_RUN_DIR;
 if(typeof dir!=='string'||!dir.startsWith('/')||realpathSync(dir)!==resolve(dir)||realpathSync(runtimeRoot)!==join(realpathSync(dir),'runtime')
  ||realpathSync(runtimeRoot)!==dirname(fileURLToPath(import.meta.url))||env.WF_HOME!==runtimeRoot||env.WFR_HOSTKEY!=='mmv'||!/^a[1-9][0-9]*$/.test(env.WFR_ATTEMPT||''))fail();
 const frozen=readFrozen(dir),r=frozen.run_identity,w=frozen.workflow_version?.payload?.key,e=input?.source?.execution,s=frozen.code_observer_scope;
 if(frozenExecutionMode(frozen)!=='code'||(env.LEADGEN_EXECUTION_MODE??'code')!=='code'||!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(w)
  ||!s||s.schema_version!==1||taskId!==s.task_id||s.workflow_key!==w||s.run_tag!==r?.tag||s.profile!==r?.profile||s.serial!==r?.serial||s.line!==env.LEADGEN_LINE
  ||!s.claim||Object.keys(s.claim).sort().join(',')!=='claimed_at,claimed_by'||typeof s.claim.claimed_by!=='string'||!s.claim.claimed_by.trim()||!Number.isFinite(Date.parse(s.claim.claimed_at))
  ||!Number.isSafeInteger(s.run_start_ts)||s.run_start_ts<1||!Number.isSafeInteger(s.run_max_seconds)||s.run_max_seconds<1||Date.now()>=(s.run_start_ts+s.run_max_seconds)*1000
  ||env.WF_RUN_START_TS!==String(s.run_start_ts)||env.WF_RUN_MAX_SECONDS!==String(s.run_max_seconds)
  ||input?.source?.commit!==frozen.deployment?.source_commit||!r||r.capability!==w||r.run_id!==basename(dir)||r.run_id!==w+'-'+r.tag
  ||env.WF_BRAIN_WORKFLOW!==w||env.WFR_TAG!==r.tag||env.P!==r.profile||env.SERIAL!==r.serial||!e
  ||e.run!==r.tag||e.profile!==r.profile||e.line!==env.LEADGEN_LINE||!/^[-A-Za-z0-9_]{1,120}$/.test(env.LEADGEN_LINE||'')
  ||e.run_id!==r.run_id+'__'+env.WFR_ATTEMPT||frozen.files?.['runtime/code-pg-runtime.mjs']!==digest(readFileSync(fileURLToPath(import.meta.url))))fail();
 assertRuntimeHost(frozen.release,frozen.deployment);
 let binding;try{binding=readBinding(dir,env.WFR_ATTEMPT,frozen);}catch{fail();}
 const request=JSON.parse(readFileSync(join(dir,'run-bindings',env.WFR_ATTEMPT+'.request.json'),'utf8')),body=request.body;
 const required={release_id:frozen.release?.id,observation_id:frozen.deployment?.observation_id,workflow_id:frozen.workflow_version?.payload?.workflow_id,workflow_definition_version_id:frozen.workflow_version?.id,snapshot_sha256:frozen.workflow_version?.payload_sha256,runtime_snapshot_sha256:frozen.snapshot_sha256,source_kind:'external',external_origin:'zenithjoy:mmv',attempt_key:env.WFR_ATTEMPT,actor:'runtime:phone-adb-controller'};
 if(!/^[0-9a-f-]{36}$/.test(binding.id||'')||request.run_id!==e.run_id||request.runtime_snapshot_sha256!==frozen.snapshot_sha256||!body||!binding.payload||canonical(body)!==canonical(binding.payload)||digest(body)!==binding.payload_sha256||binding.task_run_id!==null||!Array.isArray(body.expected_path)||!body.expected_path.length)fail();
 if(Object.keys(body).some(k=>![...Object.keys(required),'expected_path'].includes(k)))fail();
 for(const[k,v]of Object.entries(required)){
  if(v===undefined||body[k]!==v||Object.hasOwn(binding,k)&&binding[k]!==v)fail();
 }
 // 公开external协议不接受task_id/task_run_id；ACK承诺的全framehash包含Task+claim。
 // 仅此固定外部形状可具有空Task列；已有明确关联必须仍等于本scope Task。
 if(binding.task_id!=null&&binding.task_id!==s.task_id)fail();
 if(binding.run_id!==e.run_id||binding.actor!== 'runtime:phone-adb-controller'||binding.external_origin!=='zenithjoy:mmv')fail();
 const expected=frozen.deployment.dependencies?.preflight_pg;
 if(!expected||input.source.commit!==expected.source_commit)fail();
 return loadCodePg({runtimeRoot,frozen});
}
