// 通用维护入口：只迁移已证非干扰的预检隔离，不恢复原运行、不动中央锁。
import {spawn,execFileSync} from 'node:child_process';import {userInfo} from 'node:os';import {join,dirname,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {readFileSync,lstatSync,readdirSync,realpathSync} from 'node:fs';import {createInterface} from 'node:readline';
import {canonical,sha,need,readSafe,json,inventory,verifyPreflightEvidence} from './native-preflight-quarantine-evidence.mjs';
export {verifyPreflightEvidence} from './native-preflight-quarantine-evidence.mjs';
const here=dirname(fileURLToPath(import.meta.url)),protocol='native-preflight-quarantine-review/v1',uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const launcherSources=new Set(['ad90c2348bbf60b38d39c8299a572029a16cfe2bba822409577b9c4796ed7084']);
const exact=(object,keys)=>need(object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join(',')===[...keys].sort().join(','),'SCHEMA');
export function validateReviewTask(task,taskId){
 need(task?.id===taskId&&uuid.test(taskId)&&task.status==='in_progress'&&typeof task.claimed_by==='string'&&task.claimed_by.trim()&&typeof task.claimed_at==='string'&&Number.isFinite(Date.parse(task.claimed_at)),'ACTIVE_REVIEW_TASK');
 const value=task.payload?.native_preflight_quarantine_review;exact(value,['protocol','original','run_dir','archive_path','archive_sha256','launcher']);need(value.protocol===protocol,'PROTOCOL');
 const original=value.original;exact(original,['task_id','run_id','binding_id','source_commit','profile','serial','owner','epoch']);need(['task_id','binding_id','epoch'].every(key=>uuid.test(original[key]))&&/^[a-f0-9]{40}$/.test(original.source_commit)&&/^[-A-Za-z0-9_]{1,100}$/.test(original.owner)&&/^[-A-Za-z0-9_.]{1,80}$/.test(original.profile)&&/^[A-Za-z0-9_.:-]{1,100}$/.test(original.serial)&&!['.','..','none'].includes(original.serial)&&new RegExp('^douyin_video_discovery-'+original.owner+'__a[1-9][0-9]*$').test(original.run_id),'ORIGINAL_IDENTITY');
 need(original.task_id!==taskId&&/^[a-f0-9]{64}$/.test(value.archive_sha256),'ARCHIVE_BINDING');
 exact(value.launcher,['source_path','source_sha256','started_path','started_sha256','exit_path','exit_sha256']);for(const [key,x]of Object.entries(value.launcher))need(key.endsWith('_path')?typeof x==='string'&&resolve(x)===x:/^[a-f0-9]{64}$/.test(x),'LAUNCHER_SCHEMA');
 return {contract:structuredClone(value),claim:{claimed_by:task.claimed_by,claimed_at:task.claimed_at}};
}
export async function readBrain(path){
 need(/^\/api\/brain\/(?:tasks\/[a-f0-9-]{36}|runs\/[A-Za-z0-9_.-]+\/definition|device-locks)$/.test(path),'BRAIN_PATH');
 const token=process.env.BRAIN_INTERNAL_TOKEN;need(typeof token==='string'&&token.trim()&&!/[\r\n]/.test(token),'EXPLICIT_CREDENTIAL_REQUIRED');
 const response=await fetch('http://127.0.0.1:5221'+path,{headers:{'X-Internal-Token':token},redirect:'error',signal:AbortSignal.timeout(10000)});need(response.status===200&&response.headers.get('content-type')?.startsWith('application/json'),'BRAIN_READ');const raw=await response.text();need(Buffer.byteLength(raw)<=8*1024*1024,'BRAIN_LIMIT');return JSON.parse(raw);
}
export function sourceAuthority(requireMerged=true){
 const repo=resolve(here,'../..'),git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000,stdio:['ignore','pipe','pipe']}),commit=git('rev-parse','HEAD').trim(),files={};
 if(requireMerged){try{git('merge-base','--is-ancestor',commit,'origin/main');}catch{need(false,'REVIEW_SOURCE_NOT_MAIN');}}
 for(const name of ['native-preflight-quarantine-review.mjs','native-preflight-quarantine-evidence.mjs','native-preflight-quarantine-lock.py','config/collection-phone-hosts.json']){const path='services/phone-adb-controller/'+name,raw=readSafe(join(here,name));if(requireMerged)need(raw.equals(Buffer.from(git('show',commit+':'+path))),'REVIEW_SOURCE_DIRTY');files[path]=sha(raw);}
 return {commit,files,merged_required:requireMerged};
}
function pythonExecutable(options){
 if(options.python)return options.python; // 仅内部离线测试依赖；CLI不接收覆盖参数。
 const rows=json(join(here,'config/collection-phone-hosts.json')).hosts.filter(h=>h.target==='mmv'),pins=rows.map(h=>h.executables?.python);need(pins.length>0&&pins.every(p=>p&&canonical(p)===canonical(pins[0])),'PYTHON_SCOPE');const pin=pins[0];need(sha(readSafe(pin.path))===pin.sha256,'PYTHON_SOURCE');return pin.path;
}
function archiveManifest(path,options){
 return JSON.parse(execFileSync(pythonExecutable(options),['-I',join(here,'native-preflight-quarantine-lock.py'),'archive',path],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:30000,maxBuffer:8*1024*1024}));
}
function launcherEvidence(value,original,frozen,home){
 for(const [file,hash]of [['source_path','source_sha256'],['started_path','started_sha256'],['exit_path','exit_sha256']])need(sha(readSafe(value[file]))===value[hash],'LAUNCHER_BYTES');
 need(launcherSources.has(value.source_sha256),'UNREVIEWED_LAUNCHER');const started=json(value.started_path),exit=json(value.exit_path),entry=join(home,'.local/share/zenithjoy/phone-candidates',original.source_commit,'run.sh');
 need(started.task_id===original.task_id&&started.run_tag===original.owner&&canonical(started.argv)===canonical([entry,'douyin_video_discovery',original.profile,original.serial,frozen.agent_input.line,original.owner])&&Number.isInteger(started.supervisor_pid)&&Number.isInteger(started.runner_pid)&&exit.task_id===original.task_id&&exit.run_tag===original.owner&&Number.isInteger(exit.exit_code)&&exit.exit_code>=0&&exit.exit_code<=255&&exit.signal===null&&Number.isFinite(Date.parse(exit.at))&&Date.parse(exit.at)>=Date.parse(started.at),'ORIGINAL_PARENT_CLOSE');
 return {files:{source:value.source_sha256,started:value.started_sha256,exit:value.exit_sha256},originals_base64:Object.fromEntries(['source_path','started_path','exit_path'].map(k=>[value[k],readSafe(value[k]).toString('base64')])),runner_close_returned:true};
}
function lockSnapshot(root,serial,original,retired){
 const path=join(root,serial+'.lock'),exists=p=>{try{return !!lstatSync(p);}catch(e){if(e.code==='ENOENT')return false;throw e;}},active=exists(path),saved=retired&&exists(retired);need(active!==!!saved,'LOCK_LOCATION');const chosen=active?path:retired,s=lstatSync(chosen);
 need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(chosen)===chosen&&s.uid===process.getuid()&&(s.mode&0o777)===0o700,'LOCK_DIRECTORY');const names=['owner','acquired_at','standalone_review_required','preflight_epoch','preflight_proof_required','preflight_quarantined'];need(readdirSync(chosen).sort().join(',')===names.sort().join(','),'LOCK_INVENTORY');const fields=Object.fromEntries(names.map(name=>[name,readSafe(join(chosen,name)).toString()]));
 need(fields.owner===original.owner+'\n'&&fields.standalone_review_required===original.owner+'\n'&&['preflight_epoch','preflight_proof_required','preflight_quarantined'].every(k=>fields[k]===original.epoch+'\n')&&/^[0-9]+\n$/.test(fields.acquired_at),'LOCK_OWNER_EPOCH');return {dev:s.dev,ino:s.ino,fields};
}
export async function inspectReview(options){
 const {taskId}=options,home=options.home??userInfo().homedir,get=options.readBrain??readBrain,authority=options.sourceAuthority??sourceAuthority;
 need(typeof home==='string'&&resolve(home)===home&&realpathSync(home)===home,'HOME');const taskValue=await get('/api/brain/tasks/'+taskId),task=taskValue.task??taskValue,{contract:c,claim}=validateReviewTask(task,taskId),o=c.original;
 need(c.run_dir===join(home,'.local/share/zenithjoy/phone-candidate-runs',o.source_commit,'ledger','douyin_video_discovery-'+o.owner),'RUN_PATH');
 const oldValue=await get('/api/brain/tasks/'+o.task_id),old=oldValue.task??oldValue,p=old.payload;need(old.id===o.task_id&&['failed','blocked'].includes(old.status)&&p?.workflow_key==='douyin_video_discovery'&&p.run_tag===o.owner&&p.source_commit===o.source_commit&&p.profile===o.profile&&p.device_serial===o.serial,'ORIGINAL_TASK');
 const files=inventory(c.run_dir),archive=archiveManifest(c.archive_path,options);need(archive.sha256===c.archive_sha256&&canonical(archive.files)===canonical(files),'ARCHIVE_ORIGINALS');
 const evidence=verifyPreflightEvidence({runDir:c.run_dir,original:o,home}),frozen=json(join(c.run_dir,'run-definition.json'));need(p.company_line===frozen.agent_input.line,'ORIGINAL_COMPANY');
 const binding=(await get('/api/brain/runs/'+o.run_id+'/definition')).binding,value=k=>binding?.[k]??binding?.payload?.[k];need(binding?.id===o.binding_id&&binding.run_id===o.run_id&&value('actor')==='runtime:phone-adb-controller:agent-v1'&&value('external_origin')==='zenithjoy:mmv'&&value('runtime_snapshot_sha256')===frozen.snapshot_sha256&&value('workflow_definition_version_id')===frozen.workflow_version.id&&value('release_id')===frozen.release.id&&value('observation_id')===frozen.deployment.observation_id&&(value('task_id')==null||value('task_id')===o.task_id),'ORIGINAL_BINDING');
 const parent=launcherEvidence(c.launcher,o,frozen,home),locks=await get('/api/brain/device-locks'),found=locks.locks?.filter(row=>row.device_name===o.serial);need(locks.success===true&&found?.length===1&&found[0].locked_by===null,'CENTRAL_NOT_FREE');
 const root=join(home,'.local/share/zenithjoy/phone-locks'),marker=readSafe(join(root,'.migration-complete.json')),migration=JSON.parse(marker),legacy=join(migration.legacy_root,o.serial+'.lock');try{lstatSync(legacy);need(false,'LEGACY_OWNER');}catch(e){if(e.code!=='ENOENT')throw e;}
 const retired=join(root,'.native-preflight-review-'+taskId+'.superseded'),lock=lockSnapshot(root,o.serial,o,retired),reviewSource=authority(options.requireMerged??false);
 return {protocol,review_task_id:taskId,claim,contract:c,evidence,parent,marker_sha256:sha(marker),lock,central_readback:{device_name:o.serial,locked_by:null},review_source:reviewSource,original_execution_stopped:false,not_recovery_authority:true};
}
async function transaction(op,options){
 const initial=await inspectReview({...options,requireMerged:true}),home=options.home??userInfo().homedir,root=join(home,'.local/share/zenithjoy/phone-locks'),helper=join(here,'native-preflight-quarantine-lock.py'),expectedHelper=sha(readSafe(helper));let child;
 const fresh=async()=>{need(sha(readSafe(helper))===expectedHelper,'HELPER_SOURCE_DRIFT');const actual=await inspectReview({...options,requireMerged:true});need(canonical(actual)===canonical(initial),'AUTHORITY_OR_EVIDENCE_DRIFT');};
 try{return await new Promise((resolveResult,reject)=>{
  let error='',settled=false,returned,failure;child=spawn(pythonExecutable(options),['-I',helper,'serve',root,initial.contract.original.serial,options.taskId],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});const lines=createInterface({input:child.stdout});let work=Promise.resolve();const timer=setTimeout(()=>{child.stdin.destroy();child.kill('SIGKILL');failure=Error('PREFLIGHT_REVIEW_OWNED_HELPER_TIMEOUT');},120000);
  child.stderr.on('data',b=>{if(error.length<1000)error+=b.toString();});child.on('error',reject);child.stdin.on('error',()=>{});
  lines.on('line',line=>{work=work.then(async()=>{const message=JSON.parse(line);if(message.event==='locked'){await fresh();child.stdin.write(JSON.stringify({op,facts:initial})+'\n');}else if(message.event==='checkpoint'){try{await fresh();child.stdin.write('{"authorize":true}\n');}catch(e){child.stdin.write('{"authorize":false}\n');throw e;}}else if(message.event==='returned'){returned=message.value;child.stdin.end();}else need(false,'HELPER_PROTOCOL');}).catch(e=>{failure??=e;child.stdin.end();});});
  child.once('close',(code,signal)=>{clearTimeout(timer);void work.then(()=>{if(settled)return;settled=true;if(failure){reject(failure);return;}if(code===0&&signal===null&&returned)resolveResult(returned);else reject(Error(/^PREFLIGHT_REVIEW_[A-Z_]+\s*$/.test(error)?error.trim():'PREFLIGHT_REVIEW_HELPER_UNKNOWN'));});});
 });}finally{if(child&&!child.stdin.destroyed)child.stdin.end();}
}
export const planReview=options=>transaction('plan',options);
export const applyReview=options=>transaction('apply',options);
export async function main(args=process.argv.slice(2)){
 need(args.length===2&&['inspect','plan','apply'].includes(args[0])&&uuid.test(args[1]),'USAGE_inspect_plan_apply_TASK_ID');const options={taskId:args[1]};const result=await ({inspect:inspectReview,plan:planReview,apply:applyReview}[args[0]])(options);process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(/^PREFLIGHT_REVIEW_[A-Z_a-z]+$/.test(error.message)?error.message+'\n':'PREFLIGHT_REVIEW_FAILED_UNKNOWN\n');process.exitCode=2;});
