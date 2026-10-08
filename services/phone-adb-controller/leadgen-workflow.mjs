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
  const execute=async activity=>{
    if(typeof handlers[activity.key]!=='function')throw Error(`活动缺实现: ${activity.key}`);
    try {
      const result=await runActivity({activity,context,execute:handlers[activity.key],commander,record});
      if(['paused','partial'].includes(result.result?.status))result.status='partial';
      if(result.result?.status==='skipped')result.status='skipped';
      if(result.status==='completed'&&verify){
        result.verification=await verify(activity,result);
        if(result.verification.verified!==true)result.status='failed';
      }
      results.push({activity:activity.key,...result});
      if(result.status==='failed'){status='failed';stopped=true;}
      else if(result.status==='partial'||['finish','escalate'].includes(result.decision?.action)
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

export function parseCollection(result,videoId) {
  if(result.code!==0)throw Error(`采集未完成 code=${result.code}`);
  const lines=result.stdout.split('\n').map(s=>s.replace(/\r$/,''));
  const marker=lines.find(s=>s.startsWith(`COLLECTION\t${videoId}\t`))?.split('\t');
  if(!marker||!['collected','no_comments'].includes(marker[2]))throw Error('缺同视频采集完成标记');
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
    return checked(ctl,['--profile',profile,...ownerArgs,command,...args]);
  };
  const queue=async(op,fields={})=>(await rpc({kind:'queue',request:{op,line,run,source_run:env.LEADGEN_SOURCE_RUN||undefined,limit:Number(env.LEADGEN_LIMIT||2),...fields}})).result;
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
    const confPath=env.OWN_ACCOUNTS_CONF||join(env.HOME,'bin-harvest/config/own-accounts.json');
    const ownAccounts=JSON.parse(readFileSync(confPath,'utf8'));
    discovery=createDiscoveryHandlers({phone,execute:bounded,queue,profile,run,root,
      sources,sourceKind:env.LEADGEN_SOURCE_KIND||'keyword',limit:Number(env.LEADGEN_LIMIT||2),ownAccounts,env});
    return discovery;
  };
  const videoAction=(mode,v)=>bounded('zsh',[join(root,'process-queued-video.sh'),mode,profile,
    v.video_id,v.video_url,Buffer.from(v.title||'').toString('base64'),Buffer.from(v.keyword||'').toString('base64'),run,line],
    {maxDurationS:mode==='collection'?600:300,env:{QUEUED_VIDEO_QUALIFY_CMD:join(root,'leadgen-qualify.sh')}});
  return {state,preflight,
    source:async()=>(await getDiscovery()).source(),
    dedup:async()=>{const r=await (await getDiscovery()).dedup();return {...r,historical_filter_verified:1,own_filter_verified:1,run_dedup_verified:1};},
    write_videos:async()=>{const result=await (await getDiscovery()).write_videos();
      return {...result,persisted:result.videos.length,candidates:result.videos.length,videos_pushed:result.videos.length,
        ...(result.failures.length||result.known_gaps.length?{status:'partial'}:{})};},
    qualification:async()=>{
      leased=await queue('claim_videos');const failures=[];qualified=[];
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
        const rows=parseCollection(result,v.video_id);
        const telemetry=result.stdout.split('\n').find(s=>s.startsWith(`RESCAN\t${v.video_id}\t`))?.split('\t')[2];
        if(!/^\d+$/.test(telemetry||''))throw Error('缺实际重扫计数，不能宣称采集通过');
        rescans+=Number(telemetry);
        const stored=await queue('collect',{video_id:v.video_id,comments:rows});
        comments+=stored.comments;collected++;leased=leased.filter(p=>p.video_id!==v.video_id);
      }catch(error){failures.push({video_id:v.video_id,reason:error.message});}}
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
    handlers.state.budgetDeadline=Date.now()+Number(activity.budget?.max_duration_s||120)*1000;
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
