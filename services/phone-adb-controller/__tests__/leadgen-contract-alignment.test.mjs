import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {fileURLToPath}from'node:url';import {parse}from'yaml';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const load=flow=>parse(fs.readFileSync(root+'product-map/contracts/'+flow+'.yaml','utf8'));
const activity=(flow,key)=>load(flow).activities.find(a=>a.key===key);
const text=x=>JSON.stringify(x);
test('qualification keeps technical/no-speech unknown distinct from a policy rejection',()=>{
 const a=activity('douyin_video_processing','qualification');
 assert.doesNotMatch(text(a.preconditions),/SDK[≥>=]|SDK31|SDK32/);
 assert.doesNotMatch(text(a.steps),/空\/静音 → rejected|静音.*PG拒绝|真实媒体时长 ≥ 预算的 80%/);
 assert.match(text(a.postconditions),/no_speech/);assert.match(text(a.postconditions),/unknown/);
});
test('103 explicitly accepts validated partial IDs without requiring the entire 102 run to pass',()=>{
 for(const key of ['scoring','mark_leads']){
  const a=activity('douyin_comment_scoring',key);assert.match(text(a.preconditions),/committed_partial/);
  assert.doesNotMatch(text(a.preconditions),/金诺102[gd]|失败102不得推进|104云profile仍未获授权/);
 }
});
test('104 write-back retains both real PG and Feishu obligations, never reuses send-admission conditions',()=>{
 const a=activity('douyin_lead_outreach','write_back');assert.match(text(a.postconditions),/PG/);assert.match(text(a.postconditions),/Feishu/);
 assert.doesNotMatch(text(a.preconditions),/发送账号可用|话术库有可用话术/);
});
test('cleanup permits legitimate empty work and protects unresolved prepared side effects',()=>{
 for(const flow of ['douyin_video_processing','douyin_lead_outreach']){
  const a=activity(flow,'cleanup');assert.doesNotMatch(text(a.steps),/n_items>0/);assert.match(text(a.postconditions),/unknown|未知/);
 }
});
test('dedup source proof does not implicitly grant the special producer descriptor path',()=>{
 const a=activity('douyin_video_processing','dedup');assert.match(text(a.preconditions),/input_provenance/);assert.match(text(a.preconditions),/producer_descriptor/);assert.match(text(a.postconditions),/认领/);
});
