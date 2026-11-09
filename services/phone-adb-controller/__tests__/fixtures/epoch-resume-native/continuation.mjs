// Controlled historical source labels only. All effects/readbacks use real main,
// held Popen, helper, flock, loopback host protocol, and fixture Brain CAS.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {canonical,digest} from '../../../device-epoch-fence-reference.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function prepareContinuation(r){
 const c=r.continuationContext,{cfg,initial,selected,context,planning,boundary,processModule,save,directory}=c;
 console.error('continuation prepare failed plan');const failed=await r.prepare(),failedPlan=failed.plan;console.error('continuation execute old stop');
 assert.equal(failedPlan.source_authority.commit,'4ba9a0849f281f07f42186d7f465f1c144286dab');
 for(let n=0;!fs.existsSync(join(r.runtime,'initial-wait-held'))&&n<100;n++)await sleep(20);
 assert.ok(fs.existsSync(join(r.runtime,'initial-wait-held')));
 // Scale only the stop observation deadline; helper and kernel facts stay real.
 // CI Python may time out its nested wait after 10s, unlike the pinned incident
 // interpreter. Observe its real parent-live/child-terminal window promptly.
 let clockCalls=0;
 await assert.rejects(r.main.applyResumePlan({planPath:failed.path},{...r.applyDeps,processOperations:{...r.applyDeps.processOperations,now:()=>Date.now()+(++clockCalls<=3?0:30000)}}),/RESUME_PRIVATE_TERMINAL_UNKNOWN/);
 console.error('continuation observed genuine old-stop unknown');assert.equal(r.counts().signalCalls,1);assert.equal(initial.exitCode,null);
 const failedBytes=fs.readFileSync(join(r.root,'resume-execution/unknown.json'));
 assert.equal(JSON.parse(failedBytes).error_code,'RESUME_PRIVATE_TERMINAL_UNKNOWN');
 const actual=selected.actual,ops=directory(join(r.root,'ops')),opid='offline-native-parent-reclaim',claim=failedPlan.claim;
 const op={protocol:'owned-stalled-parent-reclaim-plan/v1',op_id:opid,task_id:r.task.id,action:'SIGKILL_exact_stalled_parent_once',expected:actual,prior_resume_plan:failed.path,source_runtime:r.runtime,history:{[failed.path]:digest(fs.readFileSync(failed.path))},central:{...r.lease},original_execution_stopped:false};
 const opPath=save(join(ops,'plan.json'),op),script=save(join(ops,'execute.mjs'),Buffer.from("export async function execute(held){const done=new Promise(resolve=>held.once('close',resolve));held.kill('SIGKILL');await done;}\n"));
 const approval={protocol:'owned-stalled-parent-reclaim-approval/v1',op_id:opid,plan_sha256:digest(fs.readFileSync(opPath)),claim,action:op.action,expected:actual,central:op.central,scripts:{[script]:digest(fs.readFileSync(script))},approved_by:'offline-native-operator',approval_ref:'explicit-fixture-parent-only',approved_at:new Date().toISOString()};
 r.task.result.stalled_private_parent_reclaim_approval=approval;save(join(ops,'approval-readback.json'),approval);
 save(join(ops,'intent.json'),{op_id:opid,action:op.action,expected_parent:actual.supervisor,issued_at:new Date().toISOString()});
 const fresh=processModule.invokeResumeProcessHelper({action:'kernel',...context,pid:initial.pid},failedPlan).identity;
 assert.equal(fresh.pid,actual.supervisor.pid);assert.deepEqual(fresh.kernel_start,actual.supervisor.kernel_start);assert.equal(fresh.uid,process.getuid());
 await (await import(pathToFileURL(script))).execute(initial);
 save(join(ops,'signal-dispatched.json'),{pid:actual.supervisor.pid,signal:'SIGKILL',syscall_returned:true,child_signalled:false,not_stop_proof:true,retry_allowed:false});
 console.error('continuation exact parent reclaimed');const terminalDocument={action:'terminal',...context,expected:actual};
 const pythonFacts=JSON.parse(execFileSync(c.python,['-I','-B','-S',join(r.runtime,'adb-private-supervisor.py')],{input:canonical(terminalDocument),encoding:'utf8',env:{HOME:r.home,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},timeout:10000}));
 const facts=processModule.invokeResumeProcessHelper(terminalDocument,failedPlan);assert.deepEqual(facts,pythonFacts);
 assert.equal(facts.selected_identities_absent,true);assert.equal(facts.listener_absent,true);assert.equal(facts.instance_locks_released,true);
 save(join(ops,'terminal-python-readback.json'),pythonFacts);
 const nodePath=save(join(ops,'terminal-node-readback.json'),{protocol:'owned-stalled-parent-independent-terminal/v1',op_id:opid,task_id:r.task.id,prior_resume_plan:failed.path,expected:actual,helper_source:join(r.runtime,'device-epoch-fence-resume-process.mjs'),actual:facts,history_unchanged:true,original_execution_stopped:false,not_epoch_or_original_run_stop_proof:true});
 const summary={protocol:'owned-stalled-parent-reclaim-result/v1',op_id:opid,task_id:r.task.id,status:'terminal_observed',directory:ops,parent_pid:actual.supervisor.pid,parent_signal_count:1,parent_signal:'SIGKILL',child_signal_count:0,exact_private_terminal:true,history_unchanged:true,original_execution_stopped:false,epoch_published:false,phone_business_started:false,not_original_stop_success:true,not_authority_to_retry_old_apply:true,terminal_node_readback:nodePath,terminal_node_sha256:digest(fs.readFileSync(nodePath)),terminal_python_readback:join(ops,'terminal-python-readback.json')};
 save(join(ops,'summary.json'),summary);r.task.result.stalled_private_parent_reclaim_execution=summary;
 const newRuntime=join(r.root,'continuation-runtime');fs.cpSync(r.runtime,newRuntime,{recursive:true});
 const next=structuredClone(cfg);next.failedRoot=r.runtime;next.failedSource=cfg.source;next.failedServiceSha=context.supervisor_source.service_sha256;next.source={...cfg.source,commit:c.actualCommit};next.review.scope.review_source=next.source;next.continuation_old_handler=false;
 const manifest=JSON.parse(fs.readFileSync(join(newRuntime,'deployment-manifest.json')));manifest.source_commit=c.actualCommit;save(join(newRuntime,'deployment-manifest.json'),manifest);save(join(newRuntime,'native-fixture.json'),next);
 const nextBoundary=await import(pathToFileURL(join(newRuntime,'fixture-boundary.mjs'))),main=await import(pathToFileURL(join(newRuntime,'device-epoch-fence-resume.mjs'))),history=await import(pathToFileURL(join(newRuntime,'device-epoch-fence-stop-continuation.mjs'))),nextProcess=await import(pathToFileURL(join(newRuntime,'device-epoch-fence-resume-process.mjs')));
 const request={...r.request,mode:'observed_stop_continuation',execution_directory:join(r.root,'continuation-execution'),stopped_resume_plan_path:failed.path,stopped_resume_execution_directory:failedPlan.execution_directory,stopped_resume_runtime_root:r.runtime,ops_directory:ops};
 console.error('continuation create new plan');const planDir=directory(join(r.root,'continuation-plan')),plan=await main.createResumePlan({request,directory:planDir},{...planning,runtimeRoot:newRuntime,processHelper:nextProcess.invokeResumeProcessHelper,source:nextBoundary.reviewSource,inspectReview:nextBoundary.inspectReview,read:nextBoundary.readBrain,stoppedHistory:args=>history.readStoppedResumeHistory({...args,readSource:nextBoundary.reviewSource})});
 r.task.result.device_epoch_fence_stop_continuation_approval={protocol:'device-epoch-fence-stop-continuation-approval/v1',plan_sha256:plan.plan_sha256,approved_scope:plan.approval_scope,actions:plan.actions,approved_by:'offline-native-operator',approval_ref:'specific-continuation-only',approved_at:new Date().toISOString()};
 let startupOwned;
 const readHelper=(document,p)=>{const value=nextProcess.invokeResumeProcessHelper(document,p);if(cfg.continuation_startup_ack_lost&&document.action==='inspect'&&document.supervisor_source.runtime_root===newRuntime){startupOwned=value;throw Error('FIXTURE_STARTUP_ACK_LOST');}return value;};
 const applyDeps={...r.applyDeps,inspectAuthority:nextBoundary.inspectAuthority,processHelper:readHelper,createStartupReceipt:async options=>{const {createResumeStartupReceipt}=await import(pathToFileURL(join(newRuntime,'device-epoch-fence-resume-startup.mjs')));return createResumeStartupReceipt({...options,inspectAuthority:nextBoundary.inspectAuthority,source:nextBoundary.reviewSource});},runtimeOptions:{...r.applyDeps.runtimeOptions,source:nextBoundary.reviewSource,read:nextBoundary.readBrain}};
 const originalClose=r.close;r.close=async()=>{try{if(startupOwned){const document={action:'terminal',instance_id:plan.new_instance.instance_id,endpoint:plan.new_instance.policy.endpoint,source_commit:plan.source_authority.commit,policy_path:plan.new_instance.policy_path,policy_sha256:plan.new_instance.policy_sha256,supervisor_source:plan.resume_service_source,expected:startupOwned.actual};nextProcess.invokeResumeProcessHelper({...document,action:'inspect'},plan);process.kill(startupOwned.actual.supervisor.pid,'SIGTERM');let terminal=false;for(let n=0;n<100;n++){try{const p=nextProcess.invokeResumeProcessHelper(document,plan);terminal=p.selected_identities_absent&&p.listener_absent&&p.instance_locks_released;if(terminal)break;}catch{}await sleep(20);}assert.ok(terminal,'fixture startup ACK-lost cleanup must prove exact terminal');}}finally{await originalClose();}};
 assert.deepEqual(fs.readFileSync(join(r.root,'resume-execution/unknown.json')),failedBytes);
 return {plan,path:join(planDir,'plan.json'),main,applyDeps,newRuntime,failed,failedBytes,ops,stopSignalsBefore:r.counts().signalCalls};
}
