import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const originalFiles=[
  "services/phone-adb-controller/__tests__/collection-panel-readback.test.mjs",
  "services/phone-adb-controller/__tests__/collection-template-policy.test.mjs",
  "services/phone-adb-controller/__tests__/collection-leaf-scope.test.mjs",
  "services/phone-adb-controller/__tests__/collection-phone-proof.test.mjs",
  "services/phone-adb-controller/__tests__/collection-scope-input.test.mjs",
  "scripts/product-map/__tests__/leadgen-methods.test.js",
  "scripts/product-map/__tests__/leadgen-split-contracts.test.js",
  "scripts/product-map/__tests__/leadgen-workflow-skill.test.js",
  "services/phone-adb-controller/__tests__/activity-skill-agent.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-broker.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-handoff.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-integration.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-qualification.test.mjs",
  "services/phone-adb-controller/__tests__/activity-skill-source.test.mjs",
  "services/phone-adb-controller/__tests__/adb-existing-route.test.mjs",
  "services/phone-adb-controller/__tests__/managed-adb-policy.test.mjs",
  "services/phone-adb-controller/__tests__/managed-adb-client.test.mjs",
  "services/phone-adb-controller/__tests__/adb-host-service.test.mjs",
  "services/phone-adb-controller/__tests__/adb-host-maintenance.test.mjs",
  "services/phone-adb-controller/__tests__/adb-host-terminal.test.mjs",
  "services/phone-adb-controller/__tests__/maintenance-task-purpose.test.mjs",
  "services/phone-adb-controller/__tests__/managed-adb-deployment.test.mjs",
  "services/phone-adb-controller/__tests__/async-outreach-bridge.test.mjs",
  "services/phone-adb-controller/__tests__/card-bottom-reveal.test.mjs",
  "services/phone-adb-controller/__tests__/clipboard-nonce.test.mjs",
  "services/phone-adb-controller/__tests__/commander-workflow-progress.test.mjs",
  "services/phone-adb-controller/__tests__/commander-returned-readback.test.mjs",
  "services/phone-adb-controller/__tests__/continuous-identity.test.mjs",
  "services/phone-adb-controller/__tests__/continuous-recording-boundary.test.mjs",
  "services/phone-adb-controller/__tests__/copied-share-link.test.mjs",
  "services/phone-adb-controller/__tests__/current-video-link-leave-scratch.test.mjs",
  "services/phone-adb-controller/__tests__/deploy-runtime-files.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-fixed-source.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-preflight.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-prepare.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-publish-release.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-release-evidence.test.mjs",
  "services/phone-adb-controller/__tests__/deployment-unified.test.mjs",
  "services/phone-adb-controller/__tests__/deregistered-comment.test.mjs",
  "services/phone-adb-controller/__tests__/discovery-filter-admission.test.mjs",
  "services/phone-adb-controller/__tests__/discovery-receipt-recovery.test.mjs",
  "services/phone-adb-controller/__tests__/drift-check.test.mjs",
  "services/phone-adb-controller/__tests__/empty-collection.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-103-double-policy.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-103-policy.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-client.test.mjs",
  "services/phone-adb-controller/__tests__/leadgen-adb-route.test.mjs",
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
  "services/phone-adb-controller/__tests__/producer-descriptor-intake.test.mjs",
  "services/phone-adb-controller/__tests__/producer-pending-handoff.test.mjs",
  "services/phone-adb-controller/__tests__/producer-pending-claim-pg.test.mjs",
  "services/phone-adb-controller/__tests__/qualification-quarantine-recovery-102n.test.mjs",
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
function run(fail='',bootstrapExit=0) {
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'split-smoke-wiring-'))); const bin=join(dir,'bin'), log=join(dir,'calls.jsonl'); mkdirSync(bin);
 const shim=`#!${process.execPath}\nimport fs from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);if(args[0]==='scripts/ci/implementation-skill-source.mjs'&&args[1]==='--install-regression-skills'){const r=spawnSync('/bin/bash',['scripts/ensure-skills-source.sh',args[2]],{stdio:'inherit'});process.exit(r.status??1);}if(!fs.existsSync(process.env.SMOKE_BOOTSTRAP_LOG))process.exit(19);fs.appendFileSync(process.env.SMOKE_WIRING_LOG,JSON.stringify({args,home:process.env.HOME??null})+'\\n');if(process.env.SMOKE_WIRING_FAIL&&(args.includes(process.env.SMOKE_WIRING_FAIL)||(process.env.SMOKE_WIRING_FAIL==='home-free'&&process.env.HOME===undefined)))process.exit(13);\n`;
 writeFileSync(join(bin,'node'),shim,{mode:0o755});
 const bootstrap=join(dir,'bootstrap.log');
 mkdirSync(join(dir,'scripts/smoke'),{recursive:true});
 writeFileSync(join(dir,'scripts/smoke/leadgen-split-smoke.sh'),readFileSync(join(root,'scripts/smoke/leadgen-split-smoke.sh')));
 writeFileSync(join(dir,'scripts/ensure-skills-source.sh'),'printf \"%s\\n\" \"$1\" >> \"$SMOKE_BOOTSTRAP_LOG\"\nexit \"$SMOKE_BOOTSTRAP_EXIT\"\n');
 writeFileSync(log,'');
 const result=spawnSync('/bin/bash',['scripts/smoke/leadgen-split-smoke.sh'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,HOME:join(dir,'caller-home'),SMOKE_WIRING_LOG:log,SMOKE_WIRING_FAIL:fail,SMOKE_BOOTSTRAP_LOG:bootstrap,SMOKE_BOOTSTRAP_EXIT:String(bootstrapExit)},timeout:10000});
 const entries=readFileSync(log,'utf8').trim();
 const calls=entries?entries.split('\n').map(x=>JSON.parse(x)):[];
 const bootstraps=readFileSync(bootstrap,'utf8').trim().split('\n');
 rmSync(dir,{recursive:true,force:true});return {result,calls,bootstraps,dir};
}
test('split smoke executes every original complete test file once in one ordinary node:test invocation',()=>{
 const {result,calls}=run();assert.equal(result.status,0,result.stderr);
 const full=calls.filter(c=>c.args.includes('--test')&&!c.args.some(x=>x.startsWith('--test-name-pattern')));
 assert.equal(full.length,1,'serial duplicate invocations exceed the fixed 300-second assertion budget');
 assert.ok(full[0].args.includes('--test-concurrency=4'),'bounded file-level concurrency is required; preserve serial subtests');
 assert.ok(!full[0].args.some(x=>/^--test-(?:skip-pattern|only|todo)(?:=|$)/.test(x)),'complete suite must not skip or select individual tests');
 const files=full[0].args.filter(x=>x.endsWith('.test.mjs')||x.endsWith('.test.js'));
 assert.equal(new Set(files).size,files.length,'ordinary complete suite repeats a file');
 assert.deepEqual([...files].sort(),[...originalFiles,'services/phone-adb-controller/__tests__/leadgen-sampled-admission.test.mjs',
  'services/phone-adb-controller/__tests__/split-smoke-budget-wiring.test.mjs'].sort(),'complete suite file set changed');
 for(const file of originalFiles)assert.ok(files.includes(file),'lost original complete test coverage: '+file);
 assert.ok(files.includes('services/phone-adb-controller/__tests__/split-smoke-budget-wiring.test.mjs'));
 assert.ok(files.includes('services/phone-adb-controller/__tests__/leadgen-sampled-admission.test.mjs'));
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
 for(const fail of ['scripts/product-map/leadgen-methods.mjs','services/phone-adb-controller/__tests__/continuous-identity.test.mjs','services/phone-adb-controller/__tests__/discovery-filter-admission.test.mjs','home-free']){
  const {result}=run(fail);assert.equal(result.status,13,result.stderr);
 }
});

