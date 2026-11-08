import {canonicalRunId,readPublicDomainBinding} from './public-domain-authority.mjs';
import {isNativePhoneRuntime} from './native-phone-runtime.mjs';
import {isNativeScoringWorkflow} from './native-scoring-workflow.mjs';
import {verifyNoComments,createNoComments} from './no-comments-evidence.mjs';
import {createLeadgenAgentTools,verifyAgentUpstream,mergeAgentCollectionRows,aggregateAgentCollectionCommit} from './leadgen-agent-tools.mjs';
import {verifyProducerDescriptor,verifyProducerCompany} from './producer-descriptor.mjs';
import {createScoringHandler} from './leadgen-scoring-handler.mjs';
import {readFileSync,writeFileSync,appendFileSync,chmodSync,renameSync,existsSync,readdirSync,lstatSync,realpathSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import recipientProof from './queued-recipient-evidence.js';
import lineRoutes from './line-routes.js';
import {readFrozen,commentSamplingInput,assertCommentSampling,collectionBudgetSeconds,assertDiscoveryInput,canonical} from './runtime-definition.mjs';
import {execInput,safeExecutionDiagnostic,applyNativeFailure} from './leadgen-client.mjs';
import {createDiscoveryAction} from './leadgen-discovery-action.mjs';
import {createPhoneAction} from './leadgen-phone-action.mjs';
import {captureCleanupReadback,verifyCleanupReadback} from './discovery-cleanup-readback.mjs';
import {createOutreachHandlers} from './leadgen-outreach.mjs';
import history from './queued-comment-history.js';
import {assertCaptureStrategy} from './capture-strategy.mjs';
import {readBinding} from './runtime-binding.mjs';
import {freezeQualificationIdentity} from './qualification-identity-snapshot.mjs';
import {createVideoAction} from './leadgen-video-action.mjs';
import {startCollectionPhoneScope,startCollectionReturnedScope,invalidateCollectionPhoneProof} from './collection-phone-scope.mjs';
import {startDiscoveryPhoneScope} from './discovery-phone-scope.mjs';
import {isPreflightRuntime} from './preflight-phone-scope.mjs';
import {createCentralDeviceLease,verifyCentralTaskAssociation,persistCentralTaskAssociation} from './central-device-lease.mjs';
import discoveryMetrics from './discovery-metrics.js';
import ownAccounts from './own-accounts-lib.js';

export function parseCollection(result,videoId,{allowPartial=false,recipientScope}={}) {
  if(result.code!==0&&!(allowPartial&&result.code===7))throw Error(`采集未完成 code=${result.code}`);
  const lines=result.stdout.split('\n').map(s=>s.replace(/\r$/,''));
  const marker=lines.find(s=>s.startsWith(`COLLECTION\t${videoId}\t`))?.split('\t');
  const allowed=result.code===7?['partial']:['collected','no_comments','sampled'];
  if(!marker||!allowed.includes(marker[2]))throw Error('缺同视频采集完成标记');
  const comments=lines.filter(s=>s.startsWith('LEAD\t')).map(s=>{
    const f=s.split('\t');if(f.length!==12)throw Error('评论字段损坏');
    return {nickname:f[1],douyinId:f[2],accountType:f[3],commentBody:f[4],commentTime:f[5],
      region:f[6],sourceVideo:f[7],keyword:f[8],profileIp:f[9],profileUrl:f[10],sourceVideoUrl:f[11]};
  });
  const proofLines=lines.filter(s=>s.startsWith('RECIPIENT_PROOF\t')||s.startsWith('RECIPIENT_UNKNOWN\t'));
  for(const row of comments){const bodyHash=createHash('sha256').update(row.commentBody).digest('hex');
    const matched=proofLines.map(s=>s.split('\t')).filter(f=>f[1]===videoId&&f[2]===row.douyinId&&f[3]===bodyHash);
    if(matched.length>1)throw Error('recipient原件关联不唯一');
    if(!matched.length)continue;
    const f=matched[0];
    if(f[0]==='RECIPIENT_UNKNOWN'){row.recipientEvidence={version:1,status:'unknown',reason:'native_profile_missing'};continue;}
    if(!recipientScope?.runDir||f.length!==6)throw Error('recipient缺本run读取scope');
    const st=lstatSync(f[4]);
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600||st.size>10*1024*1024||realpathSync(resolve(join(f[4],'..')))!==realpathSync(recipientScope.runDir))throw Error('recipient私有工件越界');
    const bytes=readFileSync(f[4]);if(createHash('sha256').update(bytes).digest('hex')!==f[5])throw Error('recipient私有工件hash不符');
    const evidence=JSON.parse(bytes),scope={line_key:recipientScope.lineKey,run:recipientScope.run,douyin_id:row.douyinId,nickname:row.nickname,comment_body:row.commentBody,comment_body_sha256:bodyHash,video_url:row.sourceVideoUrl};
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(evidence.receipt_id||'')||resolve(f[4])!==resolve(recipientScope.runDir,`${evidence.scope.profile_eid}-recipient-${evidence.receipt_id}.json`))throw Error('recipient工件独享命名不符');
    recipientProof.validateEvidence(evidence,scope,{companyBinding:recipientScope.companyBinding});
    if(evidence.scope.profile!==recipientScope.profile||evidence.scope.video_id!==videoId||evidence.scope.source_run!==(recipientScope.sourceRun||null))throw Error('recipient采集profile或VID错位');
    row.recipientEvidence=evidence;
  }
  if(Number(marker[3])!==comments.length||marker[2]==='no_comments'&&comments.length)throw Error('采集完成数量与评论证据不符');
  if(marker[2]==='no_comments'){if(lines.filter(s=>s.startsWith(`COLLECTION\t${videoId}\t`)).length!==1)throw Error('NO_COMMENTS_EVIDENCE_UNVERIFIED');verifyNoComments({runDir:recipientScope?.runDir,run:recipientScope?.run,videoId});}
  return comments;
}

