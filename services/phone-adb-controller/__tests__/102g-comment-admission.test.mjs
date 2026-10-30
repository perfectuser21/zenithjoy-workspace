import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {queueRequest:queueDirect}=require('../leadgen-queue.js');
const admission=require('../leadgen-comment-admission.js');
const {buildObservation}=require('../discovery-metrics.js');
const {hash:byteHash}=require('../queued-recipient-evidence.js');
const {companyFixture}=await import('./company-config-fixture.mjs');
const run='accept3a903_jinuo102g_20261030t0712';
const candidate='c'.repeat(40);
const queueRequest=(pool,input,deps={})=>queueDirect(pool,input,{sourceCommit:candidate,...deps});
const videoId='7699489394579915663';
const ids=[
  '818dc556-0d01-409a-9b08-4d458e4a7bc1',
  '4d1375d8-7ef2-4393-a3ec-c56897f7d045',
  '8d95a060-25a0-4438-a5ad-c5bd91729883',
];

test('102g失败视频和三条已提交评论默认仍不可进入103',async()=>{
  const calls=[];
  const pool={async query(sql,args){calls.push({sql,args});return {rows:[]};}};
  const scope=await queueRequest(pool,{op:'score_scope',line:'jinuo',run:'approved103',source_run:run});
  assert.deepEqual(scope.ids,[]);
  assert.match(calls[0].sql,/zenithjoy\.db_audit/);
  assert.equal(calls.some(c=>/UPDATE|INSERT|DELETE/.test(c.sql)),false);
});

const company='ef8e14b0-4018-4e54-bc7a-866e51a0ce0b';
const tenant='a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61';
const source101='accept3a903_jinuo101f_20261030t0700';
const input={op:'admit_102g_comments',line:'jinuo',run:'accept103_102g_exact_a1',source_run:run,
  video_id:videoId,decision_id:'11111111-1111-4111-8111-111111111111',
  maintenance_task_id:'22222222-2222-4222-8222-222222222222',candidate_source_commit:candidate};
