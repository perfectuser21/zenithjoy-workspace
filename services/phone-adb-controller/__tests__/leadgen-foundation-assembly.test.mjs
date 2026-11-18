import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
for(const workflow of ['101','102','103','104'])test(`foundation ${workflow} real source assembly is isolated, reusable and effect free`,async()=>{
 const f=await foundationFixture(workflow);try{
  const before=Date.now(),a=await prepareLeadgenHost(f);assert.equal(a.receipt.status,'assembled_not_started');
  assert.ok(Date.parse(a.context.run_start_ts)>=before);assert.equal(a.context.tasks[workflow].run_tag,f.run.run_id);
  assert.equal(a.context.actor,'foundation:fixture-machine');assert.equal(a.context.root_task_id,f.run.task_id);
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'receipts')),false);assert.equal(fs.existsSync(path.join(a.profile.cwd,'outreach-receipts')),false);
  const contextFile=path.join(a.profile.cwd,'context.json'),bytes=fs.readFileSync(contextFile),mtime=fs.statSync(contextFile).mtimeMs;
  const b=await prepareLeadgenHost(f);assert.equal(b.receipt.recovered,true);assert.equal(b.context.run_start_ts,a.context.run_start_ts);assert.equal(fs.statSync(contextFile).mtimeMs,mtime);assert.deepEqual(fs.readFileSync(contextFile),bytes);
  const proof=JSON.parse(fs.readFileSync(a.context.verification.proof_manifest_path));assert.deepEqual(proof.fields,{});assert.equal(proof.identity.run_id,f.run.run_id);
  if(workflow==='104'){
   const exact=JSON.parse(fs.readFileSync(path.join(a.profile.cwd,'outreach-scope.json')));
   assert.deepEqual(Object.keys(exact).sort(),['record_id','comment_id','company_id','source_run','mark_run','target_douyin_id','line_key'].sort());
   assert.equal(exact.record_id,f.run.input.business.scope.record_id);assert.equal(exact.source_run,f.run.input.business.scope.source_102_run);
   assert.match(fs.readFileSync(path.join(a.profile.cwd,'invoke.mjs'),'utf8'),/LEADGEN_OUTREACH_MODE/);
   assert.ok(a.profile.skill_runtime.codex.env_keys.includes('LEADGEN_OUTREACH_SCOPE_FILE'));
  }
  await a.verifySource();
  for(const name of Object.keys(a.receipt.files).filter(n=>n.endsWith('.mjs')&&!n.startsWith('asr-runtime/'))){const r=spawnSync(process.execPath,['--check',path.join(a.profile.cwd,name)],{encoding:'utf8'});assert.equal(r.status,0,name+': '+r.stderr);}
  const python=spawnSync('python3',['-c',"import pathlib,sys; [compile(p.read_text(),str(p),'exec') for p in pathlib.Path(sys.argv[1]).rglob('*.py')]",a.profile.cwd],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);
  fs.appendFileSync(contextFile,' ');await assert.rejects(a.verifySource(),/LEADGEN_RECOVERY_SOURCE/);
 }finally{f.close();}
});
test('foundation recovery rejects coordinated source and self-reported receipt hash tampering',async()=>{
 const f=await foundationFixture();try{
  const first=await prepareLeadgenHost(f),file=path.join(first.profile.cwd,'tools.py'),receiptFile=path.join(first.profile.cwd,'leadgen-host-receipt.json');
  fs.appendFileSync(file,'\n# foreign replacement\n');const receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.files['tools.py']=createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.writeFileSync(receiptFile,JSON.stringify(receipt));
  await assert.rejects(prepareLeadgenHost(f),/LEADGEN_RECOVERY_SOURCE/);assert.match(fs.readFileSync(file,'utf8'),/foreign replacement/);
 }finally{f.close();}
});
test('foundation recovery never recreates missing mutable proof evidence',async()=>{
 const f=await foundationFixture();try{
  const first=await prepareLeadgenHost(f),proof=first.context.verification.proof_manifest_path;fs.unlinkSync(proof);
  await assert.rejects(prepareLeadgenHost(f),/LEADGEN_PROOF_MISSING/);assert.equal(fs.existsSync(proof),false);
 }finally{f.close();}
});
