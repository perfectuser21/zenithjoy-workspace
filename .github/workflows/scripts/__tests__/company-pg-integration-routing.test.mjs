import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
const detector=fileURLToPath(new URL('../../../../scripts/ci/detect-changes.mjs',import.meta.url));
const gate=fileURLToPath(new URL('../../../../scripts/ci/required-gate.mjs',import.meta.url));
function fixture(t,path){
 const dir=mkdtempSync(join(tmpdir(),'company-pg-routing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');mkdirSync(join(dir,'hooks'));git('config','core.hooksPath',join(dir,'hooks'));git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(dir,'baseline'),'base');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),'actual changed input');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
 return{dir,base,head};
}
function detect(f,eventName,profile='integration'){
 const event=eventName==='pull_request'?{pull_request:{base:{sha:f.base},head:{sha:f.head}}}:eventName==='merge_group'?{merge_group:{base_sha:f.base,head_sha:f.head}}:{before:f.base,after:f.head};
 const eventPath=join(f.dir,'event.json'),output=join(f.dir,'output-'+profile+'-'+eventName);writeFileSync(eventPath,JSON.stringify(event));
 const r=spawnSync(process.execPath,[detector,profile],{cwd:f.dir,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:eventName,GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output}});assert.equal(r.status,0,r.stderr);return Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(x=>x.split('=')));
}
for(const path of ['services/phone-adb-controller/company-config-lib.js','services/phone-adb-controller/company-config-readiness.mjs','services/phone-adb-controller/company-config-sync-lib.js','services/phone-adb-controller/__tests__/company-config-postgres.test.mjs','services/phone-adb-controller/__tests__/company-config.test.mjs','services/phone-adb-controller/__tests__/company-config-sync.test.mjs','apps/api/scripts/company-wiki-import.mjs'])for(const event of ['push','pull_request','merge_group'])test(`${event} ${path} selects actual required PG job`,t=>{
 const f=fixture(t,path);assert.equal(detect(f,event).api,'true');
});
test('unrelated phone code may skip PG; phone company changes do not broaden other API profiles',t=>{
 const unrelated=fixture(t,'services/phone-adb-controller/unrelated-runtime.mjs');assert.equal(detect(unrelated,'pull_request').api,'false');
 const company=fixture(t,'services/phone-adb-controller/company-config-lib.js');assert.equal(detect(company,'pull_request','code').api,'false');assert.equal(detect(company,'pull_request','runtime').api,'false');
});
for(const result of ['success','failure','cancelled','skipped','missing'])test(`selected PG child ${result} is correctly admitted/rejected by actual required gate`,t=>{
 const f=fixture(t,'services/phone-adb-controller/company-config-lib.js');const outputs=detect(f,'pull_request');const needs={changes:{result:'success',outputs}};
 if(result!=='missing')needs['api-integration-test']={result};
 const r=spawnSync(process.execPath,[gate,'integration'],{encoding:'utf8',env:{...process.env,GATE_NEEDS:JSON.stringify(needs)}});assert.equal(r.status===0,result==='success',r.stdout+r.stderr);
});

for(const result of ['skipped','missing','failure','cancelled'])test(`unrelated PG child ${result} preserves existing aggregate policy`,t=>{
 const f=fixture(t,'services/phone-adb-controller/unrelated-runtime.mjs');const outputs=detect(f,'pull_request');const needs={changes:{result:'success',outputs}};
 if(result!=='missing')needs['api-integration-test']={result};
 const r=spawnSync(process.execPath,[gate,'integration'],{encoding:'utf8',env:{...process.env,GATE_NEEDS:JSON.stringify(needs)}});assert.equal(r.status===0,['skipped','missing'].includes(result),r.stdout+r.stderr);
});

test('deduplicated paired deployment suite remains selected unconditionally by required L3',()=>{
 const workflow=YAML.parse(readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8'));
 const job=workflow.jobs['openclaw-scripts-test'];assert.equal(job.if,undefined);assert.equal(job.strategy['fail-fast'],false);
 assert.ok(job.steps.some(s=>s.run?.includes('services/phone-adb-controller/__tests__/*.test.mjs')));
 assert.ok(workflow.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
 const smoke=readFileSync(new URL('../smoke/company-wiki-config-smoke.sh',import.meta.url),'utf8');
 assert.equal(smoke.includes("spawnSync('npm'"),false,'no stale API default-Vitest subprocess');
 assert.equal(smoke.includes('CREATE DATABASE'),false,'no second scratch database bootstrap');
});
