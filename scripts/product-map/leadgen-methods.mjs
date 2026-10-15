import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

const repository='perfectuser21/zenithjoy-workspace';
const prefix='services/phone-adb-controller/';
export const LOCK_PATH='product-map/contracts/leadgen-activity-methods.lock.json';
const owners=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const slots=[['douyin_video_processing.preflight','douyin_video_discovery.collect_videos','douyin_video_processing.cleanup'],['preflight','dedup','qualification','collection','cleanup'].map(k=>owners[1]+'.'+k),['scoring','mark_leads'].map(k=>owners[2]+'.'+k),['preflight','send_dm','write_back','cleanup'].map(k=>owners[3]+'.'+k)];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(canonical(x))).digest('hex');
const fail=(code,detail)=>{throw new Error(code+(detail?': '+detail:''));};
function safePath(path){if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').some(s=>!s||s==='.'||s==='..'))fail('METHOD_PATH_INVALID',String(path));return path;}
function version(v){if(typeof v!=='string'||! /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))fail('METHOD_VERSION_INVALID',String(v));const parts=v.split('.').map(Number);if(!parts.every(Number.isSafeInteger))fail('METHOD_VERSION_INVALID',v);return parts;}
function advanced(now,old){const a=version(now),b=version(old);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
function front(text,path){const m=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!m)fail('SKILL_FRONTMATTER_MISSING',path);return parse(m[1]);}
function reader(root){return path=>{safePath(path);let current=root;for(const part of path.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())fail('METHOD_SYMLINK_REJECTED',path);}return readFileSync(current);};}
function json(read,path){return JSON.parse(read(path).toString());}
function optional(read,path){try{return read(path);}catch(e){if(e.code==='ENOENT'||e.status===128)return null;throw e;}}
function linkedFiles(text,path){return [...text.matchAll(/\[[^\]]*\]\(([^\s)#]+)(?:#[^\s)]*)?\)/g)].map(m=>m[1]).filter(p=>! /^[a-z]+:/i.test(p)&&!p.startsWith('#')).map(p=>safePath(posix.normalize(posix.join(posix.dirname(path),p))));}
function skill(read,path,name){
  safePath(path);const bytes=read(path),text=bytes.toString(),f=front(text,path),v=f.metadata?.version??f.version;version(v);
  if(f.name!==name)fail('SKILL_NAME_MISMATCH',path);
  const declared=f.metadata?.support_files??[];if(!Array.isArray(declared)||new Set(declared).size!==declared.length)fail('SKILL_SUPPORT_FILES_INVALID',path);
  // Parent Workflow and full contract links are context, not this method's body.
  // Only declared support and links inside this Skill directory form its closure.
  const inside=p=>p.startsWith(posix.dirname(path)+'/');
  const pending=[...declared.map(safePath),...linkedFiles(text,path).filter(inside)],seen=new Set([path]),support=[];
  while(pending.length){const p=pending.shift();if(seen.has(p))continue;seen.add(p);const b=read(p);support.push({path:p,sha256:digest(b)});if(p.endsWith('.md'))pending.push(...linkedFiles(b.toString(),p).filter(inside));}
  support.sort((a,b)=>a.path.localeCompare(b.path));
  return {record:{name,version:v,path,sha256:digest(bytes),support_files:support,content_digest:digest({sha256:digest(bytes),support_files:support})},front:f,text};
}

/** Offline source declaration only. No Activity executor, phone or fallback call. */
export function collectMethods(root,{read=reader(root)}={}){
  const docs=Object.fromEntries(owners.map(key=>[key,parse(read('product-map/contracts/'+key+'.yaml').toString())]));
  const activities={},workflows={};
  for(let i=0;i<owners.length;i++){
    const owner=owners[i],doc=docs[owner];
    if(doc.contract_key!==owner)fail('ACTIVITY_OWNER_INVALID',owner);
    const actual=doc.activities.map(a=>a.ref||owner+'.'+a.key);
    if(!same(actual,slots[i]))fail('ACTIVITY_SLOT_LAYOUT_MISMATCH',owner);
    for(const a of doc.activities.filter(a=>!a.ref)){
      const ref=owner+'.'+a.key,bindings=a.implementation_bindings,methods=bindings?.filter(b=>b.kind==='skill');
      if(methods?.length!==1)fail('ACTIVITY_METHOD_BINDING_INVALID',ref);
      const b=methods[0],name='douyin-leadgen-activity-'+(101+i)+'-'+a.key.replaceAll('_','-'),path=prefix+'skills/'+name+'/SKILL.md';
      if(b.repo!==repository||b.revision!=='contract'||b.name!==name||b.path!==path)fail('ACTIVITY_METHOD_BINDING_INVALID',ref);
      const s=skill(read,path,name);version(a.version);
      if(s.front.metadata?.activity_ref!==ref||s.front.metadata?.activity_version!==a.version)fail('ACTIVITY_METHOD_CONTRACT_MISMATCH',ref);
      if(b.version!==s.record.version)fail('ACTIVITY_METHOD_VERSION_MISMATCH',ref);
      if(!Array.isArray(s.front.metadata?.support_files)||!s.front.metadata.support_files.includes(prefix+'skills/leadgen-activity-execution.md'))fail('ACTIVITY_SHARED_POLICY_MISSING',ref);
      const code=bindings.filter(b=>b.kind==='code').map(b=>{if(b.repo!==repository||b.revision!=='contract')fail('CODE_BINDING_SOURCE_INVALID',ref);return {...b,sha256:digest(read(safePath(b.path)))};});
      if(!code.length)fail('CODE_BINDING_MISSING',ref);
      const contract={...a};delete contract.implementation_bindings;
      activities[ref]={activity_version:a.version,contract_digest:digest(contract),method_version:s.record.version,skill:s.record,code_bindings:code,code_digest:digest(code)};
    }
  }
  for(let i=0;i<owners.length;i++){
    const owner=owners[i],doc=docs[owner],path=prefix+'skills/douyin-leadgen-'+(101+i)+'/SKILL.md';
    const business=skill(read,path,'douyin-leadgen-'+(101+i)),commanderPath=prefix+'commander/skills/wf-'+owner+'/SKILL.md',commander=skill(read,commanderPath,'wf-'+owner);
    if(doc.commander_skill?.name!==commander.record.name||doc.commander_skill?.version!==commander.record.version)fail('COMMANDER_BINDING_MISMATCH',owner);
    const dependencyPath=prefix+'skills/douyin-leadgen-'+(101+i)+'/references/activity-methods.json',dependency=json(read,dependencyPath);
    const expected=slots[i].map(ref=>{const a=activities[ref];return {activity_ref:ref,skill_name:a.skill.name,skill_version:a.method_version,skill_path:a.skill.path};});
    if(!same(dependency,{workflow_key:owner,activities:expected}))fail('WORKFLOW_METHOD_DEPENDENCY_MISMATCH',owner);
    if(!business.text.includes('references/activity-methods.json')||!commander.text.includes('references/activity-methods.json'))fail('WORKFLOW_METHOD_DEPENDENCY_UNREFERENCED',owner);
    workflows[owner]={workflow_skill:business.record,commander_skill:commander.record,dependency_file:{path:dependencyPath,sha256:digest(read(dependencyPath))},activities:expected};
  }
  return {schema_version:1,activities,workflows};
}

function validateAssessment(a,old,ref){
  const c=a.code_compatibility;
  if(!c||c.kind!=='internal_compatible'||typeof c.reason!=='string'||c.reason.trim().length<12||typeof c.reviewed_by!=='string'||!c.reviewed_by.trim()||!/^[a-f0-9]{64}$/.test(c.previous_code_digest)||old&&c.previous_code_digest!==old.code_digest||c.current_code_digest!==a.code_digest)fail('CODE_COMPATIBILITY_REQUIRED',ref);
  if(!same(Object.keys(c).sort(),['kind','reason','reviewed_by','previous_code_digest','current_code_digest'].sort()))fail('CODE_COMPATIBILITY_INVALID',ref);
}
function evolution(now,before,readBase){
  for(const [ref,a] of Object.entries(now.activities)){
    const old=before?.activities?.[ref];if(!old)continue;
    const contractChanged=a.contract_digest!==old.contract_digest;
    if(contractChanged&&!advanced(a.activity_version,old.activity_version))fail('ACTIVITY_CONTRACT_VERSION_NOT_ADVANCED',ref);
    const methodChanged=a.skill.content_digest!==old.skill.content_digest||a.method_version!==old.method_version||a.activity_version!==old.activity_version||contractChanged;
    if(methodChanged&&!advanced(a.method_version,old.method_version))fail('SKILL_VERSION_NOT_ADVANCED',ref);
    if(!methodChanged&&a.code_digest!==old.code_digest)validateAssessment(a,old,ref);
    if(a.method_version!==old.method_version&&!advanced(a.method_version,old.method_version))fail('SKILL_VERSION_NOT_ADVANCED',ref);
  }
  for(const [key,w] of Object.entries(now.workflows)){
    const old=before?.workflows?.[key],changed=old&&!same(w.activities,old.activities);
    for(const [field,code] of [['workflow_skill','WORKFLOW_SKILL_VERSION_NOT_ADVANCED'],['commander_skill','COMMANDER_SKILL_VERSION_NOT_ADVANCED']]){
      const s=w[field],prior=old?.[field];
      // Initial adoption still checks the actual old Workflow/Commander Skill,
      // rather than blessing old same-version text because no lock existed yet.
      const oldBytes=prior?null:optional(readBase,s.path);
      const priorVersion=prior?.version??(oldBytes?(front(oldBytes.toString(),s.path).metadata?.version??front(oldBytes.toString(),s.path).version):null);
      const textChanged=prior?s.content_digest!==prior.content_digest:oldBytes&&digest(oldBytes)!==s.sha256;
      if(priorVersion&&((changed||textChanged)&&!advanced(s.version,priorVersion)||s.version!==priorVersion&&!advanced(s.version,priorVersion)))fail(code,key);
    }
  }
}

export function writeMethodsLock(root,{compatibility={}}={}){
  if(!compatibility||Array.isArray(compatibility)||typeof compatibility!=='object')fail('CODE_COMPATIBILITY_INVALID');
  const current=collectMethods(root),read=reader(root),oldBytes=optional(read,LOCK_PATH),old=oldBytes?JSON.parse(oldBytes):null;
  for(const ref of Object.keys(compatibility))if(!current.activities[ref])fail('CODE_COMPATIBILITY_ACTIVITY_UNKNOWN',ref);
  for(const [ref,a] of Object.entries(current.activities)){
    const assessment=compatibility[ref]??old?.activities?.[ref]?.code_compatibility;
    if(assessment)a.code_compatibility=assessment;
  }
  writeFileSync(join(root,LOCK_PATH),JSON.stringify(current,null,2)+'\n');return current;
}
export function checkMethods(root,{base=null}={}){
  const read=reader(root),actual=collectMethods(root),lock=json(read,LOCK_PATH),stripped=structuredClone(lock);
  for(const a of Object.values(stripped.activities??{}))delete a.code_compatibility;
  if(!same(actual,stripped))fail('METHOD_LOCK_DRIFT','run explicit lock generation and review source changes');
  for(const [ref,a] of Object.entries(lock.activities))if(a.code_compatibility)validateAssessment(a,null,ref);
  if(base){
    if(!/^[a-f0-9]{40}$/.test(base))fail('BASE_SHA_INVALID');
    try{execFileSync('git',['rev-parse','--verify',base+'^{commit}'],{cwd:root,stdio:'pipe'});}catch{fail('BASE_COMMIT_UNAVAILABLE',base);}
    const readBase=path=>execFileSync('git',['show',base+':'+safePath(path)],{cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
    const bytes=optional(readBase,LOCK_PATH);let before=null;
    if(bytes){before=JSON.parse(bytes);const baseActual=collectMethods(root,{read:readBase}),strippedBase=structuredClone(before);for(const a of Object.values(strippedBase.activities??{}))delete a.code_compatibility;if(!same(baseActual,strippedBase))fail('BASE_METHOD_LOCK_DRIFT');}
    evolution(lock,before,readBase);
  }
  return {status:'PASS',activities:Object.keys(actual.activities).length,workflow_slots:Object.values(actual.workflows).reduce((n,w)=>n+w.activities.length,0),base,execution_verified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);let root=fileURLToPath(new URL('../../',import.meta.url)),base=null,write=false,compatibility={};
    for(let i=0;i<args.length;i++){const a=args[i];if(a==='--root')root=resolve(args[++i]);else if(a==='--base'){base=args[++i];if(!/^[a-f0-9]{40}$/.test(base??''))fail('BASE_SHA_INVALID');}else if(a==='--write')write=true;else if(a==='--compatibility')compatibility=JSON.parse(readFileSync(resolve(root,args[++i]),'utf8'));else fail('METHOD_OPTION_INVALID',a);}
    if(write){if(base)fail('METHOD_OPTION_INVALID','--write and --base cannot be combined');writeMethodsLock(root,{compatibility});console.log('method lock generated; generation is not compatibility approval');}
    else console.log(JSON.stringify(checkMethods(root,{base})));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
