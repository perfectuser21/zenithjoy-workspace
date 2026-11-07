import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {gates,checkGate} from '../required-gate.mjs';
import {PHONE_DARWIN_SUITES} from '../native-phone-ci-selection.mjs';
import {captureNodeArgs,openclawStep} from '../../../.github/workflows/scripts/__tests__/helpers/openclaw-selection.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const workflow=()=>YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8'));
test('102 owns a separate required20min Darwin job while101/103 keep their original budget and selector',()=>{
 const w=workflow(),job=w.jobs['native-102-darwin-test'];assert.ok(job,'native102 needs its own required Darwin owner');
 assert.equal(job['runs-on'],'macos-latest');assert.equal(job['timeout-minutes'],20);assert.deepEqual(job.strategy,{'fail-fast':false,matrix:{shard:[1,2]}});assert.equal(job.env.NATIVE_102_CI_SHARD,'${{ matrix.shard }}');assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);
 assert.equal(w.jobs['native-103-darwin-test']['timeout-minutes'],20);assert.equal(PHONE_DARWIN_SUITES.length,18);
 assert.ok(w.jobs['l3-passed'].needs.includes('native-102-darwin-test'));assert.ok(gates.code.always.includes('native-102-darwin-test'));
 const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}]))};assert.doesNotThrow(()=>checkGate('code',needs));
 for(const result of ['failure','cancelled','skipped',undefined]){const changed=structuredClone(needs);if(result)changed['native-102-darwin-test']={result};else delete changed['native-102-darwin-test'];assert.throws(()=>checkGate('code',changed),/native-102-darwin-test=/);}
});
test('102 job restores pinned Skills and prepares actual PG/Python/Pillow/media/compiler before exact owned driver',()=>{
 const job=workflow().jobs['native-102-darwin-test'];assert.ok(job);const commands=job.steps.filter(s=>s.run).map(s=>s.run).join('\n');
 assert.ok(job.steps.some(s=>s.uses==='./.github/actions/skills-source'));assert.ok(job.steps.some(s=>s.uses==='actions/setup-node@v4'&&s.with?.['node-version']==='22'));
 for(const pattern of [/npm ci --ignore-scripts --workspaces=false/,/brew install postgresql@17 python@3\.14 ffmpeg/,/Pillow==12\.2\.0/,/PREFLIGHT_TEST_PG_BIN/,/PREFLIGHT_TEST_PYTHON_BIN/,/PREFLIGHT_TEST_PIL_ROOT/,/PREFLIGHT_TEST_FFMPEG_BIN/,/PREFLIGHT_TEST_FFPROBE_BIN/,/\/usr\/bin\/clang --version/,/node --test scripts\/ci\/__tests__\/native-102-ci-lifecycle\.test\.mjs/,/node scripts\/ci\/native-102-darwin-tests\.mjs/])assert.match(commands,pattern);
 assert.doesNotMatch(commands,/native-103-darwin-tests|\|\| true|--test-skip|--test-name-pattern/);
 const artifacts=job.steps.find(s=>s.uses==='actions/upload-artifact@v4');assert.equal(artifacts.if,'failure()');assert.equal(artifacts.with.name,'native102-fixture-failures-${{ matrix.shard }}');assert.match(artifacts.with.path,/native102-fixture-artifacts/);
});
test('actual Linux shell argv retains every portable102 case and sends each Darwin case exclusively to its owner',async()=>{
 const {NATIVE_102_DARWIN_SUITES,NATIVE_102_PORTABLE_SUITES,NATIVE_102_DARWIN_SHARDS}=await import('../native-102-ci-selection.mjs');
 assert.deepEqual(Object.values(NATIVE_102_DARWIN_SHARDS).flat().sort(),[...NATIVE_102_DARWIN_SUITES].sort(),'each Darwin case has exactly one independent PG owner leg');
 assert.deepEqual(NATIVE_102_DARWIN_SHARDS['1'],['native-102-public-executor.test.mjs','native-102-public-nonce-driver.test.mjs','native-102-public-ui-driver.test.mjs','native-102-source-closure.test.mjs']);
 assert.ok(NATIVE_102_PORTABLE_SUITES.includes('native-102-public-intents.test.mjs'),'pure async/failfast intents remain in Linux');
 assert.equal(new Set([...NATIVE_102_DARWIN_SUITES,...NATIVE_102_PORTABLE_SUITES]).size,NATIVE_102_DARWIN_SUITES.length+NATIVE_102_PORTABLE_SUITES.length);
 const args=captureNodeArgs(openclawStep(workflow()).run),selected=args.filter(p=>p.endsWith('.test.mjs'));
 for(const name of NATIVE_102_DARWIN_SUITES)assert.equal(selected.filter(p=>p.endsWith('/'+name)).length,0,name+' must run on actual Darwin without Linux skips');
 for(const name of NATIVE_102_PORTABLE_SUITES)assert.equal(selected.filter(p=>p.endsWith('/'+name)).length,1,name+' must remain in the real Linux glob');
 assert.equal(args.filter(p=>p==='scripts/ci/__tests__/native-102-ci-contract.test.mjs').length,1);
 const classified=new Set([...NATIVE_102_DARWIN_SUITES,...NATIVE_102_PORTABLE_SUITES]);
 const family=/^native-(?:102-|collection-|scrcpy-|phone-(?:audio-|collection-|credentials|detail-|managed-|media|processing|test-media))/;
 const actual=readdirSync(new URL('../../../services/phone-adb-controller/__tests__/',import.meta.url)).filter(n=>(family.test(n)||n==='native-queue-terminal-callbacks.test.mjs'||n==='native102-default-credentials.test.mjs')&&n.endsWith('.test.mjs'));
 assert.deepEqual([...classified].sort(),actual.sort(),'every current102 test must have one explicit runnable owner');
 for(const name of PHONE_DARWIN_SUITES)assert.equal(NATIVE_102_DARWIN_SUITES.includes(name),false,'102 must not consume the101/103 budget');
});
test('owned102 driver consumes only its selected suites and preserves explicit nofork and bounded finally stop',async()=>{
 const {NATIVE_102_DARWIN_SUITES}=await import('../native-102-ci-selection.mjs');assert.ok(NATIVE_102_DARWIN_SUITES.includes('native-102-public-executor.test.mjs'));assert.ok(NATIVE_102_DARWIN_SUITES.includes('native-phone-processing-managed.test.mjs'));
 const s=readFileSync(new URL('../native-102-darwin-tests.mjs',import.meta.url),'utf8');assert.match(s,/NATIVE_102_DARWIN_SHARDS\[shard\]/);assert.match(s,/\.\.\.selectedSuites\.map/);assert.match(s,/--test-concurrency=1/);assert.match(s,/ZJ_NATIVE_103_PG_FIXTURE:fixture/);
 for(const pattern of [/deny process-fork/,/os\.fork\(\)/,/nativePhoneTestPilRoot/,/nativePhoneTestMediaBinary/,/finally\s*\{/,/pg\.kill\('SIGTERM'\)/,/pg\.kill\('SIGKILL'\)/,/await Promise\.race\(\[closed/,/if\(stopped\)rmSync/])assert.match(s,pattern);
 assert.doesNotMatch(s,/15532|brew services|process\.kill\(|PHONE_DARWIN_SUITES|phone-lock-clean-bootstrap/);
 assert.equal(s.includes('process.once(\'SIGTERM\''),true);assert.equal(s.includes('process.once(\'SIGINT\''),true);
});
