import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {companyFixture} from './company-config-fixture.mjs';
import {policy as originalPolicy} from './fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url),{queueRequest}=require('../leadgen-queue.js'),native=require('../queued-recipient-evidence.js');
const id='00000000-0000-4000-8000-000000000221',leadId='00000000-0000-4000-8000-000000000222';
const vid='7704584547186793910',url=`https://www.douyin.com/video/${vid}`,batch='partial102',run='partial103',line='yuesheng';
const profile=readFileSync(new URL('./fixtures/honor-ezx-recipient/profile.xml',import.meta.url),'utf8'),returned=readFileSync(new URL('./fixtures/honor-ezx-recipient/returned.xml',import.meta.url),'utf8');
function fixture(){
 const snapshot=companyFixture(line);snapshot.config_status='enabled';snapshot.runtime_config.routing={line_key:line,profiles:['xiaolongxia']};snapshot.runtime_config.comment_scoring=structuredClone(originalPolicy.runtime_config.comment_scoring);
 const account={company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,platform:'douyin',profile:'xiaolongxia',device_serial:'physical-test-device',douyin_id:'source-account',verification_status:'verified',enabled:true};snapshot.runtime_config.platform_accounts=[account];
 const frozen=tag=>({company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,run_id:tag,source_run:null,snapshot:structuredClone(snapshot),task_inputs:tag===batch?{device_binding:{profile:account.profile,device_serial:account.device_serial}}:{}});
 const source=frozen(batch),target=frozen(run),binding={company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,run_id:batch,line_key:line,source_run:null,profile:account.profile,device_serial:account.device_serial,douyin_id:account.douyin_id,verification_status:'verified',enabled:true};
 const prefix=`${batch}-v${vid}-collection`,nickname='测试评论人',body='测试完整评论 首评',douyinId='fixture-account-102';
 const scope={comment_encoding:'canonical',line_key:line,run:batch,source_run:null,video_id:vid,video_url:url,profile:account.profile,douyin_id:douyinId,nickname,comment_body_sha256:native.hash(body),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'};
 const evidence={version:1,receipt_id:'00000000-0000-4000-8000-000000000223',status:'verified',scope,company_binding:binding,raw:{profile,returned},sha256:{profile:native.hash(profile),returned:native.hash(returned)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:scope.video_identity_eid}};
 const video={line_key:line,video_id:vid,video_url:url,title:'AI办公真实教程',harvest_batch:batch,judgment_status:'matched',process_status:'待判定',judgment_config:{company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,run_id:batch}};
 const row={id,line_key:line,harvest_batch:batch,source_video:video.title,source_video_url:url,comment_body:body,nickname,douyin_id:douyinId,profile_url:'https://v.douyin.com/fixture-profile/',recipient_evidence:evidence,collected_at:new Date('2026-11-12T00:00:00Z'),process_status:'待分拣',relevance:null,intent_grade:null,judgment_reason:null,judgment_config:null,dedup_key:'fixture-dedup'};
 const state={source,target,snapshot,video,row,updates:[],modelCalls:0,outbox:[]};
 const client={async query(sql,args=[]){
  if(sql.includes('company_config_runs'))return {rows:[args[0]===batch?state.source:state.target]};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:sql.includes("process_status='评论已采'")?[]:[state.video]};
  if(sql.includes('FROM zenithjoy.leadgen_comments')){
   if(sql.includes('FOR UPDATE SKIP LOCKED')&&((Array.isArray(args[2])&&args[2].includes(id))||(sql.includes('relevance IS NULL')?state.row.relevance!==null:state.row.relevance===null)))return {rows:[]};
   return {rows:[structuredClone(state.row)]};
  }
  if(sql.includes('UPDATE zenithjoy.leadgen_comments')){
   state.updates.push({sql,args});
   if(sql.includes('SET relevance='))Object.assign(state.row,{relevance:args[1],intent_grade:args[2],judgment_reason:args[3],judgment_config:JSON.parse(args[4])});
   else if(sql.includes('SET recipient_evidence='))state.row.recipient_evidence=JSON.parse(args[1]);
   else if(sql.includes("SET process_status = '已分拣'"))state.row.process_status='已分拣';
   return {rowCount:1,rows:[structuredClone(state.row)]};
  }
  if(sql.includes('INSERT INTO zenithjoy.leadgen_leads')){state.leadCreated=true;return {rows:[{id:leadId,created:true}]};}
  if(sql.includes('FROM zenithjoy.leadgen_leads'))return {rows:state.leadCreated?[{id:leadId,line_key:line,douyin_id:state.row.douyin_id,dup_hit_count:0}]:[]};
  if(sql.includes('INSERT INTO zenithjoy.leadgen_bridge_outbox')){state.outbox.push({id:'fixture-outbox',line_key:args[0],comment_id:args[1],lead_id:args[2],run_tag:args[3],source_run:args[4],payload:JSON.parse(args[5]),payload_sha256:args[6],qualification_status:args[7]});return {rowCount:1,rows:[]};}
  if(sql.includes('FROM zenithjoy.leadgen_bridge_outbox'))return {rows:state.outbox};
  return {rows:[]};
 },release(){}};
 state.pool={query:client.query.bind(client),connect:async()=>client};
 state.deps={freezeCompanyConfig:async()=>structuredClone(state.target.snapshot),judgeComment:async()=>{state.modelCalls++;return {grade:'A',relevance:'相关',reason:'本人业务需求',audit:{model:'google/gemini-2.5-flash',response_id:'actual-fixture-response',stage:'single'}};}};
 state.input=op=>({op,line,run,ids:[id],sources:{[id]:batch},committed_partial_ids:[id],limit:1});
 return state;
}