export function createHandlers({root,env,rpc,execute=execInput,sourceCommit,taskId,outreachScope=null,centralLease,preflightMetadata,preflightRuntime,scoringRuntime,phoneRuntime}) {
  const trustedScoring=isNativeScoringWorkflow(scoringRuntime),trustedPhone=isNativePhoneRuntime(phoneRuntime);
  const trustedPreflight=isPreflightRuntime(preflightRuntime);if(trustedPreflight)preflightMetadata=preflightRuntime.metadata;
  const sampleInput=commentSamplingInput(env),collectionBudget=collectionBudgetSeconds(env),collectionBudgetExplicit=Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS');
  if(sampleInput||(env.WFR_RUN_DIR&&existsSync(join(env.WFR_RUN_DIR,'run-definition.json'))))assertCommentSampling(readFrozen(env.WFR_RUN_DIR),env);
  const {P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:line}=env;
  const mmvDeviceRuntime=env.WFR_HOSTKEY==='mmv'&&env.LEADGEN_MMV_DEVICE_RUNTIME==='1';
  // 与controller同一宿主政策；所有原生调用必须沿用已核客户端及既有server。
  const hostPolicy=join(env.HOME,'.config/zenithjoy/adb-service.json');
  const managedAdb=Object.hasOwn(env,'ZJ_ADB_HOST_CONFIG')||existsSync(hostPolicy)||(()=>{try{return lstatSync(hostPolicy).isSymbolicLink();}catch{return false;}})();
  const adbClient=managedAdb?join(root,'adb-managed-client.py'):(env.DOUYIN_ADB_BIN||(mmvDeviceRuntime?'/opt/homebrew/bin/adb':'adb'));
  let locked=false,leased=[],qualified=[],historyScoped=0,preflightScope;
  const state={profile,line,run,source_commit:sourceCommit,task_id:taskId??null,run_id:canonicalRunId(env),outreach_scope:outreachScope};
  const needsCentralLock=['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW);
  let central=centralLease||null;
  const getCentral=()=>central??=createCentralDeviceLease({...(readPublicDomainBinding(env.WFR_RUN_DIR)?{publicDomainDirectory:env.WFR_RUN_DIR}:{}),brainUrl:env.BRAIN_URL,token:env.BRAIN_INTERNAL_TOKEN,
    deviceName:serial,taskId,runId:state.run_id,expectedProjectId:env.WF_BRAIN_PROJECT_ID,
    runSeconds:Number(env.WF_RUN_MAX_SECONDS||1800)});
  const verifyPhoneAssociation=async({frozen,binding,scope})=>{
    if(!needsCentralLock)throw Error('CENTRAL_TASK_ASSOCIATION_UNAVAILABLE');
    const receipt=await verifyCentralTaskAssociation({lease:getCentral(),workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:line,
      sourceCommit,runTag:run,taskId,projectId:env.WF_BRAIN_PROJECT_ID,deviceName:serial,runId:state.run_id,
      binding,scope,snapshotSha256:frozen.snapshot_sha256});
    return persistCentralTaskAssociation(env.WFR_RUN_DIR,receipt);
  };
  let collectionScope=null,discoveryScope=null,discoveryClosed=false;const collectionProgress=new Map();
  let qualificationClaimed=false,nativeSkillReads=0;const qualificationProgress=new Map(),qualificationAttempts=new Map();
  const recordDiagnostic=value=>{
    const file=join(env.WFR_RUN_DIR,'activity.log');
    appendFileSync(file,safeExecutionDiagnostic(value,env),{mode:0o600});
    chmodSync(file,0o600);
  };
  const nativeFailure=(error,command,args,opts)=>applyNativeFailure(error,command,args,opts,state);
  const bounded=async(command,args,opts={})=>{
    invalidateCollectionPhoneProof(state);
    let dispatchBudgetRejected=false;
    const unknownFile=opts.receipt?join(env.WFR_RUN_DIR,'native-operations',opts.receipt.operationId+'.unknown'):null;
    if(opts.receipt)state.nativeStopProof=null;
    try {
      if(central?.held)await central.ensure();
      collectionScope?.assertEvidence();
      discoveryScope?.assert();
      if(opts.discoveryMinimumRemainingMs&&state.budgetDeadline-Date.now()<opts.discoveryMinimumRemainingMs){dispatchBudgetRejected=true;throw Error('budget_exhausted');}
      const result=await execute(command,args,{...opts,
        timeoutMs:Math.max(1,Math.min(opts.timeoutMs||Number(opts.maxDurationS||120)*1000,
          state.budgetDeadline?state.budgetDeadline-Date.now():Number(env.WF_RUN_MAX_SECONDS||1800)*1000)),
        env:{...env,DOUYIN_LOCK_PID:String(process.pid),...opts.env,...discoveryScope?.env,...collectionScope?.env,...(unknownFile?{WFR_NATIVE_UNKNOWN_FILE:unknownFile}:{})}});
      collectionScope?.assertEvidence();
      recordDiagnostic(result.stderr||'');
      if(opts.receipt)state.nativeStopUnproven=true;
      if(unknownFile&&existsSync(unknownFile)||/\bNATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN\b/.test(result.stderr||'')){const error=Error('NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN');error.executionStopped=false;throw error;}
      if(/\bRECORD_CAPTURE_EXIT_UNVERIFIED\b/.test(result.stderr||'')){const error=Error('RECORD_CAPTURE_EXIT_UNVERIFIED');error.executionStopped=false;throw error;}
      if(!opts.discoveryLockRelease)discoveryScope?.assert();
      return result;
    } catch(error) {
      if(dispatchBudgetRejected)throw error; // 尚未调用execute；不伪造停止证明，也不污染原unknown。
      nativeFailure(error,command,args,opts);
      recordDiagnostic(error.stderr||'');throw error;
    }
  };
  const checked=async(command,args,opts={})=>{
    const r=await bounded(command,args,opts);
    if(r.code!==0){
      const error=Error(`动作失败 code=${r.code}: ${safeExecutionDiagnostic(r.stderr,env).slice(-500)||command}`);
      // A known failed readback stays failed. Its live producer must still seal;
      // only that lifecycle proof, never this exit code, can permit cleanup.
      if(collectionScope?.purpose==='readback'&&r.code===1)throw error;
      throw nativeFailure(error,command,args,opts);
    }
    return r.stdout;
  };
  const nativeReceipt=()=>({runDir:env.WFR_RUN_DIR,operationId:randomUUID(),runId:canonicalRunId(env),taskId,profile,serial,sourceCommit,owner:run,activity:state.currentActivity});
  const legacyPhone=createPhoneAction({env,state,profile,run,isLocked:()=>locked,isClosed:()=>discoveryClosed,getScope:()=>discoveryScope||collectionScope,checked,nativeReceipt,getAgentDeadline:()=>state.agentPhoneDeadline??null});
  const phone=(command,...args)=>trustedPhone&&state.currentActivity==='collect_videos'?phoneRuntime.phone(command,...args):legacyPhone(command,...args);
  const returnedContext=()=>{const frozen=readFrozen(env.WFR_RUN_DIR),binding=readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen);return {task_id:taskId??null,run_id:state.run_id,attempt:env.WFR_ATTEMPT,source_commit:sourceCommit,profile,serial,activity:'collection',owner:run,target:frozen.deployment.target,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id};};
  const queue=async(op,fields={})=>{if(trustedScoring)return scoringRuntime.queue(op,fields);if(trustedPhone&&['discover','discover_readback','inspect_videos'].includes(op))return phoneRuntime.queue(op,fields);if(op==='discover')discoveryScope?.assert();if(op==='sample_readback'&&state.budgetDeadline&&Date.now()>=state.budgetDeadline)throw Error('EXECUTION_DEADLINE: 采样PG读回预算已尽');const admissionOp=op==='admit_102g_comments'||op==='admit_102g_readback';const exactRecoveryOp=op==='recover_false_exclusion_102l'||op==='recover_false_exclusion_102l_readback';const rpcBudget=op==='discover'?225000:admissionOp?150000:60000;return (await rpc({kind:'queue',request:{op,line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,...(admissionOp||exactRecoveryOp?{}:{limit:Number(env.LEADGEN_LIMIT||2)}),...fields}},
    ['discover','comment_history','comment_history_readback','sample_readback','collect','collect_partial','renew_video',
      'admit_102g_comments','admit_102g_readback'].includes(op)?{timeoutMs:Math.max(1,Math.min(rpcBudget,state.budgetDeadline?state.budgetDeadline-Date.now():rpcBudget))}:{})).result;};
  const preflight=async()=>{
    if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'&&env.LEADGEN_SEND!=='1'){
      const flag=join(env.HOME,`bin-harvest/state/dm-paused-${profile}.flag`);
      if(existsSync(flag))return {status:'paused',reason:'私信暂停标记生效',sent:0};
      return {status:'paused',reason:'本批私信未授权，保持暂停',sent:0};
    }
    // 先核任务身份，公共空绑定不得在公司快照入口产生副作用。
    if(needsCentralLock)await getCentral().verifyTask({workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:line,sourceCommit,runTag:run});
    const mmvStep=mmvDeviceRuntime?{douyin_video_discovery:'101',douyin_video_processing:'102'}[env.WF_BRAIN_WORKFLOW]:undefined;
    // 正式冻结run的公司隔离与host无关；MMV旧直接入口仍沿原条件。
    const companyStep=(mmvDeviceRuntime||existsSync(join(env.WFR_RUN_DIR,'run-definition.json')))?{douyin_video_discovery:'101',douyin_video_processing:'102'}[env.WF_BRAIN_WORKFLOW]:undefined;
    if(companyStep) {
      // 101沿原取词入口先冻结归一化taskInputs；不能先以空输入建立同run快照。
      // getDiscovery只取公司关键词并构造handler，此处不会搜索或执行手机动作。
      if(companyStep==='101')await getDiscovery();
      const config=await queue('company_config',{step:companyStep,device_binding:{profile,device_serial:serial}});
      const binding=config?.device_binding;
      if(!config?.company_id||!config?.tenant_id||!Number.isSafeInteger(config?.version)||config.version<1||config.run_id!==run
        ||!binding||binding.company_id!==config.company_id||binding.tenant_id!==config.tenant_id||binding.version!==config.version||binding.run_id!==run
        ||binding.profile!==profile||binding.device_serial!==serial||binding.verification_status!=='verified'||binding.enabled!==true
        ||typeof binding.douyin_id!=='string'||!binding.douyin_id||binding.douyin_id.trim()!==binding.douyin_id)throw Error('COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED: company/run/account binding missing or mismatched');
      state.company_config={...config,expected_sender:binding.douyin_id};
      appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.company_config)+'\n',{mode:0o600});
    } else if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach') {
      state.company_config=await queue('company_config',{step:'104'});
      const account=state.company_config?.runtime_config?.platform_accounts?.find(a=>a.profile===profile&&a.verification_status==='verified'&&a.enabled===true);
      if(!account||account.device_serial!==serial||!account.douyin_id)throw Error(`COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED: profile=${profile} expected=${account?.device_serial||'missing'} actual=${serial}`);
      state.company_config.expected_sender=account.douyin_id;
      appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.company_config)+'\n',{mode:0o600});
    }
    if(needsCentralLock){
      const lease=getCentral();
      // 公司配置可能等待远端；取得设备租约前再次核原任务仍有效。
      await lease.verifyTask({workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:line,sourceCommit,runTag:run});
      await lease.acquire();
      appendFileSync(join(env.WFR_RUN_DIR,'central-lock-events.jsonl'),JSON.stringify({event:'acquired',task_id:taskId,run_id:state.run_id,
        device_name:serial,source_commit:sourceCommit,observed_at:new Date().toISOString()})+'\n',{mode:0o600});
    }
    const route=(await checked(env.DOUYIN_PYTHON_BIN||'python3',[join(root,'adb-existing-route.py'),serial,adbClient])).trim();
    if(!/^[1-9]\d{0,4}$/.test(route)||Number(route)>65535)throw Error('ADB_ROUTE_OUTPUT_INVALID');
    env.ADB_SERVER_SOCKET=`tcp:127.0.0.1:${route}`;env.DOUYIN_ADB_PORT=route;
    delete env.ANDROID_ADB_SERVER_PORT;delete env.ANDROID_ADB_SERVER_ADDRESS;
    const device=await checked(adbClient,['-s',serial,'get-state']);
    if(device.trim()!=='device')throw Error('设备未在线');
    const target=await phone('preflight');
    if(!target.split('\n').includes(`serial=${serial}`))throw Error('profile注册设备与本次serial不一致');
    const held=await phone('lock-acquire',run);
    if(!/^lock=(acquired|held)/m.test(held))throw Error('设备锁未确认');
    locked=true;
    const calls=await checked(adbClient,['-s',serial,'shell','dumpsys','telephony.registry']);
    const call=calls.match(/mCallState=(\d+)/)?.[1];if(call!=='0')throw Error('通话状态未知或设备通话中');
    await checked(adbClient,['-s',serial,'shell','input','keyevent','KEYCODE_WAKEUP']);
    await checked(adbClient,['-s',serial,'shell','input','swipe','600','2200','600','800','300']);
    await phone('close-app');
    await checked(adbClient,['-s',serial,'shell','am','start','-n','com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity']);
    await checked('/bin/sleep',['4']);
    const account=await phone('account-current',`${run}-account`);
    const id=account.match(/^douyin_id=(.+)$/m)?.[1]?.trim();
    if(!id)throw Error('当前账号未在本profile注册');
    // MMV101/102已在首个设备动作前取得本run PG绑定，不要求另维护账号缓存真源。
    if(!mmvStep){
      const registry=readFileSync(env.DOUYIN_ACCOUNT_REGISTRY||join(env.HOME,'.config/openclaw/douyin-account-routes.tsv'),'utf8');
      if(!registry.split('\n').some(s=>{const f=s.split('\t');return f[0]===profile&&f[1]===id;}))throw Error('当前账号未在本profile注册');
    }
    state.account=id;
    if(state.company_config&&state.company_config.expected_sender!==id)throw Error('COMPANY_ACCOUNT_IDENTITY_MISMATCH');
    if(companyStep==='102'){
      state.recipientCompanyBinding={...state.company_config.device_binding,line_key:lineRoutes.routeOf(line).key,source_run:env.LEADGEN_SOURCE_RUN||null};
      const file=join(env.WFR_RUN_DIR,run+'-company-binding.json'),bytes=JSON.stringify(state.recipientCompanyBinding);
      try{writeFileSync(file,bytes,{mode:0o600,flag:'wx'});}catch(error){
        if(error.code!=='EEXIST')throw error;
        const st=lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o777)!==0o600||readFileSync(file,'utf8')!==bytes)throw Error('COMPANY_COLLECTION_BINDING_FILE_CHANGED');
      }
      state.recipientCompanyBindingFile=file;state.recipientCompanyBindingSha=createHash('sha256').update(bytes).digest('hex');
    }
    const outreachProof=env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'?await outreach.preflight():{};
    return {device_verified:true,lock_acquired:true,call_state_idle:true,account_verified:true,douyin_id:id,
      ...(needsCentralLock?{central_lock_task_id:taskId,central_lock_run_id:state.run_id}:{}),...outreachProof};
  };
  const discoveryAction=createDiscoveryAction({root,env,state,sourceCommit,taskId,phone,bounded,queue,rpc,profile,run,isLocked:()=>locked,isClosed:()=>discoveryClosed,setClosed:v=>{discoveryClosed=v;},setScope:v=>{discoveryScope=v;},verifyPhoneAssociation});
  const getDiscovery=discoveryAction.getDiscovery;
  const intake=()=>verifyAgentUpstream({env,state,queue,sampleInput,profile,serial,line,run});
  const collectionTiming=()=>{
    const actionMax=collectionBudgetExplicit?collectionBudget+480:960;
    const now=Date.now(),start=env.WF_RUN_START_TS===undefined?null:Number(env.WF_RUN_START_TS),globalSeconds=Number(env.WF_RUN_MAX_SECONDS||1800);
    if(!Number.isSafeInteger(globalSeconds)||globalSeconds<1||(start!==null&&(!Number.isSafeInteger(start)||start<=0)))throw Error('评论采集全局预算或起点无效');
    const globalRemaining=start===null?globalSeconds*1000:start*1000+globalSeconds*1000-now;
    const activityRemaining=state.budgetDeadline?state.budgetDeadline-now:Infinity;
    const timeoutMs=Math.min(actionMax*1000,globalRemaining,activityRemaining);
    if(timeoutMs<=0)throw Error('EXECUTION_DEADLINE: 评论采集剩余预算已尽');
    return {action_max_duration_s:actionMax,timeout_ms:timeoutMs,global_remaining_ms:globalRemaining,activity_remaining_ms:Number.isFinite(activityRemaining)?activityRemaining:null};
  };
  const collectionBudgetVideos=[];
  const videoAction=createVideoAction({root,env,run,line,profile,serial,queue,bounded,nativeReceipt,collectionTiming,collectionBudget,collectionBudgetExplicit,collectionBudgetVideos,qualificationAttempts,sampleInput,state,getCollectionScope:()=>collectionScope,onHistoryScoped:()=>historyScoped++});
  const archiveQualification=v=>{
    const attempt=(qualificationAttempts.get(v.video_id)||0)-1;
    const folder=join(env.WFR_RUN_DIR,'qualification-attempts',v.video_id,String(attempt));
    mkdirSync(folder,{recursive:true,mode:0o700});const files=[];
    const sources=[env.WFR_RUN_DIR,join(env.PHONE_EVIDENCE_ROOT||'/private/tmp/openclaw-phone/evidence',profile)];
    for(const [index,source] of sources.entries()){
      if(!existsSync(source))continue;
      for(const name of readdirSync(source)){
        const relevant=index===0?[`${run}-recording-${v.video_id}.json`,`${run}-identity-${v.video_id}.json`,'qualification.tsv'].includes(name):name.startsWith(`${run}-v${v.video_id}-qualification`);
        if(!relevant)continue;const from=join(source,name),stat=lstatSync(from);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error('资格原件归档scope或大小不符');
        const to=join(folder,index+'-'+name);copyFileSync(from,to,constants.COPYFILE_EXCL);chmodSync(to,0o600);
        const digest=createHash('sha256').update(readFileSync(to)).digest('hex');files.push({source:from,path:to,sha256:digest,size:stat.size});
      }
    }
    writeFileSync(join(folder,'manifest.json'),JSON.stringify({video_id:v.video_id,run,attempt,files}),{flag:'wx',mode:0o600});
  };
  const consumedHistory=(result,v)=>{
    const file=join(env.WFR_RUN_DIR,`${run}-history-${v.video_id}.json`);
    const h=history.load(file,env.WFR_RUN_DIR,{line,run,source_run:env.LEADGEN_SOURCE_RUN||null,video_id:v.video_id,video_url:v.video_url});
    const consumed=[],ids=new Set();
    for(const line of result.stdout.split('\n').filter(s=>s.startsWith('HISTORY\t'))){
      const f=line.split('\t'),r=h.rows.get(f[3]);
      if(f.length!==6||f[1]!==v.video_id||h.receipt.status!=='verified'||!r||r.id!==f[2]||ids.has(r.id)||f[5]!==h.sha256||!/^[-_a-zA-Z0-9]+$/.test(f[4])||!f[4].startsWith(`${run}-v${v.video_id}-collection-`))throw Error('历史消费证据scope不符');
      const proof=JSON.parse(readFileSync(join(env.WFR_RUN_DIR,f[4]+'-history-readback.json'),'utf8'));
      if(proof.verified!==true||proof.id!==r.id||proof.video_id!==v.video_id||proof.douyin_id!==r.douyin_id||proof.comment_body!==r.comment_body||proof.history_sha256!==h.sha256||proof.identity_eid!==f[4]||proof.comment_context_verified!==true||!/^([a-f0-9]{64})$/.test(proof.profile_sha256)||!/^([a-f0-9]{64})$/.test(proof.returned_sha256))throw Error('历史新鲜身份或评论返回读回失败');
      ids.add(r.id);consumed.push({id:r.id,douyinId:r.douyin_id,commentBody:r.comment_body,identity_eid:f[4],history_sha256:h.sha256,...(r.source_video_url?{sourceVideoUrl:r.source_video_url}:{})});
    }
    return {consumed,status:h.receipt.status,receipt:h.receipt,sha256:h.sha256};
  };
  const outreach=createOutreachHandlers({env,state,phone,queue:(op,fields)=>(rpc({kind:'outreach',request:{op,line,run,limit:Number(env.LEADGEN_LIMIT||1),...fields}})).then(r=>r.result),rpc});
  const quarantineResources=async()=>{
    const proof={verified:false,device:{verified:serial==='none',applicable:serial!=='none'},videos:[],claim_receipt_unknown:state.qualificationClaimUnknown===true};
    if(serial!=='none')try{
      if(trustedPreflight)proof.device={applicable:true,...await preflightRuntime.quarantine()};else{
      const ctl=env.DOUYIN_PHONE_ADB||join(env.HOME,'.local/bin/douyin-phone-adb');
      const r=await execute(ctl,['--profile',profile,'lock-quarantine',run],{timeoutMs:20000,env:{...env}});
      proof.device={applicable:true,verified:r.code===0&&r.stdout.trim()===`lock=quarantined owner=${run} review_required=true`,receipt:safeExecutionDiagnostic(r.stdout,env)};}
    }catch(error){proof.device={applicable:true,verified:false,reason:safeExecutionDiagnostic(error.message,env)};}
    for(const video of leased)try{
      const r=(await rpc({kind:'queue',request:{op:'quarantine_video',line,run,video_id:video.video_id}},{timeoutMs:30000})).result;
      proof.videos.push({...r,video_id:video.video_id,verified:r?.quarantined===true&&r.video_id===video.video_id&&r.process_status===`待人工核验:${run}`});
    }catch(error){proof.videos.push({video_id:video.video_id,verified:false,reason:safeExecutionDiagnostic(error.message,env)});}
    proof.verified=proof.device.verified&&proof.videos.every(v=>v.verified)&&!proof.claim_receipt_unknown;
    writeFileSync(join(env.WFR_RUN_DIR,'resource-quarantine.json'),JSON.stringify(proof),{mode:0o600});return proof;
  };
  const agent={tools:new Map(),facts:{},sources:null,scoreScope:null,scored:new Set(),excluded:new Set(),videos:new Map(),captures:[],zeroComments:[],filters:[],native:new Map(),qualified:new Map(),collections:new Map(),identities:new Map(),recordings:new Map(),currentVideo:null,currentCandidate:null,attempts:0,comments:new Map(),collectionMeta:new Map(),histories:new Map(),batches:new Map(),screenIndex:0};
  const agentSave=(name,value)=>{
    const file=join(env.WFR_RUN_DIR,name),temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temp,file);
  };
  const assertAgentScope=async(scope,{readOnly=false}={})=>{
    if(scope.run!==run||scope.run_id!==state.run_id||scope.task_id!==taskId||scope.workflow!==env.WF_BRAIN_WORKFLOW
      ||scope.profile!==profile||scope.serial!==serial||scope.line!==line||scope.source_run!==(env.LEADGEN_SOURCE_RUN||null)
      ||scope.source_commit!==sourceCommit||scope.limit!==Number(env.LEADGEN_LIMIT||2))throw Error('AGENT_PRIMARY_SCOPE_MISMATCH');
    const frozen=readFrozen(env.WFR_RUN_DIR);
    if(frozen.execution_mode!=='agent'||frozen.snapshot_sha256!==scope.snapshot_sha256||frozen.deployment.source_commit!==sourceCommit)throw Error('AGENT_PRIMARY_FROZEN_SCOPE_MISMATCH');
    if(trustedScoring)await scoringRuntime.assertScope(scope);
    if(state.executionUnknown)throw Object.assign(Error('AGENT_PRIMARY_NATIVE_UNKNOWN'),{executionStopped:false});
    if(needsCentralLock){
      await getCentral().verifyTask({workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:line,sourceCommit,runTag:run});
      if(locked||trustedPreflight&&getCentral().held){await getCentral().ensure();await getCentral().verifyHeld();}
      else if(scope.activity==='cleanup'&&trustedPreflight&&preflightRuntime.canFinalizeNoLocal(scope)){if(!(preflightRuntime.zeroLocalStart(scope)&&!getCentral().held&&!getCentral().attempted))await getCentral().verifyHeld();}
      else if(scope.activity!=='preflight'&&!agent.facts.released)throw Error('AGENT_PRIMARY_RESOURCE_NOT_HELD');
      if(!readOnly&&leased.length&&scope.activity!=='cleanup'){
        const rows=await queue('inspect_videos',{video_ids:leased.map(v=>v.video_id)});
        if(!Array.isArray(rows)||leased.some(v=>!rows.some(row=>row.video_id===v.video_id&&row.process_status===`处理中:${run}`))){state.executionUnknown=true;throw Object.assign(Error('AGENT_PRIMARY_VIDEO_LEASE_LOST'),{executionStopped:false});}
      }
    }
    return true;
  };
  const prepareAgentResources=async scope=>{
    if(trustedScoring)await scoringRuntime.prepareActivity(scope);
    if(trustedPhone)await phoneRuntime.prepareActivity(scope,{assertResources:assertAgentScope});
    if(scope.activity==='preflight'){
      if(agent.facts.prepared)return;
      const metadataActive=()=>{if(Date.now()>=Math.min(scope.worker_deadline_ms??scope.deadline_ms,scope.deadline_ms))throw Object.assign(Error('PREFLIGHT_METADATA_DEADLINE'),{code:'PREFLIGHT_METADATA_DEADLINE'});preflightMetadata?.assertActive?.();};
      metadataActive();
      const step=env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?'101':'102';
      if(step==='101'){
        const fixed=assertDiscoveryInput(readFrozen(env.WFR_RUN_DIR),env);
        const reply=await (preflightMetadata||rpc)({kind:'keywords',line,run,limit:2,keywords:fixed.sources},{scope});
        metadataActive();
        if(canonical(reply.result)!==canonical(fixed.sources))throw Error('DISCOVERY_INPUT_SOURCE_MISMATCH');
        agent.sources=reply.result;agent.discoveryInput=fixed;
      }
      const config=preflightMetadata?(await preflightMetadata({kind:'queue',request:{op:'company_config',line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,limit:Number(env.LEADGEN_LIMIT||2),step,device_binding:{profile,device_serial:serial}}},{scope})).result:await queue('company_config',{step,device_binding:{profile,device_serial:serial}}),b=config?.device_binding;
      metadataActive();
      if(!config?.company_id||!config.tenant_id||config.run_id!==run||!Number.isSafeInteger(config.version)||config.version<1
        ||!b||b.company_id!==config.company_id||b.tenant_id!==config.tenant_id||b.version!==config.version||b.run_id!==run
        ||b.profile!==profile||b.device_serial!==serial||b.enabled!==true||b.verification_status!=='verified'||typeof b.douyin_id!=='string'||!b.douyin_id)throw Error('COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED');
      state.company_config={...config,expected_sender:b.douyin_id};state.companyConfig=config;
      appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.company_config)+'\n',{mode:0o600});
      await getCentral().verifyTask({workflowKey:env.WF_BRAIN_WORKFLOW,companyLine:line,sourceCommit,runTag:run});metadataActive();await getCentral().acquire();metadataActive();
      appendFileSync(join(env.WFR_RUN_DIR,'central-lock-events.jsonl'),JSON.stringify({event:'acquired',task_id:taskId,run_id:state.run_id,device_name:serial,source_commit:sourceCommit,observed_at:new Date().toISOString()})+'\n',{mode:0o600});
      if(trustedPreflight){
        preflightScope=await preflightRuntime.prepare(scope,{state,assertResources:assertAgentScope,verifyPhoneAssociation,central:getCentral()});
        const facts=preflightScope.snapshot();locked=facts.owned===true;agent.facts={...facts.facts,prepared:true,central_lock_task_id:taskId,central_lock_run_id:state.run_id};
      }else{
      const route=(await checked(env.DOUYIN_PYTHON_BIN||'python3',[join(root,'adb-existing-route.py'),serial,adbClient])).trim();
      if(!/^[1-9]\d{0,4}$/.test(route)||Number(route)>65535)throw Error('ADB_ROUTE_OUTPUT_INVALID');env.ADB_SERVER_SOCKET=`tcp:127.0.0.1:${route}`;env.DOUYIN_ADB_PORT=route;
      delete env.ANDROID_ADB_SERVER_PORT;delete env.ANDROID_ADB_SERVER_ADDRESS;
      if((await checked(adbClient,['-s',serial,'get-state'])).trim()!=='device')throw Error('设备未在线');
      if(!(await phone('preflight')).split('\n').includes(`serial=${serial}`))throw Error('profile注册设备与本次serial不一致');
      const held=await phone('lock-acquire',run);if(!/^lock=(acquired|held)/m.test(held))throw Error('设备锁未确认');locked=true;
      if((await checked(adbClient,['-s',serial,'shell','dumpsys','telephony.registry'])).match(/mCallState=(\d+)/)?.[1]!=='0')throw Error('通话状态未知或设备通话中');
      agent.facts={prepared:true,device_verified:true,lock_acquired:true,call_state_idle:true,central_lock_task_id:taskId,central_lock_run_id:state.run_id};
      }
      if(step==='102'){
        state.recipientCompanyBinding={...b,line_key:lineRoutes.routeOf(line).key,source_run:env.LEADGEN_SOURCE_RUN||null};
        state.recipientCompanyBindingFile=join(env.WFR_RUN_DIR,run+'-company-binding.json');
        const bytes=JSON.stringify(state.recipientCompanyBinding);writeFileSync(state.recipientCompanyBindingFile,bytes,{flag:'wx',mode:0o600});state.recipientCompanyBindingSha=createHash('sha256').update(bytes).digest('hex');
      }
    }else if(serial==='none'&&!state.company_config){
      state.company_config=await queue('company_config',{step:'103'});
      if(!state.company_config?.company_id||!state.company_config.tenant_id||!Number.isSafeInteger(state.company_config.version))throw Error('COMPANY_CONFIG_UNVERIFIED');
      appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.company_config)+'\n',{mode:0o600});
    }
    if(scope.activity==='collect_videos'&&!trustedPhone)discoveryScope=await startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld:locked,verifyPhoneAssociation});
    if(scope.activity==='collection'&&qualified.length)collectionScope=await startCollectionPhoneScope({root,env,state,sourceCommit,taskId,qualifiedVideoIds:qualified.map(v=>v.video_id),verifyPhoneAssociation});
    if(scope.activity==='cleanup'){
      if(trustedPreflight){preflightScope=await preflightRuntime.prepare(scope,{state,assertResources:assertAgentScope,verifyPhoneAssociation,central:getCentral()});return preflightScope.snapshot().resource_only_cleanup?{native_cleanup_not_required:true}:undefined;}
      if(state.collectionReturnedEvidence)collectionScope=await startCollectionReturnedScope({evidence:state.collectionReturnedEvidence,context:returnedContext(),purpose:'cleanup'});
      if(state.discoveryCleanupEvidence?.cleanup_phone_scope)discoveryScope=await startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld:locked,purpose:'cleanup',evidence:state.discoveryCleanupEvidence,verifyPhoneAssociation});
    }
  };
  const createAgentTools=async(activity,scope)=>{
    if(activity.key!==scope.activity||env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach')throw Error('AGENT_PRIMARY_SCOPE_MISMATCH');
    await assertAgentScope(scope);
    state.currentActivity=activity.key;state.budgetDeadline=scope.deadline_ms;state.agentPhoneDeadline=scope.deadline_ms;
    if(agent.tools.has(activity.key))throw Error('AGENT_PRIMARY_ACTIVITY_ALREADY_CREATED');
    const outcomes=[];
    const fields=raw=>Object.fromEntries(String(raw).split('\n').filter(row=>row.includes('=')).map(row=>{const i=row.indexOf('=');return [row.slice(0,i),row.slice(i+1).trim()];}));
    const evidenceRoot=env.LEADGEN_EVIDENCE_DIR||join('/private/tmp/openclaw-phone/evidence',profile);
    const readNative=file=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>4*1024*1024||realpathSync(resolve(file,'..'))!==realpathSync(evidenceRoot))throw Error('AGENT_PRIMARY_NATIVE_FILE_INVALID');return readFileSync(file,'utf8');};
    const nativeIdentity=(raw,eid,vid)=>{
      agent.panelSession=null;agent.detailIdentity=null;
      const f=fields(raw),p={verified:f.video_id===vid&&f.content_type==='video',expected_video_id:vid,observed_video_id:f.video_id,content_type:f.content_type,excluded_non_video:f.excluded_non_video==='true',evidence_id:eid,controller_stdout:raw,observed_at:new Date().toISOString()};
      agentSave(`${run}-identity-${vid}.json`,p);if(!p.verified)throw Error('AGENT_PRIMARY_VIDEO_IDENTITY_MISMATCH');agent.identities.set(vid,p);agent.detailIdentity={video_id:vid};return p;
    };
    const rowsFromXml=xml=>recipientProof.parseNativeCommentXml(xml).rows;
    const ownedPhone=async(command,...args)=>{
      if(trustedPreflight&&['preflight','cleanup'].includes(activity.key)){if(!preflightScope||preflightScope.activity!==activity.key)throw Error('PREFLIGHT_SCOPE_UNAVAILABLE');return preflightScope.phone(command,...args);}
      if(['open-video','current-video-link','back-evidence','back-to-results','open-search','commenter-identity','close-app','return-safe-desktop','detail-restored'].includes(command)){agent.panelSession=null;agent.detailIdentity=null;}
      const detail=['qualification','collection'].includes(activity.key)&&['open-video','current-video-link'].includes(command);
      if(!detail&&!['record-start','record-stop','record-extract-audio'].includes(command))return phone(command,...args);
      if(!locked||!(await phone('lock-refresh',run)).startsWith('lock=refreshed'))throw Error('AGENT_PRIMARY_LOCK_UNVERIFIED');
      const s=discoveryScope||collectionScope,ctl=env.DOUYIN_PHONE_ADB||join(env.HOME,'.local/bin/douyin-phone-adb');
      return checked(s?.zsh||ctl,[...(s?['-f',ctl]:[]),'--profile',profile,...(command==='open-video'?[]:['--lock-owner',run]),command,...args],{receipt:nativeReceipt(),timeoutMs:Math.max(1,scope.deadline_ms-Date.now()),...(detail?{env:{DOUYIN_DETAIL_PLAYBACK:'continuous_identity'}}:{})});
    };
    const validatePhone=async(command,args,s)=>{
      const noArgs=['wake','unlock','open-app','account-current','search-video-tab','search-video-cards','current-video-link','open-comments','record-start','record-stop','record-status','record-extract-audio','native-audio-evidence','close-app','return-safe-desktop','detail-restored'];
      if(noArgs.includes(command)&&args.length)throw Error('AGENT_PRIMARY_PHONE_INPUT_INVALID');
      if(['wake','unlock','open-app','close-app','return-safe-desktop','detail-restored'].includes(command))return [];
      if(command==='account-current')return [`${run}-account`];
      if(command==='open-search'){
        if(args.length!==1||!agent.sources?.some(source=>encodeURIComponent(typeof source==='string'?source:source.source||source.keyword)===args[0]))throw Error('AGENT_PRIMARY_KEYWORD_SCOPE_INVALID');
        agent.keyword=decodeURIComponent(args[0]);agent.sourceIndex=agent.sources.findIndex(source=>(typeof source==='string'?source:source.source||source.keyword)===agent.keyword)+1;return args;
      }
      if(command==='search-time-layer'){
        if(args.length)throw Error('AGENT_PRIMARY_FILTER_SCOPE_INVALID');
        if(!agent.sourceIndex)throw Error('AGENT_PRIMARY_KEYWORD_SCOPE_INVALID');
        return [scope.discovery_filters?.time_layer||env.LEADGEN_TIME_LAYER||'six_months',`${run}-src${agent.sourceIndex}-filter`,scope.discovery_filters?.sort||env.LEADGEN_SORT||'latest','unlimited','unlimited',scope.discovery_filters?.location||env.LEADGEN_LOCATION||'same_city'];
      }
      if(['search-video-tab','search-video-cards'].includes(command)){
        if(!agent.sourceIndex)throw Error('AGENT_PRIMARY_KEYWORD_SCOPE_INVALID');return [`${run}-src${agent.sourceIndex}-${command==='search-video-tab'?'vtab':'cards'}`];
      }
      if(command==='back-evidence')return [s.evidence_id];
      if(command==='search-grid-scroll'){
        if(args.length!==1||!['up','down'].includes(args[0])||agent.discoveryInput?.max_screens===1)throw Error('AGENT_PRIMARY_SCREEN_SCOPE_INVALID');return [s.evidence_id,args[0]];
      }
      if(command==='tap-evidence'){
        if(activity.key!=='collect_videos'||args.length!==2||!agent.grid?.some(row=>row.x===args[0]&&row.y===args[1]))throw Error('AGENT_PRIMARY_TAP_SCOPE_INVALID');
        if(agent.attempts>=(agent.discoveryInput?.max_attempts||agent.discoveryInput?.max_candidates||scope.limit))throw Error('AGENT_PRIMARY_ATTEMPT_LIMIT');
        const target=agent.grid.find(row=>row.x===args[0]&&row.y===args[1]);
        const raw=await phone('search-video-cards',s.evidence_id+'-fresh');
        const cards=String(raw).split('\n').map(row=>row.split('\t')).filter(f=>/^\d+$/.test(f[0]||'')&&/^\d+$/.test(f[1]||''));
        const fresh=cards.filter(f=>f[3]===target.title&&f[4]===target.author&&f[2]===target.duration);
        if(fresh.length!==1)throw Error('AGENT_PRIMARY_FRESH_CARD_UNVERIFIED');
        agent.currentCandidate={...target,x:fresh[0][0],y:fresh[0][1],keyword:agent.keyword};agent.attempts++;
        return [fresh[0][0],fresh[0][1],s.evidence_id];
      }
      if(command==='swipe-evidence'){
        if(activity.key!=='collection'||args.length!==1||!['up','down'].includes(args[0])||!agent.currentVideo)throw Error('AGENT_PRIMARY_SWIPE_SCOPE_INVALID');
        const vid=agent.currentVideo.video_id,eid=s.evidence_id+'-scroll';
        if(agent.panelSession?.video_id!==vid)throw Error('AGENT_PRIMARY_PANEL_SESSION_UNVERIFIED');
        const raw=await phone('ui-evidence',eid+'-panel'),parsed=recipientProof.parseNativeCommentXml(readNative(String(raw).trim())),viewport=parsed.scroll_viewport;
        if(parsed.strict_layout!==true||!viewport||!['left','top','right','bottom'].every(k=>Number.isSafeInteger(viewport[k]))||viewport.right-viewport.left<100||viewport.bottom-viewport.top<200)throw Error('AGENT_PRIMARY_SCROLL_VIEWPORT_UNVERIFIED');
        const x=Math.floor((viewport.left+viewport.right)/2),margin=Math.floor((viewport.bottom-viewport.top)/4),top=viewport.top+margin,bottom=viewport.bottom-margin;
        if(bottom-top<100)throw Error('AGENT_PRIMARY_SCROLL_VIEWPORT_UNVERIFIED');
        return [String(x),String(args[0]==='up'?bottom:top),String(x),String(args[0]==='up'?top:bottom),'500',s.evidence_id];
      }
      if(command==='current-video-link'){
        if(activity.key==='collect_videos'){
          if(!agent.currentCandidate)throw Error('AGENT_PRIMARY_LINK_SCOPE_INVALID');return [`${run}-candidate${agent.attempts}-link${trustedPhone?'':'-t1'}`,agent.keyword];
        }
        if(!agent.currentVideo)throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');return [`${run}-v${agent.currentVideo.video_id}-${activity.key}-identity`];
      }
      if(command==='open-video'){
        if(args.length!==1||!/^\d{16,24}$/.test(args[0]))throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');
        const matches=(activity.key==='collection'?qualified:leased).filter(v=>v.video_id===args[0]);if(matches.length!==1)throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');agent.currentVideo=matches[0];
        return [args[0],`${run}-v${args[0]}-${activity.key}-open`];
      }
      if(command==='open-comments'){
        const v=agent.currentVideo;if(!v||!agent.identities.get(v.video_id)?.verified||agent.detailIdentity?.video_id!==v.video_id)throw Error('AGENT_PRIMARY_VIDEO_IDENTITY_UNVERIFIED');return [`${run}-v${v.video_id}-collection-comments`];
      }
      if(command==='set-playback-speed'){
        if(args.length!==1||args[0]!=='3.0'||!agent.currentVideo)throw Error('AGENT_PRIMARY_RECORD_SCOPE_INVALID');return ['3.0',`${run}-v${agent.currentVideo.video_id}-qualification-speed`];
      }
      if(['record-start','record-status','record-stop','record-extract-audio','native-audio-evidence'].includes(command)){
        const v=agent.currentVideo;if(!v||!agent.identities.get(v.video_id)?.verified)throw Error('AGENT_PRIMARY_RECORD_SCOPE_INVALID');
        const eid=`${run}-v${v.video_id}-qualification-record`;
        if(command==='record-start'){
          const seconds=Number(env.QUEUED_VIDEO_RECORD_SECONDS||25);if(!Number.isSafeInteger(seconds)||seconds<10||seconds>105||scope.deadline_ms-Date.now()<seconds*1000+15000||agent.recordings.has(v.video_id))throw Error('AGENT_PRIMARY_RECORD_SCOPE_INVALID');
          agent.recordings.set(v.video_id,{expectedSeconds:seconds});return [eid,String(seconds),v.video_id];
        }
        if(command==='native-audio-evidence')return [s.evidence_id];
        if(!agent.recordings.has(v.video_id))throw Error('AGENT_PRIMARY_RECORD_SCOPE_INVALID');return [eid];
      }
      if(command==='commenter-identity'){
        if(args.length!==3||!agent.currentVideo)throw Error('AGENT_PRIMARY_COMMENT_SCOPE_INVALID');
        if(agent.panelSession?.video_id!==agent.currentVideo.video_id)throw Error('AGENT_PRIMARY_PANEL_SESSION_UNVERIFIED');
        const raw=await phone('ui-evidence',s.evidence_id+'-fresh-comment'),file=String(raw).trim(),rows=rowsFromXml(readNative(file));
        const matches=rows.filter(row=>!row.author&&String(row.x)===args[0]&&String(row.y)===args[1]&&row.nickname_b64===args[2]);if(matches.length!==1)throw Error('AGENT_PRIMARY_COMMENT_SCOPE_INVALID');
        const vid=agent.currentVideo.video_id,index=[...agent.comments.values()].filter(row=>row.video_id===vid).length+1;
        if(index>3*(scope.comment_limit||0))throw Error('AGENT_PRIMARY_COMMENT_LIMIT');
        agent.pendingComment={row:matches[0],video:agent.currentVideo,started:Math.floor(Date.now()/1000),index};
        return [...args,`${run}-v${vid}-collection-person${index}-t1`];
      }
      throw Error('AGENT_PRIMARY_PHONE_NOT_ALLOWED');
    };
    const primitivePhone=async(command,...args)=>{
      const startedAt=Date.now(),raw=await ownedPhone(command,...args);
      if(command==='account-current'){
        const id=fields(raw).douyin_id;if(!id||id!==state.company_config?.expected_sender)throw Error('COMPANY_ACCOUNT_IDENTITY_MISMATCH');state.account=id;agent.facts.account_verified=true;
      }
      if(command==='search-video-cards'){
        const f=fields(raw);if(f.video_tab!=='1'||!f.evidence||!agent.keyword)throw Error('AGENT_PRIMARY_SOURCE_IDENTITY_UNVERIFIED');
        if(!/^kw_matches=1$/m.test(await phone('search-kw-matches',agent.keyword,f.evidence)))throw Error('AGENT_PRIMARY_SOURCE_KEYWORD_MISMATCH');
        agent.grid=String(raw).split('\n').flatMap(row=>{const f=row.split('\t');return /^\d+$/.test(f[0]||'')&&/^\d+$/.test(f[1]||'')&&f[3]&&f[4]?[{x:f[0],y:f[1],duration:f[2],title:f[3],author:f[4]}]:[];});
        const receipt={source:agent.keyword,source_index:agent.sourceIndex,source_kind:'keyword',cards:agent.grid.length,verified:true,evidence_path:f.evidence,observed_at:new Date().toISOString()};
        agentSave(`${run}-source-${agent.sourceIndex}-readback.json`,receipt);
      }
      if(command==='search-time-layer'){
        const f=fields(raw),requested=scope.discovery_filters||{sort:env.LEADGEN_SORT||'latest',time_layer:env.LEADGEN_TIME_LAYER||'six_months',location:env.LEADGEN_LOCATION||'same_city'},effective=Object.fromEntries(['sort','time_layer','duration','scope','location'].map(k=>[k,f[k]]));
        if(effective.sort!==requested.sort||effective.time_layer!==requested.time_layer||effective.location!==requested.location||effective.duration!=='unlimited'||effective.scope!=='unlimited')throw Error('DISCOVERY_FILTER_MISMATCH');
        agent.filters.push({invocation:agent.filters.length+1,evidence_id:args[1],verified:true,raw_stdout:raw,raw_sha256:createHash('sha256').update(raw).digest('hex'),effective});
        agentSave(state.run_id+'-filter-readback.json',{version:1,run_id:state.run_id,run,profile,source_commit:sourceCommit,requested,receipts:agent.filters});
      }
      if(command==='current-video-link'){
        const f=fields(raw);
        if(activity.key==='collect_videos'){
          const candidate=agent.currentCandidate;if(f.content_type!=='video'||!/^\d{16,24}$/.test(f.video_id||'')||f.return_mode!=='results'||!candidate)throw Error('AGENT_PRIMARY_LINK_IDENTITY_UNVERIFIED');
          const metrics=discoveryMetrics.captureObservation({...(trustedPhone?{nativeMetrics:phoneRuntime.nativeMetrics}:{}),file:f.metrics_evidence,evidenceRoot,runDir:env.WFR_RUN_DIR,run,run_id:state.run_id,profile,source_commit:sourceCommit,line_key:lineRoutes.routeOf(line).key,video_id:f.video_id,video_url:f.resolved_url,evidence_id:f.metrics_evidence_id});
          const video={videoId:f.video_id,videoUrl:f.resolved_url,title:candidate.title,author:candidate.author,keyword:candidate.keyword,harvestBatch:run,metrics};
          agent.native.set(f.video_id,video);if(metrics.comment_total.value===0)agent.zeroComments.push({...video,reason:'confirmed_zero_comments'});
        }else nativeIdentity(raw,args[0],agent.currentVideo.video_id);
      }
      if(['record-start','record-stop','record-extract-audio'].includes(command)){
        const r=agent.recordings.get(agent.currentVideo.video_id);r[{'record-start':'started','record-stop':'stopped','record-extract-audio':'extracted'}[command]]=raw;
      }
      if(command==='open-comments'){
        agent.panelSession=null;
        const vid=agent.currentVideo.video_id,meta=agent.collectionMeta.get(vid)||{};meta.opened=raw;
        if(String(raw).startsWith('comments_opened=0\nreason=no_comments_on_this_video\n')){createNoComments({runDir:env.WFR_RUN_DIR,run,videoId:vid,profile,stdout:raw});meta.stop_reason='no_comments';}
        if(fields(raw).comments_opened==='1'){
          const file=fields(raw).evidence;
          if(file!==join(evidenceRoot,args[0]+'-panel.xml')||lstatSync(file).mtimeMs<Math.floor(startedAt/1000)*1000)throw Error('AGENT_PRIMARY_PANEL_SESSION_UNVERIFIED');
          const parsed=recipientProof.parseNativeCommentXml(readNative(file));
          if(agent.detailIdentity?.video_id!==vid)throw Error('AGENT_PRIMARY_PANEL_SESSION_UNVERIFIED');
          if(parsed.strict_layout===true)agent.panelSession={video_id:vid,session:randomUUID()};
        }
        agent.collectionMeta.set(vid,meta);
      }
      if(command==='commenter-identity'){
        const pending=agent.pendingComment,f=fields(raw),v=pending.video;
        if(!f.douyin_id||f.account_type!=='personal'||f.nickname!==pending.row.nickname)throw Error('AGENT_PRIMARY_COMMENT_NATIVE_IDENTITY_INVALID');
        const ownPath=env.OWN_ACCOUNTS_CONF||join(env.HOME,'bin-harvest/config/own-accounts.json'),own=ownAccounts.loadOwnAccounts(existsSync(ownPath)?ownPath:join(root,'config/own-accounts.json'));
        if(ownAccounts.isOwnAccount(f.nickname,f.douyin_id,own))throw Error('AGENT_PRIMARY_OWN_ACCOUNT_EXCLUDED');
        agent.panelSession=null;agent.detailIdentity=null;
        const videoEid=`${run}-v${v.video_id}-collection-after-card${pending.index}`,identityRaw=await phone('current-video-link',videoEid);
        nativeIdentity(identityRaw,videoEid,v.video_id);
        const p=recipientProof.capture({runDir:env.WFR_RUN_DIR,line,run,sourceRun:env.LEADGEN_SOURCE_RUN,videoId:v.video_id,videoUrl:v.video_url,profile,douyinId:f.douyin_id,nickname:f.nickname,commentBody:pending.row.body,started:pending.started,profilePath:f.profile_evidence,returnedPath:f.return_evidence,profileEid:args[3],videoEid,companyBindingFile:state.recipientCompanyBindingFile,companyBindingSha:state.recipientCompanyBindingSha});
        const receiptId=randomUUID(),row={nickname:f.nickname,douyinId:f.douyin_id,accountType:'personal',commentBody:pending.row.body,commentTime:pending.row.time,region:pending.row.region,sourceVideo:v.title,keyword:v.keyword||'',profileIp:f.profile_ip||'',profileUrl:'',sourceVideoUrl:v.video_url,recipientEvidence:JSON.parse(readFileSync(p.file,'utf8'))};
        const old=agent.histories.get(v.video_id),oldRow=old?.rows.get(history.key(row.douyinId,row.commentBody));
        let consumed;
        if(oldRow){
          const proof=history.proof(old,env.WFR_RUN_DIR,profile,args[3],oldRow.id,row.douyinId,row.commentBody,f.profile_evidence,f.return_evidence,pending.started);
          consumed={id:oldRow.id,douyinId:row.douyinId,commentBody:row.commentBody,sourceVideoUrl:oldRow.source_video_url||v.video_url,identity_eid:proof.identity_eid,history_sha256:old.sha256};
        }
        agent.comments.set(receiptId,{video_id:v.video_id,row,...(consumed?{history:consumed}:{})});agent.pendingComment=null;
        const {recipientEvidence,...publicRow}=row;return {stdout:raw,native_receipt:receiptId,comment:publicRow,historical_verified:!!consumed,navigation:{verified_video_id:agent.detailIdentity?.video_id||null,panel_session_available:false,next_phone_action:'open-comments'}};
      }
      if(command==='ui-evidence'){
        const file=String(raw).trim(),xml=readNative(file);
        if(activity.key==='cleanup')agent.facts.cleanup_xml=file;
        if(activity.key==='collection'&&agent.currentVideo){
          const parsed=recipientProof.parseNativeCommentXml(xml),meta=agent.collectionMeta.get(agent.currentVideo.video_id)||{};meta.latest_xml=file;
          if(parsed.footer_reached)meta.footer_evidence={file,sha256:createHash('sha256').update(xml).digest('hex')};agent.collectionMeta.set(agent.currentVideo.video_id,meta);
          return {stdout:raw,xml,comments:parsed.rows,footer_reached:parsed.footer_reached};
        }
        return {stdout:raw,xml};
      }
      if(command==='close-app')agent.facts.close_stdout=raw;
      if(command==='return-safe-desktop')agent.facts.desktop_stdout=raw;
      if(activity.key==='cleanup'&&command==='snapshot-evidence')agent.facts.cleanup_png=String(raw).split('\n')[0];
      if(activity.key==='cleanup'&&command==='ui-evidence')agent.facts.cleanup_xml=String(raw).trim();
      return raw;
    };
    const primitiveQueue=async(op,input)=>{
      if(op==='score_scope'&&agent.scoreScope)return structuredClone(agent.scoreScope);
      if(op==='claim_videos')state.qualificationClaimUnknown=true;
      const cachedPreflight=preflightMetadata&&activity.key==='preflight'&&op==='company_config';
      if(cachedPreflight){preflightMetadata.assertActive?.();if(Date.now()>=Math.min(scope.worker_deadline_ms??scope.deadline_ms,scope.deadline_ms)||!agent.facts.prepared||!state.company_config?.device_binding)throw Error('PREFLIGHT_METADATA_DEADLINE');}
      let value=cachedPreflight?structuredClone(state.company_config):await queue(op,input);
      if(op==='score_scope'){
        if(!Array.isArray(value?.ids)||!value.sources||new Set(value.ids).size!==value.ids.length||value.ids.some(id=>typeof value.sources[id]!=='string'||!value.sources[id]||scope.source_run!==null&&value.sources[id]!==scope.source_run))throw Error('AGENT_PRIMARY_SCORE_SCOPE_INVALID');
        const ids=value.ids.slice(0,scope.limit);value={...value,ids,sources:Object.fromEntries(ids.map(id=>[id,value.sources[id]]))};
      }
      outcomes.push({op,input,result:value});
      if(op==='claim_videos'){
        if(!Array.isArray(value)||value.some(v=>!state.intakeVideoIds?.includes(v.video_id))||value.length>scope.limit)throw Error('AGENT_PRIMARY_CLAIM_SCOPE_INVALID');
        leased=value;qualificationClaimed=true;state.qualificationClaimUnknown=false;
      }
      if(op==='discover'){
        const video=input.video;
        if(!['pending','matched','rejected'].includes(value?.status)||typeof value.inserted!=='boolean'||value.metrics_verified!==true||value.metrics_digest!==video.metrics.digest)throw Error('AGENT_PRIMARY_DISCOVERY_READBACK_MISSING');
        agent.videos.set(video.videoId,{...video,status:value.status,inserted:value.inserted});agent.captures.push({...video,status:value.status,inserted:value.inserted,observed_at:new Date().toISOString()});
      }
      if(op==='comment_history'){
        const file=join(env.WFR_RUN_DIR,`${run}-history-${input.video_id}.json`);agentSave(`${run}-history-${input.video_id}.json`,value);
        agent.histories.set(input.video_id,history.load(file,env.WFR_RUN_DIR,{line,run,source_run:env.LEADGEN_SOURCE_RUN||null,video_id:input.video_id,video_url:input.video_url}));
      }
      if(['collect','collect_partial'].includes(op)){
        const previous=agent.collections.get(input.video_id);
        if(!previous)throw Error('AGENT_PRIMARY_COLLECTION_COMMIT_UNVERIFIED');
        const stored=aggregateAgentCollectionCommit({previousInserted:previous.prior_inserted,receipt:value,videoId:input.video_id,comments:input.comments.length,historical:input.history.length});
        agent.collections.set(input.video_id,{...previous,stored,finalized:op==='collect'});
        if(op==='collect')leased=leased.filter(video=>video.video_id!==input.video_id);
      }
      if(op==='comment_history_readback'){
        const previous=agent.collections.get(input.video_id);if(!previous||value?.verified!==true)throw Error('AGENT_PRIMARY_HISTORY_READBACK_INVALID');previous.historyReadback=value;
      }
      if(op==='sample_readback'){
        const previous=agent.collections.get(input.video_id);if(!previous||value?.verified!==true||value.coverage!==previous.comments.length+previous.history.length)throw Error('AGENT_PRIMARY_COLLECTION_READBACK_INVALID');previous.pgReadback=value;
      }
      if(op==='score_scope'){
        if(!Array.isArray(value?.ids)||!value.sources||value.ids.some(id=>typeof value.sources[id]!=='string'||!value.sources[id]||scope.source_run!==null&&value.sources[id]!==scope.source_run))throw Error('AGENT_PRIMARY_SCORE_SCOPE_INVALID');
        agent.scoreScope=structuredClone(value);
      }
      if(op==='mark_leads'){
        if(!agent.scoreScope||!Array.isArray(value?.ids)||!Array.isArray(value.lead_ids)||new Set(value.ids).size!==value.ids.length||value.ids.some(id=>!input.ids.includes(id))||value.marked!==value.ids.length)throw Error('AGENT_PRIMARY_MARK_SCOPE_INVALID');
      }
      if(op==='bridge_outreach'){
        if(!Array.isArray(value?.ids)||!Array.isArray(value.comment_ids)||value.ids.length!==value.comment_ids.length||new Set(value.ids).size!==value.ids.length||value.comment_ids.some(id=>!input.comment_ids.includes(id)))throw Error('AGENT_PRIMARY_BRIDGE_SCOPE_INVALID');
      }
      if(op==='score'){
        if(!Array.isArray(value?.ids)||!Array.isArray(value.excluded_ids)||[...value.ids,...value.excluded_ids].some(id=>!input.ids.includes(id)))throw Error('AGENT_PRIMARY_SCORE_SCOPE_INVALID');
        value.ids.forEach(id=>agent.scored.add(id));value.excluded_ids.forEach(id=>agent.excluded.add(id));
        if(trustedScoring)appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),'SORT_STATS '+JSON.stringify(value)+'\n');
      }
      return value;
    };
    const validateInput=async(op,input)=>{
      if(['discover','discover_readback'].includes(op)){
        const id=input.video?.videoId??input.video?.video_id,actual=agent.native.get(id);
        if(!actual||actual.metrics.comment_total.value===0)throw Error(actual?'DISCOVERY_CONFIRMED_ZERO_COMMENTS':'AGENT_PRIMARY_NATIVE_VIDEO_MISSING');
        return {video:actual};
      }
      if(op==='inspect_videos'){
        const ids=env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?[...agent.videos.keys()]:state.intakeVideoIds;
        if(!Array.isArray(input.video_ids)||!Array.isArray(ids)||input.video_ids.some(id=>!ids.includes(id)))throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');
      }
      if(['renew_video','qualification_readback'].includes(op)&&!leased.some(v=>v.video_id===input.video_id))throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');
      if(['comment_history','comment_history_readback','collect','collect_partial','sample_readback'].includes(op)){
        const v=qualified.find(v=>v.video_id===input.video_id);if(!v||input.video_url!==v.video_url)throw Error('AGENT_PRIMARY_VIDEO_SCOPE_INVALID');
        if(['collect','collect_partial'].includes(op)){
          if((input.history||[]).length||!Array.isArray(input.comments))throw Error('AGENT_PRIMARY_COMMENT_SCOPE_INVALID');
          const batchKey=JSON.stringify([op,v.video_id,input.comments.map(ref=>ref?.native_receipt).sort()]);
          if(agent.batches.has(batchKey))return agent.batches.get(batchKey);
          const previous=agent.collections.get(v.video_id);if(previous?.finalized)throw Error('AGENT_PRIMARY_COLLECTION_ALREADY_FINALIZED');
          const fresh=input.comments.map(ref=>{if(!ref||Object.keys(ref).join(',')!=='native_receipt')throw Error('AGENT_PRIMARY_COMMENT_RECEIPT_REQUIRED');const p=agent.comments.get(ref.native_receipt);if(!p||p.video_id!==v.video_id)throw Error('AGENT_PRIMARY_COMMENT_SCOPE_INVALID');return p;});
          if(new Set(fresh.map(r=>JSON.stringify([r.row.douyinId,r.row.commentBody]))).size!==fresh.length)throw Error('AGENT_PRIMARY_COMMENT_DUPLICATE');
          const selected=mergeAgentCollectionRows({previous:previous?.selected||[],fresh,videoId:v.video_id,limit:scope.comment_limit});
          const h=agent.histories.get(v.video_id);if(!h)throw Error('AGENT_PRIMARY_HISTORY_SCOPE_MISSING');
          const consumed=selected.filter(p=>p.history).map(p=>p.history),comments=selected.filter(p=>!p.history).map(p=>p.row),meta=agent.collectionMeta.get(v.video_id)||{};
          const coverage=comments.length+consumed.length,stop_reason=coverage===scope.comment_limit?'quota_reached':meta.stop_reason==='no_comments'?'no_comments':meta.footer_evidence?'footer_reached':'partial';
          if(coverage>scope.comment_limit)throw Error('AGENT_PRIMARY_COMMENT_LIMIT');
          if(op==='collect'&&(!['footer_reached','no_comments'].includes(stop_reason)))throw Error('AGENT_PRIMARY_COLLECTION_FOOTER_UNVERIFIED');
          agent.collections.set(v.video_id,{video_id:v.video_id,video_url:v.video_url,operation:op,comments,history:consumed,historyReceipt:h.receipt,history_sha256:h.sha256,stop_reason,rescan_count:[...agent.comments.values()].filter(p=>p.video_id===v.video_id).length,avatar_recovery_count:0,selected,prior_inserted:previous?.stored?.inserted||0,...(meta.footer_evidence?{footer_evidence:meta.footer_evidence}:{})});
          const request={video_id:v.video_id,video_url:v.video_url,comments,history:consumed};agent.batches.set(batchKey,request);return request;
        }
        if(op==='sample_readback'){
          const saved=agent.collections.get(v.video_id);if(!saved?.stored)throw Error('AGENT_PRIMARY_COLLECTION_COMMIT_MISSING');
          return {video_id:v.video_id,video_url:v.video_url,rows:[...saved.history,...saved.comments].map(r=>({...(r.id?{id:r.id}:{}),douyinId:r.douyinId,commentBody:r.commentBody,sourceVideoUrl:r.sourceVideoUrl||v.video_url}))};
        }
        if(op==='comment_history_readback'){
          const saved=agent.collections.get(v.video_id);if(!saved?.stored)throw Error('AGENT_PRIMARY_COLLECTION_COMMIT_MISSING');return {video_id:v.video_id,video_url:v.video_url,history:saved.history};
        }
      }
      if(['score','score_recovery','score_readback','score_exclusion_readback','policy_review'].includes(op)){
        if(!agent.scoreScope||!Array.isArray(input.ids)||input.ids.some(id=>!agent.scoreScope.ids.includes(id)))throw Error('AGENT_PRIMARY_SCORE_SCOPE_INVALID');
        return {...input,sources:Object.fromEntries(input.ids.map(id=>[id,agent.scoreScope.sources[id]]))};
      }
      if(op==='claim_videos'){
        if(!Array.isArray(state.intakeVideoIds))throw Error('AGENT_PRIMARY_UPSTREAM_SCOPE_INVALID');
        return {video_ids:state.intakeVideoIds,config_required:true,prefer_matched:!!sampleInput};
      }
      if(op==='mark_readback'){
        const marked=outcomes.filter(row=>row.op==='mark_leads').at(-1)?.result;
        if(!marked||canonical(input.ids)!==canonical(marked.ids)||canonical(input.lead_ids)!==canonical(marked.lead_ids))throw Error('AGENT_PRIMARY_MARK_SCOPE_INVALID');
      }
      if(op==='bridge_readback'){
        const bridged=outcomes.filter(row=>row.op==='bridge_outreach').at(-1)?.result;
        if(!bridged||canonical(input.ids)!==canonical(bridged.ids||[]))throw Error('AGENT_PRIMARY_BRIDGE_SCOPE_INVALID');
      }
      if(op==='mark_leads'){
        if(!agent.scoreScope||agent.scoreScope.ids.length>scope.limit||agent.scoreScope.ids.some(id=>!agent.scored.has(id)&&!agent.excluded.has(id)))throw Error('AGENT_PRIMARY_SCORE_SCOPE_INCOMPLETE');
        return {ids:agent.scoreScope.ids.filter(id=>agent.scored.has(id))};
      }
      if(op==='bridge_outreach'){
        const marked=outcomes.filter(row=>row.op==='mark_leads').at(-1)?.result,readback=outcomes.filter(row=>row.op==='mark_readback').at(-1)?.result;
        if(!marked||readback?.verified!==true)throw Error('AGENT_PRIMARY_MARK_READBACK_MISSING');
        return {comment_ids:[...marked.ids]};
      }
      return input;
    };
    const qualify=async input=>{
      const v=leased.find(v=>v.video_id===input.video_id);if(!v||!agent.identities.get(v.video_id)?.verified)throw Error('AGENT_PRIMARY_VIDEO_IDENTITY_UNVERIFIED');
      let judgment,cached=v.judgment_status==='matched'&&v.judgment_config?.company_id===state.companyConfig?.company_id&&v.judgment_config?.version===state.companyConfig?.version;
      if(cached)judgment={verdict:'matched',kind:'cached',config:{...v.judgment_config,run_id:run}};
      else{
        const {buildRecordingProof}=await import('./leadgen-agent-artifacts.mjs'),r=agent.recordings.get(v.video_id);
        if(!r?.started||!r.stopped||!r.extracted)throw Error('AGENT_PRIMARY_RECORDING_PROOF_MISSING');
        const audio=buildRecordingProof({runDir:env.WFR_RUN_DIR,scope:{run,video_id:v.video_id,serial},...r,evidenceRoot});
        const remote=`/tmp/qv-${run}-${v.video_id}.wav`;
        if(env.WFR_HOSTKEY!=='mmv'){
          const transport=env.LEADGEN_MMV_HOSTNAME&&env.LEADGEN_MMV_HOSTKEY_ALIAS?['-o','HostName='+env.LEADGEN_MMV_HOSTNAME,'-o','HostKeyAlias='+env.LEADGEN_MMV_HOSTKEY_ALIAS]:[];
          await checked('scp',[...transport,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',audio.audioPath,'mmv:'+remote]);
        }else{if(resolve(audio.audioPath)!==resolve(remote))copyFileSync(audio.audioPath,remote,constants.COPYFILE_EXCL);}
        judgment=(await rpc({kind:'qualify',request:{cmd:'judge',line,run,sourceRun:env.LEADGEN_SOURCE_RUN||undefined,videoId:v.video_id,audio:remote}})).result;
      }
      if(!['matched','rejected'].includes(judgment?.verdict))throw Error('AGENT_PRIMARY_QUALIFICATION_PENDING');
      agent.qualified.set(v.video_id,{video_id:v.video_id,cached,judgment});return judgment;
    };
    const qualificationReadback=async input=>{
      const rows=await queue('inspect_videos',{video_ids:[input.video_id]}),r=agent.qualified.get(input.video_id);
      if(!r||!Array.isArray(rows)||rows.length!==1||rows[0].judgment_status!==r.judgment.verdict)throw Error('AGENT_PRIMARY_QUALIFICATION_READBACK_MISSING');
      r.readback=rows[0];if(r.judgment.verdict==='matched'&&!qualified.some(v=>v.video_id===input.video_id))qualified.push(leased.find(v=>v.video_id===input.video_id));return rows[0];
    };
    const settle=async({proof}={})=>{
      if(trustedPreflight&&activity.key==='preflight'){await preflightScope.close(proof);if(trustedPhone&&(await phoneRuntime.closeActivity(proof)).execution_stopped!==true)throw Error('NATIVE_PHONE_PREFLIGHT_STOP_UNKNOWN');}
      const last=op=>outcomes.filter(row=>row.op===op).at(-1)?.result;
      if(activity.key==='preflight'){
        if(!agent.facts.account_verified)throw Error('COMPANY_ACCOUNT_IDENTITY_UNVERIFIED');return {...agent.facts,douyin_id:state.account};
      }
      if(activity.key==='source')return {sources:agent.sources,source_count:agent.sources?.length||0};
      if(activity.key==='collect_videos'){
        const videos=[...agent.videos.values()],ids=videos.map(v=>v.videoId),actual=await queue('inspect_videos',{video_ids:ids});
        const missing=ids.filter(id=>!actual?.some(r=>r.video_id===id&&r.line_key===lineRoutes.routeOf(line).key)).length;
        const counts={sources:agent.sources?.length||0,sources_succeeded:agent.filters.length?1:0,source_failed:0,cards:agent.grid?.length||0,attempted:agent.attempts,opened:agent.attempts,linked:agent.native.size,persisted:videos.length,created:videos.filter(v=>v.inserted).length,reused:videos.filter(v=>!v.inserted).length,duplicate:agent.captures.length-videos.length,failed:0,screens:agent.grid?1:0,missing_identity:0,non_video:0,relocation_skipped:0,zero_comments:agent.zeroComments.length};
        const d=agent.discoveryInput,request={...(d?{schema_version:d.schema_version,max_attempts:d.max_attempts,max_candidates:d.max_candidates,max_screens:1,source_sha256:d.source_sha256}:{}),keywords:agent.sources,source_kind:'keyword',sort:scope.discovery_filters?.sort||env.LEADGEN_SORT||'latest',time_layer:scope.discovery_filters?.time_layer||env.LEADGEN_TIME_LAYER||'six_months',location:scope.discovery_filters?.location||env.LEADGEN_LOCATION||'same_city',target_count:scope.limit,max_duration_s:Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||2400)};
        const stop_reason=videos.length>=scope.limit?'limit_reached':agent.attempts>=(d?.max_attempts||d?.max_candidates||scope.limit)?'attempt_limit_reached':'agent_stopped';
        agentSave('discovery-progress.json',{run,profile,request,observed_at:new Date().toISOString(),counts,videos,captures:agent.captures,zero_comment_candidates:agent.zeroComments,pending_capture:null,failures:[],known_gaps:[],relocation_reveals:[],identity_enrichments:[],stop_reason,all_results_scanned:false});
        let outcome={request,counts,videos,captures:agent.captures,failures:[],known_gaps:[],stop_reason,all_results_scanned:false,source_completed:Number(agent.filters.length>0&&!!agent.grid),filter_invocations:agent.filters.length,persisted:counts.created,candidates:videos.length,videos_pushed:counts.created,video_manifest_readback_failures:missing,manifest_verified:Number(missing===0),...(missing||!agent.filters.length||stop_reason==='agent_stopped'?{status:'partial'}:{})};
        if(discoveryScope){outcome=await discoveryScope.finish(outcome);state.discoveryCleanupEvidence=outcome;discoveryClosed=true;await discoveryScope.close();discoveryScope=null;}
        return outcome;
      }
      if(activity.key==='dedup'){if(!agent.intake)throw Error('AGENT_PRIMARY_UPSTREAM_READBACK_MISSING');return agent.intake;}
      if(activity.key==='qualification'){
        const {recordQualificationResult}=await import('./leadgen-agent-artifacts.mjs');
        return recordQualificationResult({runDir:env.WFR_RUN_DIR,scope:{run,source_commit:sourceCommit,company_id:state.companyConfig?.company_id,company_version:state.companyConfig?.version},leased,results:[...agent.qualified.values()]});
      }
      if(activity.key==='collection'){
        const {recordCollectionResult}=await import('./leadgen-agent-artifacts.mjs');
        let result=recordCollectionResult({runDir:env.WFR_RUN_DIR,evidenceRoot,scope:{run,run_id:state.run_id,source_commit:sourceCommit,line,line_key:lineRoutes.routeOf(line).key,source_run:env.LEADGEN_SOURCE_RUN,profile,serial,company_binding:state.recipientCompanyBinding},samplingInput:sampleInput,qualifiedVideoIds:qualified.map(v=>v.video_id),videos:[...agent.collections.values()]});
        if(collectionScope){result=await collectionScope.finish(result);state.collectionReturnedEvidence=result;await collectionScope.close();collectionScope=null;}
        return result;
      }
      if(activity.key==='scoring'){
        const readback=last('score_readback'),review=last('policy_review'),exclusion=last('score_exclusion_readback');
        const ids=[...agent.scored],excluded_ids=[...agent.excluded];
        if(!agent.scoreScope||!readback||readback.verified!==true||ids.some(id=>!readback.ids?.includes(id))||ids.length&&review?.verified!==true||excluded_ids.length&&exclusion?.verified!==true)throw Error('AGENT_PRIMARY_SCORE_READBACK_MISSING');
        agentSave(`${run}-scoring-readback.json`,readback);agentSave(`${run}-policy-review.json`,review||{status:'not_applicable',reason:excluded_ids.length?'excluded_scope':'empty_scope',rows:[]});
        if(exclusion)agentSave(`${run}-exclusion-readback.json`,exclusion);
        return {scored:ids.length,ids,excluded:excluded_ids.length,excluded_ids,scoring_readback_failures:readback.failures||0,exclusion_readback_failures:exclusion?.failures||0,policy_review_failures:ids.length===0||review?.verified===true?0:1,...(!ids.length&&!excluded_ids.length?{status:'empty'}:{})};
      }
      if(activity.key==='mark_leads'){
        if(trustedScoring&&agent.scoreScope?.ids.length===0&&agent.scored.size===0&&agent.excluded.size===0)return scoringRuntime.emptyMarkResult();
        const marked=last('mark_leads'),readback=last('mark_readback'),bridge=last('bridge_outreach'),bridgeReadback=last('bridge_readback');
        if(!marked||readback?.verified!==true||!bridge||bridgeReadback?.verified!==true)throw Error('AGENT_PRIMARY_MARK_READBACK_MISSING');
        agentSave(`${run}-mark_leads-readback.json`,readback);agentSave(`${run}-bridge-readback.json`,bridgeReadback);
        return {...marked,bridge,mark_leads_readback_failures:readback.failures||0,bridge_readback_failures:(bridgeReadback.failures||0)+(bridge.verified===false?1:0),...(bridge.verified===false?{status:'partial'}:{})};
      }
      if(activity.key==='cleanup'){
        if(trustedPreflight&&preflightScope.snapshot().resource_only_cleanup){await preflightScope.close(proof);if(trustedPhone&&(await phoneRuntime.closeActivity(proof)).execution_stopped!==true)throw Error('NATIVE_PHONE_CLEANUP_STOP_UNKNOWN');return {status:'needs_review',physical_cleanup_not_required:true,close_app_attempts:0,safe_desktop_visible:0,lock_released:0};}
        if(trustedPreflight){await preflightScope.close(proof,{close_stdout:agent.facts.close_stdout,desktop_stdout:agent.facts.desktop_stdout,xml:readNative(agent.facts.cleanup_xml),png:readFileSync(agent.facts.cleanup_png)});if(trustedPhone&&(await phoneRuntime.closeActivity(proof)).execution_stopped!==true)throw Error('NATIVE_PHONE_CLEANUP_STOP_UNKNOWN');}
        const nativeOptions=trustedPreflight?preflightRuntime.desktopVerificationOptions():undefined;
        if(!agent.facts.close_stdout||!agent.facts.desktop_stdout||!agent.facts.cleanup_png||!agent.facts.cleanup_xml)throw Error('AGENT_PRIMARY_CLEANUP_NATIVE_MISSING');
        if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'){
          const expected={run,run_id:state.run_id,source_commit:sourceCommit,profile,serial};
          const proof=captureCleanupReadback({runDir:env.WFR_RUN_DIR,evidenceRoot,scope:expected,close_stdout:agent.facts.close_stdout,desktop_stdout:agent.facts.desktop_stdout,pngFile:agent.facts.cleanup_png,xmlFile:agent.facts.cleanup_xml,evidenceId:`${run}-${env.WFR_ATTEMPT}-cleanup-desktop`,nativeOptions});
          if(!verifyCleanupReadback({runDir:env.WFR_RUN_DIR,scope:expected,digest:proof.digest,nativeOptions}))throw Error('CLEANUP_NATIVE_READBACK_INVALID');agent.facts.cleanup_proof=proof;
        }else{
          const {verifyAgentDesktopNative}=await import('./discovery-cleanup-readback.mjs');
          const pngStat=lstatSync(agent.facts.cleanup_png);
          if(!pngStat.isFile()||pngStat.isSymbolicLink()||pngStat.size>10*1024*1024||realpathSync(resolve(agent.facts.cleanup_png,'..'))!==realpathSync(evidenceRoot))throw Error('AGENT_PRIMARY_NATIVE_FILE_INVALID');
          const png=readFileSync(agent.facts.cleanup_png),xml=readNative(agent.facts.cleanup_xml);
          verifyAgentDesktopNative(agent.facts.close_stdout,agent.facts.desktop_stdout,xml,png,nativeOptions);
          agentSave('agent-cleanup-readback.json',{run_id:state.run_id,source_commit:sourceCommit,profile,serial,close_stdout:agent.facts.close_stdout,desktop_stdout:agent.facts.desktop_stdout,png_sha256:createHash('sha256').update(png).digest('hex'),xml_sha256:createHash('sha256').update(xml).digest('hex')});
        }
        await discoveryScope?.seal();return {close_app:true,close_app_attempts:1,safe_desktop:true,safe_desktop_visible:1,lock_released:0,no_lock:false,cleanup_readback_verified:1,failures:[]};
      }
      throw Error('AGENT_PRIMARY_RESULT_ADAPTER_UNAVAILABLE');
    };
    const release=async()=>{
      if(activity.key!=='cleanup'||state.executionUnknown||!agent.facts.cleanup_proof&&env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'&&!(trustedPreflight&&preflightScope.snapshot().resource_only_cleanup))throw Error('AGENT_PRIMARY_CLEANUP_UNVERIFIED');
      for(const v of leased){const r=await queue('release_video',{video_id:v.video_id});if(r.released!==true)throw Error('AGENT_PRIMARY_VIDEO_RELEASE_UNVERIFIED');}
      let localRelease={lock_released:1,no_lock:true};if(trustedPreflight)localRelease=await preflightRuntime.release();else{const raw=await phone('lock-release',run);if(!raw.startsWith('lock=released'))throw Error('AGENT_PRIMARY_LOCK_RELEASE_UNVERIFIED');}locked=false;
      const centralNotAcquired=trustedPreflight&&preflightRuntime.zeroLocalStart(scope)&&!getCentral().held&&!getCentral().attempted;const centralReleased=centralNotAcquired?false:await getCentral().release();if(!centralReleased&&!centralNotAcquired)throw Error('AGENT_PRIMARY_CENTRAL_RELEASE_UNVERIFIED');
      appendFileSync(join(env.WFR_RUN_DIR,'central-lock-events.jsonl'),JSON.stringify({event:centralNotAcquired?'not_acquired_no_release':'released',task_id:taskId,run_id:state.run_id,device_name:serial,observed_at:new Date().toISOString()})+'\n',{mode:0o600});
      await discoveryScope?.close();discoveryScope=null;await collectionScope?.close();collectionScope=null;agent.facts.released=true;
      return {...localRelease,central_lock_released:Number(centralReleased),...(centralNotAcquired?{central_lock_not_acquired:1}:{}),central_lock_task_id:taskId,central_lock_run_id:state.run_id,...(agent.facts.cleanup_proof?{cleanup_readback_digest:agent.facts.cleanup_proof.digest}:{})};
    };
    const tools=createLeadgenAgentTools({scope,runDir:env.WFR_RUN_DIR,primitives:{...(trustedScoring?{closeNativeScope:proof=>scoringRuntime.closeActivity(proof)}:{}),...(trustedPreflight?{closeNativeScope:async proof=>{const handle=preflightRuntime.current();const local=['preflight','cleanup'].includes(activity.key)?handle?await handle.close(proof):await preflightRuntime.closeUnstarted(scope,proof):{execution_stopped:!preflightRuntime.nativeState().execution_unknown};const native=trustedPhone?await phoneRuntime.closeActivity(proof,scope):{execution_stopped:true};return {execution_stopped:local?.execution_stopped===true&&native.execution_stopped===true,preflight:local,native};}}:{}),assertResources:assertAgentScope,executionState:()=>({native_stop_unproven:state.nativeStopUnproven===true||(trustedPhone&&phoneRuntime.nativeState().native_stop_unproven===true)||(trustedScoring&&scoringRuntime.nativeState().native_stop_unproven===true),execution_unknown:state.executionUnknown===true||(trustedPhone&&phoneRuntime.nativeState().execution_unknown===true)||(trustedScoring&&scoringRuntime.nativeState().execution_unknown===true)||(trustedPreflight&&preflightRuntime.nativeState().execution_unknown===true)}),prepare:prepareAgentResources,inspect:async()=>({account:state.account||null,company:state.company_config||null,leased_videos:leased,qualified_video_ids:qualified.map(v=>v.video_id),sources:agent.sources,cards:agent.grid||[],score_scope:agent.scoreScope,
      native_video_candidates:[...agent.native.values()].map(({metrics,...video})=>({...video,metrics:{likes:metrics.likes,comment_total:metrics.comment_total,comment_tier:metrics.comment_tier}})),
      native_comment_receipts:[...agent.comments].map(([native_receipt,p])=>({native_receipt,video_id:p.video_id,douyin_id:p.row.douyinId,nickname:p.row.nickname,comment_body:p.row.commentBody,historical_verified:!!p.history})),
      panel_session_available:!!agent.panelSession&&agent.panelSession.video_id===agent.currentVideo?.video_id,verified_detail_video_id:agent.detailIdentity?.video_id||null,
      business_input_examples:{discover:{video:{videoId:'从native_video_candidates选择'}},collect_partial:{video_id:'本轮合格VID',video_url:'本轮原链接',comments:[{native_receipt:'本工具返回的UUID'}],history:[]},sample_readback:{video_id:'同VID',video_url:'同原链接',rows:[]}},
      phone_arguments:{'open-search':['URL编码的冻结关键词'],'search-time-layer':[],'search-video-tab':[],'search-video-cards':[],'tap-evidence':['新鲜cards.x','新鲜cards.y'],'swipe-evidence':['up或down；server按真实评论列表派生手势'],'current-video-link':[],'open-video':['本轮已领VID'],'open-comments':[],'commenter-identity':['新鲜comment.x','新鲜comment.y','comment.nickname_b64'],'ui-evidence':[],'snapshot-evidence':[],'set-playback-speed':['3.0'],'record-start':[],'record-status':[],'record-stop':[],'record-extract-audio':[],'close-app':[],'return-safe-desktop':[]},
    }),
      queue:primitiveQueue,validateInput,keywords:async()=>agent.sources,verifyUpstream:async()=>agent.intake=await verifyAgentUpstream({env,state,queue,sampleInput,profile,serial,line,run}),qualify,qualificationReadback,settle,
      evidenceId:command=>activity.key==='cleanup'?`${run}-${env.WFR_ATTEMPT}-cleanup-desktop`:activity.key==='collection'&&agent.currentVideo?`${run}-v${agent.currentVideo.video_id}-collection-screen${++agent.screenIndex}-comments`:null,
      validatePhone,phone:primitivePhone,release,resourceUnknown:()=>{state.executionUnknown=true;},heartbeat:async()=>{
        await assertAgentScope(scope);
        if(trustedScoring)return {task_claim_verified:true};
        if(trustedPhone&&activity.key==='collect_videos'){await phoneRuntime.phone('lock-refresh',run);return {renewed:true,video_ids:[]};}
        if(trustedPreflight&&['preflight','cleanup'].includes(activity.key))return preflightScope.heartbeat();
        if(locked){const raw=(await phone('lock-refresh',run)).trim().split(/\s+/),fields=Object.fromEntries(raw.map(token=>token.split('=')));
          if(raw.length!==3||fields.lock!=='refreshed'||fields.owner!==run||!/^\d+s$/.test(fields.ttl||''))throw Error('AGENT_PRIMARY_LOCAL_LEASE_UNVERIFIED');}
        if(activity.key!=='cleanup')for(const v of leased){const result=await queue('renew_video',{video_id:v.video_id});if(result?.renewed!==true)throw Error('AGENT_PRIMARY_VIDEO_LEASE_UNVERIFIED');}
        return {renewed:true,video_ids:activity.key==='cleanup'?[]:leased.map(v=>v.video_id)};
      }}});
    if(trustedPhone)tools.bindOfficialAuthority=entry=>phoneRuntime.bindOfficialAuthority(entry);
    if(trustedScoring){tools.bindOfficialAuthority=entry=>scoringRuntime.bindOfficialAuthority(entry);const readResult=tools.getResult;tools.getResult=()=>({...readResult(),external_effect:scoringRuntime.nativeState().external_effect});}
    agent.tools.set(activity.key,tools);return tools;
  };
  return {state,preflight,createAgentTools,agentSupportsNativeScope:activity=>trustedPhone?phoneRuntime.supports(activity):trustedScoring?scoringRuntime.supports(activity):trustedPreflight&&preflightRuntime.supports(activity)===true,agentNativeState:()=>({... (trustedPhone?phoneRuntime.nativeState():trustedScoring?scoringRuntime.nativeState():{}),native_stop_unproven:state.nativeStopUnproven===true||(trustedPhone&&phoneRuntime.nativeState().native_stop_unproven===true)||(trustedScoring&&scoringRuntime.nativeState().native_stop_unproven===true),execution_unknown:state.executionUnknown===true||(trustedPhone&&phoneRuntime.nativeState().execution_unknown===true)||(trustedScoring&&scoringRuntime.nativeState().execution_unknown===true)||(trustedPreflight&&preflightRuntime.nativeState().execution_unknown===true)}),quarantineResources,beginCollectionReadback:async evidence=>{
      collectionScope=await startCollectionReturnedScope({evidence,context:returnedContext(),purpose:'readback'});
      return async()=>{try{await collectionScope.close();}finally{collectionScope=null;}};
    },handoffPhone:async(command,...args)=>{
      if(command==='native-audio-evidence'){
        if(args.length||nativeSkillReads>=2)throw Error('SKILL_NATIVE_READBACK_NOT_ALLOWED');
        return phone(command,`${run}-qualification-skill-native${++nativeSkillReads}`);
      }
      return phone(command,...args);
    },handoffHeartbeat:async activity=>{
      if(locked){const raw=(await phone('lock-refresh',run)).trim().split(/\s+/),fields=Object.fromEntries(raw.map(token=>token.split('=')));
        if(raw.length!==3||fields.lock!=='refreshed'||fields.owner!==run||!/^\d+s$/.test(fields.ttl||''))throw Error('Skill接手设备锁所有权续期未确认');}
      if(activity.key!=='cleanup')for(const v of leased){const receipt=await queue('renew_video',{video_id:v.video_id});if(receipt?.renewed!==true)throw Error('Skill接手原视频租约续期未确认');}
    },handoffContext:async()=>({profile,serial,line,run,account:state.account||null,company_id:(state.company_config||state.companyConfig)?.company_id||null,leased_video_ids:leased.map(v=>v.video_id),qualified_video_ids:qualified.map(v=>v.video_id),sampling_input:sampleInput}),
    source:async()=>(await getDiscovery()).source(),
    dedup:intake,
    collect_videos:discoveryAction.collect,
    qualification:async()=>{
      if(!state.companyConfig)state.companyConfig=await queue('company_config',{step:'102'});
      if(!state.companyConfig?.company_id||!state.companyConfig.version)throw Error('COMPANY_CONFIG_RECEIPT_MISSING');
      if(env.WF_BRAIN_WORKFLOW==='douyin_video_processing'&&!Array.isArray(state.intakeVideoIds))throw Error('102必须先核验101明确ID交接');
      if(state.producerDescriptor?.schema_version===2&&state.account!=='44997267357'
       ||state.producerDescriptor?.schema_version===3&&state.account!=='langzi63485')throw Error('PRODUCER_NATIVE_ACCOUNT_INVALID');
      if(state.qualificationClaimUnknown)throw Error('资格领取回执未知，禁止再次认领或伪造空批成功');
      if(!qualificationClaimed){
        state.qualificationClaimUnknown=true;
        leased=await queue('claim_videos',{config_required:true,...(Array.isArray(state.intakeVideoIds)?{video_ids:state.intakeVideoIds}:{}),...([2,3].includes(state.producerDescriptor?.schema_version)?{producer_descriptor:state.producerDescriptor}:sampleInput?{prefer_matched:true}:{})});
        if(!Array.isArray(leased))throw Error('资格领取缺合法原租约列表');
        qualificationClaimed=true;state.qualificationClaimUnknown=false;
      }
      // 未领取的输入只作诊断；本run工作集以实际租约为准，不扩大认领上限。
      state.unclaimedIntakeVideoIds=state.intakeVideoIds?.filter(id=>!leased.some(v=>v.video_id===id))||[];
      const failures=[];let recordingsRequired=0,mediaVerified=0,recordingSilentRejected=0,recordingOutcomesFailures=0,recordingsUnverified=0;
      for(const v of leased){
        if(qualificationProgress.get(v.video_id)?.settled)continue;
        const previous={recordingsRequired,mediaVerified,recordingSilentRejected,recordingOutcomesFailures,recordingsUnverified};
        let attempted=false,thrown=false,cachedJudgmentRun=null;
        try{
          await queue('renew_video',{video_id:v.video_id});
          const used=qualificationAttempts.get(v.video_id)||0;
          if(used>=2)throw Error('本VID资格恢复次数已尽');
          if(used)archiveQualification(v);
          qualificationAttempts.set(v.video_id,used+1);attempted=true;
        if(state.companyConfig&&v.judgment_status==='matched'&&v.judgment_config?.company_id===state.companyConfig?.company_id&&v.judgment_config?.version===state.companyConfig?.version){
          const identity=await videoAction('identity',v);
          if(identity.code===0){qualified.push(v);cachedJudgmentRun=v.judgment_config?.run_id??null;}
          else failures.push({video_id:v.video_id,code:identity.code,reason:identity.stderr.slice(-500)});
          continue;
        }
        const result=await videoAction('qualification',v);
        appendFileSync(join(env.WFR_RUN_DIR,'qualification.tsv'),result.stdout);
        const recordingPath=join(env.WFR_RUN_DIR,`${run}-recording-${v.video_id}.json`);
        if(result.code!==0&&!existsSync(recordingPath)){
          // qv_open可在录音前失败；缺proof不能覆盖首错，也不能证明媒体音量成功或失败。
          recordingsUnverified++;
          failures.push({video_id:v.video_id,code:result.code,stage:'video_action',reason:safeExecutionDiagnostic(result.stderr||'资格动作失败，未读回本轮录音工件',env).slice(-1500)});
          continue;
        }
        recordingsRequired++;
        const marker=result.stdout.split('\n').find(s=>s.startsWith(`QUAL\t${v.video_id}\t`))?.split('\t');
        const verdict=marker?.[2];
        try{
          const path=recordingPath;
          if(lstatSync(path).isSymbolicLink())throw Error('本轮录音工件不得是symlink');
          const proof=JSON.parse(readFileSync(path,'utf8'));
          if(proof.version!==2||proof.run!==run||proof.video_id!==v.video_id||proof.evidence_id!==`${run}-v${v.video_id}-qualification${(qualificationAttempts.get(v.video_id)||1)>1?'-recovery'+(qualificationAttempts.get(v.video_id)-1):''}-record`)throw Error('本轮录音工件scope不符');
          if(result.code!==0&&proof.earliest_error){
            const first=proof.earliest_error;
            if(!['set_playback_speed','record_start','record_stop'].includes(first.phase)||!Number.isSafeInteger(first.exit_code)||first.exit_code<=0||first.exit_code>255||typeof first.stderr!=='string')throw Error('本轮录制首错工件无效');
            recordingsUnverified++;
            failures.push({video_id:v.video_id,code:first.exit_code,stage:first.phase,reason:safeExecutionDiagnostic(first.stderr,env).slice(-1500)});
            continue;
          }
          assertCaptureStrategy(proof);
          if(proof.capture_audio_mode==='output_pcm_sdk31'&&proof.decoded_audio.requested_seconds!==Number(env.QUEUED_VIDEO_RECORD_SECONDS||25))throw Error('RECORD_AUDIO_DECODE_UNVERIFIED');
          if(proof.capture_audio_verified!==true)throw Error(proof.audio_status==='silent'||Number.isFinite(proof.mean_volume_db)&&proof.mean_volume_db<=-80?'RECORD_CAPTURE_SILENT':'RECORD_CAPTURE_STRATEGY_UNVERIFIED');
          if(proof.media_volume_verified!==true||!Number.isSafeInteger(proof.media_volume)||proof.media_volume<=0)throw Error('本轮媒体音量未实际读回正数');
          mediaVerified++;
          if(proof.playback_verified!==true||proof.playback_proof_kind!=='native_audio'||proof.playback_package!=='com.ss.android.ugc.aweme')throw Error('本轮native播放未实际核验');
          const nativePhases=['start','end'].map(phase=>{const p=proof.native_audio?.[phase],prefix=proof.evidence_id+'-playback-'+phase;
            if(p?.state!=='started'||p.package_uid_verified!==true||p.foreign_started!==0||!['uid','pid','piid'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0)
              ||!['evidence','package_uid','uid_owners'].every((k,i)=>p[k+'_file']===prefix+'.'+['audio.txt','package-uid.txt','uid-owners.txt'][i]&&/^[0-9a-f]{64}$/.test(p[k+'_sha256']||'')))throw Error('本轮native音轨或UID/raw证据不符');return p;});
          if(nativePhases[0].uid!==nativePhases[1].uid)throw Error('本轮native音轨UID发生变化');
          if(proof.capture_audio_mode==='output_pcm_sdk31'){
            const restored=proof.native_audio_restored,prefix=proof.evidence_id+'-playback-restored';
            if(!restored||!['started','inactive'].includes(restored.state)||restored.uid!==nativePhases[0].uid||restored.package_uid_verified!==true||restored.foreign_started!==0||!['evidence','package_uid','uid_owners'].every((k,i)=>restored[k+'_file']===prefix+'.'+['audio.txt','package-uid.txt','uid-owners.txt'][i]&&/^[0-9a-f]{64}$/.test(restored[k+'_sha256']||'')))throw Error('RECORD_AUDIO_RESTORE_UNVERIFIED');
          }
          if(result.code===0&&verdict==='rejected'&&marker[3]==='recording_silent'){
            const receipt=await queue('reject_recording',{video_id:v.video_id,recording:proof});
            if(receipt?.verified!==true||receipt.video_id!==v.video_id||receipt.verdict!=='rejected'||receipt.kind!=='recording_silent')throw Error('本轮录音拒绝缺真实PG回执');
            writeFileSync(join(env.WFR_RUN_DIR,`${run}-recording-rejection-${v.video_id}.json`),JSON.stringify({run,video_id:v.video_id,recording_evidence_id:proof.evidence_id,...receipt}),{mode:0o600});
            recordingSilentRejected++;continue;
          }
          if(proof.audio_status!=='usable'||!Number.isFinite(proof.mean_volume_db)||proof.mean_volume_db<=-80)throw Error('本轮音轨不可用，禁止标题或旧转写冒充ASR');
        }catch(error){recordingOutcomesFailures++;failures.push({video_id:v.video_id,reason:error.message});continue;}
        if(result.code===0&&verdict==='matched')qualified.push(v);
        else if(result.code!==0||verdict!=='rejected'){recordingOutcomesFailures++;failures.push({video_id:v.video_id,code:result.code,reason:result.stderr.slice(-500)});}
        }catch(error){thrown=true;throw error;}finally{
          if(attempted)qualificationProgress.set(v.video_id,{settled:!thrown&&!failures.some(f=>f.video_id===v.video_id),cached_judgment_run:cachedJudgmentRun,recordingsRequired:recordingsRequired-previous.recordingsRequired,mediaVerified:mediaVerified-previous.mediaVerified,recordingSilentRejected:recordingSilentRejected-previous.recordingSilentRejected,recordingOutcomesFailures:recordingOutcomesFailures-previous.recordingOutcomesFailures,recordingsUnverified:recordingsUnverified-previous.recordingsUnverified});
        }
      }
      const totals=[...qualificationProgress.values()].reduce((all,row)=>Object.fromEntries(Object.keys(all).map(k=>[k,all[k]+row[k]])),{recordingsRequired:0,mediaVerified:0,recordingSilentRejected:0,recordingOutcomesFailures:0,recordingsUnverified:0});
      ({recordingsRequired,mediaVerified,recordingSilentRejected,recordingOutcomesFailures,recordingsUnverified}=totals);
      if(sampleInput)for(const v of qualified){
        const facts=qualificationProgress.get(v.video_id);
        if(!facts?.settled)throw Error('SAMPLING_ADMISSION_QUALIFICATION_INVALID');
        const snapshot=freezeQualificationIdentity({dir:env.WFR_RUN_DIR,run,videoId:v.video_id});
        qualificationProgress.set(v.video_id,{...facts,identity_snapshot_sha256:snapshot.sha256});
      }
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-qualification-progress.json`),JSON.stringify({run,source_commit:sourceCommit,leased_video_ids:leased.map(v=>v.video_id),qualified_video_ids:qualified.map(v=>v.video_id),videos:[...qualificationProgress].map(([video_id,facts])=>({video_id,...facts,attempts:qualificationAttempts.get(video_id)}))}),{mode:0o600});
      const verified=leased.filter(v=>{try {const proof=JSON.parse(readFileSync(join(env.WFR_RUN_DIR,`${run}-identity-${v.video_id}.json`),'utf8'));
        return proof.verified===true&&proof.observed_video_id===v.video_id&&proof.content_type==='video';}catch{return false;}}).length;
      return {claimed:leased.length,matched:qualified.length,videos_verified:verified,recordings_required:recordingsRequired,media_volume_verified:mediaVerified,media_volume_failures:recordingsUnverified?null:recordingsRequired>mediaVerified?recordingsRequired-mediaVerified:0,recordings_unverified:recordingsUnverified,recordings_silent_rejected:recordingSilentRejected,recording_outcomes_failures:recordingOutcomesFailures,failures,...(failures.length?{status:'partial'}:{})};
    },
    collection:async()=>{historyScoped=0;let comments=0,collected=0,sampled=0,rescans=0,avatarRecoveries=0,inserted=0,historyVerified=0,coverage=0,historyConsumed=0;const failures=[],sampleReceipts=[];
      collectionScope=qualified.length?await startCollectionPhoneScope({root,env,state,sourceCommit,taskId,qualifiedVideoIds:qualified.map(v=>v.video_id),verifyPhoneAssociation}):null;
      const counts=()=>[comments,collected,sampled,rescans,avatarRecoveries,inserted,historyVerified,coverage,historyConsumed,historyScoped];
      const add=values=>{[comments,collected,sampled,rescans,avatarRecoveries,inserted,historyVerified,coverage,historyConsumed,historyScoped]=counts().map((v,i)=>v+values[i]);};
      try{
      // 空候选也产出可读回的空工件；保留已有行，缺文件判定仍由统一裁判严格执行。
      appendFileSync(join(env.WFR_RUN_DIR,'comments.tsv'),'',{mode:0o600});
      for(const v of qualified){try{
        collectionTiming();
        const saved=collectionProgress.get(v.video_id);
        if(saved){
          const actual=await queue('inspect_videos',{video_ids:[v.video_id]});
          if(actual.length!==1||actual[0].video_id!==v.video_id||actual[0].judgment_status!=='matched'||actual[0].harvest_batch!==run||actual[0].process_status!==(saved.sampled?'处理中:'+run:'评论已采'))throw Error('COLLECTION_COMMITTED_VIDEO_READBACK_FAILED');
          for(let offset=0;offset<Math.max(1,saved.rows.length);offset+=50){const rows=saved.rows.slice(offset,offset+50),proof=await queue('sample_readback',{video_id:v.video_id,video_url:v.video_url,rows});if(proof.verified!==true||proof.video_id!==v.video_id||proof.coverage!==rows.length)throw Error('COLLECTION_COMMITTED_ROWS_READBACK_FAILED');}
          add(saved.counts);if(saved.sampleReceipt)sampleReceipts.push(saved.sampleReceipt);continue;
        }
        const before=counts();
        await queue('renew_video',{video_id:v.video_id});const result=await videoAction('collection',v);
        appendFileSync(join(env.WFR_RUN_DIR,'comments.tsv'),result.stdout);
        if(![0,7].includes(result.code)&&/^COLLECTION_ACCEPTANCE_PROBE_ABORTED$/m.test(result.stderr||''))throw Error('COLLECTION_ACCEPTANCE_PROBE_ABORTED');if(![0,7].includes(result.code)&&collectionScope?.panelFailure(result,v.video_id,state.collectionActionStartedAt))throw Error('COLLECTION_COMMENT_PANEL_READBACK_FAILED');
        if(![0,7].includes(result.code)&&/\bvideo_identity_mismatch\b/.test(result.stderr||''))throw Error('COLLECTION_VIDEO_IDENTITY_READBACK_FAILED');
        const rows=parseCollection(result,v.video_id,{allowPartial:true,recipientScope:{runDir:env.WFR_RUN_DIR,lineKey:lineRoutes.routeOf(line).key,run,sourceRun:env.LEADGEN_SOURCE_RUN,profile,companyBinding:state.recipientCompanyBinding}});
        const telemetry=result.stdout.split('\n').find(s=>s.startsWith(`RESCAN\t${v.video_id}\t`))?.split('\t')[2];
        if(!/^\d+$/.test(telemetry||''))throw Error('缺实际重扫计数，不能宣称采集通过');
        const avatarLines=result.stdout.split('\n').filter(s=>s.startsWith(`AVATAR_RECOVERY\t${v.video_id}\t`));
        const avatarTelemetry=avatarLines[0]?.split('\t')[2];
        if(avatarLines.length!==1||!/^\d+$/.test(avatarTelemetry||''))throw Error('缺实际头像恢复计数，不能宣称采集通过');
        rescans+=Number(telemetry);avatarRecoveries+=Number(avatarTelemetry);
        const partial=result.code===7;
        const marker=result.stdout.split('\n').find(s=>s.startsWith(`COLLECTION\t${v.video_id}\t`))?.split('\t');
        const quota=marker?.[2]==='sampled';
        if(quota&&(!sampleInput||Number(marker[5])!==sampleInput.comment_limit||Number(marker[4])!==sampleInput.comment_limit))throw Error('采样配额完成证据与冻结请求不符');
        if(sampleInput&&marker?.[2]==='collected'&&(marker[6]!=='footer=1'||Number(marker[5])!==sampleInput.comment_limit))throw Error('采样请求缺真实footer或配额完成证据');
        const old=consumedHistory(result,v);
        if(sampleInput&&(new Set([...old.consumed,...rows].map(r=>JSON.stringify([r.douyinId,r.commentBody]))).size!==old.consumed.length+rows.length||old.consumed.length+rows.length>sampleInput.comment_limit))throw Error('采样覆盖重复或超过冻结配额');
        const stored=await queue(partial||quota?'collect_partial':'collect',{video_id:v.video_id,video_url:v.video_url,comments:rows,history:old.consumed});
        if(quota&&(stored.coverage!==sampleInput.comment_limit||stored.coverage!==old.consumed.length+rows.length))throw Error('实际PG核验覆盖数未达到冻结采样配额');
        if(stored.history_verified!==old.consumed.length)throw Error('历史PG事务重验回执缺失');
        const readback=await queue('comment_history_readback',{video_id:v.video_id,video_url:v.video_url,history:old.consumed});
        if(readback.verified!==true||readback.video_id!==v.video_id||readback.history_verified!==old.consumed.length||!Array.isArray(readback.ids)||readback.ids.length!==old.consumed.length||old.consumed.some(r=>!readback.ids.includes(r.id)))throw Error('历史独立PG读回缺失');
        historyConsumed++;
        inserted+=stored.inserted;historyVerified+=stored.history_verified;coverage+=stored.coverage;
        writeFileSync(join(env.WFR_RUN_DIR,`${run}-history-consumption-${v.video_id}.json`),JSON.stringify({version:1,verified:true,line,line_key:old.receipt.line_key,run,source_run:old.receipt.source_run,video_id:v.video_id,video_url:v.video_url,history_status:old.status,history_sha256:old.sha256,ids:old.consumed.map(r=>r.id),rows:old.consumed.map(r=>({id:r.id,douyin_id:r.douyinId,comment_body:r.commentBody,source_video_url:r.sourceVideoUrl||v.video_url,identity_eid:r.identity_eid})),history_verified:stored.history_verified,coverage:stored.coverage}),{mode:0o600});
        if(sampleInput&&!partial){
          const stopReason=quota?'quota_reached':marker[2]==='no_comments'?'no_comments':'footer_reached';
          if(marker[2]==='collected'&&Number(marker[4])!==stored.coverage)throw Error('footer覆盖数与实际PG回执不符');
          const wanted=[...old.consumed,...rows].map(r=>({...(r.id?{id:r.id}:{}),douyinId:r.douyinId,commentBody:r.commentBody,sourceVideoUrl:r.sourceVideoUrl||v.video_url}));
          const pg=await queue('sample_readback',{video_id:v.video_id,video_url:v.video_url,rows:wanted});
          if(pg.verified!==true||pg.video_id!==v.video_id||pg.coverage!==stored.coverage||!Array.isArray(pg.rows)||pg.rows.length!==stored.coverage)throw Error('采样完整身份独立PG读回缺失');
          sampleReceipts.push({video_url:v.video_url,pg_rows:pg.rows,video_id:v.video_id,source_run:sampleInput.source_run,comment_limit:sampleInput.comment_limit,stop_reason:stopReason,coverage:stored.coverage,comments:stored.comments,comments_inserted:stored.inserted,history_verified:stored.history_verified,all_comments_scanned:!quota});
          writeFileSync(join(env.WFR_RUN_DIR,`${run}-sampling-readback.json`),JSON.stringify({run_id:canonicalRunId(env),sampling_input:sampleInput,verified:true,videos:sampleReceipts}),{mode:0o600});
        }
        comments+=stored.comments;
        if(partial)failures.push({video_id:v.video_id,code:7,reason:'采集在预算或停止边界结束，已保存核验评论，视频仍未采完',comments_saved:stored.comments});
        else if(quota){sampled++;}
        else {collected++;leased=leased.filter(p=>p.video_id!==v.video_id);}
        if(!partial)collectionProgress.set(v.video_id,{sampled:quota,counts:counts().map((value,i)=>value-before[i]),rows:[...old.consumed,...rows].map(r=>({...(r.id?{id:r.id}:{}),douyinId:r.douyinId,commentBody:r.commentBody,sourceVideoUrl:r.sourceVideoUrl||v.video_url})),sampleReceipt:sampleInput?sampleReceipts.at(-1):null});
      }catch(error){failures.push({video_id:v.video_id,reason:error.message});if(state.executionUnknown||error.message==='COLLECTION_ACCEPTANCE_PROBE_ABORTED')break;}}
      const outcome={sampling_receipts:sampleReceipts.map(({pg_rows,...publicReceipt})=>publicReceipt),fulfilled_sample_video_ids:sampleReceipts.map(v=>v.video_id),sampling_required_count:sampleInput?qualified.length:0,sampling_readback_count:sampleReceipts.length,collected,videos_collected:collected,videos_sampled:sampled,comment_sample_limit:sampleInput?.comment_limit||0,comments,comments_collected:comments,comments_inserted:inserted,history_verified:historyVerified,coverage,history_required_count:qualified.length,history_scoped_count:historyScoped,history_consumption_count:historyConsumed,history_failures:qualified.length-historyConsumed,history_scope_verified:Number(qualified.length>0&&historyScoped===qualified.length),history_consumption_readback:Number(qualified.length>0&&historyConsumed===qualified.length),videos_processed:collected+sampled,rescan_count:rescans,identity_rescan_count:rescans,avatar_recovery_count:avatarRecoveries,
        identity_rescan_rate:qualified.length?rescans/qualified.length:0,rescan_rate:qualified.length?rescans/qualified.length:0,failures,...(failures.length?{status:'partial'}:{})};
      const finished=collectionScope?await collectionScope.finish(outcome):outcome;
      if(finished.returned_phone_scope||finished.cleanup_phone_scope)state.collectionReturnedEvidence=finished;
      return finished;
      }finally{await collectionScope?.close();collectionScope=null;}},
    scoring:createScoringHandler({env,run,line,state,queue}),
    mark_leads:async()=>{const cursorFile=join(env.WFR_RUN_DIR,`${run}-mark-cursor.json`);
      const cursor=existsSync(cursorFile)?JSON.parse(readFileSync(cursorFile,'utf8')):null;
      const r=await queue('mark_leads',cursor?{cursor}:{});
      writeFileSync(cursorFile,JSON.stringify(r.next_cursor||null),{mode:0o600});
      const readback=await queue('mark_readback',{ids:r.ids,lead_ids:r.lead_ids});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-mark_leads-readback.json`),JSON.stringify(readback));
      const remaining=state.budgetDeadline?state.budgetDeadline-Date.now():180000;
      if(remaining<=15000)throw Error('EXECUTION_DEADLINE: 桥接剩余预算不足');
      const bridge=await queue('bridge_outreach',{remaining_ms:Math.min(165000,remaining-15000)});
      const bridgeReadback=await queue('bridge_readback',{ids:bridge.ids||[]});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-bridge-readback.json`),JSON.stringify(bridgeReadback),{mode:0o600});
      return {...r,bridge,mark_leads_readback_failures:readback.failures,bridge_readback_failures:bridgeReadback.failures+(bridge.verified===false?1:0),...(bridge.verified===false||!bridgeReadback.verified?{status:'partial'}:{})};},
    send_dm:outreach.send_dm,write_back:outreach.write_back,
    cleanup:async()=>{const failures=[];let closed=false,desktop=false,released=false,cleanupProof;
      if(state.collectionReturnedEvidence)collectionScope=await startCollectionReturnedScope({evidence:state.collectionReturnedEvidence,context:returnedContext(),purpose:'cleanup'});
      if(state.discoveryCleanupEvidence?.cleanup_phone_scope)discoveryScope=await startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld:locked,purpose:'cleanup',evidence:state.discoveryCleanupEvidence,verifyPhoneAssociation});
      try{
      try{await outreach.cleanup();}catch(error){failures.push({reason:error.message});}
      for(const v of leased)try{await queue('release_video',{video_id:v.video_id});}catch(error){failures.push({video_id:v.video_id,reason:error.message});}
      if(!locked&&failures.length===0&&!central?.attempted)return {status:'skipped',reason:'本批没有取得设备锁，无需清场',no_lock:true};
      if(locked){try{const refreshed=await phone('lock-refresh',run);if(!refreshed.startsWith('lock=refreshed'))throw Error('锁所有权不可确认');
        const close_stdout=await phone('close-app');closed=true;const desktop_stdout=await phone('return-safe-desktop');
        if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'){
          const evidenceId=`${run}-${env.WFR_ATTEMPT}-cleanup-desktop`,scope={run,run_id:state.run_id,source_commit:sourceCommit,profile,serial,...(readPublicDomainBinding(env.WFR_RUN_DIR)?{task_id:taskId}:{})};
          const pngFile=(await phone('snapshot-evidence',evidenceId)).split('\n')[0],xmlFile=(await phone('ui-evidence',evidenceId)).trim();
          cleanupProof=captureCleanupReadback({runDir:env.WFR_RUN_DIR,evidenceRoot:env.LEADGEN_EVIDENCE_DIR||join('/private/tmp/openclaw-phone/evidence',profile),scope,close_stdout,desktop_stdout,pngFile,xmlFile,evidenceId});
          if(!verifyCleanupReadback({runDir:env.WFR_RUN_DIR,scope,digest:cleanupProof.digest}))throw Error('CLEANUP_NATIVE_READBACK_INVALID');
        }
        desktop=true;
        await discoveryScope?.seal();
        const result=await phone('lock-release',run);if(!result.startsWith('lock=released'))throw Error('锁释放未确认');released=true;locked=false;
      }catch(error){failures.push({reason:error.message});}}
      let centralReleased=false;
      if(!locked&&central?.attempted)try{
        centralReleased=await central.release();
        if(centralReleased)appendFileSync(join(env.WFR_RUN_DIR,'central-lock-events.jsonl'),JSON.stringify({event:'released',task_id:taskId,
          run_id:state.run_id,device_name:serial,observed_at:new Date().toISOString()})+'\n',{mode:0o600});
      }catch(error){failures.push({reason:error.message});}
      return {close_app:closed,close_app_attempts:Number(closed),safe_desktop:desktop,safe_desktop_visible:Number(desktop),lock_released:Number(released),no_lock:!locked,failures,
        ...(central?{central_lock_released:Number(centralReleased),central_lock_task_id:taskId,central_lock_run_id:state.run_id}:{}),
        ...(cleanupProof?{cleanup_readback_verified:Number(desktop),cleanup_readback_digest:cleanupProof.digest}:{}),
        ...(failures.length?{status:'partial'}:{})};
      }finally{try{await discoveryScope?.close();}finally{discoveryScope=null;await collectionScope?.close();collectionScope=null;}}},
  };
}

