import test from 'node:test';import assert from 'node:assert/strict';import {digest} from '../runtime-definition.mjs';
const load=()=>import('../device-epoch-fence-admission.mjs'),id=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture(){const taskId=id('1'),runId=id('2'),bindingId=id('3'),workflow=id('4'),version=id('5'),taskRun=id('6'),epoch=id('7'),source='a'.repeat(40),serial='47.100.213.173:10001',policyHash='b'.repeat(64),activity={reference_id:id('8'),activity_id:id('9'),activity_definition_version_id:id('a')},run_binding={run_binding_id:bindingId,workflow_id:workflow,workflow_definition_version_id:version,attempt_key:taskId+':1',activities:{preflight:activity}},company={company_id:id('b'),tenant_id:id('c'),version:26,policy_id:'original'},old={pid:91186,uid:501,start_identity:'old-start',endpoint:'tcp:127.0.0.1:5041',executable:'/adb',executable_sha256:'d'.repeat(64),policy_path:'/old.json',policy_sha256:'e'.repeat(64)},fresh={...old,pid:120000,start_identity:'new-start',endpoint:'tcp:127.0.0.1:5042',instance_id:'mmv-cloud-epoch2',policy_path:'/new.json',policy_sha256:policyHash},metadata={machine_id:'us-mac-m4',profile_sha256:'f'.repeat(64)},frozen={execution_mode:'code',deployment:{source_commit:source,observation_id:id('d')},release:{id:id('e')},files:{'runtime/code.mjs':'0'.repeat(64)},public_domain:{protocol:'workflow-domain/v1',...metadata,task_id:taskId,run_id:runId,run_binding,company},run_identity:{tag:'new-run'},discovery_phone_scope:{source_commit:source,serial,profile:'cloud-phone-test',expected_account:'77980009922',policy:{schema_version:2,instance_id:fresh.instance_id,endpoint:fresh.endpoint},policy_binding:{policy_path:fresh.policy_path,policy_sha256:policyHash}}},record={protocol:'device-epoch-fence-record/v1',epoch_id:epoch,status:'fenced',authority_basis:'old-route-fenced-observed-noninterference/v1',original_execution_stopped:false,android_internal:'not_attested',resource:{serial,profile:'cloud-phone-test',expected_account:'77980009922',company},old_route:old,new_route:fresh,runtime_source:{commit:source,files:{code:'0'.repeat(64)}},original_quarantine:{dev:1,ino:2,fields:{owner:'original\n'}}},task={id:taskId,status:'in_progress',claimed_by:'common-runner',result:{common_runner:{...metadata,task_id:taskId,run_id:runId,run_binding}}},binding={id:bindingId,run_id:runId,source_kind:'internal',workflow_id:workflow,workflow_definition_version_id:version,attempt_key:run_binding.attempt_key,task_run_id:taskRun,release_id:frozen.release.id,observation_id:frozen.deployment.observation_id,payload:{runtime_snapshot_sha256:digest({'code.mjs':'0'.repeat(64)})}};
return {record,frozen,task,binding,links:{task_id:taskId,task_run_id:taskRun},taskRun:{id:taskRun,task_id:taskId,run_id:runId,status:'running',ended_at:null},central:{device_name:serial,locked_by:taskId,expires_at:new Date(Date.now()+60000).toISOString(),expired:false,lease_version:'88'},oldDaemon:old,newDaemon:fresh,oldInventory:[],newInventory:[{serial,state:'device'}],policySha256:policyHash,source:record.runtime_source,archive:{dev:1,ino:2,fields:{owner:'original\n'}},activeOwner:'new-run\n',activeQuarantined:false};}
test('业务Task持中央owner，旧maintenance不需持锁；历史unknown不提升',async()=>{const {verifyEpochFacts}=await load(),f=fixture(),r=verifyEpochFacts(f);assert.equal(r.authorized,true);assert.equal(r.task_id,f.task.id);assert.equal(r.original_execution_stopped,false);assert.equal(r.android_internal,'not_attested');});
test('下一frame旧route重现/PID或source漂移/Task伪投影/中央抢占均拒绝',async()=>{const {verifyEpochFacts}=await load();for(const change of [f=>f.oldInventory.push({serial:f.record.resource.serial,state:'device'}),f=>f.oldDaemon={...f.oldDaemon,pid:91187},f=>f.oldDaemon={...f.oldDaemon,start_identity:'reused'},f=>f.newDaemon={...f.newDaemon,pid:120001},f=>f.central.locked_by='other',f=>f.links.task_id=id('d'),f=>f.binding.task_run_id=id('d'),f=>f.taskRun.status='canceled',f=>f.source={...f.source,commit:'c'.repeat(40)},f=>f.policySha256='0'.repeat(64),f=>f.archive.ino++,f=>f.activeOwner='old-run\n',f=>f.activeQuarantined=true,f=>f.frozen.execution_mode='agent',f=>f.record.original_execution_stopped=true]){const f=fixture();change(f);assert.throws(()=>verifyEpochFacts(f));}});
test('定向lsof逐次fresh PID/start/port：PID复用或别PID占port即拒',async()=>{
 const {readBoundAdbDaemon}=await load(),raw=Buffer.from('fixed'),expected={pid:91186,uid:process.getuid(),endpoint:'tcp:127.0.0.1:5041',start_identity:'old-start',command:'adb fixed',executable:'/adb',executable_sha256:digest(raw),policy_path:'/policy',policy_sha256:digest(raw)};let changed=false,other=false,calls=0;
 const options={readBytes:()=>raw,run:(bin,args)=>{calls++;if(bin.endsWith('/lsof')){if(args.includes('-d'))return 'n/adb\n';assert.ok(args.includes('-p'));assert.equal(args[args.indexOf('-p')+1],'91186');return `p${other?91187:91186}\nu${process.getuid()}\nf13\nn127.0.0.1:5041\n`;}return args.includes('lstart=')?(changed?'new-start':'old-start'):'adb fixed';}};
 assert.deepEqual(readBoundAdbDaemon(expected,options),expected);const first=calls;changed=true;assert.throws(()=>readBoundAdbDaemon(expected,options),/EPOCH_DAEMON_IDENTITY/);assert.ok(calls>first);changed=false;other=true;assert.throws(()=>readBoundAdbDaemon(expected,options),/EPOCH_DAEMON_LISTENER/);
});
test('heartbeat/progress/span变化不改变authority；claim/真实run/owner变化必须不同',async()=>{
 const {businessAuthorityProjection}=await load(),f=fixture(),later=structuredClone(f);later.task.updated_at='later';later.task.result.common_runner.progress={done:2};later.taskRun.updated_at='later';later.taskRun.context={span_count:5};later.central.expires_at=new Date(Date.now()+120000).toISOString();later.central.lease_version='89';assert.deepEqual(businessAuthorityProjection(f),businessAuthorityProjection(later));later.links.task_id=id('d');assert.notDeepEqual(businessAuthorityProjection(f),businessAuthorityProjection(later));
});
test('schema2 policy每次保600，不因字节hash相同接受权限漂移',async()=>{const {readPrivatePolicy}=await import('../device-epoch-fence-reference.mjs'),fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os'),d=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'epoch-policy-')),p=path.join(d,'policy.json');try{fs.writeFileSync(p,'{}',{mode:0o600});assert.equal(readPrivatePolicy(p).toString(),'{}');fs.chmodSync(p,0o644);assert.throws(()=>readPrivatePolicy(p),/EPOCH_POLICY_MODE/);}finally{fs.rmSync(d,{recursive:true,force:true});}});

test('official child retains every fresh epoch fact while declaring its exact agent host',async()=>{
 const {verifyEpochFacts}=await load(),{agentInput}=await import('../runtime-definition.mjs'),f=fixture();
 f.frozen.execution_mode='agent';f.frozen.primary_host='official-child-v1';f.frozen.workflow_version={payload:{key:'douyin_video_discovery'}};
 f.frozen.agent_input=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:f.task.id,WFR_TAG:'new-run',P:'cloud-phone-test',SERIAL:f.record.resource.serial,LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'90'});
 assert.equal(verifyEpochFacts(f).authorized,true);
 for(const change of [v=>v.frozen.primary_host='other',v=>v.frozen.execution_transport='raw-model-v1',v=>v.frozen.agent_input.task_id=id('a'),v=>v.central.locked_by=id('a'),v=>v.oldInventory.push({serial:v.record.resource.serial,state:'device'}),v=>v.activeOwner='other\n']){const bad=structuredClone(f);change(bad);assert.throws(()=>verifyEpochFacts(bad));}
});

