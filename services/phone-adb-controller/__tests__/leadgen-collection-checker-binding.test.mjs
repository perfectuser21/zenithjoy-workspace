import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('actual emitted collection identity verifier admits only its frozen host checker and original hashes',async()=>{
 const f=await foundationFixture('102'),old=process.env.DATABASE_URL;let deps;
 try{
  const config=JSON.parse(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG)),c=config.bindings.customer.context;
  for(const file of ['queued-recipient-evidence.js','company-config-lib.js','line-routes.js','nickname-match-lib.js']){
   const bytes='module.exports={};\n';fs.writeFileSync(path.join(c.runtime_root,file),bytes);c.verification.runtime_sha256[file]=hash(bytes);
  }
  fs.writeFileSync(path.join(c.runtime_root,'package.json'),'{"type":"commonjs"}');
  fs.writeFileSync(f.environment.LEADGEN_HOST_CONFIG,JSON.stringify(config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));
  const a=await prepareLeadgenHost(f),root=a.profile.cwd,checker=a.context.verification.artifact_checker;
  assert.equal(checker.command[1],path.join(root,'native_artifacts.py'));
  process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused';
  const {createDeps}=await import(pathToFileURL(path.join(root,'collection-evidence/runtime-deps.mjs')));
  deps=await createDeps(a.context,root);
  // The actual Python checker rejects missing original assets, proving it was reached rather than bypassed.
  await assert.rejects(deps.verifyIdentity({}),e=>!e.message.includes('NATIVE_CHECKER_PIN')&&e.message.includes('video_identity'));
  const original=checker.sha256[checker.command[1]];checker.sha256[checker.command[1]]='0'.repeat(64);
  await assert.rejects(deps.verifyIdentity({}),/NATIVE_CHECKER_PIN/);checker.sha256[checker.command[1]]=original;
  const exact=checker.command[1];checker.command[1]=path.join(root,'skills/douyin-leadgen-commander/scripts/native_artifacts.py');
  await assert.rejects(deps.verifyIdentity({}),/NATIVE_CHECKER_PIN/);checker.command[1]=exact;
  assert.equal(fs.existsSync(path.join(root,'receipts')),false);
 }finally{if(deps)await deps.close();if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;f.close();}
});