test('explicit verified committed partial comment scores once before video is exhausted',async()=>{
 const f=fixture();const r=await queueRequest(f.pool,f.input('score'),f.deps);assert.equal(r.scored,1);assert.equal(f.modelCalls,1);assert.equal(f.video.process_status,'待判定');assert.equal(f.row.judgment_config.scoring_mode,'single-evaluation-v1');
});
test('explicit committed scope returns exact IDs and does not select unready ordinary rows',async()=>{
 const f=fixture();const r=await queueRequest(f.pool,f.input('score_scope'));assert.deepEqual(r.ids,[id]);assert.equal(r.sources[id],batch);
});
test('committed score, policy, mark and readback share strict admission without more models',async()=>{
 const f=fixture();await queueRequest(f.pool,f.input('score'),f.deps);
 const review=await queueRequest(f.pool,{...f.input('policy_review'),claim:run});assert.equal(review.verified,true);
 const back=await queueRequest(f.pool,f.input('score_readback'));assert.equal(back.verified,true);
 const marked=await queueRequest(f.pool,f.input('mark_leads'),f.deps);assert.equal(marked.marked,1);assert.equal(marked.created,1);assert.equal(f.outbox[0].qualification_status,'passed');assert.deepEqual(f.outbox[0].payload.committed_partial_ids,[id]);
 const final=await queueRequest(f.pool,{...f.input('mark_readback'),lead_ids:[leadId]});assert.equal(final.verified,true);assert.equal(f.modelCalls,1);assert.equal(f.video.process_status,'待判定');
});
for(const [name,change] of [
 ['unknown证据',f=>f.row.recipient_evidence.status='unknown'],
 ['错UID',f=>f.row.douyin_id='another-user'],
 ['错昵称',f=>f.row.nickname='另一用户'],
 ['错正文',f=>f.row.comment_body='不同正文'],
 ['错视频URL',f=>f.row.source_video_url='https://www.douyin.com/video/7704584547186793911'],
 ['错VID',f=>f.video.video_id='7704584547186793911'],
 ['错批次',f=>f.row.harvest_batch='other102'],
 ['错视频批次',f=>f.video.harvest_batch='other102'],
 ['错视频标题',f=>f.video.title='另一个视频'],
 ['不合格视频',f=>f.video.judgment_status='rejected'],
 ['错公司',f=>f.target.snapshot.company_id='other-company'],
 ['错租户',f=>f.target.tenant_id='other-tenant'],
 ['错版本',f=>f.target.version=99],
 ['错政策',f=>f.target.snapshot.policy_id='other-policy'],
 ['错评分规矩',f=>f.target.snapshot.runtime_config.comment_scoring.criteria.A='另一套规矩'],
 ['无公司绑定',f=>delete f.row.recipient_evidence.company_binding],
 ['无同VID实屏证明',f=>f.row.recipient_evidence.video_identity.verified=false],
 ['错误账号绑定',f=>f.source.snapshot.runtime_config.platform_accounts[0].douyin_id='other-source-account'],
 ['错误原件SHA',f=>f.row.recipient_evidence.sha256.returned='0'.repeat(64)],
])test('committed partial rejects '+name+' before any model call',async()=>{const f=fixture();change(f);await assert.rejects(queueRequest(f.pool,f.input('score'),f.deps),/COMMITTED_PARTIAL|COMPANY_COLLECTION|RECIPIENT_/);assert.equal(f.modelCalls,0);assert.equal(f.updates.length,0);});
test('ordinary mode never implicitly admits a partial video',async()=>{const f=fixture();const x=f.input('score');delete x.committed_partial_ids;const r=await queueRequest(f.pool,x,f.deps);assert.equal(r.scored,0);assert.equal(r.blocked_reasons[0].code,'POLICY_VIDEO_SCOPE_INVALID');assert.equal(f.modelCalls,0);});
test('formal source-run cannot opt into ordinary committed-partial admission',async()=>{const f=fixture();await assert.rejects(queueRequest(f.pool,{...f.input('score'),source_run:batch},f.deps),/COMMITTED_PARTIAL/);assert.equal(f.modelCalls,0);});
test('explicit opt-in cannot score another ID outside the admitted set',async()=>{const f=fixture();await assert.rejects(queueRequest(f.pool,{...f.input('score'),ids:[leadId],sources:{[leadId]:batch}},f.deps),/COMMITTED_PARTIAL/);assert.equal(f.modelCalls,0);});

