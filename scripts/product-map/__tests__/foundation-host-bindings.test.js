import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const helper=new URL('../foundation-host-bindings.mjs',import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo='perfectuser21/zenithjoy-workspace',skill='services/phone-adb-controller/skills/method/SKILL.md',profilePath='profile.json',method='one fixed method',lock={version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision:'b'.repeat(40),loader_sha256:'c'.repeat(64)};
 const profile={contract:{activities:[{key:'work'}]},profile:{leadgen:{method_repository:lock.repository,method_revision:lock.revision},files:{'host.mjs':hash('export {};'),[skill]:hash(method)},skill_runtime:{activities:{work:{skill}}}}};
 const put=(p,b)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),b);};
 put(profilePath,JSON.stringify(profile));put('host.mjs','export {};');put(skill,method);put('.skills-source.json',JSON.stringify(lock));
 const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: immutable sources');const revision=git('rev-parse','HEAD');
 const business=[{kind:'skill',repo,path:skill,revision:'contract',name:'method',version:'1.0.0'},{kind:'code',repo,path:'business.mjs',revision:'contract'}];
 const host=[...Object.entries(profile.profile.files),[profilePath,hash(JSON.stringify(profile))]].map(([p,d])=>({kind:p===skill?'skill':'code',repo,path:p,revision,digest:'sha256:'+d,purpose:'foundation_host'}));
 const document={runtime:{kind:'commander-foundation-v1',profile_ref:{repo,path:profilePath,revision,digest:host.at(-1).digest}},activities:[{key:'work',implementation_bindings:[...business,...host]}]};
 return {root,profile,profilePath,document,business,host,put,read:p=>fs.readFileSync(path.join(root,p),'utf8')};
}
test('host delivery bindings preserve one original business Skill and its entire code set',async t=>{
 const f=fixture(t),{partitionFoundationBindings}=await import(helper),m=partitionFoundationBindings({document:f.document,repoRoot:f.root,read:f.read});assert.deepEqual(m.get('work'),f.business);
 f.put(f.profilePath,'working tree drift');assert.deepEqual(partitionFoundationBindings({document:f.document,repoRoot:f.root,read:f.read}).get('work'),f.business,'authority is fixed Git profile, not working tree');
});
test('purpose cannot hide extra, missing, duplicated or wrongly pinned host sources',async t=>{
 const f=fixture(t),{partitionFoundationBindings}=await import(helper);
 for(const mutate of [d=>d.activities[0].implementation_bindings.at(-1).revision='d'.repeat(40),d=>d.activities[0].implementation_bindings.at(-1).digest='sha256:'+'e'.repeat(64),d=>d.activities[0].implementation_bindings.at(-1).path='foreign.mjs',d=>d.activities[0].implementation_bindings.pop(),d=>d.activities[0].implementation_bindings.push({...d.activities[0].implementation_bindings.at(-1)}),d=>d.activities[0].implementation_bindings.at(-1).purpose='anything']){
  const d=structuredClone(f.document);mutate(d);assert.throws(()=>partitionFoundationBindings({document:d,repoRoot:f.root,read:f.read}),/FOUNDATION_HOST_/);
 }
});
test('独立运行依赖随候选提交冻结，保持原业务方法和历史主机文件集合', async t => {
 const f=fixture(t),{partitionFoundationBindings}=await import(helper);
 const path='services/phone-adb-controller/preflight-pg-lock.json';
 const binding={kind:'code',purpose:'deployment_lock',repo:f.host[0].repo,path,revision:'contract'};
 const bindings=f.document.activities[0].implementation_bindings;
 bindings.push(binding);
 f.put(path,'固定预检依赖');
 const check=()=>partitionFoundationBindings({document:f.document,repoRoot:f.root,read:f.read});
 assert.deepEqual(check().get('work'),f.business);
 bindings.push({...binding});
 assert.throws(check,/FOUNDATION_HOST_DEPLOYMENT_LOCK/);
 bindings.pop();
 binding.purpose='foundation_host';
 assert.throws(check,/FOUNDATION_HOST_COMPONENT_SET/);
 assert.deepEqual(partitionFoundationBindings({document:f.document,repoRoot:f.root,read:f.read,historical:true}).get('work'),f.business);
 binding.purpose='deployment_lock';
 binding.path='unrelated.mjs';
 assert.throws(check,/FOUNDATION_HOST_DEPLOYMENT_LOCK/);
});
test('host label cannot swallow the business Skill or execute different Skill contents or central origin',async t=>{
 const f=fixture(t),{partitionFoundationBindings}=await import(helper),call=d=>partitionFoundationBindings({document:d,repoRoot:f.root,read:f.read});
 const swallowed=structuredClone(f.document);swallowed.activities[0].implementation_bindings.shift();assert.throws(()=>call(swallowed),/FOUNDATION_HOST_BUSINESS_SKILL/);
 f.put(f.business[0].path,'different business method');assert.throws(()=>call(f.document),/FOUNDATION_HOST_EXECUTED_SKILL/);f.put(f.business[0].path,'one fixed method');
 const lock=JSON.parse(f.read('.skills-source.json'));lock.revision='f'.repeat(40);f.put('.skills-source.json',JSON.stringify(lock));assert.throws(()=>call(f.document),/FOUNDATION_HOST_SKILL_ORIGIN/);
});
test('OpenClaw fixed profile validation has ancestry available and refuses missing shallow source',async t=>{
 const {parse}=await import('yaml'),workflow=parse(fs.readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
 const checkout=workflow.jobs['openclaw-scripts-test'].steps.find(s=>s.uses==='actions/checkout@v4');
 assert.equal(checkout.with?.['fetch-depth'],0,'tests calling collectMethods must load the fixed profile ancestor');
 const f=fixture(t),{partitionFoundationBindings}=await import(helper),revision=f.document.runtime.profile_ref.revision;
 f.put('later.txt','definition commit follows product');execFileSync('git',['-C',f.root,'add','.']);execFileSync('git',['-C',f.root,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: later definition']);
 const shallow=f.root+'-shallow';t.after(()=>fs.rmSync(shallow,{recursive:true,force:true}));execFileSync('git',['clone','--quiet','--depth=1','file://'+f.root,shallow],{stdio:'pipe'});
 const check=()=>partitionFoundationBindings({document:f.document,repoRoot:shallow,read:p=>fs.readFileSync(path.join(shallow,p),'utf8')});
 assert.throws(check,/FOUNDATION_HOST_FIXED_SOURCE/);
 execFileSync('git',['-C',shallow,'fetch','--quiet','--unshallow'],{stdio:'pipe'});assert.deepEqual(check().get('work'),f.business);assert.equal(execFileSync('git',['-C',shallow,'rev-parse',revision],{encoding:'utf8'}).trim(),revision);
});
