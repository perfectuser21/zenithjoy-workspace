// 独立Skill工具宿主；只管理资源和单步工具，不执行业务循环或启动模型。
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,realpathSync,lstatSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
import {createRequire} from 'node:module';
import {userInfo} from 'node:os';
import {readFrozen} from './runtime-definition.mjs';
import {standaloneScope,standaloneTaskProjectionMatches,standaloneExecutionContextMatches} from './standalone-skill-authority.mjs';
import {readBrain} from './device-epoch-fence-review.mjs';
import {canAuthorizeNativeFrame} from './device-epoch-fence-admission.mjs';
import {createCentralDeviceLease} from './central-device-lease.mjs';
import {startCollectionLeafProducer} from './collection-leaf-producer.mjs';
import {execInput,createRpc,safeExecutionDiagnostic} from './leadgen-client.mjs';
import {createStandaloneSkillTools} from './standalone-skill-tools.mjs';
import {serveStandaloneSkillTools,callStandaloneSkillTool} from './standalone-skill-ipc.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const fail=c=>{throw Object.assign(Error('STANDALONE_NATIVE_'+c),{code:'STANDALONE_NATIVE_'+c});};
export function createStandalonePhoneProvider({root,environment,frozen,execute=execInput}){
 const fixed=frozen.agent_input;
 return async function invoke({command,args,profile,owner}){
  if(profile!==fixed.profile||owner!==fixed.run_tag)fail('SCOPE');
  const call=async(op,values=[])=>{
   const result=await execute(join(root,'douyin-phone-adb'),['--profile',profile,'--lock-owner',owner,op,...values.map(String)],{env:environment,timeoutMs:Math.min(360000,(frozen.standalone_skill?.cleanup_deadline_ms??Date.now()+360000)-Date.now())});
   if(result.code!==0)throw Object.assign(Error('STANDALONE_NATIVE_COMMAND'),{code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:result.code,diagnostic:{stdout:safeExecutionDiagnostic(result.stdout,environment).slice(-4000),stderr:safeExecutionDiagnostic(result.stderr,environment).slice(-4000)}});return result;
  };
  if(command==='open-search-card'){
   const [index,evidence]=args,grid=await call('search-video-cards',[evidence+'-grid']);
   if(!/^video_tab=1$/m.test(grid.stdout)||!/^loading=0$/m.test(grid.stdout))fail('CARD');
   const rows=grid.stdout.split('\n').map(v=>v.split('\t')).filter(v=>/^\d+$/.test(v[0])&&/^\d+$/.test(v[1])&&v.length>=4&&v[3].trim());
   const row=rows[index];if(!row)fail('CARD');
   await call('tap-evidence',[row[0],row[1],evidence+'-open','800']);
   const result=await call('current-video-link',[evidence+'-link',frozen.standalone_skill?.scope?.approved_keywords?.[0]??'']);
   if(!/^content_type=video$/m.test(result.stdout)||!/^video_id=\d{16,24}$/m.test(result.stdout))fail('CARD_IDENTITY');
   return {...result,card:{title:row[3],author:row[4]??'',duration:row[2]??''}};
  }
  const result=await call(command,args);
  if(command==='account-current'){
   const accounts=[...result.stdout.matchAll(/^douyin_id=(.+)$/gm)].map(m=>m[1]);
   if(accounts.length!==1||accounts[0]!==frozen.discovery_phone_scope?.expected_account)fail('ACCOUNT');
  }
  return result;
 };
}

// 每台执行机对真实run只允许一份宿主；换目录不能重置未知提交或资源账。
export function claimStandaloneHost({runId,runDirectory,registry=join(userInfo().homedir,'.local/state/zenithjoy/standalone-skill-hosts')}){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)||resolve(registry)!==registry||resolve(runDirectory)!==runDirectory)fail('HOST_SCOPE');
 mkdirSync(registry,{recursive:true,mode:0o700});const stat=lstatSync(registry);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||realpathSync(registry)!==registry)fail('HOST_SCOPE');
 const path=join(registry,runId+'.json');let fd;
 try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(error){if(error.code==='EEXIST')fail('HOST_ALREADY_STARTED');throw error;}
 try{writeFileSync(fd,JSON.stringify({run_id:runId,run_directory:runDirectory,pid:process.pid,started_at:new Date().toISOString()})+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 const parent=openSync(registry,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parent);}finally{closeSync(parent);}return path;
}

