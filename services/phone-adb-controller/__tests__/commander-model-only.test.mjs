import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseCommanderResponse} from '../activity-commander.mjs';
import {commanderModelReceipt} from '../commander-model-receipt.mjs';
const modulePath=fileURLToPath(new URL('../activity-commander.mjs',import.meta.url));
const fixturePath=fileURLToPath(new URL('./fixtures/commander-gateway-cli.cjs',import.meta.url));
const driver=fileURLToPath(new URL('./fixtures/commander-gateway-driver.mjs',import.meta.url));
const contract=JSON.parse(readFileSync(new URL('./fixtures/commander-gateway-contract.json',import.meta.url)));
const scope={workflow_key:'douyin_video_discovery',run_id:'commander-model-only__a1',binding_id:'binding-fixed',task_id:null,source_commit:'a'.repeat(40),activity:'cleanup',phase:'after'};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";

function run(t,mode,{turns=1,model}={}){
 const home=mkdtempSync(join(tmpdir(),'commander-model-only-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const bin=join(home,'bin');mkdirSync(bin);writeFileSync(join(home,'contract.json'),JSON.stringify(contract));
 writeFileSync(join(bin,'openclaw'),'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(fixturePath)+' "$@"\n',{mode:0o700});
 return JSON.parse(execFileSync(process.execPath,[driver,modulePath,JSON.stringify(scope),String(turns)],{env:{...process.env,PATH:bin,CASE_HOME:home,CASE_MODE:mode,...(model?{CASE_MODEL:model}:{})},encoding:'utf8',timeout:10000}));
}
test('现役Gateway真实封套兼容decision与供应商回执，accepted绝不冒final',()=>{
 assert.equal(parseCommanderResponse(contract.final).action,'finish');
 assert.equal(commanderModelReceipt(JSON.stringify(contract.final),scope).openclaw.run_id,'gateway-run');
 assert.throws(()=>parseCommanderResponse(contract.accepted));assert.throws(()=>parseCommanderResponse(contract.timeout));
});
test('真实CLI仅正式modelRun请求成功且保同owner/low/60s/expect-final',t=>{
 const r=run(t,'ok');assert.equal(r.outputs.length,1);assert.equal(r.available,true);
 const a=r.calls[0],p=JSON.parse(a[a.indexOf('--params')+1]);assert.deepEqual(a.slice(0,3),['gateway','call','agent']);
 assert.equal(p.modelRun,true);assert.equal(p.agentId,'work-commander');assert.equal(p.sessionKey,r.owner);assert.equal(p.thinking,'low');assert.equal(p.timeout,60);
 assert.ok(a.includes('--expect-final'));assert.ok(a.includes('--json'));assert.equal(a[a.indexOf('--timeout')+1],'65000');assert.equal(r.calls.length,1);
 assert.match(p.idempotencyKey,/^[0-9a-f-]{36}$/);assert.ok(p.message.includes(scope.run_id));assert.ok(p.message.includes('"phase":"after"'));
});
test('同Workflow两次实际判读保owner而每turn仅一个新idempotencyKey',t=>{
 const r=run(t,'ok',{turns:2});assert.equal(r.outputs.length,2);
 const p=r.calls.map(a=>JSON.parse(a[a.indexOf('--params')+1]));assert.equal(p[0].sessionKey,p[1].sessionKey);assert.notEqual(p[0].idempotencyKey,p[1].idempotencyKey);assert.equal(r.calls.length,2);
});
test('模型override通过Gateway正式字段传入而不改共享配置',t=>{
 const r=run(t,'ok',{model:'openai/gpt-6.1-sol'});assert.equal(r.outputs.length,1);const a=r.calls[0],p=JSON.parse(a[a.indexOf('--params')+1]);assert.equal(p.model,'openai/gpt-6.1-sol');
});
for(const mode of ['accepted','timeout','invalid','exit','signal'])test('真实CLI '+mode+' 保unknown/pending且不自动重发',t=>{
 const r=run(t,mode);assert.equal(r.outputs.length,0);assert.equal(r.available,false);assert.equal(r.error.executionStopped,false);assert.equal(r.calls.length,1);
 assert.doesNotMatch(JSON.stringify(r.error),/sensitive-sentinel|raw args environment/);
});
for(const mode of ['wrong-run','wrong-session','foreign-consistent'])test('真实final '+mode+' 身份冲突不能释放owner pending',t=>{
 const r=run(t,mode);assert.equal(r.outputs.length,0);assert.equal(r.available,false);assert.equal(r.error.executionStopped,false);assert.equal(r.calls.length,1);
});
test('原失败仅保固定诊断字段不泄漏原stderr/argv，且写入Activity事件',async t=>{
 const r=run(t,'exit');assert.equal(r.error.diagnostic.phase,'after');assert.equal(r.error.diagnostic.run_id,scope.run_id);
 assert.match(r.error.diagnostic.gateway_run_id,/^[0-9a-f-]{36}$/);assert.equal(r.error.diagnostic.status,'transport_error');assert.ok(Number.isFinite(r.error.diagnostic.elapsed_ms));assert.equal(r.error.diagnostic.timeout_ms,60000);
 assert.deepEqual(Object.keys(r.error.diagnostic).sort(),['activity','elapsed_ms','gateway_run_id','phase','run_id','status','timeout_ms']);
 const {runActivity}=await import('../activity-commander.mjs');const events=[];
 const e=Error('COMMANDER_UNAVAILABLE');e.executionStopped=false;e.commanderDiagnostic=r.error.diagnostic;
 await assert.rejects(runActivity({activity:{key:'cleanup'},context:scope,commander:async()=>{throw e;},execute:async()=>assert.fail('must not start'),record:async e=>events.push(e)}));
 assert.deepEqual(events[0].commander_diagnostic,r.error.diagnostic);
});

test('跨RPC通用错误仍在原owner账本留下本次固定诊断旁证，绝不作为returned',t=>{
 const r=run(t,'exit');assert.equal(r.available,false);assert.equal(r.diagnostics.length,1);
 const d=r.diagnostics[0];assert.match(d.name,/\.[0-9a-f-]{36}\.diagnostic\.json$/);
 assert.equal(d.value.protocol,'commander-diagnostic-v1');assert.deepEqual(d.value.scope,scope);
 assert.deepEqual(d.value.diagnostic,r.error.diagnostic);assert.doesNotMatch(JSON.stringify(d),/sensitive-sentinel|--params|message|environment/);
});