test('split smoke bootstraps its own workspace once before methods and refuses bootstrap failure',()=>{
 const ok=run();assert.equal(ok.result.status,0,ok.result.stderr);
 assert.deepEqual(ok.bootstraps,[ok.dir]);
 assert.equal(ok.calls[0].args[0],'scripts/product-map/leadgen-methods.mjs');
 const failed=run('',23);assert.equal(failed.result.status,23,failed.result.stderr);
 assert.deepEqual(failed.bootstraps,[failed.dir]);assert.deepEqual(failed.calls,[]);
 assert.ok(!failed.result.stdout.includes('PASS'));
});

test('七类非时序身份断言显式复用唯一wait_ms副本，真实录制时序仍独立保留',()=>{
 const source=readFileSync(join(root,'services/phone-adb-controller/__tests__/continuous-identity.test.mjs'),'utf8');
 for(const name of [
  '队列身份核验连续暂停到nonce完成，只在最终真实ID核验与严格归位后播放一次',
  '连续暂停不能用深链回显掩盖实际链接VID错误',
  '最终归位13节点必须重新打开并暂停读回真实分享树，再恢复播放',
  '严格归位持续骨架或最终播放失败，真实exit非零且不能输出IDENTITY成功',
  'qv局部暂停策略不污染锁或录音，record-start必须收到恢复后的播放状态',
  'keyword内部nonce归位保持暂停，仍新读分享树与原词视频tab后输出实际VID',
  '默认无keyword取链含真实nonce，归位后仍恢复PLAY供后续录音',
 ]){
  const start=source.indexOf(`test('${name}'`);assert.ok(start>=0,name);
  const call=source.slice(start).match(/\bphone\(([^)]*)\)/)?.[1];
  assert.match(call||'',/controlledWait:true/,name+'只断言身份与命令序列，不应消耗真实设备等待');
 }
 assert.ok(source.includes("assert.equal(patched.replace(controlled,wait),source"),'副本必须可逆还原生产全部字节');
 assert.match(source,/controlledWait=false/,'不能泛化所有case为无等待');
 const recording=join(root,'services/phone-adb-controller/__tests__/continuous-recording-boundary.test.mjs');
 assert.ok(existsSync(recording),'完整录音边界必须是独立真实test入口');
 const records=readFileSync(recording,'utf8');
 assert.doesNotMatch(records,/\bshareWave\(/,'分享树两例应保留在实际shareWave定义所在identity入口');
 for(const name of ['视频tab机会性策略只做一次dump，失败不发送全局媒体toggle','视频tab机会性策略接受完整新鲜树，不额外dump或toggle'])assert.ok(source.includes(name),name);
 for(const [name,body] of [['identity',source],['recording',records]])assert.ok(body.split('\n').length<=501,name+'必须不超过500行');
 assert.match(records,/recordBoundary\(\{captureMode:'delayed_growth'\}\)/,'迟到媒体保留真实等待');
 assert.match(records,/workflowRemainingSeconds:5/,'cleanup预算边界仍真实等待');
});