test('certification upgrades only original unscored owned comment evidence and reads it back',async()=>{
 const f=fixture(),proof=structuredClone(f.row.recipient_evidence);f.row.recipient_evidence={status:'unknown'};f.video.process_status=`处理中:${batch}`;
 const comment={nickname:f.row.nickname,douyinId:f.row.douyin_id,commentBody:f.row.comment_body,profileUrl:f.row.profile_url,sourceVideo:f.row.source_video,sourceVideoUrl:url,recipientEvidence:proof};
 const req={op:'certify_collected_comment',line,run:batch,video_id:vid,video_url:url,comment_id:id,comment};
 const r=await queueRequest(f.pool,req);assert.equal(r.certified,1);assert.equal(r.id,id);assert.equal(f.row.recipient_evidence.status,'verified');assert.equal(f.updates.length,1);assert.match(f.updates[0].sql,/SET recipient_evidence=/);assert.equal(f.video.process_status,`处理中:${batch}`);assert.equal(f.modelCalls,0);
 const back=await queueRequest(f.pool,{op:'certify_collected_comment_readback',line,run:batch,video_id:vid,comment_id:id});assert.equal(back.verified,true);assert.equal(back.id,id);
});
for(const [name,change] of [
 ['其它run',f=>f.row.harvest_batch='other102'],
 ['错UID',f=>f.row.douyin_id='other-user'],
 ['已有评分',f=>f.row.relevance='不相关'],
 ['已有评分配置',f=>f.row.judgment_config={run_id:run}],
 ['未持有视频',f=>f.video.process_status='待判定'],
 ['错公司',f=>f.source.snapshot.company_id='other-company'],
])test('certification never overwrites '+name,async()=>{const f=fixture(),proof=structuredClone(f.row.recipient_evidence);f.row.recipient_evidence={status:'unknown'};f.video.process_status=`处理中:${batch}`;const comment={nickname:f.row.nickname,douyinId:f.row.douyin_id,commentBody:f.row.comment_body,profileUrl:f.row.profile_url,sourceVideo:f.row.source_video,sourceVideoUrl:url,recipientEvidence:proof};change(f);await assert.rejects(queueRequest(f.pool,{op:'certify_collected_comment',line,run:batch,video_id:vid,video_url:url,comment_id:id,comment}),/COMMITTED_PARTIAL|RECIPIENT_|COMPANY_COLLECTION/);assert.equal(f.updates.length,0);});

