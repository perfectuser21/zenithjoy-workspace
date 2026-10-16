import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const originalFiles=[
  "scripts/product-map/__tests__/leadgen-methods.test.js",
  "scripts/product-map/__tests__/leadgen-split-contracts.test.js",
  "scripts/product-map/__tests__/leadgen-workflow-skill.test.js",
  "services/phone-adb-controller/__tests__/activity-skill-agent.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-broker.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-handoff.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-integration.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-qualification.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-source.test.mjs",
  "services/phone-adb-controller/__tests__/async-outreach-bridge.test.mjs",
  "services/phone-adb-controller/__tests__/card-bottom-reveal.test.mjs",
  "services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs",
  "services/phone-adb-controller/__tests__/commander-workflow-progress.test.mjs",
  "services/phone-adb-controller/__tests__/continuous-identity.test.mjs",
  "services/phone-adb-controller/__tests__/copied-share-link.test.mjs",
  "services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs",
  "services/phone-adb-controller/__tests__/deploy-runtime-files.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-preflight.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-prepare.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-release-evidence.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-unified.test.mjs",
  "services/phone-adb-controller/__tests__/deregistered-comment.test.mjs",
  "services/phone-adb-controller/__tests__/discovery-receipt-recovery.test.mjs",
  "services/phone-adb-controller/__tests__/drift-check.test.mjs",
  "services/phone-adb-controller/__tests__/empty-collection.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-client.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-discovery.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-queue.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-rpc.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-skill-source-contract.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-workflow.test.mjs",
  "services/phone-adb-controller/__tests__/open-video-playing-page.test.mjs",
  "services/phone-adb-controller/__tests__/outreach-queue-boundary.test.mjs",
  "services/phone-adb-controller/__tests__/outreach-walking-skeleton.test.mjs",
  "services/phone-adb-controller/__tests__/peer-share-link.test.mjs",
  "services/phone-adb-controller/__tests__/private-message-delta.test.mjs",
  "services/phone-adb-controller/__tests__/queued-video-budget-progress.test.mjs",
  "services/phone-adb-controller/__tests__/queued-video.test.mjs",
  "services/phone-adb-controller/__tests__/recipient-evidence.test.mjs",
  "services/phone-adb-controller/__tests__/runtime-definition.test.mjs",
  "services/phone-adb-controller/__tests__/runtime-host.test.mjs",
  "services/phone-adb-controller/__tests__/runtime-receipts.test.mjs",
  "services/phone-adb-controller/__tests__/split-workflows.test.mjs",
  "services/phone-adb-controller/__tests__/step-dod-judge.test.mjs",
  "services/phone-adb-controller/__tests__/streaming-discovery.test.mjs",
  "services/phone-adb-controller/__tests__/video-card-optional-fields.test.mjs",
  "services/phone-adb-controller/__tests__/video-link-network.test.mjs",
  "services/phone-adb-controller/__tests__/viewport-restore.test.mjs",
  "services/phone-adb-controller/__tests__/wf-run-retired.test.mjs",
  "services/phone-adb-controller/__tests__/workflow-result-span.test.mjs",
  "services/phone-adb-controller/__tests__/workflow-result.test.mjs"
];
function run(fail='') {
 const dir=mkdtempSync(join(tmpdir(),'split-smoke-wiring-')); const bin=join(dir,'bin'), log=join(dir,'calls.jsonl'); mkdirSync(bin);
 const shim=`#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);fs.appendFileSync(process.env.SMOKE_WIRING_LOG,JSON.stringify({args,home:process.env.HOME??null})+'\\n');if(process.env.SMOKE_WIRING_FAIL&&(args.includes(process.env.SMOKE_WIRING_FAIL)||(process.env.SMOKE_WIRING_FAIL==='home-free'&&process.env.HOME===undefined)))process.exit(13);\n`;
 writeFileSync(join(bin,'node'),shim,{mode:0o755});
 const result=spawnSync('/bin/bash',['scripts/smoke/leadgen-split-smoke.sh'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,HOME:join(dir,'caller-home'),SMOKE_WIRING_LOG:log,SMOKE_WIRING_FAIL:fail},timeout:10000});
 const calls=readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x));rmSync(dir,{recursive:true,force:true});return {result,calls};
}
test('split smoke executes every original complete test file once in one ordinary node:test invocation',()=>{
 const {result,calls}=run();assert.equal(result.status,0,result.stderr);
 const full=calls.filter(c=>c.args.includes('--test')&&!c.args.some(x=>x.startsWith('--test-name-pattern')));
 assert.equal(full.length,1,'serial duplicate invocations exceed the fixed 300-second assertion budget');
 assert.ok(full[0].args.includes('--test-concurrency=4'),'bounded file-level concurrency is required; preserve serial subtests');
 assert.ok(!full[0].args.some(x=>/^--test-(?:skip-pattern|only|todo)(?:=|$)/.test(x)),'complete suite must not skip or select individual tests');
 const files=full[0].args.filter(x=>x.endsWith('.test.mjs')||x.endsWith('.test.js'));
 assert.equal(new Set(files).size,files.length,'ordinary complete suite repeats a file');
 assert.deepEqual([...files].sort(),[...originalFiles,'services/phone-adb-controller/__tests__/split-smoke-budget-wiring.test.mjs'].sort(),'complete suite file set changed');
 for(const file of originalFiles)assert.ok(files.includes(file),'lost original complete test coverage: '+file);
 assert.ok(files.includes('services/phone-adb-controller/__tests__/split-smoke-budget-wiring.test.mjs'));
 assert.equal(calls.filter(c=>c.args[0]==='scripts/product-map/leadgen-methods.mjs').length,1);
});
test('split smoke retains the actual HOME-free preflight and span assertions',()=>{
 const {result,calls}=run();assert.equal(result.status,0,result.stderr);
 const isolated=calls.filter(c=>c.home===null&&c.args.some(x=>x.startsWith('--test-name-pattern')));
 assert.equal(isolated.length,1);assert.ok(isolated[0].args.some(x=>x.includes('init: 额外导出')&&x.includes('init\\(preflight\\) 就上报一条 span')));
 assert.ok(isolated[0].args.includes('services/phone-adb-controller/__tests__/workflow-result.test.mjs'));
 assert.ok(isolated[0].args.includes('services/phone-adb-controller/__tests__/workflow-result-span.test.mjs'));
});
test('split smoke propagates both methods validation and complete-suite failures',()=>{
 for(const fail of ['scripts/product-map/leadgen-methods.mjs','services/phone-adb-controller/__tests__/continuous-identity.test.mjs','home-free']){
  const {result}=run(fail);assert.equal(result.status,13,result.stderr);
 }
});