async function standaloneFixture(){
 const {agentInput}=await import('../runtime-definition.mjs'),f=fixture(),p=f.frozen.public_domain;
 f.frozen.execution_mode='agent';f.frozen.primary_host='codex-exec-v1';f.frozen.workflow_version={payload:{key:'douyin_video_discovery'}};
 f.frozen.agent_input=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:f.task.id,WFR_TAG:'new-run',P:'cloud-phone-test',SERIAL:f.record.resource.serial,LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'90'});
 const approved_keywords=['AI办公'];
 const scope={...f.frozen.agent_input,approved_keywords,source_commit:f.frozen.deployment.source_commit,expected_account:f.record.resource.expected_account,company:p.company,machine_id:p.machine_id};
 const skill={name:'douyin-leadgen-direct',version:'0.1.0',source_commit:'f'.repeat(40),path:'skill/SKILL.md',sha256:'1'.repeat(64)};
 const identity={...p,approved_keywords,protocol:'codex-exec-v1',claimer:'codex-skill-direct',claimed_at:new Date().toISOString(),task_run_id:f.taskRun.id,skill,scope_sha256:digest(scope)};
 delete f.frozen.public_domain;f.frozen.standalone_skill=identity;f.frozen.files[skill.path]=skill.sha256;
 f.task.claimed_by=identity.claimer;f.task.claimed_at=identity.claimed_at;f.task.payload={execution_mode:'standalone-skill',scope,skill};f.task.result={codex_skill_direct:structuredClone(identity)};
 return f;
}
test('standalone Codex uses its true owner and pinned Skill without common-runner projection',async()=>{
 const {verifyEpochFacts}=await load(),f=await standaloneFixture(),r=verifyEpochFacts(f);
 assert.equal(r.authorized,true);assert.equal(r.task_id,f.task.id);assert.equal(f.task.result.common_runner,undefined);assert.equal(f.frozen.public_domain,undefined);
});
test('standalone rejects claim, Skill, input, binding and all resource authority drift',async()=>{
 const {verifyEpochFacts}=await load();
 for(const change of [f=>f.task.claimed_by='common-runner',f=>f.task.claimed_at='other',f=>f.task.payload.execution_mode='agent',f=>f.task.payload.scope.limit=2,f=>f.task.payload.skill.sha256='2'.repeat(64),f=>f.task.result.codex_skill_direct.run_id=id('f'),f=>f.task.result.codex_skill_direct.run_binding.activities.preflight.activity_id=id('f'),f=>f.frozen.files['skill/SKILL.md']='2'.repeat(64),f=>f.frozen.standalone_skill.skill.path='../skill/SKILL.md',f=>f.frozen.standalone_skill.task_run_id=id('f'),f=>f.frozen.agent_input.limit=2,f=>f.frozen.public_domain={...f.frozen.standalone_skill,protocol:'workflow-domain/v1'},f=>f.frozen.execution_mode='code',f=>f.frozen.execution_transport='raw-model-v1',f=>f.binding.source_kind='external',f=>f.links.task_id=id('f'),f=>f.taskRun.status='failed',f=>f.central.locked_by=id('f'),f=>f.activeOwner='other\n',f=>f.activeQuarantined=true,f=>f.oldInventory.push({serial:f.record.resource.serial,state:'device'}),f=>f.policySha256='2'.repeat(64),f=>f.source.commit='2'.repeat(40)]){
  const f=await standaloneFixture();change(f);assert.throws(()=>verifyEpochFacts(f));
 }
});
test('standalone fresh projections notice payload, Skill and identity drift while ignoring progress',async()=>{
 const {businessAuthorityProjection}=await load(),f=await standaloneFixture();
 for(const change of [v=>v.task.payload.scope.limit=2,v=>v.task.payload.skill.sha256='2'.repeat(64),v=>v.task.result.codex_skill_direct.scope_sha256='2'.repeat(64)]){
  const later=structuredClone(f);change(later);assert.notDeepEqual(businessAuthorityProjection(f),businessAuthorityProjection(later));
 }
 const later=structuredClone(f);later.task.result.codex_skill_direct.progress={calls:3};later.task.updated_at='later';assert.deepEqual(businessAuthorityProjection(f),businessAuthorityProjection(later));
});
test('standalone identity rejects malformed references and expired execution budget',async()=>{
 const {verifyEpochFacts}=await load();
 for(const change of [f=>f.frozen.standalone_skill.skill.sha256='not-a-hash',f=>f.frozen.standalone_skill.skill.source_commit='draft',f=>f.frozen.standalone_skill.run_binding.activities.preflight.reference_id='not-a-uuid',f=>f.frozen.standalone_skill.claimed_at='yesterday',f=>f.frozen.agent_input.run_start_ts=Math.floor(Date.now()/1000)-100]){
  const f=await standaloneFixture();change(f);assert.throws(()=>verifyEpochFacts(f),/EPOCH_STANDALONE_IDENTITY/);
 }
});

