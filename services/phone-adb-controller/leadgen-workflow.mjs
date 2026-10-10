import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runActivity} from './activity-commander.mjs';
import {readFrozen} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {createRpc,execInput} from './leadgen-client.mjs';
import {createDiscoveryHandlers} from './leadgen-discovery.mjs';
import {judgeSteps} from './step-judge.mjs';

// 任一普通活动失败或Commander叫停，停止后续业务；清场总在最后执行。
export async function runWorkflow({activities,context,handlers,commander,record,verify}) {
  const results=[];let status='completed',stopped=false;
  const ordered=[...activities.filter(a=>a.key!=='cleanup'),...activities.filter(a=>a.key==='cleanup')];
  const execute=async activity=>{
    if(typeof handlers[activity.key]!=='function')throw Error(`活动缺实现: ${activity.key}`);
    try {
      const remaining=ordered.slice(ordered.indexOf(activity)+1).map(a=>a.key);
      const activityContext={...context,workflow_progress:{completed_activity_keys:results.filter(r=>['completed','skipped'].includes(r.status)).map(r=>r.activity),
        remaining_activity_keys:remaining}};
      const result=await runActivity({activity,context:activityContext,execute:handlers[activity.key],commander,record});
      if(['paused','partial'].includes(result.result?.status))result.status='partial';
      if(result.result?.status==='skipped')result.status='skipped';
      if(result.status==='completed'&&verify){
        result.verification=await verify(activity,result);
        if(result.verification.verified!==true)result.status='failed';
      }
      results.push({activity:activity.key,...result});
      // 清场完成后Commander正常finish是收尾结果；业务提前停止、失败与升级仍如实保留。
      const normalCleanupFinish=activity.key==='cleanup'&&['completed','skipped'].includes(result.status)&&result.decision?.action==='finish';
      const normalFinalFinish=remaining.length===0&&result.status==='completed'&&result.decision?.action==='finish';
      if(result.status==='failed'){status='failed';stopped=true;}
      else if(result.status==='partial'||(['finish','escalate'].includes(result.decision?.action)&&!normalCleanupFinish&&!normalFinalFinish)
        ||result.result?.status==='partial'||result.result?.status==='paused'){
        if(status!=='failed')status='partial';stopped=true;
      }
    }catch(error){
      status='failed';stopped=true;
      const result={activity:activity.key,status:'failed',error:String(error.message).slice(0,400)};
      results.push(result);await record({...context,...result,phase:'failure'});
    }
  };
  try {for(const a of activities.filter(a=>a.key!=='cleanup')){
    if(stopped){results.push({activity:a.key,status:'blocked',reason:'前序活动未通过或Commander要求收工'});continue;}
    await execute(a);
  }}finally{for(const a of activities.filter(a=>a.key==='cleanup'))await execute(a);}
  return {status,results};
}

export function parseCollection(result,videoId,{allowPartial=false}={}) {
  if(result.code!==0&&!(allowPartial&&result.code===7))throw Error(`采集未完成 code=${result.code}`);
  const lines=result.stdout.split('\n').map(s=>s.replace(/\r$/,''));
  const marker=lines.find(s=>s.startsWith(`COLLECTION\t${videoId}\t`))?.split('\t');
  const allowed=result.code===7?['partial']:['collected','no_comments'];
  if(!marker||!allowed.includes(marker[2]))throw Error('缺同视频采集完成标记');
  const comments=lines.filter(s=>s.startsWith('LEAD\t')).map(s=>{
    const f=s.split('\t');if(f.length!==12)throw Error('评论字段损坏');
    return {nickname:f[1],douyinId:f[2],accountType:f[3],commentBody:f[4],commentTime:f[5],
      region:f[6],sourceVideo:f[7],keyword:f[8],profileIp:f[9],profileUrl:f[10],sourceVideoUrl:f[11]};
  });
  if(Number(marker[3])!==comments.length||marker[2]==='no_comments'&&comments.length)throw Error('采集完成数量与评论证据不符');
  return comments;
}

