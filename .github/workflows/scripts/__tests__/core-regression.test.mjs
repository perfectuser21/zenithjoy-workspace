import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const runner=join(root,'scripts/ci/run-core-regression.sh');
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'core-regression-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function run(dir,args=[]){return spawnSync('bash',[runner,...args],{cwd:dir,encoding:'utf8',timeout:30000});}
function contract(dir,body){writeFileSync(join(dir,'regression-contract.yaml'),body);}
function standaloneEnv(extra={}){const env={...process.env,...extra};delete env.NODE_TEST_CONTEXT;return env;}
for(const [name,body] of [
 ['empty','golden_paths: []'],
 ['duplicate','golden_paths:\n- {id: same, trigger: [PR], test_command: "true"}\n- {id: same, trigger: [PR], test_command: "true"}'],
 ['missing command','golden_paths:\n- {id: missing, trigger: [PR]}'],
 ['non-string command','golden_paths:\n- {id: bad, trigger: [PR], test_command: true}'],
 ['unknown trigger','golden_paths:\n- {id: bad, trigger: [PR, typo], test_command: "true"}'],
 ['malformed yaml','golden_paths: ['],
])test(`core runner rejects ${name} contract`,t=>{const dir=fixture(t);contract(dir,body);const r=run(dir);assert.notEqual(r.status,0,r.stdout+r.stderr);});
test('unknown tier and unknown argument cannot silently select PR',t=>{
 const dir=fixture(t);contract(dir,'golden_paths:\n- {id: pass, trigger: [PR], test_command: "true"}');
 for(const args of [['--tier','relase'],['--typo'],['--tier'],['--contract']])assert.notEqual(run(dir,args).status,0,JSON.stringify(args));
});
test('runner executes selected commands once, rejects failure and never runs another tier',t=>{
 const dir=fixture(t);contract(dir,'golden_paths:\n- {id: pr, trigger: [PR], test_command: "echo actual >> ran"}\n- {id: release, trigger: [Release], test_command: "exit 99"}');
 assert.equal(run(dir,['--tier','pr']).status,0);
 assert.equal(readFileSync(join(dir,'ran'),'utf8'),'actual\n');
 assert.notEqual(run(dir,['--tier','release']).status,0);
});
test('default core contract executes real regressions and catches a broken publishing coordinator',t=>{
 const dir=fixture(t);
 cpSync(join(root,'regression-contract.yaml'),join(dir,'regression-contract.yaml'));
 for(const path of ['services/listing-workflow','scripts/release-gate']){mkdirSync(resolve(dir,path,'..'),{recursive:true});cpSync(join(root,path),join(dir,path),{recursive:true});}
 // The legacy sentinel scripts are syntactically valid yet always fail at runtime.
 const smoke=join(dir,'.github/workflows/scripts/smoke');mkdirSync(smoke,{recursive:true});
 for(const name of ['golden-path-1-smoke.sh','golden-path-2-smoke.sh'])writeFileSync(join(smoke,name),'#!/bin/sh\nexit 97\n');
 mkdirSync(join(dir,'scripts/ci'),{recursive:true});cpSync(runner,join(dir,'scripts/ci/run-core-regression.sh'));
 const bin=join(dir,'bin');mkdirSync(bin);const marker=join(dir,'executed-tests');
 writeFileSync(join(bin,'node'),`#!/bin/sh\nif [ "$1" = --test ]; then echo "$*" >> '${marker}'; fi\nexec '${process.execPath}' "$@"\n`,{mode:0o755});
 const invoke=(tier='pr')=>spawnSync('bash',[runner,'--tier',tier],{cwd:dir,env:standaloneEnv({PATH:bin+':'+process.env.PATH}),encoding:'utf8',timeout:30000});
 let result=invoke();assert.equal(result.status,0,result.stdout+result.stderr);
 result=invoke('release');assert.equal(result.status,0,result.stdout+result.stderr);
 assert.ok(existsSync(marker),'Core gate must execute business regression tests, rather than only parse smoke syntax');
 const coordinator=join(dir,'services/listing-workflow/coordinator.mjs');
 const source=readFileSync(coordinator,'utf8');
 const changed=source.replace(/export async function coordinate\(([^\n]*)\) \{/,match=>match+' throw new Error("CORE_REGRESSION_MUTANT");');
 assert.notEqual(changed,source,'fixture must alter the real coordinator');writeFileSync(coordinator,changed);
 result=invoke();assert.notEqual(result.status,0,'Broken real business implementation must stop the Core gate: '+result.stdout+result.stderr);
 assert.match(result.stdout+result.stderr,/CORE_REGRESSION_MUTANT/);
 result=invoke('release');assert.notEqual(result.status,0,'Release core gate must reject the same broken implementation');
});
