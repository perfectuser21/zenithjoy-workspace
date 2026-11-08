import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowDomain, validatePublicDomainIdentity, publicDomainRunId} from '../leadgen-public-domain.mjs';
import {randomUUID} from 'node:crypto';
const identity=()=>({run_id:randomUUID(),task_id:randomUUID(),mode:'formal',machine_id:'mmv',profile_sha256:'a'.repeat(64),run_binding:{run_binding_id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:randomUUID(),attempt_key:'task:1',activities:{preflight:{reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()}}}});
test('public domain keeps canonical internal run/task and rejects external/anonymous identities',()=>{
 const i=identity();assert.equal(validatePublicDomainIdentity(i).run_id,i.run_id);assert.equal(publicDomainRunId(i),i.run_id);
 for(const v of [{...i,mode:'exploration'},{...i,run_binding:undefined},{...i,run_id:'douyin_video_discovery-test__a1'},{...i,task_id:null},{...i,run_binding:{...i.run_binding,source_kind:'external'}}])assert.throws(()=>validatePublicDomainIdentity(v));
});
test('factory rejects 104 and never starts another runner/Commander',async()=>{
 await assert.rejects(createWorkflowDomain({identity:identity(),profile:{domain_adapter:{config:{workflow_key:'douyin_lead_outreach'}}},runDirectory:'/tmp/denied-public-domain'}),/PUBLIC_DOMAIN_WORKFLOW/);
});
test('factory fails before side effects on absent fixed deadlines',async()=>{
 await assert.rejects(createWorkflowDomain({identity:identity(),profile:{domain_adapter:{config:{workflow_key:'douyin_video_discovery'}}},runDirectory:'/tmp/denied-public-domain'}),/PUBLIC_DOMAIN_DEADLINE/);
});
test('101 real metrics accept canonical public run UUID while preserving the business batch tag',async()=>{
 const {createRequire}=await import('node:module');const metrics=createRequire(import.meta.url)('../discovery-metrics.js');
 const run_id=randomUUID(),run='public101';const m=metrics.buildObservation({run,run_id,profile:'cloud-phone-test',source_commit:'a'.repeat(40),line_key:'yuesheng',video_id:'7693970762462579121',video_url:'https://www.douyin.com/video/7693970762462579121',observed_at:'2026-11-09T00:00:00.000Z',evidence_id:run+'-candidate1-link-t1',xml:'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢67，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论4，按钮"/></hierarchy>'});assert.equal(m.run_id,run_id);assert.equal(m.run,run);assert.equal(m.comment_total.value,4);
});
