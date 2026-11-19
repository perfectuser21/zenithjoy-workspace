import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{spawnSync}from'node:child_process';import Ajv from'ajv/dist/2020.js';
import{loadContractsFromDisk}from'../contracts-lib.mjs';import{planFor,foundationPlan}from'../wf-plan.mjs';
test('agent activity runtime has the existing worker protocol and no legacy script entry',()=>{
 const s=JSON.parse(fs.readFileSync(new URL('../../../product-map/contracts/activity-contract.schema.json',import.meta.url)));
 const validate=new Ajv({strict:false}).compile(s.$defs.runtime);
 assert.equal(validate({phase:'source',entry:'services/phone-adb-controller/leadgen-foundation/worker.mjs',executor_kind:'agent',protocol:'json-stdio-v1'}),true);
 assert.equal(validate({phase:'source',entry:'legacy.sh'}),true);
 assert.equal(validate({phase:'source',entry:'other.mjs',executor_kind:'agent',protocol:'json-stdio-v1'}),false);
});
test('Foundation cannot execute through wf-run, while legacy sh planning remains valid',()=>{
 const c=loadContractsFromDisk();const r=planFor(c,'douyin_video_processing',{allowMissing:true});assert.equal(r.ok,false);assert.match(r.errors.join(' '),/FOUNDATION_API_ONLY/);assert.equal(r.env,undefined);
 const shell=spawnSync('/bin/sh',['-c',foundationPlan('douyin_video_processing')+'\nprintf forbidden'],{encoding:'utf8'});assert.equal(shell.status,64);assert.equal(shell.stdout,'');
 assert.equal(planFor(c,'keyword_acquisition',{allowMissing:true}).ok,true);
});
