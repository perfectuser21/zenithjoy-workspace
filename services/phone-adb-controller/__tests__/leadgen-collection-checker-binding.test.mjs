import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('actual emitted collection identity reader admits only its frozen technical reader and original hashes',async()=>{
 const f=await foundationFixture('102'),old=process.env.DATABASE_URL;let deps;
 try{
  const config=JSON.parse(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG)),c=config.bindings.customer.context;
  for(const file of ['queued-recipient-evidence.js','company-config-lib.js','line-routes.js','nickname-match-lib.js']){
   const bytes='module.exports={};\n';fs.writeFileSync(path.join(c.runtime_root,file),bytes);c.verification.runtime_sha256[file]=hash(bytes);
  }
  fs.writeFileSync(path.join(c.runtime_root,'package.json'),'{"type":"commonjs"}');
  fs.writeFileSync(f.environment.LEADGEN_HOST_CONFIG,JSON.stringify(config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));
  const a=await prepareLeadgenHost(f),root=a.profile.cwd,checker=a.context.verification.native_identity_reader;
  assert.equal(checker.command[1],path.join(root,'native-identity.py'));
  assert.equal(a.context.verification.artifact_checker,undefined);assert.equal(fs.existsSync(path.join(root,'native_artifacts.py')),false);
  process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused';
  const {createDeps}=await import(pathToFileURL(path.join(root,'collection-evidence/runtime-deps.mjs')));
  deps=await createDeps(a.context,root);
  // The emitted technical identity reader consumes the original link receipt; no network fallback.
  const run=a.context.tasks['102'].run_tag,video=a.context.verification['102'].video_ids[0],file=path.join(root,'native-link-test.json');
  const bytes=JSON.stringify({exit_code:0,args:['current-video-link',run+'-native-link'],stdout:'https://www.douyin.com/video/'+video});fs.writeFileSync(file,bytes);
  const spec={expected_run:run,video_id:video,video_identity:{path:file,sha256:hash(bytes)}};
  assert.equal(await deps.verifyIdentity(spec),true);
  assert.equal(await deps.verifyIdentity({...spec,video_id:'7711111111111111112'}),false);
  await assert.rejects(deps.verifyIdentity({...spec,video_identity:{...spec.video_identity,sha256:'0'.repeat(64)}}),/ASSET_HASH_MISMATCH/);
  const original=checker.sha256[checker.command[1]];checker.sha256[checker.command[1]]='0'.repeat(64);
  await assert.rejects(deps.verifyIdentity(spec),/NATIVE_CHECKER_PIN/);checker.sha256[checker.command[1]]=original;
  const exact=checker.command[1];checker.command[1]=path.join(root,'skills/douyin-leadgen-commander/scripts/native_artifacts.py');
  await assert.rejects(deps.verifyIdentity(spec),/NATIVE_CHECKER_PIN/);checker.command[1]=exact;
  assert.deepEqual(fs.readdirSync(path.join(root,'receipts')),['.keep']);
 }finally{if(deps)await deps.close();if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;f.close();}
});
test('102 instructions reference the complete Contract and delivered technical identity reader without a retired judge',async()=>{
 const f=await foundationFixture('102');try{
  const a=await prepareLeadgenHost(f),tools=fs.readFileSync(path.join(a.profile.cwd,'TOOLS.txt'),'utf8');
  assert.ok(!tools.includes('gate-contract.md'));assert.match(tools,/字段按本Activity完整冻结Contract/);assert.match(tools,/native-identity.py技术身份解析器/);
  assert.equal(a.context.verification.native_identity_reader.sha256[path.join(a.profile.cwd,'native-identity.py')],hash(fs.readFileSync(path.join(a.profile.cwd,'native-identity.py'))));
  assert.equal(fs.existsSync(path.join(a.profile.cwd,'native_artifacts.py')),false);
  assert.match(fs.readFileSync(path.join(a.profile.cwd,'TOOLS-base.txt'),'utf8'),/gate-contract.md/);
 }finally{f.close();}
});
