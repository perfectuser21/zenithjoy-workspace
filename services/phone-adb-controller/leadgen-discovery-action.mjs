import {canonicalRunId} from './public-domain-authority.mjs';
// 101只负责发现与本次封闭手机范围，不消费102评论或新业务额度。
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {readFrozen,assertDiscoveryInput,canonical} from './runtime-definition.mjs';
import {createDiscoveryHandlers} from './leadgen-discovery.mjs';
import {startDiscoveryPhoneScope,discoveryCaptureBudgetMs} from './discovery-phone-scope.mjs';
export function createDiscoveryAction({root,env,state,sourceCommit,taskId,phone,bounded,queue,rpc,profile,run,isLocked,isClosed,setClosed,setScope,verifyPhoneAssociation}){
 let discovery,scope;const line=env.LEADGEN_LINE;
 const fixedInput=()=>{const fixed=Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_CANDIDATES')||Object.hasOwn(env,'LEADGEN_DISCOVERY_MAX_ATTEMPTS')||existsSync(join(env.WFR_RUN_DIR,'run-definition.json'))?assertDiscoveryInput(readFrozen(env.WFR_RUN_DIR),env):null;if(fixed&&existsSync(join(env.WFR_RUN_DIR,'discovery-progress.json')))throw Error('DISCOVERY_INPUT_ALREADY_USED');return fixed;};
  const getDiscovery=async()=>{
    if(discovery)return discovery;
    const fixed=fixedInput();
    const requested=env.LEADGEN_SOURCES_FILE?readFileSync(env.LEADGEN_SOURCES_FILE,'utf8').split('\n').filter(Boolean):undefined;
    const keywordResult=await rpc({kind:'keywords',line,run,limit:2,keywords:requested});
    const sources=keywordResult.result;
    if(fixed&&canonical(sources)!==canonical(fixed.sources))throw Error('DISCOVERY_INPUT_SOURCE_MISMATCH');
    if(keywordResult.config)appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(keywordResult.config)+'\n',{mode:0o600});
    discovery=createDiscoveryHandlers({phone,execute:bounded,queue,profile,run,root,
      discoveryInput:fixed,sources,sourceKind:env.LEADGEN_SOURCE_KIND||'keyword',location:env.LEADGEN_LOCATION||'same_city',limit:Number(env.LEADGEN_LIMIT??0),env,sourceCommit,runId:canonicalRunId(env),budgetDeadline:()=>state.budgetDeadline||0,captureBudgetMs:env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?discoveryCaptureBudgetMs:0});
    return discovery;
  };
  const collect=async()=>{
      if(isClosed())throw Error('DISCOVERY_PHONE_COLLECT_CLOSED');
      const frozenInput=fixedInput();
      if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery')scope=await startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld:isLocked(),verifyPhoneAssociation});setScope?.(scope);
      try{
      if(scope?.emptyBeforeLaunch){
        const outcome={status:'partial',stop_reason:'budget_exhausted',filter_invocations:0,counts:{sources:Array.isArray(frozenInput?.sources)?frozenInput.sources.length:null,sources_succeeded:0,source_failed:0,cards:0,attempted:0,opened:0,linked:0,persisted:0,created:0,reused:0,duplicate:0,failed:0,screens:0,missing_identity:0,non_video:0,relocation_skipped:0,zero_comments:0},videos:[],captures:[],zero_comment_candidates:[],pending_capture:null,failures:[],known_gaps:[],relocation_reveals:[],identity_enrichments:[],all_results_scanned:false,persisted:0,candidates:0,videos_pushed:0,video_manifest_readback_failures:null,manifest_verified:0,manifest_readback_performed:false};
        const finished=await scope.finish(outcome);state.discoveryCleanupEvidence=finished;return finished;
      }
      const discovery=await getDiscovery();const result=scope&&state.budgetDeadline-Date.now()<discoveryCaptureBudgetMs?discovery.stopForBudget():await discovery.collect_videos();
      // A PG manifest readback can fail after every native leaf has returned.
      // Keep the business evidence unverified, then seal the live phone scope
      // so only its original cleanup may run. A failed scope seal still throws.
      let readbackFailures;
      try{
        const readback=await queue('inspect_videos',{video_ids:result.videos.map(v=>v.videoId)});
        readbackFailures=Array.isArray(readback)?result.videos.filter(v=>!readback.some(r=>r.video_id===v.videoId&&r.line_key)).length:Math.max(1,result.videos.length);
      }catch{readbackFailures=Math.max(1,result.videos.length);}
      const outcome={...result,persisted:result.counts.created,candidates:result.videos.length,videos_pushed:result.counts.created,
        video_manifest_readback_failures:readbackFailures,manifest_verified:Number(readbackFailures===0),
        ...(readbackFailures?{status:'partial'}:{}),
        ...(result.failures.length||result.known_gaps.some(g=>g.kind!=='candidate_disappeared'||result.stop_reason!=='limit_reached')?{status:'partial'}:{})};
      const finished=scope?await scope.finish(outcome):outcome;state.discoveryCleanupEvidence=finished;return finished;
      }finally{if(scope){setClosed(true);await scope.close();scope=null;setScope?.(null);}}};
 return {getDiscovery,collect};
}
