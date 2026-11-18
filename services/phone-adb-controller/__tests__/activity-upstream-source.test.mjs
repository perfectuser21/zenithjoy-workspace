import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/activity-host-pg.json',import.meta.url)));
const original=fixture.files['production-readback-local.mjs'].source;
const pg="import {loadActivityHostPg} from './activity-host-pg.mjs';\n"+original.replace("const {Pool}=require('pg');","const {Pool}=await loadActivityHostPg(c);");
const helper=new URL('../activity-upstream-source.mjs',import.meta.url),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const implementation=fs.existsSync(helper)?await import(helper):null;
function setup(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'upstream-source-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const id={task_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',run_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',run_tag:'producer-real-run'};
 const input={source_commit:'a'.repeat(40),profile:'producer-phone',company_id:'company',tenant_id:'tenant',line:'line',run_tag:id.run_tag,assigned_workflow:'101',tasks:{'101':id}};
 const manifest={run:{task_id:id.task_id,run_id:id.run_id,contract:{workflow:'douyin-leadgen-101'},input}},result={task_id:id.task_id,run_id:id.run_id,status:'completed',business_pass:true};
 const manifestPath=path.join(root,'manifest.json'),resultPath=path.join(root,'result.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest));fs.writeFileSync(resultPath,JSON.stringify(result));
 const descriptor={workflow:'101',...id,source_commit:input.source_commit,manifest_path:manifestPath,manifest_sha256:hash(fs.readFileSync(manifestPath)),result_path:resultPath,result_sha256:hash(fs.readFileSync(resultPath))};
 const c={source_commit:'b'.repeat(40),profile:'consumer-phone',company_id:'company',tenant_id:'tenant',line:'line',input_provenance:{producer:descriptor}};
 return {root,c,descriptor,input,manifest,result,producer:{run:id.run_tag,run_id:id.run_id},writeManifest(){fs.writeFileSync(manifestPath,JSON.stringify(this.manifest));descriptor.manifest_sha256=hash(fs.readFileSync(manifestPath));},writeResult(){fs.writeFileSync(resultPath,JSON.stringify(result));descriptor.result_sha256=hash(fs.readFileSync(resultPath));}};
}
function actualExpected(source,c,activity,producer){
 const statement=source.split('\n').find(x=>x.includes('const expected={run:producer.run'));
 assert.ok(statement,'execute actual frozen production metrics expected-scope statement');
 return Function('c','activity','producer','row','request','resolveProducerIdentity',statement+';return expected;')(c,activity,producer,{video_id:'12345678901234567',video_url:'https://www.douyin.com/video/12345678901234567'},{run_id:'consumer'},implementation?.resolveProducerIdentity);
}
test('actual frozen dedup scope uses completed producer source and profile across consumer upgrades',t=>{
 const f=setup(t),source=implementation?implementation.wireProducerReadback(pg):pg;
 const expected=actualExpected(source,f.c,'dedup',f.producer);
 assert.equal(expected.source_commit,f.input.source_commit);assert.equal(expected.profile,f.input.profile);
 assert.equal(f.c.source_commit,'b'.repeat(40));assert.equal(expected.run,f.producer.run);
 assert.equal(fixture.files['production-readback-local.mjs'].sha256,hash(original));
});
test('collect_videos remains bound to own executing source and profile without producer metadata',()=>{
 const c={source_commit:'c'.repeat(40),profile:'own-phone',line:'line'};
 const source=implementation?implementation.wireProducerReadback(pg):pg;
 const expected=actualExpected(source,c,'collect_videos',{run:'own-run',run_id:'own-id'});
 assert.equal(expected.source_commit,c.source_commit);assert.equal(expected.profile,c.profile);
});
test('dedup rejects missing, altered or incomplete independent source before trusting row metadata',t=>{
 const f=setup(t);assert.ok(implementation,'permanent admission helper required');
 for(const mutate of [c=>delete c.input_provenance,c=>c.input_provenance.producer.manifest_sha256='0'.repeat(64),c=>c.input_provenance.producer.result_sha256='0'.repeat(64),c=>c.input_provenance.producer.source_commit='b'.repeat(40),c=>c.input_provenance.producer.run_tag='foreign',c=>c.company_id='foreign',c=>c.tenant_id='foreign',c=>c.line='foreign']){
  const c=structuredClone(f.c);mutate(c);assert.throws(()=>implementation.resolveProducerIdentity(c,'dedup',f.producer),/UPSTREAM_SOURCE_/);
 }
 f.result.business_pass=false;f.writeResult();assert.throws(()=>implementation.resolveProducerIdentity(f.c,'dedup',f.producer),/UPSTREAM_SOURCE_RESULT/);
 f.result.business_pass=true;f.result.status='needs_review';f.writeResult();assert.throws(()=>implementation.resolveProducerIdentity(f.c,'dedup',f.producer),/UPSTREAM_SOURCE_RESULT/);
});
test('producer manifest identities and known workflow must agree independently',t=>{
 const f=setup(t);assert.ok(implementation);
 for(const mutate of [m=>m.run.task_id='foreign',m=>m.run.run_id='foreign',m=>m.run.input.tasks['101'].run_tag='foreign',m=>m.run.input.source_commit='d'.repeat(40),m=>m.run.contract.workflow='douyin-leadgen-103']){
  const before=structuredClone(f.manifest);mutate(f.manifest);f.writeManifest();assert.throws(()=>implementation.resolveProducerIdentity(f.c,'dedup',f.producer),/UPSTREAM_SOURCE_/);f.manifest=before;f.writeManifest();
 }
 f.manifest.run.contract.workflow='douyin_video_discovery';f.writeManifest();assert.equal(implementation.resolveProducerIdentity(f.c,'dedup',f.producer).source_commit,'a'.repeat(40));
});
test('readback wiring rejects source drift and double application, retaining original PG source pin',()=>{
 assert.ok(implementation);const out=implementation.wireProducerReadback(pg);assert.match(out,/activity-upstream-source/);assert.throws(()=>implementation.wireProducerReadback(pg+'\n'),/UPSTREAM_SOURCE_BASE/);assert.throws(()=>implementation.wireProducerReadback(out),/UPSTREAM_SOURCE_BASE/);assert.equal(hash(original),fixture.files['production-readback-local.mjs'].sha256);
});