export async function verifyStandaloneBootstrap({frozen,scope,read=readBrain}){
 const p=frozen.standalone_skill;
 const [value,definition,reconciliation]=await Promise.all([read('/api/brain/tasks/'+p.task_id),read('/api/brain/runs/'+p.run_id+'/definition'),read('/api/brain/runs/'+p.run_id+'/reconciliation')]);
 const task=value.task??value,b=definition.binding,r=reconciliation.task_run,links=reconciliation.links;
 if(!standaloneTaskProjectionMatches(task,p,scope)||b?.source_kind!=='internal'||b.id!==p.run_binding.run_binding_id||b.run_id!==p.run_id||b.task_run_id!==p.task_run_id
  ||b.release_id!==frozen.release?.id||b.observation_id!==frozen.deployment?.observation_id||r?.id!==p.task_run_id||r.task_id!==p.task_id||r.run_id!==p.run_id||r.status!=='running'||r.ended_at!==null
  ||!standaloneExecutionContextMatches(r?.context,p,scope)||links?.task_id!==p.task_id||links.task_run_id!==p.task_run_id)fail('BOOTSTRAP');
 return true;
}

// 首次资源取得可用；同目录不恢复未知原生动作。恢复需另行核原执行和持久结果。
export async function startStandaloneSkillRuntime({runDirectory,environment=process.env,dependencies={}}){
 const dir=realpathSync(runDirectory),root=join(dir,'runtime'),frozen=readFrozen(dir),scope=standaloneScope(frozen),identity=frozen.standalone_skill;
 if(dir!==resolve(runDirectory)||realpathSync(root)!==root||scope.workflow_key!=='douyin_video_discovery')fail('DIRECTORY');
 const env={...environment,WF_HOME:root,WF_DEPLOYMENT_ROOT:root,WFR_RUN_DIR:dir,WF_BRAIN_TASK_ID:identity.task_id,WFR_RUN_ID:identity.run_id,WFR_TAG:scope.run_tag,WFR_ATTEMPT:'a1',P:scope.profile,SERIAL:scope.serial,LEADGEN_LINE:scope.line,LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:scope.workflow_key,
  WF_RUN_START_TS:String(scope.run_start_ts),WF_RUN_MAX_SECONDS:String(scope.run_max_seconds),DOUYIN_PHONE_ADB:join(root,'douyin-phone-adb'),ZJ_ADB_HOST_CONFIG:frozen.discovery_phone_scope.policy_binding.policy_path,ADB_SERVER_SOCKET:frozen.discovery_phone_scope.policy.endpoint,DOUYIN_ADB_PORT:String(frozen.discovery_phone_scope.policy.port??frozen.discovery_phone_scope.policy.endpoint.split(':').at(-1)),LEADGEN_MMV_DEVICE_RUNTIME:'1',ZJ_EXTERNAL_LEDGER:join(dir,'external-interactions.jsonl')};
 if(env.BRAIN_INTERNAL_TOKEN!==process.env.BRAIN_INTERNAL_TOKEN)fail('CREDENTIAL_CONTEXT');
 await (dependencies.bootstrap??verifyStandaloneBootstrap)({frozen,scope});
 claimStandaloneHost({runId:identity.run_id,runDirectory:dir,registry:dependencies.hostRegistry});
 const lease=(dependencies.leaseFactory??createCentralDeviceLease)({brainUrl:env.BRAIN_URL||'http://127.0.0.1:5221',token:env.BRAIN_INTERNAL_TOKEN,deviceName:scope.serial,taskId:identity.task_id,runId:identity.run_id,runSeconds:scope.run_max_seconds});
 // O_EXCL保留本目录已启动事实：进程崩溃也不靠重建工具实例丢掉未知提交/数量账。
 writeFileSync(join(dir,'standalone-host-started.json'),JSON.stringify({task_id:identity.task_id,run_id:identity.run_id,pid:process.pid,started_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 let leaf,ipc,local=false,unknown=false,closing;
 const execute=dependencies.execute??execInput;
 const controller=(op,args=[])=>execute(join(root,'douyin-phone-adb'),['--profile',scope.profile,op,...args],{env,timeoutMs:360000});
 const guard=async()=>{const actual=readFrozen(dir);if(actual.snapshot_sha256!==frozen.snapshot_sha256)fail('FROZEN_DRIFT');return (dependencies.guard??canAuthorizeNativeFrame)({root,frozen:actual,env});};
 const close=()=>closing??=(async()=>{
  if(ipc)await ipc.close();
  let desktop=null;
  if(local&&!unknown){try{await guard();desktop=await createStandalonePhoneProvider({root,environment:env,frozen,execute})({command:'return-safe-desktop',args:[],profile:scope.profile,owner:scope.run_tag});}catch{unknown=true;}}
  const leaves=leaf?await leaf.seal():null;
  if(leaves&&!leaves.requests_returned&&!leaves.empty_requests_returned)unknown=true;
  if(local&&!unknown){await controller('lock-release-exact',[scope.run_tag]);const status=await controller('lock-status');if(!/^lock=free\b/m.test(status.stdout))fail('RELEASE_READBACK');local=false;}
  let quarantineVerified=false;
  if(local&&unknown){const status=await controller('lock-quarantine',[scope.run_tag]);quarantineVerified=status.stdout.trim()===`lock=quarantined owner=${scope.run_tag} review_required=true`;if(!quarantineVerified)fail('QUARANTINE_READBACK');}
  if(!local)await lease.release();
  const receipt={task_id:identity.task_id,run_id:identity.run_id,execution_mode:'codex-direct',native_return_unknown:unknown,quarantine_verified:quarantineVerified,local_released:!local,central_released:!local,desktop:desktop?.stdout??null,leaves};
  writeFileSync(join(dir,'standalone-cleanup.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});return receipt;
 })();
 try{
  await lease.acquire();
  local=true;try{await controller('lock-acquire',[scope.run_tag]);}catch(error){unknown=true;throw error;}
  await guard();
  try{leaf=await (dependencies.producerFactory??startCollectionLeafProducer)({directory:join(dir,'standalone-leaves'),policy:frozen.discovery_phone_scope.policy,serial:scope.serial,deadlineMs:identity.cleanup_deadline_ms,admissionDeadlineMs:identity.deadline_ms,env,assertAdmission:guard});}catch(error){unknown=true;throw error;}Object.assign(env,leaf.env);
  const rpc=createRpc({frozen,local:true,environment:env,runContext:{run:scope.run_tag,run_id:identity.run_id,profile:scope.profile,line:scope.line}});
  const call=createStandaloneSkillTools({frozen,assertAuthority:guard,phone:createStandalonePhoneProvider({root,environment:env,frozen}),rpc});
  const ipcDirectory=join(dir,'standalone-ipc');mkdirSync(ipcDirectory,{mode:0o700});
  ipc=await serveStandaloneSkillTools({directory:ipcDirectory,call:async(op,input)=>{try{return await call(op,input);}catch(error){appendFileSync(join(dir,'standalone-tool-errors.jsonl'),JSON.stringify({operation:op,code:/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'TOOL_FAILED',at:new Date().toISOString(),...(error?.controller_exit_code!==undefined?{controller_exit_code:error.controller_exit_code,diagnostic:error.diagnostic}:{})})+'\n',{mode:0o600});if(leaf.isReturnUnknown())unknown=true;throw error;}}});
  return {connectionPath:ipc.connectionPath,close};
 }catch(error){await close();throw error;}
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{
  const [operation,path,...rest]=process.argv.slice(2);
  if(operation==='serve'){
   const value=JSON.parse(readFileSync(join(path,'environment.json'),'utf8'));const allowed=new Set(['DOUYIN_PHONE_REGISTRY','DOUYIN_ACCOUNT_REGISTRY','DOUYIN_PHONE_TMP_ROOT','DOUYIN_PHONE_LOCK_ROOT']);if(!value||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([k,v])=>!allowed.has(k)||typeof v!=='string'||/[\r\n\0]/.test(v)))fail('ENVIRONMENT');const runtime=await startStandaloneSkillRuntime({runDirectory:path,environment:{...process.env,...value}});process.stdout.write(JSON.stringify({connection_path:runtime.connectionPath})+'\n');
   let closing=false;const stop=async()=>{if(closing)return;closing=true;try{await runtime.close();process.exitCode=0;}catch{process.exitCode=1;}};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }else if(operation==='call'){
   const input=JSON.parse(readFileSync(0,'utf8')||'{}');const result=await callStandaloneSkillTool(path,rest[0],input);process.stdout.write(JSON.stringify(result)+'\n');
  }else if(operation==='metrics'){
   const f=readFrozen(path),s=standaloneScope(f),q=JSON.parse(readFileSync(0,'utf8'));const {captureObservation}=createRequire(import.meta.url)('./discovery-metrics.js');
   const observation=captureObservation({file:q.file,evidenceRoot:f.discovery_phone_scope.evidence_root,runDir:path,run:s.run_tag,run_id:f.standalone_skill.run_id,profile:s.profile,source_commit:s.source_commit,line_key:s.line,video_id:q.video_id,video_url:'https://www.douyin.com/video/'+q.video_id,evidence_id:q.evidence_id});process.stdout.write(JSON.stringify(observation)+'\n');
  }else fail('USAGE');
 }catch(error){process.stderr.write(JSON.stringify({error:error?.code??'STANDALONE_NATIVE_FAILED'})+'\n');process.exitCode=1;}
}
