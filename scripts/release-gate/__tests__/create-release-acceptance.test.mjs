import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAcceptance} from '../create-release-acceptance.mjs';
const sha='a'.repeat(40);
const draft=()=>({run_key:'candidate-case',title:'候选验收',gp_id:'gp-1',checks:[{check_key:'S1-c1',kind:'FR',name:'真实产出可读回'}],detail:{tenant_account:'qa',backend_sha:sha,backend_sha_src2:sha,frontend_sha:sha,frontend_sha_src2:sha,spec_sha:'spec-1'}});
test('既有规程与版本戳生成范围冻结的待验收单',()=>{
 const r=prepareAcceptance(draft(),{sha,targets:['api','dashboard']});
 assert.deepEqual(r.detail.release_targets,['api','dashboard']);assert.equal(r.detail.environment,'staging');assert.equal(r.detail.gate_verdict,undefined);assert.equal(r.checks[0].result,undefined);
});
for(const [label,mutate] of [['缺真实版本',x=>delete x.detail.backend_sha],['版本不符',x=>x.detail.frontend_sha='b'.repeat(40)],['无规程',x=>x.checks=[]],['预填绿灯',x=>x.detail.gate_verdict='绿'],['预填结果',x=>x.checks[0].result='通过']])test(label+'拒绝建单',()=>{const x=draft();mutate(x);assert.throws(()=>prepareAcceptance(x,{sha,targets:['api','dashboard']}));});
