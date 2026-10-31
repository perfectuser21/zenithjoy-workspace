import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli=new URL('../listing-driver-cli.mjs',import.meta.url).pathname;
test('CLI help has no runtime loading or device side effects',()=>{
 const r=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});assert.equal(r.status,0);assert.match(r.stdout,/dry-run/);
});
test('CLI loads an explicitly trusted runtime and emits refusal while preserving real readback result',()=>{
 const root=mkdtempSync(join(tmpdir(),'listing-cli-')), marker=join(root,'read.txt');
 const input=join(root,'input.json'), plugin=join(root,'runtime.mjs');
 writeFileSync(input,JSON.stringify({root,businessKey:'one',runId:'one',target:{storeId:'store-one'},payload:{plan:{images:[]}},productionEnabled:true}));
 writeFileSync(plugin,`import{writeFileSync}from'node:fs';export function createRuntime(){return {inspect:async()=>{writeFileSync(${JSON.stringify(marker)},'captured');return{ok:false,evidence:['capture-path'],requiresVisualReview:true}},productionEnabled:false}}`);
 const r=spawnSync(process.execPath,[cli,input,plugin],{encoding:'utf8'});assert.equal(r.status,2,r.stderr);assert.equal(readFileSync(marker,'utf8'),'captured');const result=JSON.parse(r.stdout);assert.equal(result.mode,'dry-run');assert.equal(result.publicationAuthorized,false);assert.ok(result.reasons.includes('UI_CONTRACT_UNVERIFIED'));
});
test('built-in read-only runtime cannot authorize or issue UI writes and never invents store identity',async()=>{
 let api;try{api=await import('../listing-readonly-runtime.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 assert.equal(typeof api?.createReadOnlyRuntime,'function');let capture=0;
 const runtime=api.createReadOnlyRuntime({probeConfig:{serial:'expected'},deviceBinding:{authority:'reviewed'}},{probe:async(config,deps)=>{assert.equal(config.serial,'expected');assert.equal(deps.deviceBinding.authority,'reviewed');capture++;return {status:'observed',manifest:'original-manifest',requiresVisualReview:true};}});
 const observation=await runtime.inspect();assert.equal(capture,1);assert.equal(observation.ok,false);assert.equal(observation.storeId,undefined);assert.equal(runtime.productionEnabled,false);assert.equal((await runtime.authorize()).ok,false);await assert.rejects(runtime.act({operation:'publish'}),/PRODUCTION_GATE_CLOSED/);
});