export function createHandlers({root,env,rpc,execute=execInput}) {
  const {P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:line}=env;
  let locked=false,leased=[],qualified=[],discovery;
  const state={profile,line,run};
  const bounded=async(command,args,opts={})=>{const result=await execute(command,args,{...opts,
    timeoutMs:Math.max(1,Math.min(opts.timeoutMs||Number(opts.maxDurationS||120)*1000,
      state.budgetDeadline?state.budgetDeadline-Date.now():Number(env.WF_RUN_MAX_SECONDS||1800)*1000)),
    env:{...env,DOUYIN_LOCK_PID:String(process.pid),...opts.env}});appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),result.stderr||'',{mode:0o600});return result;};
  const checked=async(command,args,opts)=>{const r=await bounded(command,args,opts);if(r.code!==0)throw Error(`动作失败 code=${r.code}: ${r.stderr?.slice(-500)||command}`);return r.stdout;};
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
      command==='current-video-link'?{maxDurationS:300}:{});
  };
  const queue=async(op,fields={})=>(await rpc({kind:'queue',request:{op,line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,limit:Number(env.LEADGEN_LIMIT||2),...fields}},
    op==='discover'?{timeoutMs:Math.max(1,Math.min(60000,state.budgetDeadline?state.budgetDeadline-Date.now():60000))}:{})).result;
  const preflight=async()=>{
    if(env.WF_BRAIN_WORKFLOW==='douyin_lead_outreach'){
      const flag=join(env.HOME,`bin-harvest/state/dm-paused-${profile}.flag`);
      if(existsSync(flag))return {status:'paused',reason:'私信暂停标记生效',sent:0};
      // 私信须另有用户授权及完整队列回写，本次恢复验收始终保持暂停。
      return {status:'paused',reason:'本次获客恢复验收保持私信暂停',sent:0};
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
    state.account=id;return {device_verified:true,lock_acquired:true,call_state_idle:true,account_verified:true,douyin_id:id};
  };
  const getDiscovery=async()=>{
    if(discovery)return discovery;
    const sources=env.LEADGEN_SOURCES_FILE?readFileSync(env.LEADGEN_SOURCES_FILE,'utf8').split('\n').filter(Boolean)
      :(await rpc({kind:'keywords',line,count:2})).result;
    discovery=createDiscoveryHandlers({phone,execute:bounded,queue,profile,run,root,
      sources,sourceKind:env.LEADGEN_SOURCE_KIND||'keyword',location:env.LEADGEN_LOCATION||'same_city',limit:Number(env.LEADGEN_LIMIT??0),env,budgetDeadline:()=>state.budgetDeadline||0});
    return discovery;
  };
  const intake=async()=>{
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
    const skipped=[],eligible=[];
    for(const v of input.videos){const row=rows.find(r=>r.video_id===v.videoId);
      if(!['pending','matched','rejected'].includes(row.judgment_status)||typeof row.process_status!=='string')throw Error('PG视频状态缺合法终态');
      const reason=row.judgment_status==='rejected'?'rejected':row.process_status==='评论已采'?'completed':ownNames.has(normalize(v.author))?'own':null;
      if(reason)skipped.push({video_id:v.videoId,reason});else eligible.push(v.videoId);
    }
    state.intakeVideoIds=eligible;
    const proof={verified:true,source_run:sourceRun,source_commit:upstream.deployment.source_commit,
      observed_at:new Date().toISOString(),video_ids:ids,eligible_video_ids:eligible,skipped,rows,
      duplicate_observations:input.captures.length-ids.length};
    writeFileSync(join(env.WFR_RUN_DIR,`${run}-intake-readback.json`),JSON.stringify(proof),{mode:0o600});
    return {historical_filter_verified:Number(rows.length===ids.length),own_filter_verified:Number(Array.isArray(own.nicknames)&&Array.isArray(own.ids)),run_dedup_verified:Number(new Set(eligible).size===eligible.length),
      received:ids.length,eligible:eligible.length,skipped_completed:skipped.filter(v=>v.reason==='completed').length,
      skipped_rejected:skipped.filter(v=>v.reason==='rejected').length,skipped_own:skipped.filter(v=>v.reason==='own').length,duplicate_observations:proof.duplicate_observations};
  };
  const videoAction=(mode,v)=>bounded('zsh',[join(root,'process-queued-video.sh'),mode,profile,
    v.video_id,v.video_url,Buffer.from(v.title||'').toString('base64'),Buffer.from(v.keyword||'').toString('base64'),run,line],
    // 资格是打开、实际取链核验、录音、上传与远端判定的组合，不能沿用单次取链300秒。
    // 身份组合：打开180秒+取链300秒；采集组合另含内部480秒采集预算。
    // 仍由bounded限制在各正式活动的剩余预算内。
    {maxDurationS:mode==='qualification'?900:mode==='collection'?960:480,env:{QUEUED_VIDEO_QUALIFY_CMD:join(root,'leadgen-qualify.sh')}});
  return {state,preflight,
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
      if(env.WF_BRAIN_WORKFLOW==='douyin_video_processing'&&!Array.isArray(state.intakeVideoIds))throw Error('102必须先核验101明确ID交接');
      leased=await queue('claim_videos',Array.isArray(state.intakeVideoIds)?{video_ids:state.intakeVideoIds}:{});
      state.remainingVideoIds=state.intakeVideoIds?.filter(id=>!leased.some(v=>v.video_id===id))||[];
      const failures=[];qualified=[];
      for(const v of leased){await queue('renew_video',{video_id:v.video_id});
        if(v.judgment_status==='matched'){
          const identity=await videoAction('identity',v);
          if(identity.code===0)qualified.push(v);else failures.push({video_id:v.video_id,code:identity.code,reason:identity.stderr.slice(-500)});
          continue;
        }
        const result=await videoAction('qualification',v);
        appendFileSync(join(env.WFR_RUN_DIR,'qualification.tsv'),result.stdout);
        const verdict=result.stdout.split('\n').find(s=>s.startsWith(`QUAL\t${v.video_id}\t`))?.split('\t')[2];
        if(result.code===0&&verdict==='matched')qualified.push(v);
        else if(result.code!==0||verdict!=='rejected')failures.push({video_id:v.video_id,code:result.code,reason:result.stderr.slice(-500)});
      }
      const verified=leased.filter(v=>{try {const proof=JSON.parse(readFileSync(join(env.WFR_RUN_DIR,`${run}-identity-${v.video_id}.json`),'utf8'));
        return proof.verified===true&&proof.observed_video_id===v.video_id&&proof.content_type==='video';}catch{return false;}}).length;
      return {claimed:leased.length,matched:qualified.length,videos_verified:verified,failures,...(failures.length?{status:'partial'}:{})};
    },
    collection:async()=>{let comments=0,collected=0,rescans=0;const failures=[];
      for(const v of qualified){try{
        await queue('renew_video',{video_id:v.video_id});const result=await videoAction('collection',v);
        appendFileSync(join(env.WFR_RUN_DIR,'comments.tsv'),result.stdout);
        const rows=parseCollection(result,v.video_id,{allowPartial:true});
        const telemetry=result.stdout.split('\n').find(s=>s.startsWith(`RESCAN\t${v.video_id}\t`))?.split('\t')[2];
        if(!/^\d+$/.test(telemetry||''))throw Error('缺实际重扫计数，不能宣称采集通过');
        rescans+=Number(telemetry);
        const partial=result.code===7;
        const stored=await queue(partial?'collect_partial':'collect',{video_id:v.video_id,comments:rows});
        comments+=stored.comments;
        if(partial)failures.push({video_id:v.video_id,code:7,reason:'采集在预算或停止边界结束，已保存核验评论，视频仍未采完',comments_saved:stored.comments});
        else {collected++;leased=leased.filter(p=>p.video_id!==v.video_id);}
      }catch(error){failures.push({video_id:v.video_id,reason:error.message});}}
      if(state.remainingVideoIds?.length)failures.push({reason:'本次认领上限或并发租约留下待处理视频',remaining_video_ids:state.remainingVideoIds});
      return {collected,comments,comments_collected:comments,videos_processed:collected,rescan_count:rescans,
        rescan_rate:qualified.length?rescans/qualified.length:0,failures,...(failures.length?{status:'partial'}:{})};},
    scoring:async()=>{const r=await queue('score');
      appendFileSync(join(env.WFR_RUN_DIR,'activity.log'),`SORT_STATS ${JSON.stringify(r)}\n`,{mode:0o600});
      const readback=await queue('score_readback',{ids:r.ids});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-scoring-readback.json`),JSON.stringify(readback));
      return {...r,scoring_readback_failures:readback.failures};},
    mark_leads:async()=>{const r=await queue('mark_leads');const readback=await queue('mark_readback',{ids:r.ids,lead_ids:r.lead_ids});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-mark_leads-readback.json`),JSON.stringify(readback));
      return {...r,mark_leads_readback_failures:readback.failures};},
    send_dm:async()=>{throw Error('本次私信保持暂停');},write_back:async()=>{throw Error('没有发送事实，不能回写发送成功');},
    cleanup:async()=>{const failures=[];let closed=false,desktop=false,released=false;
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

async function main(){
  const env=process.env,dir=env.WFR_RUN_DIR;
  const frozen=readFrozen(dir);const binding=readBinding(dir,env.WFR_ATTEMPT,frozen);
  if(binding.run_id!==`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`)throw Error('运行绑定身份不符');
  const root=resolve(dir,'runtime');
  env.DOUYIN_PHONE_ADB=join(root,'douyin-phone-adb');
  if(resolve(env.WF_HOME)!==root||resolve(fileURLToPath(import.meta.url))!==join(root,'leadgen-workflow.mjs'))throw Error('执行器必须来自本批冻结字节');
  if(frozen.runtime_transport){env.LEADGEN_MMV_HOSTNAME=frozen.runtime_transport.ssh_hostname;env.LEADGEN_MMV_HOSTKEY_ALIAS=frozen.runtime_transport.ssh_hostkey_alias;}
  const rpc=createRpc({frozen,local:env.LEADGEN_LOCAL_RPC==='1'});
  const context={run_id:binding.run_id,workflow_key:env.WF_BRAIN_WORKFLOW,profile:env.P,source_commit:frozen.deployment.source_commit};
  writeFileSync(join(dir,'activity.log'),'');
  const records=[];const record=async r=>{
    r={...r,observed_at:new Date().toISOString()};
    records.push(r);appendFileSync(join(dir,'activity-events.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});
    if(r.phase==='execution'){
      const ledgerStatus=['partial','paused','skipped'].includes(r.evidence.result?.status)?'blocked':r.evidence.status;
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
  const handlers=createHandlers({root,env,rpc});
  const execution=Object.fromEntries(activities.map(activity=>[activity.key,async()=>{
    const budget=Number(activity.budget?.max_duration_s||120);
    const requested=activity.key==='collect_videos'?Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||budget):budget;
    if(!Number.isSafeInteger(requested)||requested<1||requested>budget)throw Error('请求预算超过Activity合同');
    handlers.state.budgetDeadline=Date.now()+requested*1000;
    if(activity.key!=='cleanup'&&env.WF_STOP_FILE&&existsSync(env.WF_STOP_FILE))return {status:'partial',reason:'已收到停止请求'};
    return handlers[activity.key]();
  }]));
  const result=await runWorkflow({activities,context,handlers:execution,
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
