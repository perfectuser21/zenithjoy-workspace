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
test('102 qualification verifies capture and current media identity after its executor runs',()=>{
 const a=activity('douyin_video_processing','qualification');
 assert.match(a.preconditions[0],/brain\.get.*result\.foundation_runner\.run\.input\.business\.scope\.qualification_input/);
 assert.match(a.preconditions[0],/实际原生身份、捕获路径与覆盖证据由本 Activity 执行后验收/);
 assert.match(a.preconditions[1],/pg\.rows.*connection\.snapshot_at.*updated_at.*15 分钟/);
 assert.match(a.preconditions[1],/host\.receipts.*current-video-link/);
 assert.match(text(a.postconditions),/本次原生VID、实际授权捕获路径、真实内容覆盖/);
 assert.match(text(a.postconditions),/未核实不得复用，保持原判断run且不重复评分/);
});
test('shared phone cleanup leaves time for device actions and the independent acceptance before the workflow cleanup deadline',()=>{
 const workflow=load('douyin_video_processing');
 const cleanup=workflow.activities.find(a=>a.key==='cleanup');
 assert.equal(cleanup.budget.max_duration_s,480);
 assert.ok(cleanup.budget.max_duration_s*1000 < workflow.runtime.cleanup_timeout_ms);
});
test('102 collection admits verified qualification before creating commenter evidence',()=>{
 const a=activity('douyin_video_processing','collection');
 assert.match(text(a.preconditions),/已独立验收的合法matched及仍有效的本run处理租约/);
 assert.match(text(a.postconditions),/recipientEvidence和返回评论页原件/);
 assert.match(text(a.postconditions),/确切已提交且独立核验的评论可用committed_partial交103/);
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
test('102 dedup keeps persisted collected count separate from the page total',()=>{
 const a=activity('douyin_video_processing','dedup');
 const criterion=a.postconditions.find(item=>item.probe==='dedup_historical_filter_verified');
 assert.match(criterion.asserts,/outputs\.Video的comment_count.*认领后PG只读快照的comment_count逐条相等/);
 assert.match(criterion.asserts,/持久读回的0为有效值/);
 assert.match(criterion.asserts,/原生页面评论总数另作普通或深采策略证据，不填入comment_count/);
});
test('102 dedup uses the transaction row and leaves time for the independent checker',()=>{
 const flow=load('douyin_video_processing');
 const dedup=flow.activities.find(item=>item.key==='dedup');
 const criterion=dedup.postconditions.find(item=>item.probe==='dedup_historical_filter_verified');
 assert.match(criterion.asserts,/claim_videos数据库RETURNING回执/);
 assert.match(criterion.asserts,/inspect_videos不返回该字段.*Checker须以独立PG读回核对/);
 assert.equal(dedup.budget.max_duration_s,780);
 assert.equal(flow.runtime.timeout_ms,2400000);
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
