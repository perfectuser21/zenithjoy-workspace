import {readFileSync,writeFileSync,appendFileSync,chmodSync,existsSync,renameSync,readdirSync,lstatSync,realpathSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import recipientProof from './queued-recipient-evidence.js';
import lineRoutes from './line-routes.js';
import {runActivity} from './activity-commander.mjs';
import {createActivityRecovery} from './activity-skill-recovery.mjs';
import {readFrozen,commentSamplingInput,assertCommentSampling,collectionBudgetSeconds} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {createRpc,execInput,safeExecutionDiagnostic} from './leadgen-client.mjs';
import {createDiscoveryHandlers} from './leadgen-discovery.mjs';
import {createOutreachHandlers} from './leadgen-outreach.mjs';
import history from './queued-comment-history.js';
import {judgeSteps} from './step-judge.mjs';

// 任一普通活动失败或Commander叫停，停止后续业务；清场总在最后执行。
export async function runWorkflow({activities,context,handlers,commander,record,verify,recover,quarantine}) {
  const results=[];let status='completed',stopped=false;
  const ordered=[...activities.filter(a=>a.key!=='cleanup'),...activities.filter(a=>a.key==='cleanup')];
  const execute=async activity=>{
    if(typeof handlers[activity.key]!=='function')throw Error(`活动缺实现: ${activity.key}`);
    try {
      const remaining=ordered.slice(ordered.indexOf(activity)+1).map(a=>a.key);
      const activityContext={...context,workflow_progress:{completed_activity_keys:results.filter(r=>['completed','skipped'].includes(r.status)).map(r=>r.activity),
        remaining_activity_keys:remaining}};
      const result=await runActivity({activity,context:activityContext,execute:handlers[activity.key],commander,record,
        recover:recover?failure=>recover({activity,failure,context:activityContext,execute:handlers[activity.key]}):undefined});
      if(['paused','partial'].includes(result.result?.status))result.status='partial';
      if(result.result?.status==='skipped')result.status='skipped';
      const verifySamplePartial=activity.key==='collection'&&result.status==='partial'&&result.result?.sampling_receipts?.length>0;
      if((result.status==='completed'||verifySamplePartial)&&verify){
        result.verification=await verify(activity,result);
        if(result.verification.verified!==true)result.status='failed';
      }
      if(result.code_failure)await record({...activityContext,activity:activity.key,phase:'verification',evidence:result});
      results.push({activity:activity.key,...result});
      // 清场完成后Commander正常finish是收尾结果；业务提前停止、失败与升级仍如实保留。
      const normalCleanupFinish=activity.key==='cleanup'&&['completed','skipped'].includes(result.status)&&result.decision?.action==='finish';
      const normalFinalFinish=remaining.length===0&&result.status==='completed'&&result.decision?.action==='finish';
      if(result.status==='failed'){status='failed';stopped=true;}
      else if(result.status==='partial'||(['finish','escalate'].includes(result.decision?.action)&&!normalCleanupFinish&&!normalFinalFinish)
        ||result.result?.status==='partial'||result.result?.status==='paused'){
        if(status!=='failed')status='partial';stopped=true;
      }
      if(result.execution_stopped===false){context={...context,skill_execution_unknown:true};status='failed';stopped=true;}
    }catch(error){
      if(error.executionStopped===false)context={...context,skill_execution_unknown:true};
      status='failed';stopped=true;
      const result={activity:activity.key,status:'failed',error:String(error.message).slice(0,400)};
      results.push(result);await record({...context,...result,phase:'failure'});
    }
  };
  try {for(const a of activities.filter(a=>a.key!=='cleanup')){
    if(stopped){results.push({activity:a.key,status:'blocked',reason:'前序活动未通过或Commander要求收工'});continue;}
    await execute(a);
  }}finally{for(const a of activities.filter(a=>a.key==='cleanup')){
    if(context.skill_execution_unknown){results.push({activity:a.key,status:'blocked',reason:'原执行或Skill子会话终止未知，禁止清场并记录资源隔离'});status='failed';}
    else await execute(a);
  }}
  let resource_quarantine;
  if(context.skill_execution_unknown){
    try{resource_quarantine=quarantine?await quarantine():{verified:false,reason:'persistent quarantine adapter unavailable'};}
    catch(error){resource_quarantine={verified:false,reason:String(error.message).slice(0,400)};}
    await record({...context,phase:'resource_quarantine',evidence:resource_quarantine});
  }
  return {status,results,...(resource_quarantine?{resource_quarantine}:{})};
}


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
    recipientProof.validateEvidence(evidence,scope);
    if(evidence.scope.profile!==recipientScope.profile||evidence.scope.video_id!==videoId||evidence.scope.source_run!==(recipientScope.sourceRun||null))throw Error('recipient采集profile或VID错位');
    row.recipientEvidence=evidence;
  }
  if(Number(marker[3])!==comments.length||marker[2]==='no_comments'&&comments.length)throw Error('采集完成数量与评论证据不符');
  return comments;
}

