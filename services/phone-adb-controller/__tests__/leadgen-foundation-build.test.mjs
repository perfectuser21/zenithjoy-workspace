import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildFoundationBundle,WORKFLOWS} from '../leadgen-foundation/build.mjs';import {hash} from '../leadgen-foundation/context.mjs';
const prefix='services/phone-adb-controller/leadgen-foundation',repo=fileURLToPath(new URL('../../../',import.meta.url));
test('four published profiles freeze source closure and central skills without an instance identity',()=>{
 for(const [id,key]of Object.entries(WORKFLOWS)){
  const doc=JSON.parse(fs.readFileSync(path.join(repo,prefix,'profiles',id+'.json'))),p=doc.profile;
  assert.equal(doc.contract.workflow,key);assert.equal(p.leadgen.workflow,id);assert.equal(p.leadgen.method_revision,'1e1c069c379ed16315da125122f32e87eb27ae75');
  assert.equal(Object.keys(p.files).some(n=>n.startsWith('skills/')),false,'Skill aliases must exist in the central catalog');assert.ok(Object.keys(p.files).length<200);assert.ok(p.files[p.adapter]);let size=0;
  for(const [name,sha]of Object.entries(p.files)){
   assert.match(sha,/^[a-f0-9]{64}$/);assert.equal(path.isAbsolute(name),false);assert.equal(name.includes('..'),false);
   if(!name.startsWith('services/phone-adb-controller/skills/')){const b=fs.readFileSync(path.join(repo,name));assert.equal(hash(b),sha,name);size+=b.length;}
  }
  assert.ok(size<8*1024*1024);assert.equal(/\/Users\/|\/artifacts\/|"task_id"|"company_id"|"serial"|"credentials"/.test(JSON.stringify(p)),false);
  for(const a of doc.contract.activities)assert.ok(p.files[a.runtime.entry]);
  const schema=JSON.parse(fs.readFileSync(path.join(repo,prefix,'schemas',id+'.json')));assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.run_tag,undefined);
  if(id==='103')assert.equal(schema.properties.business.properties.scope.properties.comment_ids.maxItems,1);
 }
});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'leadgen-build-')),code=path.join(root,'code'),skills=path.join(root,'skills');
 const git=(r,...args)=>execFileSync('git',['-C',r,...args],{stdio:'pipe'}).toString().trim();
 const put=(r,n,b)=>{fs.mkdirSync(path.dirname(path.join(r,n)),{recursive:true});fs.writeFileSync(path.join(r,n),b);};
 for(const [r,remote]of [[code,'zenithjoy-workspace'],[skills,'zenithjoy-skills']]){fs.mkdirSync(r);git(r,'init','-q');git(r,'config','user.name','Fixture');git(r,'config','user.email','fixture@example.invalid');git(r,'remote','add','origin','https://github.com/perfectuser21/'+remote+'.git');}
 const commit=r=>{git(r,'add','.');git(r,'-c','core.hooksPath=/dev/null','commit','-qm','test: fixture');return git(r,'rev-parse','HEAD');};
 const skill='documented method';put(skills,'distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path:'services/phone-adb-controller/skills/method/SKILL.md',source:'business-skills/zenithjoy/services/phone-adb-controller/skills/method/SKILL.md',sha256:hash(skill)}]}}}));put(skills,'business-skills/zenithjoy/services/phone-adb-controller/skills/method/SKILL.md',skill);const methodRevision=commit(skills);put(code,'.skills-source.json',JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',revision:methodRevision,profile:'zenithjoy',loader_sha256:'a'.repeat(64)}));
 for(const [id,key]of Object.entries(WORKFLOWS)){
  put(code,prefix+'/profiles/'+id+'.json',JSON.stringify({schema_version:1,contract:{workflow:key},profile:{leadgen:{workflow:id,method_repository:'perfectuser21/zenithjoy-skills',method_revision:methodRevision},files:{'source.mjs':hash('export {};'),'services/phone-adb-controller/skills/method/SKILL.md':hash(skill)}}}));
  put(code,prefix+'/schemas/'+id+'.json','{"type":"object"}');
 }
 put(code,'source.mjs','export {};');const revision=commit(code);
 return {root,code,skills,revision,methodRevision,git,put,commit,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('offline bundle fixes actual revisions and verifies all sources before writing',()=>{
 const f=fixture();try{
  const output=path.join(f.root,'bundle'),b=buildFoundationBundle({repoRoot:f.code,skillsRepo:f.skills,outputRoot:output});
  assert.equal(b.status,'built_not_registered');assert.equal(b.revision,f.revision);assert.equal(b.workflows.length,4);
  assert.equal(b.source_origins['services/phone-adb-controller/skills/method/SKILL.md'].revision,f.methodRevision);
  assert.ok(b.components.some(c=>c.kind==='repo'&&c.revision===f.revision));assert.ok(b.workflows.every(w=>w.implementation_bindings.length>0));
  for(const c of b.components.filter(c=>c.kind!=='repo'))assert.equal(hash(fs.readFileSync(path.join(output,c.repo,c.revision,c.path))),c.digest.slice(7));
  f.put(f.code,'source.mjs','foreign');assert.throws(()=>buildFoundationBundle({repoRoot:f.code,skillsRepo:f.skills,outputRoot:path.join(f.root,'dirty')}),/BUILD_DIRTY/);assert.equal(fs.existsSync(path.join(f.root,'dirty')),false);
  f.commit(f.code);assert.throws(()=>buildFoundationBundle({repoRoot:f.code,skillsRepo:f.skills,outputRoot:path.join(f.root,'drift')}),/BUILD_SOURCE_DRIFT/);assert.equal(fs.existsSync(path.join(f.root,'drift')),false);
 }finally{f.close();}
});
test('four original product-map contracts pin executable profiles and every profile source binding',async()=>{
 const {parse}=await import('yaml');
 for(const [id,key]of Object.entries(WORKFLOWS)){
  const document=parse(fs.readFileSync(path.join(repo,'product-map/contracts',key+'.yaml'),'utf8')),runtime=document.runtime;
  assert.equal(runtime?.kind,'commander-foundation-v1');assert.match(runtime.profile_ref.revision,/^[a-f0-9]{40}$/);
  const profileBytes=fs.readFileSync(path.join(repo,runtime.profile_ref.path)),p=JSON.parse(profileBytes).profile;
  assert.equal(runtime.profile_ref.digest,'sha256:'+hash(profileBytes));assert.deepEqual(runtime.input_schema,JSON.parse(fs.readFileSync(path.join(repo,prefix,'schemas',id+'.json'))));
  const bindings=document.activities.flatMap(a=>a.implementation_bindings??[]);
  for(const [name,digest]of [[runtime.profile_ref.path,hash(profileBytes)],...Object.entries(p.files)])assert.ok(bindings.some(b=>b.path===name&&b.revision===runtime.profile_ref.revision&&b.digest==='sha256:'+digest),name+' lacks a frozen definition binding');
 }
});
test('product-map foundation runtime rejects floating profiles and unknown authority fields',async()=>{
 const {default:Ajv}=await import('ajv');const schema=JSON.parse(fs.readFileSync(path.join(repo,'product-map/contracts/activity-contract.schema.json'))).properties.runtime;
 const {parse}=await import('yaml'),runtime=parse(fs.readFileSync(path.join(repo,'product-map/contracts/douyin_video_discovery.yaml'),'utf8')).runtime,validate=new Ajv({strict:true}).compile(schema);
 assert.equal(validate(runtime),true);for(const change of [r=>r.profile_ref.revision='main',r=>delete r.profile_ref.digest,r=>r.profile_ref.path='../outside',r=>r.timeout_ms=0,r=>r.env={OVERRIDE:'yes'}]){const r=structuredClone(runtime);change(r);assert.equal(validate(r),false);}
});
