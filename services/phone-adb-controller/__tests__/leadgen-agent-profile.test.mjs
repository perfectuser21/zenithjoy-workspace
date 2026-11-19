import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{fileURLToPath}from'node:url';import{parse}from'yaml';
import{createHash}from'node:crypto';
import{projectAgentProfile,verifyAgentProfile}from'../leadgen-foundation/profile-contract.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),names=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const documents=Object.fromEntries(names.map(n=>[n,parse(fs.readFileSync(root+'product-map/contracts/'+n+'.yaml','utf8'))]));
const digest=x=>createHash('sha256').update(JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const original=i=>JSON.parse(fs.readFileSync(root+'services/phone-adb-controller/leadgen-foundation/profiles/'+i+'.json'));
for(const [i,workflow]of names.entries())test('Workflow '+(101+i)+' derives its entire acceptance and budget from the actual authority',()=>{
 const p=projectAgentProfile(original(101+i),{documents,workflow});assert.equal(verifyAgentProfile(p,{documents,workflow}),true);
 for(const [n,a]of p.contract.activities.entries()){
  assert.equal(a.order,n+1);assert.deepEqual(a.budget,a.acceptance.document.budget);assert.deepEqual(a.failure,a.acceptance.document.failure);
  assert.ok(a.acceptance.criteria.some(x=>x.source_pointer.startsWith('/outputs/')));const spec=p.profile.skill_runtime.activities[a.key];
  assert.equal(spec.checker.mode,'agent');assert.equal(spec.checker.entry,undefined);assert.equal(spec.checker.required_checks,undefined);
  assert.equal(spec.allow_empty,a.failure.empty_ok.length>0);assert.equal(a.runtime.checker_repair,original(101+i).contract.activities.find(x=>x.key===a.key).runtime.checker_repair);
 }
});
test('actual registered B authority drift and incomplete criteria are rejected',()=>{
 const workflow=names[1],p=projectAgentProfile(original(102),{documents,workflow});const changed=structuredClone(documents);changed[workflow].activities.find(x=>x.key==='dedup').postconditions[0].asserts+=' changed';
 assert.throws(()=>verifyAgentProfile(p,{documents:changed,workflow}),/CONTRACT_AUTHORITY_DRIFT/);
 const removed=structuredClone(p);removed.contract.activities[0].acceptance.criteria.pop();removed.profile.leadgen.contract_sha256=digest(removed.contract);assert.throws(()=>verifyAgentProfile(removed,{documents,workflow}),/CONTRACT_ACCEPTANCE_DRIFT/);
 const budget=structuredClone(p);budget.contract.activities[0].budget.max_duration_s++;assert.throws(()=>verifyAgentProfile(budget,{documents,workflow}),/PROFILE_CONTRACT/);
});
