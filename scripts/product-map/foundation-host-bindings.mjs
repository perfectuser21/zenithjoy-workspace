import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const repo='perfectuser21/zenithjoy-workspace',skillPrefix='services/phone-adb-controller/skills/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=(v,code)=>{if(!v)throw Error('FOUNDATION_HOST_'+code);};
const key=b=>JSON.stringify([b.kind,b.repo,b.revision,b.path,b.digest]);
const safe=p=>typeof p==='string'&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
function fixed(root,revision,p){
 need(/^[a-f0-9]{40}$/.test(revision??'')&&safe(p),'SOURCE');
 try{return execFileSync('git',['--no-replace-objects','-C',root,'show',revision+':'+p],{encoding:'utf8',maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});}catch{throw Error('FOUNDATION_HOST_FIXED_SOURCE');}
}
/** Deployment dependencies are independently pinned; they never replace a business method binding. */
export function partitionFoundationBindings({document,repoRoot,read,resolveActivity}){
 const own=document.activities.filter(a=>!a.ref),parts=new Map(),host=[];
 for(const a of own){
  const bindings=a.implementation_bindings??[];
  need(bindings.every(b=>b.purpose===undefined||b.purpose==='foundation_host'),'PURPOSE');
  parts.set(a.key,bindings.filter(b=>b.purpose===undefined));host.push(...bindings.filter(b=>b.purpose==='foundation_host'));
 }
 if(!host.length&&document.runtime?.kind!=='commander-foundation-v1')return parts;
 const ref=document.runtime?.profile_ref;need(document.runtime?.kind==='commander-foundation-v1'&&ref?.repo===repo&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??''),'PROFILE');
 const bytes=fixed(repoRoot,ref.revision,ref.path);need('sha256:'+hash(bytes)===ref.digest,'PROFILE_DIGEST');
 const profile=JSON.parse(bytes),p=profile.profile;need(p?.files&&p.skill_runtime?.activities,'PROFILE');
 const expected=[{kind:'code',repo,path:ref.path,revision:ref.revision,digest:ref.digest},...Object.entries(p.files).map(([path,digest])=>{
  need(safe(path)&&/^[a-f0-9]{64}$/.test(digest),'PROFILE');return {kind:path.startsWith(skillPrefix)?'skill':'code',repo,path,revision:ref.revision,digest:'sha256:'+digest};
 })],wanted=new Set(expected.map(key));
 need(wanted.size===expected.length&&host.length===wanted.size&&new Set(host.map(key)).size===host.length,'COMPONENT_SET');
 for(const b of host)need(Object.keys(b).sort().join(',')==='digest,kind,path,purpose,repo,revision'&&wanted.has(key(b)),'COMPONENT');
 const originalLock=JSON.parse(fixed(repoRoot,ref.revision,'.skills-source.json')),currentLock=JSON.parse(read('.skills-source.json'));
 need(['version','repository','revision','profile','loader_sha256'].every(k=>originalLock[k]===currentLock[k])
  &&p.leadgen?.method_repository===originalLock.repository&&p.leadgen?.method_revision===originalLock.revision,'SKILL_ORIGIN');
 const slots=document.activities.map(a=>a.key??a.ref.split('.')[1]);
 need(JSON.stringify(profile.contract?.activities?.map(a=>a.key))===JSON.stringify(slots)&&Object.keys(p.skill_runtime.activities).length===slots.length,'ACTIVITY_SET');
 for(const item of document.activities){
  const activity=item.ref?resolveActivity?.(item.ref):item;need(activity,'ACTIVITY');
  const business=(activity.implementation_bindings??[]).filter(b=>b.purpose===undefined),skills=business.filter(b=>b.kind==='skill');
  need(skills.length===1,'BUSINESS_SKILL');const b=skills[0],executed=p.skill_runtime.activities[activity.key]?.skill;
  need(b.revision==='contract'&&b.repo===repo&&executed===b.path&&p.files[executed]===hash(read(b.path)),'EXECUTED_SKILL');
 }
 return parts;
}