test('certification is idempotent and never replaces an already verified receipt',async()=>{
 const f=fixture();f.video.process_status=`处理中:${batch}`;
 const comment={nickname:f.row.nickname,douyinId:f.row.douyin_id,commentBody:f.row.comment_body,profileUrl:f.row.profile_url,sourceVideo:f.row.source_video,sourceVideoUrl:url,recipientEvidence:structuredClone(f.row.recipient_evidence)};
 const input={op:'certify_collected_comment',line,run:batch,video_id:vid,video_url:url,comment_id:id,comment};
 assert.equal((await queueRequest(f.pool,input)).already_certified,true);assert.equal(f.updates.length,0);
 comment.recipientEvidence.receipt_id='00000000-0000-4000-8000-000000000224';await assert.rejects(queueRequest(f.pool,input),/ALREADY_CERTIFIED/);assert.equal(f.updates.length,0);
});
for(const [name,change] of [
 ['body',c=>c.commentBody='wrong'],['UID',c=>c.douyinId='other'],['nickname',c=>c.nickname='other'],
 ['profile URL',c=>c.profileUrl='https://v.douyin.com/other/'],['video URL',c=>c.sourceVideoUrl=url+'1'],['video title',c=>c.sourceVideo='other'],
 ['unknown new proof',c=>c.recipientEvidence.status='unknown'],['wrong native UID',c=>{c.recipientEvidence.raw.profile=c.recipientEvidence.raw.profile.replace('fixture-account-102','other-native-account');c.recipientEvidence.sha256.profile=native.hash(c.recipientEvidence.raw.profile);}],
])test('certification rejects changed input '+name,async()=>{
 const f=fixture(),proof=structuredClone(f.row.recipient_evidence);f.row.recipient_evidence={status:'unknown'};f.video.process_status=`处理中:${batch}`;
 const comment={nickname:f.row.nickname,douyinId:f.row.douyin_id,commentBody:f.row.comment_body,profileUrl:f.row.profile_url,sourceVideo:f.row.source_video,sourceVideoUrl:url,recipientEvidence:proof};change(comment);
 await assert.rejects(queueRequest(f.pool,{op:'certify_collected_comment',line,run:batch,video_id:vid,video_url:url,comment_id:id,comment}),/COMMITTED_PARTIAL|RECIPIENT_/);assert.equal(f.updates.length,0);
});
test('changing certified identity after a score blocks policy, mark and readback without another model',async()=>{
 const f=fixture();await queueRequest(f.pool,f.input('score'),f.deps);f.row.douyin_id='changed';
 for(const op of ['policy_review','mark_leads','score_readback','mark_readback','score_recovery'])await assert.rejects(queueRequest(f.pool,{...f.input(op),claim:run},f.deps),/COMMITTED_PARTIAL|RECIPIENT_/);
 assert.equal(f.modelCalls,1);assert.equal(f.outbox.length,0);
});
test('persisted bridge review propagates ordinary exact partial scope and rechecks original proof',async()=>{
 const f=fixture();await queueRequest(f.pool,f.input('score'),f.deps);await queueRequest(f.pool,f.input('mark_leads'),f.deps);
 const payload=f.outbox[0].payload,binding={run:payload.run,scoring_run:payload.scoring_run,source_run:payload.comment_run,source_video:payload.source_video,source_video_url:payload.source_video_url,committed_partial_ids:payload.committed_partial_ids};
 const review=require('../leadgen-queue.js').reviewBoundComment;assert.equal((await review(f.pool,line,id,binding)).status,'pass');assert.equal(f.modelCalls,1);
 f.row.recipient_evidence.status='unknown';assert.equal((await review(f.pool,line,id,binding)).status,'unknown');assert.equal(f.modelCalls,1);
});

