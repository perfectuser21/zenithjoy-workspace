import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assembleActivityPgHost} from '../activity-host-pg.mjs';
import {resolveProducerIdentity} from '../activity-upstream-source.mjs';
import {assembleActivity104Host} from '../activity-host-104.mjs';
import {validateAuthorization} from '../activity-104-context.mjs';
import {hash,need,canonical} from './context.mjs';
import {relative} from './freeze.mjs';
import {businessModuleSources} from './business-module-sources.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const {validateOutreachScope}=createRequire(import.meta.url)('../leadgen-outreach-scope.js');
export const EXACT_ENV_KEYS=['LEADGEN_OUTREACH_MODE','LEADGEN_OUTREACH_SCOPE_FILE','WF_BRAIN_WORKFLOW','WFR_TAG','P','SERIAL','LEADGEN_LINE'];
const ASR_TARBALLS=new Set(['cos-nodejs-sdk-v5-3.0.0.tgz','cos-fast-xml-parser-1.0.0.tgz','strnum-1.1.2.tgz'].map(n=>'_dependencies/asr-cos/tarballs/'+n));
export function sourceArchive(file){
 const doc=JSON.parse(fs.readFileSync(file));need(doc.schema==='leadgen-host-source/v1'&&doc.files,'SOURCE_ARCHIVE');
 return Object.fromEntries(Object.entries(doc.files).map(([name,item])=>{
  relative(name);need(typeof item.source==='string','SOURCE_BYTES');let bytes=item.source;
  if(item.encoding!==undefined){
   need(item.encoding==='base64'&&ASR_TARBALLS.has(name)&&item.source.length>0&&item.source.length<=6*1024*1024,'SOURCE_ENCODING');
   bytes=Buffer.from(item.source,'base64');need(bytes.toString('base64')===item.source,'SOURCE_ENCODING');
  }
  need(hash(bytes)===item.sha256,'SOURCE_DIGEST');return [name,bytes];
 }));
}
function writeSources(root,files){
 fs.mkdirSync(root,{mode:0o700});for(const [name,bytes]of Object.entries(files)){
  const file=path.join(root,relative(name));fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 }
}
function directoryFiles(root,prefix=''){
 const result={};for(const item of fs.readdirSync(path.join(root,prefix),{withFileTypes:true})){
  const name=prefix+item.name;need(!item.isSymbolicLink(),'SOURCE_SYMLINK');
  if(item.isDirectory())Object.assign(result,directoryFiles(root,name+'/'));else result[name]=fs.readFileSync(path.join(root,name),'utf8');
 }return result;
}
function replaceRequired(text,from,to){need(text.includes(from),'SOURCE_LAYOUT');return text.replaceAll(from,to);}
function localCredentials(files,c){
 let t=files['tools.py'];
 t=replaceRequired(t,"read(H/'.credentials/zenithjoy-db.json')","read(c['credentials']['database'])");
 t=replaceRequired(t,"str(H/'.credentials/leadgen-feishu-yuesheng-live.json')","c['credentials']['feishu']");
 t=replaceRequired(t," for f in ['cecelia-internal.env','openrouter.env','dashscope.env']:e.update(envfile(H/'.credentials'/f))"," for f in [c['credentials']['brain']]+c['credentials']['provider_env_files']:e.update(envfile(f))");
 t=replaceRequired(t," e=envfile(H/'.credentials/cecelia-internal.env');token="," c=read(P/'context.json');e=envfile(c['credentials']['brain']);token=");
 if(t.includes("read(H/'.credentials/cos-delivery-source-20261117.json')"))t=t.replaceAll("read(H/'.credentials/cos-delivery-source-20261117.json')","read(c['credentials']['cos'])");
 files['tools.py']=t;
 const manifest=JSON.parse(files['activity-host-tools.json']);for(const name of Object.keys(manifest.sha256))manifest.sha256[name]=hash(files[name]);files['activity-host-tools.json']=JSON.stringify(manifest,null,2)+'\n';
}
export function prepareProof(context,{initialize=false}={}){
 const file=context.verification.proof_manifest_path,identity={...context.tasks[context.assigned_workflow],workflow:context.assigned_workflow};
 if(fs.existsSync(file)){
  const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&!(s.mode&0o022),'PROOF_SOURCE');
  const p=JSON.parse(fs.readFileSync(file));need(p.schema==='activity-evidence/v1'&&canonical(p.identity)===canonical(identity),'PROOF_IDENTITY');
 }else{
  need(initialize,'PROOF_MISSING');fs.writeFileSync(file,JSON.stringify({schema:'activity-evidence/v1',identity,fields:{}},null,2)+'\n',{flag:'wx',mode:0o600});
 }
}
/** Only assembles frozen source. No phone, database, model or message operation occurs here. */
export async function assembleSources({context:c,profile,contract,hostRoot,identity,bindingKey,initializeProof=true}){
 const workflow=c.assigned_workflow,files=sourceArchive(path.join(HERE,'sources',workflow+'.json'));
 for(const [name,expected]of Object.entries(profile.files).filter(([name])=>name.startsWith('services/phone-adb-controller/skills/'))){
  const bytes=fs.readFileSync(path.join(profile.cwd,name),'utf8');need(hash(bytes)===expected,'SKILL_SOURCE');files[name]=bytes;
 }
 if(workflow==='102'){
  const name='native-identity.py',bytes=fs.readFileSync(path.join(HERE,'../activity-native-identity.py'),'utf8');files[name]=bytes;
  c.verification.native_identity_reader={command:[c.python,path.join(hostRoot,name)],sha256:{[c.python]:hash(fs.readFileSync(c.python)),[path.join(hostRoot,name)]:hash(bytes)}};
 }
 const temporary=fs.mkdtempSync(path.join(path.dirname(hostRoot),'.leadgen-assembly-'));
 try{
  const base=path.join(temporary,'base');writeSources(base,files);prepareProof(c,{initialize:initializeProof});
  if(workflow==='104'){
   const target=path.join(temporary,'outreach');await assembleActivity104Host({baseRoot:base,localBaseRoot:base,targetRoot:target,context:c,
    pgHelper:{path:path.join(HERE,'../activity-host-pg.mjs'),sha256:hash(fs.readFileSync(path.join(HERE,'../activity-host-pg.mjs')))}});
   Object.assign(files,directoryFiles(target));
   files['TOOLS.txt']+='\n本正式profile由宿主固定为exact范围：outreach-scope.json为原runtime-definition读取的7字段私有文件；LEADGEN_OUTREACH_MODE=exact和LEADGEN_OUTREACH_SCOPE_FILE由独立worker及每次invoke进程绑定，唯一原订单及来源与context.verification[104]一致，批准正文和额度由context.authorization_asset校验。禁止Agent改环境、切company_queue或另选订单；不因Skill的一般示例扩充宿主工具权限。prepared或未知结果仍仅原动作读回，不另用text-input/tap-evidence补发。\n';
  }else{
   const target=path.join(temporary,'pg');need(c.verification.pg_deployment,'PG_DEPLOYMENT_REQUIRED');
   const pg=await assembleActivityPgHost({baseRoot:base,targetRoot:target,runtimeRoot:c.runtime_root,sourceCommit:c.source_commit,
    expectedSource:c.verification.runtime_sha256,expectedDeployment:c.verification.pg_deployment,workflow,checkerMode:'agent'});
   need(canonical(pg.pg)===canonical(c.verification.pg),'PG_CONTEXT_CHANGED');Object.assign(files,directoryFiles(target));
   const input=path.join(temporary,'context.json');fs.writeFileSync(input,JSON.stringify(c),{mode:0o600});
   const typed=path.join(temporary,'typed');const argv=[path.join(HERE,'../activity-host-tools.py'),base,typed,...(workflow==='101'?[]:[input])];
   const result=spawnSync(c.python,argv,{encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'}});
   need(result.status===0,'TYPED_ASSEMBLY');Object.assign(files,directoryFiles(typed));localCredentials(files,c);
   if(workflow==='102')for(const [name,bytes]of Object.entries(sourceArchive(path.join(HERE,'sources/asr.json'))))files['asr-runtime/'+name]=bytes;
  }
  if(workflow!=='104'){
   Object.assign(files,businessModuleSources(c));
   files['business.mjs']=replaceRequired(files['business.mjs'],"createRequire(path.join(c.runtime_root,'package.json'))","createRequire(path.join(root,'business-runtime/package.json'))");
  }
  if(workflow==='102'){
   const file='collection-evidence/runtime-deps.mjs',legacy="path.join(profileRoot,'skills/douyin-leadgen-commander/scripts/native_artifacts.py')";
   need(files[file].split(legacy).length===2,'NATIVE_IDENTITY_LAYOUT');
   files[file]=files[file].replace(legacy,"path.join(profileRoot,'native-identity.py')").replace('c.verification.artifact_checker','c.verification.native_identity_reader');
   const producer=c.input_provenance?.producer;resolveProducerIdentity(c,'dedup',{run:producer?.run_tag,run_id:producer?.run_id});
  }
  delete c.checker_media_tool;
  const probe=['/opt/homebrew/bin/ffprobe','/usr/bin/ffprobe'].find(p=>fs.existsSync(p));
  if(probe){const executable=fs.realpathSync(probe);c.checker_media_tool={path:executable,sha256:hash(fs.readFileSync(executable))};}
  files['context.json']=JSON.stringify(c,null,2)+'\n';
  for(const name of ['checker-facts.mjs','checker-facts-runtime.mjs','checker-file-facts.mjs'])files[name]=fs.readFileSync(path.join(HERE,name),'utf8');
  const authority="const contextFile=new URL('./context.json',import.meta.url).pathname,contextSha256="+JSON.stringify(hash(files['context.json']))+";\n";
  const ledgerModule=pathToFileURL(path.join(profile.runtimeRoot,'src/orchestrator/commander-usage-ledger.js')).href;
  // The kernel ledger is outside the mutable evidence roots offered to the Checker.
  const boundLedger=path.join(profile.cwd,relative(profile.skill_runtime.control_dir),identity.run_id,'ledger');
  files['checker-facts-entry.mjs']="import {serveFacts} from './checker-facts.mjs';\n"+authority+
   `const readLedger=async identity=>{const {readRunLedger}=await import(${JSON.stringify(ledgerModule)});return readRunLedger({directory:${JSON.stringify(boundLedger)},identity});};\n`+
   "await serveFacts({contextFile,contextSha256,readLedger});\n";
  for(const [name,operation,args]of [['native-inspect.mjs','native.read',{}],['collection-readback.mjs','pg.rows',{relation:'comments'}]]){
   files[name]="import fs from 'node:fs';import {readFacts} from './checker-facts.mjs';import {factDependencies,readFrozenContext} from './checker-facts-runtime.mjs';\n"+authority+
    "const c=readFrozenContext(contextFile,contextSha256),input=JSON.parse(fs.readFileSync(0,'utf8')),t=c.tasks[c.assigned_workflow];const r=await readFacts({identity:t,nonce:'executor-fact-read',context:input,operation:"+JSON.stringify(operation)+",args:"+JSON.stringify(args)+"},{...factDependencies,readAuthority:async()=>c});console.log(JSON.stringify(r));if(r.status!=='available')process.exitCode=2;\n";
  }
  for(const directory of ['native','receipts','qualification-receipts','collection-evidence-receipts','outreach-receipts'])files[directory+'/.keep']='';
  files['checker-input/contract.json']=JSON.stringify(contract,null,2)+'\n';
  const evidence={binding:identity,binding_key:bindingKey,tasks:c.tasks,line:c.line,company_id:c.company_id,tenant_id:c.tenant_id,
   profile:c.profile,host:c.host,serial:c.serial,adb_serial:c.adb_serial,expected_sender_id:c.sender_id??c.account,
   business_deadline_ms:c.business_deadline_ms,cleanup_deadline_ms:c.cleanup_deadline_ms};
  if(workflow==='104'){
   const approved=validateAuthorization(c);
   const fields=['root_task_id','decision_id','company_id','tenant_id','sender_id','record_id','comment_id','lead_id','message_sha256','max_new_recipients','max_send_attempts','test_execution_daily_cap'];
   evidence.approved_send={asset_sha256:c.authorization_asset.sha256,...Object.fromEntries(fields.map(key=>[key,approved[key]]))};
  }
  files['checker-input/identity.json']=JSON.stringify(evidence,null,2)+'\n';
  const kernel=path.join(profile.runtimeRoot,'scripts/commander-workflow/skill-worker.mjs');
  let exactEnv={};
  if(workflow==='104'){
   const s=c.verification['104'],scope={record_id:s.record_id,comment_id:s.comment_id,company_id:c.company_id,source_run:s.source_102_run,mark_run:s.source_103_run,target_douyin_id:s.target_douyin_id,line_key:c.line};
   validateOutreachScope({schema_version:1,...scope,run_tag:c.tasks['104'].run_tag,profile:c.profile,serial:c.serial});
   const codex=profile.skill_runtime.codex;need(path.isAbsolute(codex?.command??'')&&hash(fs.readFileSync(codex.command))===codex.command_sha256,'CODEX_SOURCE');
   files['outreach-scope.json']=JSON.stringify(scope,null,2)+'\n';
   exactEnv={LEADGEN_OUTREACH_MODE:'exact',LEADGEN_OUTREACH_SCOPE_FILE:path.join(hostRoot,'outreach-scope.json'),WF_BRAIN_WORKFLOW:'douyin_lead_outreach',WFR_TAG:c.tasks['104'].run_tag,P:c.profile,SERIAL:c.serial,LEADGEN_LINE:c.line};
  }
  if(workflow==='104'){
   const codex=profile.skill_runtime.codex,quote=x=>"'"+x.replaceAll("'","'\\''")+"'";
   const verify="import fs from 'node:fs';import {createHash} from 'node:crypto';if(createHash('sha256').update(fs.readFileSync("+JSON.stringify(codex.command)+")).digest('hex')!=="+JSON.stringify(codex.command_sha256)+")throw Error('LEADGEN_CODEX_SOURCE');";
   files['codex-exact']='#!/bin/sh'+'\nset -e\n'+quote(process.execPath)+' --input-type=module -e '+quote(verify)+'\n'
    +Object.entries(exactEnv).map(([key,value])=>'export '+key+'='+quote(value)).join('\n')+'\nexec '+quote(codex.command)+' "$@"\n';
  }
  const worker='Object.assign(process.env,'+JSON.stringify(exactEnv)+');\nawait import('+JSON.stringify(pathToFileURL(kernel).href)+');\n';
  files['worker.mjs']=worker;
  for(const entry of profile.leadgen.worker_entries??[])files[relative(entry)]=worker;
  files['invoke.mjs']="import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';const root=path.dirname(fileURLToPath(import.meta.url)),c=JSON.parse(fs.readFileSync(path.join(root,'context.json')));const r=spawnSync(c.python,[path.join(root,'tools.py'),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,..."+JSON.stringify(exactEnv)+"}});process.exit(r.status??1);\n";
  return files;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
