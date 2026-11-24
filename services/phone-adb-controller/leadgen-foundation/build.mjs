// Offline packaging of the profile revisions actually declared by registered workflow sources.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {parse} from 'yaml';
import {hash,canonical,need} from './context.mjs';import {relative} from './freeze.mjs';
import {verifyAgentProfile} from './profile-contract.mjs';
const PREFIX='services/phone-adb-controller/leadgen-foundation';
const REPO='perfectuser21/zenithjoy-workspace',SKILLS='perfectuser21/zenithjoy-skills',SKILL_PREFIX='services/phone-adb-controller/skills/';
export const WORKFLOWS={'101':'douyin_video_discovery','102':'douyin_video_processing','103':'douyin_comment_scoring','104':'douyin_lead_outreach'};
const git=(root,args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{maxBuffer:10*1024*1024});
const read=(root,revision,p)=>git(root,['show',revision+':'+relative(p)]);
function repoIdentity(root,expected){
 const remote=git(root,['remote','get-url','origin']).toString().trim();
 need([`https://github.com/${expected}`,`https://github.com/${expected}.git`,`git@github.com:${expected}`,`git@github.com:${expected}.git`].includes(remote),'BUILD_REPO');
}
export const LIGHTWEIGHT_101={
 key:'douyin_video_discovery_lightweight',
 definitionPath: PREFIX+'/sources/101-lightweight.json',
 profilePath: PREFIX+'/profiles/101-lightweight.json',
};
export const SINGLE_CHECK_101={
 key:'douyin_video_discovery_single_check',
 definitionPath: PREFIX+'/sources/101-single-check.json',
 profilePath: PREFIX+'/profiles/101-single-check.json',
};
export function buildFoundationBundle({repoRoot,skillsRepo,outputRoot,lightweight101=false,singleCheck101=false}){
 repoIdentity(repoRoot,REPO);repoIdentity(skillsRepo,SKILLS);
 need(git(repoRoot,['status','--porcelain','--untracked-files=normal']).length===0,'BUILD_DIRTY');
 const revision=git(repoRoot,['rev-parse','HEAD']).toString().trim();need(/^[a-f0-9]{40}$/.test(revision),'BUILD_REVISION');
 need(path.isAbsolute(outputRoot)&&!fs.existsSync(outputRoot),'BUILD_TARGET');
 const authority=Object.fromEntries(Object.values(WORKFLOWS).map(key=>[key,parse(read(repoRoot,revision,'product-map/contracts/'+key+'.yaml').toString())]));
 need(!(lightweight101&&singleCheck101),'BUILD_DISCOVERY_VARIANT');
 const variant=lightweight101?LIGHTWEIGHT_101:singleCheck101?SINGLE_CHECK_101:null;
 const independent=variant?JSON.parse(read(repoRoot,revision,variant.definitionPath).toString()):null;
 if(independent)need(independent.key===variant.key&&independent.workflow===WORKFLOWS['101'],'BUILD_LIGHTWEIGHT_DEFINITION');
 const targets=independent?[['101',WORKFLOWS['101']]]:Object.entries(WORKFLOWS);
 const files=new Map(),origins={},workflows=[],revisions=new Set([revision]);
 const add=(sourceRevision,name,bytes,origin,kind=name.endsWith('/SKILL.md')?'skill':'code')=>{relative(name);need(bytes.length<=1024*1024,'BUILD_FILE_SIZE');const key=sourceRevision+':'+name;
  if(files.has(key))need(files.get(key).bytes.equals(bytes)&&files.get(key).kind===kind,'BUILD_COLLISION');else files.set(key,{revision:sourceRevision,name,bytes,kind});origins[key]=origin;};
 for(const [workflow,key]of targets){
  const contractPath=variant?.definitionPath??`product-map/contracts/${key}.yaml`;
  const contract=independent??authority[key],runtime=contract.runtime,ref=runtime?.profile_ref;
  const profilePath=variant?.profilePath??`${PREFIX}/profiles/${workflow}.json`;
  need(runtime?.kind==='commander-foundation-v1'&&ref?.repo===REPO&&ref.path===profilePath&&/^[a-f0-9]{40}$/.test(ref.revision??'')&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??''),'BUILD_RUNTIME');
  const profileRevision=ref.revision,bytes=read(repoRoot,profileRevision,profilePath);need('sha256:'+hash(bytes)===ref.digest,'BUILD_PROFILE_DIGEST');
  const document=JSON.parse(bytes),profile=document.profile;verifyAgentProfile(document,{documents:authority,workflow:key});revisions.add(profileRevision);
  need(document.schema_version===1&&document.contract.workflow===key&&profile.leadgen.workflow===workflow&&profile.leadgen.method_repository===SKILLS,'BUILD_PROFILE');
  if(independent)need((lightweight101?profile.leadgen.discovery_variant==='lightweight-host-script-v1':profile.leadgen.checker_policy==='workflow_preflight_once')
    &&canonical(document.contract.activities.map(a=>a.key))===canonical(independent.activities.map(a=>a.key)),'BUILD_LIGHTWEIGHT_PROFILE');
  const lock=JSON.parse(read(repoRoot,profileRevision,'.skills-source.json'));need(lock.version===1&&lock.repository===SKILLS&&lock.profile==='zenithjoy'&&/^[a-f0-9]{40}$/.test(lock.revision),'BUILD_SKILL_LOCK');
  const catalog=JSON.parse(read(skillsRepo,lock.revision,'distribution/catalog.json'));need(catalog.version===1&&Array.isArray(catalog.profiles?.zenithjoy?.files),'BUILD_SKILL_CATALOG');
  need(profile.leadgen.method_revision===lock.revision,'BUILD_METHOD_UNREGISTERED');
  const entries=Object.entries(profile.files);need(entries.length>0&&entries.length<=200,'BUILD_FILE_LIMIT');let size=bytes.length;
  for(const [name,digest]of entries){
   relative(name);const isSkill=name.startsWith(SKILL_PREFIX),matches=catalog.profiles.zenithjoy.files.filter(x=>x.path===name);
   if(isSkill)need(matches.length===1&&matches[0].sha256===digest,'BUILD_SKILL_ALIAS');
   const sourcePath=isSkill?matches[0].source:name,sourceRevision=isSkill?lock.revision:profileRevision;
   const source=read(isSkill?skillsRepo:repoRoot,sourceRevision,sourcePath);need(hash(source)===digest,'BUILD_SOURCE_DRIFT');size+=source.length;
   add(profileRevision,name,source,{repo:isSkill?SKILLS:REPO,revision:sourceRevision,path:sourcePath,digest:'sha256:'+digest});
  }
  need(size<=8*1024*1024,'BUILD_BYTES_LIMIT');add(profileRevision,profilePath,bytes,{repo:REPO,revision:profileRevision,path:profilePath,digest:ref.digest});
  const input_schema=JSON.parse(read(repoRoot,profileRevision,`${PREFIX}/schemas/${workflow}.json`));need(canonical(input_schema)===canonical(runtime.input_schema),'BUILD_INPUT_SCHEMA');
  const implementation_bindings=[{kind:'code',repo:REPO,path:profilePath,revision:profileRevision,digest:ref.digest},...entries.map(([name,digest])=>({kind:name.startsWith(SKILL_PREFIX)?'skill':'code',repo:REPO,path:name,revision:profileRevision,digest:'sha256:'+digest}))];
  workflows.push({workflow,key:independent?.key??key,implementation_bindings,contract_source:{repo:REPO,path:contractPath,revision},runtime});
 }
 // The existing publisher checks every definition binding, including business files at B.
 // Resolve only the four fixed contract documents and their explicit shared Activity refs.
 const documents=new Map(workflows.map(w=>[w.key,parse(read(repoRoot,revision,w.contract_source.path).toString())]));
 const resolveActivity=(owner,activity,trail=[])=>{
  if(!activity.ref)return activity;
  need(typeof activity.ref==='string'&&/^[\w-]+\.[\w-]+$/.test(activity.ref)&&!trail.includes(activity.ref),'BUILD_ACTIVITY_REF');
  const [key,slot]=activity.ref.split('.'),matches=documents.get(key)?.activities?.filter(a=>(a.key??a.ref?.split('.')[1])===slot)??[];
  need(matches.length===1,'BUILD_ACTIVITY_REF');return resolveActivity(key,matches[0],[...trail,activity.ref]);
 };
 const bindingCache=new Map();
 const installBinding=b=>{
  need(b&&['code','skill'].includes(b.kind)&&b.repo===REPO,'BUILD_BINDING');
  const sourceRevision=b.revision==='contract'?revision:b.revision;need(/^[a-f0-9]{40}$/.test(sourceRevision??''),'BUILD_BINDING_REVISION');relative(b.path);
  const id=[b.kind,sourceRevision,b.path].join(':');let item=bindingCache.get(id);
  if(!item){
   let sourcePath=b.path,resolvedRevision=sourceRevision,sourceRepo=REPO;
   if(b.kind==='skill'){
    const lock=JSON.parse(read(repoRoot,sourceRevision,'.skills-source.json'));need(lock.version===1&&lock.repository===SKILLS&&lock.profile==='zenithjoy'&&/^[a-f0-9]{40}$/.test(lock.revision),'BUILD_SKILL_LOCK');
    const catalog=JSON.parse(read(skillsRepo,lock.revision,'distribution/catalog.json')),matches=catalog.profiles?.zenithjoy?.files?.filter(x=>x.path===b.path)??[];
    need(matches.length===1,'BUILD_SKILL_ALIAS');sourcePath=matches[0].source;resolvedRevision=lock.revision;sourceRepo=SKILLS;
    const bytes=read(skillsRepo,resolvedRevision,sourcePath);need(hash(bytes)===matches[0].sha256,'BUILD_SOURCE_DRIFT');
    item={bytes,sourcePath,resolvedRevision,sourceRepo};
   }else item={bytes:read(repoRoot,sourceRevision,sourcePath),sourcePath,resolvedRevision,sourceRepo};
   bindingCache.set(id,item);
  }
  const digest='sha256:'+hash(item.bytes);need((b.digest===undefined||b.digest===digest)&&(b.sha256===undefined||b.sha256===digest.slice(7)),'BUILD_BINDING_DIGEST');
  revisions.add(sourceRevision);add(sourceRevision,b.path,item.bytes,{repo:item.sourceRepo,revision:item.resolvedRevision,path:item.sourcePath,digest},b.kind);
  return {kind:b.kind,repo:REPO,revision:sourceRevision,path:b.path,digest};
 };
 const visit=value=>[...(value.implementation_bindings??[]),...(value.runtime?.kind?[value.runtime]:[]),...(value.implementation?.kind?[value.implementation]:[]),...(value.steps??[]).flatMap(visit)];
 for(const w of workflows){
  const declared=(documents.get(w.key).activities??[]).flatMap(a=>visit(resolveActivity(w.key,a)));
  w.definition_bindings=declared.map(installBinding);
  if(independent)need(w.implementation_bindings.every(item=>w.definition_bindings.some(binding=>canonical(binding)===canonical(item))),'BUILD_LIGHTWEIGHT_BINDINGS');
 }
 need([...files.values()].reduce((n,f)=>n+f.bytes.length,0)<=64*1024*1024,'BUILD_PUBLISH_BYTES_LIMIT');
 // Validate every declared source before writing. This does not register, activate or publish anything.
 fs.mkdirSync(outputRoot,{mode:0o700});
 for(const {name,bytes,revision:sourceRevision}of files.values()){
  const file=path.join(outputRoot,REPO,sourceRevision,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 }
 const components=[...[...revisions].map(revision=>({kind:'repo',repo:REPO,revision})),...[...files.values()].map(({name,bytes,revision,kind})=>({kind,repo:REPO,revision,path:name,digest:'sha256:'+hash(bytes)}))];
 const receipt={schema:'leadgen-foundation-bundle/v1',status:'built_not_registered',repo:REPO,revision,workflows,components,source_origins:origins};
 fs.writeFileSync(path.join(outputRoot,'bundle.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [repoRoot,skillsRepo,outputRoot,...rest]=process.argv.slice(2);
 need(repoRoot&&skillsRepo&&outputRoot&&(rest.length===0||rest.length===1&&['--lightweight-101','--single-check-101'].includes(rest[0])),'BUILD_USAGE');
 const result=buildFoundationBundle({repoRoot:path.resolve(repoRoot),skillsRepo:path.resolve(skillsRepo),outputRoot:path.resolve(outputRoot),lightweight101:rest[0]==='--lightweight-101',singleCheck101:rest[0]==='--single-check-101'});
 console.log(JSON.stringify({status:result.status,revision:result.revision,workflows:result.workflows.map(w=>w.key),components:result.components.length}));
}
