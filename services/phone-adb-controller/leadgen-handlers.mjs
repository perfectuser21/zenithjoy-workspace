import {verifyNoComments} from './no-comments-evidence.mjs';
import {verifyProducerDescriptor,verifyProducerCompany} from './producer-descriptor.mjs';
import {createScoringHandler} from './leadgen-scoring-handler.mjs';
import {readFileSync,writeFileSync,appendFileSync,chmodSync,renameSync,existsSync,readdirSync,lstatSync,realpathSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import recipientProof from './queued-recipient-evidence.js';
import lineRoutes from './line-routes.js';
import {readFrozen,commentSamplingInput,assertCommentSampling,collectionBudgetSeconds} from './runtime-definition.mjs';
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
import {createCentralDeviceLease,verifyCentralTaskAssociation,persistCentralTaskAssociation} from './central-device-lease.mjs';

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

export function createHandlers({root,env,rpc,execute=execInput,sourceCommit,taskId,outreachScope=null,centralLease}) {
  const sampleInput=commentSamplingInput(env),collectionBudget=collectionBudgetSeconds(env),collectionBudgetExplicit=Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS');
  if(sampleInput||(env.WFR_RUN_DIR&&existsSync(join(env.WFR_RUN_DIR,'run-definition.json'))))assertCommentSampling(readFrozen(env.WFR_RUN_DIR),env);
  const {P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:line}=env;
  const mmvDeviceRuntime=env.WFR_HOSTKEY==='mmv'&&env.LEADGEN_MMV_DEVICE_RUNTIME==='1';
  // 与controller同一宿主政策；所有原生调用必须沿用已核客户端及既有server。
  const hostPolicy=join(env.HOME,'.config/zenithjoy/adb-service.json');
  const managedAdb=Object.hasOwn(env,'ZJ_ADB_HOST_CONFIG')||existsSync(hostPolicy)||(()=>{try{return lstatSync(hostPolicy).isSymbolicLink();}catch{return false;}})();
  const adbClient=managedAdb?join(root,'adb-managed-client.py'):(env.DOUYIN_ADB_BIN||(mmvDeviceRuntime?'/opt/homebrew/bin/adb':'adb'));
  let locked=false,leased=[],qualified=[],historyScoped=0;
  const state={profile,line,run,source_commit:sourceCommit,task_id:taskId??null,run_id:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,outreach_scope:outreachScope};
  const needsCentralLock=['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW);
  let central=centralLease||null;
  const getCentral=()=>central??=createCentralDeviceLease({brainUrl:env.BRAIN_URL,token:env.BRAIN_INTERNAL_TOKEN,
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
  const nativeReceipt=()=>({runDir:env.WFR_RUN_DIR,operationId:randomUUID(),runId:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,taskId,profile,serial,sourceCommit,owner:run,activity:state.currentActivity});
  const phone=createPhoneAction({env,state,profile,run,isLocked:()=>locked,isClosed:()=>discoveryClosed,getScope:()=>discoveryScope||collectionScope,checked,nativeReceipt});
  const returnedContext=()=>{const frozen=readFrozen(env.WFR_RUN_DIR),binding=readBinding(env.WFR_RUN_DIR,env.WFR_ATTEMPT,frozen);return {task_id:taskId??null,run_id:state.run_id,attempt:env.WFR_ATTEMPT,source_commit:sourceCommit,profile,serial,activity:'collection',owner:run,target:frozen.deployment.target,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id};};
  const queue=async(op,fields={})=>{if(op==='discover')discoveryScope?.assert();if(op==='sample_readback'&&state.budgetDeadline&&Date.now()>=state.budgetDeadline)throw Error('EXECUTION_DEADLINE: 采样PG读回预算已尽');const admissionOp=op==='admit_102g_comments'||op==='admit_102g_readback';const exactRecoveryOp=op==='recover_false_exclusion_102l'||op==='recover_false_exclusion_102l_readback';const rpcBudget=op==='discover'?225000:admissionOp?150000:60000;return (await rpc({kind:'queue',request:{op,line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,...(admissionOp||exactRecoveryOp?{}:{limit:Number(env.LEADGEN_LIMIT||2)}),...fields}},
    ['discover','comment_history','comment_history_readback','sample_readback','collect','collect_partial','renew_video',
      'admit_102g_comments','admit_102g_readback'].includes(op)?{timeoutMs:Math.max(1,Math.min(rpcBudget,state.budgetDeadline?state.budgetDeadline-Date.now():rpcBudget))}:{})).result;};
  const preflight=async()=>{
    if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'&&env.LEADGEN_SEND!=='1'){
      const flag=join(env.HOME,`bin-harvest/state/dm-paused-${profile}.flag`);
      if(existsSync(flag))return {status:'paused',reason:'私信暂停标记生效',sent:0};
      return {status:'paused',reason:'本批私信未授权，保持暂停',sent:0};
    }
    const mmvStep=mmvDeviceRuntime?{douyin_video_discovery:'101',douyin_video_processing:'102'}[env.WF_BRAIN_WORKFLOW]:undefined;
    if(mmvStep) {
      // 101沿原取词入口先冻结归一化taskInputs；不能先以空输入建立同run快照。
      // getDiscovery只取公司关键词并构造handler，此处不会搜索或执行手机动作。
      if(mmvStep==='101')await getDiscovery();
      const config=await queue('company_config',{step:mmvStep,device_binding:{profile,device_serial:serial}});
      const binding=config?.device_binding;
      if(!config?.company_id||!config?.tenant_id||!Number.isSafeInteger(config?.version)||config.version<1||config.run_id!==run
        ||!binding||binding.company_id!==config.company_id||binding.tenant_id!==config.tenant_id||binding.version!==config.version||binding.run_id!==run
        ||binding.profile!==profile||binding.device_serial!==serial||binding.verification_status!=='verified'||binding.enabled!==true
        ||typeof binding.douyin_id!=='string'||!binding.douyin_id||binding.douyin_id.trim()!==binding.douyin_id)throw Error('COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED: MMV company/run/account binding missing or mismatched');
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
    if(mmvStep==='102'){
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
  const intake=async()=>{
    state.companyConfig=await queue('company_config',{step:'102'});
    appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.companyConfig)+'\n',{mode:0o600});
    const sourceRun=env.LEADGEN_SOURCE_RUN;
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(sourceRun||''))throw Error('102缺有效上游101运行号');
    const upstreamDir=resolve(env.WFR_RUN_DIR,'..',`douyin_video_discovery-${sourceRun}`);
    const upstream=readFrozen(upstreamDir),current=readFrozen(env.WFR_RUN_DIR);
    if(upstream.run_identity?.capability!=='douyin_video_discovery'||upstream.run_identity.tag!==sourceRun
      ||upstream.run_identity.profile!==profile||upstream.deployment.source_commit!==current.deployment.source_commit&&!current.producer_descriptor)throw Error('上游101冻结身份或发布来源不一致');
    const final=JSON.parse(readFileSync(join(upstreamDir,'split-result.json'),'utf8'));
    const collect=Array.isArray(final?.results)?final.results.filter(item=>item?.activity==='collect_videos'):[];
    const runPrefix=`douyin_video_discovery-${sourceRun}__`;
    const attempt=typeof final?.run_id==='string'&&final.run_id.startsWith(runPrefix)?final.run_id.slice(runPrefix.length):'';
    if(final?.status!=='completed'||final.workflow_key!=='douyin_video_discovery'
      ||!/^a[1-9][0-9]*$/.test(attempt)
      ||final.source_commit!==upstream.deployment.source_commit||final.profile!==profile
      ||final.evidence_status!=='sent'||collect.length!==1
      ||collect[0].status!=='completed'||collect[0].verification?.verified!==true)throw Error('上游101终态或collect_videos验收未通过');
    const progressRaw=readFileSync(join(upstreamDir,'discovery-progress.json'));
    const input=JSON.parse(progressRaw);
    const producer=current.producer_descriptor?verifyProducerDescriptor(current.producer_descriptor,{upstream,progressRaw,progress:input,env,company:state.companyConfig,consumerSourceCommit:current.deployment.source_commit}):null;
    if(producer)verifyProducerCompany(producer,await queue('verify_producer_company',{descriptor:producer}));
    state.producerDescriptor=producer;
    if(input.run!==sourceRun||input.profile!==profile||!Array.isArray(input.videos)||input.videos.length>1000
      ||!Array.isArray(input.captures)||input.captures.length>10000)throw Error('上游101交接清单身份或数量无效');
    const all=[...input.videos,...input.captures];
    if(all.some(v=>!/^\d{16,24}$/.test(v.videoId||'')||typeof v.author!=='string'||!v.author.trim()))throw Error('上游视频ID或作者证据无效');
    const ids=[...new Set(input.videos.map(v=>v.videoId))];
    if(ids.length!==input.videos.length||input.captures.some(v=>!ids.includes(v.videoId))||ids.some(id=>!input.captures.some(v=>v.videoId===id)))throw Error('上游真实取链与保存ID清单不一致');
    const rows=await queue('inspect_videos',{video_ids:ids});
    if(!Array.isArray(rows)||rows.length!==ids.length||ids.some(id=>rows.filter(r=>r.video_id===id).length!==1))throw Error('PG读回缺上游真实视频ID');
    const own=JSON.parse(readFileSync(env.OWN_ACCOUNTS_CONF||join(env.HOME,'bin-harvest/config/own-accounts.json'),'utf8'));
    if(!Array.isArray(own.nicknames)||!Array.isArray(own.ids))throw Error('自家账号配置缺失');
    const normalize=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const ownNames=new Set([...own.nicknames,...own.ids].map(normalize));
    const fulfilled=new Set(),priorProofs=[],ignoredFailedSamplingRuns=[];
    if(sampleInput){
      const siblings=readdirSync(resolve(env.WFR_RUN_DIR,'..'));
      if(siblings.length>2000)throw Error('采样前序运行索引超界');
      for(const name of siblings.filter(n=>/^douyin_video_processing-[A-Za-z0-9_-]+$/.test(n))){
        const priorDir=resolve(env.WFR_RUN_DIR,'..',name);
        if(priorDir===resolve(env.WFR_RUN_DIR)||lstatSync(priorDir).isSymbolicLink()||!lstatSync(priorDir).isDirectory())continue;
        const file=join(priorDir,name.slice('douyin_video_processing-'.length)+'-sampling-readback.json');
        if(!existsSync(file))continue;
        if(lstatSync(file).isSymbolicLink()||(lstatSync(file).mode&0o077)!==0||lstatSync(file).size>10000000)throw Error('采样回执不得使用符号链接或公开权限或超界正文');
        const prior=readFrozen(priorDir),si=prior.sampling_input;
        if(!si||si.source_run!==sourceRun||si.comment_limit!==sampleInput.comment_limit)continue;
        if(si.profile!==profile||si.serial!==serial||si.line!==line||prior.deployment.source_commit!==current.deployment.source_commit||prior.run_identity?.tag!==si.run_tag||prior.run_identity?.capability!=='douyin_video_processing'||prior.run_identity?.profile!==profile||prior.run_identity?.serial!==si.serial||prior.run_identity?.serial!==serial||prior.run_identity?.run_id!==name)throw Error('前序采样冻结scope不符');
        const receipt=JSON.parse(readFileSync(file,'utf8')),final=JSON.parse(readFileSync(join(priorDir,'split-result.json'),'utf8'));
        const attempt=typeof final.run_id==='string'?final.run_id.slice((name+'__').length):'';
        if(!/^a[1-9][0-9]*$/.test(attempt)||final.run_id!==name+'__'+attempt||!['completed','partial','failed'].includes(final.status))throw Error('前序采样缺真实run及attempt终态');
        const binding=readBinding(priorDir,attempt,prior);if(binding.run_id!==final.run_id||receipt.run_id!==binding.run_id)throw Error('前序采样运行绑定不一致');
        if(final.profile!==profile||JSON.stringify(final.sampling_input)!==JSON.stringify(si)||final.source_commit!==current.deployment.source_commit||final.workflow_key!=='douyin_video_processing')throw Error('前序采样终态scope不符');
        // 失败运行保留原件，但不兑现其采样配额，也不能堵住同批其它待处理视频。
        // 只有冻结来源、身份及正式绑定全部一致的失败终态可以在这里忽略。
        if(final.status==='failed'){
          ignoredFailedSamplingRuns.push({prior_run:si.run_tag,run_id:binding.run_id,status:final.status});continue;
        }
        const activity=final.results?.find(r=>r.activity==='collection');
        if(receipt.verified!==true||JSON.stringify(receipt.sampling_input)!==JSON.stringify(si)||final.profile!==profile||JSON.stringify(final.sampling_input)!==JSON.stringify(si)||final.source_commit!==current.deployment.source_commit||final.workflow_key!=='douyin_video_processing'||activity?.verification?.verified!==true||!['completed','partial'].includes(activity?.status)||!Array.isArray(receipt.videos)||receipt.videos.length>1000||JSON.stringify(activity.result?.sampling_receipts)!==JSON.stringify(receipt.videos.map(({pg_rows,...publicReceipt})=>publicReceipt)))throw Error('前序采样缺真实已验收Activity回执');
        for(const v of receipt.videos){
          if(!ids.includes(v.video_id)||v.source_run!==sourceRun||v.comment_limit!==si.comment_limit||!Array.isArray(v.pg_rows)||v.pg_rows.length!==v.coverage||!['quota_reached','footer_reached','no_comments'].includes(v.stop_reason)||v.stop_reason==='quota_reached'&&v.coverage!==si.comment_limit||v.coverage>si.comment_limit)throw Error('前序采样配额或上游范围不符');
          const proof=await queue('sample_readback',{video_id:v.video_id,video_url:v.video_url,rows:v.pg_rows});
          if(proof.verified!==true||proof.video_id!==v.video_id||proof.coverage!==v.coverage||JSON.stringify(proof.rows)!==JSON.stringify(v.pg_rows))throw Error('前序采样实际PG读回缺失');
          fulfilled.add(v.video_id);priorProofs.push({prior_run:si.run_tag,video_id:v.video_id,coverage:proof.coverage});
        }
      }
    }
    const skipped=[],eligible=[];
    for(const v of input.videos){const row=rows.find(r=>r.video_id===v.videoId);
      if(!['pending','matched','rejected'].includes(row.judgment_status)||typeof row.process_status!=='string')throw Error('PG视频状态缺合法终态');
      const currentPolicy=row.judgment_config?.company_id===state.companyConfig.company_id&&row.judgment_config?.version===state.companyConfig.version;
      const reason=producer&&!producer.video_ids.includes(v.videoId)?'producer_scope':row.judgment_status==='rejected'&&currentPolicy?'rejected':row.process_status==='评论已采'?'completed':fulfilled.has(v.videoId)?'sample_fulfilled':ownNames.has(normalize(v.author))?'own':null;
      if(reason)skipped.push({video_id:v.videoId,reason});else eligible.push(v.videoId);
    }
    state.intakeVideoIds=eligible;
    const proof={verified:true,source_run:sourceRun,source_commit:upstream.deployment.source_commit,...(producer?{consumer_source_commit:current.deployment.source_commit,producer_descriptor:producer}:{}),
      prior_sampling_readbacks:priorProofs,ignored_failed_sampling_runs:ignoredFailedSamplingRuns,observed_at:new Date().toISOString(),video_ids:ids,eligible_video_ids:eligible,skipped,rows,
      duplicate_observations:input.captures.length-ids.length};
    writeFileSync(join(env.WFR_RUN_DIR,`${run}-intake-readback.json`),JSON.stringify(proof),{mode:0o600});
    return {historical_filter_verified:Number(rows.length===ids.length),own_filter_verified:Number(Array.isArray(own.nicknames)&&Array.isArray(own.ids)),run_dedup_verified:Number(new Set(eligible).size===eligible.length),
      received:ids.length,eligible:eligible.length,ignored_failed_sampling_runs:ignoredFailedSamplingRuns.length,skipped_completed:skipped.filter(v=>v.reason==='completed').length,
      skipped_sample_fulfilled:skipped.filter(v=>v.reason==='sample_fulfilled').length,skipped_rejected:skipped.filter(v=>v.reason==='rejected').length,skipped_own:skipped.filter(v=>v.reason==='own').length,duplicate_observations:proof.duplicate_observations};
  };
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
      const ctl=env.DOUYIN_PHONE_ADB||join(env.HOME,'.local/bin/douyin-phone-adb');
      const r=await execute(ctl,['--profile',profile,'lock-quarantine',run],{timeoutMs:20000,env:{...env}});
      proof.device={applicable:true,verified:r.code===0&&r.stdout.trim()===`lock=quarantined owner=${run} review_required=true`,receipt:safeExecutionDiagnostic(r.stdout,env)};
    }catch(error){proof.device={applicable:true,verified:false,reason:safeExecutionDiagnostic(error.message,env)};}
    for(const video of leased)try{
      const r=(await rpc({kind:'queue',request:{op:'quarantine_video',line,run,video_id:video.video_id}},{timeoutMs:30000})).result;
      proof.videos.push({...r,video_id:video.video_id,verified:r?.quarantined===true&&r.video_id===video.video_id&&r.process_status===`待人工核验:${run}`});
    }catch(error){proof.videos.push({video_id:video.video_id,verified:false,reason:safeExecutionDiagnostic(error.message,env)});}
    proof.verified=proof.device.verified&&proof.videos.every(v=>v.verified)&&!proof.claim_receipt_unknown;
    writeFileSync(join(env.WFR_RUN_DIR,'resource-quarantine.json'),JSON.stringify(proof),{mode:0o600});return proof;
  };
  return {state,preflight,quarantineResources,beginCollectionReadback:async evidence=>{
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
          writeFileSync(join(env.WFR_RUN_DIR,`${run}-sampling-readback.json`),JSON.stringify({run_id:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,sampling_input:sampleInput,verified:true,videos:sampleReceipts}),{mode:0o600});
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
      if(finished.returned_phone_scope)state.collectionReturnedEvidence=finished;
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
          const evidenceId=`${run}-${env.WFR_ATTEMPT}-cleanup-desktop`,scope={run,run_id:state.run_id,source_commit:sourceCommit,profile,serial};
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

