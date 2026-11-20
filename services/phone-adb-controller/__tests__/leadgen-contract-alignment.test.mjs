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
test('scoring deduplicates exact comment IDs rather than merging people into Leads',()=>{
 const a=activity('douyin_comment_scoring','scoring');assert.equal(a.idempotency.dedupe_key,'Comment.line_key+Comment.id');assert.notEqual(a.idempotency.on_duplicate,'merge');
});
test('104 failures never implicitly requeue a prepared or unknown send',()=>{
 for(const key of ['send_dm','write_back']){const a=activity('douyin_lead_outreach',key);assert.doesNotMatch(text(a.failure),/两轮后|连续3次|软熔断2小时/);assert.match(text(a.failure),/prepared/);assert.match(text(a.failure),/未知/);}
 assert.doesNotMatch(text(activity('douyin_lead_outreach','write_back').failure),/device_ui|NO_SCRIPT/);
});
test('collection acceptance retains author and own-account filtering independently of legacy step checks',()=>{
 const a=activity('douyin_video_processing','collection');assert.match(text(a.postconditions),/作者UID/);assert.match(text(a.postconditions),/自有账号/);
});

test('101 and 102 use the shared preflight lock check with original tool receipts and independent status',()=>{
 const discover=activity('douyin_video_discovery','preflight')
   ?? load('douyin_video_discovery').activities.find(item=>item.ref==='douyin_video_processing.preflight');
 assert.equal(discover.ref,'douyin_video_processing.preflight');
 const lock=activity('douyin_video_processing','preflight').postconditions.find(item=>item.probe==='pf_lock_acquired');
 assert.match(lock.asserts,/宿主工具取得回执/);
 assert.match(lock.asserts,/native\.read/);
 assert.match(lock.asserts,/brain\.get\(device_lock\)/);
 assert.match(lock.asserts,/不是本 run 下的 native\//);
 assert.match(lock.asserts,/身份不符或锁已过期则不得通过/);
});