const video={line_key:'jinuo',video_id:videoId,video_url:`https://www.douyin.com/video/${videoId}`,
  title:'人工智能训练师报名',harvest_batch:run,process_status:`待人工核验:${run}`,judgment_status:'matched',
  judgment_config:{company_id:company,tenant_id:tenant,version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1',run_id:run}};
test('101l 原生证据复用只保留原102g来源与三评论精确边界',()=>{
  const reusedRun='accept6cc22_jinuo101l_20261031T0022';
  const xml='<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢2，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论3，按钮"/></hierarchy>';
  const observed=buildObservation({run:reusedRun,run_id:`douyin_video_discovery-${reusedRun}__a1`,
    profile:'jinoshengyuan-work',source_commit:'6cc22d9d929a591ffb4aacb40a3d153902f6ab8e',
    line_key:'jinuo',video_id:videoId,video_url:video.video_url,
    observed_at:'2026-10-30T16:31:00.289Z',evidence_id:`${reusedRun}-candidate1-link-t1`,xml});
  const reused={...structuredClone(video),harvest_batch:reusedRun,
    discovery_metrics:{...observed,company_binding:{company_id:company,tenant_id:tenant,version:14,line_key:'jinuo',run_id:reusedRun}}};
  assert.doesNotThrow(()=>admission.checkVideo(reused,{reuseDigest:observed.digest}));
  for(const changed of [
    {...reused,harvest_batch:'another101'},
    {...reused,discovery_metrics:{...reused.discovery_metrics,digest:'0'.repeat(64)}},
    {...reused,discovery_metrics:{...reused.discovery_metrics,evidence:{...reused.discovery_metrics.evidence,xml:xml.replace('评论3','评论4')}}},
    {...reused,judgment_config:{...reused.judgment_config,run_id:reusedRun}},
    {...reused,discovery_metrics:{...reused.discovery_metrics,source_commit:'f'.repeat(40)}},
    {...reused,discovery_metrics:{...reused.discovery_metrics,company_binding:{...reused.discovery_metrics.company_binding,tenant_id:'other'}}},
  ])assert.throws(()=>admission.checkVideo(changed,{reuseDigest:observed.digest}),/ADMISSION_VIDEO_SCOPE_INVALID/);
});
const snapshot={company_id:company,tenant_id:tenant,version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1',runtime_config:{routing:{line_key:'jinuo'}}};
const frozen={company_id:company,tenant_id:tenant,version:14,run_id:run,source_run:source101,snapshot};
function native(id){
  const body='怎么报名呀',nick='本人',uid='person987',pkg='com.ss.android.ugc.aweme';
  const prefix=`${run}-v${videoId}-collection`,profileEid=prefix+'-person1-t1',videoEid=prefix+'-after-card1';
  const profile=`<hierarchy><node package="${pkg}" text="${nick}" content-desc="${nick}，复制名字和修改备注"/><node package="${pkg}" text="抖音号：${uid}"/></hierarchy>`;
  const returned=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="3条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="${nick},${body},10-30, · 湖北,回复 按钮,"/></hierarchy>`;
  const scope={comment_encoding:'canonical',line_key:'jinuo',run,source_run:source101,video_id:videoId,
    video_url:video.video_url,profile:'legacy',douyin_id:uid,nickname:nick,comment_body_sha256:byteHash(body),
    profile_eid:profileEid,video_identity_eid:videoEid};
  return {id,line_key:'jinuo',harvest_batch:run,source_video_url:video.video_url,source_video:video.title,
    process_status:'待分拣',relevance:null,intent_grade:null,nickname:nick,douyin_id:uid,comment_body:body,
    recipient_evidence:{version:1,status:'verified',scope,raw:{profile,returned},sha256:{profile:byteHash(profile),returned:byteHash(returned)},
      video_identity:{verified:true,content_type:'video',expected_video_id:videoId,observed_video_id:videoId,evidence_id:videoEid}}};
}
function fixture(){
  const state={video:structuredClone(video),comments:ids.map(native),frozen:structuredClone(frozen),
    scoringFrozen:{...structuredClone(frozen),run_id:input.run,source_run:run},outbox:[],audit:[]};
  const calls=[];
  const pool={calls,state,
    async query(sql,args=[]){calls.push({sql,args});
      if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
      if(sql.includes('SELECT * FROM zenithjoy.leadgen_videos'))return {rows:[state.video]};
      if(sql.includes('SELECT * FROM zenithjoy.company_config_runs'))return {rows:[args?.[1]===input.run?state.scoringFrozen:state.frozen]};
      if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:state.comments};
      if(sql.includes('SELECT id,harvest_batch FROM zenithjoy.leadgen_comments'))return {rows:[]};
      if(sql.includes('SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox'))return {rows:state.outbox};
      if(sql.includes('SELECT * FROM zenithjoy.db_audit'))return {rows:state.audit.filter(a=>args.length===3
        ?a.action===args[0]&&a.detail.source_run===args[1]&&a.detail.scoring_run===args[2]
        :a.id===args[0]||a.action===args[1]&&a.detail.source_run===args[2]&&a.detail.video_id===args[3])};
      if(sql.includes('INSERT INTO zenithjoy.db_audit')){state.audit.push({id:args[0],org_id:args[1],table_id:null,member_id:args[2],action:args[3],detail:JSON.parse(args[4])});return {rows:[]};}
      throw Error('unexpected SQL: '+sql);
    },async connect(){return {query:this.query.bind(this),release(){}};}};
  const authority={readAuthority:async()=>({decision:{id:input.decision_id,made_by:'user',status:'active',decision:JSON.stringify(admission.scopeFor(input))},
    maintenanceTask:{id:input.maintenance_task_id,project_id:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',status:'in_progress',claimed_by:admission.ACTOR}}),
    inspectStopped:async()=>({source_run:run,source_commit:admission.SOURCE_COMMIT,run_status:'failed',native_receipts:11,
      observed_identities:207,same_live:0,group_members:0,tagged_processes:0,local_tagged_processes:0,observed_at:Date.now(),evidence_sha256:'a'.repeat(64)})};
  return {pool,authority,state};
}

test('102g接纳仅写一份审计回执，仍保失败视频与原评论状态；同评分run可精确领3条',async()=>{
  const {pool,authority,state}=fixture();
  const before=structuredClone({video:state.video,comments:state.comments});
  const result=await queueRequest(pool,input,{commentAdmission:authority});
  assert.equal(result.status,'applied');assert.deepEqual(result.comment_ids,ids);
  assert.deepEqual({video:state.video,comments:state.comments},before);
  assert.equal(state.audit.length,1);
  const scope=await queueRequest(pool,{op:'score_scope',line:'jinuo',run:input.run,source_run:run});
  assert.deepEqual(scope.ids,ids);
  const readback=await queueRequest(pool,{...input,op:'admit_102g_readback'});
  assert.equal(readback.status,'already_applied');
  const other=await queueRequest(pool,{op:'score_scope',line:'jinuo',run:'another103',source_run:run});
  assert.deepEqual(other.ids,[]);
  state.comments[0].relevance='相关';state.comments[0].intent_grade='A';
  state.comments[0].process_status='已分拣';state.outbox.push({comment_id:ids[0]});
  assert.equal((await queueRequest(pool,{...input,op:'admit_102g_readback'})).status,'already_applied');
  assert.equal((await queueRequest(pool,input,{commentAdmission:authority})).status,'already_applied');
  assert.equal(state.audit.length,1);
  assert.equal(pool.calls.some(c=>/UPDATE zenithjoy\.leadgen_(?:videos|comments)/.test(c.sql)),false);
});

test('102g同批其他正常状态视频也不得借接纳决定扩大评分范围',async()=>{
  const {pool,authority}=fixture();
  await queueRequest(pool,input,{commentAdmission:authority});
  const normal=pool.query.bind(pool),other='33333333-3333-4333-8333-333333333333';
  pool.query=async(sql,args)=>sql.includes('SELECT id,harvest_batch FROM zenithjoy.leadgen_comments c')
    ?{rows:[{id:other,harvest_batch:run}]}:normal(sql,args);
  const scope=await queueRequest(pool,{op:'score_scope',line:'jinuo',run:input.run,source_run:run});
  assert.deepEqual(scope.ids,ids);
});

test('单视频用户决定须绑定真实RPC候选SHA，伪造SHA在任何PG动作前拒绝',async()=>{
  const f=fixture();
  await assert.rejects(queueRequest(f.pool,{...input,candidate_source_commit:'d'.repeat(40)},
    {commentAdmission:f.authority}),/ADMISSION_SOURCE_COMMIT_MISMATCH/);
  assert.equal(f.pool.calls.length,0);
  assert.deepEqual(f.state.audit,[]);
});

test('102g受控接纳任一授权、终止、原生身份、政策、旧outbox或三条范围失配均不写',async()=>{
  const cases=[
    [ 'no user decision',f=>{f.authority.readAuthority=async()=>({...awaitAuthority(),decision:{id:input.decision_id,made_by:'agent',status:'active',decision:JSON.stringify(admission.scopeFor(input))}});}],
    [ 'live process',f=>{f.authority.inspectStopped=async()=>({...stopped(),same_live:1});}],
    [ 'missing comment',f=>{f.state.comments.pop();}],
    [ 'different native UID',f=>{f.state.comments[0].douyin_id='other';}],
    [ 'wrong policy',f=>{f.state.video.judgment_config.version=15;}],
    [ 'old outbox',f=>{f.state.outbox.push({comment_id:ids[0]});}],
    [ 'different video',f=>{f.state.video.video_id='7699489394579915664';}],
  ];
  function awaitAuthority(){return {maintenanceTask:{id:input.maintenance_task_id,project_id:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',status:'in_progress',claimed_by:admission.ACTOR}};}
  function stopped(){return {source_run:run,source_commit:admission.SOURCE_COMMIT,run_status:'failed',native_receipts:11,observed_identities:207,same_live:0,group_members:0,tagged_processes:0,local_tagged_processes:0,observed_at:Date.now(),evidence_sha256:'a'.repeat(64)};}
  for(const [name,mutate] of cases){const f=fixture();mutate(f);await assert.rejects(queueRequest(f.pool,input,{commentAdmission:f.authority}),/ADMISSION_/,name);assert.deepEqual(f.state.audit,[],name);}
});

test('接纳 COMMIT 回执未知时只报 unknown，须按同决策读回，不能再次创建审计行',async()=>{
  const {pool,authority,state}=fixture();
  const normal=pool.query.bind(pool);
  let commitAttempts=0,discarded=false;
  pool.connect=async()=>({query:async(sql,args)=>{
    if(sql==='COMMIT'){commitAttempts++;throw Error('connection lost after commit');}
    return normal(sql,args);
  },release:discard=>{discarded=discard===true;}});
  await assert.rejects(queueRequest(pool,input,{commentAdmission:authority}),error=>error.code==='ADMISSION_COMMIT_UNKNOWN');
  assert.equal(commitAttempts,1);assert.equal(discarded,true);
  assert.equal(state.audit.length,1);
  assert.equal((await queueRequest(pool,{...input,op:'admit_102g_readback'})).status,'already_applied');
});

test('102g无接纳回执时 score/policy_review/mark_leads 全拒绝，不调用模型、不写线索',async()=>{
  const snapshot=companyFixture();snapshot.runtime_config.routing={line_key:'jinuo'};
  const row=native(ids[1]);row.collected_at='2026-10-30T07:12:00Z';
  const calls=[];let modelCalls=0;
  const client={async query(sql,args=[]){calls.push({sql,args});
    if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:args[2]?.includes?.(row.id)?[]:[row]};
    if(sql.includes('SELECT video_id,video_url,title,judgment_status FROM zenithjoy.leadgen_videos'))return {rows:[]};
    if(sql.includes('SELECT * FROM zenithjoy.db_audit'))return {rows:[]};
    if(sql.includes('SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs'))return {rows:[{run_id:input.run,company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,snapshot}]};
    if(sql.includes('SELECT video_id,video_url,title,line_key,judgment_status FROM zenithjoy.leadgen_videos'))return {rows:[]};
    throw Error('unexpected SQL '+sql);
  },release(){}};
  const pool={query:client.query.bind(client),connect:async()=>client};
  const score=await queueRequest(pool,{op:'score',line:'jinuo',run:input.run,source_run:run,ids:[ids[1]],limit:1},
    {freezeCompanyConfig:async()=>snapshot,judgeComment:async()=>{modelCalls++;throw Error('must not call model');}});
  assert.equal(score.scored,0);assert.equal(score.blocked,1);assert.equal(modelCalls,0);
  const review=await queueRequest(pool,{op:'policy_review',line:'jinuo',run:input.run,claim:input.run,source_run:run,ids:[ids[1]]});
  assert.equal(review.verified,false);assert.equal(review.rows[0].reason,'row_or_video_scope_unverified');
  row.relevance='相关';row.intent_grade='A';row.judgment_config={run_id:input.run};
  const mark=await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:input.run,source_run:run,limit:1},
    {freezeCompanyConfig:async()=>snapshot});
  assert.equal(mark.marked,0);assert.equal(mark.blocked,1);
  assert.equal(calls.some(c=>/^\s*(?:UPDATE|INSERT INTO) zenithjoy\.leadgen_(?:comments|leads|bridge_outbox)/.test(c.sql)),false);
});