function recoveryFixture(){const f=fixture(),audience=f.snapshot.runtime_config.comment_scoring.audiences[0],full=audience.fields['人群描述'];const grant={line,run,id,source_run:batch,company_id:f.snapshot.company_id,tenant_id:f.snapshot.tenant_id,version_number:f.snapshot.version,policy_id:f.snapshot.policy_id,response_id:'gen-existing-response',root_task_id:'root-fixture',scoring_task_id:'task-fixture',producer_source_commit:'d'.repeat(40),audit_sha256:'a'.repeat(64),input_sha256:'b'.repeat(64)};const answer={grade:'B',policy_evidence:{audience_id:audience.id,matched_rule:'原始回答描述：'+full,comment_signal:f.row.comment_body,video_signal:null,exclusion_rule:null,reason:'原始业务判断'}};const archive={answer,audit:{raw:JSON.stringify(answer)}};const original=f.pool.query;f.pool.query=async(sql,args)=>sql.includes("judgment_config->'model_audit'")?{rows:f.usedResponse?[{id}]:[]}:original(sql,args);return {f,grant,archive,generation:{id:grant.response_id,model:'google/gemini-2.5-flash',finish_reason:'stop'}};}
test('archived response persistence preserves existing B and exact identity without any model',async()=>{const c=recoveryFixture();const r=await require('../leadgen-response-recovery.js').applyRecoveredResponse(c.f.pool,c);assert.equal(r.scored,1);assert.equal(r.model_call_count,0);assert.equal(c.f.modelCalls,0);assert.equal(c.f.row.intent_grade,'B');assert.equal(c.f.row.judgment_config.model_audit.response_id,c.grant.response_id);assert.equal(c.f.row.judgment_config.model_audit.policy_evidence.matched_rule,c.f.snapshot.runtime_config.comment_scoring.audiences[0].fields.人群描述);assert.equal(c.f.row.judgment_config.model_audit.response_recovery.request_signature,false);assert.equal((await queueRequest(c.f.pool,{...c.f.input('policy_review'),claim:run})).verified,true);});
for(const [name,change] of [['wrong company',c=>c.grant.company_id='wrong'],['wrong id',c=>c.grant.id='wrong'],['scored row',c=>c.f.row.relevance='相关'],['replay',c=>c.f.usedResponse=true],['unknown recipient',c=>c.f.row.recipient_evidence.status='unknown'],['fake reference',c=>c.archive.answer.policy_evidence.matched_rule='无原业务字段的新描述'],['wrong comment quote',c=>c.archive.answer.policy_evidence.comment_signal='假原文'],['wrong video',c=>c.f.row.source_video='错视频']])test('archived response refuses '+name,async()=>{const c=recoveryFixture();change(c);await assert.rejects(require('../leadgen-response-recovery.js').applyRecoveredResponse(c.f.pool,c),/RESPONSE_RECOVERY_|COMMITTED_PARTIAL_|RECIPIENT_/);assert.equal(c.f.updates.length,0);assert.equal(c.f.modelCalls,0);});
