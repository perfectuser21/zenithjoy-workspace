import Ajv from 'ajv';
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
  assert.equal(spec.allow_empty,a.failure.empty_ok.length>0);assert.deepEqual(a.runtime.checker_repair,original(101+i).contract.activities.find(x=>x.key===a.key).runtime.checker_repair);
 }
});
test('actual registered B authority drift and incomplete criteria are rejected',()=>{
 const workflow=names[1],p=projectAgentProfile(original(102),{documents,workflow});const changed=structuredClone(documents);changed[workflow].activities.find(x=>x.key==='dedup').postconditions[0].asserts+=' changed';
 assert.throws(()=>verifyAgentProfile(p,{documents:changed,workflow}),/CONTRACT_AUTHORITY_DRIFT/);
 const removed=structuredClone(p);removed.contract.activities[0].acceptance.criteria.pop();removed.profile.leadgen.contract_sha256=digest(removed.contract);assert.throws(()=>verifyAgentProfile(removed,{documents,workflow}),/CONTRACT_ACCEPTANCE_DRIFT/);
 const budget=structuredClone(p);budget.contract.activities[0].budget.max_duration_s++;assert.throws(()=>verifyAgentProfile(budget,{documents,workflow}),/PROFILE_CONTRACT/);
});

test('102 collection projects an explicit stop probe for the independent cleanup window',()=>{
 const workflow=names[1],p=projectAgentProfile(original(102),{documents,workflow});
 assert.deepEqual(p.profile.skill_runtime.activities.collection.stop_checker,
  {command:'@node',entry:'collection-stop-entry.mjs',timeout_ms:45000});
 assert.equal(p.profile.skill_runtime.activities.qualification.stop_checker,undefined);
});

test('101 页签与首屏卡片允许同一次运行的截图证据，同时保留成对的原生 XML',()=>{
 const workflow=names[0], profile=projectAgentProfile(original(101),{documents,workflow});
 const activity=profile.contract.activities.find(candidate=>candidate.key==='collect_videos');
 const validate=new Ajv({strict:true}).compile(activity.acceptance.document.delivery.schema);
 const outputs={Run:{status:'partial',stop_reason:'fixture',all_results_scanned:false},Video:[]};
 const validateRun=run=>validate({outputs,evidence:{run}});
 const common={filters_receipt:'receipts/filter.json',selected_page:'native/selected.png',results_page:'native/results.png'};
 const screenshots={video_page_screenshot:'native/video-tab.png',cards_screenshot:'native/cards.png'};
 const xml={video_page_xml:'native/video-tab.xml',cards_xml:'native/cards.xml'};
 assert.equal(validateRun({...common,...xml}),true);
 assert.equal(validateRun({...common,...screenshots}),true,JSON.stringify(validate.errors));
 assert.equal(validateRun({...common,video_page_screenshot:screenshots.video_page_screenshot}),false);
 assert.equal(validateRun({...common,video_page_xml:xml.video_page_xml,cards_screenshot:screenshots.cards_screenshot}),false);
 assert.equal(validateRun({...common,...screenshots,cards_screenshot:'receipts/summary.json'}),false);
 assert.equal(validateRun({...screenshots,selected_page:common.selected_page,results_page:common.results_page}),false);
});

test('所有工作流的宿主工具注册从各自冻结活动契约投影', () => {
 const byWorkflow={101:'douyin_video_discovery',102:'douyin_video_processing',103:'douyin_comment_scoring',104:'douyin_lead_outreach'};
 for (const [id,workflow] of Object.entries(byWorkflow)) {
  const profile=JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/profiles/'+id+'.json',import.meta.url)));
  const projected=projectAgentProfile(profile,{documents,workflow});
  const expected=[...new Set(projected.contract.activities.flatMap(a=>a.acceptance.document.required_host_tools))].sort();
  assert.ok(projected.contract.activities.every(a=>a.acceptance.document.required_host_tools.length));
  assert.deepEqual(projected.profile.skill_runtime.host_tools.kinds,expected);
 }
});

test('每个注册活动都用已有通用交件协议，产出与证据分开提交', () => {
 for (const [i,workflow] of names.entries()) {
  const profile=projectAgentProfile(original(101+i),{documents,workflow});
  for (const activity of profile.contract.activities) {
   const schema=activity.acceptance.document.delivery?.schema;
   assert.ok(schema?.properties?.outputs && schema.properties.evidence, workflow+'.'+activity.key);
   assert.ok(schema.required.includes('outputs') && schema.required.includes('evidence'));
  }
 }
});

test('101 的已有视频可交写前写后原件并映射到完工报告，空结果可照常交付', () => {
 const workflow=names[0], profile=projectAgentProfile(original(101),{documents,workflow});
 const {delivery}=profile.contract.activities.find(activity=>activity.key==='collect_videos').acceptance.document;
 const validate=new Ajv({strict:true}).compile(delivery.schema);
 const run={filters_receipt:'receipts/filters.json',selected_page:'native/selected.png',results_page:'native/results.png',
  video_page_screenshot:'native/video.png',cards_screenshot:'native/cards.png'};
 const id='7710934084105148379';
 const group={share_xml:'native/share.xml',link_receipt:'receipts/link.json',write_receipt:'receipts/write.json',
  readback_receipt:'receipts/readback.json',prior_state:'receipts/before.json',written_state:'receipts/after.json'};
 const runOutput={status:'completed',stop_reason:'candidate_limit',all_results_scanned:false};
 const outputs={Run:runOutput,Video:[{video_id:id,video_url:'https://www.douyin.com/video/'+id,title:'测试视频',author:'测试作者',
  keyword:'测试关键词',line_key:'fixture',comment_count:0,harvest_batch:'fixture-run',
  discovery_metrics:{digest:'fixture-digest',evidence:{sha256:'fixture-sha256'}}}]};
 assert.equal(validate({outputs,evidence:{run,[id]:group}}),true,JSON.stringify(validate.errors));
 for(const role of ['prior_state','written_state']){
  const incomplete={...group};
  delete incomplete[role];
  assert.equal(validate({outputs,evidence:{run,[id]:incomplete}}),false);
  assert.equal(delivery.report.files[role].role,role);
  for(const check of ['postconditions_3','side_effects_0','idempotency'])assert.ok(delivery.report.criteria[check].includes(role));
 }
 assert.equal(validate({outputs:{Run:{...runOutput,stop_reason:'no_cards'},Video:[]},evidence:{run}}),true,JSON.stringify(validate.errors));
});
