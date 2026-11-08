import {readFileSync,writeFileSync,chmodSync,mkdirSync,realpathSync,lstatSync,constants,openSync,closeSync,fsyncSync} from 'node:fs';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
const fail=s=>{throw Error('PUBLIC_DOMAIN_'+s);};
const logicalHost=machine=>machine==='us-mac-m4'?'mmv':machine;
const inputEnv={profile:'P',serial:'SERIAL',line:'LEADGEN_LINE',run_tag:'WFR_TAG',limit:'LEADGEN_LIMIT',source_run:'LEADGEN_SOURCE_RUN',comment_limit:'LEADGEN_COMMENT_LIMIT',sort:'LEADGEN_SORT',time_layer:'LEADGEN_TIME_LAYER',location:'LEADGEN_LOCATION',max_screens:'LEADGEN_MAX_SCREENS',max_attempts:'LEADGEN_DISCOVERY_MAX_ATTEMPTS',collection_budget_s:'QUEUED_VIDEO_COLLECTION_SECONDS'};
const allowedEnv=new Set([...Object.values(inputEnv),'LEADGEN_MMV_DEVICE_RUNTIME','DOUYIN_ADB_PORT','ADB_SERVER_SOCKET','DOUYIN_PHONE_REGISTRY','LEADGEN_DISCOVERY_MAX_SECONDS','LEADGEN_SOURCE_KIND','QUEUED_VIDEO_RECORD_SECONDS']);
function privateWrite(file,bytes){const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
export function preparePublicDomainSnapshot({identity,profile,runDirectory,deadline_ms,cleanup_deadline_ms}){
 const cfg=profile.domain_adapter.config,template=structuredClone(cfg.snapshot);
 if(!template?.deployment?.source_commit||!template.release?.id||!template.workflow_version?.id||!Array.isArray(template.activities)||!cfg.step_spec)fail('SNAPSHOT_REQUIRED');
 if(!cfg.company||!['company_id','tenant_id'].every(k=>/^[a-f0-9-]{36}$/.test(cfg.company[k]||''))||!Number.isSafeInteger(cfg.company.version)||cfg.company.version<1||typeof cfg.company.policy_id!=='string'||!cfg.company.policy_id)fail('COMPANY');
 if(!isAbsolute(profile.cwd||'')||hash(profile)!==identity.profile_sha256)fail('PROFILE_DIGEST');
 const root=realpathSync(profile.cwd),dir=resolve(runDirectory);if(!isAbsolute(runDirectory)||dir!==runDirectory)fail('DIRECTORY');
 const input=identity.input||{},env={...process.env};
 for(const k of Object.keys(env))if(k.startsWith('LEADGEN_'))delete env[k];
 for(const k of ['NODE_PATH','NODE_OPTIONS','NODE_PG_FORCE_NATIVE','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','PYTHONINSPECT','LEADGEN_EXECUTION_TRANSPORT','LEADGEN_MAX_TURNS','LEADGEN_COMMENT_LIMIT','LEADGEN_SOURCE_RUN','LEADGEN_SOURCES_FILE','LEADGEN_DISCOVERY_MAX_ATTEMPTS','LEADGEN_DISCOVERY_MAX_CANDIDATES','BRAIN_TASK_ID','WFR_BRAIN_TASK_ID','WF_STOP_FILE','WF_RELEASE_ID','WF_DEPLOYMENT_MANIFEST','WF_BRAIN_PROJECT_ID'])delete env[k];
 for(const [k,v] of Object.entries(cfg.env||{})){if(!allowedEnv.has(k)||typeof v!=='string'||/[\r\n\0]/.test(v))fail('ENVIRONMENT');env[k]=v;}
 for(const [k,n] of Object.entries(inputEnv))if(input[k]!==undefined&&input[k]!==null){if(!['string','number'].includes(typeof input[k])||/[\r\n\0]/.test(String(input[k])))fail('INPUT');env[n]=String(input[k]);}
 if(cfg.workflow_key==='douyin_video_discovery'){if(env.LEADGEN_SOURCE_KIND&&env.LEADGEN_SOURCE_KIND!=='keyword')fail('SOURCE_KIND');env.LEADGEN_SOURCE_KIND='keyword';}
 if(input.task_id!==undefined&&input.task_id!==identity.task_id)fail('TASK_IDENTITY');
 if(template.workflow_version.payload?.key!==cfg.workflow_key||identity.run_binding.workflow_id!==template.workflow_version.payload?.workflow_id||identity.run_binding.workflow_definition_version_id!==template.workflow_version.id)fail('WORKFLOW_IDENTITY');
 for(const a of template.activities){const b=identity.run_binding.activities[a.reference?.slot_key],m=profile.metadata?.[a.reference?.slot_key];if(!b||b.reference_id!==a.reference.reference_id||b.activity_id!==a.reference.activity_id||b.activity_definition_version_id!==a.version?.id||m?.activity_id!==b.activity_id)fail('ACTIVITY_IDENTITY');}
 if(Object.keys(identity.run_binding.activities).length!==template.activities.length)fail('ACTIVITY_IDENTITY');
 if(!/^[A-Za-z0-9_-]{1,120}$/.test(env.WFR_TAG||'')||!env.P||!env.SERIAL||!env.LEADGEN_LINE||!/^[0-9]+$/.test(env.LEADGEN_LIMIT||''))fail('INPUT');
 // The formal profile's domain configuration is the resource authority, never a request-selected endpoint/account.
 if(cfg.workflow_key!=='douyin_video_discovery'&&(!/^[A-Za-z0-9_-]{1,120}$/.test(env.LEADGEN_SOURCE_RUN||'')||env.LEADGEN_SOURCE_RUN===env.WFR_TAG))fail('SOURCE_RUN');
 if(cfg.workflow_key!=='douyin_video_discovery'&&(!input.upstream||!['run_id','task_id'].every(k=>/^[a-f0-9-]{36}$/.test(input.upstream[k]||''))||typeof input.upstream.run_directory!=='string'||!/^[a-f0-9]{64}$/.test(input.upstream.profile_sha256||'')))fail('UPSTREAM');
 const fixed=cfg.resources;
 if(!fixed||fixed.machine!==identity.machine_id||fixed.profile!==env.P||fixed.serial!==env.SERIAL||fixed.line!==env.LEADGEN_LINE||!fixed.account)fail('RESOURCE_IDENTITY');
 if(template.deployment.target!==logicalHost(fixed.machine)||template.release.target!==logicalHost(fixed.machine))fail('RESOURCE_IDENTITY');
 if(cfg.workflow_key!=='douyin_comment_scoring'){
  const scope=template[cfg.workflow_key==='douyin_video_discovery'?'discovery_phone_scope':'collection_phone_scope'];
  if(!scope||scope.profile!==fixed.profile||scope.serial!==fixed.serial||scope.expected_account!==fixed.account||scope.target!==logicalHost(fixed.machine)||scope.policy?.host_id!==logicalHost(fixed.machine)||scope.policy?.endpoint!=='tcp:127.0.0.1:5041')fail('RESOURCE_SCOPE');
 }
 if(cfg.workflow_key==='douyin_comment_scoring'?(env.P!=='mmv-scoring'||env.SERIAL!=='none'):!(env.LEADGEN_MMV_DEVICE_RUNTIME==='1'&&env.DOUYIN_ADB_PORT==='5041'&&env.ADB_SERVER_SOCKET==='tcp:127.0.0.1:5041'))fail('RESOURCE_ROUTE');
 const planned=profile.contract?.activities||[];
 if(planned.length!==template.activities.length||planned.some(a=>!identity.run_binding.activities[a.key]||profile.metadata?.[a.key]?.executor_kind!=='code'))fail('CODE_ACTIVITIES_REQUIRED');
 const runtime=join(dir,'runtime');mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(runtime,{mode:0o700});
 const files={};
 for(const [name,expected]of Object.entries(profile.files||{})){
  if(!name||isAbsolute(name)||name.split('/').some(v=>v==='..'||v==='')||!/^[a-f0-9]{64}$/.test(expected))fail('FILE_PATH');
  const source=join(root,name),s=lstatSync(source);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||realpathSync(source)!==source)fail('FILE_SOURCE');
  const bytes=readFileSync(source);if(hash(bytes)!==expected)fail('FILE_DIGEST');const dest=join(runtime,name);mkdirSync(dirname(dest),{recursive:true,mode:0o700});privateWrite(dest,bytes);if(s.mode&0o111)chmodSync(dest,0o700);files['runtime/'+name]=expected;
 }
 if(!profile.files[cfg.step_spec])fail('STEP_SPEC');const steps=readFileSync(join(runtime,cfg.step_spec));privateWrite(join(dir,'step-dod.json'),steps);files['step-dod.json']=hash(steps);
 Object.assign(env,{HOME:process.env.HOME,WF_HOME:runtime,WF_DEPLOYMENT_ROOT:runtime,WFR_RUN_DIR:dir,WFR_HOSTKEY:'mmv',WFR_RUN_ID:identity.run_id,WFR_ATTEMPT:'a1',WF_BRAIN_TASK_ID:identity.task_id,WF_BRAIN_WORKFLOW:cfg.workflow_key,LEADGEN_EXECUTION_MODE:'code',LEADGEN_LOCAL_RPC:'1',DOUYIN_PHONE_ADB:join(runtime,'douyin-phone-adb'),WF_RUN_START_TS:String(Math.floor((deadline_ms-profile.domain_adapter.budget.max_duration_s*1000)/1000)),WF_RUN_MAX_SECONDS:String(Math.ceil((cleanup_deadline_ms-Math.floor((deadline_ms-profile.domain_adapter.budget.max_duration_s*1000)/1000)*1000)/1000))});
 if(Array.isArray(input.sources)){
  if(!input.sources.length||input.sources.some(s=>typeof s!=='string'||!s.trim()||/[\r\n\0]/.test(s)))fail('SOURCES');const bytes=Buffer.from(input.sources.join('\n')+'\n');privateWrite(join(dir,'sources.txt'),bytes);files['sources.txt']=hash(bytes);env.LEADGEN_SOURCES_FILE=join(dir,'sources.txt');
 }
 delete template.snapshot_sha256;delete template.agent_input;delete template.execution_transport;delete template.native_task_lease;
 const binding=identity.run_binding;
 Object.assign(template,{execution_mode:'code',files,public_domain:{protocol:'workflow-domain/v1',run_id:identity.run_id,task_id:identity.task_id,machine_id:identity.machine_id,profile_sha256:identity.profile_sha256,run_binding:binding,deadline_ms,cleanup_deadline_ms,company:structuredClone(cfg.company),...(input.upstream?{upstream:structuredClone(input.upstream)}:{})},run_identity:{capability:cfg.workflow_key,tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,run_id:identity.run_id}});
 for(const key of ['discovery_phone_scope','collection_phone_scope'])if(template[key])Object.assign(template[key],{task_id:identity.task_id,run_id:identity.run_id,attempt:'a1',source_commit:template.deployment.source_commit});
 privateWrite(join(dir,'activity.log'),'');privateWrite(join(dir,'comments.tsv'),'');mkdirSync(join(dir,'native-operations'),{mode:0o700});
 return {env,runtime,dir,snapshot:template,privateWrite};
}
