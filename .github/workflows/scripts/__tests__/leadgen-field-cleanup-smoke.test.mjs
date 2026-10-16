// 只测smoke编排及必需全量门禁；真实业务测试另由原smoke/L3执行。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';

const script=new URL('../smoke/leadgen-field-cleanup-smoke.sh',import.meta.url).pathname;
const expected=['own-accounts-lib','lead-fields-lib','next-outreach-lib','account-current-nickname','video-link-restore'].map(s=>s+'.test.mjs');
function invoke(t,failed=''){
 const dir=mkdtempSync(join(tmpdir(),'field-smoke-wiring-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const trace=join(dir,'trace');
 for(const name of ['node','npx'])writeFileSync(join(dir,name),`#!/bin/sh\nprintf '%s\\n' '${name}' "$@" >> "$FIELD_TRACE"\nif [ "$FIELD_FAILED" = '${name}' ]; then exit 31; fi\n`,{mode:0o755});
 const r=spawnSync('bash',[script],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:dir+':'+process.env.PATH,FIELD_TRACE:trace,FIELD_FAILED:failed}});
 return {...r,trace:readFileSync(trace,'utf8').trim().split('\n')};
}
test('字段smoke实际只调用其五个合同文件，再执行原API映射和字段写入检查',t=>{
 const r=invoke(t);assert.equal(r.status,0,r.stderr);
 const split=r.trace.indexOf('npx');assert.ok(split>0);
 assert.deepEqual(r.trace.slice(2,split).map(s=>basename(s)).sort(),expected.slice().sort());
 assert.equal(r.trace[0],'node');assert.equal(r.trace[1],'--test');
 assert.deepEqual(r.trace.slice(split+1),['vitest','run','tests/p2-sprint-b1-ws4/lead-writer.test.ts','src/services/lead-writer.test.ts']);
 assert.match(r.stdout,/PASS leadgen-field-cleanup-smoke/);
});
test('实际node失败立即传播，API映射测试不运行且不输出PASS',t=>{
 const r=invoke(t,'node');assert.equal(r.status,31);assert.ok(!r.trace.includes('npx'));assert.doesNotMatch(r.stdout,/PASS leadgen-field-cleanup-smoke/);
});
test('实际API映射测试失败同样传播且不输出PASS',t=>{
 const r=invoke(t,'npx');assert.equal(r.status,31);assert.doesNotMatch(r.stdout,/PASS leadgen-field-cleanup-smoke/);
});
const workflow=parse(readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8'));
function fullSuiteRequired(w){
 const job=w.jobs['openclaw-scripts-test'];assert.ok(job&&!job.if);
 const step=job.steps.find(s=>s.run?.includes('run: node --test')||s.run?.startsWith('node --test'));
 assert.ok(step&&!step.if);assert.match(step.run,/services\/phone-adb-controller\/__tests__\/\*\.test\.mjs/);
 assert.doesNotMatch(step.run,/--test-name-pattern|--test-skip-pattern|\|\|\s*true/);
 assert.ok(w.jobs['l3-passed'].needs.includes('openclaw-scripts-test'));
}
function aggregate(w,result){
 const code=w.jobs['l3-passed'].steps[0].run.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g,(_,key)=>key==='needs.openclaw-scripts-test.result'?result:key.includes('.outputs.')?'false':'success');
 return spawnSync('bash',['-c',code],{encoding:'utf8',timeout:5000});
}
test('独立完整phone通配套始终执行且聚合器实际拒绝其失败/取消/跳过',()=>{
 fullSuiteRequired(workflow);assert.equal(aggregate(workflow,'success').status,0);
 for(const result of ['failure','cancelled','skipped'])assert.equal(aggregate(workflow,result).status,1,result);
});
test('全套门禁缺通配/变条件/脱离required/聚合吞错的四类变异均被发现',()=>{
 for(const mutate of [
  w=>{w.jobs['openclaw-scripts-test'].steps.find(s=>s.run?.startsWith('node --test')).run='node --test only-one.test.mjs';},
  w=>{w.jobs['openclaw-scripts-test'].if='false';},
  w=>{w.jobs['l3-passed'].needs=w.jobs['l3-passed'].needs.filter(s=>s!=='openclaw-scripts-test');}
 ]){const w=structuredClone(workflow);mutate(w);assert.throws(()=>fullSuiteRequired(w));}
 const w=structuredClone(workflow);w.jobs['l3-passed'].steps[0].run=w.jobs['l3-passed'].steps[0].run.replaceAll('${{ needs.openclaw-scripts-test.result }}','success');
 assert.equal(aggregate(w,'failure').status,0,'本变异必须真的会吞失败，正常聚合测试能揭露它');
});