test('standalone CLI rejection preserves its own task/run diagnostic without old public-domain identity',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{main}=await load(),f=await standaloneFixture();
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'standalone-diagnostic-'));
 try{
  fs.mkdirSync(path.join(dir,'runtime'),{mode:0o700});fs.mkdirSync(path.join(dir,'skill'),{mode:0o700});
  const code='fixture code',skill='fixture Skill';fs.writeFileSync(path.join(dir,'runtime/code.mjs'),code,{mode:0o600});fs.writeFileSync(path.join(dir,'skill/SKILL.md'),skill,{mode:0o600});
  f.frozen.files={'runtime/code.mjs':digest(code),'skill/SKILL.md':digest(skill)};f.frozen.standalone_skill.skill.sha256=digest(skill);
  const snapshot={...f.frozen,snapshot_sha256:digest(f.frozen)};fs.writeFileSync(path.join(dir,'run-definition.json'),JSON.stringify(snapshot),{mode:0o600});
  await assert.rejects(()=>main(['verify-epoch','--run-dir',dir]),/EPOCH_FROZEN_REFERENCE/);
  const diagnostic=JSON.parse(fs.readFileSync(path.join(dir,'epoch-fence-admission/diagnostics/00.json'),'utf8'));
  assert.equal(diagnostic.task_id,f.task.id);assert.equal(diagnostic.run_id,f.taskRun.run_id);assert.equal(diagnostic.finite_error_code,'EPOCH_FROZEN_REFERENCE');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('standalone scoring has no phone scope and never borrows a device account',async()=>{
 const {standaloneScope}=await import('../standalone-skill-authority.mjs'),{agentInput}=await import('../runtime-definition.mjs'),f=await standaloneFixture();
 delete f.frozen.discovery_phone_scope;f.frozen.workflow_version.payload.key='douyin_comment_scoring';
 f.frozen.agent_input=agentInput({LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WF_BRAIN_TASK_ID:f.task.id,WFR_TAG:'new-run',P:'mmv-scoring',SERIAL:'none',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'90'});
 f.frozen.standalone_skill.approved_keywords=[];
 const scope=standaloneScope(f.frozen);assert.deepEqual(scope.approved_keywords,[]);assert.equal(scope.profile,'mmv-scoring');assert.equal(scope.serial,'none');assert.equal(scope.expected_account,'none');
 for(const change of [v=>v.agent_input.profile='cloud-phone-test',v=>v.discovery_phone_scope=fixture().frozen.discovery_phone_scope]){const bad=structuredClone(f.frozen);change(bad);assert.throws(()=>standaloneScope(bad),/EPOCH_STANDALONE_IDENTITY/);}
 const phone=await standaloneFixture();delete phone.frozen.discovery_phone_scope;assert.throws(()=>standaloneScope(phone.frozen),/EPOCH_STANDALONE_IDENTITY/);
});
test('standalone identity requires company and tenant UUIDs, positive version and nonempty original policy',async()=>{
 const {validateStandaloneIdentity}=await import('../standalone-skill-authority.mjs'),f=await standaloneFixture();
 for(const change of [p=>delete p.company,p=>p.company.company_id='wrong',p=>p.company.tenant_id='wrong',p=>p.company.version=0,p=>p.company.version='26',p=>p.company.policy_id='',p=>p.company.policy_id='  ']){
  const p=structuredClone(f.frozen.standalone_skill);change(p);assert.throws(()=>validateStandaloneIdentity(p),/EPOCH_STANDALONE_IDENTITY/);
 }
});
test('standalone task creation scope derives only its generated Task ID and retains every other scope field',async()=>{
 const {verifyEpochFacts}=await load(),f=await standaloneFixture();
 delete f.task.payload.scope.task_id;assert.equal(verifyEpochFacts(f).authorized,true);
 for(const change of [v=>v.task.payload.scope.task_id=id('f'),v=>v.task.payload.scope.limit=2,v=>delete v.task.payload.scope.serial,v=>v.task.payload.scope.extra='not-authorized']){
  const bad=structuredClone(f);change(bad);assert.throws(()=>verifyEpochFacts(bad),/EPOCH_BUSINESS_TASK/);
 }
 const old=await standaloneFixture();assert.equal(verifyEpochFacts(old).authorized,true);
});

test('standalone discovery scope pins its approved keywords and rejects widening or malformed terms',async()=>{
 const {verifyEpochFacts}=await load(),{standaloneScope}=await import('../standalone-skill-authority.mjs'),f=await standaloneFixture();
 assert.deepEqual(standaloneScope(f.frozen).approved_keywords,['AI办公']);assert.equal(verifyEpochFacts(f).authorized,true);
 for(const change of [v=>v.task.payload.scope.approved_keywords=['另一个词'],v=>v.task.result.codex_skill_direct.approved_keywords=['另一个词'],v=>v.frozen.standalone_skill.approved_keywords=[],v=>v.frozen.standalone_skill.approved_keywords=['AI办公','AI办公'],v=>v.frozen.standalone_skill.approved_keywords=['  '],v=>v.frozen.standalone_skill.approved_keywords=['x'.repeat(81)],v=>v.frozen.standalone_skill.approved_keywords=['one\ntwo'],v=>delete v.frozen.standalone_skill.approved_keywords]){
  const bad=structuredClone(f);change(bad);assert.throws(()=>verifyEpochFacts(bad));
 }
});
async function compatibilityFixture(){
 const f=await standaloneFixture(),original=structuredClone(f.record.runtime_source),next='b'.repeat(40),newFile='2'.repeat(64);
 f.source={commit:next,files:{...original.files,'standalone-skill-authority.mjs':newFile}};f.frozen.deployment.source_commit=next;f.frozen.discovery_phone_scope.source_commit=next;
 f.frozen.files['runtime/standalone-skill-authority.mjs']=newFile;f.binding.payload.runtime_snapshot_sha256=digest({'code.mjs':'0'.repeat(64),'standalone-skill-authority.mjs':newFile});
 f.task.payload.scope.source_commit=next;f.frozen.standalone_skill.scope_sha256=digest(f.task.payload.scope);f.task.result.codex_skill_direct=structuredClone(f.frozen.standalone_skill);
 const recordSha256=digest(JSON.stringify(f.record));f.recordSha256=recordSha256;f.frozen.discovery_phone_scope.policy_binding.epoch_fence={sha256:recordSha256};
 const receipt={protocol:'epoch-source-compatibility/v1',original_record_sha256:recordSha256,original_runtime_source:original,candidate_runtime_source:f.source,candidate_manifest_sha256:f.binding.payload.runtime_snapshot_sha256,release_id:f.frozen.release.id,observation_id:f.frozen.deployment.observation_id,serial:f.record.resource.serial,instance_id:f.record.new_route.instance_id,policy_sha256:f.policySha256,changes:[{path:'standalone-skill-authority.mjs',before_sha256:null,after_sha256:newFile}],evidence_refs:['artifact://review/source-diff'],actor:'codex-independent-source-review'};
 f.frozen.epoch_source_compatibility={review_task_id:id('f'),receipt,receipt_sha256:digest(receipt)};f.compatibilityReview={id:id('f'),status:'completed',task_type:'research',parent_task_id:id('d'),payload:{work_kind:'epoch_source_compatibility_review',reviewer:receipt.actor,business_task_id:f.task.id,candidate_source_commit:next,original_record_sha256:recordSha256,development_task_id:id('d')},result:{actor:receipt.actor,audit_evidence:{path:receipt.evidence_refs[0],sha256:'8'.repeat(64),verdict:'pass'},epoch_source_compatibility:structuredClone(receipt)}};f.compatibilityDevelopment={id:id('d'),task_type:'dev'};
 return f;
}
test('standalone candidate uses a completed Brain compatibility review while original epoch stays unchanged',async()=>{
 const {verifyEpochFacts}=await load(),f=await compatibilityFixture(),original=structuredClone(f.record),r=verifyEpochFacts(f);
 assert.equal(r.authorized,true);assert.equal(r.source_commit,f.source.commit);assert.deepEqual(f.record,original);
});
test('source compatibility never accepts local-only, stale or mismatched review evidence',async()=>{
 const {verifyEpochFacts}=await load();
 for(const change of [f=>delete f.compatibilityReview,f=>f.compatibilityReview.status='in_progress',f=>f.compatibilityReview.id=id('e'),f=>f.compatibilityReview.result.epoch_source_compatibility.actor='another',f=>f.recordSha256='3'.repeat(64),f=>f.source.files.extra='4'.repeat(64),f=>f.oldInventory.push({serial:f.record.resource.serial,state:'device'}),f=>f.central.locked_by=id('f')]){
  const f=await compatibilityFixture();change(f);assert.throws(()=>verifyEpochFacts(f));
 }
});

test('compatibility fresh projection includes the real development Task type and exact review scope',async()=>{
 const {businessAuthorityProjection}=await load(),f=await compatibilityFixture();
 for(const change of [v=>v.compatibilityDevelopment.task_type='research',v=>v.compatibilityDevelopment.id=id('c'),v=>v.compatibilityReview.payload.business_task_id=id('c'),v=>v.compatibilityReview.result.audit_evidence.sha256='0'.repeat(64)]){
  const later=structuredClone(f);change(later);assert.notDeepEqual(businessAuthorityProjection(f),businessAuthorityProjection(later));
 }
});