export function createHandlers({root,env,rpc,execute=execInput,sourceCommit}) {
  const sampleInput=commentSamplingInput(env),collectionBudget=collectionBudgetSeconds(env),collectionBudgetExplicit=Object.hasOwn(env,'QUEUED_VIDEO_COLLECTION_SECONDS');
  if(sampleInput||(env.WFR_RUN_DIR&&existsSync(join(env.WFR_RUN_DIR,'run-definition.json'))))assertCommentSampling(readFrozen(env.WFR_RUN_DIR),env);
  const {P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:line}=env;
  let locked=false,leased=[],qualified=[],discovery,historyScoped=0;
  const state={profile,line,run,source_commit:sourceCommit};
  let qualificationClaimed=false;const qualificationProgress=new Map(),qualificationAttempts=new Map();
  const recordDiagnostic=value=>{
    const file=join(env.WFR_RUN_DIR,'activity.log');
    appendFileSync(file,safeExecutionDiagnostic(value,env),{mode:0o600});
    chmodSync(file,0o600);
  };
  const bounded=async(command,args,opts={})=>{
    try {
      const result=await execute(command,args,{...opts,
        timeoutMs:Math.max(1,Math.min(opts.timeoutMs||Number(opts.maxDurationS||120)*1000,
          state.budgetDeadline?state.budgetDeadline-Date.now():Number(env.WF_RUN_MAX_SECONDS||1800)*1000)),
        env:{...env,DOUYIN_LOCK_PID:String(process.pid),...opts.env}});
      recordDiagnostic(result.stderr||'');
      if(/\bRECORD_CAPTURE_EXIT_UNVERIFIED\b/.test(result.stderr||'')){const error=Error('RECORD_CAPTURE_EXIT_UNVERIFIED');error.executionStopped=false;throw error;}
      return result;
    } catch(error) {
      if(error.executionStopped===false||/\b(?:EXECUTION_OUTPUT_LIMIT|EXECUTION_DEADLINE|RECORD_CAPTURE_EXIT_UNVERIFIED)\b/.test(error.message)){state.executionUnknown=true;error.executionStopped=false;}
      recordDiagnostic(error.stderr||'');throw error;
    }
  };
  const checked=async(command,args,opts)=>{const r=await bounded(command,args,opts);if(r.code!==0)throw Error(`动作失败 code=${r.code}: ${safeExecutionDiagnostic(r.stderr,env).slice(-500)||command}`);return r.stdout;};
  const phone=async(command,...args)=>{
    const ctl=env.DOUYIN_PHONE_ADB||join(env.HOME,'.local/bin/douyin-phone-adb');
    if(!locked&&!['lock-acquire','preflight'].includes(command))throw Error('设备操作未持本批锁');
    if(locked&&!['lock-refresh','lock-release'].includes(command)){
      const held=await checked(ctl,['--profile',profile,'lock-refresh',run]);
      if(!held.startsWith('lock=refreshed'))throw Error('设备锁续期未确认');
    }
    const ownerArgs=['close-app','return-safe-desktop'].includes(command)?['--lock-owner',run]:[];
    // 取链包含nonce、UI重抓、复制与归位；仍由bounded夹在活动剩余预算内。
    return checked(ctl,['--profile',profile,...ownerArgs,command,...args],
      command==='current-video-link'?{maxDurationS:300}:command==='search-video-tab'?{maxDurationS:180}:command==='private-message-send'?{maxDurationS:480}:{});
  };
  const queue=async(op,fields={})=>{if(op==='sample_readback'&&state.budgetDeadline&&Date.now()>=state.budgetDeadline)throw Error('EXECUTION_DEADLINE: 采样PG读回预算已尽');return (await rpc({kind:'queue',request:{op,line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,limit:Number(env.LEADGEN_LIMIT||2),...fields}},
    ['discover','comment_history','comment_history_readback','sample_readback','collect','collect_partial','renew_video'].includes(op)?{timeoutMs:Math.max(1,Math.min(60000,state.budgetDeadline?state.budgetDeadline-Date.now():60000))}:{})).result;};
  const preflight=async()=>{
    if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'&&env.LEADGEN_SEND!=='1'){
      const flag=join(env.HOME,`bin-harvest/state/dm-paused-${profile}.flag`);
      if(existsSync(flag))return {status:'paused',reason:'私信暂停标记生效',sent:0};
      return {status:'paused',reason:'本批私信未授权，保持暂停',sent:0};
    }
    if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach') {
      state.company_config=await queue('company_config',{step:'104'});
      const account=state.company_config?.runtime_config?.platform_accounts?.find(a=>a.profile===profile&&a.verification_status==='verified'&&a.enabled===true);
      if(!account||account.device_serial!==serial||!account.douyin_id)throw Error(`COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED: profile=${profile} expected=${account?.device_serial||'missing'} actual=${serial}`);
      state.company_config.expected_sender=account.douyin_id;
      appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.company_config)+'\n',{mode:0o600});
    }
    const device=await checked('adb',['-s',serial,'get-state']);
    if(device.trim()!=='device')throw Error('设备未在线');
    const target=await phone('preflight');
    if(!target.split('\n').includes(`serial=${serial}`))throw Error('profile注册设备与本次serial不一致');
    const held=await phone('lock-acquire',run);
    if(!/^lock=(acquired|held)/m.test(held))throw Error('设备锁未确认');
    locked=true;
    const calls=await checked('adb',['-s',serial,'shell','dumpsys','telephony.registry']);
    const call=calls.match(/mCallState=(\d+)/)?.[1];if(call!=='0')throw Error('通话状态未知或设备通话中');
    await checked('adb',['-s',serial,'shell','input','keyevent','KEYCODE_WAKEUP']);
    await checked('adb',['-s',serial,'shell','input','swipe','600','2200','600','800','300']);
    await phone('close-app');
    await checked('adb',['-s',serial,'shell','am','start','-n','com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity']);
    await checked('/bin/sleep',['4']);
    const account=await phone('account-current',`${run}-account`);
    const id=account.match(/^douyin_id=(.+)$/m)?.[1]?.trim();
    const registry=readFileSync(env.DOUYIN_ACCOUNT_REGISTRY||join(env.HOME,'.config/openclaw/douyin-account-routes.tsv'),'utf8');
    if(!id||!registry.split('\n').some(s=>{const f=s.split('\t');return f[0]===profile&&f[1]===id;}))throw Error('当前账号未在本profile注册');
    state.account=id;
    if(state.company_config&&state.company_config.expected_sender!==id)throw Error('COMPANY_ACCOUNT_IDENTITY_MISMATCH');
    const outreachProof=env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'?await outreach.preflight():{};
    return {device_verified:true,lock_acquired:true,call_state_idle:true,account_verified:true,douyin_id:id,...outreachProof};
  };
  const getDiscovery=async()=>{
    if(discovery)return discovery;
    const requested=env.LEADGEN_SOURCES_FILE?readFileSync(env.LEADGEN_SOURCES_FILE,'utf8').split('\n').filter(Boolean):undefined;
    const keywordResult=await rpc({kind:'keywords',line,run,limit:2,keywords:requested});
    const sources=keywordResult.result;
    if(keywordResult.config)appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(keywordResult.config)+'\n',{mode:0o600});
    discovery=createDiscoveryHandlers({phone,execute:bounded,queue,profile,run,root,
      sources,sourceKind:env.LEADGEN_SOURCE_KIND||'keyword',location:env.LEADGEN_LOCATION||'same_city',limit:Number(env.LEADGEN_LIMIT??0),env,budgetDeadline:()=>state.budgetDeadline||0});
    return discovery;
  };
  const intake=async()=>{
    state.companyConfig=await queue('company_config',{step:'102'});
    appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.companyConfig)+'\n',{mode:0o600});
    const sourceRun=env.LEADGEN_SOURCE_RUN;
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(sourceRun||''))throw Error('102缺有效上游101运行号');
    const upstreamDir=resolve(env.WFR_RUN_DIR,'..',`douyin_video_discovery-${sourceRun}`);
    const upstream=readFrozen(upstreamDir),current=readFrozen(env.WFR_RUN_DIR);
    if(upstream.run_identity?.capability!=='douyin_video_discovery'||upstream.run_identity.tag!==sourceRun
      ||upstream.run_identity.profile!==profile||upstream.deployment.source_commit!==current.deployment.source_commit)throw Error('上游101冻结身份或发布来源不一致');
    const input=JSON.parse(readFileSync(join(upstreamDir,'discovery-progress.json'),'utf8'));
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
      const reason=row.judgment_status==='rejected'&&currentPolicy?'rejected':row.process_status==='评论已采'?'completed':fulfilled.has(v.videoId)?'sample_fulfilled':ownNames.has(normalize(v.author))?'own':null;
      if(reason)skipped.push({video_id:v.videoId,reason});else eligible.push(v.videoId);
    }
    state.intakeVideoIds=eligible;
    const proof={verified:true,source_run:sourceRun,source_commit:upstream.deployment.source_commit,
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
  const videoAction=async(mode,v)=>{
    let historyFile='';
    if(mode==='collection')collectionTiming();
    if(mode==='collection'){
      const receipt=await queue('comment_history',{video_id:v.video_id,video_url:v.video_url});
      historyFile=join(env.WFR_RUN_DIR,`${run}-history-${v.video_id}.json`);
      const temp=historyFile+`.tmp-${process.pid}`;
      writeFileSync(temp,JSON.stringify(receipt),{mode:0o600,flag:'wx'});renameSync(temp,historyFile);
      history.load(historyFile,env.WFR_RUN_DIR,{line,run,source_run:env.LEADGEN_SOURCE_RUN||null,video_id:v.video_id,video_url:v.video_url});
      historyScoped++;
    }
    let timing;
    if(mode==='collection'){
      timing=collectionTiming();
      collectionBudgetVideos.push({video_id:v.video_id,...timing,observed_at:new Date().toISOString()});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-collection-budget-readback.json`),JSON.stringify({run_tag:run,profile,serial,line,source_run:env.LEADGEN_SOURCE_RUN||null,collection_budget_s:collectionBudget,requested_explicit:collectionBudgetExplicit,global_start_ts:env.WF_RUN_START_TS===undefined?null:Number(env.WF_RUN_START_TS),global_max_seconds:Number(env.WF_RUN_MAX_SECONDS||1800),activity_deadline_ms:state.budgetDeadline||null,action_max_duration_s:timing.action_max_duration_s,sampling_input:sampleInput,videos:collectionBudgetVideos}),{mode:0o600});
    }
    return bounded('zsh',[join(root,'process-queued-video.sh'),mode,profile,
      v.video_id,v.video_url,Buffer.from(v.title||'').toString('base64'),Buffer.from(v.keyword||'').toString('base64'),run,line],
      {maxDurationS:mode==='qualification'?900:mode==='collection'?timing.action_max_duration_s:480,...(timing?{timeoutMs:timing.timeout_ms}:{}),
        env:{...(mode==='qualification'&&(qualificationAttempts.get(v.video_id)||1)>1?{QUEUED_VIDEO_EVIDENCE_ATTEMPT:String(qualificationAttempts.get(v.video_id)-1)}:{}),...(mode==='collection'?{QUEUED_VIDEO_COLLECTION_SECONDS:String(collectionBudget)}:{}),QUEUED_VIDEO_QUALIFY_CMD:join(root,'leadgen-qualify.sh'),QUEUED_COMMENT_HISTORY_FILE:historyFile,...(sampleInput?{LEADGEN_COMMENT_LIMIT:String(sampleInput.comment_limit)}:{})}});
  };
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
  return {state,preflight,quarantineResources,handoffPhone:phone,handoffHeartbeat:async activity=>{
      if(locked){const raw=(await phone('lock-refresh',run)).trim().split(/\s+/),fields=Object.fromEntries(raw.map(token=>token.split('=')));
        if(raw.length!==3||fields.lock!=='refreshed'||fields.owner!==run||!/^\d+s$/.test(fields.ttl||''))throw Error('Skill接手设备锁所有权续期未确认');}
      if(activity.key!=='cleanup')for(const v of leased){const receipt=await queue('renew_video',{video_id:v.video_id});if(receipt?.renewed!==true)throw Error('Skill接手原视频租约续期未确认');}
    },handoffContext:async()=>({profile,serial,line,run,account:state.account||null,company_id:(state.company_config||state.companyConfig)?.company_id||null,leased_video_ids:leased.map(v=>v.video_id),qualified_video_ids:qualified.map(v=>v.video_id),sampling_input:sampleInput}),
    source:async()=>(await getDiscovery()).source(),
    dedup:intake,
    collect_videos:async()=>{const result=await (await getDiscovery()).collect_videos();
      const readback=await queue('inspect_videos',{video_ids:result.videos.map(v=>v.videoId)});
      const readbackFailures=result.videos.filter(v=>!readback.some(r=>r.video_id===v.videoId&&r.line_key)).length;
      return {...result,persisted:result.counts.created,candidates:result.videos.length,videos_pushed:result.counts.created,
        video_manifest_readback_failures:readbackFailures,manifest_verified:Number(readbackFailures===0),
        ...(readbackFailures?{status:'partial'}:{}),
        ...(result.failures.length||result.known_gaps.some(g=>g.kind!=='candidate_disappeared'||result.stop_reason!=='limit_reached')?{status:'partial'}:{})};},
    qualification:async()=>{
      if(!state.companyConfig)state.companyConfig=await queue('company_config',{step:'102'});
      if(!state.companyConfig?.company_id||!state.companyConfig.version)throw Error('COMPANY_CONFIG_RECEIPT_MISSING');
      if(env.WF_BRAIN_WORKFLOW==='douyin_video_processing'&&!Array.isArray(state.intakeVideoIds))throw Error('102必须先核验101明确ID交接');
      if(state.qualificationClaimUnknown)throw Error('资格领取回执未知，禁止再次认领或伪造空批成功');
      if(!qualificationClaimed){
        state.qualificationClaimUnknown=true;
        leased=await queue('claim_videos',{config_required:true,...(Array.isArray(state.intakeVideoIds)?{video_ids:state.intakeVideoIds}:{}),...(sampleInput?{prefer_matched:true}:{})});
        if(!Array.isArray(leased))throw Error('资格领取缺合法原租约列表');
        qualificationClaimed=true;state.qualificationClaimUnknown=false;
      }
      state.remainingVideoIds=state.intakeVideoIds?.filter(id=>!leased.some(v=>v.video_id===id))||[];
      const failures=[];let recordingsRequired=0,mediaVerified=0,recordingSilentRejected=0,recordingOutcomesFailures=0,recordingsUnverified=0;
      for(const v of leased){
        if(qualificationProgress.get(v.video_id)?.settled)continue;
        const previous={recordingsRequired,mediaVerified,recordingSilentRejected,recordingOutcomesFailures,recordingsUnverified};
        let attempted=false,thrown=false;
        try{
          await queue('renew_video',{video_id:v.video_id});
          const used=qualificationAttempts.get(v.video_id)||0;
          if(used>=2)throw Error('本VID资格恢复次数已尽');
          if(used)archiveQualification(v);
          qualificationAttempts.set(v.video_id,used+1);attempted=true;
        if(state.companyConfig&&v.judgment_status==='matched'&&v.judgment_config?.company_id===state.companyConfig?.company_id&&v.judgment_config?.version===state.companyConfig?.version){
          const identity=await videoAction('identity',v);
          if(identity.code===0)qualified.push(v);else failures.push({video_id:v.video_id,code:identity.code,reason:identity.stderr.slice(-500)});
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
          if(proof.capture_audio_mode!=='playback_dup'||!Number.isSafeInteger(proof.capture_audio_sdk)||proof.capture_audio_sdk<33||proof.capture_audio_required!==true||proof.capture_audio_sdk_evidence_file!==proof.evidence_id+'.capture-sdk.txt'||!/^[a-f0-9]{64}$/.test(proof.capture_audio_sdk_evidence_sha256||''))throw Error('RECORD_CAPTURE_STRATEGY_UNVERIFIED');
          const captureEnd=proof.capture_audio_end;
          if(!captureEnd||captureEnd.mode!==proof.capture_audio_mode||captureEnd.sdk!==proof.capture_audio_sdk||captureEnd.required!==true||captureEnd.sdk_evidence_file!==proof.capture_audio_sdk_evidence_file||captureEnd.sdk_evidence_sha256!==proof.capture_audio_sdk_evidence_sha256)throw Error('RECORD_CAPTURE_STRATEGY_UNVERIFIED');
          if(!Number.isSafeInteger(proof.audio_streams)||proof.audio_streams<1)throw Error('RECORD_AUDIO_TRACK_UNVERIFIED');
          if(proof.capture_audio_verified!==true)throw Error(proof.audio_status==='silent'||Number.isFinite(proof.mean_volume_db)&&proof.mean_volume_db<=-80?'RECORD_CAPTURE_SILENT':'RECORD_CAPTURE_STRATEGY_UNVERIFIED');
          if(proof.media_volume_verified!==true||!Number.isSafeInteger(proof.media_volume)||proof.media_volume<=0)throw Error('本轮媒体音量未实际读回正数');
          mediaVerified++;
          if(proof.playback_verified!==true||proof.playback_proof_kind!=='native_audio'||proof.playback_package!=='com.ss.android.ugc.aweme')throw Error('本轮native播放未实际核验');
          const nativePhases=['start','end'].map(phase=>{const p=proof.native_audio?.[phase],prefix=proof.evidence_id+'-playback-'+phase;
            if(p?.state!=='started'||p.package_uid_verified!==true||p.foreign_started!==0||!['uid','pid','piid'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0)
              ||!['evidence','package_uid','uid_owners'].every((k,i)=>p[k+'_file']===prefix+'.'+['audio.txt','package-uid.txt','uid-owners.txt'][i]&&/^[0-9a-f]{64}$/.test(p[k+'_sha256']||'')))throw Error('本轮native音轨或UID/raw证据不符');return p;});
          if(nativePhases[0].uid!==nativePhases[1].uid)throw Error('本轮native音轨UID发生变化');
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
          if(attempted)qualificationProgress.set(v.video_id,{settled:!thrown&&!failures.some(f=>f.video_id===v.video_id),recordingsRequired:recordingsRequired-previous.recordingsRequired,mediaVerified:mediaVerified-previous.mediaVerified,recordingSilentRejected:recordingSilentRejected-previous.recordingSilentRejected,recordingOutcomesFailures:recordingOutcomesFailures-previous.recordingOutcomesFailures,recordingsUnverified:recordingsUnverified-previous.recordingsUnverified});
        }
      }
      const totals=[...qualificationProgress.values()].reduce((all,row)=>Object.fromEntries(Object.keys(all).map(k=>[k,all[k]+row[k]])),{recordingsRequired:0,mediaVerified:0,recordingSilentRejected:0,recordingOutcomesFailures:0,recordingsUnverified:0});
      ({recordingsRequired,mediaVerified,recordingSilentRejected,recordingOutcomesFailures,recordingsUnverified}=totals);
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-qualification-progress.json`),JSON.stringify({run,source_commit:sourceCommit,leased_video_ids:leased.map(v=>v.video_id),qualified_video_ids:qualified.map(v=>v.video_id),videos:[...qualificationProgress].map(([video_id,facts])=>({video_id,...facts,attempts:qualificationAttempts.get(video_id)}))}),{mode:0o600});
      const verified=leased.filter(v=>{try {const proof=JSON.parse(readFileSync(join(env.WFR_RUN_DIR,`${run}-identity-${v.video_id}.json`),'utf8'));
        return proof.verified===true&&proof.observed_video_id===v.video_id&&proof.content_type==='video';}catch{return false;}}).length;
      return {claimed:leased.length,matched:qualified.length,videos_verified:verified,recordings_required:recordingsRequired,media_volume_verified:mediaVerified,media_volume_failures:recordingsUnverified?null:recordingsRequired>mediaVerified?recordingsRequired-mediaVerified:0,recordings_unverified:recordingsUnverified,recordings_silent_rejected:recordingSilentRejected,recording_outcomes_failures:recordingOutcomesFailures,failures,...(failures.length?{status:'partial'}:{})};
    },
    collection:async()=>{historyScoped=0;let comments=0,collected=0,sampled=0,rescans=0,avatarRecoveries=0,inserted=0,historyVerified=0,coverage=0,historyConsumed=0;const failures=[],sampleReceipts=[];
      // 空候选也产出可读回的空工件；保留已有行，缺文件判定仍由统一裁判严格执行。
      appendFileSync(join(env.WFR_RUN_DIR,'comments.tsv'),'',{mode:0o600});
      for(const v of qualified){try{
        collectionTiming();
        await queue('renew_video',{video_id:v.video_id});const result=await videoAction('collection',v);
        appendFileSync(join(env.WFR_RUN_DIR,'comments.tsv'),result.stdout);
        const rows=parseCollection(result,v.video_id,{allowPartial:true,recipientScope:{runDir:env.WFR_RUN_DIR,lineKey:lineRoutes.routeOf(line).key,run,sourceRun:env.LEADGEN_SOURCE_RUN,profile}});
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
      }catch(error){failures.push({video_id:v.video_id,reason:error.message});}}
      if(state.remainingVideoIds?.length)failures.push({reason:'本次认领上限或并发租约留下待处理视频',remaining_video_ids:state.remainingVideoIds});
      return {sampling_receipts:sampleReceipts.map(({pg_rows,...publicReceipt})=>publicReceipt),fulfilled_sample_video_ids:sampleReceipts.map(v=>v.video_id),sampling_required_count:sampleInput?qualified.length:0,sampling_readback_count:sampleReceipts.length,collected,videos_collected:collected,videos_sampled:sampled,comment_sample_limit:sampleInput?.comment_limit||0,comments,comments_collected:comments,comments_inserted:inserted,history_verified:historyVerified,coverage,history_required_count:qualified.length,history_scoped_count:historyScoped,history_consumption_count:historyConsumed,history_failures:qualified.length-historyConsumed,history_scope_verified:Number(qualified.length>0&&historyScoped===qualified.length),history_consumption_readback:Number(qualified.length>0&&historyConsumed===qualified.length),videos_processed:collected+sampled,rescan_count:rescans,identity_rescan_count:rescans,avatar_recovery_count:avatarRecoveries,
        identity_rescan_rate:qualified.length?rescans/qualified.length:0,rescan_rate:qualified.length?rescans/qualified.length:0,failures,...(failures.length?{status:'partial'}:{})};},
    scoring:async()=>{const r=await queue('score');
      appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),`SORT_STATS ${JSON.stringify(r)}\n`,{mode:0o600});
      const readback=await queue('score_readback',{ids:r.ids});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-scoring-readback.json`),JSON.stringify(readback));
      return {...r,scoring_readback_failures:readback.failures};},
    mark_leads:async()=>{const r=await queue('mark_leads');const readback=await queue('mark_readback',{ids:r.ids,lead_ids:r.lead_ids});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-mark_leads-readback.json`),JSON.stringify(readback));
      const remaining=state.budgetDeadline?state.budgetDeadline-Date.now():180000;
      if(remaining<=15000)throw Error('EXECUTION_DEADLINE: 桥接剩余预算不足');
      const bridge=await queue('bridge_outreach',{remaining_ms:Math.min(165000,remaining-15000)});
      const bridgeReadback=await queue('bridge_readback',{ids:bridge.ids||[]});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-bridge-readback.json`),JSON.stringify(bridgeReadback),{mode:0o600});
      return {...r,bridge,mark_leads_readback_failures:readback.failures,bridge_readback_failures:bridgeReadback.failures+(bridge.verified===false?1:0),...(bridge.verified===false||!bridgeReadback.verified?{status:'partial'}:{})};},
    send_dm:outreach.send_dm,write_back:outreach.write_back,
    cleanup:async()=>{const failures=[];let closed=false,desktop=false,released=false;
      try{await outreach.cleanup();}catch(error){failures.push({reason:error.message});}
      for(const v of leased)try{await queue('release_video',{video_id:v.video_id});}catch(error){failures.push({video_id:v.video_id,reason:error.message});}
      if(!locked&&failures.length===0)return {status:'skipped',reason:'本批没有取得设备锁，无需清场',no_lock:true};
      if(locked){try{const refreshed=await phone('lock-refresh',run);if(!refreshed.startsWith('lock=refreshed'))throw Error('锁所有权不可确认');
        await phone('close-app');closed=true;await phone('return-safe-desktop');desktop=true;
        const result=await phone('lock-release',run);if(!result.startsWith('lock=released'))throw Error('锁释放未确认');released=true;locked=false;
      }catch(error){failures.push({reason:error.message});}}
      return {close_app:closed,close_app_attempts:Number(closed),safe_desktop:desktop,safe_desktop_visible:Number(desktop),lock_released:Number(released),no_lock:!locked,failures,
        ...(failures.length?{status:'partial'}:{})};},
  };
}

export function activityExecutionDeadline({activity,env,previous,now=Date.now()}){
  const budget=Number(activity.budget?.max_duration_s||120);
  const requested=activity.key==='collect_videos'?Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||budget):budget;
  const start=Number(env.WF_RUN_START_TS),whole=Number(env.WF_RUN_MAX_SECONDS);
  if(!Number.isSafeInteger(budget)||budget<1||!Number.isSafeInteger(requested)||requested<1||requested>budget||!Number.isSafeInteger(start)||start<=0||!Number.isSafeInteger(whole)||whole<1)throw Error('请求预算超过Activity合同或全局预算非法');
  if(previous!==undefined&&!Number.isSafeInteger(previous))throw Error('原Activity截止非法');
  return Math.min(previous??now+requested*1000,(start+whole)*1000);
}

async function main(){
  const env=process.env,dir=env.WFR_RUN_DIR;
  const frozen=readFrozen(dir);assertCommentSampling(frozen,env);const binding=readBinding(dir,env.WFR_ATTEMPT,frozen);
  if(binding.run_id!==`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`)throw Error('运行绑定身份不符');
  const root=resolve(dir,'runtime');
  env.DOUYIN_PHONE_ADB=join(root,'douyin-phone-adb');
  if(resolve(env.WF_HOME)!==root||resolve(fileURLToPath(import.meta.url))!==join(root,'leadgen-workflow.mjs'))throw Error('执行器必须来自本批冻结字节');
  if(frozen.runtime_transport){env.LEADGEN_MMV_HOSTNAME=frozen.runtime_transport.ssh_hostname;env.LEADGEN_MMV_HOSTKEY_ALIAS=frozen.runtime_transport.ssh_hostkey_alias;}
  const rpc=createRpc({frozen,local:env.LEADGEN_LOCAL_RPC==='1'});
  const context={sampling_input:frozen.sampling_input||null,run_id:binding.run_id,workflow_key:env.WF_BRAIN_WORKFLOW,profile:env.P,source_commit:frozen.deployment.source_commit};
  writeFileSync(join(dir,'activity.log'),'');
  const records=[];const record=async r=>{
    r={...r,observed_at:new Date().toISOString()};
    records.push(r);appendFileSync(join(dir,'activity-events.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});
    if(['execution','verification'].includes(r.phase)){
      const ledgerStatus=[r.evidence.status,r.evidence.result?.status].some(status=>['partial','paused','skipped'].includes(status))?'blocked':r.evidence.status;
      const updated=await execInput(process.execPath,[join(root,'ledger.mjs'),'set','--run-dir',dir,
        '--stage',r.activity,'--status',ledgerStatus,'--n','1','--word','']);
      if(updated.code!==0)throw Error('实际活动账本更新失败');
    }
  };
  const activities=frozen.activities.map(a=>({...a.version.payload.contract,key:a.reference.slot_key}));
  const verify=async(activity,result)=>{
    const receipts=records.filter(r=>r.activity===activity.key&&['before','after'].includes(r.phase));
    const metrics={...(result.result?.counts||{}),...result.result,commander_verified:Number(receipts.length>=2&&receipts.every(r=>r.commander_status==='available'))};
    const response=await rpc({kind:'verify',workflow:env.WF_BRAIN_WORKFLOW,stage:activity.key,run:env.WFR_TAG,line:env.LEADGEN_LINE,metrics},{timeoutMs:100000});
    const spec=JSON.parse(readFileSync(join(dir,'step-dod.json'),'utf8'));
    // 多源取证分别按真实source索引检查，不能拿一个来源的截图代替另一个。
    const phoneEvidence=env.LEADGEN_EVIDENCE_DIR||join('/private/tmp/openclaw-phone/evidence',env.P);
    const atSteps=spec.steps.filter(s=>(s.at||s.activity)===activity.key);
    const steps=atSteps.flatMap(step=>judgeSteps({spec:{...spec,steps:[step]},stage:activity.key,remote:response.result.steps,
      ctx:{metrics,tag:env.WFR_TAG,n:1,word:'',evidenceDir:/identity|readback/.test(step.readback?.glob||'')?dir:phoneEvidence,
        logFile:join(dir,'activity.log'),tsvFile:join(dir,'comments.tsv'),runDir:dir}}).steps);
    const local=[{steps}];
    const probes=response.result.probes||[];
    const expected=spec.steps.filter(s=>(s.at||s.activity)===activity.key);
    const verified=probes.length>0&&probes.every(p=>p.pass===true)&&local.every(r=>r.steps.length===expected.length&&r.steps.every(s=>s.pass===true));
    return {verified,metrics,probes,step_dod:local};
  };
  const handlers=createHandlers({root,env,rpc,sourceCommit:frozen.deployment.source_commit});
  const activityDeadlines=new Map();
  const execution=Object.fromEntries(activities.map(activity=>[activity.key,async()=>{
    const deadline=activityExecutionDeadline({activity,env,previous:activityDeadlines.get(activity.key)});
    activityDeadlines.set(activity.key,deadline);handlers.state.budgetDeadline=deadline;
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
    if(deadline<=Date.now())throw Error('EXECUTION_DEADLINE: 原Activity或整轮预算已尽');
    if(activity.key!=='cleanup'&&env.WF_STOP_FILE&&existsSync(env.WF_STOP_FILE))return {status:'partial',reason:'已收到停止请求'};
    const result=await handlers[activity.key]();
    if(handlers.state.executionUnknown){const e=Error('OLD_EXECUTION_TERMINATION_UNKNOWN');e.executionStopped=false;throw e;}
    return result;
  }]));
  const recover=createActivityRecovery({runDir:dir,frozen,binding,env,handlers,rpc});
  const result=await runWorkflow({activities,context,handlers:execution,recover,quarantine:handlers.quarantineResources,
    commander:async receipt=>{
      if(receipt.phase==='before'){
        const mark=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'mark-start',receipt.activity,'1']);
        if(mark.code!==0)throw Error('活动起始证据未登记');
      }
      return (await rpc({kind:'commander',receipt},{timeoutMs:75000})).decision;
    },record,verify});
  for(const item of result.results){
    const file=join(dir,`activity-${item.activity}.json`);
    writeFileSync(file,JSON.stringify({...item,observed_at:new Date().toISOString(),metrics:item.verification?.metrics||item.result||{},commander:records.filter(r=>r.activity===item.activity)},null,2));
    // 中央证据失败使验收不通过，不能只凭本地日志宣称已完成。
    const sent=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'span',item.activity,
      item.status==='completed'?'completed':['blocked','skipped'].includes(item.status)||item.result?.status==='paused'?'blocked':'failed','1',file]);
    if(sent.code!==0)result.status='failed';
  }
  const delivery=await execInput(process.execPath,[join(root,'runtime-receipts.mjs'),'flush']);
  result.evidence_status=delivery.code===0&&/WFR_EVIDENCE_STATUS=sent/.test(delivery.stdout)?'sent':'pending_or_blocked';
  if(result.evidence_status!=='sent')result.status='failed';
  writeFileSync(join(dir,'split-result.json'),JSON.stringify({...context,...result},null,2));
  process.stdout.write(JSON.stringify({...context,...result})+'\n');
  if(result.status!=='completed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{
  process.stderr.write('新流程执行失败，请读取本批固定定义与活动证据\n');process.exitCode=1;
});
