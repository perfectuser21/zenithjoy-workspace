import {writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import history from './queued-comment-history.js';
// 逐视频仍调用原bounded与原历史合同，不拥有队列/设备的新入口。
export function createVideoAction({root,env,run,line,profile,serial,queue,bounded,nativeReceipt,collectionTiming,collectionBudget,collectionBudgetExplicit,collectionBudgetVideos,qualificationAttempts,sampleInput,state,getCollectionScope,onHistoryScoped}){
  return async(mode,v)=>{
    let historyFile='';
    if(mode==='collection')collectionTiming();
    if(mode==='collection'){
      const receipt=await queue('comment_history',{video_id:v.video_id,video_url:v.video_url});
      historyFile=join(env.WFR_RUN_DIR,`${run}-history-${v.video_id}.json`);
      const temp=historyFile+`.tmp-${process.pid}`;
      writeFileSync(temp,JSON.stringify(receipt),{mode:0o600,flag:'wx'});renameSync(temp,historyFile);
      history.load(historyFile,env.WFR_RUN_DIR,{line,run,source_run:env.LEADGEN_SOURCE_RUN||null,video_id:v.video_id,video_url:v.video_url});
      onHistoryScoped();
    }
    let timing;
    if(mode==='collection'){
      timing=collectionTiming();
      collectionBudgetVideos.push({video_id:v.video_id,...timing,observed_at:new Date().toISOString()});
      writeFileSync(join(env.WFR_RUN_DIR,`${run}-collection-budget-readback.json`),JSON.stringify({run_tag:run,profile,serial,line,source_run:env.LEADGEN_SOURCE_RUN||null,collection_budget_s:collectionBudget,requested_explicit:collectionBudgetExplicit,global_start_ts:env.WF_RUN_START_TS===undefined?null:Number(env.WF_RUN_START_TS),global_max_seconds:Number(env.WF_RUN_MAX_SECONDS||1800),activity_deadline_ms:state.budgetDeadline||null,action_max_duration_s:timing.action_max_duration_s,sampling_input:sampleInput,videos:collectionBudgetVideos}),{mode:0o600});
    }
    if(mode==='collection')state.collectionActionStartedAt=Date.now();
    return bounded(getCollectionScope()?.zsh||'zsh',[...(getCollectionScope()?['-f']:[]),join(root,'process-queued-video.sh'),mode,profile,
      v.video_id,v.video_url,Buffer.from(v.title||'').toString('base64'),Buffer.from(v.keyword||'').toString('base64'),run,line],
      {receipt:nativeReceipt(),maxDurationS:mode==='qualification'?900:mode==='collection'?timing.action_max_duration_s:480,...(timing?{timeoutMs:timing.timeout_ms}:{}),
        env:{...(getCollectionScope()?.env||{}),...(mode==='qualification'&&(qualificationAttempts.get(v.video_id)||1)>1?{QUEUED_VIDEO_EVIDENCE_ATTEMPT:String(qualificationAttempts.get(v.video_id)-1)}:{}),...(mode==='collection'?{QUEUED_VIDEO_COLLECTION_SECONDS:String(collectionBudget),QUEUED_RECIPIENT_COMPANY_BINDING_FILE:state.recipientCompanyBindingFile||'',QUEUED_RECIPIENT_COMPANY_BINDING_SHA:state.recipientCompanyBindingSha||''}:{}),QUEUED_VIDEO_QUALIFY_CMD:join(root,'leadgen-qualify.sh'),QUEUED_COMMENT_HISTORY_FILE:historyFile,...(sampleInput?{LEADGEN_COMMENT_LIMIT:String(sampleInput.comment_limit)}:{})}});
  };
}
