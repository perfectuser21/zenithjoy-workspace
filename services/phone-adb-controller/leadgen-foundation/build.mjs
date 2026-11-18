// Offline packaging for the existing release/components and profile_ref protocol.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {hash,need} from './context.mjs';import {relative} from './freeze.mjs';
const PREFIX='services/phone-adb-controller/leadgen-foundation';
const REPO='perfectuser21/zenithjoy-workspace',SKILLS='perfectuser21/zenithjoy-skills';
export const WORKFLOWS={'101':'douyin_video_discovery','102':'douyin_video_processing','103':'douyin_comment_scoring','104':'douyin_lead_outreach'};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{maxBuffer:10*1024*1024});
function repoIdentity(root,expected){
 const remote=git(root,['remote','get-url','origin']).toString().trim();
 need([`https://github.com/${expected}`,`https://github.com/${expected}.git`,`git@github.com:${expected}`,`git@github.com:${expected}.git`].includes(remote),'BUILD_REPO');
}
export function buildFoundationBundle({repoRoot,skillsRepo,outputRoot}){
 repoIdentity(repoRoot,REPO);repoIdentity(skillsRepo,SKILLS);
 need(git(repoRoot,['status','--porcelain','--untracked-files=normal']).length===0,'BUILD_DIRTY');
 const revision=git(repoRoot,['rev-parse','HEAD']).toString().trim();need(/^[a-f0-9]{40}$/.test(revision),'BUILD_REVISION');
 need(path.isAbsolute(outputRoot)&&!fs.existsSync(outputRoot),'BUILD_TARGET');
 const files=new Map(),origins={},workflows=[];
 const lock=JSON.parse(git(repoRoot,['show',revision+':.skills-source.json']));need(lock.version===1&&lock.repository===SKILLS&&lock.profile==='zenithjoy'&&/^[a-f0-9]{40}$/.test(lock.revision),'BUILD_SKILL_LOCK');
 const catalog=JSON.parse(git(skillsRepo,['show',lock.revision+':distribution/catalog.json']));need(catalog.version===1&&Array.isArray(catalog.profiles?.zenithjoy?.files),'BUILD_SKILL_CATALOG');
 const add=(name,bytes,origin)=>{relative(name);need(bytes.length<=1024*1024,'BUILD_FILE_SIZE');if(files.has(name))need(files.get(name).equals(bytes),'BUILD_COLLISION');else files.set(name,bytes);origins[name]=origin;};
 for(const [workflow,key]of Object.entries(WORKFLOWS)){
  const profilePath=`${PREFIX}/profiles/${workflow}.json`,bytes=git(repoRoot,['show',revision+':'+profilePath]),document=JSON.parse(bytes),profile=document.profile;
  need(document.schema_version===1&&document.contract.workflow===key&&profile.leadgen.workflow===workflow&&profile.leadgen.method_repository===SKILLS,'BUILD_PROFILE');
  const methodRevision=profile.leadgen.method_revision;need(methodRevision===lock.revision&&/^[a-f0-9]{40}$/.test(methodRevision??''),'BUILD_METHOD_UNREGISTERED');
  const entries=Object.entries(profile.files);need(entries.length>0&&entries.length<=200,'BUILD_FILE_LIMIT');let size=bytes.length;
  for(const [name,digest]of entries){
   relative(name);const isSkill=name.startsWith('services/phone-adb-controller/skills/');
   const entries=catalog.profiles.zenithjoy.files.filter(x=>x.path===name);if(isSkill)need(entries.length===1&&entries[0].sha256===digest,'BUILD_SKILL_ALIAS');
   const sourcePath=isSkill?entries[0].source:name;
   const sourceRevision=isSkill?methodRevision:revision,sourceRepo=isSkill?skillsRepo:repoRoot;
   const source=git(sourceRepo,['show',sourceRevision+':'+sourcePath]);need(hash(source)===digest,'BUILD_SOURCE_DRIFT');size+=source.length;
   add(name,source,{repo:isSkill?SKILLS:REPO,revision:sourceRevision,path:sourcePath,digest:'sha256:'+digest});
  }
  need(size<=8*1024*1024,'BUILD_BYTES_LIMIT');add(profilePath,bytes,{repo:REPO,revision,path:profilePath,digest:'sha256:'+hash(bytes)});
  const schemaPath=`${PREFIX}/schemas/${workflow}.json`,input_schema=JSON.parse(git(repoRoot,['show',revision+':'+schemaPath]));
  const implementation_bindings=[{kind:'code',repo:REPO,path:profilePath,revision,digest:'sha256:'+hash(bytes)},...entries.map(([name,digest])=>({kind:name.startsWith('services/phone-adb-controller/skills/')?'skill':'code',repo:REPO,path:name,revision,digest:'sha256:'+digest}))];
  workflows.push({workflow,key,implementation_bindings,contract_source:{repo:REPO,path:`product-map/contracts/${key}.yaml`,revision},
   runtime:{kind:'commander-foundation-v1',profile_ref:{repo:REPO,path:profilePath,revision,digest:'sha256:'+hash(bytes)},timeout_ms:2400000,cleanup_timeout_ms:600000,commander_timeout_ms:60000,input_schema}});
 }
 // All sources are validated before the first output write; this does not install or register them.
 fs.mkdirSync(outputRoot,{mode:0o700});const install=path.join(outputRoot,REPO,revision);fs.mkdirSync(install,{recursive:true,mode:0o700});
 for(const [name,bytes]of files){const file=path.join(install,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
 const components=[{kind:'repo',repo:REPO,revision},...[...files].map(([name,bytes])=>({kind:name.startsWith('services/phone-adb-controller/skills/')?'skill':'code',repo:REPO,revision,path:name,digest:'sha256:'+hash(bytes)}))];
 const receipt={schema:'leadgen-foundation-bundle/v1',status:'built_not_registered',repo:REPO,revision,workflows,components,source_origins:origins};
 fs.writeFileSync(path.join(outputRoot,'bundle.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [repoRoot,skillsRepo,outputRoot,...rest]=process.argv.slice(2);need(repoRoot&&skillsRepo&&outputRoot&&!rest.length,'BUILD_USAGE');
 const result=buildFoundationBundle({repoRoot:path.resolve(repoRoot),skillsRepo:path.resolve(skillsRepo),outputRoot:path.resolve(outputRoot)});
 console.log(JSON.stringify({status:result.status,revision:result.revision,workflows:result.workflows.map(w=>w.key),components:result.components.length}));
}
