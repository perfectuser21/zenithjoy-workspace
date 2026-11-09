// Real three-stage main fixture. Only historical source identity and the
// loopback peer's SDK response delay are controlled; no stage receipt is faked.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareContinuation} from './continuation.mjs';
import {digest} from '../../../device-epoch-fence-reference.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function prepareDiagnosticRecovery(r){
 const c=r.continuationContext,{save,directory}=c,continued=await prepareContinuation(r),failed=continued.plan;
 assert.equal(failed.source_authority.commit,'d7c9e6b25bd6434699653f381abbcf3e44c83a66');
 const stall=save(join(r.runtime,'stall-sdk-transport'),Buffer.alloc(0));
 await assert.rejects(continued.main.applyResumePlan({planPath:continued.path},continued.applyDeps),/DIAGNOSTIC_RECEIPT/);
 fs.unlinkSync(stall);
 const diagnosticDirectory=join(failed.execution_directory,'0008-diagnostic-sdk'),diagnostic=JSON.parse(fs.readFileSync(join(diagnosticDirectory,'diagnostic.json')));
 assert.equal(diagnostic.error_code,'DIAGNOSTIC_DEADLINE');assert.equal(diagnostic.pending,0);assert.equal(diagnostic.open_sockets,0);
 assert.equal(r.counts().releaseCalls,0);assert.equal(fs.existsSync(r.quarantine),true);
 const ready=JSON.parse(fs.readFileSync(join(failed.execution_directory,'startup-ready.json'))),actual=ready.actual;
 const context={instance_id:failed.new_instance.instance_id,endpoint:failed.new_instance.policy.endpoint,source_commit:failed.source_authority.commit,policy_path:failed.new_instance.policy_path,policy_sha256:failed.new_instance.policy_sha256,supervisor_source:failed.resume_service_source};
 const read=document=>continued.nextProcess.invokeResumeProcessHelper({...context,...document},failed);
 read({action:'inspect',expected:actual});process.kill(actual.supervisor.pid,'SIGTERM');
 let terminal;for(let n=0;n<100;n++){try{const value=read({action:'terminal',expected:actual});if(value.selected_identities_absent&&value.listener_absent&&value.instance_locks_released){terminal=value;break;}}catch{}await sleep(25);}
 assert.ok(terminal,'real failed diagnostic pair must be terminal before recovery');
 const terminalPath=save(join(r.root,'diagnostic-terminal.json'),{prior_plan_sha256:failed.plan_sha256,expected:actual,original_execution_stopped:false,not_original_apply_success:true,new_start_or_connect_attempts:0,observed_at:new Date().toISOString(),actual:terminal});
 const connectCalls=r.events().split('\n').filter(x=>x.includes('host:connect:')).length;assert.equal(connectCalls,1);
 r.task.result.device_epoch_fence_stop_continuation_execution={protocol:'device-epoch-fence-stop-continuation-execution/v1',status:'unknown',error_code:'DIAGNOSTIC_RECEIPT',plan_sha256:failed.plan_sha256,source_commit:failed.source_authority.commit,evidence:r.root,terminal_readback:terminalPath,connect_calls:connectCalls,retry_allowed:false,epoch_published:false,business_started:false,diagnostic_pending:diagnostic.pending,quarantine_archived:false,ui_business_actions:0,connect_ack_confirmed:true,diagnostic_error_code:diagnostic.error_code,diagnostic_open_sockets:diagnostic.open_sockets,central_release_attempted:false,original_execution_stopped:false,startup_verified_historical:true,current_private_pair_terminal_verified:true,private_device_inventory_confirmed_historical:true};
 const nextRuntime=join(r.root,'diagnostic-recovery-runtime');fs.cpSync(continued.newRuntime,nextRuntime,{recursive:true});
 const config=structuredClone(continued.nextConfig);config.diagnosticRoot=continued.newRuntime;config.diagnosticSource=failed.source_authority;config.diagnosticServiceSha=failed.resume_service_source.service_sha256;config.source={...failed.source_authority,commit:c.actualCommit};config.review.scope.review_source=config.source;
 const manifest=JSON.parse(fs.readFileSync(join(nextRuntime,'deployment-manifest.json')));manifest.source_commit=config.source.commit;save(join(nextRuntime,'deployment-manifest.json'),manifest);save(join(nextRuntime,'native-fixture.json'),config);
 const boundary=await import(pathToFileURL(join(nextRuntime,'fixture-boundary.mjs'))),main=await import(pathToFileURL(join(nextRuntime,'device-epoch-fence-resume.mjs'))),history=await import(pathToFileURL(join(nextRuntime,'device-epoch-fence-diagnostic-recovery.mjs'))),stopped=await import(pathToFileURL(join(nextRuntime,'device-epoch-fence-stop-continuation.mjs'))),api=await import(pathToFileURL(join(nextRuntime,'device-epoch-fence-resume-process.mjs')));
 const request={...r.request,mode:'diagnostic_terminal_recovery',execution_directory:join(r.root,'diagnostic-recovery-execution'),diagnostic_resume_plan_path:continued.path,diagnostic_execution_directory:failed.execution_directory,diagnostic_runtime_root:continued.newRuntime,terminal_receipt_path:terminalPath};
 const planDir=directory(join(r.root,'diagnostic-recovery-plan')),plan=await main.createResumePlan({request,directory:planDir},{...c.planning,runtimeRoot:nextRuntime,source:boundary.reviewSource,inspectReview:boundary.inspectReview,read:boundary.readBrain,processHelper:api.invokeResumeProcessHelper,diagnosticHistory:args=>history.readDiagnosticRecoveryHistory({...args,readSource:boundary.reviewSource,readStopped:stopped.readStoppedResumeHistory})});
 r.task.result.device_epoch_fence_diagnostic_recovery_approval={protocol:'device-epoch-fence-diagnostic-recovery-approval/v1',plan_sha256:plan.plan_sha256,approved_scope:plan.approval_scope,actions:plan.actions,approved_by:'offline-native-operator',approval_ref:'new-diagnostic-terminal-only',approved_at:new Date().toISOString()};
 const applyDeps={...r.applyDeps,inspectAuthority:boundary.inspectAuthority,processHelper:api.invokeResumeProcessHelper,createStartupReceipt:async options=>{const {createResumeStartupReceipt}=await import(pathToFileURL(join(nextRuntime,'device-epoch-fence-resume-startup.mjs')));return createResumeStartupReceipt({...options,inspectAuthority:boundary.inspectAuthority,source:boundary.reviewSource});},runtimeOptions:{...r.applyDeps.runtimeOptions,source:boundary.reviewSource,read:boundary.readBrain}};
 const oldClose=r.close;r.close=async()=>{try{const path=join(plan.execution_directory,'startup-ready.json');if(fs.existsSync(path)){const pair=JSON.parse(fs.readFileSync(path)),document={action:'inspect',instance_id:plan.new_instance.instance_id,endpoint:plan.new_instance.policy.endpoint,source_commit:plan.source_authority.commit,policy_path:plan.new_instance.policy_path,policy_sha256:plan.new_instance.policy_sha256,supervisor_source:plan.resume_service_source,expected:pair.actual};api.invokeResumeProcessHelper(document,plan);process.kill(pair.actual.supervisor.pid,'SIGTERM');let done=false;for(let n=0;n<100;n++){try{const f=api.invokeResumeProcessHelper({...document,action:'terminal'},plan);done=f.selected_identities_absent&&f.listener_absent&&f.instance_locks_released;if(done)break;}catch{}await sleep(25);}assert.ok(done,'fixture recovery pair cleanup terminal');}}finally{await oldClose();}};
 return {main,plan,path:join(planDir,'plan.json'),applyDeps,continued,terminalPath,source:config.source,historyHashes:{...plan.diagnostic_recovery.files},baselineSignals:r.counts().signalCalls};
}
