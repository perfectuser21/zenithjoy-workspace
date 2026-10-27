// 101只负责发现与本次封闭手机范围，不消费102评论或新业务额度。
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {readFrozen,assertDiscoveryInput,canonical} from './runtime-definition.mjs';
import {createDiscoveryHandlers} from './leadgen-discovery.mjs';
import {startDiscoveryPhoneScope,discoveryCaptureBudgetMs} from './discovery-phone-scope.mjs';
export function createDiscoveryAction({root,env,state,sourceCommit,taskId,phone,bounded,queue,rpc,profile,run,isLocked,isClosed,setClosed,setScope}){
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
      discoveryInput:fixed,sources,sourceKind:env.LEADGEN_SOURCE_KIND||'keyword',location:env.LEADGEN_LOCATION||'same_city',limit:Number(env.LEADGEN_LIMIT??0),env,sourceCommit,runId:`${env.WFR_RUN_ID}__${env.WFR_ATTEMPT}`,budgetDeadline:()=>state.budgetDeadline||0,captureBudgetMs:env.WF_BRAIN_WORKFLOW==='douyin_video_discovery'?discoveryCaptureBudgetMs:0});
    return discovery;
  };
  const collect=async()=>{
      if(isClosed())throw Error('DISCOVERY_PHONE_COLLECT_CLOSED');
      fixedInput();
      if(env.WF_BRAIN_WORKFLOW==='douyin_video_discovery')scope=await startDiscoveryPhoneScope({root,env,state,sourceCommit,taskId,lockHeld:isLocked()});setScope(scope);
      try{const discovery=await getDiscovery();const result=scope&&state.budgetDeadline-Date.now()<discoveryCaptureBudgetMs?discovery.stopForBudget():await discovery.collect_videos();
      const readback=await queue('inspect_videos',{video_ids:result.videos.map(v=>v.videoId)});
      const readbackFailures=result.videos.filter(v=>!readback.some(r=>r.video_id===v.videoId&&r.line_key)).length;
      const outcome={...result,persisted:result.counts.created,candidates:result.videos.length,videos_pushed:result.counts.created,
        video_manifest_readback_failures:readbackFailures,manifest_verified:Number(readbackFailures===0),
        ...(readbackFailures?{status:'partial'}:{}),
        ...(result.failures.length||result.known_gaps.some(g=>g.kind!=='candidate_disappeared'||result.stop_reason!=='limit_reached')?{status:'partial'}:{})};
      const finished=scope?await scope.finish(outcome):outcome;state.discoveryCleanupEvidence=finished;return finished;
      }finally{if(scope){setClosed(true);await scope.close();scope=null;setScope(null);}}};
 return {getDiscovery,collect};
}
